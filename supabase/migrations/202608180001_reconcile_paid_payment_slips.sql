create or replace function public.settle_payment_slip(
  target_slip_id uuid,
  approve boolean,
  settlement_source text default 'slip_review'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_slip public.payment_slips%rowtype;
  selected_count integer;
  selected_total numeric(12, 2);
  selected_invalid_count integer;
  selected_paid_count integer;
  selected_member_ids uuid[];
  expected_member_ids uuid[];
  paid_at_value timestamptz := now();
  caller_role text := coalesce((select auth.role()), '');
begin
  select *
  into target_slip
  from public.payment_slips
  where id = target_slip_id
  for update;

  if not found then
    raise exception 'ไม่พบสลิปที่ต้องการตรวจสอบ';
  end if;

  if caller_role <> 'service_role'
    and not (select public.is_club_admin(target_slip.club_id)) then
    raise exception 'Admin only';
  end if;

  if settlement_source not in ('slip_auto', 'slip_review') then
    raise exception 'แหล่งที่มาของการชำระเงินไม่ถูกต้อง';
  end if;

  if settlement_source = 'slip_auto' and caller_role <> 'service_role' then
    raise exception 'ระบบอัตโนมัติเท่านั้น';
  end if;

  if target_slip.status <> 'pending' then
    raise exception 'สลิปนี้ถูกตรวจสอบไปแล้ว';
  end if;

  perform 1
  from public.payments payment
  where payment.id = any(target_slip.payment_ids)
  order by payment.id
  for update;

  select
    count(*),
    coalesce(sum(payment.amount), 0),
    count(*) filter (
      where payment.club_id <> target_slip.club_id
        or payment.billed_at is null
    ),
    count(*) filter (where payment.paid_at is not null),
    array_agg(distinct payment.member_id order by payment.member_id)
  into selected_count, selected_total, selected_invalid_count, selected_paid_count, selected_member_ids
  from public.payments payment
  where payment.id = any(target_slip.payment_ids);

  select array_agg(distinct member_id order by member_id)
  into expected_member_ids
  from unnest(target_slip.beneficiary_member_ids) as selected(member_id);

  if approve and (
    selected_count <> cardinality(target_slip.payment_ids)
    or selected_invalid_count > 0
    or selected_member_ids is distinct from expected_member_ids
    or not (target_slip.beneficiary_member_id = any(expected_member_ids))
  ) then
    raise exception 'ยอดที่เลือกมีการเปลี่ยนแปลง กรุณาตรวจสอบใหม่';
  end if;

  if approve and selected_paid_count > 0 and selected_paid_count < selected_count then
    raise exception 'รายการนี้ชำระแล้วเพียงบางรอบ กรุณาตรวจสอบก่อนอนุมัติ';
  end if;

  if approve and selected_paid_count = 0
    and abs(selected_total - target_slip.expected_amount) >= 0.01 then
    raise exception 'ยอดที่เลือกมีการเปลี่ยนแปลง กรุณาตรวจสอบใหม่';
  end if;

  if approve and selected_paid_count = 0 then
    update public.payments payment
    set paid_at = paid_at_value,
        payment_status = 'paid',
        paid_source = settlement_source,
        transferred_amount = case
          when payment.id = target_slip.payment_ids[1] then target_slip.transferred_amount
          else null
        end,
        overpayment_amount = case
          when payment.id = target_slip.payment_ids[1]
            then greatest(0, coalesce(target_slip.transferred_amount, 0) - target_slip.expected_amount)
          else 0
        end
    where payment.id = any(target_slip.payment_ids);
  elsif not approve then
    update public.payments payment
    set payment_status = 'awaiting'
    where payment.id = any(target_slip.payment_ids)
      and payment.paid_at is null;
  end if;

  update public.payment_slips
  set status = case when approve then 'auto_paid' else 'rejected' end,
      reviewed_by = case when caller_role = 'service_role' then null else (select auth.uid()) end,
      reviewed_at = paid_at_value,
      review_reason = case
        when approve and selected_paid_count = selected_count
          then 'รายการชำระเงินถูกบันทึกว่ารับเงินแล้วก่อนตรวจสลิป'
        when approve then review_reason
        else coalesce(review_reason, 'แอดมินปฏิเสธสลิป')
      end
  where id = target_slip_id;

  return jsonb_build_object(
    'ok', true,
    'status', case when approve then 'auto_paid' else 'rejected' end,
    'paymentCount', selected_count,
    'memberCount', cardinality(selected_member_ids),
    'amount', selected_total,
    'alreadyPaid', approve and selected_paid_count = selected_count
  );
end;
$$;

revoke all on function public.settle_payment_slip(uuid, boolean, text) from public, anon;
grant execute on function public.settle_payment_slip(uuid, boolean, text) to authenticated, service_role;

-- Old slips can remain pending when an admin marked every linked payment as paid
-- from the payment page before reviewing the slip. Close only fully paid sets;
-- partially paid or missing sets stay visible for manual investigation.
update public.payment_slips slip
set status = 'auto_paid',
    reviewed_at = coalesce(slip.reviewed_at, now()),
    review_reason = 'รายการชำระเงินถูกบันทึกว่ารับเงินแล้วก่อนตรวจสลิป'
where slip.status = 'pending'
  and cardinality(slip.payment_ids) > 0
  and (
    select count(*)
    from public.payments payment
    where payment.id = any(slip.payment_ids)
      and payment.club_id = slip.club_id
      and payment.paid_at is not null
  ) = cardinality(slip.payment_ids);

-- A deleted event removes its payment rows, leaving an old slip with nothing
-- that can be approved or restored. Archive those orphaned records so they do
-- not remain permanently in the review queue.
update public.payment_slips slip
set status = 'rejected',
    reviewed_at = coalesce(slip.reviewed_at, now()),
    review_reason = 'รอบที่ผูกกับสลิปถูกลบไปแล้ว จึงปิดรายการเก่าอัตโนมัติ'
where slip.status = 'pending'
  and not exists (
    select 1
    from public.payments payment
    where payment.id = any(slip.payment_ids)
  );
