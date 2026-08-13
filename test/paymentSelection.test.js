import assert from "node:assert/strict";
import test from "node:test";
import { selectedPaymentRows, selectedPaymentTotal } from "../src/paymentSelection.js";

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
