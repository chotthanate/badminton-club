alter table public.payments
  add column if not exists admin_confirmed_at timestamptz;

comment on column public.payments.admin_confirmed_at is
  'Set only after an admin explicitly confirms the final amount. Player-facing payment flows must require this value.';

-- Preserve previously collected and explicitly summarized bills. Older versions
-- also wrote billed_at automatically when a departure time was selected, so
-- billed_at alone is not proof that an admin approved the amount.
update public.payments
set admin_confirmed_at = coalesce(admin_confirmed_at, billed_at, paid_at)
where paid_at is not null
   or exists (
     select 1
     from public.audit_logs audit
     where audit.event_id = payments.event_id
       and audit.details ->> 'member_id' = payments.member_id::text
       and (
         audit.action like 'สรุปยอดเรียกเก็บ %'
         or audit.action like 'แก้ยอดเรียกเก็บ %'
       )
   );

-- Reopen unpaid amounts that can be proven to have come only from the old
-- automatic "departure + lock bill" path. Pending slips are left untouched for
-- manual review so an actual transfer is never discarded.
update public.payments
set amount = 0,
    calculated_amount = null,
    billed_at = null,
    admin_confirmed_at = null,
    payment_status = 'draft',
    paid_source = null,
    transferred_amount = null,
    overpayment_amount = 0,
    shared_amount = null,
    extras_amount = null,
    shuttlecock_count_snapshot = null,
    updated_at = now()
where paid_at is null
  and exists (
    select 1
    from public.audit_logs audit
    where audit.event_id = payments.event_id
      and audit.details ->> 'member_id' = payments.member_id::text
      and audit.action like '% และล็อกยอด %'
  )
  and not exists (
    select 1
    from public.audit_logs audit
    where audit.event_id = payments.event_id
      and audit.details ->> 'member_id' = payments.member_id::text
      and (
        audit.action like 'สรุปยอดเรียกเก็บ %'
        or audit.action like 'แก้ยอดเรียกเก็บ %'
      )
  )
  and not exists (
    select 1
    from public.payment_slips slip
    where slip.status = 'pending'
      and payments.id = any(slip.payment_ids)
  );

create index if not exists payments_player_visible_idx
  on public.payments (club_id, admin_confirmed_at desc)
  where admin_confirmed_at is not null;

create or replace function public.reopen_changed_member_bill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event_id uuid := coalesce(new.event_id, old.event_id);
  target_member_id uuid := coalesce(new.member_id, old.member_id);
  target_payment_id uuid;
begin
  select payment.id into target_payment_id
  from public.payments payment
  where payment.event_id = target_event_id
    and payment.member_id = target_member_id
    and payment.admin_confirmed_at is not null
    and payment.paid_at is null
  for update;

  if target_payment_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if exists (
    select 1 from public.payment_slips slip
    where slip.status = 'pending'
      and target_payment_id = any(slip.payment_ids)
  ) then
    raise exception 'ยอดนี้มีสลิปรอตรวจอยู่ กรุณาตรวจหรือปฏิเสธสลิปก่อนแก้ข้อมูล';
  end if;

  update public.payments
  set amount = 0,
      calculated_amount = null,
      billed_at = null,
      admin_confirmed_at = null,
      payment_status = 'draft',
      paid_source = null,
      transferred_amount = null,
      overpayment_amount = 0,
      shared_amount = null,
      extras_amount = null,
      shuttlecock_count_snapshot = null,
      updated_at = now()
  where id = target_payment_id;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.reopen_changed_event_bills()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event_id uuid;
  affected_payment_ids uuid[];
begin
  if tg_table_name = 'events' then
    target_event_id := coalesce(new.id, old.id);
  else
    target_event_id := coalesce(new.event_id, old.event_id);
  end if;
  select coalesce(array_agg(payment.id), '{}'::uuid[])
  into affected_payment_ids
  from public.payments payment
  where payment.event_id = target_event_id
    and payment.admin_confirmed_at is not null
    and payment.paid_at is null;

  if cardinality(affected_payment_ids) = 0 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if exists (
    select 1 from public.payment_slips slip
    where slip.status = 'pending'
      and slip.payment_ids && affected_payment_ids
  ) then
    raise exception 'รอบนี้มีสลิปรอตรวจอยู่ กรุณาตรวจหรือปฏิเสธสลิปก่อนแก้ค่าใช้จ่าย';
  end if;

  update public.payments
  set amount = 0,
      calculated_amount = null,
      billed_at = null,
      admin_confirmed_at = null,
      payment_status = 'draft',
      paid_source = null,
      transferred_amount = null,
      overpayment_amount = 0,
      shared_amount = null,
      extras_amount = null,
      shuttlecock_count_snapshot = null,
      updated_at = now()
  where id = any(affected_payment_ids);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.reopen_changed_member_bill() from public, anon, authenticated;
revoke all on function public.reopen_changed_event_bills() from public, anon, authenticated;

create trigger attendance_reopen_changed_bill
after update of arrived, arrived_at, left_at, billing_percentage on public.attendance
for each row
when (
  old.arrived is distinct from new.arrived
  or old.arrived_at is distinct from new.arrived_at
  or old.left_at is distinct from new.left_at
  or old.billing_percentage is distinct from new.billing_percentage
)
execute function public.reopen_changed_member_bill();

create trigger signup_reopen_changed_bill
after update of arrival_time, status on public.signups
for each row
when (
  old.arrival_time is distinct from new.arrival_time
  or old.status is distinct from new.status
)
execute function public.reopen_changed_member_bill();

create trigger member_extra_reopen_changed_bill
after insert or update or delete on public.member_extra_charges
for each row execute function public.reopen_changed_member_bill();

create trigger expense_reopen_changed_bills
after insert or update or delete on public.expenses
for each row execute function public.reopen_changed_event_bills();

create trigger court_reopen_changed_bills
after insert or update or delete on public.event_courts
for each row execute function public.reopen_changed_event_bills();

create trigger event_cost_reopen_changed_bills
after update of court_hourly_rate, shuttlecock_unit_price, shuttlecock_count, billing_model on public.events
for each row
when (
  old.court_hourly_rate is distinct from new.court_hourly_rate
  or old.shuttlecock_unit_price is distinct from new.shuttlecock_unit_price
  or old.shuttlecock_count is distinct from new.shuttlecock_count
  or old.billing_model is distinct from new.billing_model
)
execute function public.reopen_changed_event_bills();
