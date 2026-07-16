alter table public.club_members
add column nickname text
check (nickname is null or char_length(trim(nickname)) between 1 and 40);

comment on column public.club_members.nickname is
  'Member-chosen nickname shown to other players; display_name keeps the LINE profile name.';
