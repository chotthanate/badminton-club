alter table public.events
  add column court_hourly_rate numeric(12, 2) not null default 200
    check (court_hourly_rate >= 0),
  add column shuttlecock_count integer not null default 0
    check (shuttlecock_count >= 0),
  add column shuttlecock_unit_price numeric(12, 2) not null default 60
    check (shuttlecock_unit_price >= 0);
