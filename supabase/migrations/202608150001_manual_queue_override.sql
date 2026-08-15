-- Let operators intentionally arrange a mixed-skill lineup while keeping
-- automatic queue proposals strict.

alter table public.queue_matches
  add column if not exists manual_override boolean not null default false;

create or replace function public.create_manual_queue_draft(target_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  new_match_id uuid;
  next_sequence integer;
  next_position integer;
begin
  select club_id into target_club_id
  from public.events
  where id = target_event_id and status = 'open';
  if target_club_id is null or not public.is_club_operator(target_club_id) then
    raise exception 'ไม่พบรอบที่เปิดอยู่หรือไม่มีสิทธิ์จัดคิว';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_event_id::text));
  if exists (
    select 1 from public.queue_matches
    where event_id = target_event_id and status = 'draft'
  ) then
    raise exception 'กรุณาอนุมัติหรือยกเลิกคิวร่างเดิมก่อน';
  end if;
  if (
    select count(*) from public.queue_matches
    where event_id = target_event_id and status in ('draft', 'approved')
  ) >= (
    select count(*) from public.event_courts where event_id = target_event_id
  ) then
    raise exception 'จำนวนคิวล่วงหน้าครบตามจำนวนคอร์ทแล้ว';
  end if;
  if (
    select count(*) from public.event_queue_players
    where event_id = target_event_id and status = 'waiting'
  ) < 4 then
    raise exception 'ต้องมีผู้เล่นพร้อมเข้าคิวอย่างน้อย 4 คน';
  end if;

  select coalesce(max(sequence), 0) + 1 into next_sequence
  from public.queue_matches where event_id = target_event_id;
  select coalesce(max(queue_position), 0) + 1 into next_position
  from public.queue_matches
  where event_id = target_event_id and status in ('draft', 'approved');

  insert into public.queue_matches (
    club_id, event_id, court_id, sequence, queue_position, status,
    manual_override, created_by
  ) values (
    target_club_id, target_event_id, null, next_sequence, next_position,
    'draft', true, auth.uid()
  ) returning id into new_match_id;

  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (
    target_club_id, target_event_id, auth.uid(), 'สร้างคิวร่างด้วยตัวเอง',
    jsonb_build_object('match_id', new_match_id, 'queue_position', next_position)
  );
  return new_match_id;
end;
$$;

create or replace function public.update_manual_queue_draft_lineup(
  target_match_id uuid,
  slot_assignments jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.queue_matches%rowtype;
begin
  select * into target_match
  from public.queue_matches
  where id = target_match_id
  for update;
  if target_match.id is null or not public.is_club_operator(target_match.club_id) then
    raise exception 'ไม่มีสิทธิ์แก้คิว';
  end if;
  if target_match.status not in ('draft', 'approved') then
    raise exception 'แก้ได้เฉพาะคิวที่ยังไม่ลงสนาม';
  end if;

  update public.queue_matches
  set manual_override = true
  where id = target_match_id;
  perform public.update_queue_draft_lineup(target_match_id, slot_assignments);
end;
$$;

create or replace function public.approve_queue_draft(target_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.queue_matches%rowtype;
  selected_ids uuid[];
  compatible boolean;
begin
  select * into target_match from public.queue_matches where id = target_match_id for update;
  if target_match.id is null or not public.is_club_operator(target_match.club_id) then raise exception 'ไม่มีสิทธิ์อนุมัติคิว'; end if;
  if target_match.status <> 'draft' then raise exception 'คิวนี้ไม่ได้อยู่ระหว่างแก้ไข'; end if;
  select array_agg(member_id) into selected_ids from public.queue_match_players where match_id = target_match_id;
  if coalesce(array_length(selected_ids, 1), 0) <> 4 then raise exception 'กรุณาใส่ผู้เล่นให้ครบ 4 คน'; end if;
  if (select count(*) from public.queue_match_players where match_id = target_match_id and team = 'A') <> 2
     or (select count(*) from public.queue_match_players where match_id = target_match_id and team = 'B') <> 2 then
    raise exception 'แต่ละทีมต้องมี 2 คน';
  end if;
  if (
    select count(*) from public.event_queue_players
    where event_id = target_match.event_id and member_id = any(selected_ids) and status = 'reserved'
  ) <> 4 then raise exception 'มีผู้เล่นบางคนไม่พร้อมแล้ว กรุณาจัดคิวใหม่'; end if;

  compatible := public.queue_lineup_is_compatible(target_match.event_id, selected_ids);
  if not compatible and not target_match.manual_override then
    raise exception 'ผู้เล่นชุดนี้ไม่ตรงกับเงื่อนไขระดับมือ';
  end if;

  update public.queue_matches set status = 'approved' where id = target_match_id;
  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (
    target_match.club_id, target_match.event_id, auth.uid(), 'อนุมัติคิวล่วงหน้า',
    jsonb_build_object(
      'match_id', target_match_id,
      'queue_position', target_match.queue_position,
      'manual_override', target_match.manual_override,
      'skill_warning', not compatible
    )
  );
end;
$$;

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
  compatible boolean;
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

  compatible := public.queue_lineup_is_compatible(target_event_id, selected_ids);
  if not compatible and not target_match.manual_override then
    raise exception 'ผู้เล่นในคิว 1 ไม่ตรงกับเงื่อนไขระดับมือแล้ว กรุณาแก้คิวก่อน';
  end if;

  update public.queue_matches
  set status = 'playing', court_id = target_court_id, queue_position = null, started_at = now()
  where id = target_match.id;
  update public.event_queue_players set status = 'playing'
  where event_id = target_event_id and member_id = any(selected_ids);
  perform public.compact_upcoming_queue(target_event_id);
  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (
    target_club_id, target_event_id, auth.uid(), 'นำคิว 1 ลงสนาม',
    jsonb_build_object(
      'match_id', target_match.id,
      'court_id', target_court_id,
      'manual_override', target_match.manual_override,
      'skill_warning', not compatible
    )
  );
  return target_match.id;
end;
$$;

revoke all on function public.create_manual_queue_draft(uuid) from public;
revoke all on function public.update_manual_queue_draft_lineup(uuid, jsonb) from public;
revoke all on function public.approve_queue_draft(uuid) from public;
revoke all on function public.start_next_queue_on_court(uuid, uuid) from public;

grant execute on function public.create_manual_queue_draft(uuid) to authenticated;
grant execute on function public.update_manual_queue_draft_lineup(uuid, jsonb) to authenticated;
grant execute on function public.approve_queue_draft(uuid) to authenticated;
grant execute on function public.start_next_queue_on_court(uuid, uuid) to authenticated;
