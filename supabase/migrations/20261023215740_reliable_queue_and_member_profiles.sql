-- Coherent live reads, versioned writes and permanent player profile changes.
-- Stored skill values stay unchanged; the UI calls Rookie- “หน้าบ้าน”.

alter table public.queue_matches add column revision bigint not null default 1;

create function public.bump_queue_match_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  return new;
end;
$$;
create trigger queue_matches_bump_revision before update on public.queue_matches
for each row execute function public.bump_queue_match_revision();

create function public.touch_queue_lineup_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.queue_matches set updated_at = now()
  where id = case when tg_op = 'DELETE' then old.match_id else new.match_id end;
  if tg_op = 'UPDATE' and old.match_id is distinct from new.match_id then
    update public.queue_matches set updated_at = now() where id = old.match_id;
  end if;
  return null;
end;
$$;
create trigger queue_players_touch_revision after insert or update or delete on public.queue_match_players
for each row execute function public.touch_queue_lineup_revision();
revoke all on function public.bump_queue_match_revision() from public, anon, authenticated;
revoke all on function public.touch_queue_lineup_revision() from public, anon, authenticated;

create function public.load_queue_state(target_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare target_club_id uuid; result jsonb;
begin
  select club_id into target_club_id from public.events where id = target_event_id;
  if target_club_id is null or not public.is_club_operator(target_club_id) then
    raise exception 'ไม่มีสิทธิ์ดูข้อมูลรอบนี้';
  end if;
  select jsonb_build_object(
    'event', (select to_jsonb(e) from public.events e where id = target_event_id),
    'members', coalesce((select jsonb_agg(m order by m.created_at) from (
      select id, display_name, nickname, aliases, role, active, line_user_id, payment_exempt,
        skill_level, playable_skill_levels, allow_lower_level, allow_higher_level, created_at
      from public.club_members where club_id = target_club_id) m), '[]'::jsonb),
    'signups', coalesce((select jsonb_agg(s order by s.created_at) from public.signups s where event_id = target_event_id), '[]'::jsonb),
    'attendance', coalesce((select jsonb_agg(a) from public.attendance a where event_id = target_event_id), '[]'::jsonb),
    'courts', coalesce((select jsonb_agg(c order by c.position, c.created_at) from public.event_courts c where event_id = target_event_id), '[]'::jsonb),
    'queuePlayers', coalesce((select jsonb_agg(p) from public.event_queue_players p where event_id = target_event_id), '[]'::jsonb),
    'queueMatches', coalesce((select jsonb_agg(m order by m.sequence desc) from public.queue_matches m where event_id = target_event_id), '[]'::jsonb),
    'queueMatchPlayers', coalesce((select jsonb_agg(p) from public.queue_match_players p where event_id = target_event_id), '[]'::jsonb)
  ) into result;
  if not public.is_club_admin(target_club_id) then
    -- Preserve the existing staff boundary: operational names/skills/times,
    -- without payment exemptions, LINE identifiers or financial event settings.
    result := result || jsonb_build_object(
      'event', (select jsonb_object_agg(key, value) from jsonb_each(result->'event') where key = any(array['id','club_id','title','event_date','venue','status','starts_at','ends_at','created_at','updated_at'])),
      'members', coalesce((select jsonb_agg(m - array['line_user_id','payment_exempt']) from jsonb_array_elements(result->'members') m where m->>'role' = 'member' and (m->>'active')::boolean), '[]'::jsonb),
      'signups', coalesce((select jsonb_agg(s - 'submitted_by_line_user_id') from jsonb_array_elements(result->'signups') s), '[]'::jsonb),
      'attendance', coalesce((select jsonb_agg((select jsonb_object_agg(key,value) from jsonb_each(a) where key = any(array['id','club_id','event_id','member_id','arrived','arrived_at','left_at','created_at','updated_at']))) from jsonb_array_elements(result->'attendance') a), '[]'::jsonb)
    );
  end if;
  return result;
end;
$$;
revoke all on function public.load_queue_state(uuid) from public, anon;
grant execute on function public.load_queue_state(uuid) to authenticated;

create function public.load_event_control_state(target_club_id uuid, target_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_club_admin(target_club_id) or not exists(select 1 from public.events where id = target_event_id and club_id = target_club_id) then raise exception 'ไม่มีสิทธิ์ดูรอบนี้'; end if;
  return jsonb_build_object(
    'event', (select to_jsonb(e) from public.events e where id = target_event_id),
    'courts', coalesce((select jsonb_agg(c order by c.position, c.created_at) from public.event_courts c where event_id = target_event_id), '[]'::jsonb),
    'venues', coalesce((select jsonb_agg(v order by v.created_at desc) from public.club_venues v where club_id = target_club_id), '[]'::jsonb)
  );
end;
$$;

create function public.load_finance_state(target_club_id uuid, target_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_club_admin(target_club_id) or not exists(select 1 from public.events where id = target_event_id and club_id = target_club_id) then raise exception 'ไม่มีสิทธิ์ดูค่าใช้จ่ายรอบนี้'; end if;
  result := public.load_queue_state(target_event_id);
  return result || jsonb_build_object(
    'expenses', coalesce((select jsonb_agg(x order by x.created_at) from public.expenses x where event_id = target_event_id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(p) from public.payments p where event_id = target_event_id), '[]'::jsonb),
    'paymentSlips', coalesce((select jsonb_agg(p order by p.created_at desc) from public.payment_slips p where club_id = target_club_id and status = 'pending'), '[]'::jsonb),
    'paymentSlipPayments', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('events', jsonb_build_object('event_date', e.event_date, 'venue', e.venue)))
      from public.payments p join public.events e on e.id = p.event_id
      where p.club_id = target_club_id and exists(select 1 from public.payment_slips slip where slip.club_id = target_club_id and slip.status = 'pending' and p.id = any(slip.payment_ids))), '[]'::jsonb),
    'extraItems', coalesce((select jsonb_agg(i order by i.created_at) from public.extra_item_catalog i where club_id = target_club_id and active), '[]'::jsonb),
    'memberExtras', coalesce((select jsonb_agg(x order by x.created_at) from public.member_extra_charges x where event_id = target_event_id), '[]'::jsonb),
    'shuttlecockCheckpoints', coalesce((select jsonb_agg(c order by c.checkpoint_time) from public.shuttlecock_checkpoints c where event_id = target_event_id), '[]'::jsonb),
    'perRoundSnapshots', coalesce((select jsonb_agg(s order by s.checkpoint_at) from public.per_round_billing_snapshots s where event_id = target_event_id), '[]'::jsonb),
    'perRoundSnapshotMatches', coalesce((select jsonb_agg(s) from public.per_round_snapshot_matches s where event_id = target_event_id), '[]'::jsonb),
    'perRoundSnapshotAllocations', coalesce((select jsonb_agg(s) from public.per_round_snapshot_allocations s where event_id = target_event_id), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.load_event_control_state(uuid, uuid) from public, anon;
revoke all on function public.load_finance_state(uuid, uuid) from public, anon;
grant execute on function public.load_event_control_state(uuid, uuid) to authenticated;
grant execute on function public.load_finance_state(uuid, uuid) to authenticated;

-- All queue writers acquire the event advisory lock before any queue row lock.
-- These wrappers also protect clients still running the previous web release.
alter function public.approve_queue_draft(uuid) rename to queue_approve_legacy;
alter function public.cancel_upcoming_queue(uuid) rename to queue_cancel_legacy;
alter function public.move_upcoming_queue(uuid, integer) rename to queue_move_legacy;
alter function public.finish_queue_match(uuid) rename to queue_finish_legacy;
alter function public.update_manual_queue_draft_lineup(uuid, jsonb) rename to queue_manual_lineup_legacy;
revoke all on function public.queue_approve_legacy(uuid) from public, anon, authenticated;
revoke all on function public.queue_cancel_legacy(uuid) from public, anon, authenticated;
revoke all on function public.queue_move_legacy(uuid, integer) from public, anon, authenticated;
revoke all on function public.queue_finish_legacy(uuid) from public, anon, authenticated;
revoke all on function public.queue_manual_lineup_legacy(uuid, jsonb) from public, anon, authenticated;

create function public.lock_queue_event_for_match(target_match_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target_event_id uuid; target_club_id uuid;
begin
  select event_id, club_id into target_event_id, target_club_id from public.queue_matches where id = target_match_id;
  if target_event_id is null or not public.is_club_operator(target_club_id) then raise exception 'ไม่มีสิทธิ์จัดคิวนี้'; end if;
  perform pg_advisory_xact_lock(hashtext(target_event_id::text));
  -- The close-round trigger holds the same advisory lock. Avoid taking an event
  -- row lock here: the trigger already owns that row before acquiring this lock.
  perform 1 from public.events where id = target_event_id and status = 'open';
  if not found then raise exception 'รอบนี้ปิดแล้ว กรุณาโหลดข้อมูลใหม่'; end if;
  return target_event_id;
end;
$$;
revoke all on function public.lock_queue_event_for_match(uuid) from public, anon, authenticated;

create function public.approve_queue_draft(target_match_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target_event_id uuid; selected_ids uuid[];
begin
  target_event_id := public.lock_queue_event_for_match(target_match_id);
  select array_agg(member_id) into selected_ids from public.queue_match_players where match_id = target_match_id;
  perform 1 from public.attendance where event_id = target_event_id and member_id = any(selected_ids) order by member_id for share;
  if (select count(*) from public.attendance a join public.signups s on s.event_id = a.event_id and s.member_id = a.member_id
      where a.event_id = target_event_id and a.member_id = any(selected_ids) and a.arrived and a.left_at is null and s.status = 'coming') <> 4
    then raise exception 'มีผู้เล่นบางคนกลับแล้วหรือยังไม่พร้อม กรุณาโหลดข้อมูลใหม่'; end if;
  perform public.queue_approve_legacy(target_match_id);
end;
$$;
create function public.cancel_upcoming_queue(target_match_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin perform public.lock_queue_event_for_match(target_match_id); perform public.queue_cancel_legacy(target_match_id); end;
$$;
create function public.move_upcoming_queue(target_match_id uuid, direction integer)
returns void language plpgsql security definer set search_path = '' as $$
begin perform public.lock_queue_event_for_match(target_match_id); perform public.queue_move_legacy(target_match_id, direction); end;
$$;
create function public.finish_queue_match(target_match_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
begin perform public.lock_queue_event_for_match(target_match_id); return public.queue_finish_legacy(target_match_id); end;
$$;
create or replace function public.return_playing_queue_to_head(target_match_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target_match public.queue_matches%rowtype; selected_ids uuid[];
begin
  perform public.lock_queue_event_for_match(target_match_id);
  select * into target_match from public.queue_matches where id = target_match_id for update;
  if target_match.status <> 'playing' then raise exception 'เกมนี้ไม่ได้อยู่ในสนามแล้ว กรุณาโหลดข้อมูลใหม่'; end if;
  select array_agg(member_id) into selected_ids from public.queue_match_players where match_id = target_match_id;
  if coalesce(cardinality(selected_ids), 0) <> 4 then raise exception 'ผู้เล่นในสนามไม่ครบ 4 คน'; end if;
  if exists(select 1 from public.queue_match_players p join public.queue_matches m on m.id = p.match_id
      where p.event_id = target_match.event_id and p.member_id = any(selected_ids) and m.status in ('draft', 'approved'))
    then raise exception 'ผู้เล่นในสนามมีคิวถัดไปแล้ว กรุณายกเลิกคิวถัดไปของผู้เล่นชุดนี้ก่อน'; end if;
  update public.queue_matches set queue_position = queue_position + 1000000 where event_id = target_match.event_id and status in ('draft', 'approved');
  update public.queue_matches set queue_position = queue_position - 999999 where event_id = target_match.event_id and status in ('draft', 'approved');
  update public.queue_matches set status = 'approved', court_id = null, queue_position = 1, started_at = null, ended_at = null where id = target_match_id;
  update public.event_queue_players set status = 'reserved' where event_id = target_match.event_id and member_id = any(selected_ids);
  insert into public.audit_logs(club_id, event_id, actor_id, action, details) values
    (target_match.club_id, target_match.event_id, auth.uid(), 'นำเกมออกจากสนามกลับเป็นคิว 1', jsonb_build_object('match_id', target_match_id, 'court_id', target_match.court_id));
end;
$$;
create function public.update_manual_queue_draft_lineup(target_match_id uuid, slot_assignments jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin perform public.lock_queue_event_for_match(target_match_id); perform public.queue_manual_lineup_legacy(target_match_id, slot_assignments); end;
$$;

create or replace function public.queue_lineup_is_compatible(target_event_id uuid, selected_member_ids uuid[])
returns boolean language sql stable security definer set search_path = '' as $$
  select cardinality(selected_member_ids) = 4
    and (select count(distinct x) from unnest(selected_member_ids) x) = 4
    and count(*) = 4
    and max(public.skill_level_rank(s.skill_level_snapshot)) - min(public.skill_level_rank(s.skill_level_snapshot)) <= 1
  from public.signups s where s.event_id = target_event_id and s.member_id = any(selected_member_ids)
    and s.status = 'coming' and public.skill_level_rank(s.skill_level_snapshot) >= 0;
$$;

-- Recompute FIFO selection under the write lock, so a stale device cannot skip
-- a newly available older player or reserve a player that another device used.
create function public.next_automatic_queue_members(target_event_id uuid)
returns uuid[] language plpgsql stable security definer set search_path = '' as $$
declare chosen uuid[]; anchor_level integer;
begin
  with eligible as (
    select q.member_id, public.skill_level_rank(s.skill_level_snapshot) as level,
      row_number() over (order by date_trunc('milliseconds', q.queued_at), q.games_played, q.minutes_played, q.member_id) as priority
    from public.event_queue_players q
    join public.signups s on s.event_id = q.event_id and s.member_id = q.member_id
    join public.attendance a on a.event_id = q.event_id and a.member_id = q.member_id
    where q.event_id = target_event_id and q.status = 'waiting' and s.status = 'coming'
      and a.arrived and a.left_at is null and public.skill_level_rank(s.skill_level_snapshot) >= 0
      and q.skip_until_sequence < (select coalesce(max(sequence), 0) + 1 from public.queue_matches where event_id = target_event_id)
      and not exists (select 1 from public.queue_match_players p join public.queue_matches m on m.id = p.match_id
        where p.event_id = target_event_id and p.member_id = q.member_id and m.status in ('draft', 'approved'))
  ), anchor as (select * from eligible where priority = 1), windows as (
    select array_agg(p.member_id order by p.priority) as ids, array_agg(p.priority order by p.priority) as priorities
    from anchor cross join lateral (values(anchor.level - 1), (anchor.level)) w(min_level)
    cross join lateral (select e.* from eligible e where e.level between w.min_level and w.min_level + 1 order by e.priority limit 4) p
    group by w.min_level having count(*) = 4
  ) select ids into chosen from windows order by priorities limit 1;
  if cardinality(chosen) = 4 then return chosen; end if;

  with eligible as (
    select q.member_id, public.skill_level_rank(s.skill_level_snapshot) as level,
      row_number() over (order by date_trunc('milliseconds', q.queued_at), q.games_played, q.minutes_played, q.member_id) as priority
    from public.event_queue_players q
    join public.signups s on s.event_id = q.event_id and s.member_id = q.member_id
    join public.attendance a on a.event_id = q.event_id and a.member_id = q.member_id
    where q.event_id = target_event_id and q.status = 'waiting' and s.status = 'coming'
      and a.arrived and a.left_at is null and public.skill_level_rank(s.skill_level_snapshot) >= 0
      and q.skip_until_sequence < (select coalesce(max(sequence), 0) + 1 from public.queue_matches where event_id = target_event_id)
      and not exists (select 1 from public.queue_match_players p join public.queue_matches m on m.id = p.match_id
        where p.event_id = target_event_id and p.member_id = q.member_id and m.status in ('draft', 'approved'))
  ), anchor as (select level from eligible where priority = 1), picked as (
    select e.*, case when e.level <= a.level + 1 then 0 else e.level - a.level end as distance
    from eligible e cross join anchor a where e.level >= a.level - 1
    order by distance, e.priority limit 4
  ) select array_agg(member_id order by distance, priority) into chosen from picked;
  if cardinality(chosen) = 4 then return chosen; end if;
  return '{}'::uuid[];
end;
$$;
revoke all on function public.next_automatic_queue_members(uuid) from public, anon, authenticated;

create function public.create_manual_queue_with_players(target_event_id uuid, selected_member_ids uuid[], team_a_member_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare target_club_id uuid; created_id uuid; next_sequence integer; next_position integer;
begin
  select club_id into target_club_id from public.events where id = target_event_id;
  if target_club_id is null or not public.is_club_operator(target_club_id) then raise exception 'ไม่มีสิทธิ์จัดคิว'; end if;
  perform pg_advisory_xact_lock(hashtext(target_event_id::text));
  perform 1 from public.events where id = target_event_id and status = 'open';
  if not found then raise exception 'รอบนี้ปิดแล้ว กรุณาโหลดข้อมูลใหม่'; end if;
  if coalesce(cardinality(selected_member_ids), 0) <> 4 or (select count(distinct x) from unnest(selected_member_ids) x) <> 4
     or coalesce(cardinality(team_a_member_ids), 0) <> 2 or (select count(distinct x) from unnest(team_a_member_ids) x) <> 2
     or not team_a_member_ids <@ selected_member_ids then raise exception 'กรุณาเลือกผู้เล่น 4 คนที่ไม่ซ้ำกัน'; end if;
  -- A departure holds its attendance row before invalidating future queues.
  -- Lock attendance first so it cannot pass validation and leave concurrently.
  perform 1 from public.attendance where event_id = target_event_id and member_id = any(selected_member_ids) order by member_id for share;
  -- A permanent skill correction writes signups before touching draft matches.
  -- Wait here, before creating a match, so its skill snapshot is not stale.
  perform 1 from public.signups where event_id = target_event_id and member_id = any(selected_member_ids) order by member_id for share;
  if (select count(*) from public.event_queue_players q
      join public.signups s on s.event_id = q.event_id and s.member_id = q.member_id
      join public.attendance a on a.event_id = q.event_id and a.member_id = q.member_id
      where q.event_id = target_event_id and q.member_id = any(selected_member_ids)
        and q.status in ('waiting', 'playing', 'reserved') and s.status = 'coming'
        and public.skill_level_rank(s.skill_level_snapshot) >= 0 and a.arrived and a.left_at is null) <> 4
    then raise exception 'มีผู้เล่นบางคนกลับแล้วหรือยังไม่พร้อม กรุณาโหลดข้อมูลใหม่'; end if;
  if exists (select 1 from public.queue_match_players p join public.queue_matches m on m.id = p.match_id
      where p.event_id = target_event_id and p.member_id = any(selected_member_ids) and m.status in ('draft', 'approved'))
    then raise exception 'มีผู้เล่นอยู่ในคิวล่วงหน้าอื่นแล้ว กรุณาโหลดข้อมูลใหม่'; end if;
  select coalesce(max(sequence), 0) + 1 into next_sequence from public.queue_matches where event_id = target_event_id;
  select coalesce(max(queue_position), 0) + 1 into next_position from public.queue_matches where event_id = target_event_id and status in ('draft', 'approved');
  insert into public.queue_matches(club_id, event_id, court_id, sequence, queue_position, status, manual_override, created_by)
    values(target_club_id, target_event_id, null, next_sequence, next_position, 'draft', true, auth.uid()) returning id into created_id;
  insert into public.queue_match_players(club_id, event_id, match_id, member_id, team, position, skill_level_snapshot, playable_skill_levels_snapshot)
    select target_club_id, target_event_id, created_id, s.member_id,
      case when s.member_id = any(team_a_member_ids) then 'A' else 'B' end,
      row_number() over (partition by s.member_id = any(team_a_member_ids) order by array_position(selected_member_ids, s.member_id)),
      s.skill_level_snapshot, s.playable_skill_levels_snapshot
    from public.signups s where s.event_id = target_event_id and s.member_id = any(selected_member_ids);
  insert into public.audit_logs(club_id, event_id, actor_id, action, details) values
    (target_club_id, target_event_id, auth.uid(), 'สร้างคิวร่างด้วยตัวเอง', jsonb_build_object('match_id', created_id, 'member_ids', selected_member_ids));
  return created_id;
end;
$$;

create or replace function public.create_fallback_queue_draft(target_event_id uuid, selected_member_ids uuid[], team_a_member_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare expected_ids uuid[]; created_id uuid; target_club_id uuid;
begin
  select club_id into target_club_id from public.events where id = target_event_id;
  if target_club_id is null or not public.is_club_operator(target_club_id) then raise exception 'ไม่มีสิทธิ์จัดคิว'; end if;
  perform pg_advisory_xact_lock(hashtext(target_event_id::text));
  perform 1 from public.attendance where event_id = target_event_id order by member_id for share;
  perform 1 from public.signups where event_id = target_event_id order by member_id for share;
  expected_ids := public.next_automatic_queue_members(target_event_id);
  if cardinality(expected_ids) <> 4 or not (selected_member_ids @> expected_ids and selected_member_ids <@ expected_ids)
    then raise exception 'รายชื่อหรือเวลารอเปลี่ยนแล้ว กรุณาโหลดข้อมูลและจัดคิวใหม่'; end if;
  created_id := public.create_manual_queue_with_players(target_event_id, selected_member_ids, team_a_member_ids);
  update public.queue_matches set manual_override = not public.queue_lineup_is_compatible(target_event_id, selected_member_ids) where id = created_id;
  return created_id;
end;
$$;

create or replace function public.create_queue_draft(target_event_id uuid, selected_member_ids uuid[], team_a_member_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  return public.create_fallback_queue_draft(target_event_id, selected_member_ids, team_a_member_ids);
end;
$$;

create function public.save_queue_lineup(target_match_id uuid, slot_assignments jsonb, expected_revision bigint, approve_after_save boolean default false)
returns bigint language plpgsql security definer set search_path = '' as $$
declare target_match public.queue_matches%rowtype; selected_ids uuid[]; prior_ids uuid[]; saved_revision bigint;
begin
  perform public.lock_queue_event_for_match(target_match_id);
  if jsonb_typeof(slot_assignments) is distinct from 'array' or jsonb_array_length(slot_assignments) <> 4 then raise exception 'กรุณาเลือกผู้เล่นให้ครบ 4 คน'; end if;
  select array_agg(member_id) into selected_ids from jsonb_to_recordset(slot_assignments) s(member_id uuid);
  perform 1 from public.attendance where event_id = (select event_id from public.queue_matches where id = target_match_id)
    and member_id = any(selected_ids) order by member_id for share;
  select * into target_match from public.queue_matches where id = target_match_id for update;
  if expected_revision is null or target_match.revision <> expected_revision then raise exception 'คิวนี้ถูกแก้จากเครื่องอื่นแล้ว กรุณาโหลดคิวล่าสุดก่อนบันทึก'; end if;
  if target_match.status not in ('draft', 'approved') then raise exception 'คิวนี้ลงสนามหรือยกเลิกแล้ว'; end if;
  if exists(select 1 from jsonb_to_recordset(slot_assignments) s(member_id uuid, team text, position integer)
      where member_id is null or team is null or team not in ('A', 'B') or position is null or position not between 1 and 2)
    or (select count(distinct member_id) from jsonb_to_recordset(slot_assignments) s(member_id uuid)) <> 4
    or (select count(distinct (team, position)) from jsonb_to_recordset(slot_assignments) s(team text, position integer)) <> 4
    then raise exception 'ผู้เล่นหรือช่องทีมซ้ำกัน'; end if;
  select array_agg(member_id) into prior_ids from public.queue_match_players where match_id = target_match_id;
  if (select count(*) from public.event_queue_players q
      join public.signups s on s.event_id = q.event_id and s.member_id = q.member_id
      join public.attendance a on a.event_id = q.event_id and a.member_id = q.member_id
      where q.event_id = target_match.event_id and q.member_id = any(selected_ids) and q.status in ('waiting', 'playing', 'reserved')
        and s.status = 'coming' and public.skill_level_rank(s.skill_level_snapshot) >= 0 and a.arrived and a.left_at is null) <> 4
    then raise exception 'มีผู้เล่นบางคนไม่พร้อมแล้ว กรุณาโหลดข้อมูลใหม่'; end if;
  if exists(select 1 from public.queue_match_players p join public.queue_matches m on m.id = p.match_id
      where p.event_id = target_match.event_id and p.member_id = any(selected_ids) and m.status in ('draft', 'approved') and m.id <> target_match_id)
    then raise exception 'มีผู้เล่นอยู่ในคิวล่วงหน้าอื่นแล้ว กรุณาโหลดข้อมูลใหม่'; end if;
  delete from public.queue_match_players where match_id = target_match_id;
  insert into public.queue_match_players(club_id, event_id, match_id, member_id, team, position, skill_level_snapshot, playable_skill_levels_snapshot)
    select target_match.club_id, target_match.event_id, target_match_id, s.member_id, slot.team, slot.position, s.skill_level_snapshot, s.playable_skill_levels_snapshot
    from jsonb_to_recordset(slot_assignments) slot(member_id uuid, team text, position integer)
    join public.signups s on s.event_id = target_match.event_id and s.member_id = slot.member_id;
  update public.queue_matches set status = 'draft', manual_override = true where id = target_match_id;
  update public.event_queue_players q set status = 'waiting'
    where event_id = target_match.event_id and member_id = any(prior_ids) and status = 'reserved'
      and not exists(select 1 from public.queue_match_players p join public.queue_matches m on m.id = p.match_id
        where p.event_id = q.event_id and p.member_id = q.member_id and m.status = 'approved');
  if approve_after_save then perform public.approve_queue_draft(target_match_id); end if;
  insert into public.audit_logs(club_id, event_id, actor_id, action, details) values
    (target_match.club_id, target_match.event_id, auth.uid(), 'บันทึกคิวที่เลือกผู้เล่น', jsonb_build_object('match_id', target_match_id, 'member_ids', selected_ids));
  select revision into saved_revision from public.queue_matches where id = target_match_id;
  return saved_revision;
end;
$$;

create function public.approve_queue_drafts(requested_drafts jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare target_event_id uuid; requested_count integer; entry record; current_match public.queue_matches%rowtype;
begin
  if jsonb_typeof(requested_drafts) is distinct from 'array' or jsonb_array_length(requested_drafts) < 1 then raise exception 'กรุณาเลือกคิวที่ต้องการอนุมัติ'; end if;
  requested_count := jsonb_array_length(requested_drafts);
  if (select count(distinct match_id) from jsonb_to_recordset(requested_drafts) d(match_id uuid)) <> requested_count then raise exception 'รายการคิวซ้ำหรือไม่ถูกต้อง'; end if;
  select m.event_id into target_event_id from public.queue_matches m where m.id = (requested_drafts->0->>'match_id')::uuid;
  perform public.lock_queue_event_for_match((requested_drafts->0->>'match_id')::uuid);
  perform 1 from public.attendance where event_id = target_event_id and member_id in (
    select p.member_id from public.queue_match_players p join jsonb_to_recordset(requested_drafts) d(match_id uuid) on d.match_id = p.match_id
  ) order by member_id for share;
  for entry in select * from jsonb_to_recordset(requested_drafts) d(match_id uuid, revision bigint) order by match_id loop
    select * into current_match from public.queue_matches where id = entry.match_id for update;
    if current_match.id is null or current_match.event_id <> target_event_id or current_match.status <> 'draft'
      or entry.revision is null or current_match.revision <> entry.revision then
      raise exception 'มีคิวถูกแก้ไขหรืออนุมัติจากเครื่องอื่นแล้ว กรุณาโหลดคิวล่าสุด';
    end if;
    perform public.approve_queue_draft(entry.match_id);
  end loop;
  return requested_count;
end;
$$;

-- Starting uses the skill snapshot that was actually approved. A permanent
-- profile correction must not invalidate an already approved/playing game.
create or replace function public.start_next_queue_on_court(target_event_id uuid, target_court_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  target_event public.events%rowtype; target_court public.event_courts%rowtype;
  target_match public.queue_matches%rowtype; selected_ids uuid[]; stale_match_id uuid; compatible boolean;
begin
  select * into target_event from public.events where id = target_event_id;
  if target_event.id is null or not public.is_club_operator(target_event.club_id) then raise exception 'ไม่มีสิทธิ์เริ่มเกม'; end if;
  perform pg_advisory_xact_lock(hashtext(target_event_id::text));
  select * into target_event from public.events where id = target_event_id and status = 'open';
  if target_event.id is null then raise exception 'รอบนี้ปิดแล้ว กรุณาโหลดข้อมูลใหม่'; end if;
  select * into target_court from public.event_courts where id = target_court_id and event_id = target_event_id;
  if target_court.id is null then raise exception 'ไม่พบคอร์ทนี้'; end if;
  if now() < public.event_local_instant(target_event.event_date, target_event.starts_at, target_court.starts_at) then raise exception 'คอร์ทนี้ยังไม่ถึงเวลาเริ่ม'; end if;
  if now() >= public.event_local_instant(target_event.event_date, target_event.starts_at, target_court.ends_at) then raise exception 'คอร์ทนี้หมดเวลาแล้ว'; end if;
  if exists(select 1 from public.queue_matches where event_id = target_event_id and court_id = target_court_id and status = 'playing') then raise exception 'คอร์ทนี้กำลังใช้งาน'; end if;
  select * into target_match from public.queue_matches where event_id = target_event_id and status in ('draft', 'approved') order by queue_position, proposed_at limit 1;
  if target_match.id is null then raise exception 'ยังไม่มีคิวล่วงหน้า'; end if;
  select array_agg(member_id) into selected_ids from public.queue_match_players where match_id = target_match.id;
  perform 1 from public.attendance where event_id = target_event_id and member_id = any(selected_ids) order by member_id for share;
  select * into target_match from public.queue_matches where id = target_match.id for update;
  if target_match.status <> 'approved' then raise exception 'กรุณาตรวจและอนุมัติคิว 1 ก่อนนำลงสนาม'; end if;
  if coalesce(cardinality(selected_ids), 0) <> 4 then raise exception 'ผู้เล่นในคิว 1 ไม่ครบ 4 คน'; end if;
  if (select count(*) from public.attendance where event_id = target_event_id and member_id = any(selected_ids) and arrived and left_at is null) <> 4 then raise exception 'มีผู้เล่นในคิว 1 กลับแล้ว กรุณาแก้คิวก่อน'; end if;
  for stale_match_id in
    select distinct playing.id from public.queue_match_players selected_player
    join public.queue_match_players playing_player on playing_player.member_id = selected_player.member_id
    join public.queue_matches playing on playing.id = playing_player.match_id and playing.status = 'playing'
    join public.event_courts playing_court on playing_court.id = playing.court_id
    where selected_player.match_id = target_match.id and playing.id <> target_match.id and playing.event_id = target_event_id
      and public.event_local_instant(target_event.event_date, target_event.starts_at, playing_court.ends_at) <= now()
  loop perform public.finish_queue_match(stale_match_id); end loop;
  if exists(select 1 from public.queue_match_players p join public.queue_matches m on m.id = p.match_id
    where p.member_id = any(selected_ids) and m.id <> target_match.id and m.event_id = target_event_id and m.status = 'playing')
    then raise exception 'ผู้เล่นในคิว 1 ยังเล่นอยู่ในสนาม กรุณารอให้จบเกมก่อน'; end if;
  if (select count(*) from public.event_queue_players where event_id = target_event_id and member_id = any(selected_ids) and status = 'reserved') <> 4 then raise exception 'ผู้เล่นในคิว 1 ยังไม่พร้อม กรุณาโหลดข้อมูลใหม่หรือแก้คิวก่อน'; end if;
  select max(public.skill_level_rank(skill_level_snapshot)) - min(public.skill_level_rank(skill_level_snapshot)) <= 1
    into compatible from public.queue_match_players where match_id = target_match.id;
  if not compatible and not target_match.manual_override then raise exception 'คิวนี้ไม่ตรงกับเงื่อนไขระดับมือ กรุณาตรวจรายชื่อก่อน'; end if;
  update public.queue_matches set status = 'playing', court_id = target_court_id, queue_position = null, started_at = now() where id = target_match.id;
  update public.event_queue_players set status = 'playing' where event_id = target_event_id and member_id = any(selected_ids);
  perform public.compact_upcoming_queue(target_event_id);
  insert into public.audit_logs(club_id,event_id,actor_id,action,details) values
    (target_event.club_id,target_event_id,auth.uid(),'นำคิว 1 ลงสนาม',jsonb_build_object('match_id',target_match.id,'court_id',target_court_id,'manual_override',target_match.manual_override,'skill_warning',not compatible));
  return target_match.id;
end;
$$;

-- Save the master member once and update active round signup snapshots in the
-- same transaction. Completed/playing match snapshots remain immutable.
create function public.operator_update_member_profile(target_member_id uuid, profile_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare member_row public.club_members%rowtype; new_level text; playable text[]; saved_aliases text[]; draft_ids uuid[]; locked_event_id uuid;
begin
  -- Only non-key profile fields change. Permit FK KEY SHARE from queue creation
  -- while this transaction waits for its signup locks (otherwise a cycle).
  select * into member_row from public.club_members where id = target_member_id for no key update;
  if member_row.id is null or member_row.role <> 'member' or not public.is_club_operator(member_row.club_id) then raise exception 'ไม่มีสิทธิ์แก้ไขผู้เล่น'; end if;
  if jsonb_typeof(profile_patch) is distinct from 'object' then raise exception 'ข้อมูลผู้เล่นไม่ถูกต้อง'; end if;
  if profile_patch ? 'payment_exempt' and not public.is_club_admin(member_row.club_id) then raise exception 'เฉพาะแอดมินที่แก้ไขการยกเว้นค่าใช้จ่ายได้'; end if;
  if (profile_patch ? 'nickname' and coalesce(trim(profile_patch->>'nickname'), '') = '')
    or (profile_patch ? 'display_name' and coalesce(trim(profile_patch->>'display_name'), '') = '') then raise exception 'กรุณากรอกชื่อผู้เล่น'; end if;
  new_level := case when profile_patch ? 'skill_level' then profile_patch->>'skill_level' else member_row.skill_level end;
  if new_level = 'หน้าบ้าน' then new_level := 'Rookie-'; end if;
  if new_level is not null and public.skill_level_rank(new_level) < 0 then raise exception 'ระดับมือไม่ถูกต้อง'; end if;
  playable := case when profile_patch ? 'playable_skill_levels' then array(select jsonb_array_elements_text(profile_patch->'playable_skill_levels')) else member_row.playable_skill_levels end;
  if new_level is not null and (playable is null or not new_level = any(playable)) then
    select array_agg(level order by ord) into playable from unnest(array['Rookie-', 'Rookie', 'BG', 'N', 'S', 'P']) with ordinality l(level, ord)
      where abs(public.skill_level_rank(level) - public.skill_level_rank(new_level)) <= 1;
  end if;
  if playable is null then playable := '{}'::text[]; end if;
  if not playable <@ array['Rookie-', 'Rookie', 'BG', 'N', 'S', 'P']::text[] then raise exception 'ระดับมือที่เล่นด้วยไม่ถูกต้อง'; end if;
  -- Legacy cached clients may swap players across multiple draft matches.
  -- Serialize with those queue writers before taking signup or match locks;
  -- acquiring advisory locks after signup UPDATE would invert auto creation.
  if profile_patch ? 'skill_level' or profile_patch ? 'playable_skill_levels' then
    for locked_event_id in
      select e.id from public.events e join public.signups s on s.event_id = e.id
      where s.member_id = target_member_id and s.status = 'coming' and e.status in ('draft', 'open')
      order by e.id
    loop
      perform pg_advisory_xact_lock(hashtext(locked_event_id::text));
    end loop;
  end if;
  select array_agg(distinct name) into saved_aliases from unnest(coalesce(member_row.aliases, '{}'::text[]) || array[member_row.nickname, member_row.display_name]) name where coalesce(trim(name), '') <> '';
  update public.club_members set
    nickname = case when profile_patch ? 'nickname' then trim(profile_patch->>'nickname') else nickname end,
    display_name = case when profile_patch ? 'display_name' then trim(profile_patch->>'display_name') else display_name end,
    aliases = coalesce(saved_aliases, '{}'::text[]),
    payment_exempt = case when profile_patch ? 'payment_exempt' then (profile_patch->>'payment_exempt')::boolean else payment_exempt end,
    skill_level = new_level, playable_skill_levels = playable,
    allow_lower_level = exists(select 1 from unnest(playable) l where public.skill_level_rank(l) = public.skill_level_rank(new_level) - 1),
    allow_higher_level = exists(select 1 from unnest(playable) l where public.skill_level_rank(l) = public.skill_level_rank(new_level) + 1)
  where id = target_member_id returning * into member_row;
  if profile_patch ? 'skill_level' or profile_patch ? 'playable_skill_levels' then
    update public.signups s set skill_level_snapshot = member_row.skill_level,
      playable_skill_levels_snapshot = member_row.playable_skill_levels,
      allow_lower_level_snapshot = member_row.allow_lower_level, allow_higher_level_snapshot = member_row.allow_higher_level
    from public.events e where e.id = s.event_id and s.member_id = target_member_id and s.status = 'coming' and e.status in ('draft', 'open');
    -- Queue editors lock parent match before child players. Match the same order
    -- before the player UPDATE fires its parent-revision trigger. Capture IDs so
    -- a newly inserted draft cannot enter this UPDATE without its parent lock.
    select coalesce(array_agg(locked.id), '{}'::uuid[]) into draft_ids from (
      select m.id from public.queue_matches m join public.events e on e.id = m.event_id
      where e.status = 'open' and m.status = 'draft'
        and exists(select 1 from public.queue_match_players p where p.match_id = m.id and p.member_id = target_member_id)
      order by m.id for update of m
    ) locked;
    update public.queue_match_players p set skill_level_snapshot = member_row.skill_level,
      playable_skill_levels_snapshot = member_row.playable_skill_levels
    where p.match_id = any(draft_ids)
      and p.member_id = target_member_id and member_row.skill_level is not null;
  end if;
  insert into public.audit_logs(club_id, actor_id, action, details) values
    (member_row.club_id, auth.uid(), 'แก้ไขข้อมูลสมาชิกถาวร', jsonb_build_object('member_id', target_member_id, 'skill_level', member_row.skill_level));
  return jsonb_build_object('id', member_row.id, 'nickname', member_row.nickname, 'display_name', member_row.display_name,
    'skill_level', member_row.skill_level, 'playable_skill_levels', member_row.playable_skill_levels);
end;
$$;

create or replace function public.operator_update_member_skill(target_event_id uuid, target_member_id uuid, next_skill_level text, next_playable_skill_levels text[])
returns text language plpgsql security definer set search_path = '' as $$
declare target_club_id uuid;
begin
  select club_id into target_club_id from public.events where id = target_event_id and status in ('draft', 'open');
  if target_club_id is null or not public.is_club_operator(target_club_id)
    or not exists(select 1 from public.club_members where id = target_member_id and club_id = target_club_id) then raise exception 'ไม่มีสิทธิ์แก้ระดับมือในรอบนี้'; end if;
  perform public.operator_update_member_profile(target_member_id, jsonb_build_object('skill_level', next_skill_level, 'playable_skill_levels', next_playable_skill_levels));
  return 'now';
end;
$$;

revoke all on function public.approve_queue_draft(uuid) from public, anon;
revoke all on function public.cancel_upcoming_queue(uuid) from public, anon;
revoke all on function public.move_upcoming_queue(uuid, integer) from public, anon;
revoke all on function public.finish_queue_match(uuid) from public, anon;
revoke all on function public.return_playing_queue_to_head(uuid) from public, anon;
revoke all on function public.update_manual_queue_draft_lineup(uuid, jsonb) from public, anon;
revoke all on function public.create_manual_queue_with_players(uuid, uuid[], uuid[]) from public, anon;
revoke all on function public.save_queue_lineup(uuid, jsonb, bigint, boolean) from public, anon;
revoke all on function public.approve_queue_drafts(jsonb) from public, anon;
revoke all on function public.operator_update_member_profile(uuid, jsonb) from public, anon;
grant execute on function public.approve_queue_draft(uuid) to authenticated;
grant execute on function public.cancel_upcoming_queue(uuid) to authenticated;
grant execute on function public.move_upcoming_queue(uuid, integer) to authenticated;
grant execute on function public.finish_queue_match(uuid) to authenticated;
grant execute on function public.return_playing_queue_to_head(uuid) to authenticated;
grant execute on function public.update_manual_queue_draft_lineup(uuid, jsonb) to authenticated;
grant execute on function public.create_manual_queue_with_players(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.save_queue_lineup(uuid, jsonb, bigint, boolean) to authenticated;
grant execute on function public.approve_queue_drafts(jsonb) to authenticated;
grant execute on function public.operator_update_member_profile(uuid, jsonb) to authenticated;

-- Amounts are calculated by the existing client finance engine immediately
-- before this call. Persist them and close the event as one transaction, while
-- preserving any bill another operator/slip verifier has already confirmed.
create function public.finish_event(target_event_id uuid, settlement_rows jsonb, final_shuttlecock_count integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_event public.events%rowtype; saved_count integer;
begin
  -- Event-first ordering matches departure snapshots and the close trigger.
  -- Non-key locking permits queue inserts' event FK KEY SHARE while this call
  -- waits for their event advisory lock. FOR UPDATE here would create a cycle.
  select * into target_event from public.events where id = target_event_id for no key update;
  if target_event.id is null or not public.is_club_admin(target_event.club_id) then raise exception 'ไม่มีสิทธิ์จบรอบ'; end if;
  if target_event.status = 'closed' then return jsonb_build_object('event_id', target_event_id, 'already_closed', true, 'saved_count', 0); end if;
  if target_event.status <> 'open' then raise exception 'จบรอบได้เฉพาะรอบที่เปิดอยู่'; end if;
  perform pg_advisory_xact_lock(hashtext(target_event_id::text));
  if target_event.billing_model = 'per_round' and exists(select 1 from public.queue_matches where event_id = target_event_id and status = 'playing')
    then raise exception 'ยังมีสนามกำลังเล่น กรุณาจบเกมทุกสนามก่อนจบรอบ'; end if;
  if jsonb_typeof(settlement_rows) is distinct from 'array' then raise exception 'ข้อมูลยอดของผู้เล่นไม่ถูกต้อง'; end if;
  if final_shuttlecock_count is null or final_shuttlecock_count < 0 or final_shuttlecock_count > 1000 then raise exception 'จำนวนลูกแบดไม่ถูกต้อง'; end if;
  if (select count(distinct member_id) from jsonb_to_recordset(settlement_rows) r(member_id uuid)) <> jsonb_array_length(settlement_rows)
    or exists(select 1 from jsonb_to_recordset(settlement_rows) r(member_id uuid, amount numeric, shared_amount numeric, extras_amount numeric)
      where amount is null or amount < 0 or amount = 'NaN'::numeric or amount >= 10000000000
        or shared_amount is null or shared_amount < 0 or shared_amount = 'NaN'::numeric or shared_amount >= 10000000000
        or extras_amount is null or extras_amount < 0 or extras_amount = 'NaN'::numeric or extras_amount >= 10000000000
        or not exists(select 1 from public.club_members where id = r.member_id and club_id = target_event.club_id))
    then raise exception 'รายชื่อหรือยอดชำระไม่ถูกต้อง กรุณาโหลดข้อมูลใหม่'; end if;

  perform 1 from public.payments where event_id = target_event_id order by id for update;
  insert into public.payments as current_payment (
    club_id, event_id, member_id, amount, calculated_amount, billed_at, admin_confirmed_at,
    paid_at, payment_status, paid_source, shared_amount, extras_amount, shuttlecock_count_snapshot, recorded_by
  )
  select target_event.club_id, target_event_id, r.member_id, r.amount, r.amount,
    case when m.payment_exempt then now() end, case when m.payment_exempt then now() end,
    case when m.payment_exempt then now() end, case when m.payment_exempt then 'paid' else 'draft' end,
    case when m.payment_exempt then 'exempt' end, r.shared_amount, r.extras_amount, final_shuttlecock_count, auth.uid()
  from jsonb_to_recordset(settlement_rows) r(member_id uuid, amount numeric, shared_amount numeric, extras_amount numeric)
  join public.club_members m on m.id = r.member_id and m.club_id = target_event.club_id
  join public.signups s on s.event_id = target_event_id and s.member_id = r.member_id and s.status = 'coming'
  join public.attendance a on a.event_id = target_event_id and a.member_id = r.member_id and a.arrived
  where not exists(select 1 from public.payments p where p.event_id = target_event_id and p.member_id = r.member_id
    and (p.paid_at is not null or p.admin_confirmed_at is not null or p.payment_status = 'review'
      or exists(select 1 from public.payment_slips slip where slip.status = 'pending' and p.id = any(slip.payment_ids))))
  on conflict(event_id, member_id) do update set
    amount = excluded.amount, calculated_amount = excluded.calculated_amount,
    billed_at = excluded.billed_at, admin_confirmed_at = excluded.admin_confirmed_at,
    paid_at = excluded.paid_at, payment_status = excluded.payment_status, paid_source = excluded.paid_source,
    shared_amount = excluded.shared_amount, extras_amount = excluded.extras_amount,
    shuttlecock_count_snapshot = excluded.shuttlecock_count_snapshot, recorded_by = excluded.recorded_by
  where current_payment.paid_at is null and current_payment.admin_confirmed_at is null and current_payment.payment_status <> 'review';
  get diagnostics saved_count = row_count;
  update public.events set status = 'closed' where id = target_event_id;
  insert into public.audit_logs(club_id,event_id,actor_id,action,details) values
    (target_event.club_id,target_event_id,auth.uid(),'จบรอบและบันทึกยอดในรายการเดียว',jsonb_build_object('saved_count',saved_count,'billing_model',target_event.billing_model));
  return jsonb_build_object('event_id', target_event_id, 'saved_count', saved_count);
end;
$$;
revoke all on function public.finish_event(uuid, jsonb, integer) from public, anon;
grant execute on function public.finish_event(uuid, jsonb, integer) to authenticated;

-- The existing departure-snapshot routine also serializes on the event before
-- changing attendance. FOR UPDATE would block an automatic queue's event FK
-- check while the snapshot waits for its attendance SHARE lock. Change only
-- that lock strength; retain its billing logic, signature, owner and grants.
-- Fail closed if the known legacy body has drifted rather than replace an
-- unrelated lock. pg_get_functiondef retains the stored PL/pgSQL body text.
do $lock_upgrade$
declare
  definition text := pg_get_functiondef('public.snapshot_per_round_departure(uuid,uuid,time,integer)'::regprocedure);
  old_clause text := E'where id = target_event_id\n  for update;';
  new_clause text := E'where id = target_event_id\n  for no key update;';
begin
  if (length(definition) - length(replace(definition, old_clause, ''))) / length(old_clause) <> 1 then
    raise exception 'Departure snapshot event lock definition has changed; review before applying migration';
  end if;
  execute replace(definition, old_clause, new_clause);
end;
$lock_upgrade$;
