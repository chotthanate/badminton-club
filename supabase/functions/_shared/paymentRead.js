import { buildPaymentExtraRequests } from "./paymentExtras.js";

// Keep both URLs and response pages bounded as the club history grows.
export async function readPaymentPages(queryFactory, pageSize = 500) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await queryFactory().range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < pageSize) return rows;
  }
}

export async function readPaymentBatches(values, readBatch) {
  const chunks = [];
  for (let index = 0; index < values.length; index += 40) chunks.push(values.slice(index, index + 40));
  const rows = [];
  for (let index = 0; index < chunks.length; index += 6) {
    const results = await Promise.all(chunks.slice(index, index + 6).map(readBatch));
    for (const result of results) rows.push(...result);
  }
  return rows;
}

export async function loadPaymentBalances(admin, clubId, report = () => {}) {
  const clubMembers = await readPaymentPages(() => admin.from("club_members")
    .select("id, nickname, display_name, line_user_id").eq("club_id", clubId).eq("active", true)
    .order("created_at").order("id"));
  const duePayments = await readPaymentBatches(clubMembers.map((member) => member.id), (ids) => readPaymentPages(() => admin.from("payments")
    .select("id, member_id, event_id, amount, extras_amount, payment_status, paid_at, events!inner(event_date, venue)")
    .eq("club_id", clubId).in("member_id", ids).not("admin_confirmed_at", "is", null)
    .in("payment_status", ["awaiting", "review"]).is("paid_at", null).order("created_at").order("id")));
  // A multi-payment slip may match more than one batch. Deduplicate before choosing the newest.
  const slipRows = await readPaymentBatches(duePayments.map((payment) => payment.id), (ids) => readPaymentPages(() => admin.from("payment_slips")
    .select("id, payment_ids, status, created_at, review_reason").eq("club_id", clubId)
    .overlaps("payment_ids", ids).order("created_at", { ascending: false }).order("id")));
  const slips = [...new Map(slipRows.map((slip) => [slip.id, slip])).values()]
    .sort((left, right) => right.created_at.localeCompare(left.created_at) || left.id.localeCompare(right.id));
  const dueExtras = [];
  let extrasUnavailable = false;
  let firstExtraError;
  const plans = buildPaymentExtraRequests(duePayments);
  for (let index = 0; index < plans.length; index += 6) {
    const results = await Promise.allSettled(plans.slice(index, index + 6).map(({ eventId, memberIds }) => readPaymentPages(() => admin
      .from("member_extra_charges").select("id, event_id, member_id, item_name, unit_price, quantity, created_at")
      .eq("club_id", clubId).eq("event_id", eventId).in("member_id", memberIds).order("created_at").order("id"))));
    for (const result of results) {
      if (result.status === "fulfilled") dueExtras.push(...result.value);
      else {
        extrasUnavailable = true;
        firstExtraError ??= result.reason;
      }
    }
  }
  if (extrasUnavailable) report("extras_unavailable", firstExtraError);
  return { clubMembers, duePayments, slips, dueExtras, extrasUnavailable };
}
