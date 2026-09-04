-- Tournament management is isolated from badminton sessions and billing.

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  public_id text not null default encode(gen_random_bytes(10), 'hex') unique,
  name text not null,
  event_date date not null,
  venue text not null,
  starts_at timestamptz not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'qualifying', 'knockout', 'completed', 'archived', 'cancelled')),
  qualifier_minutes integer not null default 30 check (qualifier_minutes between 10 and 180),
  knockout_minutes integer not null default 45 check (knockout_minutes between 10 and 240),
  minimum_rest_minutes integer not null default 15 check (minimum_rest_minutes between 0 and 180),
  revision bigint not null default 1,
  created_by uuid not null references auth.users(id) on delete restrict,
  completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tournament_divisions (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete restrict,
  skill_level text not null check (skill_level in ('Rookie', 'BG', 'N', 'S', 'P')),
  status text not null default 'registration' check (status in ('registration', 'qualifying', 'split_ready', 'knockout', 'completed')),
  draw_seed text,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, skill_level)
);

create table public.tournament_courts (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete restrict,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (tournament_id, name)
);

create table public.tournament_teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  division_id uuid not null references public.tournament_divisions(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete restrict,
  name text not null,
  draw_order integer,
  qualification_rank integer,
  bracket text check (bracket is null or bracket in ('upper', 'lower')),
  withdrawn boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (division_id, name)
);

create table public.tournament_team_players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  division_id uuid not null references public.tournament_divisions(id) on delete cascade,
  team_id uuid not null references public.tournament_teams(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete restrict,
  club_member_id uuid references public.club_members(id) on delete set null,
  display_name text not null,
  normalized_name text generated always as (lower(regexp_replace(trim(display_name), '\\s+', ' ', 'g'))) stored,
  skill_level_snapshot text not null check (skill_level_snapshot in ('Rookie', 'BG', 'N', 'S', 'P')),
  player_order smallint not null check (player_order in (1, 2)),
  created_at timestamptz not null default now(),
  unique (team_id, player_order)
);

create unique index tournament_player_member_once_idx
  on public.tournament_team_players (tournament_id, club_member_id)
  where club_member_id is not null;
create unique index tournament_external_player_once_idx
  on public.tournament_team_players (tournament_id, normalized_name)
  where club_member_id is null;

create table public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  division_id uuid not null references public.tournament_divisions(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete restrict,
  phase text not null check (phase in ('qualifier', 'upper', 'lower', 'upper_third', 'lower_third')),
  round_no integer not null check (round_no > 0),
  position integer not null check (position > 0),
  court_id uuid references public.tournament_courts(id) on delete set null,
  team1_id uuid references public.tournament_teams(id) on delete restrict,
  team2_id uuid references public.tournament_teams(id) on delete restrict,
  winner_team_id uuid references public.tournament_teams(id) on delete restrict,
  loser_team_id uuid references public.tournament_teams(id) on delete restrict,
  next_match_id uuid references public.tournament_matches(id) on delete set null,
  next_slot smallint check (next_slot is null or next_slot in (1, 2)),
  loser_next_match_id uuid references public.tournament_matches(id) on delete set null,
  loser_next_slot smallint check (loser_next_slot is null or loser_next_slot in (1, 2)),
  scheduled_at timestamptz,
  estimated_minutes integer not null check (estimated_minutes between 10 and 240),
  actual_started_at timestamptz,
  actual_ended_at timestamptz,
  status text not null default 'waiting' check (status in ('waiting', 'called', 'playing', 'completed', 'cancelled')),
  result_type text not null default 'score' check (result_type in ('score', 'walkover', 'withdrawal')),
  result_reason text,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (division_id, phase, round_no, position),
  check (team1_id is null or team1_id <> team2_id)
);

create table public.tournament_games (
  id bigint generated always as identity primary key,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  match_id uuid not null references public.tournament_matches(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete restrict,
  game_no smallint not null check (game_no between 1 and 3),
  team1_score smallint not null check (team1_score between 0 and 30),
  team2_score smallint not null check (team2_score between 0 and 30),
  created_at timestamptz not null default now(),
  unique (match_id, game_no)
);

create table public.tournament_audit_logs (
  id bigint generated always as identity primary key,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index tournaments_club_status_date_idx on public.tournaments (club_id, status, event_date desc);
create index tournament_divisions_tournament_idx on public.tournament_divisions (tournament_id);
create index tournament_courts_tournament_sort_idx on public.tournament_courts (tournament_id, sort_order);
create index tournament_teams_division_idx on public.tournament_teams (division_id, draw_order);
create index tournament_team_players_team_idx on public.tournament_team_players (team_id, player_order);
create index tournament_matches_tournament_schedule_idx on public.tournament_matches (tournament_id, scheduled_at, status);
create index tournament_matches_division_phase_idx on public.tournament_matches (division_id, phase, round_no, position);
create index tournament_matches_court_schedule_idx on public.tournament_matches (court_id, scheduled_at) where status <> 'cancelled';
create index tournament_games_match_idx on public.tournament_games (match_id, game_no);
create index tournament_audit_tournament_created_idx on public.tournament_audit_logs (tournament_id, created_at desc);

alter table public.tournaments enable row level security;
alter table public.tournament_divisions enable row level security;
alter table public.tournament_courts enable row level security;
alter table public.tournament_teams enable row level security;
alter table public.tournament_team_players enable row level security;
alter table public.tournament_matches enable row level security;
alter table public.tournament_games enable row level security;
alter table public.tournament_audit_logs enable row level security;

create policy tournaments_operator_select on public.tournaments
  for select to authenticated using ((select public.is_club_operator(club_id)));
create policy tournament_divisions_operator_select on public.tournament_divisions
  for select to authenticated using ((select public.is_club_operator(club_id)));
create policy tournament_courts_operator_select on public.tournament_courts
  for select to authenticated using ((select public.is_club_operator(club_id)));
create policy tournament_teams_operator_select on public.tournament_teams
  for select to authenticated using ((select public.is_club_operator(club_id)));
create policy tournament_team_players_operator_select on public.tournament_team_players
  for select to authenticated using ((select public.is_club_operator(club_id)));
create policy tournament_matches_operator_select on public.tournament_matches
  for select to authenticated using ((select public.is_club_operator(club_id)));
create policy tournament_games_operator_select on public.tournament_games
  for select to authenticated using ((select public.is_club_operator(club_id)));
create policy tournament_audit_admin_select on public.tournament_audit_logs
  for select to authenticated using ((select public.is_club_admin(club_id)));

revoke all on public.tournaments, public.tournament_divisions, public.tournament_courts,
  public.tournament_teams, public.tournament_team_players, public.tournament_matches,
  public.tournament_games, public.tournament_audit_logs from anon, authenticated;
grant select on public.tournaments, public.tournament_divisions, public.tournament_courts,
  public.tournament_teams, public.tournament_team_players, public.tournament_matches,
  public.tournament_games to authenticated;
grant select on public.tournament_audit_logs to authenticated;

create or replace function public.save_tournament_match_result(
  target_match_id uuid,
  expected_revision bigint,
  score_games jsonb,
  selected_winner_id uuid,
  selected_loser_id uuid,
  selected_result_type text default 'score',
  selected_reason text default null
)
returns public.tournament_matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.tournament_matches%rowtype;
  downstream public.tournament_matches%rowtype;
  score jsonb;
  game_index integer := 0;
begin
  select * into target_match from public.tournament_matches where id = target_match_id for update;
  if target_match.id is null or not public.is_club_operator(target_match.club_id) then
    raise exception 'ไม่มีสิทธิ์บันทึกผลการแข่งขัน';
  end if;
  if target_match.revision <> expected_revision then
    raise exception 'ข้อมูลคู่นี้ถูกแก้จากอีกเครื่อง กรุณาโหลดข้อมูลล่าสุด';
  end if;
  if target_match.phase = 'qualifier' and selected_result_type = 'score'
     and selected_winner_id is null and selected_loser_id is null then
    null; -- A 1-1 qualification match is a valid draw.
  elsif selected_winner_id not in (target_match.team1_id, target_match.team2_id)
     or selected_loser_id not in (target_match.team1_id, target_match.team2_id)
     or selected_winner_id = selected_loser_id then
      raise exception 'ทีมผู้ชนะหรือผู้แพ้ไม่ถูกต้อง';
  end if;
  if target_match.next_match_id is not null then
    select * into downstream from public.tournament_matches where id = target_match.next_match_id for update;
    if downstream.status in ('playing', 'completed') and target_match.winner_team_id is distinct from selected_winner_id then
      raise exception 'คู่ถัดไปเริ่มแล้ว กรุณายกเลิกผลคู่ปลายทางก่อน';
    end if;
  end if;

  delete from public.tournament_games where match_id = target_match.id;
  if selected_result_type = 'score' then
    for score in select * from jsonb_array_elements(coalesce(score_games, '[]'::jsonb)) loop
      game_index := game_index + 1;
      insert into public.tournament_games (tournament_id, match_id, club_id, game_no, team1_score, team2_score)
      values (target_match.tournament_id, target_match.id, target_match.club_id, game_index,
        (score->>'team1Score')::smallint, (score->>'team2Score')::smallint);
    end loop;
  end if;

  update public.tournament_matches
  set winner_team_id = selected_winner_id,
      loser_team_id = selected_loser_id,
      result_type = selected_result_type,
      result_reason = nullif(trim(selected_reason), ''),
      status = 'completed',
      actual_ended_at = coalesce(actual_ended_at, now()),
      revision = revision + 1,
      updated_at = now()
  where id = target_match.id
  returning * into target_match;

  if downstream.id is not null and target_match.next_slot is not null and selected_winner_id is not null then
    update public.tournament_matches
    set team1_id = case when target_match.next_slot = 1 then selected_winner_id else team1_id end,
        team2_id = case when target_match.next_slot = 2 then selected_winner_id else team2_id end,
        revision = revision + 1,
        updated_at = now()
    where id = downstream.id;
  end if;

  if target_match.loser_next_match_id is not null and target_match.loser_next_slot is not null and selected_loser_id is not null then
    update public.tournament_matches
    set team1_id = case when target_match.loser_next_slot = 1 then selected_loser_id else team1_id end,
        team2_id = case when target_match.loser_next_slot = 2 then selected_loser_id else team2_id end,
        revision = revision + 1,
        updated_at = now()
    where id = target_match.loser_next_match_id;
  end if;

  insert into public.tournament_audit_logs (tournament_id, club_id, actor_id, action, details)
  values (target_match.tournament_id, target_match.club_id, (select auth.uid()), 'บันทึกผลการแข่งขัน',
    jsonb_build_object('matchId', target_match.id, 'winnerTeamId', selected_winner_id, 'resultType', selected_result_type));
  return target_match;
end;
$$;

revoke all on function public.save_tournament_match_result(uuid, bigint, jsonb, uuid, uuid, text, text) from public, anon;
grant execute on function public.save_tournament_match_result(uuid, bigint, jsonb, uuid, uuid, text, text) to authenticated;
