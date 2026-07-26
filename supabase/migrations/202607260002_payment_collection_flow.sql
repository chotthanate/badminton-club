alter table public.payments
  add column if not exists calculated_amount numeric(12, 2)
    check (calculated_amount is null or calculated_amount >= 0),
  add column if not exists billed_at timestamptz,
  add column if not exists payment_status text not null default 'draft'
    check (payment_status in ('draft', 'awaiting', 'paid', 'review')),
  add column if not exists paid_source text
    check (paid_source is null or paid_source in ('admin', 'slip_auto', 'slip_review', 'exempt')),
  add column if not exists transferred_amount numeric(12, 2)
    check (transferred_amount is null or transferred_amount >= 0),
  add column if not exists overpayment_amount numeric(12, 2) not null default 0
    check (overpayment_amount >= 0);

update public.payments
set calculated_amount = coalesce(calculated_amount, amount),
    billed_at = coalesce(billed_at, created_at),
    payment_status = case when paid_at is null then 'awaiting' else 'paid' end,
    paid_source = case when paid_at is null then paid_source else coalesce(paid_source, 'admin') end
where calculated_amount is null
   or billed_at is null
   or payment_status = 'draft';

comment on column public.payments.calculated_amount is
  'Amount calculated by the cost-sharing engine. Admin-only and never returned by member payment APIs.';
comment on column public.payments.amount is
  'Final billed amount shown to the member after an admin confirms collection.';
comment on column public.payments.billed_at is
  'Timestamp when an admin confirmed the final amount to collect.';
comment on column public.payments.overpayment_amount is
  'Transfer excess visible only to admins.';

create table if not exists public.payment_slips (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  submitted_by_member_id uuid not null,
  beneficiary_member_id uuid not null,
  payment_ids uuid[] not null,
  expected_amount numeric(12, 2) not null check (expected_amount >= 0),
  transferred_amount numeric(12, 2) check (transferred_amount is null or transferred_amount >= 0),
  transferred_on date,
  ocr_confidence numeric(5, 2) check (ocr_confidence is null or (ocr_confidence >= 0 and ocr_confidence <= 100)),
  ocr_text text,
  slip_hash text not null,
  storage_path text,
  status text not null check (status in ('auto_paid', 'pending', 'rejected')),
  review_reason text,
  overpayment_amount numeric(12, 2) not null default 0 check (overpayment_amount >= 0),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (club_id, slip_hash),
  foreign key (submitted_by_member_id, club_id)
    references public.club_members (id, club_id) on delete restrict,
  foreign key (beneficiary_member_id, club_id)
    references public.club_members (id, club_id) on delete restrict
);

create index if not exists payment_slips_club_created_idx
  on public.payment_slips (club_id, created_at desc);
create index if not exists payment_slips_beneficiary_idx
  on public.payment_slips (beneficiary_member_id, created_at desc);

alter table public.payment_slips enable row level security;

create policy "payment_slips_select_admins" on public.payment_slips
for select to authenticated
using ((select public.is_club_admin(club_id)));

create policy "payment_slips_update_admins" on public.payment_slips
for update to authenticated
using ((select public.is_club_admin(club_id)))
with check ((select public.is_club_admin(club_id)));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-slips',
  'payment-slips',
  false,
  3145728,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "payment_slip_objects_select_admins" on storage.objects
for select to authenticated
using (
  bucket_id = 'payment-slips'
  and exists (
    select 1
    from public.club_members
    where club_members.club_id::text = (storage.foldername(name))[1]
      and club_members.profile_id = (select auth.uid())
      and club_members.role = 'admin'
      and club_members.active
  )
);
