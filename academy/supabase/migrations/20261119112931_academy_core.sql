begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.academy_settings (
  id boolean primary key default true check (id),
  default_service_fee_satang bigint not null default 5000 check (default_service_fee_satang >= 0),
  timezone text not null default 'Asia/Bangkok',
  updated_at timestamptz not null default now()
);
insert into public.academy_settings (id) values (true) on conflict do nothing;

create table public.academy_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  internal_email text not null unique,
  display_name text not null check (length(trim(display_name)) > 0),
  role text not null check (role in ('admin', 'teacher', 'student')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index academy_profiles_username_key on public.academy_profiles (lower(username));
alter table public.academy_profiles add constraint academy_profiles_user_id_role_key unique (user_id, role);

create table public.academy_line_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.academy_profiles(user_id) on delete cascade,
  line_user_id text not null unique,
  linked_at timestamptz not null default now()
);

create table public.academy_sessions (
  id uuid primary key default gen_random_uuid(),
  session_date date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  venue text not null,
  service_fee_satang bigint not null default 5000 check (service_fee_satang >= 0),
  court_cost_satang bigint not null default 0 check (court_cost_satang >= 0),
  status text not null default 'draft' check (status in ('draft', 'open', 'in_progress', 'awaiting_summary', 'finalized', 'cancelled')),
  finalized_at timestamptz,
  finalized_by uuid references public.academy_profiles(user_id),
  created_by uuid not null default auth.uid() references public.academy_profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((status = 'finalized') = (finalized_at is not null))
);
create index academy_sessions_starts_at_idx on public.academy_sessions (starts_at);

create table public.academy_session_teachers (
  session_id uuid not null references public.academy_sessions(id) on delete cascade,
  teacher_id uuid not null,
  checked_at timestamptz,
  primary key (session_id, teacher_id),
  foreign key (teacher_id, role) references public.academy_profiles(user_id, role),
  role text not null default 'teacher' check (role = 'teacher')
);

create table public.academy_registrations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.academy_sessions(id) on delete cascade,
  student_id uuid not null,
  status text not null default 'registered' check (status in ('registered', 'cancelled')),
  source text not null default 'student' check (source in ('student', 'line', 'walk_in', 'admin')),
  registered_at timestamptz not null default now(),
  cancelled_at timestamptz,
  unique (session_id, student_id),
  foreign key (student_id, role) references public.academy_profiles(user_id, role),
  role text not null default 'student' check (role = 'student'),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create index academy_registrations_student_idx on public.academy_registrations (student_id, session_id);

create table public.academy_attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  student_id uuid not null,
  status text not null check (status in ('present', 'absent')),
  checked_at timestamptz not null default now(),
  checked_by uuid default auth.uid() references public.academy_profiles(user_id),
  unique (session_id, student_id),
  foreign key (session_id, student_id) references public.academy_registrations(session_id, student_id) on delete cascade
);

create table public.academy_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_satang bigint not null check (price_satang >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.academy_purchases (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  student_id uuid not null,
  product_id uuid references public.academy_products(id),
  product_name_snapshot text not null,
  unit_price_satang bigint not null check (unit_price_satang >= 0),
  quantity integer not null check (quantity > 0),
  created_by uuid not null default auth.uid() references public.academy_profiles(user_id),
  created_at timestamptz not null default now(),
  foreign key (session_id, student_id) references public.academy_registrations(session_id, student_id) on delete cascade
);
create index academy_purchases_student_session_idx on public.academy_purchases (student_id, session_id);

create table public.academy_lesson_topics (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.academy_sessions(id) on delete cascade,
  title text not null,
  notes text,
  updated_by uuid not null default auth.uid() references public.academy_profiles(user_id),
  updated_at timestamptz not null default now()
);

create table public.academy_kpis (
  id uuid primary key default gen_random_uuid(),
  lesson_topic_id uuid not null references public.academy_lesson_topics(id) on delete cascade,
  name text not null,
  maximum_score numeric(8,2) not null check (maximum_score > 0),
  display_order integer not null default 0
);

create table public.academy_scores (
  id uuid primary key default gen_random_uuid(),
  kpi_id uuid not null references public.academy_kpis(id) on delete cascade,
  student_id uuid not null references public.academy_profiles(user_id),
  score numeric(8,2) not null check (score >= 0),
  note text,
  scored_by uuid not null default auth.uid() references public.academy_profiles(user_id),
  scored_at timestamptz not null default now(),
  unique (kpi_id, student_id)
);

create table public.academy_feedback (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.academy_sessions(id) on delete cascade,
  student_id uuid not null references public.academy_profiles(user_id),
  strengths text,
  improvements text,
  created_by uuid not null default auth.uid() references public.academy_profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, student_id)
);

create table public.academy_invoices (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.academy_sessions(id),
  student_id uuid not null references public.academy_profiles(user_id),
  total_satang bigint not null check (total_satang >= 0),
  status text not null default 'unpaid' check (status in ('unpaid', 'slip_pending', 'manual_review', 'paid', 'void')),
  finalized_at timestamptz not null default now(),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_id, student_id),
  check ((status = 'paid') = (paid_at is not null))
);
create index academy_invoices_student_status_idx on public.academy_invoices (student_id, status);

create table public.academy_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.academy_invoices(id) on delete cascade,
  kind text not null check (kind in ('service_fee', 'court_share', 'product', 'adjustment')),
  description text not null,
  quantity integer not null default 1 check (quantity > 0),
  unit_amount_satang bigint not null,
  total_satang bigint generated always as (quantity * unit_amount_satang) stored,
  source_id uuid
);

create table public.academy_invoice_adjustments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.academy_invoices(id),
  amount_satang bigint not null check (amount_satang <> 0),
  reason text not null check (length(trim(reason)) > 0),
  created_by uuid not null default auth.uid() references public.academy_profiles(user_id),
  created_at timestamptz not null default now()
);

create table public.academy_payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.academy_profiles(user_id),
  amount_satang bigint not null check (amount_satang > 0),
  status text not null default 'slip_pending' check (status in ('slip_pending', 'manual_review', 'paid', 'rejected')),
  slip_path text not null,
  slip_reference text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.academy_profiles(user_id),
  review_note text
);

create table public.academy_payment_allocations (
  payment_id uuid not null references public.academy_payments(id) on delete cascade,
  invoice_id uuid not null references public.academy_invoices(id),
  amount_satang bigint not null check (amount_satang > 0),
  primary key (payment_id, invoice_id)
);
create unique index academy_active_invoice_allocation_key on public.academy_payment_allocations (invoice_id);

create table public.academy_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.academy_profiles(user_id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function private.academy_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from public.academy_profiles where user_id = (select auth.uid()) and active;
$$;
create or replace function private.academy_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.academy_role() = 'admin', false);
$$;
create or replace function private.academy_is_session_teacher(p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.academy_session_teachers where session_id = p_session_id and teacher_id = (select auth.uid()));
$$;
create or replace function private.academy_can_manage_session(p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.academy_is_admin() or private.academy_is_session_teacher(p_session_id);
$$;
create or replace function private.academy_can_view_session(p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.academy_can_manage_session(p_session_id)
    or exists(select 1 from public.academy_registrations where session_id = p_session_id and student_id = (select auth.uid()) and status = 'registered');
$$;
revoke all on all functions in schema private from public, anon;
grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

create or replace function public.academy_validate_score()
returns trigger language plpgsql set search_path = '' as $$
declare v_max numeric;
begin
  select maximum_score into v_max from public.academy_kpis where id = new.kpi_id;
  if new.score > v_max then raise exception 'score exceeds maximum'; end if;
  return new;
end;
$$;
create trigger academy_scores_validate before insert or update on public.academy_scores for each row execute function public.academy_validate_score();

create or replace function public.academy_require_mutable_session()
returns trigger language plpgsql set search_path = '' as $$
declare v_session_id uuid; v_status text;
begin
  v_session_id := case when tg_op = 'DELETE' then old.session_id else new.session_id end;
  select status into v_status from public.academy_sessions where id = v_session_id;
  if v_status in ('finalized', 'cancelled') then raise exception 'session is locked'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger academy_registrations_mutable before insert or update or delete on public.academy_registrations for each row execute function public.academy_require_mutable_session();
create trigger academy_attendance_mutable before insert or update or delete on public.academy_attendance for each row execute function public.academy_require_mutable_session();
create trigger academy_purchases_mutable before insert or update or delete on public.academy_purchases for each row execute function public.academy_require_mutable_session();

create or replace function public.academy_protect_finalized_session()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'finalized' and new is distinct from old then raise exception 'finalized session is immutable'; end if;
  return new;
end;
$$;
create trigger academy_sessions_finalized_immutable before update on public.academy_sessions for each row execute function public.academy_protect_finalized_session();

create or replace function public.academy_finalize_session_billing(p_session_id uuid)
returns table(invoice_id uuid, student_id uuid, total_satang bigint)
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.academy_sessions%rowtype;
  v_attendee_count integer;
  v_court_share bigint;
  v_registration record;
  v_invoice_id uuid;
  v_products bigint;
begin
  if not private.academy_is_admin() then raise exception 'not authorized'; end if;
  select * into v_session from public.academy_sessions where id = p_session_id for update;
  if not found then raise exception 'session not found'; end if;
  if v_session.status = 'finalized' then
    return query select i.id, i.student_id, i.total_satang from public.academy_invoices i where i.session_id = p_session_id;
    return;
  end if;
  if v_session.status = 'cancelled' then raise exception 'cancelled session cannot be finalized'; end if;
  select count(*) into v_attendee_count from public.academy_attendance where session_id = p_session_id and status = 'present';
  if v_attendee_count = 0 then raise exception 'no present students'; end if;
  v_court_share := ceil((v_session.court_cost_satang::numeric / v_attendee_count) / 100) * 100;

  for v_registration in
    select r.student_id from public.academy_registrations r
    join public.academy_attendance a on a.session_id = r.session_id and a.student_id = r.student_id
    where r.session_id = p_session_id and r.status = 'registered' and a.status = 'present'
  loop
    select coalesce(sum(quantity * unit_price_satang), 0) into v_products
      from public.academy_purchases where session_id = p_session_id and student_id = v_registration.student_id;
    insert into public.academy_invoices(session_id, student_id, total_satang)
      values (p_session_id, v_registration.student_id, v_session.service_fee_satang + v_court_share + v_products)
      on conflict (session_id, student_id) do nothing returning id into v_invoice_id;
    if v_invoice_id is null then raise exception 'billing already exists for a student'; end if;
    insert into public.academy_invoice_items(invoice_id, kind, description, unit_amount_satang)
      values (v_invoice_id, 'service_fee', 'ค่าบริการเรียน', v_session.service_fee_satang),
             (v_invoice_id, 'court_share', 'ส่วนแบ่งค่าสนาม', v_court_share);
    insert into public.academy_invoice_items(invoice_id, kind, description, quantity, unit_amount_satang, source_id)
      select v_invoice_id, 'product', product_name_snapshot, quantity, unit_price_satang, id
      from public.academy_purchases where session_id = p_session_id and student_id = v_registration.student_id;
  end loop;
  update public.academy_sessions set status = 'finalized', finalized_at = now(), finalized_by = auth.uid(), updated_at = now() where id = p_session_id;
  insert into public.academy_audit_log(actor_id, action, entity_type, entity_id, details)
    values (auth.uid(), 'finalize_billing', 'session', p_session_id, jsonb_build_object('attendees', v_attendee_count, 'court_share_satang', v_court_share));
  return query select i.id, i.student_id, i.total_satang from public.academy_invoices i where i.session_id = p_session_id;
end;
$$;

create or replace function public.academy_submit_payment(p_invoice_ids uuid[], p_slip_path text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_payment_id uuid; v_total bigint; v_count integer;
begin
  if auth.uid() is null or coalesce(array_length(p_invoice_ids, 1), 0) = 0 then raise exception 'invalid request'; end if;
  if split_part(p_slip_path, '/', 1) <> auth.uid()::text then raise exception 'invalid slip path'; end if;
  select count(*), sum(total_satang) into v_count, v_total from public.academy_invoices
    where id = any(p_invoice_ids) and student_id = auth.uid() and status = 'unpaid';
  if v_count <> array_length(p_invoice_ids, 1) then raise exception 'invoice unavailable'; end if;
  if exists(select 1 from public.academy_payment_allocations where invoice_id = any(p_invoice_ids)) then raise exception 'invoice already submitted'; end if;
  insert into public.academy_payments(student_id, amount_satang, slip_path) values (auth.uid(), v_total, p_slip_path) returning id into v_payment_id;
  insert into public.academy_payment_allocations(payment_id, invoice_id, amount_satang)
    select v_payment_id, id, total_satang from public.academy_invoices where id = any(p_invoice_ids);
  update public.academy_invoices set status = 'slip_pending' where id = any(p_invoice_ids);
  return v_payment_id;
end;
$$;

create or replace function public.academy_adjust_invoice(p_invoice_id uuid, p_amount_satang bigint, p_reason text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_total bigint;
begin
  if not private.academy_is_admin() then raise exception 'not authorized'; end if;
  if p_amount_satang = 0 or length(trim(p_reason)) = 0 then raise exception 'invalid adjustment'; end if;
  perform 1 from public.academy_invoices where id = p_invoice_id and status not in ('paid', 'void') for update;
  if not found then raise exception 'invoice is not adjustable'; end if;
  insert into public.academy_invoice_adjustments(invoice_id, amount_satang, reason, created_by)
    values (p_invoice_id, p_amount_satang, p_reason, auth.uid());
  insert into public.academy_invoice_items(invoice_id, kind, description, unit_amount_satang)
    values (p_invoice_id, 'adjustment', p_reason, p_amount_satang);
  update public.academy_invoices set total_satang = total_satang + p_amount_satang where id = p_invoice_id and total_satang + p_amount_satang >= 0 returning total_satang into v_total;
  if v_total is null then raise exception 'adjustment would make invoice negative'; end if;
  return v_total;
end;
$$;

create or replace function public.academy_check_in_teacher(p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.academy_session_teachers set checked_at = now()
    where session_id = p_session_id and teacher_id = auth.uid();
  if not found then raise exception 'teacher is not assigned to this session'; end if;
end;
$$;

create or replace function public.academy_review_payment(p_payment_id uuid, p_approved boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_payment public.academy_payments%rowtype;
begin
  if not private.academy_is_admin() then raise exception 'not authorized'; end if;
  select * into v_payment from public.academy_payments where id = p_payment_id for update;
  if not found or v_payment.status not in ('slip_pending', 'manual_review') then raise exception 'payment is not reviewable'; end if;
  update public.academy_payments set status = case when p_approved then 'paid' else 'rejected' end,
    reviewed_at = now(), reviewed_by = auth.uid(), review_note = p_note where id = p_payment_id;
  update public.academy_invoices set status = case when p_approved then 'paid' else 'unpaid' end,
    paid_at = case when p_approved then now() else null end
    where id in (select invoice_id from public.academy_payment_allocations where payment_id = p_payment_id);
  if not p_approved then delete from public.academy_payment_allocations where payment_id = p_payment_id; end if;
end;
$$;

revoke all on function public.academy_finalize_session_billing(uuid) from public, anon;
revoke all on function public.academy_submit_payment(uuid[], text) from public, anon;
revoke all on function public.academy_review_payment(uuid, boolean, text) from public, anon;
revoke all on function public.academy_adjust_invoice(uuid, bigint, text) from public, anon;
revoke all on function public.academy_check_in_teacher(uuid) from public, anon;
grant execute on function public.academy_finalize_session_billing(uuid) to authenticated;
grant execute on function public.academy_submit_payment(uuid[], text) to authenticated;
grant execute on function public.academy_review_payment(uuid, boolean, text) to authenticated;
grant execute on function public.academy_adjust_invoice(uuid, bigint, text) to authenticated;
grant execute on function public.academy_check_in_teacher(uuid) to authenticated;

alter table public.academy_settings enable row level security;
alter table public.academy_profiles enable row level security;
alter table public.academy_line_accounts enable row level security;
alter table public.academy_sessions enable row level security;
alter table public.academy_session_teachers enable row level security;
alter table public.academy_registrations enable row level security;
alter table public.academy_attendance enable row level security;
alter table public.academy_products enable row level security;
alter table public.academy_purchases enable row level security;
alter table public.academy_lesson_topics enable row level security;
alter table public.academy_kpis enable row level security;
alter table public.academy_scores enable row level security;
alter table public.academy_feedback enable row level security;
alter table public.academy_invoices enable row level security;
alter table public.academy_invoice_items enable row level security;
alter table public.academy_invoice_adjustments enable row level security;
alter table public.academy_payments enable row level security;
alter table public.academy_payment_allocations enable row level security;
alter table public.academy_audit_log enable row level security;

create policy academy_settings_read on public.academy_settings for select to authenticated using (true);
create policy academy_settings_admin on public.academy_settings for all to authenticated using (private.academy_is_admin()) with check (private.academy_is_admin());
create policy academy_profiles_read_self_or_staff on public.academy_profiles for select to authenticated using (user_id = auth.uid() or private.academy_role() in ('admin','teacher'));
create policy academy_line_self on public.academy_line_accounts for select to authenticated using (user_id = auth.uid() or private.academy_is_admin());

create policy academy_sessions_read on public.academy_sessions for select to authenticated using (status = 'open' or private.academy_can_view_session(id) or private.academy_role() in ('admin','teacher'));
create policy academy_sessions_admin_insert on public.academy_sessions for insert to authenticated with check (private.academy_is_admin() and created_by = auth.uid());
create policy academy_sessions_admin_update on public.academy_sessions for update to authenticated using (private.academy_is_admin()) with check (private.academy_is_admin());
create policy academy_teachers_read on public.academy_session_teachers for select to authenticated using (teacher_id = auth.uid() or private.academy_is_admin() or private.academy_can_view_session(session_id));
create policy academy_teachers_admin on public.academy_session_teachers for all to authenticated using (private.academy_is_admin()) with check (private.academy_is_admin());

create policy academy_registrations_read on public.academy_registrations for select to authenticated using (student_id = auth.uid() or private.academy_can_manage_session(session_id));
create policy academy_registrations_student_insert on public.academy_registrations for insert to authenticated with check (
  student_id = auth.uid() and source in ('student','line') and exists(select 1 from public.academy_sessions s where s.id = session_id and s.status = 'open' and now() < s.starts_at)
);
create policy academy_registrations_student_update on public.academy_registrations for update to authenticated using (student_id = auth.uid()) with check (
  student_id = auth.uid() and exists(select 1 from public.academy_sessions s where s.id = session_id and s.status = 'open' and now() < s.starts_at)
);
create policy academy_registrations_staff on public.academy_registrations for all to authenticated using (private.academy_can_manage_session(session_id)) with check (private.academy_can_manage_session(session_id));
create policy academy_attendance_read on public.academy_attendance for select to authenticated using (student_id = auth.uid() or private.academy_can_manage_session(session_id));
create policy academy_attendance_staff on public.academy_attendance for all to authenticated using (private.academy_can_manage_session(session_id)) with check (private.academy_can_manage_session(session_id));

create policy academy_products_read on public.academy_products for select to authenticated using (active or private.academy_is_admin());
create policy academy_products_admin on public.academy_products for all to authenticated using (private.academy_is_admin()) with check (private.academy_is_admin());
create policy academy_purchases_read on public.academy_purchases for select to authenticated using (student_id = auth.uid() or private.academy_can_manage_session(session_id));
create policy academy_purchases_staff on public.academy_purchases for all to authenticated using (private.academy_can_manage_session(session_id)) with check (private.academy_can_manage_session(session_id));
create policy academy_topics_read on public.academy_lesson_topics for select to authenticated using (private.academy_can_view_session(session_id));
create policy academy_topics_staff on public.academy_lesson_topics for all to authenticated using (private.academy_can_manage_session(session_id)) with check (private.academy_can_manage_session(session_id));
create policy academy_kpis_read on public.academy_kpis for select to authenticated using (exists(select 1 from public.academy_lesson_topics t where t.id = lesson_topic_id and private.academy_can_view_session(t.session_id)));
create policy academy_kpis_staff on public.academy_kpis for all to authenticated using (exists(select 1 from public.academy_lesson_topics t where t.id = lesson_topic_id and private.academy_can_manage_session(t.session_id))) with check (exists(select 1 from public.academy_lesson_topics t where t.id = lesson_topic_id and private.academy_can_manage_session(t.session_id)));
create policy academy_scores_read on public.academy_scores for select to authenticated using (student_id = auth.uid() or exists(select 1 from public.academy_kpis k join public.academy_lesson_topics t on t.id = k.lesson_topic_id where k.id = academy_scores.kpi_id and private.academy_can_manage_session(t.session_id)));
create policy academy_scores_staff on public.academy_scores for all to authenticated using (exists(select 1 from public.academy_kpis k join public.academy_lesson_topics t on t.id = k.lesson_topic_id where k.id = academy_scores.kpi_id and private.academy_can_manage_session(t.session_id))) with check (exists(select 1 from public.academy_kpis k join public.academy_lesson_topics t on t.id = k.lesson_topic_id where k.id = academy_scores.kpi_id and private.academy_can_manage_session(t.session_id)));
create policy academy_feedback_read on public.academy_feedback for select to authenticated using (student_id = auth.uid() or private.academy_can_manage_session(session_id));
create policy academy_feedback_staff on public.academy_feedback for all to authenticated using (private.academy_can_manage_session(session_id)) with check (private.academy_can_manage_session(session_id));

create policy academy_invoices_read on public.academy_invoices for select to authenticated using (student_id = auth.uid() or private.academy_is_admin());
create policy academy_items_read on public.academy_invoice_items for select to authenticated using (exists(select 1 from public.academy_invoices i where i.id = invoice_id and (i.student_id = auth.uid() or private.academy_is_admin())));
create policy academy_adjustments_read on public.academy_invoice_adjustments for select to authenticated using (exists(select 1 from public.academy_invoices i where i.id = invoice_id and (i.student_id = auth.uid() or private.academy_is_admin())));
create policy academy_adjustments_admin on public.academy_invoice_adjustments for insert to authenticated with check (private.academy_is_admin() and created_by = auth.uid());
create policy academy_payments_read on public.academy_payments for select to authenticated using (student_id = auth.uid() or private.academy_is_admin());
create policy academy_allocations_read on public.academy_payment_allocations for select to authenticated using (exists(select 1 from public.academy_payments p where p.id = payment_id and (p.student_id = auth.uid() or private.academy_is_admin())));
create policy academy_audit_admin on public.academy_audit_log for select to authenticated using (private.academy_is_admin());

grant select on public.academy_settings, public.academy_profiles, public.academy_line_accounts, public.academy_sessions,
  public.academy_session_teachers, public.academy_registrations, public.academy_attendance, public.academy_products,
  public.academy_purchases, public.academy_lesson_topics, public.academy_kpis, public.academy_scores,
  public.academy_feedback, public.academy_invoices, public.academy_invoice_items, public.academy_invoice_adjustments,
  public.academy_payments, public.academy_payment_allocations, public.academy_audit_log to authenticated;
grant insert, update, delete on public.academy_settings, public.academy_sessions,
  public.academy_session_teachers, public.academy_registrations, public.academy_attendance, public.academy_products,
  public.academy_purchases, public.academy_lesson_topics, public.academy_kpis, public.academy_scores,
  public.academy_feedback to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('academy-payment-slips', 'academy-payment-slips', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy academy_slip_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'academy-payment-slips' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy academy_slip_read on storage.objects for select to authenticated using (
  bucket_id = 'academy-payment-slips' and ((storage.foldername(name))[1] = auth.uid()::text or private.academy_is_admin())
);
create policy academy_slip_delete_own on storage.objects for delete to authenticated using (
  bucket_id = 'academy-payment-slips' and (storage.foldername(name))[1] = auth.uid()::text
);

commit;
