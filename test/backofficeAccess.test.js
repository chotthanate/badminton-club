import assert from "node:assert/strict";
import test from "node:test";

import { authenticateBackofficeCode } from "../src/backofficeAuth.js";
import { selectStaffWorkspace } from "../src/staffWorkspace.js";

test("รหัสเจ้าของเข้าสู่ระบบได้โดยไม่เรียกการเข้าสู่ระบบสตาฟ", async () => {
  let staffCalled = false;
  const role = await authenticateBackofficeCode("owner-code", {
    signInOwner: async () => ({ error: null }),
    signInStaff: async () => { staffCalled = true; },
  });

  assert.equal(role, "admin");
  assert.equal(staffCalled, false);
});

test("ถ้ารหัสไม่ตรงกับเจ้าของ ระบบลองเข้าสู่ระบบสตาฟให้อัตโนมัติ", async () => {
  let receivedCode = "";
  const role = await authenticateBackofficeCode("staff-code", {
    signInOwner: async () => ({ error: new Error("invalid") }),
    signInStaff: async (code) => { receivedCode = code; },
  });

  assert.equal(role, "staff");
  assert.equal(receivedCode, "staff-code");
});

const productionContext = { role: "staff", club_id: "production", clubs: { name: "กลุ่มจริง", is_test: false } };
const testContext = { role: "staff", club_id: "test", clubs: { name: "กลุ่มทดลอง", is_test: true } };

test("สตาฟเห็นรอบทดลองอัตโนมัติเมื่อรอบจริงยังไม่เปิด", () => {
  const selected = selectStaffWorkspace(
    [productionContext, testContext],
    { production: { event: null }, test: { event: { id: "test-event" } } },
  );

  assert.equal(selected.context.club_id, "test");
  assert.equal(selected.dashboard.event.id, "test-event");
});

test("ถ้ารอบจริงและรอบทดลองเปิดพร้อมกัน ระบบให้สตาฟเข้ารอบจริงก่อน", () => {
  const selected = selectStaffWorkspace(
    [testContext, productionContext],
    { production: { event: { id: "live-event" } }, test: { event: { id: "test-event" } } },
  );

  assert.equal(selected.context.club_id, "production");
  assert.equal(selected.dashboard.event.id, "live-event");
});

test("ระบบยังเลือกกลุ่มที่ระบุได้เมื่อจำเป็น", () => {
  const selected = selectStaffWorkspace(
    [productionContext, testContext],
    { production: { event: { id: "live-event" } }, test: { event: { id: "test-event" } } },
    "test",
  );

  assert.equal(selected.context.club_id, "test");
});
