import { supabase } from "./supabase.js";

function client() {
  if (!supabase) throw new Error("ยังไม่ได้ตั้งค่า Supabase");
  return supabase;
}

function throwIfError(error) {
  if (error) throw error;
}

export async function getAdminContext(userId) {
  const { data, error } = await client()
    .from("club_members")
    .select("id, club_id, display_name, nickname, role, clubs!inner(id, name, line_group_id)")
    .eq("profile_id", userId)
    .eq("role", "admin")
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  throwIfError(error);
  return data;
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
    .select("id, display_name, nickname, role, active, line_user_id")
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

  const [membersResult, courtsResult, signupsResult, attendanceResult, expensesResult, paymentsResult, auditResult, venuesResult, extraItemsResult, memberExtrasResult] = await Promise.all([
    membersPromise,
    client().from("event_courts").select("*").eq("event_id", event.id).order("position").order("created_at"),
    client().from("signups").select("*").eq("event_id", event.id).order("created_at"),
    client().from("attendance").select("*").eq("event_id", event.id),
    client().from("expenses").select("*").eq("event_id", event.id).order("created_at"),
    client().from("payments").select("*").eq("event_id", event.id),
    client().from("audit_logs").select("*").eq("event_id", event.id).order("created_at", { ascending: false }).limit(20),
    venuesPromise,
    extraItemsPromise,
    client().from("member_extra_charges").select("*").eq("event_id", event.id).order("created_at"),
  ]);

  [membersResult, courtsResult, signupsResult, attendanceResult, expensesResult, paymentsResult, auditResult, venuesResult, extraItemsResult, memberExtrasResult]
    .forEach((result) => throwIfError(result.error));

  return {
    event,
    members: membersResult.data || [],
    courts: courtsResult.data || [],
    signups: signupsResult.data || [],
    attendance: attendanceResult.data || [],
    expenses: expensesResult.data || [],
    payments: paymentsResult.data || [],
    auditLogs: auditResult.data || [],
    venues: venuesResult.data || [],
    extraItems: extraItemsResult.data || [],
    memberExtras: memberExtrasResult.data || [],
  };
}

export async function createEvent({ clubId, clubName, userId, eventDate, venue, courtName, startsAt, endsAt }) {
  const { data, error } = await client()
    .from("events")
    .insert({
      club_id: clubId,
      title: `${clubName} ${eventDate}`,
      event_date: eventDate,
      venue: venue.trim(),
      starts_at: startsAt,
      ends_at: endsAt,
      status: "draft",
      created_by: userId,
    })
    .select("*")
    .single();
  throwIfError(error);
  await rememberVenue(clubId, venue);
  await addCourt({
    clubId,
    eventId: data.id,
    courtName,
    startsAt,
    endsAt,
  });
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

export async function publishEventToLine(eventId) {
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
  const { error } = await client().from("club_venues").upsert({ club_id: clubId, name }, { onConflict: "club_id,name" });
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

export async function setPayment({ clubId, eventId, memberId, amount, sharedAmount, extrasAmount, shuttlecockCount, paid, userId }) {
  const { error } = await client().from("payments").upsert({
    club_id: clubId,
    event_id: eventId,
    member_id: memberId,
    amount,
    paid_at: paid ? new Date().toISOString() : null,
    shared_amount: paid ? Math.max(0, Number(sharedAmount) || 0) : null,
    extras_amount: paid ? Math.max(0, Number(extrasAmount) || 0) : null,
    shuttlecock_count_snapshot: paid ? Math.max(0, Number(shuttlecockCount) || 0) : null,
    recorded_by: userId,
  }, { onConflict: "event_id,member_id" });
  throwIfError(error);
}

export async function finishEvent({ clubId, eventId, rows, shuttlecockCount, userId }) {
  const { data: existingPayments, error: existingError } = await client()
    .from("payments")
    .select("member_id, paid_at")
    .eq("event_id", eventId);
  throwIfError(existingError);
  const paidMemberIds = new Set((existingPayments || [])
    .filter((payment) => payment.paid_at)
    .map((payment) => payment.member_id));
  const unpaidRows = rows
    .filter((row) => !paidMemberIds.has(row.memberId))
    .map((row) => ({
      club_id: clubId,
      event_id: eventId,
      member_id: row.memberId,
      amount: Math.max(0, Number(row.roundedDue) || 0),
      paid_at: null,
      shared_amount: Math.max(0, Number(row.sharedDue) || 0),
      extras_amount: Math.max(0, Number(row.extraAmount) || 0),
      shuttlecock_count_snapshot: Math.max(0, Number(shuttlecockCount) || 0),
      recorded_by: userId,
    }));
  if (unpaidRows.length) {
    const { error: paymentError } = await client()
      .from("payments")
      .upsert(unpaidRows, { onConflict: "event_id,member_id" });
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
