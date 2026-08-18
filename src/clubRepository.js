import { supabase } from "./supabase.js";
import {
  defaultPlayableSkillLevels,
  legacyPreferencesForPlayable,
  normalizePlayableSkillLevels,
} from "./skillLevels.js";
import { buildRandomTestPlayerProfiles } from "./randomTestPlayers.js";
import { compareCourtNames } from "../supabase/functions/_shared/paymentSummary.js";

function client() {
  if (!supabase) throw new Error("ยังไม่ได้ตั้งค่า Supabase");
  return supabase;
}

function throwIfError(error) {
  if (error) throw error;
}

export async function getAdminContexts(userId) {
  const { data, error } = await client().rpc("get_backoffice_contexts");
  throwIfError(error);
  const adminClubIds = [...new Set((data || [])
    .filter((row) => row.role === "admin")
    .map((row) => row.club_id))];
  const settingsByClub = new Map();
  if (adminClubIds.length) {
    const settingsResult = await client().from("clubs")
      .select("id, line_payment_include_summary")
      .in("id", adminClubIds);
    throwIfError(settingsResult.error);
    (settingsResult.data || []).forEach((club) => settingsByClub.set(club.id, club));
  }
  return (data || []).map((row) => ({
    id: row.member_id,
    club_id: row.club_id,
    display_name: row.display_name,
    nickname: row.nickname,
    role: row.role,
    user_id: userId,
    clubs: {
      id: row.club_id,
      name: row.club_name,
      line_group_id: row.line_group_id,
      is_test: Boolean(row.is_test),
      default_friday_court_hourly_rate: row.default_friday_court_hourly_rate,
      default_saturday_court_hourly_rate: row.default_saturday_court_hourly_rate,
      default_other_court_hourly_rate: row.default_other_court_hourly_rate,
      default_shuttlecock_unit_price: row.default_shuttlecock_unit_price,
      line_payment_include_summary: settingsByClub.get(row.club_id)?.line_payment_include_summary !== false,
    },
  }));
}

export async function updateLinePaymentSummarySetting(clubId, enabled) {
  const { error } = await client().from("clubs")
    .update({ line_payment_include_summary: Boolean(enabled) })
    .eq("id", clubId);
  throwIfError(error);
}

export async function signInStaff(password) {
  const { data, error } = await client().functions.invoke("line-bot", {
    body: { action: "staff_login", password },
  });
  if (error || data?.error || !data?.session?.access_token || !data?.session?.refresh_token) {
    throw new Error(data?.error || "รหัสสตาฟไม่ถูกต้อง");
  }
  const { error: sessionError } = await client().auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  throwIfError(sessionError);
}

export async function configureStaffAccess({ clubId, password = "", enabled = true }) {
  return invokeLineBot({ action: "configure_staff_access", clubId, password, enabled });
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
    .eq("role", "member");
  throwIfError(memberError);
  const { error: venueError } = await client().from("club_venues").delete().eq("club_id", clubId);
  throwIfError(venueError);
  const { error: itemError } = await client().from("extra_item_catalog").delete().eq("club_id", clubId);
  throwIfError(itemError);
  await seedDefaultExtraItems(clubId);
  await seedTestMembers(clubId);
}

export async function addRandomTestPlayers({ clubId, eventId, count = 23, random = Math.random }) {
  const profiles = buildRandomTestPlayerProfiles(count, random);
  const [clubResult, eventResult, memberCountResult] = await Promise.all([
    client().from("clubs").select("id, is_test").eq("id", clubId).single(),
    client().from("events").select("id, club_id, status, starts_at").eq("id", eventId).single(),
    client().from("club_members").select("id", { count: "exact", head: true }).eq("club_id", clubId).eq("role", "member"),
  ]);
  throwIfError(clubResult.error);
  throwIfError(eventResult.error);
  throwIfError(memberCountResult.error);
  if (!clubResult.data?.is_test) throw new Error("เพิ่มผู้เล่นสุ่มได้เฉพาะโหมดทดลอง");
  if (eventResult.data?.club_id !== clubId) throw new Error("รอบทดลองไม่ตรงกับกลุ่มที่เลือก");
  if (eventResult.data?.status !== "open") throw new Error("กรุณาเปิดลงชื่อในรอบทดลองก่อนเพิ่มผู้เล่นสุ่ม");

  const firstNumber = Number(memberCountResult.count || 0) + 1;
  const memberRows = profiles.map(({ skillLevel, playableSkillLevels }, index) => {
    const legacyPreferences = legacyPreferencesForPlayable(skillLevel, playableSkillLevels);
    const number = String(firstNumber + index).padStart(2, "0");
    return {
      club_id: clubId,
      display_name: `LINE Random ${number}`,
      nickname: `ผู้เล่นสุ่ม ${number}`,
      role: "member",
      active: true,
      skill_level: skillLevel,
      playable_skill_levels: playableSkillLevels,
      allow_lower_level: legacyPreferences.allowLowerLevel,
      allow_higher_level: legacyPreferences.allowHigherLevel,
    };
  });
  const { data: members, error: memberError } = await client().from("club_members")
    .insert(memberRows)
    .select("id, skill_level, playable_skill_levels, allow_lower_level, allow_higher_level");
  throwIfError(memberError);

  const arrivalTime = String(eventResult.data.starts_at || "").slice(0, 5);
  const signupRows = (members || []).map((member) => ({
    club_id: clubId,
    event_id: eventId,
    member_id: member.id,
    status: "coming",
    arrival_time: arrivalTime,
    skill_level_snapshot: member.skill_level,
    playable_skill_levels_snapshot: member.playable_skill_levels,
    allow_lower_level_snapshot: member.allow_lower_level,
    allow_higher_level_snapshot: member.allow_higher_level,
  }));
  const attendanceRows = (members || []).map((member) => ({
    club_id: clubId,
    event_id: eventId,
    member_id: member.id,
    arrived: true,
    arrived_at: arrivalTime,
    left_at: null,
  }));
  const [signupResult, attendanceResult] = await Promise.all([
    client().from("signups").insert(signupRows),
    client().from("attendance").insert(attendanceRows),
  ]);
  throwIfError(signupResult.error);
  throwIfError(attendanceResult.error);
  return members?.length || 0;
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
    .select("id, display_name, nickname, aliases, role, active, line_user_id, payment_exempt, skill_level, playable_skill_levels, allow_lower_level, allow_higher_level, created_at")
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

  const [membersResult, courtsResult, signupsResult, attendanceResult, expensesResult, paymentsResult, paymentSlipsResult, auditResult, venuesResult, extraItemsResult, memberExtrasResult, shuttlecockCheckpointsResult, queuePlayersResult, queueMatchesResult, queueMatchPlayersResult, perRoundSnapshotsResult, perRoundSnapshotMatchesResult, perRoundSnapshotAllocationsResult] = await Promise.all([
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
    client().from("shuttlecock_checkpoints").select("*").eq("event_id", event.id).order("checkpoint_time"),
    client().from("event_queue_players").select("*").eq("event_id", event.id),
    client().from("queue_matches").select("*").eq("event_id", event.id).order("sequence", { ascending: false }),
    client().from("queue_match_players").select("*").eq("event_id", event.id),
    client().from("per_round_billing_snapshots").select("*").eq("event_id", event.id).order("checkpoint_at"),
    client().from("per_round_snapshot_matches").select("*").eq("event_id", event.id),
    client().from("per_round_snapshot_allocations").select("*").eq("event_id", event.id),
  ]);

  [membersResult, courtsResult, signupsResult, attendanceResult, expensesResult, paymentsResult, paymentSlipsResult, auditResult, venuesResult, extraItemsResult, memberExtrasResult, shuttlecockCheckpointsResult, queuePlayersResult, queueMatchesResult, queueMatchPlayersResult, perRoundSnapshotsResult, perRoundSnapshotMatchesResult, perRoundSnapshotAllocationsResult]
    .forEach((result) => throwIfError(result.error));

  const pendingPaymentIds = [...new Set((paymentSlipsResult.data || [])
    .flatMap((slip) => Array.isArray(slip.payment_ids) ? slip.payment_ids : []))];
  let paymentSlipPayments = [];
  if (pendingPaymentIds.length) {
    const { data, error } = await client()
      .from("payments")
      .select("id, event_id, amount, paid_at, payment_status, events!inner(event_date, venue)")
      .in("id", pendingPaymentIds);
    throwIfError(error);
    paymentSlipPayments = data || [];
  }

  return {
    event,
    members: membersResult.data || [],
    courts: [...(courtsResult.data || [])].sort(compareCourtNames),
    signups: signupsResult.data || [],
    attendance: attendanceResult.data || [],
    expenses: expensesResult.data || [],
    payments: paymentsResult.data || [],
    // Pending slips belong to the club, not only to the round currently selected
    // in the round switcher. Keeping every pending slip here prevents older-round
    // transfers from disappearing from the admin review screen.
    paymentSlips: paymentSlipsResult.data || [],
    paymentSlipPayments,
    auditLogs: auditResult.data || [],
    venues: venuesResult.data || [],
    extraItems: extraItemsResult.data || [],
    memberExtras: memberExtrasResult.data || [],
    shuttlecockCheckpoints: shuttlecockCheckpointsResult.data || [],
    queuePlayers: queuePlayersResult.data || [],
    queueMatches: queueMatchesResult.data || [],
    queueMatchPlayers: queueMatchPlayersResult.data || [],
    perRoundSnapshots: perRoundSnapshotsResult.data || [],
    perRoundSnapshotMatches: perRoundSnapshotMatchesResult.data || [],
    perRoundSnapshotAllocations: perRoundSnapshotAllocationsResult.data || [],
  };
}

export async function loadStaffDashboard(clubId) {
  const [dashboardResult, operationsResult] = await Promise.all([
    client().rpc("load_staff_dashboard", { target_club_id: clubId }),
    client().rpc("load_staff_player_operations", { target_club_id: clubId }),
  ]);
  throwIfError(dashboardResult.error);
  throwIfError(operationsResult.error);
  const data = dashboardResult.data;
  const operations = operationsResult.data || {};
  return {
    event: data?.event || null,
    members: data?.members || [],
    courts: [...(data?.courts || [])].sort(compareCourtNames),
    signups: data?.signups || [],
    attendance: data?.attendance || [],
    queuePlayers: data?.queuePlayers || [],
    queueMatches: data?.queueMatches || [],
    queueMatchPlayers: data?.queueMatchPlayers || [],
    expenses: [],
    payments: [],
    paymentSlips: [],
    auditLogs: [],
    venues: [],
    extraItems: operations.extraItems || [],
    memberExtras: operations.memberExtras || [],
    shuttlecockCheckpoints: [],
    perRoundSnapshots: [],
    perRoundSnapshotMatches: [],
    perRoundSnapshotAllocations: [],
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
      billing_model: "time_segmented",
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

export async function updateCourts(eventId, courts) {
  const results = await Promise.all(courts.map((court) => client()
    .from("event_courts")
    .update({
      court_name: court.court_name,
      starts_at: court.starts_at,
      ends_at: court.ends_at,
    })
    .eq("id", court.id)
    .eq("event_id", eventId)));
  results.forEach((result) => throwIfError(result.error));
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

export async function addLineMember({ clubId, displayName, lineUserId = null, skillLevel = null, playableSkillLevels, allowLowerLevel, allowHigherLevel }) {
  const cleanName = displayName.trim();
  const normalizedName = normalizeStoredMemberName(cleanName);
  const { data: existingMembers, error: existingError } = await client().from("club_members")
    .select("id, display_name, nickname, aliases, line_user_id")
    .eq("club_id", clubId)
    .eq("active", true)
    .eq("role", "member");
  throwIfError(existingError);
  const existing = (existingMembers || []).find((member) =>
    [member.nickname, member.display_name, ...(member.aliases || [])]
      .some((value) => normalizeStoredMemberName(value) === normalizedName));
  if (existing) {
    if (lineUserId?.trim() && !existing.line_user_id) {
      const { data, error } = await client().from("club_members")
        .update({ line_user_id: lineUserId.trim() })
        .eq("id", existing.id)
        .select("id, display_name, nickname, aliases, line_user_id")
        .single();
      throwIfError(error);
      return data;
    }
    return existing;
  }
  const normalizedPlayable = skillLevel
    ? normalizePlayableSkillLevels(
      skillLevel,
      playableSkillLevels === undefined && allowLowerLevel === undefined && allowHigherLevel === undefined
        ? defaultPlayableSkillLevels(skillLevel)
        : playableSkillLevels,
      { allowLowerLevel, allowHigherLevel },
    )
    : [];
  const legacyPreferences = legacyPreferencesForPlayable(skillLevel, normalizedPlayable);
  const { data, error } = await client().from("club_members")
    .insert({
      club_id: clubId,
      display_name: cleanName,
      nickname: cleanName,
      line_user_id: lineUserId?.trim() || null,
      role: "member",
      skill_level: skillLevel,
      playable_skill_levels: normalizedPlayable,
      allow_lower_level: legacyPreferences.allowLowerLevel,
      allow_higher_level: legacyPreferences.allowHigherLevel,
    })
    .select("id, display_name, nickname, line_user_id")
    .single();
  throwIfError(error);
  return data;
}

export async function updateClubMember(memberId, {
  nickname,
  displayName,
  paymentExempt = false,
  skillLevel,
  playableSkillLevels,
  allowLowerLevel,
  allowHigherLevel,
}) {
  const { data: current, error: currentError } = await client().from("club_members")
    .select("nickname, display_name, aliases")
    .eq("id", memberId)
    .single();
  throwIfError(currentError);
  const aliases = [...new Set([
    ...(current.aliases || []),
    current.nickname,
    current.display_name,
  ].map((value) => String(value || "").trim()).filter(Boolean))];
  const profilePatch = {
      nickname: nickname.trim(),
      display_name: displayName.trim(),
      aliases,
      payment_exempt: Boolean(paymentExempt),
  };
  if (skillLevel !== undefined) profilePatch.skill_level = skillLevel || null;
  if (skillLevel) {
    const normalizedPlayable = normalizePlayableSkillLevels(skillLevel, playableSkillLevels, {
      allowLowerLevel,
      allowHigherLevel,
    });
    const legacyPreferences = legacyPreferencesForPlayable(skillLevel, normalizedPlayable);
    profilePatch.playable_skill_levels = normalizedPlayable;
    profilePatch.allow_lower_level = legacyPreferences.allowLowerLevel;
    profilePatch.allow_higher_level = legacyPreferences.allowHigherLevel;
  }
  const { error } = await client().from("club_members")
    .update(profilePatch)
    .eq("id", memberId);
  throwIfError(error);
}

export async function mergeClubMembers({ sourceMemberId, targetMemberId }) {
  const { data, error } = await client().rpc("merge_club_members_with_queue", {
    source_member_id: sourceMemberId,
    target_member_id: targetMemberId,
  });
  throwIfError(error);
  return data;
}

export async function removeParticipant({ eventId, memberId }) {
  const { data: matchPlayers, error: matchPlayerError } = await client()
    .from("queue_match_players")
    .select("match_id")
    .eq("event_id", eventId)
    .eq("member_id", memberId);
  throwIfError(matchPlayerError);
  const matchIds = [...new Set((matchPlayers || []).map((row) => row.match_id))];
  if (matchIds.length) {
    const { count, error: completedMatchError } = await client()
      .from("queue_matches")
      .select("id", { count: "exact", head: true })
      .in("id", matchIds)
      .eq("status", "completed");
    throwIfError(completedMatchError);
    if ((count || 0) > 0) throw new Error("ลบผู้เล่นไม่ได้ เพราะมีประวัติเล่นจบแล้วอย่างน้อย 1 รอบ");
  }
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

export async function updateSignup({
  clubId,
  eventId,
  memberId,
  status,
  arrivalTime = null,
  skillLevel,
  playableSkillLevels,
  allowLowerLevel,
  allowHigherLevel,
}) {
  let memberProfile = null;
  if (status === "coming" && skillLevel === undefined) {
    const { data, error } = await client().from("club_members")
      .select("skill_level, playable_skill_levels, allow_lower_level, allow_higher_level")
      .eq("id", memberId)
      .single();
    throwIfError(error);
    memberProfile = data;
  }
  const nextSkillLevel = skillLevel === undefined ? memberProfile?.skill_level : skillLevel;
  if (status === "coming" && !nextSkillLevel) throw new Error("กรุณากำหนดระดับมือของผู้เล่นก่อนเพิ่มเข้ารอบ");
  const nextPlayableLevels = status === "coming"
    ? normalizePlayableSkillLevels(
      nextSkillLevel,
      playableSkillLevels === undefined ? memberProfile?.playable_skill_levels : playableSkillLevels,
      {
        allowLowerLevel: allowLowerLevel === undefined ? memberProfile?.allow_lower_level : allowLowerLevel,
        allowHigherLevel: allowHigherLevel === undefined ? memberProfile?.allow_higher_level : allowHigherLevel,
      },
    )
    : [];
  const legacyPreferences = legacyPreferencesForPlayable(nextSkillLevel, nextPlayableLevels);
  const { error } = await client().from("signups").upsert({
    club_id: clubId,
    event_id: eventId,
    member_id: memberId,
    status,
    arrival_time: status === "coming" ? arrivalTime : null,
    skill_level_snapshot: status === "coming" ? nextSkillLevel : null,
    playable_skill_levels_snapshot: nextPlayableLevels,
    allow_lower_level_snapshot: status === "coming" ? legacyPreferences.allowLowerLevel : false,
    allow_higher_level_snapshot: status === "coming" ? legacyPreferences.allowHigherLevel : false,
  }, { onConflict: "event_id,member_id" });
  throwIfError(error);
}

export async function ensureEventQueuePlayers({ clubId, eventId }) {
  const [attendanceResult, signupResult] = await Promise.all([
    client().from("attendance").select("member_id, arrived, left_at").eq("event_id", eventId).eq("arrived", true).is("left_at", null),
    client().from("signups").select("member_id, skill_level_snapshot").eq("event_id", eventId).eq("status", "coming").not("skill_level_snapshot", "is", null),
  ]);
  throwIfError(attendanceResult.error);
  throwIfError(signupResult.error);
  const signedUp = new Set((signupResult.data || []).map((row) => row.member_id));
  const rows = (attendanceResult.data || [])
    .filter((row) => signedUp.has(row.member_id))
    .map((row) => ({ club_id: clubId, event_id: eventId, member_id: row.member_id, status: "waiting" }));
  if (!rows.length) return;
  const { error } = await client().from("event_queue_players").upsert(rows, {
    onConflict: "event_id,member_id",
    ignoreDuplicates: true,
  });
  throwIfError(error);
}

export async function createQueueDraft({ eventId, memberIds, teamAIds }) {
  const { data, error } = await client().rpc("create_queue_draft", {
    target_event_id: eventId,
    selected_member_ids: memberIds,
    team_a_member_ids: teamAIds,
  });
  throwIfError(error);
  return data;
}

export async function createManualQueueDraft(eventId) {
  const { data, error } = await client().rpc("create_manual_queue_draft", {
    target_event_id: eventId,
  });
  throwIfError(error);
  return data;
}

export async function updateQueueDraftLineup({ matchId, slots }) {
  const { error } = await client().rpc("update_manual_queue_draft_lineup", {
    target_match_id: matchId,
    slot_assignments: slots.map((slot) => ({
      member_id: slot.memberId,
      team: slot.team,
      position: slot.position,
    })),
  });
  throwIfError(error);
}

export async function approveQueueDraft(matchId) {
  const { error } = await client().rpc("approve_queue_draft", { target_match_id: matchId });
  throwIfError(error);
}

export async function moveUpcomingQueue(matchId, direction) {
  const { error } = await client().rpc("move_upcoming_queue", {
    target_match_id: matchId,
    direction: Number(direction),
  });
  throwIfError(error);
}

export async function startNextQueueOnCourt({ eventId, courtId }) {
  const { data, error } = await client().rpc("start_next_queue_on_court", {
    target_event_id: eventId,
    target_court_id: courtId,
  });
  throwIfError(error);
  return data;
}

export async function finishQueueMatch(matchId) {
  const { data, error } = await client().rpc("finish_queue_match", { target_match_id: matchId });
  throwIfError(error);
  return data;
}

export async function cancelQueueMatch(matchId) {
  const { error } = await client().rpc("cancel_upcoming_queue", { target_match_id: matchId });
  throwIfError(error);
}

export async function updateOperatorMemberSkill({ eventId, memberId, skillLevel, playableSkillLevels }) {
  const { data, error } = await client().rpc("operator_update_member_skill", {
    target_event_id: eventId,
    target_member_id: memberId,
    next_skill_level: skillLevel,
    next_playable_skill_levels: playableSkillLevels,
  });
  throwIfError(error);
  return data;
}

export async function updateOperatorSignupArrival({ eventId, memberId, arrivalTime }) {
  const { error } = await client().rpc("operator_update_signup_arrival", {
    target_event_id: eventId,
    target_member_id: memberId,
    next_arrival: arrivalTime,
  });
  throwIfError(error);
}

export async function updateOperatorAttendance({ eventId, memberId, arrived, arrivedAt = null, leftAt = null }) {
  const { error } = await client().rpc("operator_update_attendance", {
    target_event_id: eventId,
    target_member_id: memberId,
    next_arrived: Boolean(arrived),
    next_arrived_at: arrivedAt || null,
    next_left_at: leftAt || null,
  });
  throwIfError(error);
}

export async function upsertOperatorCourt({ eventId, courtId = null, courtName, startsAt, endsAt }) {
  const { data, error } = await client().rpc("operator_upsert_event_court", {
    target_event_id: eventId,
    target_court_id: courtId,
    next_court_name: courtName,
    next_starts_at: startsAt,
    next_ends_at: endsAt,
  });
  throwIfError(error);
  return data;
}

export async function removeOperatorCourt({ eventId, courtId }) {
  const { error } = await client().rpc("operator_remove_event_court", {
    target_event_id: eventId,
    target_court_id: courtId,
  });
  throwIfError(error);
}

export async function addOperatorParticipant({ eventId, memberId = null, nickname = null, skillLevel = null }) {
  const { data, error } = await client().rpc("operator_add_event_participant", {
    target_event_id: eventId,
    target_member_id: memberId,
    next_nickname: nickname,
    next_skill_level: skillLevel,
  });
  throwIfError(error);
  return data;
}

export async function removeOperatorParticipant({ eventId, memberId }) {
  const { error } = await client().rpc("operator_remove_event_participant", {
    target_event_id: eventId,
    target_member_id: memberId,
  });
  throwIfError(error);
}

export async function addOperatorMemberExtra({ eventId, memberId, itemId }) {
  const { data, error } = await client().rpc("operator_add_member_extra", {
    target_event_id: eventId,
    target_member_id: memberId,
    target_item_id: itemId,
  });
  throwIfError(error);
  return data;
}

export async function addOperatorCustomMemberExtra({ eventId, memberId, itemName, unitPrice }) {
  const { data, error } = await client().rpc("operator_add_custom_member_extra", {
    target_event_id: eventId,
    target_member_id: memberId,
    next_item_name: itemName,
    next_unit_price: unitPrice,
  });
  throwIfError(error);
  return data;
}

export async function removeOperatorMemberExtra({ eventId, chargeId }) {
  const { error } = await client().rpc("operator_remove_member_extra", {
    target_event_id: eventId,
    target_charge_id: chargeId,
  });
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

export async function upsertShuttlecockCheckpoint({ clubId, eventId, time, cumulativeCount, userId }) {
  const count = Math.max(0, Number(cumulativeCount) || 0);
  const checkpointTime = `${String(time).slice(0, 5)}:00`;
  const [checkpointResult, eventResult] = await Promise.all([
    client().from("shuttlecock_checkpoints").select("checkpoint_time, cumulative_count").eq("event_id", eventId),
    client().from("events").select("starts_at").eq("id", eventId).single(),
  ]);
  throwIfError(checkpointResult.error);
  throwIfError(eventResult.error);
  const checkpoints = checkpointResult.data || [];
  const eventStart = eventResult.data.starts_at.slice(0, 5);
  const ordered = [...checkpoints.filter((checkpoint) => String(checkpoint.checkpoint_time).slice(0, 5) !== String(time).slice(0, 5)), { checkpoint_time: checkpointTime, cumulative_count: count }]
    .sort((left, right) => timeOnEventTimeline(String(left.checkpoint_time).slice(0, 5), eventStart)
      - timeOnEventTimeline(String(right.checkpoint_time).slice(0, 5), eventStart));
  let previous = 0;
  for (const checkpoint of ordered) {
    const next = Number(checkpoint.cumulative_count) || 0;
    if (next < previous) throw new Error("จำนวนลูกสะสมต้องไม่น้อยกว่าจุดเวลาก่อนหน้า");
    previous = next;
  }
  const { error } = await client().from("shuttlecock_checkpoints").upsert({
    club_id: clubId,
    event_id: eventId,
    checkpoint_time: checkpointTime,
    cumulative_count: count,
    created_by: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "event_id,checkpoint_time" });
  throwIfError(error);
  const maxCount = Math.max(count, ...(checkpoints || []).map((checkpoint) => Number(checkpoint.cumulative_count) || 0));
  await updateEvent(eventId, { shuttlecock_count: maxCount });
}

export async function snapshotPerRoundDeparture({ eventId, memberId, departureTime, cumulativeShuttlecockCount }) {
  const count = Number(cumulativeShuttlecockCount);
  if (!Number.isInteger(count) || count < 0 || count > 1000) {
    throw new Error("จำนวนลูกแบดสะสมต้องอยู่ระหว่าง 0 ถึง 1,000 ลูก");
  }
  const { data, error } = await client().rpc("snapshot_per_round_departure", {
    target_event_id: eventId,
    target_member_id: memberId,
    departure_at: `${String(departureTime).slice(0, 5)}:00`,
    cumulative_shuttlecock_count: count,
  });
  throwIfError(error);
  return data;
}

export async function incrementEventShuttlecockCount({ eventId, increment, checkpointTime }) {
  const amount = Number(increment);
  if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
    throw new Error("เพิ่มลูกแบดได้ครั้งละ 1 ถึง 100 ลูก");
  }
  const { data, error } = await client().rpc("increment_event_shuttlecock_count", {
    target_event_id: eventId,
    increment_by: amount,
    checkpoint_at: `${String(checkpointTime).slice(0, 5)}:00`,
  });
  throwIfError(error);
  return data?.[0] || null;
}

export async function setEventShuttlecockCount({ eventId, count, checkpointTime }) {
  const amount = Number(count);
  if (!Number.isInteger(amount) || amount < 0 || amount > 1000) {
    throw new Error("จำนวนลูกแบดรวมต้องอยู่ระหว่าง 0 ถึง 1,000 ลูก");
  }
  const { data, error } = await client().rpc("set_event_shuttlecock_count", {
    target_event_id: eventId,
    replacement_count: amount,
    checkpoint_at: `${String(checkpointTime).slice(0, 5)}:00`,
  });
  throwIfError(error);
  return data?.[0] || null;
}

export async function removeShuttlecockCheckpoint(checkpointId, eventId) {
  const { error } = await client().from("shuttlecock_checkpoints").delete().eq("id", checkpointId);
  throwIfError(error);
  const { data, error: listError } = await client().from("shuttlecock_checkpoints")
    .select("cumulative_count")
    .eq("event_id", eventId);
  throwIfError(listError);
  await updateEvent(eventId, {
    shuttlecock_count: Math.max(0, ...(data || []).map((row) => Number(row.cumulative_count) || 0)),
  });
}

export async function listOutstandingPayments(clubId) {
  const { data: payments, error: paymentError } = await client().from("payments")
    .select("id, event_id, member_id, amount, billed_at, payment_status")
    .eq("club_id", clubId)
    .not("billed_at", "is", null)
    .is("paid_at", null)
    .order("billed_at", { ascending: true });
  throwIfError(paymentError);
  if (!payments?.length) return [];
  const eventIds = [...new Set(payments.map((row) => row.event_id))];
  const memberIds = [...new Set(payments.map((row) => row.member_id))];
  const [eventsResult, membersResult] = await Promise.all([
    client().from("events").select("id, event_date, venue, status").in("id", eventIds),
    client().from("club_members").select("id, nickname, display_name, payment_exempt").in("id", memberIds),
  ]);
  throwIfError(eventsResult.error);
  throwIfError(membersResult.error);
  const events = new Map((eventsResult.data || []).map((row) => [row.id, row]));
  const members = new Map((membersResult.data || []).map((row) => [row.id, row]));
  return payments.map((payment) => ({
    ...payment,
    event: events.get(payment.event_id),
    member: members.get(payment.member_id),
  })).filter((row) => row.event && row.member && !row.member.payment_exempt);
}

export async function markOutstandingPaymentPaid({ paymentId, paid, userId }) {
  const { error } = await client().from("payments").update({
    paid_at: paid ? new Date().toISOString() : null,
    payment_status: paid ? "paid" : "awaiting",
    paid_source: paid ? "admin" : null,
    recorded_by: userId,
  }).eq("id", paymentId);
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
    { club_id: clubId, display_name: "LINE Demo One", nickname: "เมย์ทดลอง", role: "member", skill_level: "BG", playable_skill_levels: ["Rookie", "BG", "N"], allow_lower_level: true, allow_higher_level: true },
    { club_id: clubId, display_name: "LINE Demo Two", nickname: "แจ็คทดลอง", role: "member", skill_level: "BG", playable_skill_levels: ["Rookie", "BG", "N"], allow_lower_level: true, allow_higher_level: true },
    { club_id: clubId, display_name: "LINE Demo Three", nickname: "บอยทดลอง", role: "member", skill_level: "N", playable_skill_levels: ["BG", "N", "S"], allow_lower_level: true, allow_higher_level: true },
    { club_id: clubId, display_name: "LINE Demo Four", nickname: "แนนทดลอง", role: "member", skill_level: "N", playable_skill_levels: ["BG", "N", "S"], allow_lower_level: true, allow_higher_level: true },
    { club_id: clubId, display_name: "LINE Demo Five", nickname: "เอ็มทดลอง", role: "member", skill_level: "BG", playable_skill_levels: ["Rookie", "BG", "N"], allow_lower_level: true, allow_higher_level: true },
    { club_id: clubId, display_name: "LINE Demo Six", nickname: "เก่งทดลอง", role: "member", skill_level: "BG", playable_skill_levels: ["Rookie", "BG", "N"], allow_lower_level: true, allow_higher_level: true },
    { club_id: clubId, display_name: "LINE Demo Seven", nickname: "หยกทดลอง", role: "member", skill_level: "N", playable_skill_levels: ["BG", "N", "S"], allow_lower_level: true, allow_higher_level: true },
    { club_id: clubId, display_name: "LINE Demo Eight", nickname: "นิวทดลอง", role: "member", skill_level: "N", playable_skill_levels: ["BG", "N", "S"], allow_lower_level: true, allow_higher_level: true },
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

export async function reviewPaymentSlip({ slip, approved }) {
  const paymentIds = Array.isArray(slip.payment_ids) ? slip.payment_ids : [];
  if (!paymentIds.length) throw new Error("สลิปนี้ไม่มีรายการชำระเงิน");
  const { error } = await client().rpc("settle_payment_slip", {
    target_slip_id: slip.id,
    approve: Boolean(approved),
    settlement_source: "slip_review",
  });
  throwIfError(error);
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

function normalizeStoredMemberName(value) {
  return String(value || "").toLocaleLowerCase("th")
    .replace(/[\s._\-®©™]+/g, "");
}
