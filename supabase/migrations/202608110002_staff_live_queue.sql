-- Staff access, sanitized operational reads, and court-independent upcoming queues.

create or replace function public.is_club_operator(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.club_members cm
    where cm.club_id = target_club_id
      and cm.profile_id = (select auth.uid())
      and cm.role in ('admin', 'staff')
      and cm.active
  );
$$;

revoke all on function public.is_club_operator(uuid) from public;
grant execute on function public.is_club_operator(uuid) to authenticated;

-- Queue rows created before this migration were already approved for a court.
drop index if exists public.queue_matches_active_court_idx;
alter table public.queue_matches drop constraint if exists queue_matches_status_check;
alter table public.event_queue_players drop constraint if exists event_queue_players_status_check;
alter table public.queue_matches alter column court_id drop not null;
alter table public.queue_matches add column if not exists queue_position integer;
alter table public.queue_match_players
  add column if not exists playable_skill_levels_snapshot text[] not null default '{}'::text[];

update public.queue_match_players player
set playable_skill_levels_snapshot = signup.playable_skill_levels_snapshot
from public.signups signup
where signup.event_id = player.event_id
  and signup.member_id = player.member_id
  and cardinality(player.playable_skill_levels_snapshot) = 0;

update public.queue_matches set status = 'approved' where status = 'proposed';
update public.event_queue_players set status = 'reserved' where status = 'proposed';

with ranked as (
  select id, row_number() over (partition by event_id order by sequence, proposed_at, id)::integer as position
  from public.queue_matches
  where status = 'approved'
)
update public.queue_matches match
set queue_position = ranked.position,
    court_id = null
from ranked
where match.id = ranked.id;

alter table public.queue_matches
  add constraint queue_matches_status_check
    check (status in ('draft', 'approved', 'playing', 'completed', 'cancelled')),
  add constraint queue_matches_queue_position_check
    check (
      (status in ('draft', 'approved') and queue_position is not null and queue_position > 0 and court_id is null)
      or (status not in ('draft', 'approved') and queue_position is null)
    );

alter table public.event_queue_players
  add constraint event_queue_players_status_check
    check (status in ('waiting', 'reserved', 'playing', 'left'));

create unique index queue_matches_playing_court_idx
  on public.queue_matches (court_id)
  where status = 'playing';
create unique index queue_matches_upcoming_position_idx
  on public.queue_matches (event_id, queue_position)
  where status in ('draft', 'approved');

drop policy if exists "queue_matches_admin_all" on public.queue_matches;
drop policy if exists "queue_match_players_admin_all" on public.queue_match_players;
drop policy if exists "event_queue_players_admin_all" on public.event_queue_players;

create policy "queue_matches_operator_select" on public.queue_matches
for select to authenticated using ((select public.is_club_operator(club_id)));
create policy "queue_matches_admin_write" on public.queue_matches
for all to authenticated
using ((select public.is_club_admin(club_id)))
with check ((select public.is_club_admin(club_id)));
create policy "queue_match_players_operator_select" on public.queue_match_players
for select to authenticated using ((select public.is_club_operator(club_id)));
create policy "queue_match_players_admin_write" on public.queue_match_players
for all to authenticated
using ((select public.is_club_admin(club_id)))
with check ((select public.is_club_admin(club_id)));
create policy "event_queue_players_operator_select" on public.event_queue_players
for select to authenticated using ((select public.is_club_operator(club_id)));
create policy "event_queue_players_admin_write" on public.event_queue_players
for all to authenticated
using ((select public.is_club_admin(club_id)))
with check ((select public.is_club_admin(club_id)));

-- A staff session must not be able to bypass the UI and read financial columns.
drop policy if exists "clubs_select_members" on public.clubs;
create policy "clubs_select_admins" on public.clubs
for select to authenticated using ((select public.is_club_admin(id)));

drop policy if exists "club_members_select_members" on public.club_members;
create policy "club_members_select_admin_or_self" on public.club_members
for select to authenticated
using ((select public.is_club_admin(club_id)) or profile_id = (select auth.uid()));

drop policy if exists "events_select_members" on public.events;
create policy "events_select_admins" on public.events
for select to authenticated using ((select public.is_club_admin(club_id)));

drop policy if exists "attendance_select_members" on public.attendance;
create policy "attendance_select_admins" on public.attendance
for select to authenticated using ((select public.is_club_admin(club_id)));

drop policy if exists "expenses_select_members" on public.expenses;
create policy "expenses_select_admins" on public.expenses
for select to authenticated using ((select public.is_club_admin(club_id)));

drop policy if exists "event_courts_select_members" on public.event_courts;
create policy "event_courts_select_operators" on public.event_courts
for select to authenticated using ((select public.is_club_operator(club_id)));

drop policy if exists "signups_select_members" on public.signups;
create policy "signups_select_operators" on public.signups
for select to authenticated using ((select public.is_club_operator(club_id)));

create or replace function public.skill_level_rank(level_name text)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case level_name
    when 'Rookie-' then 0
    when 'Rookie' then 1
    when 'BG' then 2
    when 'N' then 3
    when 'S' then 4
    when 'P' then 5
    else -1
  end;
$$;

create or replace function public.queue_lineup_is_compatible(
  target_event_id uuid,
  selected_member_ids uuid[]
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  anchor record;
  candidate record;
  teammate record;
  lower_level text;
  base_count integer;
  accepted_count integer;
  valid_anchor boolean;
begin
  if coalesce(array_length(selected_member_ids, 1), 0) <> 4
     or (select count(distinct value) from unnest(selected_member_ids) value) <> 4 then
    return false;
  end if;
  if (
    select count(*)
    from public.signups signup
    where signup.event_id = target_event_id
      and signup.member_id = any(selected_member_ids)
      and signup.status = 'coming'
      and public.skill_level_rank(signup.skill_level_snapshot) >= 0
  ) <> 4 then
    return false;
  end if;

  for anchor in
    select signup.member_id, signup.skill_level_snapshot as skill_level
    from public.signups signup
    where signup.event_id = target_event_id and signup.member_id = any(selected_member_ids)
  loop
    valid_anchor := true;

    -- Stronger guests must accept every weaker level in the lineup.
    for candidate in
      select signup.member_id, signup.skill_level_snapshot as skill_level,
             signup.playable_skill_levels_snapshot as playable_levels
      from public.signups signup
      where signup.event_id = target_event_id
        and signup.member_id = any(selected_member_ids)
        and public.skill_level_rank(signup.skill_level_snapshot) > public.skill_level_rank(anchor.skill_level)
    loop
      for teammate in
        select signup.skill_level_snapshot as skill_level
        from public.signups signup
        where signup.event_id = target_event_id
          and signup.member_id = any(selected_member_ids)
          and public.skill_level_rank(signup.skill_level_snapshot) < public.skill_level_rank(candidate.skill_level)
      loop
        if not (teammate.skill_level = any(candidate.playable_levels)) then
          valid_anchor := false;
          exit;
        end if;
      end loop;
      exit when not valid_anchor;
    end loop;
    if not valid_anchor then continue; end if;

    -- Weaker guests must accept every stronger level in the lineup.
    for candidate in
      select signup.member_id, signup.skill_level_snapshot as skill_level,
             signup.playable_skill_levels_snapshot as playable_levels
      from public.signups signup
      where signup.event_id = target_event_id
        and signup.member_id = any(selected_member_ids)
        and public.skill_level_rank(signup.skill_level_snapshot) < public.skill_level_rank(anchor.skill_level)
    loop
      for teammate in
        select signup.skill_level_snapshot as skill_level
        from public.signups signup
        where signup.event_id = target_event_id
          and signup.member_id = any(selected_member_ids)
          and public.skill_level_rank(signup.skill_level_snapshot) > public.skill_level_rank(candidate.skill_level)
      loop
        if not (teammate.skill_level = any(candidate.playable_levels)) then
          valid_anchor := false;
          exit;
        end if;
      end loop;
      exit when not valid_anchor;
    end loop;
    if not valid_anchor then continue; end if;

    select count(*) into base_count
    from public.signups signup
    where signup.event_id = target_event_id
      and signup.member_id = any(selected_member_ids)
      and signup.skill_level_snapshot = anchor.skill_level;

    for lower_level in
      select distinct signup.skill_level_snapshot
      from public.signups signup
      where signup.event_id = target_event_id
        and signup.member_id = any(selected_member_ids)
        and public.skill_level_rank(signup.skill_level_snapshot) < public.skill_level_rank(anchor.skill_level)
    loop
      select count(*) into accepted_count
      from public.signups signup
      where signup.event_id = target_event_id
        and signup.member_id = any(selected_member_ids)
        and signup.skill_level_snapshot = anchor.skill_level
        and lower_level = any(signup.playable_skill_levels_snapshot);
      if accepted_count < ceil(base_count * 2.0 / 3.0) then
        valid_anchor := false;
        exit;
      end if;
    end loop;

    if valid_anchor then return true; end if;
  end loop;
  return false;
end;
$$;

create or replace function public.compact_upcoming_queue(target_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data record;
  next_position integer := 1;
begin
  -- Large temporary values avoid partial-unique-index collisions while
  -- keeping the queue-position check valid.
  update public.queue_matches
  set queue_position = queue_position + 1000000
  where event_id = target_event_id and status in ('draft', 'approved');
  for row_data in
    select id from public.queue_matches
    where event_id = target_event_id and status in ('draft', 'approved')
    order by queue_position, proposed_at, id
  loop
    update public.queue_matches set queue_position = next_position where id = row_data.id;
    next_position := next_position + 1;
  end loop;
end;
$$;

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
  select club_id into target_club_id from public.events where id = target_event_id and status = 'open';
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
  if exists (select 1 from public.queue_matches where event_id = target_event_id and status = 'draft') then
    raise exception 'กรุณาอนุมัติหรือยกเลิกคิวร่างเดิมก่อน';
  end if;
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
    raise exception 'มีผู้เล่นบางคนไม่พร้อมหรือถูกจัดไว้ในคิวอื่นแล้ว';
  end if;

  select coalesce(max(sequence), 0) + 1 into next_sequence
  from public.queue_matches where event_id = target_event_id;
  select coalesce(max(queue_position), 0) + 1 into next_position
  from public.queue_matches where event_id = target_event_id and status in ('draft', 'approved');

  insert into public.queue_matches (
    club_id, event_id, court_id, sequence, queue_position, status, created_by
  ) values (
    target_club_id, target_event_id, null, next_sequence, next_position, 'draft', auth.uid()
  ) returning id into new_match_id;

  foreach selected_member_id in array selected_member_ids loop
    select skill_level_snapshot into selected_level from public.signups
    where event_id = target_event_id and member_id = selected_member_id;
    selected_team := case when selected_member_id = any(team_a_member_ids) then 'A' else 'B' end;
    select count(*) + 1 into selected_position from public.queue_match_players
    where match_id = new_match_id and team = selected_team;
    insert into public.queue_match_players (
      club_id, event_id, match_id, member_id, team, position, skill_level_snapshot, playable_skill_levels_snapshot
    ) values (
      target_club_id, target_event_id, new_match_id, selected_member_id,
      selected_team, selected_position, selected_level,
      (select playable_skill_levels_snapshot from public.signups where event_id = target_event_id and member_id = selected_member_id)
    );
  end loop;
  update public.event_queue_players set status = 'reserved'
  where event_id = target_event_id and member_id = any(selected_member_ids);
  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (target_club_id, target_event_id, auth.uid(), 'สร้างคิวร่าง',
    jsonb_build_object('match_id', new_match_id, 'queue_position', next_position));
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
  if target_match.status not in ('draft', 'approved') then raise exception 'แก้ได้เฉพาะคิวที่ยังไม่ลงสนาม'; end if;
  if target_match.status = 'approved' and exists (
    select 1 from public.queue_matches where event_id = target_match.event_id and status = 'draft' and id <> target_match.id
  ) then raise exception 'กรุณาจัดการคิวร่างเดิมก่อนแก้คิวที่อนุมัติแล้ว'; end if;
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
    where not (member_id = any(previous_member_ids))
      and not exists (
        select 1 from public.event_queue_players queue_player
        where queue_player.event_id = target_match.event_id
          and queue_player.member_id = member_id
          and queue_player.status = 'waiting'
      )
  ) then raise exception 'มีผู้เล่นใหม่บางคนไม่พร้อมเข้าคิว'; end if;
  if exists (
    select 1 from unnest(next_member_ids) member_id
    where not exists (
      select 1 from public.signups signup
      where signup.event_id = target_match.event_id and signup.member_id = member_id
        and signup.status = 'coming' and signup.skill_level_snapshot is not null
    )
  ) then raise exception 'มีผู้เล่นบางคนยังไม่ได้กำหนดระดับมือ'; end if;

  update public.event_queue_players set status = 'waiting'
  where event_id = target_match.event_id and member_id = any(previous_member_ids);
  delete from public.queue_match_players where match_id = target_match_id;
  for assignment in
    select * from jsonb_to_recordset(slot_assignments) as slot(member_id uuid, team text, position integer)
  loop
    select skill_level_snapshot into selected_level from public.signups
    where event_id = target_match.event_id and member_id = assignment.member_id;
    insert into public.queue_match_players (
      club_id, event_id, match_id, member_id, team, position, skill_level_snapshot, playable_skill_levels_snapshot
    ) values (
      target_match.club_id, target_match.event_id, target_match.id,
      assignment.member_id, assignment.team, assignment.position, selected_level,
      (select playable_skill_levels_snapshot from public.signups where event_id = target_match.event_id and member_id = assignment.member_id)
    );
  end loop;
  update public.event_queue_players set status = 'reserved'
  where event_id = target_match.event_id and member_id = any(next_member_ids);
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
begin
  select * into target_match from public.queue_matches where id = target_match_id for update;
  if target_match.id is null or not public.is_club_operator(target_match.club_id) then raise exception 'ไม่มีสิทธิ์อนุมัติคิว'; end if;
  if target_match.status <> 'draft' then raise exception 'คิวนี้ไม่ได้อยู่ระหว่างแก้ไข'; end if;
  select array_agg(member_id) into selected_ids from public.queue_match_players where match_id = target_match_id;
  if coalesce(array_length(selected_ids, 1), 0) <> 4 then raise exception 'กรุณาใส่ผู้เล่นให้ครบ 4 คน'; end if;
  if (select count(*) from public.queue_match_players where match_id = target_match_id and team = 'A') <> 2
     or (select count(*) from public.queue_match_players where match_id = target_match_id and team = 'B') <> 2 then
    raise exception 'แต่ละทีมต้องมี 2 คน';
  end if;
  if (
    select count(*) from public.event_queue_players
    where event_id = target_match.event_id and member_id = any(selected_ids) and status = 'reserved'
  ) <> 4 then raise exception 'มีผู้เล่นบางคนไม่พร้อมแล้ว กรุณาจัดคิวใหม่'; end if;
  if not public.queue_lineup_is_compatible(target_match.event_id, selected_ids) then
    raise exception 'ผู้เล่นชุดนี้ไม่ตรงกับเงื่อนไขระดับมือ';
  end if;
  update public.queue_matches set status = 'approved' where id = target_match_id;
  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (target_match.club_id, target_match.event_id, auth.uid(), 'อนุมัติคิวล่วงหน้า',
    jsonb_build_object('match_id', target_match_id, 'queue_position', target_match.queue_position));
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
  if target_match.status not in ('draft', 'approved') then raise exception 'ยกเลิกได้เฉพาะคิวที่ยังไม่ลงสนาม'; end if;
  select coalesce(array_agg(member_id), '{}'::uuid[]) into selected_ids from public.queue_match_players where match_id = target_match_id;
  update public.event_queue_players set status = 'waiting'
  where event_id = target_match.event_id and member_id = any(selected_ids) and status = 'reserved';
  update public.signups signup
  set skill_level_snapshot = member.skill_level,
      playable_skill_levels_snapshot = member.playable_skill_levels,
      allow_lower_level_snapshot = member.allow_lower_level,
      allow_higher_level_snapshot = member.allow_higher_level
  from public.club_members member
  where signup.event_id = target_match.event_id
    and signup.member_id = member.id
    and signup.member_id = any(selected_ids);
  update public.queue_matches set status = 'cancelled', queue_position = null, ended_at = now() where id = target_match_id;
  perform public.compact_upcoming_queue(target_match.event_id);
  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (target_match.club_id, target_match.event_id, auth.uid(), 'ยกเลิกคิวล่วงหน้า', jsonb_build_object('match_id', target_match_id));
end;
$$;

create or replace function public.move_upcoming_queue(target_match_id uuid, direction integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.queue_matches%rowtype;
  swap_match public.queue_matches%rowtype;
  desired_position integer;
begin
  if direction not in (-1, 1) then raise exception 'ทิศทางไม่ถูกต้อง'; end if;
  select * into target_match from public.queue_matches where id = target_match_id for update;
  if target_match.id is null or not public.is_club_operator(target_match.club_id) then raise exception 'ไม่มีสิทธิ์เลื่อนคิว'; end if;
  if target_match.status <> 'approved' then raise exception 'เลื่อนได้เฉพาะคิวที่อนุมัติแล้ว'; end if;
  desired_position := target_match.queue_position + direction;
  select * into swap_match from public.queue_matches
  where event_id = target_match.event_id and queue_position = desired_position and status = 'approved'
  for update;
  if swap_match.id is null then return; end if;
  update public.queue_matches set queue_position = 1000000 + target_match.queue_position where id = target_match.id;
  update public.queue_matches set queue_position = target_match.queue_position where id = swap_match.id;
  update public.queue_matches set queue_position = desired_position where id = target_match.id;
  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (target_match.club_id, target_match.event_id, auth.uid(), 'เลื่อนลำดับคิว',
    jsonb_build_object('match_id', target_match_id, 'from', target_match.queue_position, 'to', desired_position));
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
begin
  select club_id into target_club_id from public.events where id = target_event_id and status = 'open';
  if target_club_id is null or not public.is_club_operator(target_club_id) then raise exception 'ไม่มีสิทธิ์เริ่มเกม'; end if;
  if not exists (select 1 from public.event_courts where id = target_court_id and event_id = target_event_id) then raise exception 'ไม่พบคอร์ทนี้'; end if;
  perform pg_advisory_xact_lock(hashtext(target_event_id::text));
  if exists (select 1 from public.queue_matches where court_id = target_court_id and status = 'playing') then raise exception 'คอร์ทนี้กำลังใช้งาน'; end if;
  select * into target_match from public.queue_matches
  where event_id = target_event_id and status = 'approved'
  order by queue_position, proposed_at for update skip locked limit 1;
  if target_match.id is null then raise exception 'ยังไม่มีคิวที่อนุมัติแล้ว'; end if;
  select array_agg(member_id) into selected_ids from public.queue_match_players where match_id = target_match.id;
  if coalesce(array_length(selected_ids, 1), 0) <> 4 or (
    select count(*) from public.event_queue_players
    where event_id = target_event_id and member_id = any(selected_ids) and status = 'reserved'
  ) <> 4 then raise exception 'ผู้เล่นในคิว 1 ไม่พร้อม กรุณาแก้คิวก่อน'; end if;
  if not public.queue_lineup_is_compatible(target_event_id, selected_ids) then
    raise exception 'ผู้เล่นในคิว 1 ไม่ตรงกับเงื่อนไขระดับมือแล้ว กรุณาแก้คิวก่อน';
  end if;
  update public.queue_matches
  set status = 'playing', court_id = target_court_id, queue_position = null, started_at = now()
  where id = target_match.id;
  update public.event_queue_players set status = 'playing'
  where event_id = target_event_id and member_id = any(selected_ids);
  perform public.compact_upcoming_queue(target_event_id);
  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (target_club_id, target_event_id, auth.uid(), 'นำคิว 1 ลงสนาม',
    jsonb_build_object('match_id', target_match.id, 'court_id', target_court_id));
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
  if target_match.status <> 'playing' or target_match.started_at is null then raise exception 'เกมนี้ยังไม่ได้เริ่ม'; end if;
  played_minutes := greatest(1, floor(extract(epoch from (now() - target_match.started_at)) / 60)::integer);
  select array_agg(member_id) into selected_ids from public.queue_match_players where match_id = target_match_id;
  update public.queue_matches set status = 'completed', court_id = target_match.court_id, queue_position = null, ended_at = now() where id = target_match_id;
  update public.event_queue_players queue_player
    set status = 'waiting', games_played = games_played + 1,
        minutes_played = minutes_played + played_minutes, queued_at = now()
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

create or replace function public.operator_update_member_skill(
  target_event_id uuid,
  target_member_id uuid,
  next_skill_level text,
  next_playable_skill_levels text[]
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  queue_status text;
  lower_allowed boolean;
  higher_allowed boolean;
begin
  select club_id into target_club_id from public.events where id = target_event_id;
  if target_club_id is null or not public.is_club_operator(target_club_id) then raise exception 'ไม่มีสิทธิ์แก้ระดับมือ'; end if;
  if public.skill_level_rank(next_skill_level) < 0
     or not (next_skill_level = any(next_playable_skill_levels))
     or not (next_playable_skill_levels <@ array['Rookie-', 'Rookie', 'BG', 'N', 'S', 'P']::text[])
     or cardinality(next_playable_skill_levels) <> (select count(distinct value) from unnest(next_playable_skill_levels) value) then
    raise exception 'ข้อมูลระดับมือไม่ถูกต้อง';
  end if;
  if not exists (select 1 from public.club_members where id = target_member_id and club_id = target_club_id and role = 'member') then raise exception 'ไม่พบผู้เล่น'; end if;
  lower_allowed := case next_skill_level
    when 'Rookie-' then false
    else (array['Rookie-', 'Rookie', 'BG', 'N', 'S', 'P']::text[])[public.skill_level_rank(next_skill_level)] = any(next_playable_skill_levels)
  end;
  higher_allowed := case next_skill_level
    when 'P' then false
    else (array['Rookie-', 'Rookie', 'BG', 'N', 'S', 'P']::text[])[public.skill_level_rank(next_skill_level) + 2] = any(next_playable_skill_levels)
  end;
  update public.club_members set
    skill_level = next_skill_level,
    playable_skill_levels = next_playable_skill_levels,
    allow_lower_level = lower_allowed,
    allow_higher_level = higher_allowed
  where id = target_member_id;
  select status into queue_status from public.event_queue_players
  where event_id = target_event_id and member_id = target_member_id;
  if queue_status is null or queue_status in ('waiting', 'left') then
    update public.signups set
      skill_level_snapshot = next_skill_level,
      playable_skill_levels_snapshot = next_playable_skill_levels,
      allow_lower_level_snapshot = lower_allowed,
      allow_higher_level_snapshot = higher_allowed
    where event_id = target_event_id and member_id = target_member_id;
  end if;
  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (target_club_id, target_event_id, auth.uid(), 'แก้ระดับมือผู้เล่น',
    jsonb_build_object('member_id', target_member_id, 'skill_level', next_skill_level, 'applies_now', queue_status is null or queue_status in ('waiting', 'left')));
  return case when queue_status in ('reserved', 'playing') then 'next_queue' else 'now' end;
end;
$$;

create or replace function public.operator_update_signup_arrival(
  target_event_id uuid,
  target_member_id uuid,
  next_arrival time
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target_club_id uuid;
begin
  select club_id into target_club_id from public.events where id = target_event_id;
  if target_club_id is null or not public.is_club_operator(target_club_id) then raise exception 'ไม่มีสิทธิ์แก้เวลา'; end if;
  update public.signups set arrival_time = next_arrival
  where event_id = target_event_id and member_id = target_member_id and status = 'coming';
  update public.attendance set arrived_at = next_arrival
  where event_id = target_event_id and member_id = target_member_id and arrived;
end;
$$;

create or replace function public.operator_update_attendance(
  target_event_id uuid,
  target_member_id uuid,
  next_arrived boolean,
  next_arrived_at time,
  next_left_at time
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  queue_status text;
begin
  select club_id into target_club_id from public.events where id = target_event_id;
  if target_club_id is null or not public.is_club_operator(target_club_id) then raise exception 'ไม่มีสิทธิ์เช็กชื่อ'; end if;
  select status into queue_status from public.event_queue_players where event_id = target_event_id and member_id = target_member_id;
  if queue_status = 'playing' and (not next_arrived or next_left_at is not null) then
    raise exception 'กรุณาจบเกมในสนามก่อนบันทึกว่าผู้เล่นกลับแล้ว';
  end if;
  insert into public.attendance (club_id, event_id, member_id, arrived, arrived_at, left_at)
  values (target_club_id, target_event_id, target_member_id, next_arrived,
    case when next_arrived then next_arrived_at else null end,
    case when next_arrived then next_left_at else null end)
  on conflict (event_id, member_id) do update set
    arrived = excluded.arrived,
    arrived_at = excluded.arrived_at,
    left_at = excluded.left_at;
  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (target_club_id, target_event_id, auth.uid(), case when next_arrived then 'เช็กชื่อผู้เล่น' else 'ยกเลิกเช็กชื่อผู้เล่น' end,
    jsonb_build_object('member_id', target_member_id, 'arrived_at', next_arrived_at, 'left_at', next_left_at));
end;
$$;

create or replace function public.operator_upsert_event_court(
  target_event_id uuid,
  target_court_id uuid,
  next_court_name text,
  next_starts_at time,
  next_ends_at time
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  saved_court_id uuid;
  first_start time;
  latest_end time;
begin
  select club_id into target_club_id from public.events where id = target_event_id and status = 'open';
  if target_club_id is null or not public.is_club_operator(target_club_id) then raise exception 'แก้คอร์ทได้เฉพาะรอบที่เปิดอยู่'; end if;
  if char_length(trim(next_court_name)) < 1 or char_length(trim(next_court_name)) > 60 then raise exception 'กรุณากรอกชื่อคอร์ท'; end if;
  if target_court_id is null then
    insert into public.event_courts (club_id, event_id, court_name, starts_at, ends_at, position)
    values (target_club_id, target_event_id, trim(next_court_name), next_starts_at, next_ends_at,
      coalesce((select max(position) + 1 from public.event_courts where event_id = target_event_id), 0))
    returning id into saved_court_id;
  else
    update public.event_courts set court_name = trim(next_court_name), starts_at = next_starts_at, ends_at = next_ends_at
    where id = target_court_id and event_id = target_event_id returning id into saved_court_id;
    if saved_court_id is null then raise exception 'ไม่พบคอร์ทนี้'; end if;
  end if;
  select starts_at into first_start from public.event_courts where event_id = target_event_id order by starts_at limit 1;
  select court.ends_at into latest_end
  from public.event_courts court
  where court.event_id = target_event_id
  order by (
    extract(hour from court.ends_at)::integer * 60 + extract(minute from court.ends_at)::integer
    + case when court.ends_at <= first_start then 1440 else 0 end
  ) desc limit 1;
  update public.events set starts_at = first_start, ends_at = latest_end where id = target_event_id;
  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (target_club_id, target_event_id, auth.uid(), case when target_court_id is null then 'เพิ่มคอร์ทโดยสตาฟ' else 'แก้เวลาคอร์ทโดยสตาฟ' end,
    jsonb_build_object('court_id', saved_court_id, 'court_name', trim(next_court_name), 'starts_at', next_starts_at, 'ends_at', next_ends_at));
  return saved_court_id;
end;
$$;

create or replace function public.sync_attendance_queue_player()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_match_id uuid;
begin
  if new.arrived and new.left_at is null then
    insert into public.event_queue_players (club_id, event_id, member_id, status, queued_at)
    values (new.club_id, new.event_id, new.member_id, 'waiting', now())
    on conflict (event_id, member_id) do update
      set status = case
        when public.event_queue_players.status in ('playing', 'reserved') then public.event_queue_players.status
        else 'waiting'
      end,
      queued_at = case
        when public.event_queue_players.status = 'left' then now()
        else public.event_queue_players.queued_at
      end;
  else
    for affected_match_id in
      select match.id
      from public.queue_matches match
      join public.queue_match_players player on player.match_id = match.id
      where match.event_id = new.event_id
        and player.member_id = new.member_id
        and match.status in ('draft', 'approved')
      for update of match
    loop
      update public.queue_matches set status = 'draft' where id = affected_match_id;
      delete from public.queue_match_players
      where match_id = affected_match_id and member_id = new.member_id;
    end loop;
    update public.event_queue_players
      set status = case when status = 'playing' then status else 'left' end
      where event_id = new.event_id and member_id = new.member_id;
  end if;
  return new;
end;
$$;

create or replace function public.prevent_court_delete_with_upcoming_queue()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.events where id = old.event_id)
     and (select count(*) - 1 from public.event_courts where event_id = old.event_id)
       < (select count(*) from public.queue_matches where event_id = old.event_id and status in ('draft', 'approved')) then
    raise exception 'กรุณายกเลิกคิวล่วงหน้าท้ายสุดก่อนลดจำนวนคอร์ท';
  end if;
  return old;
end;
$$;

drop trigger if exists event_courts_prevent_delete_with_upcoming on public.event_courts;
create trigger event_courts_prevent_delete_with_upcoming
before delete on public.event_courts
for each row execute function public.prevent_court_delete_with_upcoming_queue();

create or replace function public.get_backoffice_contexts()
returns table (
  member_id uuid,
  club_id uuid,
  display_name text,
  nickname text,
  role text,
  club_name text,
  is_test boolean,
  line_group_id text,
  default_friday_court_hourly_rate numeric,
  default_saturday_court_hourly_rate numeric,
  default_other_court_hourly_rate numeric,
  default_shuttlecock_unit_price numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select cm.id, cm.club_id, cm.display_name, cm.nickname, cm.role::text, club.name, club.is_test,
    case when cm.role = 'admin' then club.line_group_id else null end,
    case when cm.role = 'admin' then club.default_friday_court_hourly_rate else null end,
    case when cm.role = 'admin' then club.default_saturday_court_hourly_rate else null end,
    case when cm.role = 'admin' then club.default_other_court_hourly_rate else null end,
    case when cm.role = 'admin' then club.default_shuttlecock_unit_price else null end
  from public.club_members cm
  join public.clubs club on club.id = cm.club_id
  where cm.profile_id = (select auth.uid())
    and cm.active
    and cm.role in ('admin', 'staff')
  order by club.is_test, cm.created_at;
$$;

create or replace function public.load_staff_dashboard(target_club_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_event public.events%rowtype;
  result jsonb;
begin
  if not public.is_club_operator(target_club_id) then raise exception 'ไม่มีสิทธิ์เปิดหน้าปฏิบัติงาน'; end if;
  select * into target_event from public.events
  where club_id = target_club_id and status = 'open'
  order by event_date desc, created_at desc limit 1;
  if target_event.id is null then return jsonb_build_object('event', null); end if;
  select jsonb_build_object(
    'event', jsonb_build_object(
      'id', target_event.id, 'club_id', target_event.club_id, 'title', target_event.title,
      'event_date', target_event.event_date, 'venue', target_event.venue,
      'status', target_event.status, 'starts_at', target_event.starts_at, 'ends_at', target_event.ends_at,
      'created_at', target_event.created_at, 'updated_at', target_event.updated_at
    ),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
      'id', member.id, 'display_name', member.display_name, 'nickname', member.nickname,
      'aliases', member.aliases, 'role', member.role, 'active', member.active,
      'skill_level', member.skill_level, 'playable_skill_levels', member.playable_skill_levels,
      'allow_lower_level', member.allow_lower_level, 'allow_higher_level', member.allow_higher_level,
      'created_at', member.created_at
    ) order by member.created_at) from public.club_members member
      where member.club_id = target_club_id and member.active and member.role = 'member'), '[]'::jsonb),
    'courts', coalesce((select jsonb_agg(to_jsonb(court) order by court.position, court.created_at)
      from public.event_courts court where court.event_id = target_event.id), '[]'::jsonb),
    'signups', coalesce((select jsonb_agg(jsonb_build_object(
      'id', signup.id, 'club_id', signup.club_id, 'event_id', signup.event_id,
      'member_id', signup.member_id, 'status', signup.status, 'note', signup.note,
      'arrival_time', signup.arrival_time, 'created_at', signup.created_at, 'updated_at', signup.updated_at,
      'submitted_by_line_name', signup.submitted_by_line_name,
      'skill_level_snapshot', signup.skill_level_snapshot,
      'playable_skill_levels_snapshot', signup.playable_skill_levels_snapshot,
      'allow_lower_level_snapshot', signup.allow_lower_level_snapshot,
      'allow_higher_level_snapshot', signup.allow_higher_level_snapshot
    ) order by signup.created_at) from public.signups signup where signup.event_id = target_event.id), '[]'::jsonb),
    'attendance', coalesce((select jsonb_agg(jsonb_build_object(
      'id', attendance.id, 'club_id', attendance.club_id, 'event_id', attendance.event_id,
      'member_id', attendance.member_id, 'arrived', attendance.arrived,
      'arrived_at', attendance.arrived_at, 'left_at', attendance.left_at,
      'created_at', attendance.created_at, 'updated_at', attendance.updated_at
    )) from public.attendance attendance where attendance.event_id = target_event.id), '[]'::jsonb),
    'queuePlayers', coalesce((select jsonb_agg(to_jsonb(queue_player)) from public.event_queue_players queue_player
      where queue_player.event_id = target_event.id), '[]'::jsonb),
    'queueMatches', coalesce((select jsonb_agg(to_jsonb(match) order by match.sequence desc) from public.queue_matches match
      where match.event_id = target_event.id), '[]'::jsonb),
    'queueMatchPlayers', coalesce((select jsonb_agg(to_jsonb(match_player)) from public.queue_match_players match_player
      where match_player.event_id = target_event.id), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.create_queue_draft(uuid, uuid[], uuid[]) from public;
revoke all on function public.update_queue_draft_lineup(uuid, jsonb) from public;
revoke all on function public.approve_queue_draft(uuid) from public;
revoke all on function public.cancel_upcoming_queue(uuid) from public;
revoke all on function public.move_upcoming_queue(uuid, integer) from public;
revoke all on function public.start_next_queue_on_court(uuid, uuid) from public;
revoke all on function public.operator_update_member_skill(uuid, uuid, text, text[]) from public;
revoke all on function public.operator_update_signup_arrival(uuid, uuid, time) from public;
revoke all on function public.operator_update_attendance(uuid, uuid, boolean, time, time) from public;
revoke all on function public.operator_upsert_event_court(uuid, uuid, text, time, time) from public;
revoke all on function public.get_backoffice_contexts() from public;
revoke all on function public.load_staff_dashboard(uuid) from public;

grant execute on function public.create_queue_draft(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.update_queue_draft_lineup(uuid, jsonb) to authenticated;
grant execute on function public.approve_queue_draft(uuid) to authenticated;
grant execute on function public.cancel_upcoming_queue(uuid) to authenticated;
grant execute on function public.move_upcoming_queue(uuid, integer) to authenticated;
grant execute on function public.start_next_queue_on_court(uuid, uuid) to authenticated;
grant execute on function public.operator_update_member_skill(uuid, uuid, text, text[]) to authenticated;
grant execute on function public.operator_update_signup_arrival(uuid, uuid, time) to authenticated;
grant execute on function public.operator_update_attendance(uuid, uuid, boolean, time, time) to authenticated;
grant execute on function public.operator_upsert_event_court(uuid, uuid, text, time, time) to authenticated;
grant execute on function public.get_backoffice_contexts() to authenticated;
grant execute on function public.load_staff_dashboard(uuid) to authenticated;

revoke all on function public.compact_upcoming_queue(uuid) from public;

-- Preserve old RPC names for cached owner pages while routing them to the new model.
drop function if exists public.claim_queue_match_proposal(uuid, uuid, uuid[], uuid[]);
drop function if exists public.start_queue_match(uuid);
drop function if exists public.cancel_queue_match_proposal(uuid);
drop function if exists public.replace_queue_match_player(uuid, uuid, uuid, boolean, uuid[]);

-- Staff accounts are operational identities and must never be merged into players.
create or replace function public.merge_club_members_with_queue(
  source_member_id uuid,
  target_member_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  source_member public.club_members%rowtype;
  target_member public.club_members%rowtype;
  merged_member_id uuid;
begin
  select * into source_member from public.club_members where id = source_member_id for update;
  select * into target_member from public.club_members where id = target_member_id for update;
  if source_member.id is null or target_member.id is null then raise exception 'ไม่พบรายชื่อที่ต้องการรวม'; end if;
  if source_member.role <> 'member' or target_member.role <> 'member' then raise exception 'ไม่สามารถรวมบัญชีเจ้าของหรือสตาฟ'; end if;
  if source_member.club_id <> target_member.club_id or not public.is_club_admin(target_member.club_id) then raise exception 'อนุญาตเฉพาะแอดมินในกลุ่มเดียวกัน'; end if;
  if exists (
    select 1 from public.queue_match_players source_player
    join public.queue_match_players target_player on target_player.match_id = source_player.match_id and target_player.member_id = target_member_id
    where source_player.member_id = source_member_id
  ) then raise exception 'สองชื่อนี้เคยอยู่ในเกมเดียวกัน จึงรวมอัตโนมัติไม่ได้ กรุณาตรวจสอบว่าเป็นคนเดียวกันจริง'; end if;
  update public.event_queue_players target_queue
  set games_played = greatest(target_queue.games_played, source_queue.games_played),
      minutes_played = greatest(target_queue.minutes_played, source_queue.minutes_played),
      queued_at = least(target_queue.queued_at, source_queue.queued_at),
      skip_until_sequence = greatest(target_queue.skip_until_sequence, source_queue.skip_until_sequence),
      status = case when target_queue.status = 'playing' or source_queue.status = 'playing' then 'playing'
        when target_queue.status = 'reserved' or source_queue.status = 'reserved' then 'reserved'
        when target_queue.status = 'waiting' or source_queue.status = 'waiting' then 'waiting' else 'left' end
  from public.event_queue_players source_queue
  where source_queue.member_id = source_member_id and target_queue.member_id = target_member_id and target_queue.event_id = source_queue.event_id;
  delete from public.event_queue_players source_queue using public.event_queue_players target_queue
  where source_queue.member_id = source_member_id and target_queue.member_id = target_member_id and target_queue.event_id = source_queue.event_id;
  update public.event_queue_players set member_id = target_member_id where member_id = source_member_id;
  update public.queue_match_players set member_id = target_member_id where member_id = source_member_id;
  merged_member_id := public.merge_club_members(source_member_id, target_member_id);
  update public.club_members set
    skill_level = coalesce(target_member.skill_level, source_member.skill_level),
    playable_skill_levels = case when target_member.skill_level is null then source_member.playable_skill_levels else target_member.playable_skill_levels end,
    allow_lower_level = case when target_member.skill_level is null then source_member.allow_lower_level else target_member.allow_lower_level end,
    allow_higher_level = case when target_member.skill_level is null then source_member.allow_higher_level else target_member.allow_higher_level end
  where id = merged_member_id;
  return merged_member_id;
end;
$$;

revoke all on function public.merge_club_members_with_queue(uuid, uuid) from public;
grant execute on function public.merge_club_members_with_queue(uuid, uuid) to authenticated;
