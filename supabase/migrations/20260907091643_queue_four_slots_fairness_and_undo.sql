-- Keep four upcoming queues regardless of the number of booked courts, allow
-- operators to swap players across those queues atomically, and support
-- undoing an accidentally started game without incrementing play statistics.

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
  if (select count(*) from public.queue_matches where event_id = target_event_id and status in ('draft', 'approved')) >= 4 then
    raise exception 'เตรียมคิวล่วงหน้าได้สูงสุด 4 คิว';
  end if;
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
  if (select count(*) from public.queue_matches where event_id = target_event_id and status in ('draft', 'approved')) >= 4 then
    raise exception 'เตรียมคิวล่วงหน้าได้สูงสุด 4 คิว';
  end if;

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
  select club_id into target_club_id
  from public.events
  where id = target_event_id and status = 'open';
  if target_club_id is null or not public.is_club_operator(target_club_id) then
    raise exception 'ไม่พบรอบที่เปิดอยู่หรือไม่มีสิทธิ์จัดคิว';
  end if;
  if jsonb_typeof(queue_lineups) <> 'array' then
    raise exception 'ข้อมูลคิวอัตโนมัติไม่ถูกต้อง';
  end if;
  requested_count := jsonb_array_length(queue_lineups);
  if requested_count < 1 or requested_count > 4 then
    raise exception 'สร้างคิวพร้อมกันได้ 1 ถึง 4 คิว';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_event_id::text));
  if (select count(*) from public.queue_matches where event_id = target_event_id and status in ('draft', 'approved')) + requested_count > 4 then
    raise exception 'เตรียมคิวล่วงหน้าได้สูงสุด 4 คิว';
  end if;

  for lineup in
    select value from jsonb_array_elements(queue_lineups)
  loop
    created_id := public.create_queue_draft(
      target_event_id,
      array(select jsonb_array_elements_text(lineup.value -> 'member_ids')::uuid),
      array(select jsonb_array_elements_text(lineup.value -> 'team_a_member_ids')::uuid)
    );
    created_ids := array_append(created_ids, created_id);
  end loop;
  return created_ids;
end;
$$;

create or replace function public.update_manual_queue_draft_lineup(
  target_match_id uuid,
  slot_assignments jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.queue_matches%rowtype;
  assignment record;
  incoming record;
  next_member_ids uuid[];
  previous_member_ids uuid[];
  displaced_member_ids uuid[];
  displaced_index integer := 1;
  replacement_member_id uuid;
  replacement_level text;
begin
  select * into target_match
  from public.queue_matches
  where id = target_match_id
  for update;
  if target_match.id is null or not public.is_club_operator(target_match.club_id) then
    raise exception 'ไม่มีสิทธิ์แก้คิว';
  end if;
  perform pg_advisory_xact_lock(hashtext(target_match.event_id::text));
  if target_match.status not in ('draft', 'approved') then
    raise exception 'แก้ได้เฉพาะคิวที่ยังไม่ลงสนาม';
  end if;
  if jsonb_typeof(slot_assignments) <> 'array' or jsonb_array_length(slot_assignments) > 4 then
    raise exception 'ข้อมูลช่องผู้เล่นไม่ถูกต้อง';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(slot_assignments) as slot(member_id uuid, team text, position integer)
    where member_id is null or team not in ('A', 'B') or position not between 1 and 2
  ) or (
    select count(*) from jsonb_to_recordset(slot_assignments) as slot(member_id uuid, team text, position integer)
  ) <> (
    select count(distinct member_id) from jsonb_to_recordset(slot_assignments) as slot(member_id uuid, team text, position integer)
  ) or (
    select count(*) from jsonb_to_recordset(slot_assignments) as slot(member_id uuid, team text, position integer)
  ) <> (
    select count(distinct (team, position)) from jsonb_to_recordset(slot_assignments) as slot(member_id uuid, team text, position integer)
  ) then
    raise exception 'ผู้เล่นหรือช่องทีมซ้ำกัน';
  end if;

  select coalesce(array_agg(member_id order by team, position), '{}'::uuid[])
  into previous_member_ids
  from public.queue_match_players
  where match_id = target_match_id;
  select coalesce(array_agg(member_id order by team, position), '{}'::uuid[])
  into next_member_ids
  from jsonb_to_recordset(slot_assignments) as slot(member_id uuid, team text, position integer);
  select coalesce(array_agg(member_id order by team, position), '{}'::uuid[])
  into displaced_member_ids
  from public.queue_match_players
  where match_id = target_match_id
    and not (member_id = any(next_member_ids));

  if exists (
    select 1 from unnest(next_member_ids) member_id
    where not exists (
      select 1 from public.event_queue_players queue_player
      where queue_player.event_id = target_match.event_id
        and queue_player.member_id = member_id
        and queue_player.status in ('waiting', 'playing', 'reserved')
    )
  ) then raise exception 'มีผู้เล่นบางคนไม่พร้อมเข้าคิว'; end if;
  if exists (
    select 1 from unnest(next_member_ids) member_id
    where not exists (
      select 1 from public.signups signup
      where signup.event_id = target_match.event_id
        and signup.member_id = member_id
        and signup.status = 'coming'
        and signup.skill_level_snapshot is not null
    )
  ) then raise exception 'มีผู้เล่นบางคนยังไม่ได้กำหนดระดับมือ'; end if;
  if exists (
    select player.member_id
    from public.queue_match_players player
    join public.queue_matches match on match.id = player.match_id
    where player.event_id = target_match.event_id
      and player.member_id = any(next_member_ids)
      and player.match_id <> target_match_id
      and match.status in ('draft', 'approved')
    group by player.member_id
    having count(*) > 1
  ) then raise exception 'พบผู้เล่นซ้ำในหลายคิว กรุณาโหลดข้อมูลใหม่'; end if;

  -- Pulling a player from another upcoming queue swaps a displaced player from
  -- this queue back into the exact vacated slot. If this queue had an empty
  -- slot, the source queue simply becomes an incomplete draft.
  for incoming in
    select player.member_id, player.match_id as source_match_id,
      player.team as source_team, player.position as source_position
    from public.queue_match_players player
    join public.queue_matches match on match.id = player.match_id
    where player.event_id = target_match.event_id
      and player.member_id = any(next_member_ids)
      and player.match_id <> target_match_id
      and match.status in ('draft', 'approved')
    order by match.queue_position, player.team, player.position
  loop
    replacement_member_id := displaced_member_ids[displaced_index];
    delete from public.queue_match_players
    where match_id = incoming.source_match_id and member_id = incoming.member_id;

    if replacement_member_id is not null then
      select skill_level_snapshot into replacement_level
      from public.signups
      where event_id = target_match.event_id and member_id = replacement_member_id;
      insert into public.queue_match_players (
        club_id, event_id, match_id, member_id, team, position,
        skill_level_snapshot, playable_skill_levels_snapshot
      ) values (
        target_match.club_id, target_match.event_id, incoming.source_match_id,
        replacement_member_id, incoming.source_team, incoming.source_position,
        replacement_level,
        (select playable_skill_levels_snapshot from public.signups where event_id = target_match.event_id and member_id = replacement_member_id)
      );
      displaced_index := displaced_index + 1;
    end if;
    update public.queue_matches
    set status = 'draft', manual_override = true
    where id = incoming.source_match_id;
  end loop;

  delete from public.queue_match_players where match_id = target_match_id;
  for assignment in
    select * from jsonb_to_recordset(slot_assignments) as slot(member_id uuid, team text, position integer)
  loop
    insert into public.queue_match_players (
      club_id, event_id, match_id, member_id, team, position,
      skill_level_snapshot, playable_skill_levels_snapshot
    ) values (
      target_match.club_id, target_match.event_id, target_match.id,
      assignment.member_id, assignment.team, assignment.position,
      (select skill_level_snapshot from public.signups where event_id = target_match.event_id and member_id = assignment.member_id),
      (select playable_skill_levels_snapshot from public.signups where event_id = target_match.event_id and member_id = assignment.member_id)
    );
  end loop;
  update public.queue_matches
  set status = 'draft', manual_override = true
  where id = target_match_id;

  -- Derive reservation state from the resulting queue rows instead of trying
  -- to update each swapped player piecemeal.
  update public.event_queue_players queue_player
  set status = case
    when exists (
      select 1 from public.queue_match_players player
      join public.queue_matches match on match.id = player.match_id
      where player.event_id = target_match.event_id
        and player.member_id = queue_player.member_id
        and match.status = 'playing'
    ) then 'playing'
    when exists (
      select 1 from public.queue_match_players player
      join public.queue_matches match on match.id = player.match_id
      where player.event_id = target_match.event_id
        and player.member_id = queue_player.member_id
        and match.status = 'approved'
    ) then 'reserved'
    else 'waiting'
  end
  where queue_player.event_id = target_match.event_id
    and queue_player.status <> 'left';

  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (
    target_match.club_id, target_match.event_id, auth.uid(), 'แก้รายชื่อหรือสลับผู้เล่นข้ามคิว',
    jsonb_build_object('match_id', target_match_id, 'player_count', coalesce(array_length(next_member_ids, 1), 0))
  );
end;
$$;

create or replace function public.return_playing_queue_to_head(target_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.queue_matches%rowtype;
  selected_ids uuid[];
begin
  select * into target_match
  from public.queue_matches
  where id = target_match_id
  for update;
  if target_match.id is null or not public.is_club_operator(target_match.club_id) then
    raise exception 'ไม่มีสิทธิ์นำเกมออกจากสนาม';
  end if;
  perform pg_advisory_xact_lock(hashtext(target_match.event_id::text));
  if target_match.status <> 'playing' then
    raise exception 'เกมนี้ไม่ได้อยู่ในสนามแล้ว กรุณาโหลดข้อมูลใหม่';
  end if;
  if (select count(*) from public.queue_matches where event_id = target_match.event_id and status in ('draft', 'approved')) >= 4 then
    raise exception 'มีคิวล่วงหน้าเต็ม 4 คิว กรุณายกเลิกคิวท้ายก่อนนำเกมกลับ';
  end if;

  select array_agg(member_id) into selected_ids
  from public.queue_match_players
  where match_id = target_match_id;
  if coalesce(array_length(selected_ids, 1), 0) <> 4 then
    raise exception 'ผู้เล่นในสนามไม่ครบ 4 คน ไม่สามารถนำกลับเป็นคิวได้';
  end if;

  update public.queue_matches
  set queue_position = queue_position + 1000000
  where event_id = target_match.event_id and status in ('draft', 'approved');
  update public.queue_matches
  set queue_position = queue_position - 999999
  where event_id = target_match.event_id and status in ('draft', 'approved');
  update public.queue_matches
  set status = 'approved', court_id = null, queue_position = 1,
      started_at = null, ended_at = null
  where id = target_match_id;
  update public.event_queue_players
  set status = 'reserved'
  where event_id = target_match.event_id and member_id = any(selected_ids);

  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (
    target_match.club_id, target_match.event_id, auth.uid(), 'นำเกมออกจากสนามกลับเป็นคิว 1',
    jsonb_build_object('match_id', target_match_id, 'court_id', target_match.court_id)
  );
end;
$$;

revoke all on function public.create_queue_draft(uuid, uuid[], uuid[]) from public, anon;
revoke all on function public.create_manual_queue_draft(uuid) from public, anon;
revoke all on function public.create_queue_drafts_batch(uuid, jsonb) from public, anon;
revoke all on function public.update_manual_queue_draft_lineup(uuid, jsonb) from public, anon;
revoke all on function public.return_playing_queue_to_head(uuid) from public, anon;

grant execute on function public.create_queue_draft(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.create_manual_queue_draft(uuid) to authenticated;
grant execute on function public.create_queue_drafts_batch(uuid, jsonb) to authenticated;
grant execute on function public.update_manual_queue_draft_lineup(uuid, jsonb) to authenticated;
grant execute on function public.return_playing_queue_to_head(uuid) to authenticated;
