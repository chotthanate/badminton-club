alter table public.clubs
add column line_group_id text;

alter table public.club_members
add column line_user_id text;

create unique index clubs_line_group_id_key
on public.clubs (line_group_id)
where line_group_id is not null;

create unique index club_members_club_line_user_key
on public.club_members (club_id, line_user_id)
where line_user_id is not null;

comment on column public.clubs.line_group_id is
  'LINE group ID learned from webhook events; never entered by regular members.';

comment on column public.club_members.line_user_id is
  'LINE Messaging API user ID for members who interact only through LINE.';
