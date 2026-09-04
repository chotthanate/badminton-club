alter table public.tournaments
  add column if not exists ends_at timestamptz;

update public.tournaments
set ends_at = starts_at + interval '8 hours'
where ends_at is null;

alter table public.tournaments
  alter column ends_at set not null;

alter table public.tournaments
  drop constraint if exists tournaments_ends_after_start;

alter table public.tournaments
  add constraint tournaments_ends_after_start check (ends_at > starts_at);

create or replace function public.generate_tournament_test_teams(
  target_tournament_id uuid,
  skill_counts jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_club_id uuid;
  target_is_test boolean;
  skill text;
  player_count integer;
  division_id uuid;
  team_id uuid;
  team_number integer;
  suffix text;
  inserted_players integer := 0;
begin
  select tournaments.club_id, clubs.is_test
  into target_club_id, target_is_test
  from public.tournaments
  join public.clubs on clubs.id = tournaments.club_id
  where tournaments.id = target_tournament_id;

  if target_club_id is null then
    raise exception 'ไม่พบการแข่งขัน';
  end if;
  if not target_is_test then
    raise exception 'เพิ่มผู้เล่นอัตโนมัติได้เฉพาะโหมดทดลอง';
  end if;
  if not public.is_club_admin(target_club_id) then
    raise exception 'เฉพาะเจ้าของที่เพิ่มผู้เล่นทดลองได้';
  end if;

  for skill, player_count in
    select key, value::text::integer from jsonb_each(skill_counts)
  loop
    if skill not in ('Rookie', 'BG', 'N', 'S', 'P') then
      raise exception 'ระดับมือไม่ถูกต้อง: %', skill;
    end if;
    if player_count < 0 or player_count > 40 or player_count % 2 <> 0 then
      raise exception 'จำนวนผู้เล่นระดับ % ต้องเป็นเลขคู่ระหว่าง 0–40 คน', skill;
    end if;
    if player_count = 0 then
      continue;
    end if;

    insert into public.tournament_divisions (tournament_id, club_id, skill_level)
    values (target_tournament_id, target_club_id, skill)
    on conflict (tournament_id, skill_level)
    do update set updated_at = now()
    returning id into division_id;

    for team_number in 1..(player_count / 2) loop
      suffix := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
      insert into public.tournament_teams (
        tournament_id, division_id, club_id, name
      ) values (
        target_tournament_id,
        division_id,
        target_club_id,
        format('ทีมทดลอง %s %s', skill, suffix)
      ) returning id into team_id;

      insert into public.tournament_team_players (
        tournament_id, division_id, team_id, club_id,
        display_name, skill_level_snapshot, player_order
      ) values
        (target_tournament_id, division_id, team_id, target_club_id,
         format('ผู้เล่นทดลอง %s-%s A', skill, suffix), skill, 1),
        (target_tournament_id, division_id, team_id, target_club_id,
         format('ผู้เล่นทดลอง %s-%s B', skill, suffix), skill, 2);
      inserted_players := inserted_players + 2;
    end loop;
  end loop;

  insert into public.tournament_audit_logs (
    tournament_id, club_id, actor_id, action, details
  ) values (
    target_tournament_id,
    target_club_id,
    auth.uid(),
    'เพิ่มผู้เล่นทดลองอัตโนมัติ',
    jsonb_build_object('skillCounts', skill_counts, 'players', inserted_players)
  );

  return inserted_players;
end;
$$;

revoke all on function public.generate_tournament_test_teams(uuid, jsonb) from public, anon;
grant execute on function public.generate_tournament_test_teams(uuid, jsonb) to authenticated;
