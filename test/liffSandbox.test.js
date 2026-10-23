import test from "node:test";
import assert from "node:assert/strict";
import { resolveLiffClubContext, resolveLiffClubId } from "../supabase/functions/_shared/liffClubContext.js";
import { signupCancellationBlockReason } from "../supabase/functions/_shared/liffProfile.js";
import { showLiveCourt } from "../supabase/functions/_shared/liveQueueTime.js";

function clubLookup(data, error = null) {
  const calls = [];
  const query = {
    select(fields) { calls.push(["select", fields]); return query; },
    eq(column, value) { calls.push(["eq", column, value]); return query; },
    async maybeSingle() { return { data, error }; },
  };
  return { calls, admin: { from(table) { calls.push(["from", table]); return query; } } };
}

test("production requests ignore arbitrary test club IDs without a test-mode request", async () => {
  const lookup = clubLookup({ id: "test", is_test: true });
  assert.deepEqual(await resolveLiffClubContext(lookup.admin, { testClubId: "test" }, "production"), { clubId: "production", isTestClub: false });
  assert.deepEqual(lookup.calls, []);
});

test("test court privileges require server-confirmed is_test club, never a client flag alone", async () => {
  const lookup = clubLookup({ id: "sandbox", is_test: true });
  const payload = { testMode: true, testClubId: "sandbox" };
  assert.deepEqual(await resolveLiffClubContext(lookup.admin, payload, "production"), { clubId: "sandbox", isTestClub: true });
  assert.deepEqual(lookup.calls, [["from", "clubs"], ["select", "id, is_test"], ["eq", "id", "sandbox"]]);
  assert.equal(await resolveLiffClubId(lookup.admin, payload, "production"), "sandbox");
  for (const data of [{ id: "production", is_test: false }, { id: "production", is_test: null }, null]) {
    const denied = clubLookup(data);
    await assert.rejects(resolveLiffClubContext(denied.admin, { testMode: true, testClubId: "production" }, "production"), /ไม่ได้เชื่อมกับกลุ่มทดลอง/);
  }
});

test("unknown or unreadable test-club context fails closed instead of bypassing schedules", async () => {
  const lookup = clubLookup(null, new Error("database unavailable"));
  await assert.rejects(resolveLiffClubContext(lookup.admin, { testMode: true }, "production"), /ไม่พบกลุ่มทดลอง/);
  assert.deepEqual(lookup.calls, []);
  await assert.rejects(resolveLiffClubContext(lookup.admin, { testMode: true, testClubId: "test" }, "production"), /database unavailable/);
});

test("only validated sandbox courts remain visible before a future 21:00 or 22:00 start", () => {
  const event = { event_date: "2026-10-30", starts_at: "21:00" };
  const nowMs = Date.parse("2026-10-24T10:00:00+07:00");
  for (const starts_at of ["21:00", "22:00", "00:30"]) {
    assert.equal(showLiveCourt(event, { starts_at }, { isTestClub: true, nowMs }), true);
    assert.equal(showLiveCourt(event, { starts_at }, { isTestClub: false, nowMs }), false);
    assert.equal(showLiveCourt(event, { starts_at }, { isTestClub: "true", nowMs }), false);
  }
});

test("production live court timing including overnight sessions remains unchanged", () => {
  const event = { event_date: "2026-10-30", starts_at: "21:00" };
  const court = { starts_at: "00:30" };
  assert.equal(showLiveCourt(event, court, { nowMs: Date.parse("2026-10-30T23:59:00+07:00") }), false);
  assert.equal(showLiveCourt(event, court, { nowMs: Date.parse("2026-10-31T00:30:00+07:00") }), true);
});

test("checked-in or active-queue players cannot delete a signup before scheduled start", () => {
  for (const queueStatus of ["waiting", "reserved", "playing"]) {
    assert.match(signupCancellationBlockReason({ queueStatus }), /แจ้งแอดมิน/);
  }
  assert.match(signupCancellationBlockReason({ attendance: { arrived: true, left_at: null } }), /แจ้งแอดมิน/);
  assert.match(signupCancellationBlockReason({ attendance: { arrived: true, left_at: "22:00" }, queueStatus: "left" }), /แจ้งแอดมิน/);
});

test("unchecked players without active queue retain normal pregame cancellation", () => {
  assert.equal(signupCancellationBlockReason(), null);
  assert.equal(signupCancellationBlockReason({ attendance: null, queueStatus: null }), null);
  assert.equal(signupCancellationBlockReason({ attendance: { arrived: false }, queueStatus: "left" }), null);
});
