-- Closing a round must also close every queue state in the same database
-- transaction. This prevents an old round from leaving players or courts in
-- `playing` / `reserved`, even when an older cached web build closes it.

create or replace function public.finalize_queue_state_before_event_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  playing_match_id uuid;
  completed_count integer := 0;
  cancelled_count integer := 0;
  released_player_count integer := 0;
begin
  if new.status <> 'closed' or old.status = 'closed' then
    return new;
  end if;

  -- The row update is already protected by the events RLS policy. Recheck the
  -- operator here because this trigger runs with elevated table privileges.
  if not public.is_club_operator(old.club_id) then
    raise exception 'ไม่มีสิทธิ์จบรอบ';
  end if;

  perform pg_advisory_xact_lock(hashtext(old.id::text));

  -- Finish active games through the canonical function so game/minute stats,
  -- snapshots and audit records are preserved rather than silently discarded.
  for playing_match_id in
    select match.id
    from public.queue_matches match
    where match.event_id = old.id
      and match.status = 'playing'
    order by match.started_at nulls last, match.sequence
    for update
  loop
    perform public.finish_queue_match(playing_match_id);
    completed_count := completed_count + 1;
  end loop;

  -- A closed round cannot have future queues. Cancel all drafts/approvals and
  -- clear their queue positions so the row constraint remains valid.
  update public.queue_matches
  set status = 'cancelled',
      queue_position = null,
      ended_at = coalesce(ended_at, now())
  where event_id = old.id
    and status in ('draft', 'approved');
  get diagnostics cancelled_count = row_count;

  -- Nobody may remain operationally active after the round is closed.
  update public.event_queue_players
  set status = 'left',
      queued_at = now()
  where event_id = old.id
    and status in ('waiting', 'reserved', 'playing');
  get diagnostics released_player_count = row_count;

  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (
    old.club_id,
    old.id,
    auth.uid(),
    'ปิดสถานะสนามและคิวพร้อมจบรอบ',
    jsonb_build_object(
      'completed_playing_matches', completed_count,
      'cancelled_upcoming_matches', cancelled_count,
      'released_queue_players', released_player_count
    )
  );

  return new;
end;
$$;

drop trigger if exists events_finalize_queue_before_close on public.events;
create trigger events_finalize_queue_before_close
before update of status on public.events
for each row
when (new.status = 'closed' and old.status is distinct from new.status)
execute function public.finalize_queue_state_before_event_close();

revoke all on function public.finalize_queue_state_before_event_close() from public;
revoke all on function public.finalize_queue_state_before_event_close() from anon;
revoke all on function public.finalize_queue_state_before_event_close() from authenticated;
