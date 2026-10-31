-- Allow an operator to correct a playing court's end time in either direction.
-- The start remains immutable while a game is playing, and no event/game rows
-- are rewritten by this migration.
set local lock_timeout = '2s';
set local statement_timeout = '20s';

create or replace function public.operator_upsert_event_court(target_event_id uuid,target_court_id uuid,next_court_name text,next_starts_at time,next_ends_at time)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target_event public.events%rowtype; old_court public.event_courts%rowtype; saved_id uuid; new_duration interval;
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
    if exists(select 1 from public.queue_matches where event_id=target_event_id and court_id=target_court_id and status='playing')
      and next_starts_at<>old_court.starts_at then raise exception 'คอร์ทกำลังเล่นอยู่ แก้เวลาจบได้ แต่ห้ามเปลี่ยนเวลาเริ่ม'; end if;
    update public.event_courts set court_name=trim(next_court_name),starts_at=next_starts_at,ends_at=next_ends_at where id=target_court_id returning id into saved_id;
  end if;
  insert into public.audit_logs(club_id,event_id,actor_id,action,details) values
    (target_event.club_id,target_event_id,auth.uid(),case when target_court_id is null then 'เพิ่มคอร์ทในรอบเดิม' else 'แก้เวลาคอร์ทในรอบเดิม' end,
      jsonb_build_object('court_id',saved_id,'old_starts_at',old_court.starts_at,'old_ends_at',old_court.ends_at,'starts_at',next_starts_at,'ends_at',next_ends_at,'round_status',target_event.status));
  return saved_id;
exception when lock_not_available then raise exception 'รอบหรือคอร์ทกำลังบันทึก กรุณารอแล้วลองอีกครั้ง';
end;
$$;

revoke all on function public.operator_upsert_event_court(uuid,uuid,text,time,time) from public,anon;
grant execute on function public.operator_upsert_event_court(uuid,uuid,text,time,time) to authenticated;
