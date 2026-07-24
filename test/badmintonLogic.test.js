import assert from "node:assert/strict";
import test from "node:test";

import {
  billableHours,
  buildLineSummary,
  calculateSettlement,
  formatPlayedDuration,
  minutesBetween,
  playedMinutesWithinEvent,
  suggestArrivalTimeOnCheck,
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

test("playedMinutesWithinEvent uses each player's arrival and departure", () => {
  assert.equal(playedMinutesWithinEvent("21:00", "00:00", "21:00", ""), 180);
  assert.equal(playedMinutesWithinEvent("21:00", "00:00", "22:00", ""), 120);
  assert.equal(playedMinutesWithinEvent("21:00", "00:00", "22:00", "23:30"), 90);
  assert.equal(formatPlayedDuration(90), "1 ชม. 30 นาที");
});

test("billableHours applies an admin-selected percentage to actual playing time", () => {
  assert.equal(billableHours(180, 100), 3);
  assert.equal(billableHours(180, 50), 1.5);
  assert.equal(billableHours(90, 50), 0.75);
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

test("calculateSettlement splits shared cost by hours and adds personal extras", () => {
  const result = calculateSettlement(makeEvent({
    costs: [{ amount: 300 }],
    attendance: [
      { memberId: "a", name: "A", arrived: true, hours: 3, extraCharges: [{ unitPrice: 10, quantity: 1 }] },
      { memberId: "b", name: "B", arrived: true, hours: 1.5, extraCharges: [{ unitPrice: 15, quantity: 2 }] },
    ],
  }));

  assert.equal(result.sharedTotalCost, 300);
  assert.equal(result.personalExtrasTotal, 40);
  assert.equal(result.totalCost, 340);
  assert.deepEqual(result.rows.map((row) => row.roundedDue), [210, 130]);
});

test("calculateSettlement keeps an early payment locked when later costs increase", () => {
  const result = calculateSettlement(makeEvent({
    costs: [{ amount: 500 }],
    attendance: [
      {
        memberId: "early",
        name: "หยก",
        arrived: true,
        hours: 1,
        extraCharges: [{ name: "น้ำขวดเล็ก", unitPrice: 10, quantity: 1 }],
        paid: true,
        paidAmount: 100,
        lockedSharedAmount: 90,
        lockedExtraAmount: 10,
        shuttlecockCountSnapshot: 5,
      },
      { memberId: "staying", name: "บอย", arrived: true, hours: 3 },
    ],
  }));

  assert.equal(result.rows[0].roundedDue, 100);
  assert.equal(result.rows[0].paid, true);
  assert.equal(result.rows[0].shuttlecockCountSnapshot, 5);
  assert.equal(result.rows[1].roundedDue, 410);
  assert.equal(result.rows.reduce((sum, row) => sum + row.roundedDue, 0), 510);
});

test("buildLineSummary lists personal items instead of a generic extras total", () => {
  const summary = buildLineSummary(makeEvent({
    costs: [{ amount: 100 }],
    attendance: [
      { memberId: "a", name: "Jack", arrived: true, hours: 1, extraCharges: [{ name: "น้ำขวดเล็ก", unitPrice: 10, quantity: 2 }] },
    ],
  }));

  assert.match(summary, /1\.Jack = 120 บาท \(น้ำขวดเล็ก×2 20 บาท\)/);
  assert.doesNotMatch(summary, /รวมของเพิ่ม/);
});

test("buildLineSummary uses the compact transfer format", () => {
  const summary = buildLineSummary(makeEvent({
    costs: [{ amount: 150 }],
    attendance: [
      { memberId: "a", name: "แอดมิน", arrived: true, weight: 1, paid: true },
      { memberId: "b", name: "บอย", arrived: true, weight: 0.5, paid: false },
    ],
  }));

  assert.match(summary, /^ค่าตีแบต 17 ก\.ค\. 69/m);
  assert.match(summary, /1\.แอดมิน = 100 บาท/);
  assert.match(summary, /2\.บอย = 50 บาท/);
  assert.doesNotMatch(summary, /ชั่วโมงผู้เล่น|ชม\.|จ่ายแล้ว|รวม 150/);
  assert.match(summary, /โอนเงิน : ธนาคารกสิกร\n389-2-36746-8\nณฐกฤต อินนะใจ$/);
});

test("suggestArrivalTimeOnCheck offers the nearest quarter-hour when check-in is late", () => {
  assert.equal(suggestArrivalTimeOnCheck({
    now: new Date(2026, 6, 24, 21, 20),
    eventDate: "2026-07-24",
    startTime: "21:00",
    endTime: "00:00",
    plannedArrival: "21:00",
  }), "21:15");
});

test("suggestArrivalTimeOnCheck keeps the signed-up time when check-in is not late", () => {
  assert.equal(suggestArrivalTimeOnCheck({
    now: new Date(2026, 6, 24, 21, 6),
    eventDate: "2026-07-24",
    startTime: "21:00",
    endTime: "00:00",
    plannedArrival: "21:00",
  }), null);
});

test("suggestArrivalTimeOnCheck supports a session after midnight", () => {
  assert.equal(suggestArrivalTimeOnCheck({
    now: new Date(2026, 6, 25, 0, 12),
    eventDate: "2026-07-24",
    startTime: "21:00",
    endTime: "01:00",
    plannedArrival: "23:30",
  }), "00:15");
});
