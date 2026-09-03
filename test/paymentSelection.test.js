import assert from "node:assert/strict";
import test from "node:test";
import { selectedPaymentExtras, selectedPaymentRows, selectedPaymentTotal } from "../src/paymentSelection.js";

const beneficiaries = [
  { id: "member-a", name: "เอ", payments: [{ id: "a-1", amount: 186 }, { id: "a-2", amount: 120 }] },
  { id: "member-b", name: "บี", payments: [{ id: "b-1", amount: 144 }] },
];

test("รวมยอดหลายรอบของหลายผู้เล่นเป็นยอดโอนเดียว", () => {
  assert.equal(selectedPaymentTotal(beneficiaries, ["a-1", "b-1"]), 330);
  assert.deepEqual(
    selectedPaymentRows(beneficiaries, ["a-1", "b-1"]).map((row) => row.memberId),
    ["member-a", "member-b"],
  );
});

test("ไม่รวมยอดของรอบที่ไม่ได้เลือก", () => {
  assert.equal(selectedPaymentTotal(beneficiaries, ["a-2"]), 120);
});

test("รวมรายละเอียดค่าน้ำและขนมเฉพาะรอบที่เลือก", () => {
  const rows = [{ id: "p1", name: "บอย", payments: [
    { id: "r1", amount: 150, extrasAmount: 20, extras: [{ name: "น้ำ", quantity: 2, amount: 20 }] },
    { id: "r2", amount: 170, extrasAmount: 25, extras: [{ name: "น้ำ", quantity: 1, amount: 10 }, { name: "ขนม", quantity: 1, amount: 15 }] },
  ] }];
  assert.deepEqual(selectedPaymentExtras(rows, ["r1", "r2"]), {
    total: 45,
    items: [
      { name: "น้ำ", quantity: 3, amount: 30 },
      { name: "ขนม", quantity: 1, amount: 15 },
    ],
  });
});
