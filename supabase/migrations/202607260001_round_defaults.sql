alter table public.clubs
  add column default_friday_court_hourly_rate numeric(12, 2) not null default 200
    check (default_friday_court_hourly_rate >= 0),
  add column default_saturday_court_hourly_rate numeric(12, 2) not null default 150
    check (default_saturday_court_hourly_rate >= 0),
  add column default_other_court_hourly_rate numeric(12, 2) not null default 200
    check (default_other_court_hourly_rate >= 0),
  add column default_shuttlecock_unit_price numeric(12, 2) not null default 95
    check (default_shuttlecock_unit_price >= 0);

update public.clubs as club
set default_shuttlecock_unit_price = coalesce(
  (
    select event.shuttlecock_unit_price
    from public.events as event
    where event.club_id = club.id
    order by event.updated_at desc, event.created_at desc
    limit 1
  ),
  95
);

comment on column public.clubs.default_friday_court_hourly_rate is
  'Current default court hourly price for Friday rounds.';
comment on column public.clubs.default_saturday_court_hourly_rate is
  'Current default court hourly price for Saturday rounds.';
comment on column public.clubs.default_other_court_hourly_rate is
  'Current default court hourly price for rounds on other weekdays.';
comment on column public.clubs.default_shuttlecock_unit_price is
  'Current default shuttlecock unit price for newly created rounds.';
