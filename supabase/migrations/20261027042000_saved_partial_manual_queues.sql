-- A manually saved lineup is a real upcoming queue from its first player.
-- Full four-player queues continue through the existing approval path. No
-- existing event, signup, queue or payment row is rewritten by this migration.
set local lock_timeout = '2s';
set local statement_timeout = '20s';

create function public.create_partial_manual_queue(target_event_id uuid, selected_member_ids uuid[], team_a_member_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare target_club_id uuid; created_id uuid; next_sequence integer; next_position integer; player_count integer;
begin
  select club_id into target_club_id from public.events where id = target_event_id;
  if target_club_id is null or not public.is_club_operator(target_club_id) then raise exception 'ไม่มีสิทธิ์จัดคิว'; end if;
  perform pg_advisory_xact_lock(hashtext(target_event_id::text));
  perform 1 from public.events where id = target_event_id and status = 'open';
  if not found then raise exception 'รอบนี้ปิดแล้ว กรุณาโหลดข้อมูลใหม่'; end if;
  player_count := coalesce(cardinality(selected_member_ids), 0);
  if player_count not between 1 and 3
    or (select count(distinct id) from unnest(selected_member_ids) id) <> player_count
    or coalesce(cardinality(team_a_member_ids), 0) <> least(player_count, 2)
    or (select count(distinct id) from unnest(team_a_member_ids) id) <> least(player_count, 2)
    or not team_a_member_ids <@ selected_member_ids then
    raise exception 'กรุณาเลือกผู้เล่น 1–3 คนที่ไม่ซ้ำกัน';
  end if;
  perform 1 from public.attendance where event_id = target_event_id and member_id = any(selected_member_ids) order by member_id for share;
  perform 1 from public.signups where event_id = target_event_id and member_id = any(selected_member_ids) order by member_id for share;
  if (select count(*) from public.event_queue_players q
      join public.signups s on s.event_id = q.event_id and s.member_id = q.member_id
      join public.attendance a on a.event_id = q.event_id and a.member_id = q.member_id
      where q.event_id = target_event_id and q.member_id = any(selected_member_ids)
        and q.status in ('waiting', 'playing', 'reserved') and s.status = 'coming' and s.removed_at is null
        and public.skill_level_rank(s.skill_level_snapshot) >= 0 and a.arrived and a.left_at is null) <> player_count then
    raise exception 'มีผู้เล่นบางคนกลับแล้วหรือยังไม่พร้อม กรุณาโหลดข้อมูลใหม่';
  end if;
  if exists (select 1 from public.queue_match_players p join public.queue_matches m on m.id = p.match_id
      where p.event_id = target_event_id and p.member_id = any(selected_member_ids) and m.status in ('draft', 'approved')) then
    raise exception 'มีผู้เล่นอยู่ในคิวล่วงหน้าอื่นแล้ว กรุณาโหลดข้อมูลใหม่';
  end if;
  select coalesce(max(sequence), 0) + 1 into next_sequence from public.queue_matches where event_id = target_event_id;
  select coalesce(max(queue_position), 0) + 1 into next_position from public.queue_matches where event_id = target_event_id and status in ('draft', 'approved');
  insert into public.queue_matches(club_id, event_id, court_id, sequence, queue_position, status, manual_override, created_by)
    values(target_club_id, target_event_id, null, next_sequence, next_position, 'approved', true, auth.uid()) returning id into created_id;
  insert into public.queue_match_players(club_id, event_id, match_id, member_id, team, position, skill_level_snapshot, playable_skill_levels_snapshot)
    select target_club_id, target_event_id, created_id, s.member_id,
      case when s.member_id = any(team_a_member_ids) then 'A' else 'B' end,
      row_number() over (partition by s.member_id = any(team_a_member_ids) order by array_position(selected_member_ids, s.member_id)),
      s.skill_level_snapshot, s.playable_skill_levels_snapshot
    from public.signups s where s.event_id = target_event_id and s.member_id = any(selected_member_ids);
  update public.event_queue_players set status = 'reserved'
    where event_id = target_event_id and member_id = any(selected_member_ids) and status = 'waiting';
  insert into public.audit_logs(club_id, event_id, actor_id, action, details) values
    (target_club_id, target_event_id, auth.uid(), 'บันทึกคิวด้วยตัวเองที่ยังไม่ครบสี่คน',
      jsonb_build_object('match_id', created_id, 'member_ids', selected_member_ids));
  return created_id;
end;
$$;

create function public.save_partial_queue_lineup(target_match_id uuid, slot_assignments jsonb, expected_revision bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare target_match public.queue_matches%rowtype; selected_ids uuid[]; prior_ids uuid[]; player_count integer; saved_revision bigint;
begin
  perform public.lock_queue_event_for_match(target_match_id);
  if jsonb_typeof(slot_assignments) is distinct from 'array' then raise exception 'กรุณาเลือกผู้เล่นอย่างน้อย 1 คน'; end if;
  player_count := jsonb_array_length(slot_assignments);
  if player_count not between 1 and 3 then raise exception 'กรุณาเลือกผู้เล่น 1–3 คน'; end if;
  select array_agg(member_id) into selected_ids from jsonb_to_recordset(slot_assignments) s(member_id uuid);
  perform 1 from public.attendance where event_id = (select event_id from public.queue_matches where id = target_match_id)
    and member_id = any(selected_ids) order by member_id for share;
  perform 1 from public.signups where event_id = (select event_id from public.queue_matches where id = target_match_id)
    and member_id = any(selected_ids) order by member_id for share;
  select * into target_match from public.queue_matches where id = target_match_id for update;
  if expected_revision is null or target_match.revision <> expected_revision then raise exception 'คิวนี้ถูกแก้จากเครื่องอื่นแล้ว กรุณาโหลดคิวล่าสุดก่อนบันทึก'; end if;
  if target_match.status not in ('draft', 'approved') then raise exception 'คิวนี้ลงสนามหรือยกเลิกแล้ว'; end if;
  if exists(select 1 from jsonb_to_recordset(slot_assignments) s(member_id uuid, team text, position integer)
      where member_id is null or team not in ('A', 'B') or position not between 1 and 2)
    or (select count(distinct member_id) from jsonb_to_recordset(slot_assignments) s(member_id uuid)) <> player_count
    or (select count(distinct (team, position)) from jsonb_to_recordset(slot_assignments) s(team text, position integer)) <> player_count then
    raise exception 'ผู้เล่นหรือช่องทีมซ้ำกัน';
  end if;
  select array_agg(member_id) into prior_ids from public.queue_match_players where match_id = target_match_id;
  if (select count(*) from public.event_queue_players q
      join public.signups s on s.event_id = q.event_id and s.member_id = q.member_id
      join public.attendance a on a.event_id = q.event_id and a.member_id = q.member_id
      where q.event_id = target_match.event_id and q.member_id = any(selected_ids)
        and q.status in ('waiting', 'playing', 'reserved') and s.status = 'coming' and s.removed_at is null
        and public.skill_level_rank(s.skill_level_snapshot) >= 0 and a.arrived and a.left_at is null) <> player_count then
    raise exception 'มีผู้เล่นบางคนไม่พร้อมแล้ว กรุณาโหลดข้อมูลใหม่';
  end if;
  if exists(select 1 from public.queue_match_players p join public.queue_matches m on m.id = p.match_id
      where p.event_id = target_match.event_id and p.member_id = any(selected_ids)
        and m.status in ('draft', 'approved') and m.id <> target_match_id) then
    raise exception 'มีผู้เล่นอยู่ในคิวล่วงหน้าอื่นแล้ว กรุณาโหลดข้อมูลใหม่';
  end if;
  delete from public.queue_match_players where match_id = target_match_id;
  insert into public.queue_match_players(club_id, event_id, match_id, member_id, team, position, skill_level_snapshot, playable_skill_levels_snapshot)
    select target_match.club_id, target_match.event_id, target_match_id, s.member_id,
      slot.team, slot.position, s.skill_level_snapshot, s.playable_skill_levels_snapshot
    from jsonb_to_recordset(slot_assignments) slot(member_id uuid, team text, position integer)
    join public.signups s on s.event_id = target_match.event_id and s.member_id = slot.member_id;
  update public.queue_matches set status = 'approved', manual_override = true where id = target_match_id;
  update public.event_queue_players q set status = 'waiting'
    where event_id = target_match.event_id and member_id = any(prior_ids) and status = 'reserved'
      and not (member_id = any(selected_ids))
      and not exists(select 1 from public.queue_match_players p join public.queue_matches m on m.id = p.match_id
        where p.event_id = q.event_id and p.member_id = q.member_id and m.status = 'approved');
  update public.event_queue_players set status = 'reserved'
    where event_id = target_match.event_id and member_id = any(selected_ids) and status = 'waiting';
  insert into public.audit_logs(club_id, event_id, actor_id, action, details) values
    (target_match.club_id, target_match.event_id, auth.uid(), 'บันทึกแก้ไขคิวที่ยังไม่ครบสี่คน',
      jsonb_build_object('match_id', target_match_id, 'member_ids', selected_ids));
  select revision into saved_revision from public.queue_matches where id = target_match_id;
  return saved_revision;
end;
$$;

revoke all on function public.create_partial_manual_queue(uuid, uuid[], uuid[]) from public, anon;
revoke all on function public.save_partial_queue_lineup(uuid, jsonb, bigint) from public, anon;
grant execute on function public.create_partial_manual_queue(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.save_partial_queue_lineup(uuid, jsonb, bigint) to authenticated;
