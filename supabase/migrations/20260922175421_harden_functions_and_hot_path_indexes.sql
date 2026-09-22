-- Browser clients must sign in before calling any SECURITY DEFINER RPC. Function
-- bodies still perform their existing club/admin/operator authorization checks.
do $$
declare
  secured_function record;
begin
  for secured_function in
    select p.oid::regprocedure as signature, p.prorettype = 'trigger'::regtype as is_trigger
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon', secured_function.signature);
    if secured_function.is_trigger then
      execute format('revoke execute on function %s from authenticated', secured_function.signature);
    end if;
  end loop;
end
$$;

-- These match the event history and outstanding-payment queries used after
-- saves, avoiding table scans as operational history grows.
create index if not exists audit_logs_event_created_idx
  on public.audit_logs (event_id, created_at desc);

create index if not exists payments_outstanding_club_idx
  on public.payments (club_id, admin_confirmed_at asc)
  where admin_confirmed_at is not null
    and paid_at is null
    and payment_status in ('awaiting', 'review');
