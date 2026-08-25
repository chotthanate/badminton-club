function finiteAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function reconcileSlipAmount(submittedAmount, expectedAmount, ocrText) {
  const submitted = finiteAmount(submittedAmount);
  const expected = finiteAmount(expectedAmount);
  if (submitted === null || expected === null || expected <= 0) {
    return { amount: submitted, decimalPointRecovered: false };
  }
  if (Math.abs(submitted - expected) < 0.009) {
    return { amount: submitted, decimalPointRecovered: false };
  }
  if (Math.abs(submitted - (expected * 100)) >= 0.009) {
    return { amount: submitted, decimalPointRecovered: false };
  }

  const lines = String(ocrText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const submittedDigits = String(Math.round(submitted));
  const hasSafeDecimalLossEvidence = lines.some((line) => {
    if (!new RegExp(`(^|\\D)${submittedDigits}(?![\\d.,])`).test(line)) return false;
    const isExcluded = /ค่าธรรมเนียม|ค่าบริการ|fee|บัญชี|account|เลข(?:ที่)?(?:รายการ|อ้างอิง)|รหัสอ้างอิง|หมายเลขอ้างอิง|transaction|reference|ref\.?|x{2,}|\*{2,}|ยอดคงเหลือ|คงเหลือ|วงเงิน|balance|available|วันที่|date|เวลา|time/i.test(line);
    if (isExcluded) return false;
    const hasAmountContext = /จำนวนเงิน|ยอดเงิน|ยอดโอน|ยอดชำระ|amount|total|บาท|baht|thb|฿/i.test(line);
    const isStandalone = new RegExp(`^(?:ยอด\\s*)?(?:฿|thb)?\\s*${submittedDigits}\\s*(?:บาท|thb)?$`, "i").test(line);
    return hasAmountContext || isStandalone;
  });

  return hasSafeDecimalLossEvidence
    ? { amount: expected, decimalPointRecovered: true }
    : { amount: submitted, decimalPointRecovered: false };
}
