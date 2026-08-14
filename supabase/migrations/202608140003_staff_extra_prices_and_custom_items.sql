-- Staff may see prices for water/snack operations only, without other billing data.

create or replace function public.load_staff_player_operations(target_club_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare target_event_id uuid;
begin
  if not public.is_club_operator(target_club_id) then
    raise exception 'ไม่มีสิทธิ์เปิดข้อมูลปฏิบัติงาน';
  end if;

  select event.id into target_event_id
  from public.events event
  where event.club_id = target_club_id and event.status = 'open'
  order by event.event_date desc, event.created_at desc
  limit 1;

  if target_event_id is null then
    return jsonb_build_object('extraItems', '[]'::jsonb, 'memberExtras', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'extraItems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'name', item.name,
        'price', item.price
      ) order by item.created_at)
      from public.extra_item_catalog item
      where item.club_id = target_club_id and item.active
    ), '[]'::jsonb),
    'memberExtras', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', charge.id,
        'member_id', charge.member_id,
        'item_name', charge.item_name,
        'unit_price', charge.unit_price,
        'quantity', charge.quantity,
        'created_at', charge.created_at
      ) order by charge.created_at)
      from public.member_extra_charges charge
      where charge.event_id = target_event_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.operator_add_custom_member_extra(
  target_event_id uuid,
  target_member_id uuid,
  next_item_name text,
  next_unit_price numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  saved_charge_id uuid;
  clean_item_name text := trim(next_item_name);
begin
  select event.club_id into target_club_id
  from public.events event
  where event.id = target_event_id and event.status = 'open';
  if target_club_id is null or not public.is_club_operator(target_club_id) then
    raise exception 'เพิ่มน้ำหรือขนมได้เฉพาะรอบที่เปิดอยู่';
  end if;
  if clean_item_name is null or char_length(clean_item_name) < 1 or char_length(clean_item_name) > 80 then
    raise exception 'กรุณากรอกชื่อรายการ';
  end if;
  if next_unit_price is null or next_unit_price < 0 or next_unit_price > 100000 then
    raise exception 'ราคาต้องอยู่ระหว่าง 0 ถึง 100,000 บาท';
  end if;
  if not exists (
    select 1 from public.signups
    where event_id = target_event_id and member_id = target_member_id and status = 'coming'
  ) then
    raise exception 'ไม่พบผู้เล่นในรอบนี้';
  end if;
  if exists (
    select 1 from public.payments
    where event_id = target_event_id and member_id = target_member_id and billed_at is not null
  ) then
    raise exception 'เพิ่มรายการไม่ได้ เพราะสรุปยอดของผู้เล่นแล้ว';
  end if;

  insert into public.member_extra_charges (
    club_id, event_id, member_id, item_name, unit_price, quantity, created_by
  ) values (
    target_club_id, target_event_id, target_member_id, clean_item_name, next_unit_price, 1, auth.uid()
  ) returning id into saved_charge_id;

  insert into public.audit_logs (club_id, event_id, actor_id, action, details)
  values (
    target_club_id,
    target_event_id,
    auth.uid(),
    'เพิ่มน้ำหรือขนมแบบกำหนดเองโดยสตาฟ',
    jsonb_build_object(
      'member_id', target_member_id,
      'item_name', clean_item_name,
      'unit_price', next_unit_price,
      'charge_id', saved_charge_id
    )
  );
  return saved_charge_id;
end;
$$;

revoke all on function public.operator_add_custom_member_extra(uuid, uuid, text, numeric) from public;
grant execute on function public.operator_add_custom_member_extra(uuid, uuid, text, numeric) to authenticated;
