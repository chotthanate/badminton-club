alter table public.payments
  add column if not exists shared_amount numeric(12, 2) check (shared_amount is null or shared_amount >= 0),
  add column if not exists extras_amount numeric(12, 2) check (extras_amount is null or extras_amount >= 0),
  add column if not exists shuttlecock_count_snapshot integer check (shuttlecock_count_snapshot is null or shuttlecock_count_snapshot >= 0);

comment on column public.payments.shared_amount is
  'Shared-cost portion locked when an admin records payment.';

comment on column public.payments.extras_amount is
  'Personal-extra portion locked when an admin records payment.';

comment on column public.payments.shuttlecock_count_snapshot is
  'Shuttlecock count shown to the admin when this payment was locked.';
