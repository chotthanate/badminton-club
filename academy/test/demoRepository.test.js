import test from "node:test";
import assert from "node:assert/strict";
import { buildBillingPreview } from "../src/billing.js";
import { createDemoRepository } from "../src/demoRepository.js";

test("student registration is idempotent and can be cancelled", async () => {
  const repository = createDemoRepository();
  const student = (await repository.listProfiles()).find((profile) => profile.id === "student-4");
  await repository.register("session-1", student);
  await repository.register("session-1", student);
  let session = (await repository.listSessions()).find((entry) => entry.id === "session-1");
  assert.equal(session.registrations.filter((entry) => entry.studentId === student.id).length, 1);
  await repository.cancelRegistration("session-1", student.id);
  session = (await repository.listSessions()).find((entry) => entry.id === "session-1");
  assert.equal(session.registrations.find((entry) => entry.studentId === student.id).status, "cancelled");
});

test("walk-in is registered and checked in together", async () => {
  const repository = createDemoRepository();
  const student = (await repository.listProfiles()).find((profile) => profile.id === "student-4");
  await repository.addWalkIn("session-1", student);
  const session = (await repository.listSessions()).find((entry) => entry.id === "session-1");
  const registration = session.registrations.find((entry) => entry.studentId === student.id);
  assert.equal(registration.source, "walk_in");
  assert.equal(registration.attendance, "present");
});

test("finalizing a session creates one invoice per present student only once", async () => {
  const repository = createDemoRepository();
  const session = (await repository.listSessions()).find((entry) => entry.id === "session-1");
  const preview = buildBillingPreview({
    serviceFeeSatang: session.serviceFeeSatang,
    courtCostSatang: session.courtCostSatang,
    attendees: session.registrations,
    purchases: session.purchases,
  });
  await repository.finalizeSession(session.id, preview);
  await repository.finalizeSession(session.id, preview);
  const invoices = (await repository.listInvoices()).filter((invoice) => invoice.sessionId === session.id);
  assert.equal(invoices.length, 2);
  assert.ok(invoices.every((invoice) => invoice.status === "unpaid"));
});

test("one payment can move multiple invoices to pending", async () => {
  const repository = createDemoRepository();
  const invoices = (await repository.listInvoices("student-1")).filter((invoice) => invoice.status === "unpaid");
  await repository.submitPayment(invoices.map((invoice) => invoice.id));
  const updated = await repository.listInvoices("student-1");
  assert.ok(updated.filter((invoice) => invoices.some((selected) => selected.id === invoice.id)).every((invoice) => invoice.status === "slip_pending"));
});

test("a class can contain multiple lesson cards and retain per-student scores", async () => {
  const repository = createDemoRepository();
  const lesson = await repository.addLesson("session-1", {
    title: "ฝึกเสิร์ฟสั้น",
    description: "ควบคุมทิศทางและความสูง",
    kpis: [{ name: "ลงพื้นที่เป้าหมาย", maximum: 10 }],
  });
  await repository.saveLessonScores("session-1", lesson.id, [
    { ...lesson.kpis[0], scores: { "student-1": 9, "student-3": 7 } },
  ]);
  const session = (await repository.listSessions()).find((entry) => entry.id === "session-1");
  const saved = session.lessons.find((entry) => entry.id === lesson.id);
  assert.equal(saved.title, "ฝึกเสิร์ฟสั้น");
  assert.deepEqual(saved.kpis[0].scores, { "student-1": 9, "student-3": 7 });
  assert.ok(session.lessons.length >= 3);
});

test("venues and cross-student payment options are available to the Academy flows", async () => {
  const repository = createDemoRepository();
  const initial = await repository.listVenues();
  assert.equal(initial.find((venue) => venue.isDefault)?.name, "สนามแบดมินตันเขาน้อย (สนามใหม่)");
  const created = await repository.createVenue({ name: "สนามทดสอบ" });
  assert.equal(created.name, "สนามทดสอบ");
  assert.ok((await repository.listVenues()).some((venue) => venue.id === created.id));
  const paymentOptions = await repository.listPaymentOptions();
  assert.ok(paymentOptions.every((invoice) => invoice.studentName));
});

test("class fees can be filled in later before billing is finalized", async () => {
  const repository = createDemoRepository();
  await repository.updateSessionCosts("session-1", { serviceFeeSatang: 6000, courtCostSatang: 150000 });
  const session = (await repository.listSessions()).find((entry) => entry.id === "session-1");
  assert.equal(session.serviceFeeSatang, 6000);
  assert.equal(session.courtCostSatang, 150000);
});
