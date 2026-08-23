create or replace function public.guard_locked_shuttlecock_checkpoints()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event_id uuid := coalesce(new.event_id, old.event_id);
begin
  if coalesce(current_setting('app.safe_shuttle_correction', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.cumulative_count >= old.cumulative_count then
    return new;
  end if;

  if exists (
    select 1
    from public.payments payment
    where payment.event_id = target_event_id
      and payment.billed_at is not null
  ) then
    raise exception 'รอบนี้เริ่มสรุปยอดแล้ว กรุณาแก้จำนวนลูกแบดรวมด้วยเมนูแก้ยอดรวม';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists guard_locked_shuttlecock_checkpoint_changes
  on public.shuttlecock_checkpoints;
create trigger guard_locked_shuttlecock_checkpoint_changes
before delete or update of cumulative_count on public.shuttlecock_checkpoints
for each row execute function public.guard_locked_shuttlecock_checkpoints();

create or replace function public.set_event_shuttlecock_count(
  target_event_id uuid,
  replacement_count integer,
  checkpoint_at time
)
returns table (new_count integer, recorded_at time)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_event public.events%rowtype;
  previous_count integer;
begin
  if replacement_count is null or replacement_count < 0 or replacement_count > 1000 then
    raise exception 'จำนวนลูกแบดรวมต้องอยู่ระหว่าง 0 ถึง 1,000 ลูก';
  end if;
  if checkpoint_at is null then
    raise exception 'ไม่พบเวลาที่แก้จำนวนลูกแบด';
  end if;

  select * into selected_event
  from public.events
  where id = target_event_id
  for update;

  if not found then raise exception 'ไม่พบรอบที่ต้องการแก้จำนวนลูกแบด'; end if;
  if not public.is_club_admin(selected_event.club_id) then
    raise exception 'เฉพาะแอดมินเท่านั้นที่แก้จำนวนลูกแบดได้';
  end if;

  previous_count := greatest(0, coalesce(selected_event.shuttlecock_count, 0));
  if replacement_count < previous_count and exists (
    select 1 from public.payments payment
    where payment.event_id = target_event_id and payment.billed_at is not null
  ) then
    raise exception 'รอบนี้เริ่มสรุปยอดแล้ว ต้องเปิดยอดค้างกลับมาคำนวณใหม่พร้อมกัน';
  end if;

  new_count := replacement_count;
  recorded_at := checkpoint_at;

  update public.events set shuttlecock_count = new_count where id = target_event_id;
  perform set_config('app.safe_shuttle_correction', 'on', true);
  delete from public.shuttlecock_checkpoints
  where event_id = target_event_id and cumulative_count > new_count;

  insert into public.shuttlecock_checkpoints (
    club_id, event_id, checkpoint_time, cumulative_count, created_by, updated_at
  ) values (
    selected_event.club_id, target_event_id, checkpoint_at, new_count,
    (select auth.uid()), now()
  )
  on conflict (event_id, checkpoint_time) do update
  set cumulative_count = excluded.cumulative_count, updated_at = now();

  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (
    selected_event.club_id, target_event_id, (select auth.uid()),
    format('แก้จำนวนลูกแบดรวมจาก %s เป็น %s ลูก', previous_count, new_count),
    jsonb_build_object(
      'source', 'shuttlecock_total_edit', 'previous_count', previous_count,
      'new_count', new_count, 'checkpoint_time', checkpoint_at
    )
  );
  return next;
end;
$$;

create or replace function public.correct_event_shuttlecock_count(
  target_event_id uuid,
  replacement_count integer,
  checkpoint_at time
)
returns table (new_count integer, recorded_at time, reopened_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_event public.events%rowtype;
  previous_count integer;
  affected_payment_ids uuid[];
  affected_paid_count integer;
  pending_slip_count integer;
  caller_role text := coalesce((select auth.role()), '');
begin
  if replacement_count is null or replacement_count < 0 or replacement_count > 1000 then
    raise exception 'จำนวนลูกแบดรวมต้องอยู่ระหว่าง 0 ถึง 1,000 ลูก';
  end if;
  if checkpoint_at is null then raise exception 'ไม่พบเวลาที่แก้จำนวนลูกแบด'; end if;

  select * into selected_event
  from public.events
  where id = target_event_id
  for update;

  if not found then raise exception 'ไม่พบรอบที่ต้องการแก้จำนวนลูกแบด'; end if;
  if caller_role <> 'service_role' and not public.is_club_admin(selected_event.club_id) then
    raise exception 'เฉพาะแอดมินเท่านั้นที่แก้จำนวนลูกแบดได้';
  end if;

  previous_count := greatest(0, coalesce(selected_event.shuttlecock_count, 0));

  select coalesce(array_agg(payment.id order by payment.id), '{}'::uuid[])
  into affected_payment_ids
  from public.payments payment
  where payment.event_id = target_event_id
    and payment.billed_at is not null
    and payment.paid_at is null;

  select count(*) into affected_paid_count
  from public.payments payment
  where payment.event_id = target_event_id
    and payment.billed_at is not null
    and payment.paid_at is not null
    and coalesce(payment.shuttlecock_count_snapshot, 0) > replacement_count;

  if affected_paid_count > 0 then
    raise exception 'มีผู้เล่นชำระเงินจากยอดลูกแบดเดิมแล้ว กรุณาตรวจสอบกับผู้ชำระก่อนแก้ยอดรวม';
  end if;

  select count(*) into pending_slip_count
  from public.payment_slips slip
  where slip.club_id = selected_event.club_id
    and slip.status = 'pending'
    and slip.payment_ids && affected_payment_ids;

  if pending_slip_count > 0 then
    raise exception 'มียอดค้างที่กำลังรอตรวจสลิป กรุณาอนุมัติหรือปฏิเสธสลิปก่อนแก้จำนวนลูกแบด';
  end if;

  reopened_count := cardinality(affected_payment_ids);
  if reopened_count > 0 then
    update public.payments payment
    set amount = 0,
        calculated_amount = null,
        billed_at = null,
        payment_status = 'draft',
        paid_source = null,
        transferred_amount = null,
        overpayment_amount = 0,
        shared_amount = null,
        extras_amount = null,
        shuttlecock_count_snapshot = null,
        updated_at = now()
    where payment.id = any(affected_payment_ids);
  end if;

  new_count := replacement_count;
  recorded_at := checkpoint_at;
  update public.events set shuttlecock_count = new_count where id = target_event_id;

  perform set_config('app.safe_shuttle_correction', 'on', true);
  delete from public.shuttlecock_checkpoints
  where event_id = target_event_id and cumulative_count > new_count;

  insert into public.shuttlecock_checkpoints (
    club_id, event_id, checkpoint_time, cumulative_count, created_by, updated_at
  ) values (
    selected_event.club_id, target_event_id, checkpoint_at, new_count,
    coalesce((select auth.uid()), selected_event.created_by), now()
  )
  on conflict (event_id, checkpoint_time) do update
  set cumulative_count = excluded.cumulative_count, updated_at = now();

  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (
    selected_event.club_id, target_event_id, (select auth.uid()),
    format('แก้จำนวนลูกแบดรวมเป็น %s ลูก และเปิดยอดค้าง %s รายการ', new_count, reopened_count),
    jsonb_build_object(
      'source', 'safe_shuttlecock_correction', 'previous_count', previous_count,
      'new_count', new_count, 'checkpoint_time', checkpoint_at,
      'reopened_payment_ids', affected_payment_ids, 'reopened_count', reopened_count
    )
  );
  return next;
end;
$$;

revoke all on function public.correct_event_shuttlecock_count(uuid, integer, time) from public, anon;
grant execute on function public.correct_event_shuttlecock_count(uuid, integer, time) to authenticated, service_role;
