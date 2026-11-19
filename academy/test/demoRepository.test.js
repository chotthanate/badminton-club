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
