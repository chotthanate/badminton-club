import assert from "node:assert/strict";
import test from "node:test";

import { reconcileSlipAmount } from "../supabase/functions/_shared/slipAmount.js";

test("server recovers a decimal point dropped by cached client OCR", () => {
  assert.deepEqual(
    reconcileSlipAmount(10000, 100, "รายการโอนเงินสำเร็จ\nจำนวนเงิน\n10000\n14 ส.ค. 2569"),
    { amount: 100, decimalPointRecovered: true },
  );
});

test("server never repairs an unrelated reference, fee, or different amount", () => {
  assert.deepEqual(
    reconcileSlipAmount(10000, 100, "เลขอ้างอิง 10000\nค่าธรรมเนียม 10000"),
    { amount: 10000, decimalPointRecovered: false },
  );
  assert.deepEqual(
    reconcileSlipAmount(900, 100, "ยอดเงิน 900"),
    { amount: 900, decimalPointRecovered: false },
  );
});

test("server recovers an SCB amount from a decomposed Thai amount label", () => {
  assert.deepEqual(
    reconcileSlipAmount(null, 390, [
      "โอนเงินสําเร็จ",
      "09 ก.ย. 2569 - 13:30",
      "รหัสอ้างอิง: 202609093Hpib22hyAi9Y2ZzF",
      "จํานวนเงิน                                  390.00",
    ].join("\n")),
    { amount: 390, decimalPointRecovered: false },
  );
});

test("server does not mistake account or reference numbers for a missing amount", () => {
  assert.deepEqual(
    reconcileSlipAmount(null, 390, [
      "รหัสอ้างอิง: 390",
      "เลขบัญชี 390",
      "ค่าธรรมเนียม 0.00 บาท",
    ].join("\n")),
    { amount: null, decimalPointRecovered: false },
  );
});
