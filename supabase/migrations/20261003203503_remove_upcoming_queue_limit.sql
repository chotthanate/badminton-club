-- Queue capacity is determined by the number of available players, not by an
-- arbitrary count of upcoming matches. The advisory lock and duplicate-player
-- guards continue to keep concurrent queue creation safe.

create or replace function public.create_queue_draft(
  target_event_id uuid,
  selected_member_ids uuid[],
  team_a_member_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  new_match_id uuid;
  next_sequence integer;
  next_position integer;
  selected_member_id uuid;
  selected_level text;
  selected_team text;
  selected_position integer;
begin
  select club_id into target_club_id
  from public.events
  where id = target_event_id and status = 'open';
  if target_club_id is null or not public.is_club_operator(target_club_id) then
    raise exception 'ไม่พบรอบที่เปิดอยู่หรือไม่มีสิทธิ์จัดคิว';
  end if;
  if coalesce(array_length(selected_member_ids, 1), 0) <> 4
     or (select count(distinct value) from unnest(selected_member_ids) value) <> 4
     or coalesce(array_length(team_a_member_ids, 1), 0) <> 2
     or exists (select 1 from unnest(team_a_member_ids) value where not (value = any(selected_member_ids))) then
    raise exception 'ต้องเลือกผู้เล่น 4 คน และทีม A 2 คน';
  end if;
  if not public.queue_lineup_is_compatible(target_event_id, selected_member_ids) then
    raise exception 'ผู้เล่นชุดนี้ไม่ตรงกับเงื่อนไขระดับมือ';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_event_id::text));
  if (
    select count(*) from public.event_queue_players
    where event_id = target_event_id
      and member_id = any(selected_member_ids)
      and status = 'waiting'
  ) <> 4 then
    raise exception 'มีผู้เล่นบางคนไม่พร้อมเข้าคิวอัตโนมัติ';
  end if;
  if exists (
    select 1
    from public.queue_match_players player
    join public.queue_matches match on match.id = player.match_id
    where player.event_id = target_event_id
      and player.member_id = any(selected_member_ids)
      and match.status in ('draft', 'approved')
  ) then
    raise exception 'มีผู้เล่นบางคนอยู่ในคิวล่วงหน้าอื่นแล้ว';
  end if;

  select coalesce(max(sequence), 0) + 1 into next_sequence
  from public.queue_matches where event_id = target_event_id;
  select coalesce(max(queue_position), 0) + 1 into next_position
  from public.queue_matches where event_id = target_event_id and status in ('draft', 'approved');

  insert into public.queue_matches (
    club_id, event_id, court_id, sequence, queue_position, status, manual_override, created_by
  ) values (
    target_club_id, target_event_id, null, next_sequence, next_position, 'draft', false, auth.uid()
  ) returning id into new_match_id;

  foreach selected_member_id in array selected_member_ids loop
    select skill_level_snapshot into selected_level
    from public.signups
    where event_id = target_event_id and member_id = selected_member_id;
    selected_team := case when selected_member_id = any(team_a_member_ids) then 'A' else 'B' end;
    select count(*) + 1 into selected_position
    from public.queue_match_players
    where match_id = new_match_id and team = selected_team;
    insert into public.queue_match_players (
      club_id, event_id, match_id, member_id, team, position,
      skill_level_snapshot, playable_skill_levels_snapshot
    ) values (
      target_club_id, target_event_id, new_match_id, selected_member_id,
      selected_team, selected_position, selected_level,
      (select playable_skill_levels_snapshot from public.signups where event_id = target_event_id and member_id = selected_member_id)
    );
  end loop;
  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (target_club_id, target_event_id, auth.uid(), 'สร้างคิวร่าง',
    jsonb_build_object('match_id', new_match_id, 'queue_position', next_position));
  return new_match_id;
end;
$$;

create or replace function public.create_manual_queue_draft(target_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  new_match_id uuid;
  next_sequence integer;
  next_position integer;
begin
  select club_id into target_club_id
  from public.events
  where id = target_event_id and status = 'open';
  if target_club_id is null or not public.is_club_operator(target_club_id) then
    raise exception 'ไม่พบรอบที่เปิดอยู่หรือไม่มีสิทธิ์จัดคิว';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_event_id::text));
  select coalesce(max(sequence), 0) + 1 into next_sequence
  from public.queue_matches where event_id = target_event_id;
  select coalesce(max(queue_position), 0) + 1 into next_position
  from public.queue_matches where event_id = target_event_id and status in ('draft', 'approved');

  insert into public.queue_matches (
    club_id, event_id, court_id, sequence, queue_position, status,
    manual_override, created_by
  ) values (
    target_club_id, target_event_id, null, next_sequence, next_position,
    'draft', true, auth.uid()
  ) returning id into new_match_id;

  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (
    target_club_id, target_event_id, auth.uid(), 'สร้างคิวร่างด้วยตัวเอง',
    jsonb_build_object('match_id', new_match_id, 'queue_position', next_position)
  );
  return new_match_id;
end;
$$;

create or replace function public.create_queue_drafts_batch(
  target_event_id uuid,
  queue_lineups jsonb
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  lineup record;
  created_ids uuid[] := '{}'::uuid[];
  created_id uuid;
  requested_count integer;
begin
  select club_id into target_club_id from public.events
  where id = target_event_id and status = 'open';
  if target_club_id is null or not public.is_club_operator(target_club_id) then
    raise exception 'ไม่พบรอบที่เปิดอยู่หรือไม่มีสิทธิ์จัดคิว';
  end if;
  if jsonb_typeof(queue_lineups) <> 'array' then
    raise exception 'ข้อมูลคิวอัตโนมัติไม่ถูกต้อง';
  end if;
  requested_count := jsonb_array_length(queue_lineups);
  if requested_count < 1 then
    raise exception 'ต้องมีข้อมูลคิวอย่างน้อย 1 คิว';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_event_id::text));
  for lineup in select value from jsonb_array_elements(queue_lineups) loop
    if coalesce((lineup.value ->> 'fallback')::boolean, false) then
      created_id := public.create_fallback_queue_draft(
        target_event_id,
        array(select jsonb_array_elements_text(lineup.value -> 'member_ids')::uuid),
        array(select jsonb_array_elements_text(lineup.value -> 'team_a_member_ids')::uuid)
      );
    else
      created_id := public.create_queue_draft(
        target_event_id,
        array(select jsonb_array_elements_text(lineup.value -> 'member_ids')::uuid),
        array(select jsonb_array_elements_text(lineup.value -> 'team_a_member_ids')::uuid)
      );
    end if;
    created_ids := array_append(created_ids, created_id);
  end loop;
  return created_ids;
end;
$$;

revoke all on function public.create_queue_draft(uuid, uuid[], uuid[]) from public, anon;
revoke all on function public.create_manual_queue_draft(uuid) from public, anon;
revoke all on function public.create_queue_drafts_batch(uuid, jsonb) from public, anon;
grant execute on function public.create_queue_draft(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.create_manual_queue_draft(uuid) to authenticated;
grant execute on function public.create_queue_drafts_batch(uuid, jsonb) to authenticated;
