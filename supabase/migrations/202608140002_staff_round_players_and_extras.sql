-- Expand staff operations without exposing catalog prices, bills, or payment data.

create or replace function public.load_staff_player_operations(target_club_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare target_event_id uuid;
begin
  if not public.is_club_operator(target_club_id) then
    raise exception 'ไม่มีสิทธิ์เปิดข้อมูลปฏิบัติงาน';
  end if;

  select event.id into target_event_id
  from public.events event
  where event.club_id = target_club_id and event.status = 'open'
  order by event.event_date desc, event.created_at desc
  limit 1;

  if target_event_id is null then
    return jsonb_build_object('extraItems', '[]'::jsonb, 'memberExtras', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'extraItems', coalesce((
      select jsonb_agg(jsonb_build_object('id', item.id, 'name', item.name) order by item.created_at)
      from public.extra_item_catalog item
      where item.club_id = target_club_id and item.active
    ), '[]'::jsonb),
    'memberExtras', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', charge.id,
        'member_id', charge.member_id,
        'item_name', charge.item_name,
        'quantity', charge.quantity,
        'created_at', charge.created_at
      ) order by charge.created_at)
      from public.member_extra_charges charge
      where charge.event_id = target_event_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.operator_remove_event_court(
  target_event_id uuid,
  target_court_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  removed_name text;
  first_start time;
  latest_end time;
begin
  select event.club_id into target_club_id
  from public.events event
  where event.id = target_event_id and event.status = 'open';
  if target_club_id is null or not public.is_club_operator(target_club_id) then
    raise exception 'ลบคอร์ทได้เฉพาะรอบที่เปิดอยู่';
  end if;
  if (select count(*) from public.event_courts where event_id = target_event_id) <= 1 then
    raise exception 'ต้องเหลืออย่างน้อย 1 คอร์ท';
  end if;
  if exists (
    select 1 from public.queue_matches match
    where match.event_id = target_event_id
      and match.court_id = target_court_id
      and match.status in ('playing', 'completed')
  ) then
    raise exception 'ลบคอร์ทนี้ไม่ได้ เพราะมีเกมที่เริ่มเล่นหรือจบแล้ว';
  end if;

  delete from public.event_courts court
  where court.id = target_court_id and court.event_id = target_event_id
  returning court.court_name into removed_name;
  if removed_name is null then raise exception 'ไม่พบคอร์ทนี้'; end if;

  select court.starts_at into first_start
  from public.event_courts court
  where court.event_id = target_event_id
  order by court.starts_at
  limit 1;
  select court.ends_at into latest_end
  from public.event_courts court
  where court.event_id = target_event_id
  order by (
    extract(hour from court.ends_at)::integer * 60 + extract(minute from court.ends_at)::integer
    + case when court.ends_at <= first_start then 1440 else 0 end
  ) desc
  limit 1;
  update public.events set starts_at = first_start, ends_at = latest_end where id = target_event_id;

  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (target_club_id, target_event_id, auth.uid(), 'ลบคอร์ทโดยสตาฟ',
    jsonb_build_object('court_id', target_court_id, 'court_name', removed_name));
end;
$$;

create or replace function public.operator_add_event_participant(
  target_event_id uuid,
  target_member_id uuid,
  next_nickname text,
  next_skill_level text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event public.events%rowtype;
  saved_member public.club_members%rowtype;
  saved_member_id uuid;
  saved_skill_level text;
  saved_playable_levels text[];
  lower_allowed boolean;
  higher_allowed boolean;
begin
  select * into target_event from public.events where id = target_event_id and status = 'open';
  if target_event.id is null or not public.is_club_operator(target_event.club_id) then
    raise exception 'เพิ่มผู้เล่นได้เฉพาะรอบที่เปิดอยู่';
  end if;

  if target_member_id is null then
    if next_nickname is null or char_length(trim(next_nickname)) < 1 or char_length(trim(next_nickname)) > 40 then
      raise exception 'กรุณากรอกชื่อเล่น';
    end if;
    if next_skill_level is null or next_skill_level not in ('Rookie-', 'Rookie', 'BG', 'N', 'S', 'P') then
      raise exception 'กรุณาเลือกระดับมือ';
    end if;
    saved_playable_levels := array_remove(array[
      case next_skill_level when 'Rookie' then 'Rookie-' when 'BG' then 'Rookie' when 'N' then 'BG' when 'S' then 'N' when 'P' then 'S' end,
      next_skill_level,
      case next_skill_level when 'Rookie-' then 'Rookie' when 'Rookie' then 'BG' when 'BG' then 'N' when 'N' then 'S' when 'S' then 'P' end
    ]::text[], null);
    insert into public.club_members (
      club_id, display_name, nickname, role, skill_level, playable_skill_levels,
      allow_lower_level, allow_higher_level
    ) values (
      target_event.club_id, trim(next_nickname), trim(next_nickname), 'member'::public.club_role,
      next_skill_level, saved_playable_levels,
      next_skill_level in ('Rookie', 'BG', 'N', 'S', 'P'),
      next_skill_level in ('Rookie-', 'Rookie', 'BG', 'N', 'S')
    ) returning * into saved_member;
  else
    select * into saved_member
    from public.club_members member
    where member.id = target_member_id
      and member.club_id = target_event.club_id
      and member.role = 'member'
      and member.active;
    if saved_member.id is null then raise exception 'ไม่พบผู้เล่นนี้'; end if;
    if next_skill_level is not null and next_skill_level not in ('Rookie-', 'Rookie', 'BG', 'N', 'S', 'P') then
      raise exception 'ระดับมือไม่ถูกต้อง';
    end if;
    if saved_member.skill_level is null or (next_skill_level is not null and next_skill_level <> saved_member.skill_level) then
      saved_playable_levels := array_remove(array[
        case next_skill_level when 'Rookie' then 'Rookie-' when 'BG' then 'Rookie' when 'N' then 'BG' when 'S' then 'N' when 'P' then 'S' end,
        next_skill_level,
        case next_skill_level when 'Rookie-' then 'Rookie' when 'Rookie' then 'BG' when 'BG' then 'N' when 'N' then 'S' when 'S' then 'P' end
      ]::text[], null);
      update public.club_members member set
        skill_level = next_skill_level,
        playable_skill_levels = saved_playable_levels,
        allow_lower_level = next_skill_level in ('Rookie', 'BG', 'N', 'S', 'P'),
        allow_higher_level = next_skill_level in ('Rookie-', 'Rookie', 'BG', 'N', 'S')
      where member.id = saved_member.id
      returning * into saved_member;
    end if;
  end if;

  saved_member_id := saved_member.id;
  saved_skill_level := saved_member.skill_level;
  saved_playable_levels := saved_member.playable_skill_levels;
  if saved_skill_level is null then raise exception 'กรุณาเลือกระดับมือ'; end if;
  lower_allowed := saved_skill_level in ('Rookie', 'BG', 'N', 'S', 'P')
    and (case saved_skill_level when 'Rookie' then 'Rookie-' when 'BG' then 'Rookie' when 'N' then 'BG' when 'S' then 'N' when 'P' then 'S' end = any(saved_playable_levels));
  higher_allowed := saved_skill_level in ('Rookie-', 'Rookie', 'BG', 'N', 'S')
    and (case saved_skill_level when 'Rookie-' then 'Rookie' when 'Rookie' then 'BG' when 'BG' then 'N' when 'N' then 'S' when 'S' then 'P' end = any(saved_playable_levels));

  insert into public.signups (
    club_id, event_id, member_id, status, arrival_time,
    skill_level_snapshot, playable_skill_levels_snapshot,
    allow_lower_level_snapshot, allow_higher_level_snapshot
  ) values (
    target_event.club_id, target_event.id, saved_member_id, 'coming', target_event.starts_at,
    saved_skill_level, saved_playable_levels, lower_allowed, higher_allowed
  ) on conflict (event_id, member_id) do update set
    status = 'coming',
    arrival_time = excluded.arrival_time,
    skill_level_snapshot = excluded.skill_level_snapshot,
    playable_skill_levels_snapshot = excluded.playable_skill_levels_snapshot,
    allow_lower_level_snapshot = excluded.allow_lower_level_snapshot,
    allow_higher_level_snapshot = excluded.allow_higher_level_snapshot;

  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (target_event.club_id, target_event.id, auth.uid(), 'เพิ่มผู้เล่นโดยสตาฟ',
    jsonb_build_object('member_id', saved_member_id, 'nickname', coalesce(saved_member.nickname, saved_member.display_name)));
  return saved_member_id;
end;
$$;

create or replace function public.operator_remove_event_participant(
  target_event_id uuid,
  target_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  removed_name text;
begin
  select event.club_id into target_club_id
  from public.events event
  where event.id = target_event_id and event.status = 'open';
  if target_club_id is null or not public.is_club_operator(target_club_id) then
    raise exception 'ลบผู้เล่นได้เฉพาะรอบที่เปิดอยู่';
  end if;
  select coalesce(member.nickname, member.display_name) into removed_name
  from public.club_members member
  join public.signups signup on signup.member_id = member.id and signup.event_id = target_event_id
  where member.id = target_member_id and signup.status = 'coming';
  if removed_name is null then raise exception 'ไม่พบผู้เล่นในรอบนี้'; end if;
  if exists (
    select 1 from public.queue_match_players player
    join public.queue_matches match on match.id = player.match_id
    where player.event_id = target_event_id and player.member_id = target_member_id
      and match.status in ('playing', 'completed')
  ) then
    raise exception 'ลบผู้เล่นไม่ได้ เพราะมีเกมที่กำลังเล่นหรือเล่นจบแล้ว';
  end if;
  if exists (
    select 1 from public.payments payment
    where payment.event_id = target_event_id and payment.member_id = target_member_id
      and (payment.billed_at is not null or payment.paid_at is not null)
  ) then
    raise exception 'ลบผู้เล่นไม่ได้ เพราะสรุปยอดแล้ว';
  end if;

  update public.queue_matches match set status = 'draft'
  where match.id in (
    select player.match_id from public.queue_match_players player
    where player.event_id = target_event_id and player.member_id = target_member_id
  ) and match.status = 'approved';
  delete from public.queue_match_players where event_id = target_event_id and member_id = target_member_id;
  delete from public.event_queue_players where event_id = target_event_id and member_id = target_member_id;
  delete from public.member_extra_charges where event_id = target_event_id and member_id = target_member_id;
  delete from public.payments where event_id = target_event_id and member_id = target_member_id;
  delete from public.attendance where event_id = target_event_id and member_id = target_member_id;
  delete from public.signups where event_id = target_event_id and member_id = target_member_id;

  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (target_club_id, target_event_id, auth.uid(), 'ลบผู้เล่นโดยสตาฟ',
    jsonb_build_object('member_id', target_member_id, 'nickname', removed_name));
end;
$$;

create or replace function public.operator_add_member_extra(
  target_event_id uuid,
  target_member_id uuid,
  target_item_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  selected_item public.extra_item_catalog%rowtype;
  saved_charge_id uuid;
begin
  select event.club_id into target_club_id
  from public.events event
  where event.id = target_event_id and event.status = 'open';
  if target_club_id is null or not public.is_club_operator(target_club_id) then
    raise exception 'เพิ่มน้ำหรือขนมได้เฉพาะรอบที่เปิดอยู่';
  end if;
  if not exists (select 1 from public.signups where event_id = target_event_id and member_id = target_member_id and status = 'coming') then
    raise exception 'ไม่พบผู้เล่นในรอบนี้';
  end if;
  if exists (select 1 from public.payments where event_id = target_event_id and member_id = target_member_id and billed_at is not null) then
    raise exception 'เพิ่มรายการไม่ได้ เพราะสรุปยอดของผู้เล่นแล้ว';
  end if;
  select * into selected_item from public.extra_item_catalog
  where id = target_item_id and club_id = target_club_id and active;
  if selected_item.id is null then raise exception 'ไม่พบรายการน้ำหรือขนม'; end if;

  insert into public.member_extra_charges (
    club_id, event_id, member_id, item_name, unit_price, quantity, created_by
  ) values (
    target_club_id, target_event_id, target_member_id, selected_item.name, selected_item.price, 1, auth.uid()
  ) returning id into saved_charge_id;
  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (target_club_id, target_event_id, auth.uid(), 'เพิ่มน้ำหรือขนมโดยสตาฟ',
    jsonb_build_object('member_id', target_member_id, 'item_name', selected_item.name, 'charge_id', saved_charge_id));
  return saved_charge_id;
end;
$$;

create or replace function public.operator_remove_member_extra(
  target_event_id uuid,
  target_charge_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  removed_member_id uuid;
  removed_item_name text;
begin
  select event.club_id into target_club_id
  from public.events event
  where event.id = target_event_id and event.status = 'open';
  if target_club_id is null or not public.is_club_operator(target_club_id) then
    raise exception 'ลบรายการได้เฉพาะรอบที่เปิดอยู่';
  end if;
  select charge.member_id, charge.item_name into removed_member_id, removed_item_name
  from public.member_extra_charges charge
  where charge.id = target_charge_id and charge.event_id = target_event_id;
  if removed_member_id is null then raise exception 'ไม่พบรายการนี้'; end if;
  if exists (select 1 from public.payments where event_id = target_event_id and member_id = removed_member_id and billed_at is not null) then
    raise exception 'ลบรายการไม่ได้ เพราะสรุปยอดของผู้เล่นแล้ว';
  end if;
  delete from public.member_extra_charges where id = target_charge_id and event_id = target_event_id;
  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (target_club_id, target_event_id, auth.uid(), 'ลบน้ำหรือขนมโดยสตาฟ',
    jsonb_build_object('member_id', removed_member_id, 'item_name', removed_item_name, 'charge_id', target_charge_id));
end;
$$;

revoke all on function public.load_staff_player_operations(uuid) from public;
revoke all on function public.operator_remove_event_court(uuid, uuid) from public;
revoke all on function public.operator_add_event_participant(uuid, uuid, text, text) from public;
revoke all on function public.operator_remove_event_participant(uuid, uuid) from public;
revoke all on function public.operator_add_member_extra(uuid, uuid, uuid) from public;
revoke all on function public.operator_remove_member_extra(uuid, uuid) from public;

grant execute on function public.load_staff_player_operations(uuid) to authenticated;
grant execute on function public.operator_remove_event_court(uuid, uuid) to authenticated;
grant execute on function public.operator_add_event_participant(uuid, uuid, text, text) to authenticated;
grant execute on function public.operator_remove_event_participant(uuid, uuid) to authenticated;
grant execute on function public.operator_add_member_extra(uuid, uuid, uuid) to authenticated;
grant execute on function public.operator_remove_member_extra(uuid, uuid) to authenticated;
