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
  join public.signups signup
    on signup.member_id = member.id
   and signup.event_id = target_event_id
  where member.id = target_member_id
    and signup.status = 'coming';

  if removed_name is null then
    raise exception 'ไม่พบผู้เล่นในรอบนี้';
  end if;

  if exists (
    select 1
    from public.queue_match_players player
    join public.queue_matches match on match.id = player.match_id
    where player.event_id = target_event_id
      and player.member_id = target_member_id
      and match.status = 'playing'
  ) then
    raise exception 'ลบ % ไม่ได้ เพราะกำลังเล่นอยู่ในสนาม กรุณาจบหรือยกเลิกเกมก่อน', removed_name;
  end if;

  if exists (
    select 1
    from public.queue_match_players player
    join public.queue_matches match on match.id = player.match_id
    where player.event_id = target_event_id
      and player.member_id = target_member_id
      and match.status in ('draft', 'approved')
  ) then
    raise exception 'ลบ % ไม่ได้ เพราะอยู่ในคิว กรุณานำออกจากคิวก่อน', removed_name;
  end if;

  if exists (
    select 1
    from public.queue_match_players player
    join public.queue_matches match on match.id = player.match_id
    where player.event_id = target_event_id
      and player.member_id = target_member_id
      and match.status = 'completed'
  ) then
    raise exception 'ลบ % ไม่ได้ เพราะเคยเล่นในรอบนี้แล้ว ประวัติเกมจะยังถูกเก็บไว้', removed_name;
  end if;

  if exists (
    select 1
    from public.payments payment
    where payment.event_id = target_event_id
      and payment.member_id = target_member_id
      and (payment.billed_at is not null or payment.paid_at is not null)
  ) then
    raise exception 'ลบ % ไม่ได้ เพราะสรุปยอดหรือรับชำระเงินแล้ว', removed_name;
  end if;

  -- A checked-in player has a waiting row even when they have never entered a
  -- planned queue. That row must not prevent removing them from this event.
  delete from public.queue_match_players
  where event_id = target_event_id
    and member_id = target_member_id;
  delete from public.event_queue_players
  where event_id = target_event_id
    and member_id = target_member_id;
  delete from public.member_extra_charges
  where event_id = target_event_id
    and member_id = target_member_id;
  delete from public.payments
  where event_id = target_event_id
    and member_id = target_member_id;
  delete from public.attendance
  where event_id = target_event_id
    and member_id = target_member_id;
  delete from public.signups
  where event_id = target_event_id
    and member_id = target_member_id;

  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (
    target_club_id,
    target_event_id,
    auth.uid(),
    'ลบผู้เล่นออกจากรอบ',
    jsonb_build_object('member_id', target_member_id, 'nickname', removed_name)
  );
end;
$$;

revoke all on function public.operator_remove_event_participant(uuid, uuid) from public;
revoke all on function public.operator_remove_event_participant(uuid, uuid) from anon;
grant execute on function public.operator_remove_event_participant(uuid, uuid) to authenticated;
