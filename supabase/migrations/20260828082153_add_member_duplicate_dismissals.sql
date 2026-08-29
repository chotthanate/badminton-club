create table if not exists public.member_duplicate_dismissals (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  signature text not null check (char_length(signature) between 3 and 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (club_id, signature)
);

create index if not exists member_duplicate_dismissals_club_id_idx
  on public.member_duplicate_dismissals (club_id);

alter table public.member_duplicate_dismissals enable row level security;

create policy "club admins can read dismissed member duplicates"
  on public.member_duplicate_dismissals
  for select
  to authenticated
  using (public.is_club_admin(club_id));

create policy "club admins can dismiss member duplicates"
  on public.member_duplicate_dismissals
  for insert
  to authenticated
  with check (public.is_club_admin(club_id));

create policy "club admins can remove dismissed member duplicates"
  on public.member_duplicate_dismissals
  for delete
  to authenticated
  using (public.is_club_admin(club_id));

grant select, insert, delete on public.member_duplicate_dismissals to authenticated;

-- A draft is only an internal estimate. Older rows could retain billed_at from a
-- previous workflow, which made unfinished balances visible in the member LIFF.
update public.payments
set billed_at = null
where payment_status = 'draft'
  and paid_at is null
  and billed_at is not null;
