-- Queue position 1 must be approved before any later queue can enter a court.

create or replace function public.start_next_queue_on_court(
  target_event_id uuid,
  target_court_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  target_match public.queue_matches%rowtype;
  selected_ids uuid[];
begin
  select club_id into target_club_id from public.events where id = target_event_id and status = 'open';
  if target_club_id is null or not public.is_club_operator(target_club_id) then raise exception 'ไม่มีสิทธิ์เริ่มเกม'; end if;
  if not exists (select 1 from public.event_courts where id = target_court_id and event_id = target_event_id) then raise exception 'ไม่พบคอร์ทนี้'; end if;
  perform pg_advisory_xact_lock(hashtext(target_event_id::text));
  if exists (select 1 from public.queue_matches where court_id = target_court_id and status = 'playing') then raise exception 'คอร์ทนี้กำลังใช้งาน'; end if;

  select * into target_match from public.queue_matches
  where event_id = target_event_id and status in ('draft', 'approved')
  order by queue_position, proposed_at
  for update skip locked limit 1;
  if target_match.id is null then raise exception 'ยังไม่มีคิวล่วงหน้า'; end if;
  if target_match.status <> 'approved' then raise exception 'กรุณาตรวจและอนุมัติคิว 1 ก่อนนำลงสนาม'; end if;

  select array_agg(member_id) into selected_ids from public.queue_match_players where match_id = target_match.id;
  if coalesce(array_length(selected_ids, 1), 0) <> 4 or (
    select count(*) from public.event_queue_players
    where event_id = target_event_id and member_id = any(selected_ids) and status = 'reserved'
  ) <> 4 then raise exception 'ผู้เล่นในคิว 1 ไม่พร้อม กรุณาแก้คิวก่อน'; end if;
  if not public.queue_lineup_is_compatible(target_event_id, selected_ids) then
    raise exception 'ผู้เล่นในคิว 1 ไม่ตรงกับเงื่อนไขระดับมือแล้ว กรุณาแก้คิวก่อน';
  end if;
  update public.queue_matches
  set status = 'playing', court_id = target_court_id, queue_position = null, started_at = now()
  where id = target_match.id;
  update public.event_queue_players set status = 'playing'
  where event_id = target_event_id and member_id = any(selected_ids);
  perform public.compact_upcoming_queue(target_event_id);
  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (target_club_id, target_event_id, auth.uid(), 'นำคิว 1 ลงสนาม',
    jsonb_build_object('match_id', target_match.id, 'court_id', target_court_id));
  return target_match.id;
end;
$$;

revoke all on function public.start_next_queue_on_court(uuid, uuid) from public;
grant execute on function public.start_next_queue_on_court(uuid, uuid) to authenticated;
