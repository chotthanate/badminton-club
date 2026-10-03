import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("src/BadmintonApp.jsx", "utf8");

test("ผู้เล่นกลับก่อนได้โดยไม่บังคับบันทึกจำนวนลูกแบด", () => {
  assert.match(app, /ลงเวลากลับอย่างเดียว/);
  assert.match(app, /submitPendingDeparture\(false\)/);
  assert.match(app, /cumulativeCount:\s*includeShuttlecockCount\s*\?\s*pendingDeparture\.cumulativeCount\s*:\s*null/);
});

test("โหมดคิดตามจำนวนรอบสร้าง Snapshot เฉพาะเมื่อส่งจำนวนลูก", () => {
  assert.match(app, /event\.billingModel === "per_round" && leftAt && cumulativeCount !== null/);
  assert.match(app, /patch:\s*\{ arrived: true, arrived_at: plannedArrival, left_at: leftAt \|\| null \}/);
});
