-- Additive only: no existing round, participant, match or bill is rewritten.
set local lock_timeout = '2s';
set local statement_timeout = '20s';

alter table public.signups
  add column removed_at timestamptz,
  add column removed_by uuid references public.profiles(id) on delete set null;
comment on column public.signups.removed_at is 'Withdrawn from operational roster only; original attendance, completed games and financial records are retained.';

create function public.can_operate_current_event(target_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select public.is_club_admin(e.club_id) or (
    public.is_club_operator(e.club_id) and e.id=(select current_event.id from public.events current_event
      where current_event.club_id=e.club_id and current_event.status in ('open','closed')
      order by (current_event.status='open') desc,current_event.event_date desc,current_event.created_at desc limit 1)
  ) from public.events e where e.id=target_event_id),false);
$$;
revoke all on function public.can_operate_current_event(uuid) from public,anon,authenticated;

-- A late LINE upsert/delete must not undo an operator's withdrawal. Profile
-- propagation may still update the master identity, but its withdrawn snapshot
-- stays historical. Restoring metadata is an explicitly authorized operation.
create function public.preserve_withdrawn_signup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.removed_at is null then
    if tg_op='DELETE' then return old; end if;
    if new.removed_at is not null and current_setting('app.withdrawing_participant',true) is distinct from old.event_id::text||':'||old.member_id::text then
      raise exception 'กรุณาใช้คำสั่งนำผู้เล่นออกจากรอบ';
    end if;
    return new;
  end if;
  if tg_op='DELETE' then
    if exists(select 1 from public.events where id=old.event_id) then raise exception 'รายชื่อนี้นำออกแล้วและเก็บประวัติไว้ กรุณาเพิ่มกลับผ่านหน้าผู้เล่น'; end if;
    return old;
  end if;
  if new.removed_at is null then
    if current_setting('app.restoring_participant',true) is distinct from old.event_id::text||':'||old.member_id::text then
      raise exception 'กรุณาใช้คำสั่งเพิ่มผู้เล่นกลับเข้ารอบ';
    end if;
    return new;
  end if;
  if (to_jsonb(new)-array['updated_at','skill_level_snapshot','playable_skill_levels_snapshot','allow_lower_level_snapshot','allow_higher_level_snapshot'])
    is distinct from (to_jsonb(old)-array['updated_at','skill_level_snapshot','playable_skill_levels_snapshot','allow_lower_level_snapshot','allow_higher_level_snapshot']) then
    raise exception 'รายชื่อนี้ถูกนำออกจากรอบแล้ว กรุณาเพิ่มกลับก่อนแก้ข้อมูล';
  end if;
  return old;
end;
$$;
create trigger zz_signups_preserve_removed before update or delete on public.signups
for each row execute function public.preserve_withdrawn_signup();
revoke all on function public.preserve_withdrawn_signup() from public,anon,authenticated;

-- Legacy finish/cancel/save paths used to revive a departed player. Enforce the
-- invariant at their common write boundary, including old cached clients.
create function public.guard_queue_player_availability()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('waiting','reserved','proposed') and (
    not exists(select 1 from public.attendance a where a.event_id=new.event_id and a.member_id=new.member_id and a.arrived and a.left_at is null)
    or exists(select 1 from public.signups s where s.event_id=new.event_id and s.member_id=new.member_id and s.removed_at is not null)
    or exists(select 1 from public.events e where e.id=new.event_id and e.status='closed')
  ) then new.status := 'left'; end if;
  return new;
end;
$$;
create trigger queue_player_availability before insert or update of status on public.event_queue_players
for each row execute function public.guard_queue_player_availability();
revoke all on function public.guard_queue_player_availability() from public,anon,authenticated;

create or replace function public.operator_remove_event_participant(target_event_id uuid,target_member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target_event public.events%rowtype; target_signup public.signups%rowtype; affected_ids uuid[]; cancelled_ids uuid[];
begin
  select * into target_event from public.events where id=target_event_id for no key update nowait;
  if target_event.id is null or not public.can_operate_current_event(target_event_id) then
    raise exception 'ไม่มีสิทธิ์นำผู้เล่นออกจากรอบนี้';
  end if;
  if not pg_try_advisory_xact_lock(hashtext(target_event_id::text)) then raise exception 'คิวกำลังบันทึก กรุณารอแล้วลองอีกครั้ง'; end if;
  perform 1 from public.attendance where event_id=target_event_id and member_id=target_member_id for update nowait;
  select * into target_signup from public.signups where event_id=target_event_id and member_id=target_member_id for update nowait;
  if target_signup.id is null then raise exception 'ไม่พบผู้เล่นในรอบนี้'; end if;
  if target_signup.removed_at is not null then return; end if;
  if exists(select 1 from public.queue_match_players p join public.queue_matches m on m.id=p.match_id
    where p.event_id=target_event_id and p.member_id=target_member_id and m.status='playing') then
    raise exception 'ผู้เล่นกำลังเล่นในสนาม กรุณาจบเกมก่อนนำออกจากรอบ';
  end if;
  select array_agg(distinct m.id) into cancelled_ids from public.queue_matches m join public.queue_match_players p on p.match_id=m.id
    where m.event_id=target_event_id and p.member_id=target_member_id and m.status in ('draft','approved');
  select array_agg(distinct member_id) into affected_ids from public.queue_match_players where match_id=any(cancelled_ids);
  perform set_config('app.withdrawing_participant',target_event_id::text||':'||target_member_id::text,true);
  update public.signups set removed_at=now(),removed_by=auth.uid() where id=target_signup.id;
  -- Tombstone upcoming matches, retaining their original lineups for audit.
  update public.queue_matches set status='cancelled',queue_position=null where id=any(cancelled_ids);
  update public.event_queue_players q set status=case
    when exists(select 1 from public.queue_match_players p join public.queue_matches m on m.id=p.match_id where p.event_id=q.event_id and p.member_id=q.member_id and m.status='playing') then 'playing'
    when exists(select 1 from public.queue_match_players p join public.queue_matches m on m.id=p.match_id where p.event_id=q.event_id and p.member_id=q.member_id and m.status='approved') then 'reserved'
    else 'waiting' end
    where q.event_id=target_event_id and q.member_id=any(affected_ids);
  update public.event_queue_players set status='left' where event_id=target_event_id and member_id=target_member_id;
  perform public.compact_upcoming_queue(target_event_id);
  insert into public.audit_logs(club_id,event_id,actor_id,action,details) values
    (target_event.club_id,target_event_id,auth.uid(),'นำผู้เล่นออกจากรายชื่อรอบโดยเก็บประวัติและยอดเงิน',
      jsonb_build_object('member_id',target_member_id,'cancelled_match_ids',coalesce(cancelled_ids,'{}'::uuid[]),'preserved_history',true));
exception when lock_not_available then raise exception 'ข้อมูลผู้เล่นกำลังบันทึก กรุณารอแล้วลองอีกครั้ง';
end;
$$;
revoke all on function public.operator_remove_event_participant(uuid,uuid) from public,anon;
grant execute on function public.operator_remove_event_participant(uuid,uuid) to authenticated;

create function public.restore_event_participant(target_event_id uuid,target_member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target_event public.events%rowtype;
begin
  select * into target_event from public.events where id=target_event_id for no key update nowait;
  if target_event.id is null or not public.can_operate_current_event(target_event_id) then raise exception 'ไม่มีสิทธิ์เพิ่มผู้เล่นกลับเข้ารอบนี้'; end if;
  if not pg_try_advisory_xact_lock(hashtext(target_event_id::text)) then raise exception 'คิวกำลังบันทึก กรุณารอแล้วลองอีกครั้ง'; end if;
  perform 1 from public.attendance where event_id=target_event_id and member_id=target_member_id for update nowait;
  perform set_config('app.restoring_participant',target_event_id::text||':'||target_member_id::text,true);
  update public.signups set removed_at=null,removed_by=null where event_id=target_event_id and member_id=target_member_id and removed_at is not null;
  if not found then return; end if;
  -- Restoring a name is not a new check-in and never erases a departure time.
  update public.event_queue_players set status='waiting' where event_id=target_event_id and member_id=target_member_id and status='left';
  insert into public.audit_logs(club_id,event_id,actor_id,action,details) values
    (target_event.club_id,target_event_id,auth.uid(),'เพิ่มผู้เล่นที่นำออกกลับเข้ารอบเดิม',jsonb_build_object('member_id',target_member_id));
exception when lock_not_available then raise exception 'ข้อมูลผู้เล่นกำลังบันทึก กรุณารอแล้วลองอีกครั้ง';
end;
$$;
revoke all on function public.restore_event_participant(uuid,uuid) from public,anon;
grant execute on function public.restore_event_participant(uuid,uuid) to authenticated;

alter function public.operator_add_event_participant(uuid,uuid,text,text) rename to operator_add_event_participant_legacy;
revoke all on function public.operator_add_event_participant_legacy(uuid,uuid,text,text) from public,anon,authenticated;
create function public.operator_add_event_participant(target_event_id uuid,target_member_id uuid,next_nickname text,next_skill_level text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if target_member_id is not null and exists(select 1 from public.signups where event_id=target_event_id and member_id=target_member_id and removed_at is not null) then
    perform public.restore_event_participant(target_event_id,target_member_id);
    return target_member_id;
  end if;
  return public.operator_add_event_participant_legacy(target_event_id,target_member_id,next_nickname,next_skill_level);
end;
$$;
revoke all on function public.operator_add_event_participant(uuid,uuid,text,text) from public,anon;
grant execute on function public.operator_add_event_participant(uuid,uuid,text,text) to authenticated;

-- Reuse the coherent, staff-redacted snapshot so removed metadata is available
-- on initial load as well as the five-second operational refresh.
create or replace function public.load_staff_dashboard(target_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare target_event_id uuid;
begin
  if not public.is_club_operator(target_club_id) then raise exception 'ไม่มีสิทธิ์เปิดหน้าปฏิบัติงาน'; end if;
  select id into target_event_id from public.events where club_id=target_club_id and status in ('open','closed')
    order by (status='open') desc,event_date desc,created_at desc limit 1;
  if target_event_id is null then return jsonb_build_object('event',null); end if;
  return public.load_queue_state(target_event_id);
end;
$$;

create or replace function public.load_staff_player_operations(target_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare target_event_id uuid;
begin
  if not public.is_club_operator(target_club_id) then raise exception 'ไม่มีสิทธิ์เปิดข้อมูลปฏิบัติงาน'; end if;
  select id into target_event_id from public.events where club_id=target_club_id and status in ('open','closed')
    order by (status='open') desc,event_date desc,created_at desc limit 1;
  if target_event_id is null then return jsonb_build_object('extraItems','[]'::jsonb,'memberExtras','[]'::jsonb); end if;
  return jsonb_build_object(
    'extraItems',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.name) order by i.created_at)
      from public.extra_item_catalog i where club_id=target_club_id and active),'[]'::jsonb),
    'memberExtras',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'member_id',x.member_id,'item_name',x.item_name,'quantity',x.quantity,'created_at',x.created_at) order by x.created_at)
      from public.member_extra_charges x where event_id=target_event_id),'[]'::jsonb));
end;
$$;

-- A booking correction changes current estimates, not previously approved
-- amounts or a transfer already under review. Expense/rate/attendance guards
-- retain their existing explicit correction policy.
drop trigger court_reopen_changed_bills on public.event_courts;

-- Keep court schedule derivation, but never rewrite actual attendance or the
-- signup's original arrival merely because a booking was extended afterwards.
create or replace function public.sync_event_schedule_from_courts(target_event_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare start_values integer[]; start_count integer; start_minute integer; end_minute integer;
  current_minute integer; next_minute integer; current_gap integer; largest_gap integer := -1; i integer;
begin
  if target_event_id is null then return; end if;
  select array_agg(value order by value) into start_values from (
    select distinct extract(hour from starts_at)::integer*60+extract(minute from starts_at)::integer as value
    from public.event_courts where event_id=target_event_id) starts;
  start_count:=coalesce(array_length(start_values,1),0); if start_count=0 then return; end if;
  start_minute:=start_values[1];
  if start_count>1 then for i in 1..start_count loop
    current_minute:=start_values[i]; next_minute:=case when i=start_count then start_values[1]+1440 else start_values[i+1] end;
    current_gap:=next_minute-current_minute;
    if current_gap>largest_gap then largest_gap:=current_gap; start_minute:=next_minute%1440; end if;
  end loop; end if;
  select max(extract(hour from ends_at)::integer*60+extract(minute from ends_at)::integer+
    case when extract(hour from ends_at)::integer*60+extract(minute from ends_at)::integer<=start_minute then 1440 else 0 end)
    into end_minute from public.event_courts where event_id=target_event_id;
  update public.events set starts_at=make_time(start_minute/60,start_minute%60,0),ends_at=make_time((end_minute%1440)/60,end_minute%60,0)
    where id=target_event_id and (starts_at is distinct from make_time(start_minute/60,start_minute%60,0)
      or ends_at is distinct from make_time((end_minute%1440)/60,end_minute%60,0));
end;
$$;

create or replace function public.operator_upsert_event_court(target_event_id uuid,target_court_id uuid,next_court_name text,next_starts_at time,next_ends_at time)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target_event public.events%rowtype; old_court public.event_courts%rowtype; saved_id uuid; new_duration interval; old_duration interval;
begin
  select * into target_event from public.events where id=target_event_id for no key update nowait;
  if not public.can_operate_current_event(target_event_id) then raise exception 'ไม่มีสิทธิ์แก้คอร์ทในรอบนี้'; end if;
  if not pg_try_advisory_xact_lock(hashtext(target_event_id::text)) then raise exception 'คิวกำลังบันทึก กรุณารอแล้วแก้คอร์ทอีกครั้ง'; end if;
  if next_court_name is null or char_length(trim(next_court_name)) not between 1 and 60 then raise exception 'กรุณากรอกชื่อคอร์ท 1–60 ตัวอักษร'; end if;
  if next_starts_at is null or next_ends_at is null or next_starts_at=next_ends_at
    or next_starts_at>=time '24:00' or next_ends_at>=time '24:00' then
    raise exception 'เวลาจองต้องมากกว่า 0 และน้อยกว่า 24 ชั่วโมง';
  end if;
  new_duration:=next_ends_at-next_starts_at; if new_duration<interval '0' then new_duration:=new_duration+interval '1 day'; end if;
  if target_court_id is null then
    insert into public.event_courts(club_id,event_id,court_name,starts_at,ends_at,position)
      values(target_event.club_id,target_event_id,trim(next_court_name),next_starts_at,next_ends_at,
        coalesce((select max(position)+1 from public.event_courts where event_id=target_event_id),0)) returning id into saved_id;
  else
    select * into old_court from public.event_courts where id=target_court_id and event_id=target_event_id for update nowait;
    if old_court.id is null then raise exception 'ไม่พบคอร์ทในรอบนี้'; end if;
    old_duration:=old_court.ends_at-old_court.starts_at; if old_duration<=interval '0' then old_duration:=old_duration+interval '1 day'; end if;
    if exists(select 1 from public.queue_matches where event_id=target_event_id and court_id=target_court_id and status='playing')
      and (next_starts_at<>old_court.starts_at or new_duration<old_duration) then raise exception 'คอร์ทกำลังเล่นอยู่ ต่อเวลาสิ้นสุดได้ แต่ห้ามเปลี่ยนเวลาเริ่มหรือลดเวลา'; end if;
    update public.event_courts set court_name=trim(next_court_name),starts_at=next_starts_at,ends_at=next_ends_at where id=target_court_id returning id into saved_id;
  end if;
  insert into public.audit_logs(club_id,event_id,actor_id,action,details) values
    (target_event.club_id,target_event_id,auth.uid(),case when target_court_id is null then 'เพิ่มคอร์ทในรอบเดิม' else 'แก้เวลาคอร์ทในรอบเดิม' end,
      jsonb_build_object('court_id',saved_id,'old_starts_at',old_court.starts_at,'old_ends_at',old_court.ends_at,'starts_at',next_starts_at,'ends_at',next_ends_at,'round_status',target_event.status));
  return saved_id;
exception when lock_not_available then raise exception 'รอบหรือคอร์ทกำลังบันทึก กรุณารอแล้วลองอีกครั้ง';
end;
$$;

create function public.extend_court_booking(target_event_id uuid,target_court_id uuid,additional_minutes integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_event public.events%rowtype; target_court public.event_courts%rowtype; duration interval; new_end time;
begin
  select * into target_event from public.events where id=target_event_id for no key update nowait;
  if not public.can_operate_current_event(target_event_id) then raise exception 'ไม่มีสิทธิ์ต่อเวลาคอร์ทในรอบนี้'; end if;
  if additional_minutes is null or additional_minutes not between 1 and 180 then raise exception 'ต่อเวลาได้ครั้งละ 1–180 นาที'; end if;
  if not pg_try_advisory_xact_lock(hashtext(target_event_id::text)) then raise exception 'คิวกำลังบันทึก กรุณารอแล้วต่อเวลาอีกครั้ง'; end if;
  select * into target_court from public.event_courts where id=target_court_id and event_id=target_event_id for update nowait;
  if target_court.id is null then raise exception 'ไม่พบคอร์ทในรอบนี้'; end if;
  duration:=target_court.ends_at-target_court.starts_at; if duration<=interval '0' then duration:=duration+interval '1 day'; end if;
  if duration+make_interval(mins=>additional_minutes)>=interval '1 day' then raise exception 'เวลาจองรวมต้องน้อยกว่า 24 ชั่วโมง'; end if;
  new_end:=(target_court.ends_at+make_interval(mins=>additional_minutes))::time;
  if public.event_local_instant(target_event.event_date,target_event.starts_at,new_end)
    <=public.event_local_instant(target_event.event_date,target_event.starts_at,target_court.ends_at) then raise exception 'ไม่สามารถต่อเวลาข้ามไปอีกรอบวันได้'; end if;
  perform public.operator_upsert_event_court(target_event_id,target_court_id,target_court.court_name,target_court.starts_at,new_end);
  select * into target_court from public.event_courts where id=target_court_id;
  return to_jsonb(target_court);
exception when lock_not_available then raise exception 'รอบหรือคอร์ทกำลังบันทึก กรุณารอแล้วต่อเวลาอีกครั้ง';
end;
$$;
revoke all on function public.extend_court_booking(uuid,uuid,integer) from public,anon;
revoke all on function public.operator_upsert_event_court(uuid,uuid,text,time,time) from public,anon;
grant execute on function public.extend_court_booking(uuid,uuid,integer) to authenticated;
grant execute on function public.operator_upsert_event_court(uuid,uuid,text,time,time) to authenticated;

create or replace function public.operator_update_signup_arrival(target_event_id uuid,target_member_id uuid,next_arrival time)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_operate_current_event(target_event_id) then raise exception 'ไม่มีสิทธิ์แก้เวลาในรอบนี้'; end if;
  -- Keep attendance before signup locking, matching queue-start and withdrawal.
  perform 1 from public.attendance where event_id=target_event_id and member_id=target_member_id for update nowait;
  update public.signups set arrival_time=next_arrival where event_id=target_event_id and member_id=target_member_id and status='coming' and removed_at is null;
  if not found then raise exception 'ไม่พบผู้เล่นที่ยังอยู่ในรอบนี้'; end if;
  update public.attendance set arrived_at=next_arrival where event_id=target_event_id and member_id=target_member_id and arrived;
exception when lock_not_available then raise exception 'ข้อมูลผู้เล่นกำลังบันทึก กรุณารอแล้วลองอีกครั้ง';
end;
$$;
create or replace function public.operator_update_attendance(target_event_id uuid,target_member_id uuid,next_arrived boolean,next_arrived_at time,next_left_at time)
returns void language plpgsql security definer set search_path = '' as $$
declare target_club_id uuid;
begin
  select club_id into target_club_id from public.events where id=target_event_id;
  if not public.can_operate_current_event(target_event_id) then raise exception 'ไม่มีสิทธิ์เช็กชื่อในรอบนี้'; end if;
  perform 1 from public.attendance where event_id=target_event_id and member_id=target_member_id for update nowait;
  perform 1 from public.signups where event_id=target_event_id and member_id=target_member_id and status='coming' and removed_at is null for share nowait;
  if not found then raise exception 'ไม่พบผู้เล่นที่ยังอยู่ในรอบนี้'; end if;
  if (not next_arrived or next_left_at is not null) and exists(select 1 from public.queue_match_players p join public.queue_matches m on m.id=p.match_id
    where p.event_id=target_event_id and p.member_id=target_member_id and m.status='playing') then raise exception 'กรุณาจบเกมในสนามก่อนบันทึกว่าผู้เล่นกลับแล้ว'; end if;
  insert into public.attendance(club_id,event_id,member_id,arrived,arrived_at,left_at)
    values(target_club_id,target_event_id,target_member_id,next_arrived,case when next_arrived then next_arrived_at end,case when next_arrived then next_left_at end)
    on conflict(event_id,member_id) do update set arrived=excluded.arrived,arrived_at=excluded.arrived_at,left_at=excluded.left_at;
  insert into public.audit_logs(club_id,event_id,actor_id,action,details) values
    (target_club_id,target_event_id,auth.uid(),'แก้เวลาเข้าออกของผู้เล่น',jsonb_build_object('member_id',target_member_id,'arrived_at',next_arrived_at,'left_at',next_left_at));
exception when lock_not_available then raise exception 'ข้อมูลผู้เล่นกำลังบันทึก กรุณารอแล้วลองอีกครั้ง';
end;
$$;
revoke all on function public.operator_update_signup_arrival(uuid,uuid,time) from public,anon;
revoke all on function public.operator_update_attendance(uuid,uuid,boolean,time,time) from public,anon;
grant execute on function public.operator_update_signup_arrival(uuid,uuid,time) to authenticated;
grant execute on function public.operator_update_attendance(uuid,uuid,boolean,time,time) to authenticated;
