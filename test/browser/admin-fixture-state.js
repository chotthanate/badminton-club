// Used only by admin-test-server.mjs. No network or production identifiers.
const clubId = "local-admin-fixture-club";
const eventId = "local-admin-fixture-event";
const members = Array.from({ length: 18 }, (_, index) => ({ id: `local-member-${index + 1}`, club_id: clubId, role: "member", active: true, nickname: `ทดสอบ ${String(index + 1).padStart(2, "0")}`, display_name: `Player ${index + 1}`, skill_level: index === 0 ? "Rookie-" : index % 2 ? "N" : "BG", playable_skill_levels: ["BG", "N"], created_at: `2026-01-01T00:${String(index).padStart(2, "0")}:00Z` }));
const event = { id: eventId, club_id: clubId, title: "รอบทดสอบในเครื่อง", venue: "Local court", event_date: "2000-01-01", starts_at: "18:00:00", ends_at: "22:00:00", status: "open", billing_model: "legacy", court_hourly_rate: 200, shuttlecock_count: 4, shuttlecock_unit_price: 95 };
let data = {
  event,
  members,
  signups: members.slice(0, 6).map((member, index) => ({ id: `signup-${index}`, member_id: member.id, event_id: eventId, status: "coming", arrival_time: "18:00:00", skill_level_snapshot: member.skill_level, playable_skill_levels_snapshot: member.playable_skill_levels, created_at: member.created_at })),
  attendance: members.slice(2, 6).map((member, index) => ({ id: `attendance-${index}`, member_id: member.id, event_id: eventId, arrived: true, arrived_at: "18:00:00", left_at: index === 1 ? "19:00:00" : null, billing_percentage: 100 })),
  courts: [{ id: "local-court", event_id: eventId, court_name: "คอร์ททดสอบ", starts_at: "18:00:00", ends_at: "22:00:00" }],
  expenses: [], payments: [], auditLogs: [], memberExtras: [], queuePlayers: [], queueMatches: [], queueMatchPlayers: [], paymentSlips: [], paymentSlipPayments: [], extraItems: [{ id: "local-water", name: "น้ำเปล่า", price: 10 }], venues: [], duplicateDismissals: [], shuttlecockCheckpoints: [], perRoundSnapshots: [], perRoundSnapshotAllocations: [], perRoundSnapshotMatches: [],
};
const contexts = [{ club_id: clubId, role: "owner", clubs: { id: clubId, name: "สโมสรทดสอบเฉพาะในเครื่อง", is_test: false } }];
export const fixture = { inFlight: 0, maxParallelWrites: 0, writes: [], failures: [], reads: [], failWrite: false, failRead: false, slowFullRead: false };
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

export async function fixtureCall(name, args) {
  const reads = ["loadDashboard", "loadQueueState", "loadParticipantState", "loadStaffDashboard", "loadFinanceState", "loadEventControlState", "loadAuditState"];
  if (name === "getAdminContexts") return copy(contexts);
  if (name === "listClubEvents") return [{ ...event, participant_count: 6, payment_complete: false }];
  if (name === "listOutstandingPayments") return [];
  if (reads.includes(name)) {
    fixture.reads.push(name);
    changed();
    const result = copy(data);
    if (name === "loadDashboard" && fixture.slowFullRead) { fixture.slowFullRead = false; await pause(1500); }
    else await pause(50);
    if (fixture.failRead) { fixture.failRead = false; fixture.failures.push(`${name}:simulated read failure`); changed(); throw new Error("จำลองโหลดข้อมูลล้มเหลว"); }
    return { ...result, queueEventStatus: result.event.status };
  }
  if (name === "recordAudit") return undefined;
  fixture.inFlight += 1;
  fixture.maxParallelWrites = Math.max(fixture.maxParallelWrites, fixture.inFlight);
  changed();
  try {
    await pause(650);
    if (fixture.failWrite) { fixture.failWrite = false; fixture.failures.push(`${name}:simulated write failure`); changed(); throw new Error("จำลองบันทึกล้มเหลว"); }
    const input = args[0];
    if (name === "updateAttendance") {
      const existing = data.attendance.find((row) => row.member_id === input.memberId);
      if (existing) Object.assign(existing, input.patch);
      else data.attendance.push({ id: `attendance-${input.memberId}`, event_id: eventId, member_id: input.memberId, ...input.patch });
    } else if (name === "updateSignupArrival") {
      const signup = data.signups.find((row) => row.member_id === input.memberId);
      signup.arrival_time = input.arrivalTime;
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
    return copy(input);
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
