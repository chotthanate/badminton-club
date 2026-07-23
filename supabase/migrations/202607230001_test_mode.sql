alter table public.clubs
  add column if not exists is_test boolean not null default false;

create unique index if not exists clubs_one_test_mode_per_owner_idx
  on public.clubs (owner_id)
  where is_test;

comment on column public.clubs.is_test is
  'Isolated admin sandbox. Test clubs never publish signup messages to LINE.';
