import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appUrl = new URL("../src/AppV2.jsx", import.meta.url);
const mainUrl = new URL("../src/main.jsx", import.meta.url);

test("Academy uses the detailed navigation and the dedicated today-player workflow", async () => {
  const source = await readFile(appUrl, "utf8");
  assert.match(source, /"players", "ผู้เล่นวันนี้"/);
  assert.match(source, /"classes", "คลาส"/);
  assert.match(source, /"payments", "ชำระเงิน"/);
  assert.match(source, /"students", "นักเรียน"/);
  assert.match(source, /เช็กชื่อ เพิ่มคน และบวกน้ำขนมเท่านั้น/);
  assert.doesNotMatch(source, /arrivalTime|departureTime/);
});

test("class creation has the requested venue and time defaults", async () => {
  const source = await readFile(appUrl, "utf8");
  assert.match(source, /สนามแบดมินตันเขาน้อย \(สนามใหม่\)/);
  assert.match(source, /startTime: "21:00"/);
  assert.match(source, /endTime: "23:00"/);
  assert.match(source, /ค่าเรียนต่อคน/);
  assert.match(source, /เพิ่มสนามใหม่/);
  assert.match(source, /กรอกค่าสนามภายหลังได้ก่อนสรุปยอด/);
});

test("classes render expandable lesson cards and the entry point uses the new app", async () => {
  const [source, main] = await Promise.all([readFile(appUrl, "utf8"), readFile(mainUrl, "utf8")]);
  assert.match(source, /function LessonCard/);
  assert.match(source, /เพิ่มหัวข้อเรียน/);
  assert.match(source, /บันทึกคะแนน/);
  assert.match(main, /\.\/AppV2\.jsx/);
});
