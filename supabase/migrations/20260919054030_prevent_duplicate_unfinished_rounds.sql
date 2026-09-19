-- Remove abandoned empty drafts only when a newer round already exists. This
-- preserves the newest in-progress round while clearing stale drafts created
-- by repeated submissions or another open browser tab.
update public.events as stale
set status = 'cancelled',
    line_publish_ready = false,
    updated_at = now()
where stale.status = 'draft'
  and not exists (
    select 1 from public.signups where event_id = stale.id
  )
  and not exists (
    select 1 from public.payments where event_id = stale.id
  )
  and exists (
    select 1
    from public.events as newer
    where newer.club_id = stale.club_id
      and newer.created_at > stale.created_at
  );

-- If historical data still contains more than one unfinished round, retain
-- only the most recently created one before enforcing the invariant.
with ranked as (
  select id,
         row_number() over (
           partition by club_id
           order by created_at desc, id desc
         ) as position
  from public.events
  where status in ('draft', 'open')
)
update public.events as duplicate
set status = 'cancelled',
    line_publish_ready = false,
    updated_at = now()
from ranked
where duplicate.id = ranked.id
  and ranked.position > 1;

create unique index events_one_unfinished_round_per_club_idx
on public.events (club_id)
where status in ('draft', 'open');
