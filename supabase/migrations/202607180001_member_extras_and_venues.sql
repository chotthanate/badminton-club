create table public.club_venues (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (club_id, name)
);

create table public.extra_item_catalog (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  price numeric(12, 2) not null check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, name)
);

create table public.member_extra_charges (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  event_id uuid not null,
  member_id uuid not null,
  item_name text not null check (char_length(trim(item_name)) between 1 and 80),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  quantity integer not null default 1 check (quantity between 1 and 99),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (event_id, club_id) references public.events (id, club_id) on delete cascade,
  foreign key (member_id, club_id) references public.club_members (id, club_id) on delete cascade
);

create index club_venues_club_idx on public.club_venues (club_id, created_at);
create index extra_item_catalog_club_idx on public.extra_item_catalog (club_id, active, created_at);
create index member_extra_charges_event_member_idx on public.member_extra_charges (event_id, member_id, created_at);

create trigger extra_item_catalog_set_updated_at before update on public.extra_item_catalog
for each row execute function public.set_updated_at();
create trigger member_extra_charges_set_updated_at before update on public.member_extra_charges
for each row execute function public.set_updated_at();

insert into public.club_venues (club_id, name)
select distinct club_id, trim(venue)
from public.events
where trim(venue) <> ''
on conflict (club_id, name) do nothing;

insert into public.extra_item_catalog (club_id, name, price)
select club.id, item.name, item.price
from public.clubs as club
cross join (values
  ('น้ำขวดเล็ก', 10::numeric),
  ('น้ำขวดใหญ่', 20::numeric),
  ('สปอนเซอร์', 15::numeric)
) as item(name, price)
on conflict (club_id, name) do nothing;

alter table public.club_venues enable row level security;
alter table public.extra_item_catalog enable row level security;
alter table public.member_extra_charges enable row level security;

create policy "club_venues_select_admins" on public.club_venues
for select to authenticated using ((select public.is_club_admin(club_id)));
create policy "club_venues_insert_admins" on public.club_venues
for insert to authenticated with check ((select public.is_club_admin(club_id)));
create policy "club_venues_delete_admins" on public.club_venues
for delete to authenticated using ((select public.is_club_admin(club_id)));

create policy "extra_item_catalog_select_admins" on public.extra_item_catalog
for select to authenticated using ((select public.is_club_admin(club_id)));
create policy "extra_item_catalog_insert_admins" on public.extra_item_catalog
for insert to authenticated with check ((select public.is_club_admin(club_id)));
create policy "extra_item_catalog_update_admins" on public.extra_item_catalog
for update to authenticated using ((select public.is_club_admin(club_id)))
with check ((select public.is_club_admin(club_id)));
create policy "extra_item_catalog_delete_admins" on public.extra_item_catalog
for delete to authenticated using ((select public.is_club_admin(club_id)));

create policy "member_extra_charges_select_admins" on public.member_extra_charges
for select to authenticated using ((select public.is_club_admin(club_id)));
create policy "member_extra_charges_insert_admins" on public.member_extra_charges
for insert to authenticated with check ((select public.is_club_admin(club_id)));
create policy "member_extra_charges_update_admins" on public.member_extra_charges
for update to authenticated using ((select public.is_club_admin(club_id)))
with check ((select public.is_club_admin(club_id)));
create policy "member_extra_charges_delete_admins" on public.member_extra_charges
for delete to authenticated using ((select public.is_club_admin(club_id)));
