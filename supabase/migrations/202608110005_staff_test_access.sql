-- Staff use the same operational account for the owner's isolated test club.
-- Financial tables remain protected because inherited access is operator-only.

create or replace function public.is_club_operator(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.club_members member
    where member.club_id = target_club_id
      and member.profile_id = (select auth.uid())
      and member.role in ('admin', 'staff')
      and member.active
  ) or exists (
    select 1
    from public.clubs test_club
    join public.clubs production_club
      on production_club.owner_id = test_club.owner_id
      and not production_club.is_test
    join public.club_members staff
      on staff.club_id = production_club.id
      and staff.profile_id = (select auth.uid())
      and staff.role = 'staff'
      and staff.active
    where test_club.id = target_club_id
      and test_club.is_test
  );
$$;

create or replace function public.get_backoffice_contexts()
returns table (
  member_id uuid,
  club_id uuid,
  display_name text,
  nickname text,
  role text,
  club_name text,
  is_test boolean,
  line_group_id text,
  default_friday_court_hourly_rate numeric,
  default_saturday_court_hourly_rate numeric,
  default_other_court_hourly_rate numeric,
  default_shuttlecock_unit_price numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with direct_contexts as (
    select member.id as member_id, member.club_id, member.display_name, member.nickname,
      member.role::text as role, club.name as club_name, club.is_test,
      case when member.role = 'admin' then club.line_group_id else null end as line_group_id,
      case when member.role = 'admin' then club.default_friday_court_hourly_rate else null end as default_friday_court_hourly_rate,
      case when member.role = 'admin' then club.default_saturday_court_hourly_rate else null end as default_saturday_court_hourly_rate,
      case when member.role = 'admin' then club.default_other_court_hourly_rate else null end as default_other_court_hourly_rate,
      case when member.role = 'admin' then club.default_shuttlecock_unit_price else null end as default_shuttlecock_unit_price
    from public.club_members member
    join public.clubs club on club.id = member.club_id
    where member.profile_id = (select auth.uid())
      and member.active
      and member.role in ('admin', 'staff')
  ),
  inherited_test_contexts as (
    select distinct on (test_club.id)
      staff.id as member_id, test_club.id as club_id, staff.display_name, staff.nickname,
      'staff'::text as role, test_club.name as club_name, true as is_test,
      null::text as line_group_id,
      null::numeric as default_friday_court_hourly_rate,
      null::numeric as default_saturday_court_hourly_rate,
      null::numeric as default_other_court_hourly_rate,
      null::numeric as default_shuttlecock_unit_price
    from public.club_members staff
    join public.clubs production_club
      on production_club.id = staff.club_id
      and not production_club.is_test
    join public.clubs test_club
      on test_club.owner_id = production_club.owner_id
      and test_club.is_test
    where staff.profile_id = (select auth.uid())
      and staff.role = 'staff'
      and staff.active
      and not exists (
        select 1
        from direct_contexts direct
        where direct.club_id = test_club.id
      )
    order by test_club.id, staff.created_at
  )
  select *
  from (
    select * from direct_contexts
    union all
    select * from inherited_test_contexts
  ) contexts
  order by contexts.is_test, contexts.club_name;
$$;

revoke all on function public.is_club_operator(uuid) from public;
revoke all on function public.get_backoffice_contexts() from public;
grant execute on function public.is_club_operator(uuid) to authenticated;
grant execute on function public.get_backoffice_contexts() to authenticated;
