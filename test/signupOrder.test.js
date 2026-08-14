import assert from "node:assert/strict";
import test from "node:test";

import { sortBySignupOrder } from "../supabase/functions/_shared/signupOrder.js";

test("member and LINE rosters keep signup order instead of alphabetical order", () => {
  const rows = [
    { id: "signup-c", member_id: "member-c", name: "Aunko", created_at: "2026-08-14T14:03:00.000Z" },
    { id: "signup-a", member_id: "member-a", name: "เซ็นเตอร์", created_at: "2026-08-14T14:01:00.000Z" },
    { id: "signup-b", member_id: "member-b", name: "บอย", created_at: "2026-08-14T14:02:00.000Z" },
  ];

  assert.deepEqual(sortBySignupOrder(rows).map((row) => row.name), ["เซ็นเตอร์", "บอย", "Aunko"]);
});

test("signup order remains deterministic when timestamps are equal", () => {
  const rows = [
    { id: "signup-b", created_at: "2026-08-14T14:01:00.000Z" },
    { id: "signup-a", created_at: "2026-08-14T14:01:00.000Z" },
  ];

  assert.deepEqual(sortBySignupOrder(rows).map((row) => row.id), ["signup-a", "signup-b"]);
});

test("LINE roster obeys the explicit signup sequence even when input is reversed", () => {
  const rows = [
    { name: "ล่าสุด", signupOrder: 3 },
    { name: "คนแรก", signupOrder: 1 },
    { name: "คนที่สอง", signupOrder: 2 },
  ];

  assert.deepEqual(sortBySignupOrder(rows).map((row) => row.name), ["คนแรก", "คนที่สอง", "ล่าสุด"]);
});
