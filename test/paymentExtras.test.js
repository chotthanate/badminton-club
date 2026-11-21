import test from "node:test";
import assert from "node:assert/strict";
import { buildPaymentExtraRequests } from "../supabase/functions/_shared/paymentExtras.js";

test("payment extra requests stay scoped to actual billed event/member pairs", () => {
  const requests = buildPaymentExtraRequests([
    { event_id: "event-1", member_id: "member-1" },
    { event_id: "event-1", member_id: "member-2" },
    { event_id: "event-1", member_id: "member-1" },
    { event_id: "event-2", member_id: "member-3" },
  ]);

  assert.deepEqual(requests, [
    { eventId: "event-1", memberIds: ["member-1", "member-2"] },
    { eventId: "event-2", memberIds: ["member-3"] },
  ]);
});

test("large payment extra requests are split before URLs become oversized", () => {
  const payments = Array.from({ length: 95 }, (_, index) => ({
    event_id: "event-1",
    member_id: `member-${index + 1}`,
  }));

  const requests = buildPaymentExtraRequests(payments, 40);

  assert.deepEqual(requests.map((request) => request.memberIds.length), [40, 40, 15]);
  assert.equal(requests.every((request) => request.eventId === "event-1"), true);
});
