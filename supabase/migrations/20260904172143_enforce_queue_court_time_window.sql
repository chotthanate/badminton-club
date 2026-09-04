-- A queue may be blocked by a match that was never closed even though its
-- booked court has already ended. Close only those expired matches inside the
-- same transaction, then start the approved queue on an active court.

create or replace function public.finish_queue_match(target_match_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.queue_matches%rowtype;
  target_event public.events%rowtype;
  target_court public.event_courts%rowtype;
  effective_end timestamptz;
  recorded_end timestamptz;
  played_minutes integer;
  selected_ids uuid[];
begin
  select * into target_match from public.queue_matches where id = target_match_id for update;
  if target_match.id is null or not public.is_club_operator(target_match.club_id) then raise exception 'ไม่มีสิทธิ์จบเกม'; end if;
  perform pg_advisory_xact_lock(hashtext(target_match.event_id::text));
  if target_match.status <> 'playing' or target_match.started_at is null then raise exception 'เกมนี้ยังไม่ได้เริ่ม'; end if;

  select * into target_event from public.events where id = target_match.event_id;
  select * into target_court from public.event_courts where id = target_match.court_id and event_id = target_match.event_id;
  effective_end := case
    when target_court.id is null then now()
    else public.event_local_instant(target_event.event_date, target_event.starts_at, target_court.ends_at)
  end;
  recorded_end := least(now(), effective_end);
  played_minutes := greatest(1, floor(extract(epoch from (recorded_end - target_match.started_at)) / 60)::integer);

  select array_agg(member_id) into selected_ids from public.queue_match_players where match_id = target_match_id;
  update public.queue_matches
  set status = 'completed', court_id = target_match.court_id, queue_position = null, ended_at = recorded_end
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
    jsonb_build_object(
      'match_id', target_match_id,
      'minutes', played_minutes,
      'ended_at', recorded_end,
      'capped_at_court_end', now() > effective_end
    ));
  return played_minutes;
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
  if exists (select 1 from public.queue_matches where court_id = target_court_id and status = 'playing') then raise exception 'คอร์ทนี้กำลังใช้งาน'; end if;

  select * into target_match from public.queue_matches
  where event_id = target_event_id and status in ('draft', 'approved')
  order by queue_position, proposed_at
  for update skip locked limit 1;
  if target_match.id is null then raise exception 'ยังไม่มีคิวล่วงหน้า'; end if;
  if target_match.status <> 'approved' then raise exception 'กรุณาตรวจและอนุมัติคิว 1 ก่อนนำลงสนาม'; end if;

  select array_agg(member_id) into selected_ids from public.queue_match_players where match_id = target_match.id;
  if coalesce(array_length(selected_ids, 1), 0) <> 4 then raise exception 'ผู้เล่นในคิว 1 ไม่ครบ 4 คน'; end if;

  -- A match on an already expired court cannot still be played. Completing it
  -- here prevents an invisible stale row from blocking every active court.
  for stale_match_id in
    select distinct playing.id
    from public.queue_match_players selected_player
    join public.queue_match_players playing_player on playing_player.member_id = selected_player.member_id
    join public.queue_matches playing on playing.id = playing_player.match_id and playing.status = 'playing'
    join public.event_courts playing_court on playing_court.id = playing.court_id
    where selected_player.match_id = target_match.id
      and playing.id <> target_match.id
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
revoke all on function public.finish_queue_match(uuid) from public;
revoke all on function public.start_next_queue_on_court(uuid, uuid) from anon;
revoke all on function public.finish_queue_match(uuid) from anon;
grant execute on function public.start_next_queue_on_court(uuid, uuid) to authenticated;
grant execute on function public.finish_queue_match(uuid) to authenticated;
