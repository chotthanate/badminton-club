-- Keep tournament schedule mutations behind an authenticated operator session.
revoke all on function public.shift_tournament_court_matches(uuid, uuid, integer)
  from public, anon;
grant execute on function public.shift_tournament_court_matches(uuid, uuid, integer)
  to authenticated;
