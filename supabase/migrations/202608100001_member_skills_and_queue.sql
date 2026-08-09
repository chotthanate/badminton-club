alter table public.club_members
  add column skill_level text,
  add column allow_lower_level boolean not null default false,
  add column allow_higher_level boolean not null default false,
  add constraint club_members_skill_level_check
    check (skill_level is null or skill_level in ('Rookie-', 'Rookie', 'BG', 'N', 'S', 'P'));

alter table public.signups
  add column skill_level_snapshot text,
  add column allow_lower_level_snapshot boolean not null default false,
  add column allow_higher_level_snapshot boolean not null default false,
  add constraint signups_skill_level_snapshot_check
    check (skill_level_snapshot is null or skill_level_snapshot in ('Rookie-', 'Rookie', 'BG', 'N', 'S', 'P'));

create table public.event_queue_players (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  event_id uuid not null,
  member_id uuid not null,
  status text not null default 'waiting'
    check (status in ('waiting', 'proposed', 'playing', 'left')),
  games_played integer not null default 0 check (games_played >= 0),
  minutes_played integer not null default 0 check (minutes_played >= 0),
  queued_at timestamptz not null default now(),
  skip_until_sequence integer not null default 0 check (skip_until_sequence >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, member_id),
  unique (id, event_id),
  foreign key (event_id, club_id) references public.events (id, club_id) on delete cascade,
  foreign key (member_id, club_id) references public.club_members (id, club_id) on delete cascade
);

create table public.queue_matches (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  event_id uuid not null,
  court_id uuid not null references public.event_courts (id) on delete cascade,
  sequence integer not null check (sequence > 0),
  status text not null default 'proposed'
    check (status in ('proposed', 'playing', 'completed', 'cancelled')),
  proposed_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, sequence),
  unique (id, event_id),
  foreign key (event_id, club_id) references public.events (id, club_id) on delete cascade
);

create unique index queue_matches_active_court_idx
  on public.queue_matches (court_id)
  where status in ('proposed', 'playing');

create table public.queue_match_players (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  event_id uuid not null,
  match_id uuid not null,
  member_id uuid not null,
  team text not null check (team in ('A', 'B')),
  position integer not null check (position between 1 and 2),
  skill_level_snapshot text not null
    check (skill_level_snapshot in ('Rookie-', 'Rookie', 'BG', 'N', 'S', 'P')),
  created_at timestamptz not null default now(),
  unique (match_id, member_id),
  unique (match_id, team, position),
  foreign key (match_id, event_id) references public.queue_matches (id, event_id) on delete cascade,
  foreign key (member_id, club_id) references public.club_members (id, club_id) on delete cascade,
  foreign key (event_id, club_id) references public.events (id, club_id) on delete cascade
);

create index event_queue_players_event_status_idx
  on public.event_queue_players (event_id, status, games_played, minutes_played, queued_at);
create index queue_matches_event_status_idx
  on public.queue_matches (event_id, status, sequence desc);
create index queue_match_players_event_member_idx
  on public.queue_match_players (event_id, member_id);

create trigger event_queue_players_set_updated_at before update on public.event_queue_players
for each row execute function public.set_updated_at();
create trigger queue_matches_set_updated_at before update on public.queue_matches
for each row execute function public.set_updated_at();

alter table public.event_queue_players enable row level security;
alter table public.queue_matches enable row level security;
alter table public.queue_match_players enable row level security;

create policy "event_queue_players_admin_all" on public.event_queue_players
for all to authenticated
using ((select public.is_club_admin(club_id)))
with check ((select public.is_club_admin(club_id)));
create policy "queue_matches_admin_all" on public.queue_matches
for all to authenticated
using ((select public.is_club_admin(club_id)))
with check ((select public.is_club_admin(club_id)));
create policy "queue_match_players_admin_all" on public.queue_match_players
for all to authenticated
using ((select public.is_club_admin(club_id)))
with check ((select public.is_club_admin(club_id)));

create or replace function public.sync_attendance_queue_player()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.arrived and new.left_at is null then
    insert into public.event_queue_players (club_id, event_id, member_id, status, queued_at)
    values (new.club_id, new.event_id, new.member_id, 'waiting', now())
    on conflict (event_id, member_id) do update
      set status = case
        when public.event_queue_players.status = 'playing' then 'playing'
        else 'waiting'
      end,
      queued_at = case
        when public.event_queue_players.status in ('left') then now()
        else public.event_queue_players.queued_at
      end;
  else
    update public.event_queue_players
      set status = case when status = 'playing' then status else 'left' end
      where event_id = new.event_id and member_id = new.member_id;
  end if;
  return new;
end;
$$;

create trigger attendance_sync_queue_player
after insert or update of arrived, left_at on public.attendance
for each row execute function public.sync_attendance_queue_player();

create or replace function public.claim_queue_match_proposal(
  target_event_id uuid,
  target_court_id uuid,
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
  next_sequence integer;
  new_match_id uuid;
  selected_member_id uuid;
  selected_level text;
  team_name text;
  team_position integer;
begin
  select club_id into target_club_id from public.events where id = target_event_id;
  if target_club_id is null or not public.is_club_admin(target_club_id) then
    raise exception 'Admin only';
  end if;
  if coalesce(array_length(selected_member_ids, 1), 0) <> 4
     or (select count(distinct value) from unnest(selected_member_ids) value) <> 4
     or coalesce(array_length(team_a_member_ids, 1), 0) <> 2
     or exists (select 1 from unnest(team_a_member_ids) value where not (value = any(selected_member_ids))) then
    raise exception 'ต้องเลือกผู้เล่น 4 คน และทีม A 2 คน';
  end if;
  if not exists (
    select 1 from public.event_courts
    where id = target_court_id and event_id = target_event_id and club_id = target_club_id
  ) then
    raise exception 'ไม่พบคอร์ทในรอบนี้';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_event_id::text));
  if exists (
    select 1 from public.queue_matches
    where court_id = target_court_id and status in ('proposed', 'playing')
  ) then
    raise exception 'คอร์ทนี้มีเกมอยู่แล้ว';
  end if;
  if (
    select count(*) from public.event_queue_players queue_player
    join public.signups signup
      on signup.event_id = queue_player.event_id and signup.member_id = queue_player.member_id
    where queue_player.event_id = target_event_id
      and queue_player.member_id = any(selected_member_ids)
      and queue_player.status = 'waiting'
      and signup.skill_level_snapshot is not null
  ) <> 4 then
    raise exception 'มีผู้เล่นบางคนไม่พร้อมหรือยังไม่ได้กำหนดระดับมือ';
  end if;

  select coalesce(max(sequence), 0) + 1 into next_sequence
  from public.queue_matches where event_id = target_event_id;

  insert into public.queue_matches (
    club_id, event_id, court_id, sequence, status, created_by
  ) values (
    target_club_id, target_event_id, target_court_id, next_sequence, 'proposed', auth.uid()
  ) returning id into new_match_id;

  foreach selected_member_id in array selected_member_ids loop
    select skill_level_snapshot into selected_level
    from public.signups
    where event_id = target_event_id and member_id = selected_member_id;
    if selected_member_id = any(team_a_member_ids) then
      team_name := 'A';
      select count(*) + 1 into team_position
      from public.queue_match_players where match_id = new_match_id and team = 'A';
    else
      team_name := 'B';
      select count(*) + 1 into team_position
      from public.queue_match_players where match_id = new_match_id and team = 'B';
    end if;
    insert into public.queue_match_players (
      club_id, event_id, match_id, member_id, team, position, skill_level_snapshot
    ) values (
      target_club_id, target_event_id, new_match_id, selected_member_id,
      team_name, team_position, selected_level
    );
  end loop;

  update public.event_queue_players
    set status = 'proposed'
    where event_id = target_event_id and member_id = any(selected_member_ids);

  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (target_club_id, target_event_id, auth.uid(), 'จัดผู้เล่นลงคอร์ท',
    jsonb_build_object('match_id', new_match_id, 'court_id', target_court_id, 'sequence', next_sequence));
  return new_match_id;
end;
$$;

create or replace function public.start_queue_match(target_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.queue_matches%rowtype;
begin
  select * into target_match from public.queue_matches where id = target_match_id for update;
  if target_match.id is null or not public.is_club_admin(target_match.club_id) then raise exception 'Admin only'; end if;
  if target_match.status <> 'proposed' then raise exception 'เกมนี้ไม่ได้รอเริ่ม'; end if;
  update public.queue_matches set status = 'playing', started_at = now() where id = target_match_id;
  update public.event_queue_players queue_player set status = 'playing'
    from public.queue_match_players match_player
    where match_player.match_id = target_match_id
      and queue_player.event_id = target_match.event_id
      and queue_player.member_id = match_player.member_id;
  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (target_match.club_id, target_match.event_id, auth.uid(), 'เริ่มเกมในคอร์ท', jsonb_build_object('match_id', target_match_id));
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
begin
  select * into target_match from public.queue_matches where id = target_match_id for update;
  if target_match.id is null or not public.is_club_admin(target_match.club_id) then raise exception 'Admin only'; end if;
  if target_match.status <> 'playing' or target_match.started_at is null then raise exception 'เกมนี้ยังไม่ได้เริ่ม'; end if;
  played_minutes := greatest(1, floor(extract(epoch from (now() - target_match.started_at)) / 60)::integer);
  update public.queue_matches set status = 'completed', ended_at = now() where id = target_match_id;
  update public.event_queue_players queue_player
    set status = 'waiting', games_played = games_played + 1,
        minutes_played = minutes_played + played_minutes, queued_at = now()
    from public.queue_match_players match_player
    where match_player.match_id = target_match_id
      and queue_player.event_id = target_match.event_id
      and queue_player.member_id = match_player.member_id;
  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (target_match.club_id, target_match.event_id, auth.uid(), 'จบเกมในคอร์ท',
    jsonb_build_object('match_id', target_match_id, 'minutes', played_minutes));
  return played_minutes;
end;
$$;

create or replace function public.cancel_queue_match_proposal(target_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.queue_matches%rowtype;
begin
  select * into target_match from public.queue_matches where id = target_match_id for update;
  if target_match.id is null or not public.is_club_admin(target_match.club_id) then raise exception 'Admin only'; end if;
  if target_match.status <> 'proposed' then raise exception 'ยกเลิกได้เฉพาะเกมที่ยังไม่เริ่ม'; end if;
  update public.queue_matches set status = 'cancelled', ended_at = now() where id = target_match_id;
  update public.event_queue_players queue_player set status = 'waiting'
    from public.queue_match_players match_player
    where match_player.match_id = target_match_id
      and queue_player.event_id = target_match.event_id
      and queue_player.member_id = match_player.member_id;
end;
$$;

create or replace function public.replace_queue_match_player(
  target_match_id uuid,
  outgoing_member_id uuid,
  incoming_member_id uuid,
  skip_absent boolean default true,
  replacement_team_a_member_ids uuid[] default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.queue_matches%rowtype;
  outgoing_row public.queue_match_players%rowtype;
  incoming_level text;
  replacement_ids uuid[];
  replacement_member_id uuid;
  replacement_level text;
  replacement_team text;
  replacement_position integer;
begin
  select * into target_match from public.queue_matches where id = target_match_id for update;
  if target_match.id is null or not public.is_club_admin(target_match.club_id) then raise exception 'Admin only'; end if;
  if target_match.status <> 'proposed' then raise exception 'เปลี่ยนผู้เล่นได้ก่อนเริ่มเกมเท่านั้น'; end if;
  select * into outgoing_row from public.queue_match_players
    where match_id = target_match_id and member_id = outgoing_member_id;
  if outgoing_row.id is null then raise exception 'ไม่พบผู้เล่นที่ต้องการเปลี่ยน'; end if;
  if not exists (
    select 1 from public.event_queue_players
    where event_id = target_match.event_id and member_id = incoming_member_id and status = 'waiting'
  ) then raise exception 'ผู้เล่นคนใหม่ไม่พร้อมลงสนาม'; end if;
  select skill_level_snapshot into incoming_level from public.signups
    where event_id = target_match.event_id and member_id = incoming_member_id;
  if incoming_level is null then raise exception 'ผู้เล่นคนใหม่ยังไม่ได้กำหนดระดับมือ'; end if;
  select array_agg(case when member_id = outgoing_member_id then incoming_member_id else member_id end order by position, team)
    into replacement_ids
    from public.queue_match_players where match_id = target_match_id;
  if replacement_team_a_member_ids is not null and (
    coalesce(array_length(replacement_team_a_member_ids, 1), 0) <> 2
    or exists (select 1 from unnest(replacement_team_a_member_ids) value where not (value = any(replacement_ids)))
  ) then raise exception 'ข้อมูลจัดทีมใหม่ไม่ถูกต้อง'; end if;

  update public.event_queue_players
    set status = 'waiting',
        skip_until_sequence = case when skip_absent then target_match.sequence + 1 else skip_until_sequence end,
        queued_at = case when skip_absent then now() else queued_at end
    where event_id = target_match.event_id and member_id = outgoing_member_id;
  update public.event_queue_players set status = 'proposed'
    where event_id = target_match.event_id and member_id = incoming_member_id;
  if replacement_team_a_member_ids is null then
    update public.queue_match_players
      set member_id = incoming_member_id, skill_level_snapshot = incoming_level
      where id = outgoing_row.id;
  else
    delete from public.queue_match_players where match_id = target_match_id;
    foreach replacement_member_id in array replacement_ids loop
      select skill_level_snapshot into replacement_level from public.signups
        where event_id = target_match.event_id and member_id = replacement_member_id;
      if replacement_member_id = any(replacement_team_a_member_ids) then
        replacement_team := 'A';
      else
        replacement_team := 'B';
      end if;
      select count(*) + 1 into replacement_position from public.queue_match_players
        where match_id = target_match_id and team = replacement_team;
      insert into public.queue_match_players (
        club_id, event_id, match_id, member_id, team, position, skill_level_snapshot
      ) values (
        target_match.club_id, target_match.event_id, target_match_id, replacement_member_id,
        replacement_team, replacement_position, replacement_level
      );
    end loop;
  end if;
end;
$$;

grant execute on function public.claim_queue_match_proposal(uuid, uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.start_queue_match(uuid) to authenticated;
grant execute on function public.finish_queue_match(uuid) to authenticated;
grant execute on function public.cancel_queue_match_proposal(uuid) to authenticated;
grant execute on function public.replace_queue_match_player(uuid, uuid, uuid, boolean, uuid[]) to authenticated;
