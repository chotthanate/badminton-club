// Used only by admin-test-server.mjs. No network or production identifiers.
const clubId = "local-admin-fixture-club";
const eventId = "local-admin-fixture-event";
const parameters = new URLSearchParams(window.location.search);
const sandbox = parameters.has("sandbox");
const staff = parameters.get("staff") === "1";
const empty = parameters.get("empty") === "1";
const directory = parameters.get("directory") === "1";
const overnight = parameters.get("overnight") === "1";
const closed = parameters.get("closed") === "1";
const courtsScenario = parameters.get("courts") === "1";
const members = Array.from({ length: 18 }, (_, index) => ({ id: `local-member-${index + 1}`, club_id: clubId, role: "member", active: true, nickname: `ทดสอบ ${String(index + 1).padStart(2, "0")}`, display_name: `Player ${index + 1}`, skill_level: index === 0 ? "Rookie-" : index % 2 ? "N" : "BG", playable_skill_levels: ["BG", "N"], created_at: `2026-01-01T00:${String(index).padStart(2, "0")}:00Z` }));
if (directory) {
  Object.assign(members[6], { nickname: "สมชาย", display_name: "Somchai LINE", line_user_id: "local-line-somchai" });
  Object.assign(members[7], { nickname: "สมชาย", display_name: "Somchai Walk-in" });
  Object.assign(members[8], { nickname: "มด", display_name: "Mod One", line_user_id: "local-line-mod-one" });
  Object.assign(members[9], { nickname: "มด", display_name: "Mod Two", line_user_id: "local-line-mod-two" });
}
const event = { id: eventId, club_id: clubId, title: "รอบทดสอบในเครื่อง", venue: "Local court", event_date: "2000-01-01", starts_at: "18:00:00", ends_at: "22:00:00", status: "open", billing_model: "legacy", court_hourly_rate: 200, shuttlecock_count: 4, shuttlecock_unit_price: 95 };
const closedEvent = { ...event, id: "local-admin-fixture-closed-event", title: "รอบปิดทดสอบในเครื่อง", event_date: "1999-12-31", status: "closed" };
const auditLogs = [
  { id: "local-audit-open-line", event_id: eventId, actor_id: null, action: "รอบปัจจุบัน: ลงชื่อผ่าน LINE จำลอง", created_at: "2000-01-01T11:00:00Z" },
  { id: "local-audit-open-admin", event_id: eventId, actor_id: "local-admin-fixture-user", action: "รอบปัจจุบัน: แอดมินเช็กชื่อจำลอง", created_at: "2000-01-01T11:01:00Z" },
  { id: "local-audit-closed-line", event_id: closedEvent.id, actor_id: null, action: "รอบปิด: ลงชื่อผ่าน LINE จำลอง", created_at: "1999-12-31T11:00:00Z" },
  { id: "local-audit-closed-admin", event_id: closedEvent.id, actor_id: "local-admin-fixture-user", action: "รอบปิด: แอดมินจบรอบจำลอง", created_at: "1999-12-31T15:00:00Z" },
];
let data = {
  event,
  members,
  signups: members.slice(0, 6).map((member, index) => ({ id: `signup-${index}`, member_id: member.id, event_id: eventId, status: "coming", arrival_time: "18:00:00", skill_level_snapshot: member.skill_level, playable_skill_levels_snapshot: member.playable_skill_levels, created_at: member.created_at })),
  attendance: members.slice(2, 6).map((member, index) => ({ id: `attendance-${index}`, member_id: member.id, event_id: eventId, arrived: true, arrived_at: "18:00:00", left_at: index === 1 ? "19:00:00" : null, billing_percentage: 100 })),
  courts: [{ id: "local-court", event_id: eventId, court_name: "คอร์ททดสอบ", starts_at: "18:00:00", ends_at: "22:00:00" }],
  expenses: [], payments: [], auditLogs: [], memberExtras: [], queuePlayers: [], queueMatches: [], queueMatchPlayers: [], paymentSlips: [], paymentSlipPayments: [], extraItems: [{ id: "local-water", name: "น้ำเปล่า", price: 10 }], venues: [], duplicateDismissals: [], shuttlecockCheckpoints: [], perRoundSnapshots: [], perRoundSnapshotAllocations: [], perRoundSnapshotMatches: [],
};
if (sandbox) Object.assign(event, { event_date: "2099-01-01", status: "draft", starts_at: "21:00:00" });
if (overnight) {
  Object.assign(event, { starts_at: "21:00:00", ends_at: "00:00:00" });
  Object.assign(data.courts[0], { starts_at: "21:00:00", ends_at: "00:00:00" });
  data.signups.forEach((row) => { row.arrival_time = "21:00:00"; });
  data.attendance.forEach((row) => { row.arrived_at = "21:00:00"; if (row.left_at) row.left_at = "23:30:00"; });
  data.queueMatches.push({ id: "local-completed", event_id: eventId, status: "completed", ended_at: "2000-01-01T16:00:00Z" });
  data.queueMatchPlayers.push({ match_id: "local-completed", event_id: eventId, member_id: members[2].id, team: "A", position: 1 });
  data.queuePlayers = data.attendance.map((row) => ({ member_id: row.member_id, event_id: eventId, status: "waiting", queued_at: "2000-01-01T14:00:00Z", games_played: 1 }));
}
if (closed) event.status = "closed";
if (courtsScenario) {
  Object.assign(event, { starts_at: "21:00:00", ends_at: "00:00:00" });
  data.courts = [1, 2].map((number) => ({ id: `local-court-${number}`, event_id: eventId, court_name: `คอร์ท ${number}`, starts_at: "21:00:00", ends_at: "00:00:00" }));
  if (!closed) data.queueMatches.push({ id: "local-playing-court-match", event_id: eventId, court_id: "local-court-1", status: "playing", sequence: 1, started_at: "2000-01-01T14:00:00Z" });
}
const contexts = [{ club_id: clubId, role: staff ? "staff" : "owner", clubs: { id: clubId, name: "สโมสรทดสอบเฉพาะในเครื่อง", is_test: sandbox } }];
let hasEvent = !empty;
export const fixture = { scenario: { sandbox, staff, empty, directory, overnight, closed }, inFlight: 0, maxParallelWrites: 0, writes: [], failures: [], reads: [], readDetails: [], failWrite: false, failRead: false, slowFullRead: false };
let version = 0;
const listeners = new Set();
const changed = () => { version += 1; listeners.forEach((listener) => listener()); };
export const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export const snapshot = () => version;
export const armFailure = () => { fixture.failWrite = true; changed(); };
export const armReadFailure = () => { fixture.failRead = true; changed(); };
export const armSlowRead = () => { fixture.slowFullRead = true; changed(); };
const copy = (value) => structuredClone(value);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readDashboard(requestedEventId) {
  const selected = hasEvent ? requestedEventId === closedEvent.id ? closedEvent : event : null;
  const result = copy(data);
  if (selected?.id !== eventId) {
    for (const key of Object.keys(result)) {
      if (Array.isArray(result[key]) && !["members", "extraItems", "venues", "duplicateDismissals"].includes(key)) result[key] = [];
    }
  }
  result.event = copy(selected);
  result.auditLogs = staff ? [] : copy(auditLogs.filter((row) => row.event_id === selected?.id));
  return result;
}

export async function fixtureCall(name, args) {
  const reads = ["loadDashboard", "loadQueueState", "loadParticipantState", "loadStaffDashboard", "loadFinanceState", "loadEventControlState", "loadAuditState"];
  if (name === "getAdminContexts") return copy(contexts);
  if (name === "listClubEvents") return hasEvent ? [{ ...event, participant_count: 6, payment_complete: false }, { ...closedEvent, participant_count: 0, payment_complete: true }] : [];
  if (name === "listOutstandingPayments") return [];
  if (reads.includes(name)) {
    fixture.reads.push(name);
    fixture.readDetails.push({ name, args: copy(args) });
    changed();
    const requestedEventId = name === "loadQueueState" ? args[0] : name === "loadStaffDashboard" ? null : args[1];
    const result = readDashboard(requestedEventId);
    if (name === "loadDashboard" && fixture.slowFullRead) { fixture.slowFullRead = false; await pause(1500); }
    else await pause(50);
    if (fixture.failRead) { fixture.failRead = false; fixture.failures.push(`${name}:simulated read failure`); changed(); throw new Error("จำลองโหลดข้อมูลล้มเหลว"); }
    if (name === "loadAuditState") return { auditLogs: result.auditLogs };
    return { ...result, queueEventStatus: result.event?.status || null };
  }
  if (name === "recordAudit") return undefined;
  fixture.inFlight += 1;
  fixture.maxParallelWrites = Math.max(fixture.maxParallelWrites, fixture.inFlight);
  changed();
  try {
    await pause(650);
    if (fixture.failWrite) { fixture.failWrite = false; fixture.failures.push(`${name}:simulated write failure`); changed(); throw new Error("จำลองบันทึกล้มเหลว"); }
    const input = args[0];
    let result = input;
    if (name === "extendCourtBooking" || name === "upsertOperatorCourt") {
      if (input.eventId !== eventId) throw new Error("ไม่พบรอบทดสอบ");
      let court = data.courts.find((row) => row.id === input.courtId);
      if (name === "extendCourtBooking") {
        if (!court) throw new Error("ไม่พบคอร์ททดสอบ");
        const [hour, minute] = court.ends_at.split(":").map(Number);
        const end = (hour * 60 + minute + input.minutes) % 1440;
        court.ends_at = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}:00`;
      } else {
        if (!court) { court = { id: `local-court-${data.courts.length}`, event_id: eventId }; data.courts.push(court); }
        Object.assign(court, { court_name: input.courtName, starts_at: input.startsAt, ends_at: input.endsAt });
      }
      event.ends_at = court.ends_at;
      result = name === "extendCourtBooking" ? court : court.id;
    } else if (name === "removeParticipant" || name === "removeOperatorParticipant" || name === "restoreParticipant") {
      const signup = data.signups.find((row) => row.member_id === input.memberId);
      if (!signup) throw new Error("ไม่พบชื่อทดสอบ");
      const matchIds = data.queueMatchPlayers.filter((row) => row.member_id === input.memberId).map((row) => row.match_id);
      if (name !== "restoreParticipant" && data.queueMatches.some((row) => matchIds.includes(row.id) && row.status === "playing")) throw new Error("กรุณาจบเกมที่กำลังเล่นก่อน");
      signup.removed_at = name === "restoreParticipant" ? null : new Date().toISOString();
      if (name !== "restoreParticipant") data.queueMatches.filter((row) => matchIds.includes(row.id) && ["draft", "approved"].includes(row.status)).forEach((row) => { row.status = "cancelled"; });
      const attendance = data.attendance.find((row) => row.member_id === input.memberId);
      data.queuePlayers.filter((row) => row.member_id === input.memberId).forEach((row) => { row.status = name === "restoreParticipant" && attendance?.arrived && !attendance.left_at ? "waiting" : "left"; });
    } else if (name === "updateOperatorAttendance") {
      const row = data.attendance.find((item) => item.member_id === input.memberId);
      const patch = { arrived: input.arrived, arrived_at: input.arrivedAt, left_at: input.leftAt };
      if (row) Object.assign(row, patch);
      else data.attendance.push({ member_id: input.memberId, event_id: eventId, ...patch });
      if (patch.left_at || !patch.arrived) data.queuePlayers.filter((entry) => entry.member_id === input.memberId).forEach((entry) => { entry.status = "left"; });
    } else if (name === "addOperatorParticipant" || name === "addParticipant" || name === "addLineMember") {
      let member = data.members.find((row) => row.id === input.memberId);
      if (!member) { member = { id: `local-added-${data.members.length}`, club_id: clubId, role: "member", active: true, nickname: input.nickname || input.name || input.displayName, display_name: input.nickname || input.name || input.displayName, skill_level: input.skillLevel || "N", playable_skill_levels: input.playableSkillLevels || [input.skillLevel || "N"] }; data.members.push(member); }
      if (name !== "addLineMember") {
        const signup = data.signups.find((row) => row.member_id === member.id);
        if (signup?.removed_at) { signup.removed_at = null; signup.removed_by = null; }
        else if (!signup) data.signups.push({ id: `signup-${member.id}`, event_id: eventId, member_id: member.id, status: "coming", arrival_time: event.starts_at, skill_level_snapshot: member.skill_level });
      }
      result = name === "addLineMember" ? member : member.id;
    } else if (name === "updateSignup") {
      const signup = data.signups.find((row) => row.member_id === input.memberId);
      if (signup?.removed_at) throw new Error("ใช้คำสั่งนำผู้เล่นกลับเพื่อรักษาประวัติเดิม");
      if (signup) Object.assign(signup, { status: input.status, arrival_time: input.arrivalTime });
      else data.signups.push({ id: `signup-${input.memberId}`, event_id: eventId, member_id: input.memberId, status: input.status, arrival_time: input.arrivalTime, skill_level_snapshot: input.skillLevel, playable_skill_levels_snapshot: input.playableSkillLevels, created_at: new Date().toISOString() });
    } else if (name === "removeOperatorCourt") {
      if (data.queueMatches.some((match) => match.court_id === input.courtId)) throw new Error("คอร์ทมีประวัติเกมจึงลบไม่ได้");
      data.courts = data.courts.filter((row) => row.id !== input.courtId);
    } else if (name === "updateEventVenue") {
      if (input.eventId !== eventId || event.status !== "open") throw new Error("เลือกรอบเปิดทดสอบเดิมเท่านั้น");
      event.venue = input.venue.trim();
      result = event;
    } else if (name === "prepareEventForLine") {
      if (input !== eventId || sandbox) throw new Error("เตรียมได้เฉพาะรอบหลักทดสอบเดิม");
      event.line_publish_ready = true;
      result = { ok: true, eventId, status: event.status, republish: event.status === "open", command: "เปิดลงชื่อ" };
    } else if (directory && name === "archiveClubMember") {
      const target = data.members.find((member) => member.id === input);
      if (!target) throw new Error("ไม่พบสมาชิกทดสอบ");
      if (data.signups.some((row) => row.member_id === input && row.status === "coming")) throw new Error("ผู้เล่นยังอยู่ในรอบที่ใช้งานอยู่");
      target.active = false;
      result = target.id;
    } else if (directory && name === "mergeClubMembers") {
      const source = data.members.find((member) => member.id === input.sourceMemberId);
      const target = data.members.find((member) => member.id === input.targetMemberId);
      if (!source || !target || source.id === target.id) throw new Error("เลือกรายชื่อทดสอบสองคน");
      if (source.line_user_id && target.line_user_id && source.line_user_id !== target.line_user_id) throw new Error("คนละบัญชี LINE จึงรวมไม่ได้");
      target.aliases = [...new Set([...(target.aliases || []), source.nickname, source.display_name])];
      target.line_user_id ||= source.line_user_id;
      data.members = data.members.filter((member) => member.id !== source.id);
      result = target.id;
    } else if (directory && name === "dismissDuplicateMemberSuggestion") {
      data.duplicateDismissals.push({ signature: input.signature });
    } else if (name === "prepareTestRound") {
      if (!sandbox) throw new Error("Not a sandbox fixture");
      hasEvent = true;
      event.status = "open";
      result = eventId;
    } else if (name === "addRandomTestPlayers") {
      if (!sandbox || input.eventId !== eventId) throw new Error("Sandbox event mismatch");
      const offset = data.members.length;
      for (let index = 0; index < input.count; index += 1) {
        const member = { ...members[0], id: `local-random-${offset + index}`, nickname: `สุ่ม ${offset + index}`, skill_level: "N" };
        data.members.push(member);
        data.signups.push({ id: `signup-${member.id}`, event_id: eventId, member_id: member.id, status: "coming", arrival_time: "21:00:00", skill_level_snapshot: "N" });
        data.attendance.push({ id: `attendance-${member.id}`, event_id: eventId, member_id: member.id, arrived: true, arrived_at: "06:00:00", left_at: null });
        data.queuePlayers.push({ id: `queue-${member.id}`, event_id: eventId, member_id: member.id, status: "waiting", available_since: new Date().toISOString(), games_played: 0 });
      }
      result = input.count;
    } else if (name === "updateAttendance") {
      const existing = data.attendance.find((row) => row.member_id === input.memberId);
      if (existing) Object.assign(existing, input.patch);
      else data.attendance.push({ id: `attendance-${input.memberId}`, event_id: eventId, member_id: input.memberId, ...input.patch });
      if (input.patch.left_at || input.patch.arrived === false) data.queuePlayers.filter((row) => row.member_id === input.memberId).forEach((row) => { row.status = "left"; });
    } else if (name === "updateSignupArrival" || name === "updateOperatorSignupArrival") {
      const signup = data.signups.find((row) => row.member_id === input.memberId);
      signup.arrival_time = input.arrivalTime;
      const attendance = data.attendance.find((row) => row.member_id === input.memberId);
      if (attendance?.arrived) attendance.arrived_at = input.arrivalTime;
    } else if (name === "updateClubMember") {
      const member = data.members.find((row) => row.id === input);
      const patch = args[1];
      Object.assign(member, { nickname: patch.nickname, display_name: patch.displayName, skill_level: patch.skillLevel, playable_skill_levels: patch.playableSkillLevels });
      data.signups.filter((row) => row.member_id === input).forEach((row) => { row.skill_level_snapshot = patch.skillLevel; });
    } else if (name === "addMemberExtraCharge") {
      data.memberExtras.push({ id: `charge-${data.memberExtras.length + 1}`, event_id: eventId, member_id: input.memberId, item_name: input.item.name, unit_price: input.item.price, quantity: 1 });
    } else if (name === "finalizeMemberBill") {
      data.payments.push({ id: `payment-${input.memberId}`, event_id: eventId, member_id: input.memberId, amount: input.billedAmount, calculated_amount: input.calculatedAmount, payment_status: "awaiting", billed_at: new Date().toISOString(), admin_confirmed_at: new Date().toISOString(), shared_amount: input.sharedAmount, extras_amount: input.extrasAmount });
    } else throw new Error(`Fixture intentionally does not implement ${name}`);
    fixture.writes.push({ name, args: copy(args) });
    return copy(result);
  } finally { fixture.inFlight -= 1; changed(); }
}

export const mockSupabase = {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: "local-admin-fixture-user" } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null }),
  },
  from() { throw new Error("Direct database access is blocked in the fixture"); },
  rpc() { throw new Error("Direct RPC access is blocked in the fixture"); },
  functions: { invoke() { throw new Error("Edge Functions are blocked in the fixture"); } },
};
