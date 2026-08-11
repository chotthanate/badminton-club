alter table public.events
  drop constraint if exists events_billing_model_check;

alter table public.events
  add constraint events_billing_model_check
    check (billing_model in ('legacy', 'time_segmented', 'per_round'));

comment on column public.events.billing_model is
  'legacy preserves historical rounds; time_segmented allocates shared costs by presence intervals; per_round allocates shared costs by completed player-game appearances.';

create or replace function public.prevent_locked_billing_model_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.billing_model is distinct from new.billing_model
    and exists (
      select 1
      from public.payments payment
      where payment.event_id = old.id
    ) then
    raise exception 'เปลี่ยนวิธีคิดเงินไม่ได้ เนื่องจากรอบนี้เริ่มบันทึกยอดแล้ว';
  end if;
  return new;
end;
$$;

drop trigger if exists events_prevent_locked_billing_model_change on public.events;
create trigger events_prevent_locked_billing_model_change
before update of billing_model on public.events
for each row execute function public.prevent_locked_billing_model_change();
