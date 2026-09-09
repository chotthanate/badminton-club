create or replace function public.sync_event_schedule_from_courts(target_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  start_values integer[];
  start_count integer;
  start_minute integer;
  end_minute integer;
  current_minute integer;
  next_minute integer;
  current_gap integer;
  largest_gap integer := -1;
  i integer;
begin
  if target_event_id is null or not exists (select 1 from public.events where id = target_event_id) then
    return;
  end if;

  select array_agg(value order by value)
  into start_values
  from (
    select distinct
      extract(hour from starts_at)::integer * 60
      + extract(minute from starts_at)::integer as value
    from public.event_courts
    where event_id = target_event_id
  ) starts;

  start_count := coalesce(array_length(start_values, 1), 0);
  if start_count = 0 then return; end if;
  start_minute := start_values[1];

  if start_count > 1 then
    for i in 1..start_count loop
      current_minute := start_values[i];
      next_minute := case when i = start_count then start_values[1] + 1440 else start_values[i + 1] end;
      current_gap := next_minute - current_minute;
      if current_gap > largest_gap then
        largest_gap := current_gap;
        start_minute := next_minute % 1440;
      end if;
    end loop;
  end if;

  select max(
    extract(hour from ends_at)::integer * 60
    + extract(minute from ends_at)::integer
    + case
        when extract(hour from ends_at)::integer * 60 + extract(minute from ends_at)::integer <= start_minute
          then 1440
        else 0
      end
  )
  into end_minute
  from public.event_courts
  where event_id = target_event_id;

  update public.events
  set starts_at = make_time(start_minute / 60, start_minute % 60, 0),
      ends_at = make_time((end_minute % 1440) / 60, end_minute % 60, 0)
  where id = target_event_id
    and (
      starts_at is distinct from make_time(start_minute / 60, start_minute % 60, 0)
      or ends_at is distinct from make_time((end_minute % 1440) / 60, end_minute % 60, 0)
    );

  update public.signups
  set arrival_time = make_time(start_minute / 60, start_minute % 60, 0)
  where event_id = target_event_id
    and status = 'coming'
    and arrival_time is not null
    and (
      extract(hour from arrival_time)::integer * 60
      + extract(minute from arrival_time)::integer
      + case
          when end_minute >= 1440
            and extract(hour from arrival_time)::integer * 60 + extract(minute from arrival_time)::integer < start_minute
            and extract(hour from arrival_time)::integer * 60 + extract(minute from arrival_time)::integer <= end_minute % 1440
            then 1440
          else 0
        end
    ) < start_minute;

  update public.attendance
  set arrived_at = make_time(start_minute / 60, start_minute % 60, 0)
  where event_id = target_event_id
    and arrived = true
    and arrived_at is not null
    and (
      extract(hour from arrived_at)::integer * 60
      + extract(minute from arrived_at)::integer
      + case
          when end_minute >= 1440
            and extract(hour from arrived_at)::integer * 60 + extract(minute from arrived_at)::integer < start_minute
            and extract(hour from arrived_at)::integer * 60 + extract(minute from arrived_at)::integer <= end_minute % 1440
            then 1440
          else 0
        end
    ) < start_minute;
end;
$$;

create or replace function public.sync_event_schedule_from_court_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sync_event_schedule_from_courts(coalesce(new.event_id, old.event_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists event_courts_sync_event_schedule on public.event_courts;
create trigger event_courts_sync_event_schedule
after insert or update of starts_at, ends_at or delete on public.event_courts
for each row execute function public.sync_event_schedule_from_court_trigger();

create or replace function public.operator_upsert_event_court(
  target_event_id uuid,
  target_court_id uuid,
  next_court_name text,
  next_starts_at time,
  next_ends_at time
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  saved_court_id uuid;
begin
  select club_id into target_club_id from public.events where id = target_event_id and status = 'open';
  if target_club_id is null or not public.is_club_operator(target_club_id) then raise exception 'แก้คอร์ทได้เฉพาะรอบที่เปิดอยู่'; end if;
  if char_length(trim(next_court_name)) < 1 or char_length(trim(next_court_name)) > 60 then raise exception 'กรุณากรอกชื่อคอร์ท'; end if;
  if target_court_id is null then
    insert into public.event_courts (club_id, event_id, court_name, starts_at, ends_at, position)
    values (target_club_id, target_event_id, trim(next_court_name), next_starts_at, next_ends_at,
      coalesce((select max(position) + 1 from public.event_courts where event_id = target_event_id), 0))
    returning id into saved_court_id;
  else
    update public.event_courts set court_name = trim(next_court_name), starts_at = next_starts_at, ends_at = next_ends_at
    where id = target_court_id and event_id = target_event_id returning id into saved_court_id;
    if saved_court_id is null then raise exception 'ไม่พบคอร์ทนี้'; end if;
  end if;
  perform public.sync_event_schedule_from_courts(target_event_id);
  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (target_club_id, target_event_id, auth.uid(), case when target_court_id is null then 'เพิ่มคอร์ทโดยสตาฟ' else 'แก้เวลาคอร์ทโดยสตาฟ' end,
    jsonb_build_object('court_id', saved_court_id, 'court_name', trim(next_court_name), 'starts_at', next_starts_at, 'ends_at', next_ends_at));
  return saved_court_id;
end;
$$;

revoke all on function public.sync_event_schedule_from_courts(uuid) from public;
revoke all on function public.sync_event_schedule_from_court_trigger() from public;

do $$
declare
  event_row record;
begin
  for event_row in
    select id from public.events where status in ('draft', 'open')
  loop
    perform public.sync_event_schedule_from_courts(event_row.id);
  end loop;
end;
$$;
