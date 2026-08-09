alter table public.club_members
  add column playable_skill_levels text[] not null default '{}'::text[];

alter table public.signups
  add column playable_skill_levels_snapshot text[] not null default '{}'::text[];

update public.club_members
set playable_skill_levels = array_remove(array[
      case skill_level
        when 'Rookie' then 'Rookie-'
        when 'BG' then 'Rookie'
        when 'N' then 'BG'
        when 'S' then 'N'
        when 'P' then 'S'
      end,
      skill_level,
      case skill_level
        when 'Rookie-' then 'Rookie'
        when 'Rookie' then 'BG'
        when 'BG' then 'N'
        when 'N' then 'S'
        when 'S' then 'P'
      end
    ]::text[], null),
    allow_lower_level = skill_level in ('Rookie', 'BG', 'N', 'S', 'P'),
    allow_higher_level = skill_level in ('Rookie-', 'Rookie', 'BG', 'N', 'S')
where skill_level is not null;

update public.signups
set playable_skill_levels_snapshot = array_remove(array[
      case skill_level_snapshot
        when 'Rookie' then 'Rookie-'
        when 'BG' then 'Rookie'
        when 'N' then 'BG'
        when 'S' then 'N'
        when 'P' then 'S'
      end,
      skill_level_snapshot,
      case skill_level_snapshot
        when 'Rookie-' then 'Rookie'
        when 'Rookie' then 'BG'
        when 'BG' then 'N'
        when 'N' then 'S'
        when 'S' then 'P'
      end
    ]::text[], null),
    allow_lower_level_snapshot = skill_level_snapshot in ('Rookie', 'BG', 'N', 'S', 'P'),
    allow_higher_level_snapshot = skill_level_snapshot in ('Rookie-', 'Rookie', 'BG', 'N', 'S')
where skill_level_snapshot is not null;

create or replace function public.sync_member_playable_skill_levels()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.skill_level is null then
    new.playable_skill_levels := '{}'::text[];
  elsif new.playable_skill_levels is null
    or not (new.skill_level = any(new.playable_skill_levels))
    or (
      tg_op = 'UPDATE'
      and new.playable_skill_levels is not distinct from old.playable_skill_levels
      and (
        new.skill_level is distinct from old.skill_level
        or new.allow_lower_level is distinct from old.allow_lower_level
        or new.allow_higher_level is distinct from old.allow_higher_level
      )
    ) then
    new.playable_skill_levels := array_remove(array[
      case when new.allow_lower_level then case new.skill_level
        when 'Rookie' then 'Rookie-'
        when 'BG' then 'Rookie'
        when 'N' then 'BG'
        when 'S' then 'N'
        when 'P' then 'S'
      end end,
      new.skill_level,
      case when new.allow_higher_level then case new.skill_level
        when 'Rookie-' then 'Rookie'
        when 'Rookie' then 'BG'
        when 'BG' then 'N'
        when 'N' then 'S'
        when 'S' then 'P'
      end end
    ]::text[], null);
  end if;
  return new;
end;
$$;

create trigger club_members_sync_playable_skill_levels
before insert or update of skill_level, playable_skill_levels, allow_lower_level, allow_higher_level
on public.club_members
for each row execute function public.sync_member_playable_skill_levels();

create or replace function public.sync_signup_playable_skill_levels()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.skill_level_snapshot is null then
    new.playable_skill_levels_snapshot := '{}'::text[];
  elsif new.playable_skill_levels_snapshot is null
    or not (new.skill_level_snapshot = any(new.playable_skill_levels_snapshot))
    or (
      tg_op = 'UPDATE'
      and new.playable_skill_levels_snapshot is not distinct from old.playable_skill_levels_snapshot
      and (
        new.skill_level_snapshot is distinct from old.skill_level_snapshot
        or new.allow_lower_level_snapshot is distinct from old.allow_lower_level_snapshot
        or new.allow_higher_level_snapshot is distinct from old.allow_higher_level_snapshot
      )
    ) then
    new.playable_skill_levels_snapshot := array_remove(array[
      case when new.allow_lower_level_snapshot then case new.skill_level_snapshot
        when 'Rookie' then 'Rookie-'
        when 'BG' then 'Rookie'
        when 'N' then 'BG'
        when 'S' then 'N'
        when 'P' then 'S'
      end end,
      new.skill_level_snapshot,
      case when new.allow_higher_level_snapshot then case new.skill_level_snapshot
        when 'Rookie-' then 'Rookie'
        when 'Rookie' then 'BG'
        when 'BG' then 'N'
        when 'N' then 'S'
        when 'S' then 'P'
      end end
    ]::text[], null);
  end if;
  return new;
end;
$$;

create trigger signups_sync_playable_skill_levels
before insert or update of skill_level_snapshot, playable_skill_levels_snapshot, allow_lower_level_snapshot, allow_higher_level_snapshot
on public.signups
for each row execute function public.sync_signup_playable_skill_levels();

alter table public.club_members
  add constraint club_members_playable_skill_levels_check
    check (
      playable_skill_levels <@ array['Rookie-', 'Rookie', 'BG', 'N', 'S', 'P']::text[]
      and (skill_level is null or skill_level = any(playable_skill_levels))
    );

alter table public.signups
  add constraint signups_playable_skill_levels_snapshot_check
    check (
      playable_skill_levels_snapshot <@ array['Rookie-', 'Rookie', 'BG', 'N', 'S', 'P']::text[]
      and (skill_level_snapshot is null or skill_level_snapshot = any(playable_skill_levels_snapshot))
    );

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
      playable_skill_levels = case
        when target_member.skill_level is null then source_member.playable_skill_levels
        else target_member.playable_skill_levels
      end,
      allow_lower_level = case when target_member.skill_level is null then source_member.allow_lower_level else target_member.allow_lower_level end,
      allow_higher_level = case when target_member.skill_level is null then source_member.allow_higher_level else target_member.allow_higher_level end
  where id = merged_member_id;
  return merged_member_id;
end;
$$;
