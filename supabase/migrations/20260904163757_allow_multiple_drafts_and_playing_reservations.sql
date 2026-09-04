-- Draft queues are planning records. They no longer remove players from the
-- visible waiting pool, and operators may prepare more than one draft at once.
-- A player is reserved only after approval. A currently-playing player may be
-- planned/approved for a future queue, but cannot start that queue until their
-- current game has finished.

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
  if (select count(*) from public.queue_matches where event_id = target_event_id and status in ('draft', 'approved'))
     >= (select count(*) from public.event_courts where event_id = target_event_id) then
    raise exception 'จำนวนคิวล่วงหน้าครบตามจำนวนคอร์ทแล้ว';
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
  if (select count(*) from public.queue_matches where event_id = target_event_id and status in ('draft', 'approved'))
     >= (select count(*) from public.event_courts where event_id = target_event_id) then
    raise exception 'จำนวนคิวล่วงหน้าครบตามจำนวนคอร์ทแล้ว';
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

create or replace function public.update_queue_draft_lineup(
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
  next_member_ids uuid[];
  previous_member_ids uuid[];
  selected_level text;
begin
  select * into target_match from public.queue_matches where id = target_match_id for update;
  if target_match.id is null or not public.is_club_operator(target_match.club_id) then raise exception 'ไม่มีสิทธิ์แก้คิว'; end if;
  perform pg_advisory_xact_lock(hashtext(target_match.event_id::text));
  if target_match.status not in ('draft', 'approved') then raise exception 'แก้ได้เฉพาะคิวที่ยังไม่ลงสนาม'; end if;
  if jsonb_typeof(slot_assignments) <> 'array' or jsonb_array_length(slot_assignments) > 4 then
    raise exception 'ข้อมูลช่องผู้เล่นไม่ถูกต้อง';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(slot_assignments) as slot(member_id uuid, team text, position integer)
    where team not in ('A', 'B') or position not between 1 and 2
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

  select coalesce(array_agg(member_id), '{}'::uuid[]) into previous_member_ids
  from public.queue_match_players where match_id = target_match_id;
  select coalesce(array_agg(member_id), '{}'::uuid[]) into next_member_ids
  from jsonb_to_recordset(slot_assignments) as slot(member_id uuid, team text, position integer);

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
    select 1
    from public.queue_match_players player
    join public.queue_matches match on match.id = player.match_id
    where player.event_id = target_match.event_id
      and player.member_id = any(next_member_ids)
      and player.match_id <> target_match_id
      and match.status in ('draft', 'approved')
  ) then raise exception 'มีผู้เล่นบางคนอยู่ในคิวล่วงหน้าอื่นแล้ว'; end if;
  if exists (
    select 1 from unnest(next_member_ids) member_id
    where not exists (
      select 1 from public.signups signup
      where signup.event_id = target_match.event_id and signup.member_id = member_id
        and signup.status = 'coming' and signup.skill_level_snapshot is not null
    )
  ) then raise exception 'มีผู้เล่นบางคนยังไม่ได้กำหนดระดับมือ'; end if;

  -- Editing an approved queue turns it back into a draft. Release only players
  -- that are not actively playing; draft membership itself does not reserve them.
  update public.event_queue_players queue_player
  set status = 'waiting'
  where queue_player.event_id = target_match.event_id
    and queue_player.member_id = any(previous_member_ids)
    and queue_player.status = 'reserved';

  delete from public.queue_match_players where match_id = target_match_id;
  for assignment in
    select * from jsonb_to_recordset(slot_assignments) as slot(member_id uuid, team text, position integer)
  loop
    select skill_level_snapshot into selected_level
    from public.signups
    where event_id = target_match.event_id and member_id = assignment.member_id;
    insert into public.queue_match_players (
      club_id, event_id, match_id, member_id, team, position,
      skill_level_snapshot, playable_skill_levels_snapshot
    ) values (
      target_match.club_id, target_match.event_id, target_match.id,
      assignment.member_id, assignment.team, assignment.position, selected_level,
      (select playable_skill_levels_snapshot from public.signups where event_id = target_match.event_id and member_id = assignment.member_id)
    );
  end loop;
  update public.queue_matches set status = 'draft' where id = target_match_id;
  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (target_match.club_id, target_match.event_id, auth.uid(), 'แก้รายชื่อหรือทีมในคิว',
    jsonb_build_object('match_id', target_match_id, 'player_count', coalesce(array_length(next_member_ids, 1), 0)));
end;
$$;

create or replace function public.approve_queue_draft(target_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.queue_matches%rowtype;
  selected_ids uuid[];
  compatible boolean;
begin
  select * into target_match from public.queue_matches where id = target_match_id for update;
  if target_match.id is null or not public.is_club_operator(target_match.club_id) then raise exception 'ไม่มีสิทธิ์อนุมัติคิว'; end if;
  perform pg_advisory_xact_lock(hashtext(target_match.event_id::text));
  if target_match.status <> 'draft' then raise exception 'คิวนี้ไม่ได้อยู่ระหว่างแก้ไข'; end if;
  select array_agg(member_id) into selected_ids from public.queue_match_players where match_id = target_match_id;
  if coalesce(array_length(selected_ids, 1), 0) <> 4 then raise exception 'กรุณาใส่ผู้เล่นให้ครบ 4 คน'; end if;
  if (select count(*) from public.queue_match_players where match_id = target_match_id and team = 'A') <> 2
     or (select count(*) from public.queue_match_players where match_id = target_match_id and team = 'B') <> 2 then
    raise exception 'แต่ละทีมต้องมี 2 คน';
  end if;
  if (
    select count(*) from public.event_queue_players
    where event_id = target_match.event_id
      and member_id = any(selected_ids)
      and status in ('waiting', 'playing', 'reserved')
  ) <> 4 then raise exception 'มีผู้เล่นบางคนไม่พร้อมแล้ว กรุณาจัดคิวใหม่'; end if;
  if exists (
    select 1
    from public.queue_match_players player
    join public.queue_matches match on match.id = player.match_id
    where player.event_id = target_match.event_id
      and player.member_id = any(selected_ids)
      and player.match_id <> target_match_id
      and match.status in ('draft', 'approved')
  ) then raise exception 'มีผู้เล่นบางคนอยู่ในคิวล่วงหน้าอื่นแล้ว'; end if;

  compatible := public.queue_lineup_is_compatible(target_match.event_id, selected_ids);
  if not compatible and not target_match.manual_override then
    raise exception 'ผู้เล่นชุดนี้ไม่ตรงกับเงื่อนไขระดับมือ';
  end if;

  update public.event_queue_players
  set status = 'reserved'
  where event_id = target_match.event_id
    and member_id = any(selected_ids)
    and status = 'waiting';
  update public.queue_matches set status = 'approved' where id = target_match_id;
  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (
    target_match.club_id, target_match.event_id, auth.uid(), 'อนุมัติคิวล่วงหน้า',
    jsonb_build_object(
      'match_id', target_match_id,
      'queue_position', target_match.queue_position,
      'manual_override', target_match.manual_override,
      'skill_warning', not compatible
    )
  );
end;
$$;

create or replace function public.cancel_upcoming_queue(target_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.queue_matches%rowtype;
  selected_ids uuid[];
begin
  select * into target_match from public.queue_matches where id = target_match_id for update;
  if target_match.id is null or not public.is_club_operator(target_match.club_id) then raise exception 'ไม่มีสิทธิ์ยกเลิกคิว'; end if;
  perform pg_advisory_xact_lock(hashtext(target_match.event_id::text));
  if target_match.status not in ('draft', 'approved') then raise exception 'ยกเลิกได้เฉพาะคิวที่ยังไม่ลงสนาม'; end if;
  select coalesce(array_agg(member_id), '{}'::uuid[]) into selected_ids
  from public.queue_match_players where match_id = target_match_id;
  update public.queue_matches
  set status = 'cancelled', queue_position = null, ended_at = now()
  where id = target_match_id;
  update public.event_queue_players queue_player
  set status = 'waiting'
  where queue_player.event_id = target_match.event_id
    and queue_player.member_id = any(selected_ids)
    and queue_player.status = 'reserved'
    and not exists (
      select 1
      from public.queue_match_players player
      join public.queue_matches match on match.id = player.match_id
      where player.event_id = target_match.event_id
        and player.member_id = queue_player.member_id
        and match.status = 'approved'
    );
  perform public.compact_upcoming_queue(target_match.event_id);
  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (target_match.club_id, target_match.event_id, auth.uid(), 'ยกเลิกคิวล่วงหน้า', jsonb_build_object('match_id', target_match_id));
end;
$$;

create or replace function public.start_next_queue_on_court(
  target_event_id uuid,
  target_court_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  target_match public.queue_matches%rowtype;
  selected_ids uuid[];
  compatible boolean;
begin
  select club_id into target_club_id from public.events where id = target_event_id and status = 'open';
  if target_club_id is null or not public.is_club_operator(target_club_id) then raise exception 'ไม่มีสิทธิ์เริ่มเกม'; end if;
  if not exists (select 1 from public.event_courts where id = target_court_id and event_id = target_event_id) then raise exception 'ไม่พบคอร์ทนี้'; end if;
  perform pg_advisory_xact_lock(hashtext(target_event_id::text));
  if exists (select 1 from public.queue_matches where court_id = target_court_id and status = 'playing') then raise exception 'คอร์ทนี้กำลังใช้งาน'; end if;

  select * into target_match from public.queue_matches
  where event_id = target_event_id and status in ('draft', 'approved')
  order by queue_position, proposed_at
  for update skip locked limit 1;
  if target_match.id is null then raise exception 'ยังไม่มีคิวล่วงหน้า'; end if;
  if target_match.status <> 'approved' then raise exception 'กรุณาตรวจและอนุมัติคิว 1 ก่อนนำลงสนาม'; end if;

  select array_agg(member_id) into selected_ids from public.queue_match_players where match_id = target_match.id;
  if coalesce(array_length(selected_ids, 1), 0) <> 4 then raise exception 'ผู้เล่นในคิว 1 ไม่ครบ 4 คน'; end if;
  if exists (
    select 1
    from public.queue_match_players player
    join public.queue_matches match on match.id = player.match_id
    where player.member_id = any(selected_ids)
      and player.match_id <> target_match.id
      and match.status = 'playing'
  ) then raise exception 'ผู้เล่นในคิว 1 ยังเล่นอยู่ในสนาม กรุณารอให้จบเกมก่อน'; end if;
  if (
    select count(*) from public.event_queue_players
    where event_id = target_event_id and member_id = any(selected_ids) and status = 'reserved'
  ) <> 4 then raise exception 'ผู้เล่นในคิว 1 ยังไม่พร้อม กรุณารอเกมปัจจุบันจบหรือแก้คิวก่อน'; end if;

  compatible := public.queue_lineup_is_compatible(target_event_id, selected_ids);
  if not compatible and not target_match.manual_override then
    raise exception 'ผู้เล่นในคิว 1 ไม่ตรงกับเงื่อนไขระดับมือแล้ว กรุณาแก้คิวก่อน';
  end if;

  update public.queue_matches
  set status = 'playing', court_id = target_court_id, queue_position = null, started_at = now()
  where id = target_match.id;
  update public.event_queue_players set status = 'playing'
  where event_id = target_event_id and member_id = any(selected_ids);
  perform public.compact_upcoming_queue(target_event_id);
  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (
    target_club_id, target_event_id, auth.uid(), 'นำคิว 1 ลงสนาม',
    jsonb_build_object(
      'match_id', target_match.id,
      'court_id', target_court_id,
      'manual_override', target_match.manual_override,
      'skill_warning', not compatible
    )
  );
  return target_match.id;
end;
$$;

create or replace function public.finish_queue_match(target_match_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.queue_matches%rowtype;
  played_minutes integer;
  selected_ids uuid[];
begin
  select * into target_match from public.queue_matches where id = target_match_id for update;
  if target_match.id is null or not public.is_club_operator(target_match.club_id) then raise exception 'ไม่มีสิทธิ์จบเกม'; end if;
  perform pg_advisory_xact_lock(hashtext(target_match.event_id::text));
  if target_match.status <> 'playing' or target_match.started_at is null then raise exception 'เกมนี้ยังไม่ได้เริ่ม'; end if;
  played_minutes := greatest(1, floor(extract(epoch from (now() - target_match.started_at)) / 60)::integer);
  select array_agg(member_id) into selected_ids from public.queue_match_players where match_id = target_match_id;
  update public.queue_matches
  set status = 'completed', court_id = target_match.court_id, queue_position = null, ended_at = now()
  where id = target_match_id;
  update public.event_queue_players queue_player
  set status = case when exists (
        select 1
        from public.queue_match_players future_player
        join public.queue_matches future_match on future_match.id = future_player.match_id
        where future_player.event_id = target_match.event_id
          and future_player.member_id = queue_player.member_id
          and future_match.status = 'approved'
      ) then 'reserved' else 'waiting' end,
      games_played = games_played + 1,
      minutes_played = minutes_played + played_minutes,
      queued_at = now()
  where queue_player.event_id = target_match.event_id and queue_player.member_id = any(selected_ids);
  update public.signups signup
  set skill_level_snapshot = member.skill_level,
      playable_skill_levels_snapshot = member.playable_skill_levels,
      allow_lower_level_snapshot = member.allow_lower_level,
      allow_higher_level_snapshot = member.allow_higher_level
  from public.club_members member
  where signup.event_id = target_match.event_id
    and signup.member_id = member.id
    and signup.member_id = any(selected_ids);
  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (target_match.club_id, target_match.event_id, auth.uid(), 'จบเกมในคอร์ท',
    jsonb_build_object('match_id', target_match_id, 'minutes', played_minutes));
  return played_minutes;
end;
$$;

revoke all on function public.create_queue_draft(uuid, uuid[], uuid[]) from public;
revoke all on function public.create_manual_queue_draft(uuid) from public;
revoke all on function public.update_queue_draft_lineup(uuid, jsonb) from public;
revoke all on function public.approve_queue_draft(uuid) from public;
revoke all on function public.cancel_upcoming_queue(uuid) from public;
revoke all on function public.start_next_queue_on_court(uuid, uuid) from public;
revoke all on function public.finish_queue_match(uuid) from public;
revoke all on function public.create_queue_draft(uuid, uuid[], uuid[]) from anon;
revoke all on function public.create_manual_queue_draft(uuid) from anon;
revoke all on function public.update_queue_draft_lineup(uuid, jsonb) from anon;
revoke all on function public.approve_queue_draft(uuid) from anon;
revoke all on function public.cancel_upcoming_queue(uuid) from anon;
revoke all on function public.start_next_queue_on_court(uuid, uuid) from anon;
revoke all on function public.finish_queue_match(uuid) from anon;
revoke all on function public.compact_upcoming_queue(uuid) from anon;
revoke all on function public.compact_upcoming_queue(uuid) from authenticated;

grant execute on function public.create_queue_draft(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.create_manual_queue_draft(uuid) to authenticated;
grant execute on function public.update_queue_draft_lineup(uuid, jsonb) to authenticated;
grant execute on function public.approve_queue_draft(uuid) to authenticated;
grant execute on function public.cancel_upcoming_queue(uuid) to authenticated;
grant execute on function public.start_next_queue_on_court(uuid, uuid) to authenticated;
grant execute on function public.finish_queue_match(uuid) to authenticated;
