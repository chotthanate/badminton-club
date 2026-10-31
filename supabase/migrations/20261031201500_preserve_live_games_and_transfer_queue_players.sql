-- Court booking time is an availability boundary, not an automatic game end.
-- Queue-to-queue transfers are explicit and atomic so a player is never lost
-- between two cards when another device edits the queue concurrently.
set local lock_timeout = '2s';
set local statement_timeout = '20s';

create function public.save_manual_queue_with_transfers(
  target_event_id uuid,
  target_match_id uuid,
  slot_assignments jsonb,
  expected_revision bigint,
  transfer_requests jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  resolved_event_id uuid;
  target_club_id uuid;
  selected_ids uuid[];
  team_a_ids uuid[];
  player_count integer;
  created_match_id uuid;
  saved_revision bigint;
  source record;
  source_match public.queue_matches%rowtype;
  requested_count integer;
  present_count integer;
begin
  if jsonb_typeof(slot_assignments) is distinct from 'array' then
    raise exception 'กรุณาเลือกผู้เล่นอย่างน้อย 1 คน';
  end if;
  player_count := jsonb_array_length(slot_assignments);
  if player_count not between 1 and 4
    or (select count(distinct member_id) from jsonb_to_recordset(slot_assignments) s(member_id uuid)) <> player_count
    or exists(select 1 from jsonb_to_recordset(slot_assignments) s(member_id uuid, team text, position integer)
      where member_id is null or team not in ('A','B') or position not between 1 and 2)
    or (select count(distinct (team,position)) from jsonb_to_recordset(slot_assignments) s(team text,position integer)) <> player_count then
    raise exception 'รายชื่อผู้เล่นหรือช่องทีมไม่ถูกต้อง';
  end if;
  select array_agg(member_id order by ordinal),
         array_agg(member_id order by ordinal) filter(where team='A')
    into selected_ids,team_a_ids
  from jsonb_to_recordset(slot_assignments) with ordinality s(member_id uuid,team text,position integer,ordinal bigint);

  if target_match_id is not null then
    select event_id into resolved_event_id from public.queue_matches where id=target_match_id;
    if resolved_event_id is null then raise exception 'ไม่พบคิวนี้ กรุณาโหลดข้อมูลใหม่'; end if;
    if target_event_id is not null and target_event_id<>resolved_event_id then raise exception 'คิวไม่อยู่ในรอบนี้'; end if;
  else
    resolved_event_id:=target_event_id;
  end if;
  select club_id into target_club_id from public.events where id=resolved_event_id and status='open';
  if target_club_id is null or not public.is_club_operator(target_club_id) then raise exception 'ไม่มีสิทธิ์จัดคิวในรอบนี้'; end if;
  perform pg_advisory_xact_lock(hashtext(resolved_event_id::text));

  transfer_requests:=coalesce(transfer_requests,'[]'::jsonb);
  if jsonb_typeof(transfer_requests) is distinct from 'array' then raise exception 'รายการย้ายคิวไม่ถูกต้อง'; end if;
  if exists(select 1 from jsonb_to_recordset(transfer_requests) r(member_id uuid,match_id uuid,revision bigint)
    where member_id is null or match_id is null or revision is null or not(member_id=any(selected_ids)) or match_id=target_match_id) then
    raise exception 'รายการย้ายคิวไม่ถูกต้อง กรุณาโหลดข้อมูลใหม่';
  end if;
  if (select count(*) from jsonb_to_recordset(transfer_requests) r(member_id uuid))
      <> (select count(distinct member_id) from jsonb_to_recordset(transfer_requests) r(member_id uuid)) then
    raise exception 'รายการย้ายผู้เล่นซ้ำกัน';
  end if;

  for source in
    select match_id,min(revision) revision,count(distinct revision) revision_count
    from jsonb_to_recordset(transfer_requests) r(member_id uuid,match_id uuid,revision bigint)
    group by match_id order by match_id
  loop
    if source.revision_count<>1 then raise exception 'ข้อมูลคิวต้นทางไม่ตรงกัน กรุณาโหลดใหม่'; end if;
    select * into source_match from public.queue_matches where id=source.match_id for update;
    if source_match.id is null or source_match.event_id<>resolved_event_id or source_match.status not in ('draft','approved')
      or source_match.revision<>source.revision then
      raise exception 'คิวต้นทางถูกแก้จากเครื่องอื่นแล้ว กรุณาโหลดคิวล่าสุด';
    end if;
    select count(*) into requested_count from jsonb_to_recordset(transfer_requests) r(member_id uuid,match_id uuid)
      where r.match_id=source.match_id;
    select count(*) into present_count from public.queue_match_players p
      join jsonb_to_recordset(transfer_requests) r(member_id uuid,match_id uuid)
        on r.match_id=source.match_id and r.member_id=p.member_id
      where p.match_id=source.match_id;
    if present_count<>requested_count then raise exception 'ผู้เล่นถูกย้ายจากคิวต้นทางแล้ว กรุณาโหลดข้อมูลใหม่'; end if;
    delete from public.queue_match_players p using jsonb_to_recordset(transfer_requests) r(member_id uuid,match_id uuid)
      where r.match_id=source.match_id and p.match_id=source.match_id and p.member_id=r.member_id;
    if not exists(select 1 from public.queue_match_players where match_id=source.match_id) then
      update public.queue_matches set status='cancelled',queue_position=null,ended_at=now(),manual_override=true where id=source.match_id;
    else
      update public.queue_matches set status='approved',manual_override=true where id=source.match_id;
    end if;
  end loop;

  -- Every selected player already reserved in another upcoming queue must have
  -- an explicit, versioned transfer request. This prevents a silent steal.
  if exists(select 1 from public.queue_match_players p join public.queue_matches m on m.id=p.match_id
    where p.event_id=resolved_event_id and p.member_id=any(selected_ids) and m.status in ('draft','approved')
      and m.id is distinct from target_match_id) then
    raise exception 'มีผู้เล่นอยู่ในคิวอื่นและยังไม่ได้ยืนยันย้าย กรุณาโหลดข้อมูลใหม่';
  end if;

  if target_match_id is null then
    if player_count=4 then
      created_match_id:=public.create_manual_queue(resolved_event_id,selected_ids,team_a_ids);
    else
      created_match_id:=public.create_partial_manual_queue(resolved_event_id,selected_ids,team_a_ids);
    end if;
  else
    created_match_id:=target_match_id;
    if player_count=4 then
      saved_revision:=public.save_queue_lineup(target_match_id,slot_assignments,expected_revision,true);
    else
      saved_revision:=public.save_partial_queue_lineup(target_match_id,slot_assignments,expected_revision);
    end if;
  end if;
  perform public.compact_upcoming_queue(resolved_event_id);
  select revision into saved_revision from public.queue_matches where id=created_match_id;
  insert into public.audit_logs(club_id,event_id,actor_id,action,details) values
    (target_club_id,resolved_event_id,auth.uid(),'ย้ายผู้เล่นข้ามคิวและบันทึกคิว',
      jsonb_build_object('match_id',created_match_id,'member_ids',selected_ids,'transfer_requests',transfer_requests));
  return jsonb_build_object('match_id',created_match_id,'revision',saved_revision);
end;
$$;

create or replace function public.start_next_queue_on_court(target_event_id uuid,target_court_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  target_event public.events%rowtype; target_court public.event_courts%rowtype;
  target_match public.queue_matches%rowtype; selected_ids uuid[]; compatible boolean; test_clock boolean;
begin
  select * into target_event from public.events where id=target_event_id;
  if target_event.id is null or not public.is_club_operator(target_event.club_id) then raise exception 'ไม่มีสิทธิ์เริ่มเกม'; end if;
  perform pg_advisory_xact_lock(hashtext(target_event_id::text));
  select * into target_event from public.events where id=target_event_id and status='open';
  if target_event.id is null then raise exception 'รอบนี้ปิดแล้ว กรุณาโหลดข้อมูลใหม่'; end if;
  select is_test into test_clock from public.clubs where id=target_event.club_id;
  select * into target_court from public.event_courts where id=target_court_id and event_id=target_event_id;
  if target_court.id is null then raise exception 'ไม่พบคอร์ทนี้'; end if;
  if not test_clock then
    if now()<public.event_local_instant(target_event.event_date,target_event.starts_at,target_court.starts_at) then raise exception 'คอร์ทนี้ยังไม่ถึงเวลาเริ่ม'; end if;
    if now()>=public.event_local_instant(target_event.event_date,target_event.starts_at,target_court.ends_at) then raise exception 'คอร์ทนี้หมดเวลาแล้ว กรุณาต่อเวลาคอร์ทก่อน'; end if;
  end if;
  if exists(select 1 from public.queue_matches where event_id=target_event_id and court_id=target_court_id and status='playing') then raise exception 'คอร์ทนี้กำลังใช้งาน'; end if;
  select * into target_match from public.queue_matches where event_id=target_event_id and status in ('draft','approved') order by queue_position,proposed_at limit 1;
  if target_match.id is null then raise exception 'ยังไม่มีคิวล่วงหน้า'; end if;
  select array_agg(member_id) into selected_ids from public.queue_match_players where match_id=target_match.id;
  perform 1 from public.attendance where event_id=target_event_id and member_id=any(selected_ids) order by member_id for share;
  select * into target_match from public.queue_matches where id=target_match.id for update;
  if target_match.status<>'approved' then raise exception 'กรุณาบันทึกคิว 1 ก่อนนำลงสนาม'; end if;
  if coalesce(cardinality(selected_ids),0)<>4 then raise exception 'ผู้เล่นในคิว 1 ไม่ครบ 4 คน'; end if;
  if (select count(*) from public.attendance where event_id=target_event_id and member_id=any(selected_ids) and arrived and left_at is null)<>4 then raise exception 'มีผู้เล่นในคิว 1 กลับแล้ว กรุณาแก้คิวก่อน'; end if;
  -- Never finish another live match from the clock. Only the explicit
  -- finish_queue_match action may release players who are still on court.
  if exists(select 1 from public.queue_match_players p join public.queue_matches m on m.id=p.match_id
    where p.member_id=any(selected_ids) and m.id<>target_match.id and m.event_id=target_event_id and m.status='playing') then
    raise exception 'ผู้เล่นในคิว 1 ยังเล่นอยู่ในสนาม กรุณากดจบเกมก่อน';
  end if;
  if (select count(*) from public.event_queue_players where event_id=target_event_id and member_id=any(selected_ids) and status='reserved')<>4 then raise exception 'ผู้เล่นในคิว 1 ยังไม่พร้อม กรุณาโหลดข้อมูลใหม่หรือแก้คิวก่อน'; end if;
  select max(public.skill_level_rank(skill_level_snapshot))-min(public.skill_level_rank(skill_level_snapshot))<=1
    into compatible from public.queue_match_players where match_id=target_match.id;
  if not compatible and not target_match.manual_override then raise exception 'คิวนี้ไม่ตรงกับเงื่อนไขระดับมือ กรุณาตรวจรายชื่อก่อน'; end if;
  update public.queue_matches set status='playing',court_id=target_court_id,queue_position=null,started_at=now() where id=target_match.id;
  update public.event_queue_players set status='playing' where event_id=target_event_id and member_id=any(selected_ids);
  perform public.compact_upcoming_queue(target_event_id);
  insert into public.audit_logs(club_id,event_id,actor_id,action,details) values
    (target_event.club_id,target_event_id,auth.uid(),'นำคิว 1 ลงสนาม',jsonb_build_object('match_id',target_match.id,'court_id',target_court_id,'manual_override',target_match.manual_override,'skill_warning',not compatible,'test_clock',test_clock));
  return target_match.id;
end;
$$;

revoke all on function public.save_manual_queue_with_transfers(uuid,uuid,jsonb,bigint,jsonb) from public,anon;
grant execute on function public.save_manual_queue_with_transfers(uuid,uuid,jsonb,bigint,jsonb) to authenticated;
revoke all on function public.start_next_queue_on_court(uuid,uuid) from public,anon;
grant execute on function public.start_next_queue_on_court(uuid,uuid) to authenticated;
