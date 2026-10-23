import assert from "node:assert/strict";
import test from "node:test";
import { applyPaymentReceipt, createPaymentRefreshGate, isPaymentSelectable, reconcilePaymentReceipt, retainSelectablePaymentIds } from "../src/paymentSession.js";
import { evaluatePaymentSubmission, isSamePaymentSubmission, paymentSubmissionState } from "../supabase/functions/_shared/paymentSubmission.js";
import { createSlipProgressReporter } from "../src/paymentSlip.js";
import { registrationProfile, registrationSnapshot } from "../supabase/functions/_shared/liffProfile.js";

const validSlip = { recipientStatus: "match", transferredAmount: 150, expectedAmount: 150, datePasses: true, confidence: 90, transferredOn: "2026-10-24", transactionReference: "ABC123456" };

test("manual review never automatically settles a slip even when every OCR check passes", () => {
  assert.equal(evaluatePaymentSubmission(validSlip).autoPaidCandidate, true);
  const decision = evaluatePaymentSubmission({ ...validSlip, manualReviewRequested: true });
  assert.equal(decision.autoPaidCandidate, false);
  assert.equal(decision.error, null);
});

test("manual review accepts disputed recipient and amount while normal verification rejects them", () => {
  for (const disputed of [{ recipientStatus: "mismatch" }, { transferredAmount: 50 }, { transferredAmount: 160 }]) {
    assert.ok(evaluatePaymentSubmission({ ...validSlip, ...disputed }).error);
    assert.deepEqual(evaluatePaymentSubmission({ ...validSlip, ...disputed, manualReviewRequested: true }), { error: null, manualReview: true, autoPaidCandidate: false });
  }
  assert.ok(evaluatePaymentSubmission({ ...validSlip, transferredAmount: 10, manualReviewRequested: "true" }).error);
});

test("pending slip survives reopen even if the payments review update did not complete", () => {
  const state = paymentSubmissionState({ payment_status: "awaiting" }, { id: "s1", status: "pending", created_at: "2026-10-24T11:00:00Z" });
  assert.equal(state.paymentStatus, "review");
  assert.equal(state.submittedAt, "2026-10-24T11:00:00Z");
  assert.equal(isPaymentSelectable(state), false);
  assert.equal(paymentSubmissionState({ paid_at: "2026-10-24T11:05:00Z" }, { status: "pending" }).paymentStatus, "paid");
  assert.equal(paymentSubmissionState({ payment_status: "awaiting" }, { status: "rejected" }).paymentStatus, "awaiting");
});

test("idempotent duplicate receipt belongs to the same payer and exact rounds", () => {
  const stored = { submitted_by_member_id: "m1", payment_ids: ["p1", "p2"] };
  assert.equal(isSamePaymentSubmission(stored, "m1", ["p2", "p1"]), true);
  assert.equal(isSamePaymentSubmission(stored, "m2", ["p1", "p2"]), false);
  assert.equal(isSamePaymentSubmission(stored, "m1", ["p1", "p3"]), false);
});

const initial = { profile: { memberId: "m1" }, beneficiaries: [{ id: "m1", payments: [{ id: "p1", amount: 150, paymentStatus: "awaiting" }, { id: "p2", amount: 100, paymentStatus: "awaiting" }] }], recentPaid: [] };
test("successful submission remains visible locally when refresh fails and cannot be selected again", () => {
  const pending = applyPaymentReceipt(initial, { status: "pending", slipId: "s1", submittedAt: "2026-10-24T11:00:00Z" }, ["p1"]);
  assert.equal(pending.beneficiaries[0].payments[0].paymentStatus, "review");
  assert.deepEqual(retainSelectablePaymentIds(pending.beneficiaries, ["p1", "p2"]), ["p2"]);
  const paid = applyPaymentReceipt(initial, { status: "auto_paid", slipId: "s1", submittedAt: "2026-10-24T11:00:00Z" }, ["p1"]);
  assert.deepEqual(paid.beneficiaries[0].payments.map((payment) => payment.id), ["p2"]);
  assert.equal(paid.recentPaid[0].id, "p1");
  assert.equal(initial.beneficiaries[0].payments[0].paymentStatus, "awaiting");
});

test("focus and visibility refresh share a request, throttle repeats, and recover after errors", async () => {
  let count = 0;
  let resolve;
  let now = 1000;
  const load = createPaymentRefreshGate(() => { count += 1; return new Promise((done) => { resolve = done; }); }, 15000, () => now);
  const first = load();
  const second = load();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(count, 1);
  resolve({ ok: true });
  await first;
  assert.equal(await load(), null);
  now += 16000;
  const third = load();
  await Promise.resolve();
  assert.equal(count, 2);
  resolve({ ok: true });
  await third;
  let attempts = 0;
  const retry = createPaymentRefreshGate(async () => { attempts += 1; if (attempts === 1) throw new Error("offline"); return "online"; });
  await assert.rejects(retry(), /offline/);
  assert.equal(await retry(), "online");
});

test("status refresh removes a stale pending receipt when admin approves or rejects it", () => {
  const receipt = { status: "pending", paymentIds: ["p1"] };
  const approved = { ...initial, beneficiaries: [], recentPaid: [{ id: "p1" }] };
  assert.equal(reconcilePaymentReceipt(approved, receipt).status, "auto_paid");
  assert.equal(reconcilePaymentReceipt(initial, receipt), null);
  const pending = applyPaymentReceipt(initial, receipt, ["p1"]);
  assert.equal(reconcilePaymentReceipt(pending, receipt), receipt);
});

test("OCR progress does not reset between recognition passes", () => {
  const values = [];
  const progress = createSlipProgressReporter((value) => values.push(value));
  progress.stage(10, 65);
  progress.update(1);
  progress.stage(65, 78);
  progress.update(0);
  progress.update(0.5);
  progress.update(0.1);
  progress.stage(100, 100);
  assert.equal(values.at(-1), 100);
  assert.ok(values.every((value, index) => index === 0 || value >= values[index - 1]));
});

test("registering from an old tab cannot revert saved nickname or skill", () => {
  const oldTab = { nickname: "old name", skillLevel: "Rookie", playableSkillLevels: ["Rookie"] };
  const stored = { id: "m1", nickname: "new name", skill_level: "N", playable_skill_levels: ["BG", "N"] };
  const profile = registrationProfile(stored, oldTab);
  assert.equal(profile.nickname, "new name");
  assert.equal(profile.skillLevel, "N");
  assert.deepEqual(profile.playableSkillLevels, ["BG", "N"]);
  assert.deepEqual(registrationProfile(null, oldTab), oldTab);
});

test("arrival changes keep active game skill snapshot while next rounds use current master", () => {
  const current = { skillLevel: "N", playableSkillLevels: ["N", "BG"] };
  const signup = { skill_level_snapshot: "Rookie", playable_skill_levels_snapshot: ["Rookie"] };
  assert.equal(registrationSnapshot(current, signup, "playing").skillLevel, "Rookie");
  assert.equal(registrationSnapshot(current, signup, "reserved").skillLevel, "Rookie");
  assert.equal(registrationSnapshot(current, signup, "waiting").skillLevel, "N");
  assert.equal(registrationSnapshot(current, null, null).skillLevel, "N");
});
