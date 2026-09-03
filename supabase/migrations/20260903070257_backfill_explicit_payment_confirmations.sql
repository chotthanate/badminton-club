-- A browser tab opened before admin_confirmed_at was introduced could still
-- write the finalized amount and its audit entry without filling the new
-- confirmation column. The audit entry is the durable evidence that the owner
-- explicitly pressed the summarize/edit bill action, so restore only those
-- confirmations. Rows created automatically while closing an event have no
-- matching audit action and remain hidden from the member payment page.
with explicit_confirmations as (
  select distinct on (logs.event_id, (logs.details->>'member_id')::uuid)
    logs.event_id,
    (logs.details->>'member_id')::uuid as member_id,
    logs.created_at
  from public.audit_logs as logs
  where logs.details ? 'member_id'
    and (
      logs.action like 'สรุปยอดเรียกเก็บ %'
      or logs.action like 'แก้ยอดเรียกเก็บ %'
    )
  order by logs.event_id, (logs.details->>'member_id')::uuid, logs.created_at desc
)
update public.payments as payment
set
  admin_confirmed_at = coalesce(payment.billed_at, confirmation.created_at),
  payment_status = case when payment.paid_at is not null then 'paid' else 'awaiting' end,
  updated_at = now()
from explicit_confirmations as confirmation
where payment.event_id = confirmation.event_id
  and payment.member_id = confirmation.member_id
  and payment.admin_confirmed_at is null
  and payment.billed_at is not null;
