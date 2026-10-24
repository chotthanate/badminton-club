import assert from "node:assert/strict";
import test from "node:test";
import { billableHours, calculateSettlement } from "../src/badmintonLogic.js";

function event(billingModel, attendance) {
  return {
    billingModel, startTime: "18:00", endTime: "19:00", attendance,
    costs: [{ amount: 101 }], courts: [{ startsAt: "18:00", endsAt: "19:00" }],
    courtHourlyRate: 100, shuttlecockCount: 1, shuttlecockUnitPrice: 1,
  };
}
const participant = (memberId, percentage = 100, overrides = {}) => ({
  memberId, name: memberId, arrived: true, arrivedAt: "18:00", leftAt: "19:00",
  playedMinutes: 60, billingPercentage: percentage, ...overrides,
});

test("zero percent remains zero while missing or malformed percentages default to 100", () => {
  for (const zero of [0, "0"]) assert.equal(billableHours(180, zero), 0);
  for (const missing of [undefined, null, "", " ", "invalid", NaN, Infinity]) assert.equal(billableHours(180, missing), 3);
  for (const percent of [25, 50, 75, 100]) assert.equal(billableHours(180, percent), 3 * percent / 100);
});

for (const model of ["legacy", "time_segmented"]) {
  test(`${model}: zero-percent player keeps personal extras but receives no shared or rounding charge`, () => {
    const result = calculateSettlement(event(model, [
      participant("one"), participant("two"),
      participant("free", 0, { hours: 8, weight: 1, extraCharges: [{ name: "Water", unitPrice: 10, quantity: 2 }] }),
    ]));
    const free = result.rows.find((row) => row.memberId === "free");
    assert.equal(free.hours, 0);
    assert.equal(free.sharedDue, 0);
    assert.equal(free.extraAmount, 20);
    assert.equal(free.roundedDue, 20);
    assert.equal(free.paid, false, "zero shared percentage is not payment exemption");
    assert.equal(result.rows.reduce((sum, row) => sum + row.sharedDue, 0), 101);
    assert.equal(result.totalCost, 121);
    assert.equal(result.totalHours, 2);
    assert.ok(result.rows.every((row) => Number.isFinite(row.roundedDue)));
  });

  test(`${model}: all-zero attendance leaves shared cost unallocated without charging the last person`, () => {
    const result = calculateSettlement(event(model, [
      participant("free-one", 0), participant("free-two", "0", { extraAmount: 15 }),
    ]));
    assert.equal(result.rows.length, 2);
    assert.deepEqual(result.rows.map((row) => row.sharedDue), [0, 0]);
    assert.deepEqual(result.rows.map((row) => row.roundedDue), [0, 15]);
    assert.equal(result.unallocatedSharedCost, 101);
    assert.equal(result.unitPrice, 0);
  });

  test(`${model}: an existing finalized zero-percent bill stays locked`, () => {
    const result = calculateSettlement(event(model, [
      participant("locked", 0, { billingFinalized: true, billedAmount: 40, lockedSharedAmount: 30, lockedExtraAmount: 10 }),
      participant("open"),
    ]));
    assert.equal(result.rows[0].locked, true);
    assert.equal(result.rows[0].roundedDue, 40);
    assert.equal(result.rows[0].sharedDue, 30);
    assert.equal(result.rows[1].sharedDue, 71);
  });
}

test("per-round billing keeps its round-unit policy rather than applying a time percentage", () => {
  const result = calculateSettlement(event("per_round", [
    participant("one", 0, { roundsPlayed: 1 }), participant("two", 100, { roundsPlayed: 1 }),
  ]));
  assert.equal(result.totalUnits, 2);
  assert.equal(result.rows.reduce((sum, row) => sum + row.sharedDue, 0), 101);
  assert.ok(result.rows.every((row) => row.sharedDue > 0));
});
