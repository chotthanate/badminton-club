import assert from "node:assert/strict";
import test from "node:test";

import { buildOutstandingLineMessage, filterAndSortOutstanding, outstandingAgeInDays } from "../src/outstandingPayments.js";

const groups = [
  { member: { nickname: "ต้น", display_name: "Ton", line_user_id: "U1" }, total: 190, rows: [{ admin_confirmed_at: "2026-09-10T00:00:00Z" }, { admin_confirmed_at: "2026-09-20T00:00:00Z" }] },
  { member: { nickname: "บี", display_name: "" }, total: 300, rows: [{ admin_confirmed_at: "2026-09-18T00:00:00Z" }] },
];

test("กรองผู้เล่น LINE และ Walk-in พร้อมค้นหาชื่อได้", () => {
  assert.deepEqual(filterAndSortOutstanding(groups, { source: "line" }).map((group) => group.member.nickname), ["ต้น"]);
  assert.deepEqual(filterAndSortOutstanding(groups, { source: "walkin", query: "บี" }).map((group) => group.member.nickname), ["บี"]);
});

test("เรียงยอดมากสุดและอายุหนี้เก่าสุด", () => {
  assert.equal(filterAndSortOutstanding(groups, { sort: "amount" })[0].member.nickname, "บี");
  assert.equal(filterAndSortOutstanding(groups, { sort: "oldest" })[0].member.nickname, "ต้น");
  assert.equal(outstandingAgeInDays(groups[0], new Date("2026-09-22T00:00:00Z")), 12);
});

test("สร้างข้อความ LINE รายชื่อและยอดค้างทั้งหมดในข้อความเดียว", () => {
  const message = buildOutstandingLineMessage(groups, 490);
  assert.match(message, /1\. ต้น — 190 บาท \(2 รอบ\)/);
  assert.match(message, /2\. บี — 300 บาท \(1 รอบ\)/);
  assert.match(message, /รวม 2 คน · 3 รอบ · 490 บาท/);
});
