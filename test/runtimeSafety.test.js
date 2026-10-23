import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("หลังบ้านใช้คิวบันทึกแทนการทิ้งคำสั่งถัดไป และกันการบันทึกออฟไลน์", () => {
  const source = fs.readFileSync(new URL("../src/BadmintonApp.jsx", import.meta.url), "utf8");
  assert.ok(source.includes("if (!navigator.onLine)"));
  assert.ok(source.includes("mutationsRef.current.enqueue(options.actionKey"));
  assert.ok(!source.includes("if (savingRef.current) return false"));
  // Sequencing, duplicate taps and error recovery are behavior-tested in mutationQueue.test.js.
});

test("หน้าคิวสดแยกสถานะไม่มีรอบออกจากข้อผิดพลาด", () => {
  const appSource = fs.readFileSync(new URL("../src/LiveQueueApp.jsx", import.meta.url), "utf8");
  const apiSource = fs.readFileSync(new URL("../supabase/functions/line-bot/index.ts", import.meta.url), "utf8");
  assert.match(appSource, /error \? tr\("โหลดข้อมูลไม่สำเร็จ"/);
  assert.match(apiSource, /event: null, courts: \[\], upcoming: \[\]/);
});

test("service worker ไม่ดักหรือแคชคำขอ Supabase ข้าม origin", () => {
  const source = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(source, /requestUrl\.origin !== self\.location\.origin/);
  assert.match(source, /event\.request\.mode === "navigate"/);
});
