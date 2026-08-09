create or replace function public.increment_event_shuttlecock_count(
  target_event_id uuid,
  increment_by integer,
  checkpoint_at time
)
returns table (new_count integer, recorded_at time)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_event public.events%rowtype;
  previous_count integer;
begin
  if increment_by is null or increment_by < 1 or increment_by > 100 then
    raise exception 'เพิ่มลูกแบดได้ครั้งละ 1 ถึง 100 ลูก';
  end if;
  if checkpoint_at is null then
    raise exception 'ไม่พบเวลาที่เพิ่มลูกแบด';
  end if;

  select *
  into selected_event
  from public.events
  where id = target_event_id
  for update;

  if not found then
    raise exception 'ไม่พบรอบที่ต้องการเพิ่มลูกแบด';
  end if;
  if not public.is_club_admin(selected_event.club_id) then
    raise exception 'เฉพาะแอดมินเท่านั้นที่เพิ่มลูกแบดได้';
  end if;

  previous_count := greatest(0, coalesce(selected_event.shuttlecock_count, 0));
  new_count := previous_count + increment_by;
  recorded_at := checkpoint_at;

  update public.events
  set shuttlecock_count = new_count
  where id = target_event_id;

  insert into public.shuttlecock_checkpoints (
    club_id,
    event_id,
    checkpoint_time,
    cumulative_count,
    created_by,
    updated_at
  ) values (
    selected_event.club_id,
    target_event_id,
    checkpoint_at,
    new_count,
    (select auth.uid()),
    now()
  )
  on conflict (event_id, checkpoint_time) do update
  set cumulative_count = greatest(
        public.shuttlecock_checkpoints.cumulative_count,
        excluded.cumulative_count
      ),
      updated_at = now();

  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (
    selected_event.club_id,
    target_event_id,
    (select auth.uid()),
    format('เพิ่มลูกแบด %s ลูก รวม %s ลูก', increment_by, new_count),
    jsonb_build_object(
      'source', 'shuttlecock_counter',
      'increment', increment_by,
      'previous_count', previous_count,
      'new_count', new_count,
      'checkpoint_time', checkpoint_at
    )
  );

  return next;
end;
$$;

create or replace function public.set_event_shuttlecock_count(
  target_event_id uuid,
  replacement_count integer,
  checkpoint_at time
)
returns table (new_count integer, recorded_at time)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_event public.events%rowtype;
  previous_count integer;
begin
  if replacement_count is null or replacement_count < 0 or replacement_count > 1000 then
    raise exception 'จำนวนลูกแบดรวมต้องอยู่ระหว่าง 0 ถึง 1,000 ลูก';
  end if;
  if checkpoint_at is null then
    raise exception 'ไม่พบเวลาที่แก้จำนวนลูกแบด';
  end if;

  select *
  into selected_event
  from public.events
  where id = target_event_id
  for update;

  if not found then
    raise exception 'ไม่พบรอบที่ต้องการแก้จำนวนลูกแบด';
  end if;
  if not public.is_club_admin(selected_event.club_id) then
    raise exception 'เฉพาะแอดมินเท่านั้นที่แก้จำนวนลูกแบดได้';
  end if;

  previous_count := greatest(0, coalesce(selected_event.shuttlecock_count, 0));
  new_count := replacement_count;
  recorded_at := checkpoint_at;

  update public.events
  set shuttlecock_count = new_count
  where id = target_event_id;

  delete from public.shuttlecock_checkpoints
  where event_id = target_event_id
    and cumulative_count > new_count;

  insert into public.shuttlecock_checkpoints (
    club_id,
    event_id,
    checkpoint_time,
    cumulative_count,
    created_by,
    updated_at
  ) values (
    selected_event.club_id,
    target_event_id,
    checkpoint_at,
    new_count,
    (select auth.uid()),
    now()
  )
  on conflict (event_id, checkpoint_time) do update
  set cumulative_count = excluded.cumulative_count,
      updated_at = now();

  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (
    selected_event.club_id,
    target_event_id,
    (select auth.uid()),
    format('แก้จำนวนลูกแบดรวมจาก %s เป็น %s ลูก', previous_count, new_count),
    jsonb_build_object(
      'source', 'shuttlecock_total_edit',
      'previous_count', previous_count,
      'new_count', new_count,
      'checkpoint_time', checkpoint_at
    )
  );

  return next;
end;
$$;

revoke all on function public.increment_event_shuttlecock_count(uuid, integer, time) from public;
revoke all on function public.set_event_shuttlecock_count(uuid, integer, time) from public;
grant execute on function public.increment_event_shuttlecock_count(uuid, integer, time) to authenticated;
grant execute on function public.set_event_shuttlecock_count(uuid, integer, time) to authenticated;
