-- Only games from the current event may block its next queue. A member can
-- legitimately have old queue rows from a previous, already closed event.

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
  target_event public.events%rowtype;
  target_court public.event_courts%rowtype;
  target_match public.queue_matches%rowtype;
  selected_ids uuid[];
  stale_match_id uuid;
  court_starts_at timestamptz;
  court_ends_at timestamptz;
  compatible boolean;
begin
  select * into target_event from public.events where id = target_event_id and status = 'open';
  target_club_id := target_event.club_id;
  if target_club_id is null or not public.is_club_operator(target_club_id) then raise exception 'ไม่มีสิทธิ์เริ่มเกม'; end if;

  select * into target_court from public.event_courts where id = target_court_id and event_id = target_event_id;
  if target_court.id is null then raise exception 'ไม่พบคอร์ทนี้'; end if;
  court_starts_at := public.event_local_instant(target_event.event_date, target_event.starts_at, target_court.starts_at);
  court_ends_at := public.event_local_instant(target_event.event_date, target_event.starts_at, target_court.ends_at);
  if now() < court_starts_at then raise exception 'คอร์ทนี้ยังไม่ถึงเวลาเริ่ม'; end if;
  if now() >= court_ends_at then raise exception 'คอร์ทนี้หมดเวลาแล้ว'; end if;

  perform pg_advisory_xact_lock(hashtext(target_event_id::text));
  if exists (
    select 1 from public.queue_matches
    where event_id = target_event_id and court_id = target_court_id and status = 'playing'
  ) then raise exception 'คอร์ทนี้กำลังใช้งาน'; end if;

  select * into target_match from public.queue_matches
  where event_id = target_event_id and status in ('draft', 'approved')
  order by queue_position, proposed_at
  for update skip locked limit 1;
  if target_match.id is null then raise exception 'ยังไม่มีคิวล่วงหน้า'; end if;
  if target_match.status <> 'approved' then raise exception 'กรุณาตรวจและอนุมัติคิว 1 ก่อนนำลงสนาม'; end if;

  select array_agg(member_id) into selected_ids from public.queue_match_players where match_id = target_match.id;
  if coalesce(array_length(selected_ids, 1), 0) <> 4 then raise exception 'ผู้เล่นในคิว 1 ไม่ครบ 4 คน'; end if;

  for stale_match_id in
    select distinct playing.id
    from public.queue_match_players selected_player
    join public.queue_match_players playing_player on playing_player.member_id = selected_player.member_id
    join public.queue_matches playing on playing.id = playing_player.match_id and playing.status = 'playing'
    join public.event_courts playing_court on playing_court.id = playing.court_id
    where selected_player.match_id = target_match.id
      and playing.id <> target_match.id
      and playing.event_id = target_event_id
      and public.event_local_instant(target_event.event_date, target_event.starts_at, playing_court.ends_at) <= now()
  loop
    perform public.finish_queue_match(stale_match_id);
  end loop;

  if exists (
    select 1
    from public.queue_match_players player
    join public.queue_matches match on match.id = player.match_id
    where player.member_id = any(selected_ids)
      and player.match_id <> target_match.id
      and match.event_id = target_event_id
      and match.status = 'playing'
  ) then raise exception 'ผู้เล่นในคิว 1 ยังเล่นอยู่ในสนาม กรุณารอให้จบเกมก่อน'; end if;
  if (
    select count(*) from public.event_queue_players
    where event_id = target_event_id and member_id = any(selected_ids) and status = 'reserved'
  ) <> 4 then raise exception 'ผู้เล่นในคิว 1 ยังไม่พร้อม กรุณาโหลดข้อมูลใหม่หรือแก้คิวก่อน'; end if;

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

revoke all on function public.start_next_queue_on_court(uuid, uuid) from public;
revoke all on function public.start_next_queue_on_court(uuid, uuid) from anon;
grant execute on function public.start_next_queue_on_court(uuid, uuid) to authenticated;
