import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appUrl = new URL("../src/AppV2.jsx", import.meta.url);
const mainUrl = new URL("../src/main.jsx", import.meta.url);

test("Academy uses the detailed navigation and the dedicated today-player workflow", async () => {
  const source = await readFile(appUrl, "utf8");
  assert.match(source, /"players", "เช็กชื่อ"/);
  assert.match(source, /"classes", "คลาส"/);
  assert.match(source, /"payments", "ชำระเงิน"/);
  assert.match(source, /"students", "นักเรียน"/);
  assert.doesNotMatch(source, /PageTitle title="เช็กชื่อ"/);
  assert.match(source, /className="checkin-session"/);
  assert.match(source, /type="checkbox" checked=\{entry\.attendance === "present"\}/);
  assert.match(source, /function SessionContext/);
  assert.doesNotMatch(source, /arrivalTime|departureTime/);
});

test("class creation has the requested venue and time defaults", async () => {
  const source = await readFile(appUrl, "utf8");
  assert.match(source, /สนามแบดมินตันเขาน้อย \(สนามใหม่\)/);
  assert.match(source, /startTime: "21:00"/);
  assert.match(source, /endTime: "23:00"/);
  assert.match(source, /ค่าเรียนต่อคน/);
  assert.match(source, /เพิ่มสนามใหม่/);
  assert.match(source, /แก้ย้อนหลังไม่ได้/);
});

test("classes render expandable lesson cards and the entry point uses the new app", async () => {
  const [source, main] = await Promise.all([readFile(appUrl, "utf8"), readFile(mainUrl, "utf8")]);
  assert.match(source, /function LessonCard/);
  assert.match(source, /เพิ่มหัวข้อเรียน/);
  assert.match(source, /บันทึกคะแนน/);
  assert.match(main, /\.\/AppV2\.jsx/);
});

test("admin and student payment experiences are separated", async () => {
  const source = await readFile(appUrl, "utf8");
  assert.match(source, /function AdminPayments/);
  assert.match(source, /ยอดค้างรวม/);
  assert.match(source, /รับเงินแบบ Manual แยกรายวัน/);
  assert.match(source, /repository\.markInvoicePaid/);
  assert.match(source, /function StudentPayments/);
  assert.match(source, /แนบสลิปและส่งตรวจ/);
});

test("student cancellation, refreshments, expenses and profiles use the compact flows", async () => {
  const source = await readFile(appUrl, "utf8");
  assert.match(source, /ยืนยันยกเลิกการลงชื่อคลาสวันที่/);
  assert.match(source, /className="quantity-stepper"/);
  assert.match(source, /function Expenses/);
  assert.match(source, /session\.date === todayIso\(\)/);
  assert.match(source, /function StudentDetailModal/);
});
