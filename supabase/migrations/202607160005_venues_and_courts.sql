alter table public.events
  add column venue text not null default 'คอร์ทแบดเขาน้อย (คอร์ทใหม่)'
    check (char_length(trim(venue)) between 1 and 160);

create table public.event_courts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  event_id uuid not null,
  court_name text not null check (char_length(trim(court_name)) between 1 and 60),
  starts_at time not null,
  ends_at time not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, court_name),
  foreign key (event_id, club_id) references public.events (id, club_id) on delete cascade
);

create index event_courts_club_event_idx on public.event_courts (club_id, event_id, position);

create trigger event_courts_set_updated_at before update on public.event_courts
for each row execute function public.set_updated_at();

alter table public.event_courts enable row level security;

create policy "event_courts_select_members" on public.event_courts
for select to authenticated using ((select public.is_club_member(club_id)));
create policy "event_courts_insert_admins" on public.event_courts
for insert to authenticated with check ((select public.is_club_admin(club_id)));
create policy "event_courts_update_admins" on public.event_courts
for update to authenticated using ((select public.is_club_admin(club_id)))
with check ((select public.is_club_admin(club_id)));
create policy "event_courts_delete_admins" on public.event_courts
for delete to authenticated using ((select public.is_club_admin(club_id)));

insert into public.event_courts (club_id, event_id, court_name, starts_at, ends_at)
select club_id, id, 'คอร์ท 1', starts_at, ends_at
from public.events;
