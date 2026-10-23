-- Sandbox preparation never resets an existing round or rewrites booking times.
-- Only a club proven is_test in the database may bypass court booking clocks.
create function public.prepare_test_round(target_club_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  test_club public.clubs%rowtype; target_event public.events%rowtype;
  local_now timestamp := now() at time zone 'Asia/Bangkok';
  changed boolean := false;
begin
  select * into test_club from public.clubs where id = target_club_id;
  if test_club.id is null or not test_club.is_test or not public.is_club_admin(target_club_id) then
    raise exception 'เตรียมรอบอัตโนมัติได้เฉพาะแอดมินในโหมดทดลอง';
  end if;
  perform pg_advisory_xact_lock(hashtext('prepare_test_round:' || target_club_id::text));
  select * into target_event from public.events
    where club_id = target_club_id and status in ('draft', 'open')
    order by case when status = 'open' then 0 else 1 end, created_at desc
    limit 1 for no key update;
  if target_event.id is null then
    insert into public.events(club_id,title,event_date,venue,starts_at,ends_at,status,billing_model,court_hourly_rate,shuttlecock_unit_price,created_by)
    values(target_club_id,'รอบทดลองพร้อมเล่น',local_now::date,'สนามทดลอง',date_trunc('minute',local_now)::time,
      (date_trunc('minute',local_now) + interval '3 hours')::time,'open','time_segmented',
      case extract(dow from local_now) when 5 then test_club.default_friday_court_hourly_rate
        when 6 then test_club.default_saturday_court_hourly_rate else test_club.default_other_court_hourly_rate end,
      test_club.default_shuttlecock_unit_price,auth.uid()) returning * into target_event;
    changed := true;
  end if;
  -- Same event-row/advisory order as finishing a round; FK KEY SHARE stays free.
  perform pg_advisory_xact_lock(hashtext(target_event.id::text));
  if target_event.status = 'draft' then
    update public.events set status = 'open', line_publish_ready = false where id = target_event.id;
    changed := true;
  end if;
  if not exists(select 1 from public.event_courts where event_id = target_event.id) then
    insert into public.event_courts(club_id,event_id,court_name,starts_at,ends_at,position)
    values(target_club_id,target_event.id,'คอร์ททดลอง 1',target_event.starts_at,target_event.ends_at,0),
      (target_club_id,target_event.id,'คอร์ททดลอง 2',target_event.starts_at,target_event.ends_at,1);
    changed := true;
  end if;
  if changed then
    insert into public.audit_logs(club_id,event_id,actor_id,action,details)
    values(target_club_id,target_event.id,auth.uid(),'เตรียมรอบทดลองพร้อมเล่น',jsonb_build_object('test_only',true));
  end if;
  return target_event.id;
end;
$$;

-- Bulk sample creation is atomic: a failure cannot leave unregistered members
-- or checked-in attendees without the corresponding signup snapshots.
create function public.add_random_test_players(target_club_id uuid, target_event_id uuid, player_profiles jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  target_event public.events%rowtype; profile jsonb; level text; playable text[];
  member_id uuid; next_number integer; added_count integer := 0; display_number text;
  allow_lower boolean; allow_higher boolean;
begin
  if not exists(select 1 from public.clubs where id = target_club_id and is_test)
    or not public.is_club_admin(target_club_id) then raise exception 'เพิ่มผู้เล่นสุ่มได้เฉพาะแอดมินในโหมดทดลอง'; end if;
  if jsonb_typeof(player_profiles) is distinct from 'array' or jsonb_array_length(player_profiles) not between 1 and 100
    then raise exception 'จำนวนผู้เล่นสุ่มต้องอยู่ระหว่าง 1 ถึง 100 คน'; end if;
  perform pg_advisory_xact_lock(hashtext('prepare_test_round:' || target_club_id::text));
  perform pg_advisory_xact_lock(hashtext(target_event_id::text));
  select * into target_event from public.events where id = target_event_id and club_id = target_club_id and status = 'open';
  if target_event.id is null then raise exception 'กรุณาเปิดรอบทดลองก่อนเพิ่มผู้เล่นสุ่ม'; end if;
  select count(*) + 1 into next_number from public.club_members where club_id = target_club_id and role = 'member';
  for profile in select value from jsonb_array_elements(player_profiles) loop
    level := profile->>'skill_level';
    if level is null or public.skill_level_rank(level) < 0 then raise exception 'ระดับมือผู้เล่นสุ่มไม่ถูกต้อง'; end if;
    if jsonb_typeof(profile->'playable_skill_levels') is distinct from 'array' then raise exception 'ระดับมือที่เล่นด้วยไม่ถูกต้อง'; end if;
    select array_agg(distinct x) into playable from jsonb_array_elements_text(profile->'playable_skill_levels') x;
    if playable is null or not level = any(playable) or array_position(playable,null) is not null
      or not playable <@ array['Rookie-','Rookie','BG','N','S','P']::text[] then raise exception 'ระดับมือที่เล่นด้วยไม่ถูกต้อง'; end if;
    allow_lower := exists(select 1 from unnest(playable) x where public.skill_level_rank(x) = public.skill_level_rank(level) - 1);
    allow_higher := exists(select 1 from unnest(playable) x where public.skill_level_rank(x) = public.skill_level_rank(level) + 1);
    display_number := lpad((next_number + added_count)::text,greatest(2,length((next_number + added_count)::text)),'0');
    insert into public.club_members(club_id,display_name,nickname,role,active,skill_level,playable_skill_levels,allow_lower_level,allow_higher_level)
    values(target_club_id,'LINE Random ' || display_number,'ผู้เล่นสุ่ม ' || display_number,'member',true,level,playable,allow_lower,allow_higher)
    returning id into member_id;
    insert into public.signups(club_id,event_id,member_id,status,arrival_time,skill_level_snapshot,playable_skill_levels_snapshot,allow_lower_level_snapshot,allow_higher_level_snapshot)
    values(target_club_id,target_event_id,member_id,'coming',target_event.starts_at,level,playable,allow_lower,allow_higher);
    insert into public.attendance(club_id,event_id,member_id,arrived,arrived_at,left_at)
    values(target_club_id,target_event_id,member_id,true,target_event.starts_at,null);
    added_count := added_count + 1;
  end loop;
  insert into public.audit_logs(club_id,event_id,actor_id,action,details)
  values(target_club_id,target_event_id,auth.uid(),'เพิ่มผู้เล่นสุ่มพร้อมเข้าคิวในโหมดทดลอง',jsonb_build_object('count',added_count,'test_only',true));
  return added_count;
end;
$$;

-- Manual "save" is one atomic approved queue; old draft callers stay supported.
create function public.create_manual_queue(target_event_id uuid, selected_member_ids uuid[], team_a_member_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare created_id uuid;
begin
  created_id := public.create_manual_queue_with_players(target_event_id,selected_member_ids,team_a_member_ids);
  perform public.approve_queue_draft(created_id);
  return created_id;
end;
$$;

-- Newly generated automatic queues are ready immediately. Keep the existing
-- FIFO/fallback planners as internal draft primitives and approve before this
-- RPC returns. Any approval failure rolls the complete creation back.
create function public.create_automatic_queue(target_event_id uuid, selected_member_ids uuid[], team_a_member_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare created_id uuid;
begin
  created_id := public.create_queue_draft(target_event_id,selected_member_ids,team_a_member_ids);
  perform public.approve_queue_draft(created_id);
  return created_id;
end;
$$;

create function public.create_automatic_queues(target_event_id uuid, queue_lineups jsonb)
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare created_ids uuid[]; created_id uuid;
begin
  created_ids := public.create_queue_drafts_batch(target_event_id,queue_lineups);
  foreach created_id in array created_ids loop
    perform public.approve_queue_draft(created_id);
  end loop;
  return created_ids;
end;
$$;

-- Validate the complete snapshot before mutating any queue. The subsequent
-- cancellation compacts positions and increments revisions, so never recheck
-- stale request revisions between cancellations in the same transaction.
create function public.cancel_upcoming_queues(target_event_id uuid, requested_matches jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare target_club_id uuid; entry record; current_match public.queue_matches%rowtype; requested_count integer; selected_ids uuid[]; match_ids uuid[];
begin
  select club_id into target_club_id from public.events where id = target_event_id;
  if target_club_id is null or not public.is_club_operator(target_club_id) then raise exception 'ไม่มีสิทธิ์ยกเลิกคิว'; end if;
  if jsonb_typeof(requested_matches) is distinct from 'array' or jsonb_array_length(requested_matches) < 1 then raise exception 'กรุณาเลือกคิวที่ต้องการลบ'; end if;
  requested_count := jsonb_array_length(requested_matches);
  if (select count(distinct match_id) from jsonb_to_recordset(requested_matches) r(match_id uuid)) <> requested_count then raise exception 'รายการคิวซ้ำหรือไม่ถูกต้อง'; end if;
  perform pg_advisory_xact_lock(hashtext(target_event_id::text));
  if not exists(select 1 from public.events where id = target_event_id and status = 'open') then raise exception 'รอบนี้ปิดแล้ว กรุณาโหลดข้อมูลใหม่'; end if;
  for entry in select * from jsonb_to_recordset(requested_matches) r(match_id uuid,revision bigint) order by match_id loop
    select * into current_match from public.queue_matches where id = entry.match_id for update;
    if current_match.id is null or current_match.event_id <> target_event_id or current_match.status not in ('draft','approved')
      or entry.revision is null or current_match.revision <> entry.revision then
      raise exception 'มีคิวถูกแก้ไขหรือลงสนามจากเครื่องอื่นแล้ว กรุณาโหลดคิวล่าสุดก่อนลบ';
    end if;
  end loop;
  select array_agg(match_id) into match_ids from jsonb_to_recordset(requested_matches) r(match_id uuid);
  select array_agg(distinct member_id) into selected_ids from public.queue_match_players where match_id = any(match_ids);
  update public.queue_matches set status = 'cancelled',queue_position = null,ended_at = now() where id = any(match_ids);
  update public.event_queue_players q set status = 'waiting'
    where event_id = target_event_id and member_id = any(selected_ids) and status = 'reserved'
      and not exists(select 1 from public.queue_match_players p join public.queue_matches m on m.id = p.match_id
        where p.event_id = target_event_id and p.member_id = q.member_id and m.status = 'approved');
  -- Compact once, not once per deleted card, so a large selection stays linear.
  perform public.compact_upcoming_queue(target_event_id);
  insert into public.audit_logs(club_id,event_id,actor_id,action,details) values
    (target_club_id,target_event_id,auth.uid(),'ยกเลิกคิวล่วงหน้าที่เลือก',jsonb_build_object('match_ids',match_ids,'count',requested_count));
  return requested_count;
end;
$$;

create or replace function public.start_next_queue_on_court(target_event_id uuid, target_court_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  target_event public.events%rowtype; target_court public.event_courts%rowtype;
  target_match public.queue_matches%rowtype; selected_ids uuid[]; stale_match_id uuid; compatible boolean; test_clock boolean;
begin
  select * into target_event from public.events where id = target_event_id;
  if target_event.id is null or not public.is_club_operator(target_event.club_id) then raise exception 'ไม่มีสิทธิ์เริ่มเกม'; end if;
  perform pg_advisory_xact_lock(hashtext(target_event_id::text));
  select * into target_event from public.events where id = target_event_id and status = 'open';
  if target_event.id is null then raise exception 'รอบนี้ปิดแล้ว กรุณาโหลดข้อมูลใหม่'; end if;
  select is_test into test_clock from public.clubs where id = target_event.club_id;
  select * into target_court from public.event_courts where id = target_court_id and event_id = target_event_id;
  if target_court.id is null then raise exception 'ไม่พบคอร์ทนี้'; end if;
  if not test_clock then
    if now() < public.event_local_instant(target_event.event_date,target_event.starts_at,target_court.starts_at) then raise exception 'คอร์ทนี้ยังไม่ถึงเวลาเริ่ม'; end if;
    if now() >= public.event_local_instant(target_event.event_date,target_event.starts_at,target_court.ends_at) then raise exception 'คอร์ทนี้หมดเวลาแล้ว'; end if;
  end if;
  if exists(select 1 from public.queue_matches where event_id = target_event_id and court_id = target_court_id and status = 'playing') then raise exception 'คอร์ทนี้กำลังใช้งาน'; end if;
  select * into target_match from public.queue_matches where event_id = target_event_id and status in ('draft','approved') order by queue_position,proposed_at limit 1;
  if target_match.id is null then raise exception 'ยังไม่มีคิวล่วงหน้า'; end if;
  select array_agg(member_id) into selected_ids from public.queue_match_players where match_id = target_match.id;
  perform 1 from public.attendance where event_id = target_event_id and member_id = any(selected_ids) order by member_id for share;
  select * into target_match from public.queue_matches where id = target_match.id for update;
  if target_match.status <> 'approved' then raise exception 'กรุณาตรวจและอนุมัติคิว 1 ก่อนนำลงสนาม'; end if;
  if coalesce(cardinality(selected_ids),0) <> 4 then raise exception 'ผู้เล่นในคิว 1 ไม่ครบ 4 คน'; end if;
  if (select count(*) from public.attendance where event_id = target_event_id and member_id = any(selected_ids) and arrived and left_at is null) <> 4 then raise exception 'มีผู้เล่นในคิว 1 กลับแล้ว กรุณาแก้คิวก่อน'; end if;
  -- A test court is always available, so its old booking end must never silently
  -- finish a game whose players are still on court. Real-round recovery remains.
  for stale_match_id in
    select distinct playing.id from public.queue_match_players selected_player
    join public.queue_match_players playing_player on playing_player.member_id = selected_player.member_id
    join public.queue_matches playing on playing.id = playing_player.match_id and playing.status = 'playing'
    join public.event_courts playing_court on playing_court.id = playing.court_id
    where not test_clock and selected_player.match_id = target_match.id and playing.id <> target_match.id and playing.event_id = target_event_id
      and public.event_local_instant(target_event.event_date,target_event.starts_at,playing_court.ends_at) <= now()
  loop perform public.finish_queue_match(stale_match_id); end loop;
  if exists(select 1 from public.queue_match_players p join public.queue_matches m on m.id = p.match_id
    where p.member_id = any(selected_ids) and m.id <> target_match.id and m.event_id = target_event_id and m.status = 'playing')
    then raise exception 'ผู้เล่นในคิว 1 ยังเล่นอยู่ในสนาม กรุณารอให้จบเกมก่อน'; end if;
  if (select count(*) from public.event_queue_players where event_id = target_event_id and member_id = any(selected_ids) and status = 'reserved') <> 4 then raise exception 'ผู้เล่นในคิว 1 ยังไม่พร้อม กรุณาโหลดข้อมูลใหม่หรือแก้คิวก่อน'; end if;
  select max(public.skill_level_rank(skill_level_snapshot)) - min(public.skill_level_rank(skill_level_snapshot)) <= 1
    into compatible from public.queue_match_players where match_id = target_match.id;
  if not compatible and not target_match.manual_override then raise exception 'คิวนี้ไม่ตรงกับเงื่อนไขระดับมือ กรุณาตรวจรายชื่อก่อน'; end if;
  update public.queue_matches set status = 'playing',court_id = target_court_id,queue_position = null,started_at = now() where id = target_match.id;
  update public.event_queue_players set status = 'playing' where event_id = target_event_id and member_id = any(selected_ids);
  perform public.compact_upcoming_queue(target_event_id);
  insert into public.audit_logs(club_id,event_id,actor_id,action,details) values
    (target_event.club_id,target_event_id,auth.uid(),'นำคิว 1 ลงสนาม',jsonb_build_object('match_id',target_match.id,'court_id',target_court_id,'manual_override',target_match.manual_override,'skill_warning',not compatible,'test_clock',test_clock));
  return target_match.id;
end;
$$;

create or replace function public.finish_queue_match(target_match_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare target_event_id uuid; target_match public.queue_matches%rowtype; selected_ids uuid[]; played_minutes integer;
begin
  target_event_id := public.lock_queue_event_for_match(target_match_id);
  if not exists(select 1 from public.events e join public.clubs c on c.id = e.club_id where e.id = target_event_id and c.is_test) then
    return public.queue_finish_legacy(target_match_id);
  end if;
  select * into target_match from public.queue_matches where id = target_match_id for update;
  if target_match.status <> 'playing' or target_match.started_at is null then raise exception 'เกมนี้ยังไม่ได้เริ่ม'; end if;
  played_minutes := greatest(1,floor(extract(epoch from (now() - target_match.started_at)) / 60)::integer);
  select array_agg(member_id) into selected_ids from public.queue_match_players where match_id = target_match_id;
  update public.queue_matches set status = 'completed',queue_position = null,ended_at = now() where id = target_match_id;
  update public.event_queue_players q set
    status = case when exists(select 1 from public.queue_match_players p join public.queue_matches m on m.id = p.match_id
      where p.event_id = target_event_id and p.member_id = q.member_id and m.status = 'approved') then 'reserved' else 'waiting' end,
    games_played = games_played + 1,minutes_played = minutes_played + played_minutes,queued_at = now()
    where q.event_id = target_event_id and q.member_id = any(selected_ids);
  update public.signups s set skill_level_snapshot = m.skill_level,playable_skill_levels_snapshot = m.playable_skill_levels,
    allow_lower_level_snapshot = m.allow_lower_level,allow_higher_level_snapshot = m.allow_higher_level
    from public.club_members m where s.event_id = target_event_id and s.member_id = m.id and s.member_id = any(selected_ids);
  insert into public.audit_logs(club_id,event_id,actor_id,action,details) values
    (target_match.club_id,target_event_id,auth.uid(),'จบเกมในคอร์ททดลอง',jsonb_build_object('match_id',target_match_id,'minutes',played_minutes,'ended_at',now(),'test_clock',true));
  return played_minutes;
end;
$$;

revoke all on function public.prepare_test_round(uuid) from public,anon;
revoke all on function public.add_random_test_players(uuid,uuid,jsonb) from public,anon;
revoke all on function public.create_manual_queue(uuid,uuid[],uuid[]) from public,anon;
revoke all on function public.create_automatic_queue(uuid,uuid[],uuid[]) from public,anon;
revoke all on function public.create_automatic_queues(uuid,jsonb) from public,anon;
revoke all on function public.cancel_upcoming_queues(uuid,jsonb) from public,anon;
revoke all on function public.start_next_queue_on_court(uuid,uuid) from public,anon;
revoke all on function public.finish_queue_match(uuid) from public,anon;
grant execute on function public.prepare_test_round(uuid) to authenticated;
grant execute on function public.add_random_test_players(uuid,uuid,jsonb) to authenticated;
grant execute on function public.create_manual_queue(uuid,uuid[],uuid[]) to authenticated;
grant execute on function public.create_automatic_queue(uuid,uuid[],uuid[]) to authenticated;
grant execute on function public.create_automatic_queues(uuid,jsonb) to authenticated;
grant execute on function public.cancel_upcoming_queues(uuid,jsonb) to authenticated;
grant execute on function public.start_next_queue_on_court(uuid,uuid) to authenticated;
grant execute on function public.finish_queue_match(uuid) to authenticated;
