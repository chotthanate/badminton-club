create table public.per_round_billing_snapshots (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  checkpoint_time time not null,
  checkpoint_at timestamptz not null,
  court_cost_cumulative numeric(12, 2) not null check (court_cost_cumulative >= 0),
  shuttlecock_count_cumulative integer not null check (shuttlecock_count_cumulative >= 0),
  shuttle_cost_cumulative numeric(12, 2) not null check (shuttle_cost_cumulative >= 0),
  other_cost_cumulative numeric(12, 2) not null check (other_cost_cumulative >= 0),
  shared_cost_cumulative numeric(12, 2) not null check (shared_cost_cumulative >= 0),
  available_shared_cost numeric(12, 2) not null check (available_shared_cost >= 0),
  allocated_shared_cost numeric(12, 2) not null check (allocated_shared_cost >= 0),
  deferred_shared_cost numeric(12, 2) not null check (deferred_shared_cost >= 0),
  included_match_count integer not null default 0 check (included_match_count >= 0),
  included_player_rounds integer not null default 0 check (included_player_rounds >= 0),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (event_id, checkpoint_time),
  unique (id, event_id)
);

create table public.per_round_snapshot_matches (
  snapshot_id uuid not null,
  event_id uuid not null,
  match_id uuid not null references public.queue_matches (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (snapshot_id, match_id),
  unique (event_id, match_id),
  foreign key (snapshot_id, event_id)
    references public.per_round_billing_snapshots (id, event_id) on delete cascade
);

create table public.per_round_snapshot_allocations (
  snapshot_id uuid not null,
  club_id uuid not null references public.clubs (id) on delete cascade,
  event_id uuid not null,
  member_id uuid not null,
  round_units integer not null check (round_units >= 0),
  allocated_shared_amount numeric(12, 2) not null check (allocated_shared_amount >= 0),
  created_at timestamptz not null default now(),
  primary key (snapshot_id, member_id),
  foreign key (snapshot_id, event_id)
    references public.per_round_billing_snapshots (id, event_id) on delete cascade,
  foreign key (member_id, club_id)
    references public.club_members (id, club_id) on delete restrict
);

create index per_round_snapshots_event_time_idx
  on public.per_round_billing_snapshots (event_id, checkpoint_at);
create index per_round_snapshot_allocations_event_member_idx
  on public.per_round_snapshot_allocations (event_id, member_id);

alter table public.per_round_billing_snapshots enable row level security;
alter table public.per_round_snapshot_matches enable row level security;
alter table public.per_round_snapshot_allocations enable row level security;

create policy "per_round_billing_snapshots_select_admins"
on public.per_round_billing_snapshots for select to authenticated
using ((select public.is_club_admin(club_id)));

create policy "per_round_snapshot_matches_select_admins"
on public.per_round_snapshot_matches for select to authenticated
using (
  exists (
    select 1 from public.per_round_billing_snapshots snapshot
    where snapshot.id = per_round_snapshot_matches.snapshot_id
      and public.is_club_admin(snapshot.club_id)
  )
);

create policy "per_round_snapshot_allocations_select_admins"
on public.per_round_snapshot_allocations for select to authenticated
using ((select public.is_club_admin(club_id)));

create or replace function public.event_local_instant(
  event_day date,
  event_start time,
  point_time time
)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select (
    event_day
    + case when point_time < event_start then 1 else 0 end
    + point_time
  ) at time zone 'Asia/Bangkok';
$$;

create or replace function public.snapshot_per_round_departure(
  target_event_id uuid,
  target_member_id uuid,
  departure_at time,
  cumulative_shuttlecock_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event public.events%rowtype;
  target_member public.club_members%rowtype;
  existing_payment public.payments%rowtype;
  snapshot_row public.per_round_billing_snapshots%rowtype;
  checkpoint_ts timestamptz;
  court_total numeric(12, 2) := 0;
  shuttle_total numeric(12, 2) := 0;
  other_total numeric(12, 2) := 0;
  cumulative_total numeric(12, 2) := 0;
  previously_allocated numeric(12, 2) := 0;
  available_total numeric(12, 2) := 0;
  allocated_total numeric(12, 2) := 0;
  available_cents bigint := 0;
  total_units integer := 0;
  match_count integer := 0;
  member_shared numeric(12, 2) := 0;
  member_extras numeric(12, 2) := 0;
  member_total numeric(12, 2) := 0;
  existing_checkpoint_count integer;
  snapshot_created boolean := false;
begin
  if cumulative_shuttlecock_count is null
    or cumulative_shuttlecock_count < 0
    or cumulative_shuttlecock_count > 1000 then
    raise exception 'จำนวนลูกแบดสะสมต้องอยู่ระหว่าง 0 ถึง 1,000 ลูก';
  end if;

  select * into target_event
  from public.events
  where id = target_event_id
  for update;

  if target_event.id is null or not public.is_club_admin(target_event.club_id) then
    raise exception 'ไม่มีสิทธิ์สร้าง Snapshot ค่าใช้จ่าย';
  end if;
  if target_event.billing_model <> 'per_round' then
    raise exception 'รอบนี้ไม่ได้ใช้วิธีคิดเงินตามจำนวนรอบ';
  end if;
  if target_event.status = 'closed' then
    raise exception 'รอบนี้จบรอบแล้ว';
  end if;

  select * into target_member
  from public.club_members
  where id = target_member_id and club_id = target_event.club_id;
  if target_member.id is null then raise exception 'ไม่พบสมาชิกที่ต้องการสรุปยอด'; end if;
  if not exists (
    select 1 from public.signups signup
    where signup.event_id = target_event_id
      and signup.member_id = target_member_id
      and signup.status = 'coming'
  ) then raise exception 'สมาชิกคนนี้ไม่ได้อยู่ในรอบ'; end if;

  select * into existing_payment
  from public.payments
  where event_id = target_event_id and member_id = target_member_id
  for update;
  if existing_payment.id is not null and existing_payment.billed_at is not null then
    raise exception 'สมาชิกคนนี้สรุปยอดแล้ว';
  end if;

  checkpoint_ts := public.event_local_instant(
    target_event.event_date,
    target_event.starts_at,
    departure_at
  );

  select checkpoint.cumulative_count into existing_checkpoint_count
  from public.shuttlecock_checkpoints checkpoint
  where checkpoint.event_id = target_event_id
    and checkpoint.checkpoint_time = departure_at;
  if existing_checkpoint_count is not null
    and existing_checkpoint_count <> cumulative_shuttlecock_count then
    raise exception 'เวลานี้บันทึกจำนวนลูกแบดไว้แล้ว % ลูก', existing_checkpoint_count;
  end if;

  select * into snapshot_row
  from public.per_round_billing_snapshots
  where event_id = target_event_id and checkpoint_time = departure_at
  for update;

  if snapshot_row.id is null then
    snapshot_created := true;

    if cumulative_shuttlecock_count < coalesce((
      select max(snapshot.shuttlecock_count_cumulative)
      from public.per_round_billing_snapshots snapshot
      where snapshot.event_id = target_event_id
        and snapshot.checkpoint_at < checkpoint_ts
    ), 0) then
      raise exception 'จำนวนลูกแบดสะสมน้อยกว่า Snapshot ก่อนหน้า';
    end if;

    select coalesce(round(sum(
      case
        when checkpoint_ts <= court_start then 0
        else extract(epoch from (least(checkpoint_ts, court_end) - court_start)) / 3600
      end * target_event.court_hourly_rate
    ), 2), 0)
    into court_total
    from (
      select
        public.event_local_instant(target_event.event_date, target_event.starts_at, court.starts_at) as court_start,
        public.event_local_instant(target_event.event_date, target_event.starts_at, court.ends_at)
          + case when court.ends_at = court.starts_at then interval '1 day' else interval '0' end as court_end
      from public.event_courts court
      where court.event_id = target_event_id
    ) court_times
    where checkpoint_ts > court_start;

    shuttle_total := round(cumulative_shuttlecock_count * target_event.shuttlecock_unit_price, 2);
    select coalesce(round(sum(expense.amount), 2), 0)
    into other_total
    from public.expenses expense
    where expense.event_id = target_event_id;

    cumulative_total := round(court_total + shuttle_total + other_total, 2);
    select coalesce(round(sum(allocation.allocated_shared_amount), 2), 0)
    into previously_allocated
    from public.per_round_snapshot_allocations allocation
    where allocation.event_id = target_event_id;

    if cumulative_total + 0.009 < previously_allocated then
      raise exception 'ค่าใช้จ่ายสะสมน้อยกว่ายอด Snapshot เดิม กรุณาตรวจข้อมูลย้อนหลัง';
    end if;
    available_total := greatest(0, round(cumulative_total - previously_allocated, 2));

    insert into public.per_round_billing_snapshots (
      club_id, event_id, checkpoint_time, checkpoint_at,
      court_cost_cumulative, shuttlecock_count_cumulative,
      shuttle_cost_cumulative, other_cost_cumulative,
      shared_cost_cumulative, available_shared_cost,
      allocated_shared_cost, deferred_shared_cost,
      created_by
    ) values (
      target_event.club_id, target_event_id, departure_at, checkpoint_ts,
      court_total, cumulative_shuttlecock_count,
      shuttle_total, other_total,
      cumulative_total, available_total,
      0, available_total,
      auth.uid()
    ) returning * into snapshot_row;

    insert into public.per_round_snapshot_matches (snapshot_id, event_id, match_id)
    select snapshot_row.id, target_event_id, match.id
    from public.queue_matches match
    where match.event_id = target_event_id
      and match.status in ('playing', 'completed')
      and (
        (match.status = 'completed' and match.ended_at is not null and match.ended_at <= checkpoint_ts)
        or (match.started_at is not null and match.started_at <= checkpoint_ts - interval '11 minutes')
      )
      and not exists (
        select 1 from public.per_round_snapshot_matches prior
        where prior.event_id = target_event_id and prior.match_id = match.id
      )
      and 4 = (
        select count(distinct player.member_id)
        from public.queue_match_players player
        where player.match_id = match.id
      );

    select count(*), coalesce(count(*) * 4, 0)
    into match_count, total_units
    from public.per_round_snapshot_matches snapshot_match
    where snapshot_match.snapshot_id = snapshot_row.id;

    available_cents := round(available_total * 100)::bigint;
    if total_units > 0 and available_cents > 0 then
      insert into public.per_round_snapshot_allocations (
        snapshot_id, club_id, event_id, member_id, round_units, allocated_shared_amount
      )
      with member_units as (
        select player.member_id, count(*)::integer as units
        from public.per_round_snapshot_matches snapshot_match
        join public.queue_match_players player on player.match_id = snapshot_match.match_id
        where snapshot_match.snapshot_id = snapshot_row.id
        group by player.member_id
      ), raw_shares as (
        select
          member_id,
          units,
          floor(available_cents::numeric * units / total_units)::bigint as base_cents,
          mod(available_cents * units, total_units)::bigint as remainder_score
        from member_units
      ), ranked as (
        select
          raw_shares.*,
          available_cents - sum(base_cents) over () as bonus_count,
          row_number() over (order by remainder_score desc, member_id) as bonus_rank
        from raw_shares
      )
      select
        snapshot_row.id,
        target_event.club_id,
        target_event_id,
        member_id,
        units,
        (base_cents + case when bonus_rank <= bonus_count then 1 else 0 end)::numeric / 100
      from ranked;
    end if;

    select coalesce(round(sum(allocation.allocated_shared_amount), 2), 0)
    into allocated_total
    from public.per_round_snapshot_allocations allocation
    where allocation.snapshot_id = snapshot_row.id;

    if total_units > 0 and abs(allocated_total - available_total) >= 0.01 then
      raise exception 'กระจายค่าใช้จ่าย Snapshot ไม่ครบ ระบบยังไม่ได้บันทึกข้อมูลใด';
    end if;

    update public.per_round_billing_snapshots
    set allocated_shared_cost = allocated_total,
        deferred_shared_cost = round(available_total - allocated_total, 2),
        included_match_count = match_count,
        included_player_rounds = total_units
    where id = snapshot_row.id
    returning * into snapshot_row;

    insert into public.shuttlecock_checkpoints (
      club_id, event_id, checkpoint_time, cumulative_count, created_by
    ) values (
      target_event.club_id, target_event_id, departure_at,
      cumulative_shuttlecock_count, auth.uid()
    )
    on conflict (event_id, checkpoint_time) do nothing;

    update public.events
    set shuttlecock_count = greatest(shuttlecock_count, cumulative_shuttlecock_count)
    where id = target_event_id;
  elsif snapshot_row.shuttlecock_count_cumulative <> cumulative_shuttlecock_count then
    raise exception 'เวลาเดียวกันมี Snapshot ที่บันทึกจำนวนลูกแบดไว้แล้ว % ลูก', snapshot_row.shuttlecock_count_cumulative;
  end if;

  insert into public.attendance (
    club_id, event_id, member_id, arrived, arrived_at, left_at
  ) values (
    target_event.club_id, target_event_id, target_member_id,
    true, target_event.starts_at, departure_at
  )
  on conflict (event_id, member_id) do update
    set arrived = true, left_at = excluded.left_at;

  select coalesce(round(sum(allocation.allocated_shared_amount), 2), 0)
  into member_shared
  from public.per_round_snapshot_allocations allocation
  where allocation.event_id = target_event_id
    and allocation.member_id = target_member_id;

  select coalesce(round(sum(charge.unit_price * charge.quantity), 2), 0)
  into member_extras
  from public.member_extra_charges charge
  where charge.event_id = target_event_id
    and charge.member_id = target_member_id;
  member_total := round(member_shared + member_extras, 2);

  insert into public.payments (
    club_id, event_id, member_id, amount, calculated_amount,
    billed_at, paid_at, payment_status, paid_source,
    shared_amount, extras_amount, shuttlecock_count_snapshot, recorded_by
  ) values (
    target_event.club_id, target_event_id, target_member_id,
    member_total, member_total,
    now(), case when target_member.payment_exempt then now() else null end,
    case when target_member.payment_exempt then 'paid' else 'awaiting' end,
    case when target_member.payment_exempt then 'exempt' else null end,
    member_shared, member_extras, snapshot_row.shuttlecock_count_cumulative,
    auth.uid()
  )
  on conflict (event_id, member_id) do update
    set amount = excluded.amount,
        calculated_amount = excluded.calculated_amount,
        billed_at = excluded.billed_at,
        paid_at = excluded.paid_at,
        payment_status = excluded.payment_status,
        paid_source = excluded.paid_source,
        shared_amount = excluded.shared_amount,
        extras_amount = excluded.extras_amount,
        shuttlecock_count_snapshot = excluded.shuttlecock_count_snapshot,
        recorded_by = excluded.recorded_by,
        updated_at = now();

  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (
    target_event.club_id,
    target_event_id,
    auth.uid(),
    'Snapshot และสรุปยอดผู้เล่นกลับก่อน',
    jsonb_build_object(
      'snapshot_id', snapshot_row.id,
      'checkpoint_time', departure_at,
      'member_id', target_member_id,
      'snapshot_created', snapshot_created,
      'matches', snapshot_row.included_match_count,
      'player_rounds', snapshot_row.included_player_rounds,
      'shuttlecocks', snapshot_row.shuttlecock_count_cumulative,
      'shared_amount', member_shared,
      'extras_amount', member_extras,
      'billed_amount', member_total
    )
  );

  return jsonb_build_object(
    'snapshotId', snapshot_row.id,
    'checkpointTime', to_char(departure_at, 'HH24:MI'),
    'snapshotCreated', snapshot_created,
    'includedMatches', snapshot_row.included_match_count,
    'includedPlayerRounds', snapshot_row.included_player_rounds,
    'shuttlecockCount', snapshot_row.shuttlecock_count_cumulative,
    'sharedCostCumulative', snapshot_row.shared_cost_cumulative,
    'allocatedSharedCost', snapshot_row.allocated_shared_cost,
    'deferredSharedCost', snapshot_row.deferred_shared_cost,
    'memberSharedAmount', member_shared,
    'memberExtrasAmount', member_extras,
    'memberBilledAmount', member_total
  );
end;
$$;

grant execute on function public.snapshot_per_round_departure(uuid, uuid, time, integer)
to authenticated;

create or replace function public.prevent_snapshotted_match_roster_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_match_id uuid := coalesce(old.match_id, new.match_id);
begin
  if exists (
    select 1 from public.per_round_snapshot_matches snapshot_match
    where snapshot_match.match_id = affected_match_id
  ) then
    raise exception 'แก้รายชื่อเกมนี้ไม่ได้ เนื่องจากถูกนำไปคิดใน Snapshot แล้ว';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists queue_match_players_prevent_snapshot_change
on public.queue_match_players;
create trigger queue_match_players_prevent_snapshot_change
before update or delete on public.queue_match_players
for each row execute function public.prevent_snapshotted_match_roster_change();

create or replace function public.prevent_snapshotted_match_cancellation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status
    and exists (
      select 1 from public.per_round_snapshot_matches snapshot_match
      where snapshot_match.match_id = old.id
    )
    and not (old.status = 'playing' and new.status = 'completed') then
    raise exception 'ยกเลิกหรือเปลี่ยนสถานะเกมนี้ไม่ได้ เนื่องจากถูกนำไปคิดใน Snapshot แล้ว';
  end if;
  return new;
end;
$$;

drop trigger if exists queue_matches_prevent_snapshot_cancellation
on public.queue_matches;
create trigger queue_matches_prevent_snapshot_cancellation
before update of status on public.queue_matches
for each row execute function public.prevent_snapshotted_match_cancellation();

create or replace function public.prevent_snapshot_cost_reduction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.per_round_billing_snapshots snapshot
    where snapshot.event_id = old.id
  ) and (
    new.court_hourly_rate is distinct from old.court_hourly_rate
    or new.shuttlecock_unit_price is distinct from old.shuttlecock_unit_price
    or new.shuttlecock_count < old.shuttlecock_count
  ) then
    raise exception 'แก้ราคาเดิมหรือลดยอดลูกแบดไม่ได้ เนื่องจากรอบนี้มี Snapshot แล้ว';
  end if;
  return new;
end;
$$;

drop trigger if exists events_prevent_snapshot_cost_reduction on public.events;
create trigger events_prevent_snapshot_cost_reduction
before update of court_hourly_rate, shuttlecock_unit_price, shuttlecock_count on public.events
for each row execute function public.prevent_snapshot_cost_reduction();

create or replace function public.prevent_snapshotted_expense_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.per_round_billing_snapshots snapshot
    where snapshot.event_id = old.event_id
      and snapshot.created_at >= old.created_at
  ) then
    raise exception 'แก้หรือลบค่าใช้จ่ายนี้ไม่ได้ เนื่องจากถูกนำไปคิดใน Snapshot แล้ว';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists expenses_prevent_snapshot_change on public.expenses;
create trigger expenses_prevent_snapshot_change
before update or delete on public.expenses
for each row execute function public.prevent_snapshotted_expense_change();

create or replace function public.prevent_snapshotted_shuttle_checkpoint_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.per_round_billing_snapshots snapshot
    where snapshot.event_id = old.event_id
      and snapshot.created_at >= old.created_at
  ) then
    raise exception 'แก้หรือลบจุดบันทึกลูกแบดนี้ไม่ได้ เนื่องจากถูกนำไปคิดใน Snapshot แล้ว';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists shuttlecock_checkpoints_prevent_snapshot_change
on public.shuttlecock_checkpoints;
create trigger shuttlecock_checkpoints_prevent_snapshot_change
before update or delete on public.shuttlecock_checkpoints
for each row execute function public.prevent_snapshotted_shuttle_checkpoint_change();
