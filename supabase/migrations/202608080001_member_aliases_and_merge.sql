alter table public.club_members
  add column if not exists aliases text[] not null default '{}'::text[];

comment on column public.club_members.aliases is
  'Previous nicknames and LINE display names retained for search after rename or member merge.';

create or replace function public.merge_club_members(
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
  merged_aliases text[];
begin
  if source_member_id = target_member_id then
    raise exception 'กรุณาเลือกชื่อหลักและชื่อซ้ำคนละรายการ';
  end if;

  select * into source_member
  from public.club_members
  where id = source_member_id
  for update;

  select * into target_member
  from public.club_members
  where id = target_member_id
  for update;

  if source_member.id is null or target_member.id is null then
    raise exception 'ไม่พบรายชื่อที่ต้องการรวม';
  end if;
  if source_member.club_id <> target_member.club_id then
    raise exception 'รวมรายชื่อข้ามกลุ่มไม่ได้';
  end if;
  if not public.is_club_admin(target_member.club_id) then
    raise exception 'อนุญาตเฉพาะแอดมิน';
  end if;
  if source_member.role = 'admin' or target_member.role = 'admin' then
    raise exception 'ไม่สามารถรวมบัญชีแอดมิน';
  end if;
  if source_member.line_user_id is not null
     and target_member.line_user_id is not null
     and source_member.line_user_id <> target_member.line_user_id then
    raise exception 'สองรายชื่อนี้เชื่อมกับคนละบัญชี LINE จึงรวมอัตโนมัติไม่ได้';
  end if;
  if source_member.profile_id is not null
     and target_member.profile_id is not null
     and source_member.profile_id <> target_member.profile_id then
    raise exception 'สองรายชื่อนี้เชื่อมกับคนละบัญชีผู้ใช้ จึงรวมอัตโนมัติไม่ได้';
  end if;
  if exists (
    select 1
    from public.payments source_payment
    join public.payments target_payment
      on target_payment.event_id = source_payment.event_id
     and target_payment.member_id = target_member_id
    where source_payment.member_id = source_member_id
  ) then
    raise exception 'สองชื่อนี้มีค่าใช้จ่ายในรอบเดียวกัน จึงยังรวมไม่ได้ กรุณาตรวจสอบรอบนั้นก่อน';
  end if;

  select coalesce(array_agg(distinct value) filter (where value <> ''), '{}'::text[])
  into merged_aliases
  from unnest(
    coalesce(target_member.aliases, '{}'::text[])
    || coalesce(source_member.aliases, '{}'::text[])
    || array[
      target_member.nickname,
      target_member.display_name,
      source_member.nickname,
      source_member.display_name
    ]
  ) as alias(value);

  -- Release unique identity keys from the duplicate row before attaching them
  -- to the canonical row. The source row is deleted at the end of this transaction.
  update public.club_members
  set line_user_id = null,
      profile_id = null
  where id = source_member_id;

  update public.club_members
  set aliases = merged_aliases,
      line_user_id = coalesce(target_member.line_user_id, source_member.line_user_id),
      profile_id = coalesce(target_member.profile_id, source_member.profile_id),
      payment_exempt = target_member.payment_exempt or source_member.payment_exempt,
      active = target_member.active or source_member.active
  where id = target_member_id;

  update public.signups target_signup
  set status = case
        when target_signup.status = 'coming' or source_signup.status = 'coming' then 'coming'::public.signup_status
        when target_signup.status = 'maybe' or source_signup.status = 'maybe' then 'maybe'::public.signup_status
        else 'not_coming'::public.signup_status
      end,
      arrival_time = case
        when target_signup.status = 'coming' then target_signup.arrival_time
        when source_signup.status = 'coming' then source_signup.arrival_time
        else null
      end,
      note = case when trim(target_signup.note) <> '' then target_signup.note else source_signup.note end
  from public.signups source_signup
  where source_signup.member_id = source_member_id
    and target_signup.member_id = target_member_id
    and target_signup.event_id = source_signup.event_id;

  delete from public.signups source_signup
  using public.signups target_signup
  where source_signup.member_id = source_member_id
    and target_signup.member_id = target_member_id
    and target_signup.event_id = source_signup.event_id;

  update public.signups
  set member_id = target_member_id
  where member_id = source_member_id;

  update public.attendance target_attendance
  set arrived = target_attendance.arrived or source_attendance.arrived,
      arrived_at = coalesce(target_attendance.arrived_at, source_attendance.arrived_at),
      left_at = coalesce(target_attendance.left_at, source_attendance.left_at),
      weight = greatest(target_attendance.weight, source_attendance.weight),
      billing_percentage = greatest(target_attendance.billing_percentage, source_attendance.billing_percentage),
      note = case when trim(target_attendance.note) <> '' then target_attendance.note else source_attendance.note end
  from public.attendance source_attendance
  where source_attendance.member_id = source_member_id
    and target_attendance.member_id = target_member_id
    and target_attendance.event_id = source_attendance.event_id;

  delete from public.attendance source_attendance
  using public.attendance target_attendance
  where source_attendance.member_id = source_member_id
    and target_attendance.member_id = target_member_id
    and target_attendance.event_id = source_attendance.event_id;

  update public.attendance
  set member_id = target_member_id
  where member_id = source_member_id;

  update public.payments
  set member_id = target_member_id
  where member_id = source_member_id;

  update public.member_extra_charges
  set member_id = target_member_id
  where member_id = source_member_id;

  update public.payment_slips
  set submitted_by_member_id = case
        when submitted_by_member_id = source_member_id then target_member_id
        else submitted_by_member_id
      end,
      beneficiary_member_id = case
        when beneficiary_member_id = source_member_id then target_member_id
        else beneficiary_member_id
      end
  where submitted_by_member_id = source_member_id
     or beneficiary_member_id = source_member_id;

  delete from public.club_members where id = source_member_id;
  return target_member_id;
end;
$$;

revoke all on function public.merge_club_members(uuid, uuid) from public;
grant execute on function public.merge_club_members(uuid, uuid) to authenticated;
