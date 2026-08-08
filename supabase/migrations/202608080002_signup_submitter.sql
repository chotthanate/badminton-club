alter table public.signups
  add column if not exists submitted_by_line_user_id text,
  add column if not exists submitted_by_line_name text;

alter table public.signups
  drop constraint if exists signups_submitted_by_line_name_length;

alter table public.signups
  add constraint signups_submitted_by_line_name_length
  check (submitted_by_line_name is null or char_length(trim(submitted_by_line_name)) between 1 and 80);

create index if not exists signups_submitted_by_line_user_id_idx
  on public.signups (submitted_by_line_user_id)
  where submitted_by_line_user_id is not null;

with historical_guest_signups as (
  select distinct on (audit.event_id, audit.details ->> 'guest_member_id')
    audit.event_id,
    audit.details ->> 'guest_member_id' as guest_member_id,
    audit.details ->> 'line_user_id' as line_user_id,
    coalesce(nullif(audit.details ->> 'line_display_name', ''), submitter.display_name, submitter.nickname) as line_name
  from public.audit_logs audit
  left join public.club_members submitter
    on submitter.club_id = audit.club_id
   and submitter.line_user_id = audit.details ->> 'line_user_id'
  where audit.details ->> 'source' = 'liff_guest'
    and audit.details ? 'guest_member_id'
    and audit.details ? 'line_user_id'
  order by audit.event_id, audit.details ->> 'guest_member_id', audit.created_at desc
)
update public.signups signup
set submitted_by_line_user_id = history.line_user_id,
    submitted_by_line_name = left(history.line_name, 80)
from historical_guest_signups history
where signup.event_id = history.event_id
  and signup.member_id::text = history.guest_member_id
  and history.line_user_id is not null
  and history.line_name is not null
  and trim(history.line_name) <> '';
