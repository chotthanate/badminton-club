alter table public.events
  add column if not exists billing_model text not null default 'legacy'
    check (billing_model in ('legacy', 'time_segmented'));

comment on column public.events.billing_model is
  'legacy preserves historical rounds; time_segmented allocates court and shuttle costs by actual presence intervals.';

update public.events
set billing_model = 'time_segmented'
where status in ('draft', 'open')
  and billing_model = 'legacy';

create table if not exists public.shuttlecock_checkpoints (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  checkpoint_time time not null,
  cumulative_count integer not null check (cumulative_count >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, checkpoint_time)
);

create index if not exists shuttlecock_checkpoints_event_time_idx
  on public.shuttlecock_checkpoints (event_id, checkpoint_time);

alter table public.shuttlecock_checkpoints enable row level security;

create policy "shuttlecock_checkpoints_select_admins" on public.shuttlecock_checkpoints
for select to authenticated
using ((select public.is_club_admin(club_id)));

create policy "shuttlecock_checkpoints_insert_admins" on public.shuttlecock_checkpoints
for insert to authenticated
with check ((select public.is_club_admin(club_id)));

create policy "shuttlecock_checkpoints_update_admins" on public.shuttlecock_checkpoints
for update to authenticated
using ((select public.is_club_admin(club_id)))
with check ((select public.is_club_admin(club_id)));

create policy "shuttlecock_checkpoints_delete_admins" on public.shuttlecock_checkpoints
for delete to authenticated
using ((select public.is_club_admin(club_id)));
