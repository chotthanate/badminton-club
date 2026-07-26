import { supabase } from "./supabase.js";

function client() {
  if (!supabase) throw new Error("ยังไม่ได้ตั้งค่า Supabase");
  return supabase;
}

function throwIfError(error) {
  if (error) throw error;
}

export async function getAdminContexts(userId) {
  const { data, error } = await client()
    .from("club_members")
    .select("id, club_id, display_name, nickname, role, clubs!inner(id, name, line_group_id, is_test, default_friday_court_hourly_rate, default_saturday_court_hourly_rate, default_other_court_hourly_rate, default_shuttlecock_unit_price)")
    .eq("profile_id", userId)
    .eq("role", "admin")
    .eq("active", true)
    .order("created_at");
  throwIfError(error);
  return data || [];
}

export async function createClub({ name, ownerId }) {
  const { data, error } = await client()
    .from("clubs")
    .insert({ name: name.trim(), owner_id: ownerId })
    .select("id, name, line_group_id")
    .single();
  throwIfError(error);
  await seedDefaultExtraItems(data.id);
  return data;
}

export async function createTestClub({ ownerId }) {
  const { data, error } = await client()
    .from("clubs")
    .insert({
      name: "Headshot Badminton · ทดลอง",
      owner_id: ownerId,
      is_test: true,
    })
    .select("id, name, line_group_id, is_test")
    .single();
  throwIfError(error);
  await seedDefaultExtraItems(data.id);
  await seedTestMembers(data.id);
  return data;
}

export async function resetTestClub(clubId) {
  const { error: eventError } = await client().from("events").delete().eq("club_id", clubId);
  throwIfError(eventError);
  const { error: memberError } = await client().from("club_members")
    .delete()
    .eq("club_id", clubId)
    .neq("role", "admin");
  throwIfError(memberError);
  const { error: venueError } = await client().from("club_venues").delete().eq("club_id", clubId);
  throwIfError(venueError);
  const { error: itemError } = await client().from("extra_item_catalog").delete().eq("club_id", clubId);
  throwIfError(itemError);
  await seedDefaultExtraItems(clubId);
  await seedTestMembers(clubId);
}

export async function listClubEvents(clubId) {
  const { data, error } = await client()
    .from("events")
    .select("id, event_date, venue, status, starts_at, ends_at, created_at")
    .eq("club_id", clubId)
    .order("event_date", { ascending: false })
    .order("created_at", { ascending: false });
  throwIfError(error);
  return data || [];
}

export async function loadDashboard(clubId, eventId = null) {
  let eventQuery = client()
    .from("events")
    .select("*")
    .eq("club_id", clubId);
  if (eventId) {
    eventQuery = eventQuery.eq("id", eventId);
  } else {
    eventQuery = eventQuery
      .order("event_date", { ascending: false })
      .order("created_at", { ascending: false });
  }
  const { data: event, error: eventError } = await eventQuery
    .limit(1)
    .maybeSingle();
  throwIfError(eventError);

  const membersPromise = client()
    .from("club_members")
    .select("id, display_name, nickname, role, active, line_user_id, payment_exempt")
    .eq("club_id", clubId)
    .eq("active", true)
    .order("created_at");

  const venuesPromise = client().from("club_venues").select("id, name").eq("club_id", clubId).order("created_at", { ascending: false });
  const extraItemsPromise = client().from("extra_item_catalog").select("*").eq("club_id", clubId).eq("active", true).order("created_at");

  if (!event) {
    const [membersResult, venuesResult, extraItemsResult] = await Promise.all([membersPromise, venuesPromise, extraItemsPromise]);
    [membersResult, venuesResult, extraItemsResult].forEach((result) => throwIfError(result.error));
    return {
      event: null,
      members: membersResult.data || [],
      venues: venuesResult.data || [],
      extraItems: extraItemsResult.data || [],
    };
  }

  const [membersResult, courtsResult, signupsResult, attendanceResult, expensesResult, paymentsResult, paymentSlipsResult, auditResult, venuesResult, extraItemsResult, memberExtrasResult] = await Promise.all([
    membersPromise,
    client().from("event_courts").select("*").eq("event_id", event.id).order("position").order("created_at"),
    client().from("signups").select("*").eq("event_id", event.id).order("created_at"),
    client().from("attendance").select("*").eq("event_id", event.id),
    client().from("expenses").select("*").eq("event_id", event.id).order("created_at"),
    client().from("payments").select("*").eq("event_id", event.id),
    client().from("payment_slips").select("*").eq("club_id", clubId).eq("status", "pending").order("created_at", { ascending: false }),
    client().from("audit_logs").select("*").eq("event_id", event.id).order("created_at", { ascending: false }).limit(100),
    venuesPromise,
    extraItemsPromise,
    client().from("member_extra_charges").select("*").eq("event_id", event.id).order("created_at"),
  ]);

  [membersResult, courtsResult, signupsResult, attendanceResult, expensesResult, paymentsResult, paymentSlipsResult, auditResult, venuesResult, extraItemsResult, memberExtrasResult]
    .forEach((result) => throwIfError(result.error));

  return {
    event,
    members: membersResult.data || [],
    courts: courtsResult.data || [],
    signups: signupsResult.data || [],
    attendance: attendanceResult.data || [],
    expenses: expensesResult.data || [],
    payments: paymentsResult.data || [],
    paymentSlips: (paymentSlipsResult.data || []).filter((slip) =>
      (slip.payment_ids || []).some((paymentId) => (paymentsResult.data || []).some((payment) => payment.id === paymentId))),
    auditLogs: auditResult.data || [],
    venues: venuesResult.data || [],
    extraItems: extraItemsResult.data || [],
    memberExtras: memberExtrasResult.data || [],
  };
}

export async function createEvent({
  clubId,
  clubName,
  userId,
  eventDate,
  venue,
  startsAt = "21:00",
  endsAt = "00:00",
  courtHourlyRate = 200,
  shuttlecockUnitPrice = 95,
  courts = [],
}) {
  const { data, error } = await client()
    .from("events")
    .insert({
      club_id: clubId,
      title: `${clubName} ${eventDate}`,
      event_date: eventDate,
      venue: venue.trim(),
      starts_at: startsAt,
      ends_at: endsAt,
      court_hourly_rate: Math.max(0, Number(courtHourlyRate) || 0),
      shuttlecock_unit_price: Math.max(0, Number(shuttlecockUnitPrice) || 0),
      status: "draft",
      created_by: userId,
    })
    .select("*")
    .single();
  throwIfError(error);
  if (courts.length) {
    const { error: courtError } = await client().from("event_courts").insert(
      courts.map((court, position) => ({
        club_id: clubId,
        event_id: data.id,
        court_name: court.name,
        starts_at: court.startsAt,
        ends_at: court.endsAt,
        position,
      })),
    );
    throwIfError(courtError);
  }
  return data;
}

export async function updateEvent(eventId, patch) {
  const { error } = await client().from("events").update(patch).eq("id", eventId);
  throwIfError(error);
}

export async function updateEventDetails({ clubId, eventId, patch }) {
  await updateEvent(eventId, patch);
  if (patch.venue) await rememberVenue(clubId, patch.venue);
}

export async function replaceEventCourts({ clubId, eventId, courts }) {
  const { error: deleteError } = await client().from("event_courts").delete().eq("event_id", eventId);
  throwIfError(deleteError);
  if (!courts.length) return;
  const { error: insertError } = await client().from("event_courts").insert(
    courts.map((court, position) => ({
      club_id: clubId,
      event_id: eventId,
      court_name: court.name,
      starts_at: court.startsAt,
      ends_at: court.endsAt,
      position,
    })),
  );
  throwIfError(insertError);
  await syncEventTimes(eventId);
}

export async function updateEventPriceAndDefault({
  clubId,
  eventId,
  eventDate,
  priceType,
  value,
}) {
  const amount = Math.max(0, Number(value) || 0);
  if (priceType === "shuttlecock") {
    const [eventResult, clubResult] = await Promise.all([
      client().from("events").update({ shuttlecock_unit_price: amount }).eq("id", eventId),
      client().from("clubs").update({ default_shuttlecock_unit_price: amount }).eq("id", clubId),
    ]);
    throwIfError(eventResult.error);
    throwIfError(clubResult.error);
    return;
  }
  const weekday = new Date(`${eventDate}T12:00:00`).getDay();
  const defaultColumn = weekday === 5
    ? "default_friday_court_hourly_rate"
    : weekday === 6
    ? "default_saturday_court_hourly_rate"
    : "default_other_court_hourly_rate";
  const [eventResult, clubResult] = await Promise.all([
    client().from("events").update({ court_hourly_rate: amount }).eq("id", eventId),
    client().from("clubs").update({ [defaultColumn]: amount }).eq("id", clubId),
  ]);
  throwIfError(eventResult.error);
  throwIfError(clubResult.error);
}

export async function deleteCompletedEvent(eventId) {
  const { data: event, error: eventError } = await client().from("events")
    .select("id, club_id, status")
    .eq("id", eventId)
    .single();
  throwIfError(eventError);
  if (!["draft", "closed"].includes(event.status)) {
    throw new Error("ลบได้เฉพาะรอบที่กำลังเตรียมหรือรอบที่จบแล้ว");
  }

  if (event.status === "draft") {
    const { error } = await client().from("events").delete().eq("id", eventId);
    throwIfError(error);
    return;
  }

  const [signupsResult, paymentsResult, membersResult] = await Promise.all([
    client().from("signups").select("member_id").eq("event_id", eventId).eq("status", "coming"),
    client().from("payments").select("member_id, paid_at").eq("event_id", eventId),
    client().from("club_members").select("id, payment_exempt").eq("club_id", event.club_id),
  ]);
  throwIfError(signupsResult.error);
  throwIfError(paymentsResult.error);
  throwIfError(membersResult.error);
  const paidMemberIds = new Set((paymentsResult.data || []).filter((payment) => payment.paid_at).map((payment) => payment.member_id));
  const exemptMemberIds = new Set((membersResult.data || []).filter((member) => member.payment_exempt).map((member) => member.id));
  const unpaidPlayers = (signupsResult.data || []).filter((signup) =>
    !paidMemberIds.has(signup.member_id) && !exemptMemberIds.has(signup.member_id));
  if (unpaidPlayers.length) {
    throw new Error(`รอบนี้ยังเก็บเงินไม่ครบ ${unpaidPlayers.length} คน จึงยังลบไม่ได้`);
  }

  const { error } = await client().from("events").delete().eq("id", eventId);
  throwIfError(error);
}

export async function addCourt({ clubId, eventId, courtName, startsAt, endsAt }) {
  const { error } = await client().from("event_courts").insert({
    club_id: clubId,
    event_id: eventId,
    court_name: courtName.trim(),
    starts_at: startsAt,
    ends_at: endsAt,
  });
  throwIfError(error);
  await syncEventTimes(eventId);
}

export async function updateCourt(courtId, eventId, patch) {
  const { error } = await client().from("event_courts").update(patch).eq("id", courtId);
  throwIfError(error);
  await syncEventTimes(eventId);
}

export async function removeCourt(courtId, eventId) {
  const { error } = await client().from("event_courts").delete().eq("id", courtId);
  throwIfError(error);
  await syncEventTimes(eventId);
}

async function syncEventTimes(eventId) {
  const { data, error } = await client().from("event_courts")
    .select("starts_at, ends_at")
    .eq("event_id", eventId);
  throwIfError(error);
  if (!data?.length) return;
  const startsAt = data.map((row) => row.starts_at.slice(0, 5)).sort()[0];
  const endMinutes = data.map((row) => timeOnEventTimeline(row.ends_at.slice(0, 5), startsAt));
  const latest = Math.max(...endMinutes) % (24 * 60);
  const endsAt = `${String(Math.floor(latest / 60)).padStart(2, "0")}:${String(latest % 60).padStart(2, "0")}`;
  await updateEvent(eventId, { starts_at: startsAt, ends_at: endsAt });
}

function timeOnEventTimeline(time, eventStart) {
  const [hour, minute] = time.split(":").map(Number);
  const [startHour, startMinute] = eventStart.split(":").map(Number);
  let total = hour * 60 + minute;
  if (total <= startHour * 60 + startMinute) total += 24 * 60;
  return total;
}

export async function prepareEventForLine(eventId) {
  return invokeLineBot({ action: "publish_event", eventId });
}

export async function changeAdminPassword(password) {
  return invokeLineBot({ action: "change_admin_password", password });
}

async function invokeLineBot(body) {
  const { data, error } = await client().functions.invoke("line-bot", { body });
  if (error) {
    let message = error.message;
    try {
      const details = await error.context?.json();
      message = details?.error || message;
    } catch {
      // Keep the SDK error when the response body is unavailable.
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function addLineMember({ clubId, displayName, lineUserId = null }) {
  const { data, error } = await client().from("club_members")
    .insert({
      club_id: clubId,
      display_name: displayName.trim(),
      nickname: displayName.trim(),
      line_user_id: lineUserId?.trim() || null,
      role: "member",
    })
    .select("id, display_name, nickname, line_user_id")
    .single();
  throwIfError(error);
  return data;
}

export async function updateClubMember(memberId, { nickname, displayName, paymentExempt = false }) {
  const { error } = await client().from("club_members")
    .update({
      nickname: nickname.trim(),
      display_name: displayName.trim(),
      payment_exempt: Boolean(paymentExempt),
    })
    .eq("id", memberId);
  throwIfError(error);
}

export async function removeParticipant({ eventId, memberId }) {
  const tables = ["member_extra_charges", "payments", "attendance", "signups"];
  for (const table of tables) {
    const { error } = await client().from(table)
      .delete()
      .eq("event_id", eventId)
      .eq("member_id", memberId);
    throwIfError(error);
  }
}

export async function updateSignupArrival({ eventId, memberId, arrivalTime }) {
  const { error } = await client().from("signups")
    .update({ arrival_time: arrivalTime })
    .eq("event_id", eventId)
    .eq("member_id", memberId)
    .eq("status", "coming");
  throwIfError(error);
}

export async function updateSignup({ clubId, eventId, memberId, status, arrivalTime = null }) {
  const { error } = await client().from("signups").upsert({
    club_id: clubId,
    event_id: eventId,
    member_id: memberId,
    status,
    arrival_time: status === "coming" ? arrivalTime : null,
  }, { onConflict: "event_id,member_id" });
  throwIfError(error);
}

export async function updateAttendance({ clubId, eventId, memberId, patch }) {
  const { error } = await client().from("attendance").upsert({
    club_id: clubId,
    event_id: eventId,
    member_id: memberId,
    ...patch,
  }, { onConflict: "event_id,member_id" });
  throwIfError(error);
}

export async function addExpense({ clubId, eventId, userId, label, amount }) {
  const { error } = await client().from("expenses").insert({
    club_id: clubId,
    event_id: eventId,
    category: "other",
    label: label.trim(),
    amount: Math.max(0, Number(amount) || 0),
    created_by: userId,
  });
  throwIfError(error);
}

export async function updateExpense(expenseId, amount) {
  const { error } = await client().from("expenses")
    .update({ amount: Math.max(0, Number(amount) || 0) })
    .eq("id", expenseId);
  throwIfError(error);
}

export async function addExtraCatalogItem({ clubId, name, price }) {
  const { error } = await client().from("extra_item_catalog").insert({
    club_id: clubId,
    name: name.trim(),
    price: Math.max(0, Number(price) || 0),
  });
  throwIfError(error);
}

export async function updateExtraCatalogItem(itemId, price) {
  const { error } = await client().from("extra_item_catalog")
    .update({ price: Math.max(0, Number(price) || 0) })
    .eq("id", itemId);
  throwIfError(error);
}

export async function removeExtraCatalogItem(itemId) {
  const { error } = await client().from("extra_item_catalog").delete().eq("id", itemId);
  throwIfError(error);
}

export async function addMemberExtraCharge({ clubId, eventId, memberId, item, userId }) {
  const { error } = await client().from("member_extra_charges").insert({
    club_id: clubId,
    event_id: eventId,
    member_id: memberId,
    item_name: item.name,
    unit_price: item.price,
    quantity: 1,
    created_by: userId,
  });
  throwIfError(error);
}

export async function removeMemberExtraCharge(chargeId) {
  const { error } = await client().from("member_extra_charges").delete().eq("id", chargeId);
  throwIfError(error);
}

async function rememberVenue(clubId, venue) {
  const name = venue.trim();
  if (!name) return;
  const { error } = await client().from("club_venues").upsert(
    { club_id: clubId, name },
    { onConflict: "club_id,name", ignoreDuplicates: true },
  );
  throwIfError(error);
}

async function seedDefaultExtraItems(clubId) {
  const defaults = [
    { club_id: clubId, name: "น้ำขวดเล็ก", price: 10 },
    { club_id: clubId, name: "น้ำขวดใหญ่", price: 20 },
    { club_id: clubId, name: "สปอนเซอร์", price: 15 },
  ];
  const { error } = await client().from("extra_item_catalog").upsert(defaults, { onConflict: "club_id,name" });
  throwIfError(error);
}

async function seedTestMembers(clubId) {
  const members = [
    { club_id: clubId, display_name: "LINE Demo One", nickname: "เมย์ทดลอง", role: "member" },
    { club_id: clubId, display_name: "LINE Demo Two", nickname: "แจ็คทดลอง", role: "member" },
    { club_id: clubId, display_name: "LINE Demo Three", nickname: "บอยทดลอง", role: "member" },
  ];
  const { error } = await client().from("club_members").insert(members);
  throwIfError(error);
}

export async function setPayment({ clubId, eventId, memberId, amount, sharedAmount, extrasAmount, shuttlecockCount, paid, userId }) {
  const { data: existing, error: existingError } = await client().from("payments")
    .select("amount, billed_at, calculated_amount")
    .eq("event_id", eventId)
    .eq("member_id", memberId)
    .maybeSingle();
  throwIfError(existingError);
  const finalAmount = existing?.billed_at ? Number(existing.amount) : Math.max(0, Number(amount) || 0);
  const { error } = await client().from("payments").upsert({
    club_id: clubId,
    event_id: eventId,
    member_id: memberId,
    amount: finalAmount,
    calculated_amount: existing?.billed_at
      ? Math.max(0, Number(existing.calculated_amount) || 0)
      : Math.max(0, Number(amount) || 0),
    billed_at: existing?.billed_at || new Date().toISOString(),
    paid_at: paid ? new Date().toISOString() : null,
    payment_status: paid ? "paid" : "awaiting",
    paid_source: paid ? "admin" : null,
    shared_amount: Math.max(0, Number(sharedAmount) || 0),
    extras_amount: Math.max(0, Number(extrasAmount) || 0),
    shuttlecock_count_snapshot: Math.max(0, Number(shuttlecockCount) || 0),
    recorded_by: userId,
  }, { onConflict: "event_id,member_id" });
  throwIfError(error);
}

export async function finalizeMemberBill({
  clubId,
  eventId,
  memberId,
  calculatedAmount,
  billedAmount,
  sharedAmount,
  extrasAmount,
  shuttlecockCount,
  userId,
}) {
  const finalCalculated = Math.max(0, Number(calculatedAmount) || 0);
  const finalBilled = Math.max(0, Number(billedAmount) || 0);
  const { error } = await client().from("payments").upsert({
    club_id: clubId,
    event_id: eventId,
    member_id: memberId,
    amount: finalBilled,
    calculated_amount: finalCalculated,
    billed_at: new Date().toISOString(),
    paid_at: null,
    payment_status: "awaiting",
    paid_source: null,
    transferred_amount: null,
    overpayment_amount: 0,
    shared_amount: Math.max(0, Number(sharedAmount) || 0),
    extras_amount: Math.max(0, Number(extrasAmount) || 0),
    shuttlecock_count_snapshot: Math.max(0, Number(shuttlecockCount) || 0),
    recorded_by: userId,
  }, { onConflict: "event_id,member_id" });
  throwIfError(error);
}

export async function reviewPaymentSlip({ slip, approved, userId }) {
  const paymentIds = Array.isArray(slip.payment_ids) ? slip.payment_ids : [];
  if (!paymentIds.length) throw new Error("สลิปนี้ไม่มีรายการชำระเงิน");
  const now = new Date().toISOString();
  if (approved) {
    const excess = Math.max(0, Number(slip.transferred_amount || 0) - Number(slip.expected_amount || 0));
    for (let index = 0; index < paymentIds.length; index += 1) {
      const { error: paymentError } = await client().from("payments").update({
        paid_at: now,
        payment_status: "paid",
        paid_source: "slip_review",
        transferred_amount: index === 0 ? slip.transferred_amount : null,
        overpayment_amount: index === 0 ? excess : 0,
      }).eq("id", paymentIds[index]).is("paid_at", null);
      throwIfError(paymentError);
    }
  } else {
    const { error: paymentError } = await client().from("payments").update({
      payment_status: "awaiting",
    }).in("id", paymentIds).is("paid_at", null);
    throwIfError(paymentError);
  }
  const { error: slipError } = await client().from("payment_slips").update({
    status: approved ? "auto_paid" : "rejected",
    reviewed_by: userId,
    reviewed_at: now,
  }).eq("id", slip.id).eq("status", "pending");
  throwIfError(slipError);
}

export async function getPaymentSlipImageUrl(storagePath) {
  if (!storagePath) throw new Error("สลิปนี้ไม่มีรูปสำหรับเปิดดู");
  const { data, error } = await client().storage.from("payment-slips")
    .createSignedUrl(storagePath, 10 * 60);
  throwIfError(error);
  if (!data?.signedUrl) throw new Error("เปิดรูปสลิปไม่สำเร็จ");
  return data.signedUrl;
}

export async function finishEvent({ clubId, eventId, rows, shuttlecockCount, userId }) {
  const { data: existingPayments, error: existingError } = await client()
    .from("payments")
    .select("member_id, paid_at, billed_at")
    .eq("event_id", eventId);
  throwIfError(existingError);
  const lockedMemberIds = new Set((existingPayments || [])
    .filter((payment) => payment.paid_at || payment.billed_at)
    .map((payment) => payment.member_id));
  const rowsToSave = rows
    .filter((row) => !lockedMemberIds.has(row.memberId))
    .map((row) => ({
      club_id: clubId,
      event_id: eventId,
      member_id: row.memberId,
      amount: Math.max(0, Number(row.roundedDue) || 0),
      calculated_amount: Math.max(0, Number(row.roundedDue) || 0),
      billed_at: row.paymentExempt ? new Date().toISOString() : null,
      paid_at: row.paymentExempt ? new Date().toISOString() : null,
      payment_status: row.paymentExempt ? "paid" : "draft",
      paid_source: row.paymentExempt ? "exempt" : null,
      shared_amount: Math.max(0, Number(row.sharedDue) || 0),
      extras_amount: Math.max(0, Number(row.extraAmount) || 0),
      shuttlecock_count_snapshot: Math.max(0, Number(shuttlecockCount) || 0),
      recorded_by: userId,
    }));
  if (rowsToSave.length) {
    const { error: paymentError } = await client()
      .from("payments")
      .upsert(rowsToSave, { onConflict: "event_id,member_id" });
    throwIfError(paymentError);
  }
  await updateEvent(eventId, { status: "closed" });
}

export async function recordAudit({ clubId, eventId = null, userId, action, details = {} }) {
  const { error } = await client().from("audit_logs").insert({
    club_id: clubId,
    event_id: eventId,
    actor_id: userId,
    action,
    details,
  });
  throwIfError(error);
}
