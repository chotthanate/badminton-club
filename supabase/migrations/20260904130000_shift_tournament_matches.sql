create or replace function public.shift_tournament_court_matches(
  target_tournament_id uuid,
  target_court_id uuid,
  shift_minutes integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  target_club_id uuid;
  rest_minutes integer;
  shifted_count integer;
begin
  if shift_minutes = 0 or abs(shift_minutes) > 240 then
    raise exception 'กรุณาระบุเวลาที่ต้องการเลื่อนระหว่าง 1–240 นาที';
  end if;

  select club_id, minimum_rest_minutes
    into target_club_id, rest_minutes
  from public.tournaments
  where id = target_tournament_id
  for update;

  if target_club_id is null or not public.is_club_operator(target_club_id) then
    raise exception 'ไม่มีสิทธิ์จัดการแข่งขัน';
  end if;

  if not exists (
    select 1 from public.tournament_courts
    where id = target_court_id and tournament_id = target_tournament_id
  ) then
    raise exception 'ไม่พบสนามในการแข่งขันนี้';
  end if;

  perform 1
  from public.tournament_matches
  where tournament_id = target_tournament_id
  for update;

  if exists (
    with shifted as (
      select id,
        scheduled_at + make_interval(mins => shift_minutes) as starts_at,
        scheduled_at + make_interval(mins => shift_minutes + estimated_minutes) as ends_at
      from public.tournament_matches
      where tournament_id = target_tournament_id
        and court_id = target_court_id
        and status in ('waiting', 'called')
        and scheduled_at is not null
    )
    select 1
    from shifted s
    join public.tournament_matches other
      on other.tournament_id = target_tournament_id
     and other.id <> s.id
     and other.court_id = target_court_id
     and other.status not in ('cancelled', 'waiting', 'called')
     and other.scheduled_at is not null
     and s.starts_at < other.scheduled_at + make_interval(mins => other.estimated_minutes)
     and other.scheduled_at < s.ends_at
  ) then
    raise exception 'เวลาที่เลื่อนทำให้สนามชนกับคู่ที่เริ่มหรือจบแล้ว';
  end if;

  if exists (
    with shifted as (
      select id, team1_id, team2_id,
        scheduled_at + make_interval(mins => shift_minutes) as starts_at,
        scheduled_at + make_interval(mins => shift_minutes + estimated_minutes) as ends_at
      from public.tournament_matches
      where tournament_id = target_tournament_id
        and court_id = target_court_id
        and status in ('waiting', 'called')
        and scheduled_at is not null
    )
    select 1
    from shifted s
    join public.tournament_matches other
      on other.tournament_id = target_tournament_id
     and other.id <> s.id
     and other.status <> 'cancelled'
     and other.scheduled_at is not null
     and (s.team1_id in (other.team1_id, other.team2_id) or s.team2_id in (other.team1_id, other.team2_id))
     and s.starts_at < other.scheduled_at + make_interval(mins => other.estimated_minutes + rest_minutes)
     and other.scheduled_at - make_interval(mins => rest_minutes) < s.ends_at
     and not (
       other.court_id = target_court_id
       and other.status in ('waiting', 'called')
     )
  ) then
    raise exception 'เวลาที่เลื่อนทำให้ทีมแข่งซ้อนกันหรือพักไม่ครบ';
  end if;

  update public.tournament_matches
  set scheduled_at = scheduled_at + make_interval(mins => shift_minutes),
      revision = revision + 1,
      updated_at = now()
  where tournament_id = target_tournament_id
    and court_id = target_court_id
    and status in ('waiting', 'called')
    and scheduled_at is not null;

  get diagnostics shifted_count = row_count;

  insert into public.tournament_audit_logs (
    tournament_id, club_id, actor_id, action, details
  ) values (
    target_tournament_id,
    target_club_id,
    auth.uid(),
    'เลื่อนเวลาคู่ที่ยังไม่เริ่มทั้งสนาม',
    jsonb_build_object('courtId', target_court_id, 'minutes', shift_minutes, 'matches', shifted_count)
  );

  return shifted_count;
end;
$$;

revoke all on function public.shift_tournament_court_matches(uuid, uuid, integer) from public;
grant execute on function public.shift_tournament_court_matches(uuid, uuid, integer) to authenticated;
