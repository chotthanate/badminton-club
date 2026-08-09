create or replace function public.merge_club_members_with_queue(
  source_member_id uuid,
  target_member_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  source_member public.club_members%rowtype;
  target_member public.club_members%rowtype;
  merged_member_id uuid;
begin
  select * into source_member from public.club_members where id = source_member_id for update;
  select * into target_member from public.club_members where id = target_member_id for update;
  if source_member.id is null or target_member.id is null then
    raise exception 'ไม่พบรายชื่อที่ต้องการรวม';
  end if;
  if source_member.club_id <> target_member.club_id or not public.is_club_admin(target_member.club_id) then
    raise exception 'อนุญาตเฉพาะแอดมินในกลุ่มเดียวกัน';
  end if;
  if exists (
    select 1
    from public.queue_match_players source_player
    join public.queue_match_players target_player
      on target_player.match_id = source_player.match_id
     and target_player.member_id = target_member_id
    where source_player.member_id = source_member_id
  ) then
    raise exception 'สองชื่อนี้เคยอยู่ในเกมเดียวกัน จึงรวมอัตโนมัติไม่ได้ กรุณาตรวจสอบว่าเป็นคนเดียวกันจริง';
  end if;

  update public.event_queue_players target_queue
  set games_played = greatest(target_queue.games_played, source_queue.games_played),
      minutes_played = greatest(target_queue.minutes_played, source_queue.minutes_played),
      queued_at = least(target_queue.queued_at, source_queue.queued_at),
      skip_until_sequence = greatest(target_queue.skip_until_sequence, source_queue.skip_until_sequence),
      status = case
        when target_queue.status = 'playing' or source_queue.status = 'playing' then 'playing'
        when target_queue.status = 'proposed' or source_queue.status = 'proposed' then 'proposed'
        when target_queue.status = 'waiting' or source_queue.status = 'waiting' then 'waiting'
        else 'left'
      end
  from public.event_queue_players source_queue
  where source_queue.member_id = source_member_id
    and target_queue.member_id = target_member_id
    and target_queue.event_id = source_queue.event_id;

  delete from public.event_queue_players source_queue
  using public.event_queue_players target_queue
  where source_queue.member_id = source_member_id
    and target_queue.member_id = target_member_id
    and target_queue.event_id = source_queue.event_id;

  update public.event_queue_players set member_id = target_member_id where member_id = source_member_id;
  update public.queue_match_players set member_id = target_member_id where member_id = source_member_id;

  merged_member_id := public.merge_club_members(source_member_id, target_member_id);
  update public.club_members
  set skill_level = coalesce(target_member.skill_level, source_member.skill_level),
      allow_lower_level = case when target_member.skill_level is null then source_member.allow_lower_level else target_member.allow_lower_level end,
      allow_higher_level = case when target_member.skill_level is null then source_member.allow_higher_level else target_member.allow_higher_level end
  where id = merged_member_id;
  return merged_member_id;
end;
$$;

revoke all on function public.merge_club_members_with_queue(uuid, uuid) from public;
grant execute on function public.merge_club_members_with_queue(uuid, uuid) to authenticated;
