-- A fallback is still a four-player draft. Keep the entire operation in one
-- transaction so a failed lineup never leaves an empty queue behind.
create or replace function public.create_fallback_queue_draft(
  target_event_id uuid,
  selected_member_ids uuid[],
  team_a_member_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_id uuid;
  assignments jsonb;
begin
  if coalesce(array_length(selected_member_ids, 1), 0) <> 4
     or (select count(distinct member_id) from unnest(selected_member_ids) member_id) <> 4
     or coalesce(array_length(team_a_member_ids, 1), 0) <> 2
     or (select count(distinct member_id) from unnest(team_a_member_ids) member_id) <> 2
     or exists (select 1 from unnest(team_a_member_ids) member_id where not (member_id = any(selected_member_ids))) then
    raise exception 'ต้องเลือกผู้เล่น 4 คน และทีม A 2 คน';
  end if;

  -- Reuse the normal path whenever possible. Only incompatible groups receive
  -- manual_override, and they must still be approved before entering a court.
  if public.queue_lineup_is_compatible(target_event_id, selected_member_ids) then
    return public.create_queue_draft(target_event_id, selected_member_ids, team_a_member_ids);
  end if;

  created_id := public.create_manual_queue_draft(target_event_id);
  select jsonb_agg(jsonb_build_object(
    'member_id', member_id,
    'team', case when member_id = any(team_a_member_ids) then 'A' else 'B' end,
    'position', position
  )) into assignments
  from (
    select member_id,
      row_number() over (
        partition by (member_id = any(team_a_member_ids))
        order by array_position(selected_member_ids, member_id)
      ) as position
    from unnest(selected_member_ids) member_id
  ) selected;
  perform public.update_manual_queue_draft_lineup(created_id, assignments);
  return created_id;
end;
$$;

create or replace function public.create_queue_drafts_batch(
  target_event_id uuid,
  queue_lineups jsonb
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  lineup record;
  created_ids uuid[] := '{}'::uuid[];
  created_id uuid;
  requested_count integer;
begin
  select club_id into target_club_id from public.events
  where id = target_event_id and status = 'open';
  if target_club_id is null or not public.is_club_operator(target_club_id) then
    raise exception 'ไม่พบรอบที่เปิดอยู่หรือไม่มีสิทธิ์จัดคิว';
  end if;
  if jsonb_typeof(queue_lineups) <> 'array' then
    raise exception 'ข้อมูลคิวอัตโนมัติไม่ถูกต้อง';
  end if;
  requested_count := jsonb_array_length(queue_lineups);
  if requested_count < 1 or requested_count > 4 then
    raise exception 'สร้างคิวพร้อมกันได้ 1 ถึง 4 คิว';
  end if;
  perform pg_advisory_xact_lock(hashtext(target_event_id::text));
  if (select count(*) from public.queue_matches
      where event_id = target_event_id and status in ('draft', 'approved')) + requested_count > 4 then
    raise exception 'เตรียมคิวล่วงหน้าได้สูงสุด 4 คิว';
  end if;

  for lineup in select value from jsonb_array_elements(queue_lineups) loop
    if coalesce((lineup.value ->> 'fallback')::boolean, false) then
      created_id := public.create_fallback_queue_draft(
        target_event_id,
        array(select jsonb_array_elements_text(lineup.value -> 'member_ids')::uuid),
        array(select jsonb_array_elements_text(lineup.value -> 'team_a_member_ids')::uuid)
      );
    else
      created_id := public.create_queue_draft(
        target_event_id,
        array(select jsonb_array_elements_text(lineup.value -> 'member_ids')::uuid),
        array(select jsonb_array_elements_text(lineup.value -> 'team_a_member_ids')::uuid)
      );
    end if;
    created_ids := array_append(created_ids, created_id);
  end loop;
  return created_ids;
end;
$$;

revoke all on function public.create_fallback_queue_draft(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.create_fallback_queue_draft(uuid, uuid[], uuid[]) to authenticated;
