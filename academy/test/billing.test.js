import test from "node:test";
import assert from "node:assert/strict";
import { attendanceSummary, bahtToSatang, buildBillingPreview, calculateCourtShare, validateScore } from "../src/billing.js";

test("court share rounds each attendee up to a whole baht", () => {
  assert.deepEqual(calculateCourtShare(100000, 6), {
    perPersonSatang: 16700,
    collectedSatang: 100200,
    surplusSatang: 200,
  });
});

test("court share is zero when nobody attended", () => {
  assert.deepEqual(calculateCourtShare(120000, 0), {
    perPersonSatang: 0,
    collectedSatang: 0,
    surplusSatang: 0,
  });
});

test("billing includes only present students and keeps personal products separate", () => {
  const preview = buildBillingPreview({
    serviceFeeSatang: 5000,
    courtCostSatang: 100000,
    attendees: [
      { studentId: "a", name: "A", status: "present" },
      { studentId: "b", name: "B", status: "present" },
      { studentId: "c", name: "C", status: "absent" },
    ],
    purchases: [
      { studentId: "a", quantity: 2, unitPriceSatang: 1000 },
      { studentId: "c", quantity: 9, unitPriceSatang: 1000 },
    ],
  });
  assert.equal(preview.rows.length, 2);
  assert.equal(preview.rows[0].totalSatang, 57000);
  assert.equal(preview.rows[1].totalSatang, 55000);
  assert.equal(preview.totalSatang, 112000);
});

test("attendance summary counts no-show only after it is marked absent", () => {
  assert.deepEqual(attendanceSummary([
    { status: "registered", attendance: "present" },
    { status: "registered", attendance: "absent" },
    { status: "registered", attendance: null },
    { status: "cancelled", attendance: null },
  ]), { present: 1, absent: 2 });
});

test("scores respect teacher-defined maximum", () => {
  assert.equal(validateScore(7.5, 10), true);
  assert.equal(validateScore(11, 10), false);
  assert.equal(validateScore(-1, 10), false);
  assert.equal(validateScore(1, 0), false);
});

test("baht conversion avoids floating point storage", () => {
  assert.equal(bahtToSatang(50.25), 5025);
  assert.throws(() => bahtToSatang(-1));
});
