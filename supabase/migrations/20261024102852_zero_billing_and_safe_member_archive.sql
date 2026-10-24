-- The migration runner executes this file in one transaction. Fail quickly if
-- live traffic holds a conflicting DDL lock; never wait behind an active game.
set local lock_timeout = '2s';
set local statement_timeout = '20s';

-- Allow zero shared-cost weight without changing any existing attendance or bill.
alter table public.attendance drop constraint attendance_billing_percentage_check;
alter table public.attendance add constraint attendance_billing_percentage_check
  check (billing_percentage in (0, 25, 50, 75, 100));

comment on column public.attendance.billing_percentage is
'Admin-selected share of playing time used to split shared costs. Zero excludes shared costs, not personal extras. Per-round billing is unaffected.';

-- Archive only the directory identity. Never delete historical/financial rows or
-- hide a player still referenced by an unfinished round or an active queue.
create function public.archive_club_member(target_member_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  member_row public.club_members%rowtype;
  locked_event_id uuid;
begin
  select * into member_row from public.club_members where id = target_member_id;
  if member_row.id is null then raise exception 'ไม่พบรายชื่อ กรุณาโหลดข้อมูลล่าสุด'; end if;
  if not public.is_club_admin(member_row.club_id) then raise exception 'เฉพาะแอดมินที่ลบรายชื่อผู้เล่นได้'; end if;
  -- Use the existing member -> event lock order. Never wait while holding the
  -- member lock for a queue writer, which may itself be performing an FK check.
  select * into member_row from public.club_members where id = target_member_id for no key update nowait;
  if member_row.id is null then raise exception 'ไม่พบรายชื่อ กรุณาโหลดข้อมูลล่าสุด'; end if;
  if not public.is_club_admin(member_row.club_id) then raise exception 'เฉพาะแอดมินที่ลบรายชื่อผู้เล่นได้'; end if;
  if member_row.role <> 'member' then raise exception 'ไม่สามารถลบบัญชีเจ้าของหรือสตาฟ'; end if;
  for locked_event_id in select id from public.events where club_id = member_row.club_id order by id loop
    if not pg_try_advisory_xact_lock(hashtext(locked_event_id::text)) then
      raise exception 'มีรายการกำลังบันทึกในกลุ่มนี้ กรุณารอแล้วลองลบรายชื่ออีกครั้ง';
    end if;
  end loop;
  -- Block new FK references during the guarded check; fail safely if any writer
  -- already holds a reference lock. No existing child row is changed or removed.
  perform 1 from public.club_members where id = target_member_id for update nowait;
  if exists (select 1 from public.signups s join public.events e on e.id = s.event_id
      where s.member_id = target_member_id and e.status in ('draft', 'open'))
    or exists (select 1 from public.attendance a join public.events e on e.id = a.event_id
      where a.member_id = target_member_id and e.status in ('draft', 'open'))
    or exists (select 1 from public.event_queue_players q join public.events e on e.id = q.event_id
      where q.member_id = target_member_id and (e.status in ('draft', 'open') or q.status in ('reserved', 'playing')))
    or exists (select 1 from public.queue_match_players p join public.queue_matches m on m.id = p.match_id
      where p.member_id = target_member_id and m.status in ('draft', 'approved', 'playing')) then
    raise exception 'ยังลบไม่ได้ ผู้เล่นมีชื่อในรอบที่ยังไม่จบหรืออยู่ในคิว กรุณาจบรอบหรือนำชื่อออกจากรอบก่อน';
  end if;
  if member_row.active then
    update public.club_members set active = false where id = target_member_id;
    insert into public.audit_logs(club_id, actor_id, action, details) values
      (member_row.club_id, auth.uid(), 'ลบผู้เล่นออกจากรายชื่อเดิม',
       jsonb_build_object('member_id', target_member_id, 'name', coalesce(member_row.nickname, member_row.display_name), 'archived', true));
  end if;
  return target_member_id;
exception when lock_not_available then
  raise exception 'มีรายการกำลังบันทึกของผู้เล่นนี้ กรุณารอแล้วลองลบรายชื่ออีกครั้ง';
end;
$$;

revoke all on function public.archive_club_member(uuid) from public, anon;
grant execute on function public.archive_club_member(uuid) to authenticated;

-- Protect live real rounds even from an older cached client using a direct
-- DELETE. The row DELETE lock also conflicts with child inserts' FK key-share
-- locks; do not acquire an advisory lock here and invert queue creation order.
create function public.protect_unfinished_real_event_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.clubs where id = old.club_id and is_test = true) then return old; end if;
  if old.status = 'open' then raise exception 'ลบรอบจริงที่เปิดอยู่ไม่ได้ กรุณาจบรอบก่อน'; end if;
  if old.status = 'draft' and (
    exists(select 1 from public.signups where event_id = old.id)
    or exists(select 1 from public.attendance where event_id = old.id)
    or exists(select 1 from public.queue_matches where event_id = old.id)
    or exists(select 1 from public.event_queue_players where event_id = old.id)
    or exists(select 1 from public.payments where event_id = old.id)
    or exists(select 1 from public.member_extra_charges where event_id = old.id)
    or exists(select 1 from public.expenses where event_id = old.id)
    or exists(select 1 from public.shuttlecock_checkpoints where event_id = old.id)
    or exists(select 1 from public.per_round_billing_snapshots where event_id = old.id)
  ) then
    raise exception 'รอบนี้มีผู้เล่นหรือข้อมูลใช้งานแล้ว จึงลบไม่ได้ กรุณาเปิดใช้รอบเดิม';
  end if;
  return old;
end;
$$;
revoke all on function public.protect_unfinished_real_event_delete() from public, anon, authenticated;
create trigger protect_unfinished_real_event_delete before delete on public.events
for each row execute function public.protect_unfinished_real_event_delete();

-- An in-progress venue correction is independent from date, court, queue and
-- finance editors. Save the venue, directory choice and audit atomically.
create function public.update_event_venue(target_club_id uuid, target_event_id uuid, next_venue text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_event public.events%rowtype; clean_venue text := trim(next_venue);
begin
  if not public.is_club_admin(target_club_id) then raise exception 'เฉพาะแอดมินที่แก้ไขสถานที่ได้'; end if;
  if clean_venue is null or char_length(clean_venue) not between 1 and 120 then raise exception 'กรุณากรอกสถานที่ 1–120 ตัวอักษร'; end if;
  select * into target_event from public.events where id = target_event_id and club_id = target_club_id for no key update nowait;
  if target_event.id is null then raise exception 'ไม่พบรอบในกลุ่มนี้ กรุณาโหลดข้อมูลล่าสุด'; end if;
  if target_event.status not in ('draft', 'open') then raise exception 'แก้สถานที่ได้เฉพาะรอบที่ยังไม่จบ'; end if;
  if target_event.venue is distinct from clean_venue then
    update public.events set venue = clean_venue where id = target_event_id and club_id = target_club_id;
    insert into public.club_venues(club_id, name) values(target_club_id, clean_venue) on conflict(club_id, name) do nothing;
    insert into public.audit_logs(club_id,event_id,actor_id,action,details) values
      (target_club_id,target_event_id,auth.uid(),'แก้ไขสถานที่ของรอบเดิม',jsonb_build_object('from',target_event.venue,'to',clean_venue));
    select * into target_event from public.events where id = target_event_id;
  end if;
  return to_jsonb(target_event);
exception when lock_not_available then
  raise exception 'รอบนี้กำลังบันทึกจากอีกเครื่อง กรุณารอแล้วแก้สถานที่อีกครั้ง';
end;
$$;
revoke all on function public.update_event_venue(uuid,uuid,text) from public, anon;
grant execute on function public.update_event_venue(uuid,uuid,text) to authenticated;
