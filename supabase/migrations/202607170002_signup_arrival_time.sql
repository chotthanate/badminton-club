alter table public.signups
  add column arrival_time time;

-- The simplified signup flow no longer accepts "maybe". Preserve old rows as
-- not coming so they do not appear in the confirmed player list.
update public.signups
set status = 'not_coming', arrival_time = null
where status = 'maybe';

-- Existing confirmed players are assigned the event start time. They can edit
-- their answer in LIFF to choose a more accurate arrival time.
update public.signups as signup
set arrival_time = event.starts_at
from public.events as event
where signup.event_id = event.id
  and signup.status = 'coming'
  and signup.arrival_time is null;

alter table public.signups
  alter column arrival_time set default null,
  add constraint signups_supported_status_check
    check (status in ('coming', 'not_coming')),
  add constraint signups_arrival_time_check
    check (
      (status = 'coming' and arrival_time is not null)
      or (status = 'not_coming' and arrival_time is null)
    );
