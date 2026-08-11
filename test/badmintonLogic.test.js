import assert from "node:assert/strict";
import test from "node:test";

import {
  billableHours,
  buildLineSummary,
  calculateSettlement,
  completedRoundsByMember,
  formatPlayedDuration,
  minutesBetween,
  nextFridayIso,
  playedMinutesWithinEvent,
  roundDefaultsForDate,
  suggestArrivalTimeOnCheck,
  suggestShuttlecockCheckpointTime,
  totalCourtHours,
  weightFromTimes,
} from "../src/badmintonLogic.js";
import { classifySlipRecipient, parseSlipReference, parseSlipText, slipRecipientMatches } from "../src/paymentSlip.js";
import { getLiffMode } from "../src/liffMode.js";

function makeEvent({ attendance = [], costs = [], ...overrides } = {}) {
  return {
    date: "2026-07-17",
    startTime: "21:00",
    endTime: "00:00",
    attendance,
    costs,
    ...overrides,
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
  assert.equal(billableHours(135, 25), 0.5625);
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

test("payment-exempt members still share costs but are treated as settled", () => {
  const result = calculateSettlement(makeEvent({
    costs: [{ amount: 300 }],
    attendance: [
      { memberId: "family", name: "ครอบครัว", arrived: true, hours: 3, paymentExempt: true },
      { memberId: "member", name: "สมาชิก", arrived: true, hours: 3 },
    ],
  }));

  assert.deepEqual(result.rows.map((row) => row.roundedDue), [150, 150]);
  assert.equal(result.rows[0].paid, true);
  assert.equal(result.rows[1].paid, false);
});

test("buildLineSummary omits payment-exempt members", () => {
  const summary = buildLineSummary(makeEvent({
    costs: [{ amount: 300 }],
    attendance: [
      { memberId: "family", name: "ครอบครัว", arrived: true, hours: 3, paymentExempt: true },
      { memberId: "member", name: "สมาชิก", arrived: true, hours: 3 },
    ],
  }));

  assert.doesNotMatch(summary, /ครอบครัว/);
  assert.match(summary, /1\.สมาชิก = 150 บาท/);
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

test("calculateSettlement gives equal open balances to players with equal hours and percentages", () => {
  const result = calculateSettlement(makeEvent({
    costs: [{ amount: 454 }],
    attendance: [
      { memberId: "tiger", name: "ไทเกอร์", arrived: true, hours: 3.5 },
      { memberId: "friend", name: "เพื่อนไทเกอร์", arrived: true, hours: 3.5 },
    ],
  }));

  assert.deepEqual(result.rows.map((row) => row.roundedDue), [227, 227]);
});

test("per-round billing splits every shared cost by completed player-game appearances", () => {
  const result = calculateSettlement(makeEvent({
    billingModel: "per_round",
    costs: [
      { type: "court", amount: 1200 },
      { type: "shuttle", amount: 800 },
    ],
    attendance: [
      { memberId: "two", name: "สองรอบ", arrived: true, roundsPlayed: 2, hours: 3, billingPercentage: 25 },
      { memberId: "three", name: "สามรอบ", arrived: true, roundsPlayed: 3, hours: 1, billingPercentage: 100 },
      { memberId: "five", name: "ห้ารอบ", arrived: true, roundsPlayed: 5, hours: 2, billingPercentage: 50 },
    ],
  }));

  assert.equal(result.totalUnits, 10);
  assert.equal(result.unitPrice, 200);
  assert.deepEqual(result.rows.map((row) => row.roundedDue), [400, 600, 1000]);
  assert.equal(result.rows.reduce((sum, row) => sum + row.roundedDue, 0), 2000);
});

test("per-round billing charges personal extras even when a checked-in player completed no games", () => {
  const result = calculateSettlement(makeEvent({
    billingModel: "per_round",
    costs: [{ amount: 400 }],
    attendance: [
      { memberId: "played", name: "ได้เล่น", arrived: true, roundsPlayed: 2 },
      { memberId: "waiting", name: "ไม่ได้เล่น", arrived: true, roundsPlayed: 0, extraCharges: [{ unitPrice: 20, quantity: 1 }] },
    ],
  }));

  assert.deepEqual(result.rows.map((row) => row.roundedDue), [400, 20]);
  assert.equal(result.personalExtrasTotal, 20);
});

test("per-round billing reports shared cost as unallocated until a game is completed", () => {
  const result = calculateSettlement(makeEvent({
    billingModel: "per_round",
    costs: [{ amount: 500 }],
    attendance: [{ memberId: "waiting", name: "รอเล่น", arrived: true, roundsPlayed: 0 }],
  }));

  assert.equal(result.totalUnits, 0);
  assert.equal(result.rows.length, 0);
  assert.equal(result.unallocatedSharedCost, 500);
});

test("per-round billing keeps the rounded shared total balanced", () => {
  const result = calculateSettlement(makeEvent({
    billingModel: "per_round",
    costs: [{ amount: 100 }],
    attendance: [
      { memberId: "one", name: "หนึ่ง", arrived: true, roundsPlayed: 1 },
      { memberId: "two", name: "สอง", arrived: true, roundsPlayed: 1 },
      { memberId: "three", name: "สาม", arrived: true, roundsPlayed: 1 },
    ],
  }));

  assert.deepEqual(result.rows.map((row) => row.roundedDue), [33, 33, 34]);
  assert.equal(result.allocatedSharedTotal, 100);
  assert.equal(result.unallocatedSharedCost, 0);
});

test("per-round billing preserves a finalized bill and redistributes only the unlocked balance", () => {
  const result = calculateSettlement(makeEvent({
    billingModel: "per_round",
    costs: [{ amount: 500 }],
    attendance: [
      {
        memberId: "locked",
        name: "ล็อกแล้ว",
        arrived: true,
        roundsPlayed: 1,
        billingFinalized: true,
        billedAmount: 120,
        lockedSharedAmount: 100,
        lockedExtraAmount: 20,
      },
      { memberId: "two", name: "สองรอบ", arrived: true, roundsPlayed: 2 },
      { memberId: "three", name: "หนึ่งรอบ", arrived: true, roundsPlayed: 1 },
    ],
  }));

  assert.deepEqual(result.rows.map((row) => row.roundedDue), [120, 267, 133]);
  assert.equal(result.rows[0].sharedDue, 100);
  assert.equal(result.rows[0].extraAmount, 20);
  assert.equal(result.allocatedSharedTotal, 500);
});

test("per-round billing preserves every snapshot balance and starts a new sharing segment", () => {
  const result = calculateSettlement(makeEvent({
    billingModel: "per_round",
    snapshotAllocatedSharedTotal: 400,
    costs: [{ amount: 1600 }],
    attendance: [
      {
        memberId: "left",
        name: "กลับแล้ว",
        arrived: true,
        roundsPlayed: 2,
        snapshotRoundUnits: 2,
        snapshotSharedAmount: 200,
        billingFinalized: true,
        billedAmount: 200,
        lockedSharedAmount: 200,
        lockedExtraAmount: 0,
      },
      {
        memberId: "continued",
        name: "เล่นต่อ",
        arrived: true,
        roundsPlayed: 4,
        snapshotRoundUnits: 2,
        snapshotSharedAmount: 200,
      },
      {
        memberId: "new",
        name: "มาเล่นช่วงใหม่",
        arrived: true,
        roundsPlayed: 2,
        snapshotRoundUnits: 0,
        snapshotSharedAmount: 0,
      },
    ],
  }));

  assert.deepEqual(result.rows.map((row) => row.roundedDue), [200, 800, 600]);
  assert.equal(result.snapshotAllocatedSharedTotal, 400);
  assert.equal(result.remainingSharedCost, 1200);
  assert.equal(result.rows.reduce((sum, row) => sum + row.roundedDue, 0), 1600);
});

test("per-round billing carries new cost forward when a snapshot segment has no new game", () => {
  const result = calculateSettlement(makeEvent({
    billingModel: "per_round",
    snapshotAllocatedSharedTotal: 400,
    costs: [{ amount: 500 }],
    attendance: [
      {
        memberId: "continued",
        name: "รอเกมถัดไป",
        arrived: true,
        roundsPlayed: 2,
        snapshotRoundUnits: 2,
        snapshotSharedAmount: 400,
      },
    ],
  }));

  assert.equal(result.rows[0].roundedDue, 400);
  assert.equal(result.unallocatedSharedCost, 100);
});

test("payment-exempt players still count toward the per-round shared-cost denominator", () => {
  const result = calculateSettlement(makeEvent({
    billingModel: "per_round",
    costs: [{ amount: 400 }],
    attendance: [
      { memberId: "family", name: "ครอบครัว", arrived: true, roundsPlayed: 1, paymentExempt: true },
      { memberId: "member", name: "สมาชิก", arrived: true, roundsPlayed: 3 },
    ],
  }));

  assert.deepEqual(result.rows.map((row) => row.roundedDue), [100, 300]);
  assert.equal(result.rows[0].paid, true);
  assert.equal(result.totalUnits, 4);
});

test("completedRoundsByMember counts only unique players from completed matches", () => {
  const rounds = completedRoundsByMember(
    [
      { id: "done-1", status: "completed" },
      { id: "done-2", status: "completed" },
      { id: "playing", status: "playing" },
      { id: "cancelled", status: "cancelled" },
    ],
    [
      { match_id: "done-1", member_id: "a" },
      { match_id: "done-1", member_id: "a" },
      { match_id: "done-1", member_id: "b" },
      { match_id: "done-2", member_id: "a" },
      { match_id: "playing", member_id: "b" },
      { match_id: "cancelled", member_id: "a" },
    ],
  );

  assert.equal(rounds.get("a"), 2);
  assert.equal(rounds.get("b"), 1);
});

test("time-segmented billing charges a court extension only to players still present", () => {
  const result = calculateSettlement({
    ...makeEvent(),
    billingModel: "time_segmented",
    endTime: "01:00",
    courts: [{ startsAt: "21:00", endsAt: "01:00" }],
    courtHourlyRate: 200,
    shuttlecockCount: 0,
    shuttlecockUnitPrice: 95,
    extraCosts: [],
    attendance: [
      { memberId: "left", name: "แหม่ม", arrived: true, arrivedAt: "21:00", leftAt: "00:00", playedMinutes: 180, billingPercentage: 100 },
      { memberId: "stayed", name: "เปี๊ยก", arrived: true, arrivedAt: "21:00", leftAt: "01:00", playedMinutes: 240, billingPercentage: 100 },
    ],
  });

  assert.deepEqual(result.rows.map((row) => row.roundedDue), [300, 500]);
});

test("time-segmented billing is independent of which equal player was finalized first", () => {
  const base = {
    ...makeEvent(),
    billingModel: "time_segmented",
    courts: [{ startsAt: "21:00", endsAt: "00:00" }],
    courtHourlyRate: 200,
    shuttlecockCount: 0,
    shuttlecockUnitPrice: 95,
    extraCosts: [],
  };
  const result = calculateSettlement({
    ...base,
    attendance: [
      { memberId: "locked", name: "คนสรุปก่อน", arrived: true, arrivedAt: "21:00", leftAt: "00:00", playedMinutes: 180, billingPercentage: 100, billingFinalized: true, billedAmount: 300, lockedSharedAmount: 300, lockedExtraAmount: 0 },
      { memberId: "open", name: "คนสรุปทีหลัง", arrived: true, arrivedAt: "21:00", leftAt: "00:00", playedMinutes: 180, billingPercentage: 100 },
    ],
  });

  assert.deepEqual(result.rows.map((row) => row.roundedDue), [300, 300]);
});

test("time-segmented billing distributes every rounded baht across many equal players", () => {
  const result = calculateSettlement({
    ...makeEvent(),
    billingModel: "time_segmented",
    courts: [{ startsAt: "21:00", endsAt: "00:00" }],
    courtHourlyRate: 1600 / 3,
    shuttlecockCount: 0,
    shuttlecockUnitPrice: 95,
    extraCosts: [],
    attendance: Array.from({ length: 69 }, (_, index) => ({
      memberId: `player-${index + 1}`,
      name: `ผู้เล่น ${index + 1}`,
      arrived: true,
      arrivedAt: "21:00",
      leftAt: "00:00",
      playedMinutes: 180,
      billingPercentage: 100,
    })),
  });

  const amounts = result.rows.map((row) => row.roundedDue);
  assert.equal(amounts.reduce((sum, amount) => sum + amount, 0), 1600);
  assert.equal(result.allocatedSharedTotal, 1600);
  assert.equal(result.roundingDifference, 0);
  assert.equal(Math.max(...amounts) - Math.min(...amounts), 1);
});

test("time-segmented billing keeps finalized rows fixed and balances the open remainder", () => {
  const result = calculateSettlement({
    ...makeEvent(),
    billingModel: "time_segmented",
    courts: [{ startsAt: "21:00", endsAt: "00:00" }],
    courtHourlyRate: 200,
    shuttlecockCount: 0,
    shuttlecockUnitPrice: 95,
    extraCosts: [],
    attendance: [
      {
        memberId: "locked",
        name: "สรุปแล้ว",
        arrived: true,
        arrivedAt: "21:00",
        leftAt: "00:00",
        playedMinutes: 180,
        billingPercentage: 100,
        billingFinalized: true,
        billedAmount: 186,
        lockedSharedAmount: 186,
        lockedExtraAmount: 0,
      },
      { memberId: "open-1", name: "ยังไม่สรุป 1", arrived: true, arrivedAt: "21:00", leftAt: "00:00", playedMinutes: 180, billingPercentage: 100 },
      { memberId: "open-2", name: "ยังไม่สรุป 2", arrived: true, arrivedAt: "21:00", leftAt: "00:00", playedMinutes: 180, billingPercentage: 100 },
    ],
  });

  assert.equal(result.rows[0].roundedDue, 186);
  assert.equal(result.rows.reduce((sum, row) => sum + row.roundedDue, 0), 600);
  assert.equal(result.rows[1].roundedDue + result.rows[2].roundedDue, 414);
  assert.equal(Math.abs(result.rows[1].roundedDue - result.rows[2].roundedDue), 0);
});

test("a finalized time-segmented bill never changes when another player or court is edited", () => {
  const lockedPlayer = {
    memberId: "locked",
    name: "กลับก่อน",
    arrived: true,
    arrivedAt: "21:00",
    leftAt: "23:00",
    playedMinutes: 120,
    billingPercentage: 100,
    billingFinalized: true,
    billedAmount: 186,
    calculatedAmount: 186,
    lockedSharedAmount: 176,
    lockedExtraAmount: 10,
    extraCharges: [{ name: "น้ำ", unitPrice: 10, quantity: 1 }],
  };
  const base = {
    ...makeEvent(),
    billingModel: "time_segmented",
    endTime: "00:00",
    courts: [{ startsAt: "21:00", endsAt: "00:00" }],
    courtHourlyRate: 200,
    shuttlecockCount: 6,
    shuttlecockUnitPrice: 95,
    shuttlecockCheckpoints: [{ time: "23:00", cumulativeCount: 4 }],
    extraCosts: [],
  };

  const before = calculateSettlement({
    ...base,
    attendance: [
      lockedPlayer,
      { memberId: "other", name: "อีกคน", arrived: true, arrivedAt: "21:00", leftAt: "00:00", billingPercentage: 100 },
    ],
  });
  const after = calculateSettlement({
    ...base,
    endTime: "01:00",
    courts: [
      { startsAt: "21:00", endsAt: "01:00" },
      { startsAt: "23:00", endsAt: "01:00" },
    ],
    shuttlecockCount: 10,
    attendance: [
      lockedPlayer,
      { memberId: "other", name: "อีกคน", arrived: true, arrivedAt: "22:00", leftAt: "01:00", billingPercentage: 50 },
      { memberId: "new", name: "เพิ่มทีหลัง", arrived: true, arrivedAt: "23:30", leftAt: "01:00", billingPercentage: 100 },
    ],
  });

  assert.equal(before.rows.find((row) => row.memberId === "locked").roundedDue, 186);
  assert.equal(after.rows.find((row) => row.memberId === "locked").roundedDue, 186);
});

test("shuttlecock checkpoints charge later shuttlecocks only to players still present", () => {
  const result = calculateSettlement({
    ...makeEvent(),
    billingModel: "time_segmented",
    endTime: "01:00",
    courts: [],
    courtHourlyRate: 200,
    shuttlecockCount: 8,
    shuttlecockUnitPrice: 95,
    shuttlecockCheckpoints: [
      { time: "00:00", cumulativeCount: 6 },
      { time: "01:00", cumulativeCount: 8 },
    ],
    extraCosts: [],
    attendance: [
      { memberId: "left", name: "กลับเที่ยงคืน", arrived: true, arrivedAt: "21:00", leftAt: "00:00", playedMinutes: 180, billingPercentage: 100 },
      { memberId: "stayed", name: "อยู่ต่อ", arrived: true, arrivedAt: "21:00", leftAt: "01:00", playedMinutes: 240, billingPercentage: 100 },
    ],
  });

  assert.deepEqual(result.rows.map((row) => row.roundedDue), [285, 475]);
});

test("shuttlecock checkpoints do not charge late arrivals for earlier shuttlecocks", () => {
  const result = calculateSettlement({
    ...makeEvent(),
    billingModel: "time_segmented",
    courts: [],
    courtHourlyRate: 200,
    shuttlecockCount: 4,
    shuttlecockUnitPrice: 95,
    shuttlecockCheckpoints: [
      { time: "22:00", cumulativeCount: 3 },
      { time: "00:00", cumulativeCount: 4 },
    ],
    extraCosts: [],
    attendance: [
      { memberId: "early", name: "มาเร็ว", arrived: true, arrivedAt: "21:00", leftAt: "22:00", playedMinutes: 60, billingPercentage: 100 },
      { memberId: "late", name: "มาห้าทุ่ม", arrived: true, arrivedAt: "23:00", leftAt: "00:00", playedMinutes: 60, billingPercentage: 100 },
    ],
  });

  assert.deepEqual(result.rows.map((row) => row.roundedDue), [285, 95]);
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

test("member summary hides rows that an admin has not finalized", () => {
  const summary = buildLineSummary(makeEvent({
    costs: [{ amount: 200 }],
    attendance: [
      { memberId: "draft", name: "ยังไม่สรุป", arrived: true, hours: 1, billingFinalized: false },
      { memberId: "ready", name: "สรุปแล้ว", arrived: true, hours: 1, billingFinalized: true, billedAmount: 120 },
    ],
  }));

  assert.doesNotMatch(summary, /ยังไม่สรุป/);
  assert.match(summary, /1\.สรุปแล้ว = 120 บาท/);
});

test("settlement locks a finalized bill without marking it paid", () => {
  const result = calculateSettlement(makeEvent({
    costs: [{ amount: 200 }],
    attendance: [
      {
        memberId: "ready",
        name: "สรุปแล้ว",
        arrived: true,
        hours: 1,
        billingFinalized: true,
        billedAmount: 120,
        lockedSharedAmount: 100,
        lockedExtraAmount: 0,
        paid: false,
      },
      { memberId: "open", name: "ยังไม่สรุป", arrived: true, hours: 1 },
    ],
  }));

  assert.equal(result.rows[0].roundedDue, 120);
  assert.equal(result.rows[0].paid, false);
  assert.equal(result.rows[1].roundedDue, 100);
});

test("slip parser reads Thai transfer amount and Buddhist date", () => {
  assert.deepEqual(parseSlipText("จำนวนเงิน 200.00 บาท\nวันที่ 25/07/2569"), {
    amount: 200,
    date: "2026-07-25",
    reference: null,
  });
});

test("slip parser normalizes a transaction reference for duplicate protection", () => {
  assert.equal(parseSlipReference("เลขที่รายการ: 0100-20260725-ABC123"), "010020260725ABC123");
  assert.equal(parseSlipReference("Transaction ID\nAB12CD345678"), "AB12CD345678");
  assert.equal(parseSlipReference("ข้อความทั่วไปที่ไม่มีเลขอ้างอิง"), null);
});

test("slip recipient accepts only the configured full recipient name", () => {
  assert.equal(slipRecipientMatches("ผู้รับ\nนาย ณฐกฤต อินนะใจ"), true);
  assert.equal(slipRecipientMatches("ไปยัง ณฐกฤต\nอินนะใจ"), true);
  assert.equal(slipRecipientMatches("ผู้รับ นาย สมชาย ใจดี"), false);
  assert.equal(slipRecipientMatches("ผู้รับ ณฐกฤต อ."), false);
  assert.equal(classifySlipRecipient("ผู้รับ\nนาย สมชาย ใจดี"), "mismatch");
  assert.equal(classifySlipRecipient("ผู้รับ\nณฐกฤต อ."), "unclear");
  assert.equal(classifySlipRecipient("ข้อความในสลิปอ่านไม่ออก"), "unclear");
});

test("LIFF payment mode overrides the signup mode from the configured endpoint", () => {
  assert.equal(
    getLiffMode("?liff=signup&liff.state=%3Fmode%3Dpayment"),
    "payment",
  );
  assert.equal(
    getLiffMode("?liff=signup&liff.state=%3Fliff.state%3D%25253Fmode%25253Dpayment"),
    "payment",
  );
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

test("suggestShuttlecockCheckpointTime records additions in the next quarter-hour", () => {
  assert.equal(suggestShuttlecockCheckpointTime({
    now: new Date(2026, 6, 24, 21, 7),
    eventDate: "2026-07-24",
    startTime: "21:00",
    endTime: "00:00",
  }), "21:15");
  assert.equal(suggestShuttlecockCheckpointTime({
    now: new Date(2026, 6, 24, 23, 58),
    eventDate: "2026-07-24",
    startTime: "21:00",
    endTime: "00:00",
  }), "00:00");
});

test("suggestShuttlecockCheckpointTime uses the first interval before play and the end after play", () => {
  assert.equal(suggestShuttlecockCheckpointTime({
    now: new Date(2026, 6, 24, 20, 0),
    eventDate: "2026-07-24",
    startTime: "21:00",
    endTime: "00:00",
  }), "21:15");
  assert.equal(suggestShuttlecockCheckpointTime({
    now: new Date(2026, 6, 25, 0, 30),
    eventDate: "2026-07-24",
    startTime: "21:00",
    endTime: "00:00",
  }), "00:00");
});

test("roundDefaultsForDate uses the requested Friday and Saturday court presets", () => {
  assert.deepEqual(roundDefaultsForDate("2026-07-24"), {
    courtHourlyRate: 200,
    shuttlecockUnitPrice: 95,
    courts: [
      { name: "คอร์ท 11", startsAt: "21:00", endsAt: "00:00" },
      { name: "คอร์ท 12", startsAt: "21:00", endsAt: "00:00" },
      { name: "คอร์ท 10", startsAt: "22:00", endsAt: "00:00" },
    ],
  });
  assert.deepEqual(roundDefaultsForDate("2026-07-25"), {
    courtHourlyRate: 150,
    shuttlecockUnitPrice: 95,
    courts: [
      { name: "คอร์ท 10", startsAt: "22:00", endsAt: "00:00" },
      { name: "คอร์ท 11", startsAt: "21:00", endsAt: "00:00" },
      { name: "คอร์ท 12", startsAt: "21:00", endsAt: "00:00" },
    ],
  });
});

test("roundDefaultsForDate respects the club's latest saved prices", () => {
  const defaults = roundDefaultsForDate("2026-07-25", {
    default_saturday_court_hourly_rate: 175,
    default_shuttlecock_unit_price: 92,
  });
  assert.equal(defaults.courtHourlyRate, 175);
  assert.equal(defaults.shuttlecockUnitPrice, 92);
});

test("nextFridayIso formats the date in local time without UTC date drift", () => {
  assert.equal(nextFridayIso(new Date(2026, 6, 23, 0, 15)), "2026-07-24");
  assert.equal(nextFridayIso(new Date(2026, 6, 24, 23, 55)), "2026-07-31");
});
