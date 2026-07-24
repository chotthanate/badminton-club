alter table public.attendance
add column billing_percentage smallint not null default 100
check (billing_percentage in (25, 50, 75, 100));

comment on column public.attendance.billing_percentage is
'Admin-selected share of actual playing time used to split shared costs. Personal extras are not discounted.';
