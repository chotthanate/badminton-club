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
