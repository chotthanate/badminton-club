import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLineSummary,
  calculateSettlement,
  minutesBetween,
  totalCourtHours,
  weightFromTimes,
} from "../src/badmintonLogic.js";

function makeEvent({ attendance = [], costs = [] } = {}) {
  return {
    date: "2026-07-17",
    startTime: "21:00",
    endTime: "00:00",
    attendance,
    costs,
  };
}

test("minutesBetween handles an event that crosses midnight", () => {
  assert.equal(minutesBetween("21:00", "00:00"), 180);
  assert.equal(minutesBetween("23:30", "00:30"), 60);
});

test("minutesBetween rejects malformed or out-of-range times", () => {
  assert.equal(minutesBetween("bad", "00:00"), 0);
  assert.equal(minutesBetween("24:00", "01:00"), 0);
  assert.equal(minutesBetween("21:60", "22:00"), 0);
});

test("totalCourtHours sums courts with different booking times", () => {
  assert.equal(totalCourtHours([
    { startsAt: "21:00", endsAt: "00:00" },
    { startsAt: "22:00", endsAt: "00:00" },
  ]), 5);
});

test("weightFromTimes calculates partial play across midnight", () => {
  assert.equal(weightFromTimes("21:00", "00:00", "22:30"), 0.5);
  assert.equal(weightFromTimes("21:00", "00:00", "23:15"), 0.75);
});

test("weightFromTimes clamps play time to a billable range", () => {
  assert.equal(weightFromTimes("21:00", "00:00", "21:05"), 0.05);
  assert.equal(weightFromTimes("21:00", "00:00", "01:00"), 1);
});

test("calculateSettlement excludes absent players and splits by weight", () => {
  const result = calculateSettlement(makeEvent({
    costs: [{ amount: 300 }],
    attendance: [
      { memberId: "a", name: "A", arrived: true, weight: 1 },
      { memberId: "b", name: "B", arrived: true, weight: 0.5 },
      { memberId: "c", name: "C", arrived: false, weight: 1 },
    ],
  }));

  assert.equal(result.totalCost, 300);
  assert.equal(result.totalUnits, 1.5);
  assert.deepEqual(result.rows.map((row) => row.roundedDue), [200, 100]);
});

test("calculateSettlement assigns rounding remainder so the bill balances", () => {
  const result = calculateSettlement(makeEvent({
    costs: [{ amount: 100 }],
    attendance: [
      { memberId: "a", name: "A", arrived: true, weight: 1 },
      { memberId: "b", name: "B", arrived: true, weight: 1 },
      { memberId: "c", name: "C", arrived: true, weight: 1 },
    ],
  }));

  assert.deepEqual(result.rows.map((row) => row.roundedDue), [33, 33, 34]);
  assert.equal(result.rows.reduce((sum, row) => sum + row.roundedDue, 0), 100);
});

test("buildLineSummary includes totals, percentages, and payment status", () => {
  const summary = buildLineSummary(makeEvent({
    costs: [{ amount: 150 }],
    attendance: [
      { memberId: "a", name: "แอดมิน", arrived: true, weight: 1, paid: true },
      { memberId: "b", name: "บอย", arrived: true, weight: 0.5, paid: false },
    ],
  }));

  assert.match(summary, /รวม 150 บาท \/ 1\.50 หน่วย/);
  assert.match(summary, /แอดมิน \(100%\) 100 บาท จ่ายแล้ว/);
  assert.match(summary, /บอย \(50%\) 50 บาท/);
});
