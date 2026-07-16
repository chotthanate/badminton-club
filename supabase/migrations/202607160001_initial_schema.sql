create extension if not exists pgcrypto;

create type public.club_role as enum ('admin', 'member');
create type public.event_status as enum ('draft', 'open', 'closed', 'cancelled');
create type public.signup_status as enum ('coming', 'maybe', 'not_coming');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 80),
  line_user_id text unique,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 100),
  owner_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.club_members (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  display_name text not null check (char_length(trim(display_name)) between 1 and 80),
  role public.club_role not null default 'member',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, profile_id),
  unique (id, club_id)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  event_date date not null,
  starts_at time not null,
  ends_at time not null,
  status public.event_status not null default 'draft',
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, club_id)
);

create table public.signups (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  event_id uuid not null,
  member_id uuid not null,
  status public.signup_status not null,
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, member_id),
  foreign key (event_id, club_id) references public.events (id, club_id) on delete cascade,
  foreign key (member_id, club_id) references public.club_members (id, club_id) on delete cascade
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  event_id uuid not null,
  member_id uuid not null,
  arrived boolean not null default false,
  arrived_at time,
  left_at time,
  weight numeric(5, 4) not null default 1 check (weight >= 0 and weight <= 1),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, member_id),
  foreign key (event_id, club_id) references public.events (id, club_id) on delete cascade,
  foreign key (member_id, club_id) references public.club_members (id, club_id) on delete cascade
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  event_id uuid not null,
  category text not null check (char_length(trim(category)) between 1 and 40),
  label text not null check (char_length(trim(label)) between 1 and 120),
  amount numeric(12, 2) not null check (amount >= 0),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (event_id, club_id) references public.events (id, club_id) on delete cascade
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  event_id uuid not null,
  member_id uuid not null,
  amount numeric(12, 2) not null check (amount >= 0),
  paid_at timestamptz,
  recorded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, member_id),
  foreign key (event_id, club_id) references public.events (id, club_id) on delete cascade,
  foreign key (member_id, club_id) references public.club_members (id, club_id) on delete cascade
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  club_id uuid not null references public.clubs (id) on delete cascade,
  event_id uuid references public.events (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (char_length(trim(action)) between 1 and 120),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index club_members_profile_id_idx on public.club_members (profile_id);
create index events_club_date_idx on public.events (club_id, event_date desc);
create index signups_club_event_idx on public.signups (club_id, event_id);
create index attendance_club_event_idx on public.attendance (club_id, event_id);
create index expenses_club_event_idx on public.expenses (club_id, event_id);
create index payments_club_event_idx on public.payments (club_id, event_id);
create index audit_logs_club_created_idx on public.audit_logs (club_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger clubs_set_updated_at before update on public.clubs
for each row execute function public.set_updated_at();
create trigger club_members_set_updated_at before update on public.club_members
for each row execute function public.set_updated_at();
create trigger events_set_updated_at before update on public.events
for each row execute function public.set_updated_at();
create trigger signups_set_updated_at before update on public.signups
for each row execute function public.set_updated_at();
create trigger attendance_set_updated_at before update on public.attendance
for each row execute function public.set_updated_at();
create trigger expenses_set_updated_at before update on public.expenses
for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'สมาชิกใหม่'),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.handle_new_club()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.club_members (club_id, profile_id, display_name, role)
  select new.id, new.owner_id, p.display_name, 'admin'::public.club_role
  from public.profiles p
  where p.id = new.owner_id;
  return new;
end;
$$;

create trigger on_club_created
after insert on public.clubs
for each row execute function public.handle_new_club();

create or replace function public.is_club_member(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.club_members cm
    where cm.club_id = target_club_id
      and cm.profile_id = (select auth.uid())
      and cm.active
  );
$$;

create or replace function public.is_club_admin(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.club_members cm
    where cm.club_id = target_club_id
      and cm.profile_id = (select auth.uid())
      and cm.role = 'admin'
      and cm.active
  );
$$;

create or replace function public.is_own_member(target_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.club_members cm
    where cm.id = target_member_id
      and cm.profile_id = (select auth.uid())
      and cm.active
  );
$$;

revoke all on function public.is_club_member(uuid) from public;
revoke all on function public.is_club_admin(uuid) from public;
revoke all on function public.is_own_member(uuid) from public;
grant execute on function public.is_club_member(uuid) to authenticated;
grant execute on function public.is_club_admin(uuid) to authenticated;
grant execute on function public.is_own_member(uuid) to authenticated;

create or replace function public.mark_self_left_at(target_event_id uuid, departure_time time)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_start timestamp;
  event_end timestamp;
  departure_at timestamp;
  calculated_weight numeric(5, 4);
begin
  select
    e.event_date + e.starts_at,
    e.event_date + e.ends_at
      + case when e.ends_at <= e.starts_at then interval '1 day' else interval '0 days' end
  into event_start, event_end
  from public.events e
  join public.club_members cm on cm.club_id = e.club_id
  where e.id = target_event_id
    and cm.profile_id = (select auth.uid())
    and cm.active;

  if event_start is null then
    raise exception 'Event or active membership not found';
  end if;

  departure_at := event_start::date + departure_time;
  if departure_time < event_start::time then
    departure_at := departure_at + interval '1 day';
  end if;

  calculated_weight := greatest(
    0.05,
    least(
      1,
      round(
        (extract(epoch from (departure_at - event_start))
          / nullif(extract(epoch from (event_end - event_start)), 0))::numeric,
        2
      )
    )
  );

  update public.attendance a
  set arrived = true,
      left_at = departure_time,
      weight = calculated_weight
  from public.club_members cm
  where a.event_id = target_event_id
    and cm.id = a.member_id
    and cm.profile_id = (select auth.uid())
    and cm.active;

  if not found then
    raise exception 'Attendance row not found';
  end if;
end;
$$;

revoke all on function public.mark_self_left_at(uuid, time) from public;
grant execute on function public.mark_self_left_at(uuid, time) to authenticated;

alter table public.profiles enable row level security;
alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.events enable row level security;
alter table public.signups enable row level security;
alter table public.attendance enable row level security;
alter table public.expenses enable row level security;
alter table public.payments enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles_select_self_or_clubmate" on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1 from public.club_members me
    join public.club_members them on them.club_id = me.club_id
    where me.profile_id = (select auth.uid()) and them.profile_id = profiles.id
  )
);
create policy "profiles_update_self" on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "clubs_select_members" on public.clubs
for select to authenticated using ((select public.is_club_member(id)));
create policy "clubs_insert_owner" on public.clubs
for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "clubs_update_admins" on public.clubs
for update to authenticated using ((select public.is_club_admin(id)))
with check ((select public.is_club_admin(id)));

create policy "club_members_select_members" on public.club_members
for select to authenticated using ((select public.is_club_member(club_id)));
create policy "club_members_insert_admins" on public.club_members
for insert to authenticated with check ((select public.is_club_admin(club_id)));
create policy "club_members_update_admins" on public.club_members
for update to authenticated using ((select public.is_club_admin(club_id)))
with check ((select public.is_club_admin(club_id)));
create policy "club_members_delete_admins" on public.club_members
for delete to authenticated using ((select public.is_club_admin(club_id)));

create policy "events_select_members" on public.events
for select to authenticated using ((select public.is_club_member(club_id)));
create policy "events_insert_admins" on public.events
for insert to authenticated with check ((select public.is_club_admin(club_id)));
create policy "events_update_admins" on public.events
for update to authenticated using ((select public.is_club_admin(club_id)))
with check ((select public.is_club_admin(club_id)));
create policy "events_delete_admins" on public.events
for delete to authenticated using ((select public.is_club_admin(club_id)));

create policy "signups_select_members" on public.signups
for select to authenticated using ((select public.is_club_member(club_id)));
create policy "signups_insert_self_or_admin" on public.signups
for insert to authenticated
with check ((select public.is_own_member(member_id)) or (select public.is_club_admin(club_id)));
create policy "signups_update_self_or_admin" on public.signups
for update to authenticated
using ((select public.is_own_member(member_id)) or (select public.is_club_admin(club_id)))
with check ((select public.is_own_member(member_id)) or (select public.is_club_admin(club_id)));
create policy "signups_delete_self_or_admin" on public.signups
for delete to authenticated
using ((select public.is_own_member(member_id)) or (select public.is_club_admin(club_id)));

create policy "attendance_select_members" on public.attendance
for select to authenticated using ((select public.is_club_member(club_id)));
create policy "attendance_insert_admins" on public.attendance
for insert to authenticated with check ((select public.is_club_admin(club_id)));
create policy "attendance_update_admins" on public.attendance
for update to authenticated using ((select public.is_club_admin(club_id)))
with check ((select public.is_club_admin(club_id)));
create policy "attendance_delete_admins" on public.attendance
for delete to authenticated using ((select public.is_club_admin(club_id)));

create policy "expenses_select_members" on public.expenses
for select to authenticated using ((select public.is_club_member(club_id)));
create policy "expenses_insert_admins" on public.expenses
for insert to authenticated with check ((select public.is_club_admin(club_id)));
create policy "expenses_update_admins" on public.expenses
for update to authenticated using ((select public.is_club_admin(club_id)))
with check ((select public.is_club_admin(club_id)));
create policy "expenses_delete_admins" on public.expenses
for delete to authenticated using ((select public.is_club_admin(club_id)));

create policy "payments_select_self_or_admin" on public.payments
for select to authenticated
using ((select public.is_own_member(member_id)) or (select public.is_club_admin(club_id)));
create policy "payments_insert_admins" on public.payments
for insert to authenticated with check ((select public.is_club_admin(club_id)));
create policy "payments_update_admins" on public.payments
for update to authenticated using ((select public.is_club_admin(club_id)))
with check ((select public.is_club_admin(club_id)));
create policy "payments_delete_admins" on public.payments
for delete to authenticated using ((select public.is_club_admin(club_id)));

create policy "audit_logs_select_admins" on public.audit_logs
for select to authenticated using ((select public.is_club_admin(club_id)));
create policy "audit_logs_insert_members" on public.audit_logs
for insert to authenticated
with check (
  actor_id = (select auth.uid())
  and (select public.is_club_member(club_id))
);
