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
    .select("id, club_id, display_name, role, clubs!inner(id, name, line_group_id)")
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
  return data;
}

export async function loadDashboard(clubId) {
  const { data: event, error: eventError } = await client()
    .from("events")
    .select("*")
    .eq("club_id", clubId)
    .order("event_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfError(eventError);

  const membersPromise = client()
    .from("club_members")
    .select("id, display_name, role, active, line_user_id")
    .eq("club_id", clubId)
    .eq("active", true)
    .order("created_at");

  if (!event) {
    const { data: members, error } = await membersPromise;
    throwIfError(error);
    return { event: null, members: members || [] };
  }

  const [membersResult, courtsResult, signupsResult, attendanceResult, expensesResult, paymentsResult, auditResult] = await Promise.all([
    membersPromise,
    client().from("event_courts").select("*").eq("event_id", event.id).order("position").order("created_at"),
    client().from("signups").select("*").eq("event_id", event.id),
    client().from("attendance").select("*").eq("event_id", event.id),
    client().from("expenses").select("*").eq("event_id", event.id).order("created_at"),
    client().from("payments").select("*").eq("event_id", event.id),
    client().from("audit_logs").select("*").eq("event_id", event.id).order("created_at", { ascending: false }).limit(20),
  ]);

  [membersResult, courtsResult, signupsResult, attendanceResult, expensesResult, paymentsResult, auditResult]
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
  const { data, error } = await client().functions.invoke("line-bot", {
    body: { action: "publish_event", eventId },
  });
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
      line_user_id: lineUserId?.trim() || null,
      role: "member",
    })
    .select("id, display_name, line_user_id")
    .single();
  throwIfError(error);
  return data;
}

export async function removeParticipant({ eventId, memberId }) {
  const tables = ["payments", "attendance", "signups"];
  for (const table of tables) {
    const { error } = await client().from(table)
      .delete()
      .eq("event_id", eventId)
      .eq("member_id", memberId);
    throwIfError(error);
  }
}

export async function updateSignup({ clubId, eventId, memberId, status }) {
  const { error } = await client().from("signups").upsert({
    club_id: clubId,
    event_id: eventId,
    member_id: memberId,
    status,
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

export async function setPayment({ clubId, eventId, memberId, amount, paid, userId }) {
  const { error } = await client().from("payments").upsert({
    club_id: clubId,
    event_id: eventId,
    member_id: memberId,
    amount,
    paid_at: paid ? new Date().toISOString() : null,
    recorded_by: userId,
  }, { onConflict: "event_id,member_id" });
  throwIfError(error);
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
