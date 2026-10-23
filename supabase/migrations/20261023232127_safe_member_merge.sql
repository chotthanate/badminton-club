-- Both public RPC names share the same complete, atomic merge. Never perform a
-- historical merge while either identity is assigned to a live/upcoming game.
create or replace function public.merge_club_members(source_member_id uuid, target_member_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  source_member public.club_members%rowtype;
  target_member public.club_members%rowtype;
  locked_event_id uuid;
  merged_aliases text[];
  saved_snapshot_matches jsonb;
begin
  if source_member_id is null or target_member_id is null or source_member_id = target_member_id then
    raise exception 'กรุณาเลือกชื่อหลักและชื่อซ้ำคนละรายการ';
  end if;
  select * into source_member from public.club_members where id = source_member_id;
  select * into target_member from public.club_members where id = target_member_id;
  if source_member.id is null or target_member.id is null then raise exception 'ไม่พบรายชื่อที่ต้องการรวม กรุณาโหลดข้อมูลล่าสุด'; end if;
  if source_member.club_id <> target_member.club_id or not public.is_club_admin(target_member.club_id) then
    raise exception 'อนุญาตเฉพาะแอดมินในกลุ่มเดียวกัน';
  end if;
  -- Match the profile editor's member -> event -> child lock order. Do not wait
  -- on an in-flight game/financial writer: safely abort and let the user retry.
  perform 1 from public.club_members where id in (source_member_id, target_member_id)
    order by id for no key update nowait;
  select * into source_member from public.club_members where id = source_member_id;
  select * into target_member from public.club_members where id = target_member_id;
  if source_member.id is null or target_member.id is null then raise exception 'ไม่พบรายชื่อที่ต้องการรวม กรุณาโหลดข้อมูลล่าสุด'; end if;
  if source_member.club_id <> target_member.club_id or not public.is_club_admin(target_member.club_id) then
    raise exception 'อนุญาตเฉพาะแอดมินในกลุ่มเดียวกัน';
  end if;
  if source_member.role <> 'member' or target_member.role <> 'member' then raise exception 'ไม่สามารถรวมบัญชีเจ้าของหรือสตาฟ'; end if;
  if source_member.line_user_id is not null and target_member.line_user_id is not null
    and source_member.line_user_id <> target_member.line_user_id then
    raise exception 'สองรายชื่อนี้เชื่อมกับคนละบัญชี LINE จึงรวมอัตโนมัติไม่ได้';
  end if;
  if source_member.profile_id is not null and target_member.profile_id is not null
    and source_member.profile_id <> target_member.profile_id then
    raise exception 'สองรายชื่อนี้เชื่อมกับคนละบัญชีผู้ใช้ จึงรวมอัตโนมัติไม่ได้';
  end if;
  -- Merge is rare; cover every club round, including a new reference committed
  -- while the member's NO KEY UPDATE lock still permits FK checks.
  for locked_event_id in select id from public.events where club_id = target_member.club_id order by id loop
    if not pg_try_advisory_xact_lock(hashtext(locked_event_id::text)) then
      raise exception 'มีรายการกำลังบันทึกในกลุ่มนี้ กรุณารอแล้วลองรวมรายชื่ออีกครั้ง';
    end if;
  end loop;
  -- A source delete requires this stronger lock. NOWAIT avoids a cycle with
  -- uncoordinated FK writers; once acquired no new references can sneak in.
  perform 1 from public.club_members where id in (source_member_id, target_member_id) order by id for update nowait;
  perform 1 from public.queue_matches m where exists (
    select 1 from public.queue_match_players p where p.match_id = m.id and p.member_id in (source_member_id, target_member_id)
  ) order by m.id for update nowait;
  perform 1 from public.queue_match_players where member_id in (source_member_id, target_member_id) order by id for update nowait;
  perform 1 from public.signups where member_id in (source_member_id, target_member_id) order by id for update nowait;
  perform 1 from public.attendance where member_id in (source_member_id, target_member_id) order by id for update nowait;
  perform 1 from public.event_queue_players where member_id in (source_member_id, target_member_id) order by id for update nowait;
  perform 1 from public.payments where member_id in (source_member_id, target_member_id) order by id for update nowait;
  perform 1 from public.member_extra_charges where member_id in (source_member_id, target_member_id) order by id for update nowait;
  perform 1 from public.payment_slips where submitted_by_member_id in (source_member_id, target_member_id)
    or beneficiary_member_id in (source_member_id, target_member_id)
    or beneficiary_member_ids && array[source_member_id,target_member_id] order by id for update nowait;
  perform 1 from public.per_round_snapshot_allocations where member_id in (source_member_id, target_member_id)
    order by snapshot_id, member_id for update nowait;
  perform 1 from public.tournament_team_players where club_member_id in (source_member_id, target_member_id) order by id for update nowait;
  perform 1 from public.per_round_snapshot_matches sm where exists (
    select 1 from public.queue_match_players p where p.match_id = sm.match_id and p.member_id = source_member_id
  ) order by sm.match_id for update nowait;

  if exists (select 1 from public.queue_match_players p join public.queue_matches m on m.id = p.match_id
    where p.member_id in (source_member_id, target_member_id) and m.status in ('draft','approved','playing'))
    or exists (select 1 from public.event_queue_players where member_id in (source_member_id, target_member_id) and status in ('reserved','playing')) then
    raise exception 'มีชื่อที่กำลังเล่นหรืออยู่ในคิว กรุณาจบเกมหรือนำชื่อออกจากคิวก่อนรวมรายชื่อ';
  end if;
  if exists (select 1 from public.queue_match_players s join public.queue_match_players t on t.match_id = s.match_id
    where s.member_id = source_member_id and t.member_id = target_member_id) then
    raise exception 'สองชื่อนี้เคยอยู่ในเกมเดียวกัน จึงรวมอัตโนมัติไม่ได้ กรุณาตรวจสอบว่าเป็นคนเดียวกันจริง';
  end if;
  -- Do not guess how to reconcile two bills or allocation histories from the
  -- same round, even when their individual snapshot IDs differ.
  if exists (
    select 1 from (
      select event_id, member_id from public.payments where member_id in (source_member_id, target_member_id)
      union select event_id, member_id from public.per_round_snapshot_allocations where member_id in (source_member_id, target_member_id)
    ) financial_rows group by event_id having count(distinct member_id) > 1
  ) then raise exception 'สองชื่อนี้มียอดเงินหรือ Snapshot ในรอบเดียวกัน กรุณาตรวจสอบยอดก่อนรวมรายชื่อ'; end if;
  if exists (select 1 from public.attendance s join public.attendance t on t.event_id = s.event_id
    where s.member_id = source_member_id and t.member_id = target_member_id and s.arrived and t.arrived
      and (s.arrived_at is distinct from t.arrived_at or s.left_at is distinct from t.left_at
        or s.billing_percentage is distinct from t.billing_percentage or s.weight is distinct from t.weight)) then
    raise exception 'สองชื่อนี้มีเวลาเข้าหรือกลับหรือสัดส่วนค่าใช้จ่ายไม่ตรงกัน กรุณาตรวจสอบรอบนั้นก่อนรวม';
  end if;
  if exists (select 1 from public.tournament_team_players s join public.tournament_team_players t on t.tournament_id = s.tournament_id
    where s.club_member_id = source_member_id and t.club_member_id = target_member_id) then
    raise exception 'สองชื่อนี้อยู่ในการแข่งขันเดียวกัน กรุณาตรวจสอบรายชื่อทีมก่อนรวม';
  end if;

  select coalesce(array_agg(distinct name) filter (where coalesce(trim(name),'') <> ''), '{}'::text[])
    into merged_aliases from unnest(coalesce(source_member.aliases,'{}'::text[]) || coalesce(target_member.aliases,'{}'::text[])
      || array[source_member.nickname,source_member.display_name,target_member.nickname,target_member.display_name]) name;
  update public.club_members set line_user_id = null, profile_id = null where id = source_member_id;
  update public.club_members set aliases = merged_aliases,
    line_user_id = coalesce(target_member.line_user_id,source_member.line_user_id),
    profile_id = coalesce(target_member.profile_id,source_member.profile_id),
    active = target_member.active or source_member.active,
    payment_exempt = target_member.payment_exempt or source_member.payment_exempt,
    skill_level = coalesce(target_member.skill_level,source_member.skill_level),
    playable_skill_levels = case when target_member.skill_level is null then source_member.playable_skill_levels else target_member.playable_skill_levels end,
    allow_lower_level = case when target_member.skill_level is null then source_member.allow_lower_level else target_member.allow_lower_level end,
    allow_higher_level = case when target_member.skill_level is null then source_member.allow_higher_level else target_member.allow_higher_level end
    where id = target_member_id;

  update public.signups t set
    status = case when t.status = 'coming' or s.status = 'coming' then 'coming'::public.signup_status
      when t.status = 'maybe' or s.status = 'maybe' then 'maybe'::public.signup_status else 'not_coming'::public.signup_status end,
    arrival_time = case when t.status = 'coming' then t.arrival_time when s.status = 'coming' then s.arrival_time else null end,
    skill_level_snapshot = coalesce(t.skill_level_snapshot,s.skill_level_snapshot),
    playable_skill_levels_snapshot = case when t.skill_level_snapshot is null then s.playable_skill_levels_snapshot else t.playable_skill_levels_snapshot end,
    allow_lower_level_snapshot = case when t.skill_level_snapshot is null then s.allow_lower_level_snapshot else t.allow_lower_level_snapshot end,
    allow_higher_level_snapshot = case when t.skill_level_snapshot is null then s.allow_higher_level_snapshot else t.allow_higher_level_snapshot end,
    note = case when trim(t.note) <> '' then t.note else s.note end,
    created_at = least(t.created_at,s.created_at)
    from public.signups s where s.member_id = source_member_id and t.member_id = target_member_id and t.event_id = s.event_id;
  delete from public.signups s using public.signups t where s.member_id = source_member_id and t.member_id = target_member_id and t.event_id = s.event_id;
  update public.signups set member_id = target_member_id where member_id = source_member_id;

  update public.attendance t set arrived = t.arrived or s.arrived,
    arrived_at = case when t.arrived then t.arrived_at when s.arrived then s.arrived_at else coalesce(t.arrived_at,s.arrived_at) end,
    left_at = case when t.arrived then t.left_at when s.arrived then s.left_at else coalesce(t.left_at,s.left_at) end,
    weight = case when t.arrived then t.weight when s.arrived then s.weight else greatest(t.weight,s.weight) end,
    billing_percentage = case when t.arrived then t.billing_percentage when s.arrived then s.billing_percentage else greatest(t.billing_percentage,s.billing_percentage) end,
    note = case when trim(t.note) <> '' then t.note else s.note end
    from public.attendance s where s.member_id = source_member_id and t.member_id = target_member_id and t.event_id = s.event_id;
  delete from public.attendance s using public.attendance t where s.member_id = source_member_id and t.member_id = target_member_id and t.event_id = s.event_id;
  update public.attendance set member_id = target_member_id where member_id = source_member_id;

  update public.event_queue_players t set games_played = t.games_played + s.games_played,
    minutes_played = t.minutes_played + s.minutes_played, queued_at = least(t.queued_at,s.queued_at),
    skip_until_sequence = greatest(t.skip_until_sequence,s.skip_until_sequence)
    from public.event_queue_players s where s.member_id = source_member_id and t.member_id = target_member_id and t.event_id = s.event_id;
  delete from public.event_queue_players s using public.event_queue_players t where s.member_id = source_member_id and t.member_id = target_member_id and t.event_id = s.event_id;
  update public.event_queue_players set member_id = target_member_id where member_id = source_member_id;
  update public.event_queue_players q set status = case when exists (
    select 1 from public.attendance a join public.events e on e.id = a.event_id
    join public.signups s on s.event_id = a.event_id and s.member_id = a.member_id
    where a.event_id = q.event_id and a.member_id = target_member_id and a.arrived and a.left_at is null
      and e.status = 'open' and s.status = 'coming'
  ) then 'waiting' else 'left' end where q.member_id = target_member_id;
  -- The roster trigger must keep protecting billed games from ordinary edits.
  -- This locked, admin-only identity merge temporarily removes just its source
  -- links, preserves all link fields, then restores them in the same transaction.
  -- No other transaction observes a missing snapshot or altered roster/team.
  select coalesce(jsonb_agg(to_jsonb(sm)), '[]'::jsonb) into saved_snapshot_matches
    from public.per_round_snapshot_matches sm where exists (
      select 1 from public.queue_match_players p where p.match_id = sm.match_id and p.member_id = source_member_id
    );
  delete from public.per_round_snapshot_matches where match_id in (
    select match_id from jsonb_to_recordset(saved_snapshot_matches) r(match_id uuid)
  );
  update public.queue_match_players set member_id = target_member_id where member_id = source_member_id;
  insert into public.per_round_snapshot_matches(snapshot_id,event_id,match_id,created_at)
    select snapshot_id,event_id,match_id,created_at from jsonb_to_recordset(saved_snapshot_matches)
      r(snapshot_id uuid,event_id uuid,match_id uuid,created_at timestamptz);
  update public.payments set member_id = target_member_id where member_id = source_member_id;
  update public.member_extra_charges set member_id = target_member_id where member_id = source_member_id;
  update public.per_round_snapshot_allocations set member_id = target_member_id where member_id = source_member_id;
  update public.tournament_team_players set club_member_id = target_member_id where club_member_id = source_member_id;
  update public.payment_slips set
    submitted_by_member_id = case when submitted_by_member_id = source_member_id then target_member_id else submitted_by_member_id end,
    beneficiary_member_id = case when beneficiary_member_id = source_member_id then target_member_id else beneficiary_member_id end,
    beneficiary_member_ids = array(select member_id from unnest(array_replace(beneficiary_member_ids,source_member_id,target_member_id)) with ordinality r(member_id,ord)
      group by member_id order by min(ord))
    where submitted_by_member_id = source_member_id or beneficiary_member_id = source_member_id or source_member_id = any(beneficiary_member_ids);
  delete from public.club_members where id = source_member_id;
  insert into public.audit_logs(club_id,actor_id,action,details) values
    (target_member.club_id,auth.uid(),'รวมรายชื่อสมาชิกและประวัติ',jsonb_build_object('source_member_id',source_member_id,'target_member_id',target_member_id,
      'source_name',coalesce(source_member.nickname,source_member.display_name),'target_name',coalesce(target_member.nickname,target_member.display_name)));
  return target_member_id;
exception when lock_not_available then
  raise exception 'ข้อมูลผู้เล่นกำลังถูกใช้งาน กรุณารอแล้วลองรวมรายชื่ออีกครั้ง';
end;
$$;

create or replace function public.merge_club_members_with_queue(source_member_id uuid, target_member_id uuid)
returns uuid language sql security definer set search_path = '' as $$
  select public.merge_club_members(source_member_id,target_member_id);
$$;
revoke all on function public.merge_club_members(uuid,uuid) from public, anon;
revoke all on function public.merge_club_members_with_queue(uuid,uuid) from public, anon;
grant execute on function public.merge_club_members(uuid,uuid) to authenticated;
grant execute on function public.merge_club_members_with_queue(uuid,uuid) to authenticated;
