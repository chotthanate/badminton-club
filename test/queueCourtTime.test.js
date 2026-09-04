import test from "node:test";
import assert from "node:assert/strict";
import { courtTimeStatus } from "../src/queueCourtTime.js";

const court = {
  eventDate: "2026-09-04",
  eventStartTime: "21:00",
  courtStartTime: "21:00",
  courtEndTime: "01:00",
};

test("คอร์ทข้ามเที่ยงคืนยังใช้งานได้ก่อนเวลาจบ", () => {
  assert.equal(courtTimeStatus({ ...court, now: "2026-09-04T17:17:00Z" }), "active");
});

test("คอร์ทข้ามเที่ยงคืนหมดเวลาตอน 01:00 ตามเวลาไทย", () => {
  assert.equal(courtTimeStatus({ ...court, now: "2026-09-04T18:00:00Z" }), "expired");
});

test("คอร์ทที่ยังไม่ถึงเวลาแสดงเป็น upcoming", () => {
  assert.equal(courtTimeStatus({ ...court, courtStartTime: "23:00", now: "2026-09-04T15:00:00Z" }), "upcoming");
});
