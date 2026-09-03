-- Keep an explicitly finalized payment visible even when an old cached browser
-- writes the legacy billing fields before inserting its audit entry.
create or replace function public.confirm_payment_from_billing_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audited_member_id uuid;
begin
  if new.event_id is null
    or not (new.details ? 'member_id')
    or coalesce(new.details->>'member_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    return new;
  end if;

  audited_member_id := (new.details->>'member_id')::uuid;

  update public.payments
  set
    admin_confirmed_at = coalesce(admin_confirmed_at, billed_at, new.created_at, now()),
    payment_status = case when paid_at is not null then 'paid' else 'awaiting' end,
    updated_at = now()
  where event_id = new.event_id
    and member_id = audited_member_id
    and billed_at is not null
    and admin_confirmed_at is null;

  return new;
end;
$$;

drop trigger if exists confirm_payment_from_billing_audit on public.audit_logs;

create trigger confirm_payment_from_billing_audit
after insert on public.audit_logs
for each row
when (
  new.action like 'สรุปยอดเรียกเก็บ %'
  or new.action like 'แก้ยอดเรียกเก็บ %'
)
execute function public.confirm_payment_from_billing_audit();
