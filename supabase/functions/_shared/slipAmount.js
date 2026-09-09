function finiteAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function reconcileSlipAmount(submittedAmount, expectedAmount, ocrText) {
  const submitted = finiteAmount(submittedAmount);
  const expected = finiteAmount(expectedAmount);
  if (expected === null || expected <= 0) {
    return { amount: submitted, decimalPointRecovered: false };
  }
  const safeOcrMatch = findSafeExpectedAmount(ocrText, expected);
  if (safeOcrMatch) {
    return { amount: expected, decimalPointRecovered: safeOcrMatch.decimalPointRecovered };
  }
  if (submitted === null) {
    return { amount: null, decimalPointRecovered: false };
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

function findSafeExpectedAmount(ocrText, expected) {
  const lines = String(ocrText || "")
    .normalize("NFKC")
    .replace(/\u0e4d\u0e32/g, "\u0e33")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const expectedTimesOneHundred = Math.round(expected * 100);

  for (const line of lines) {
    const isExcluded = /ค่าธรรมเนียม|ค่าบริการ|fee|บัญชี|account|เลข(?:ที่)?(?:รายการ|อ้างอิง)|รหัสอ้างอิง|หมายเลขอ้างอิง|transaction|reference|ref\.?|x{2,}|\*{2,}|ยอดคงเหลือ|คงเหลือ|วงเงิน|balance|available|วันที่|date|เวลา|time/i.test(line);
    if (isExcluded) continue;
    const hasAmountContext = /จำนวน(?:เงิน)?|ยอดเงิน|ยอดโอน|ยอดชำระ|amount|total|บาท|baht|thb|฿/i.test(line);
    const isStandalone = /^(?:ยอด\s*)?(?:฿|thb)?\s*\d+(?:[.,]\d{1,2})?\s*(?:บาท|thb)?$/i.test(line);
    if (!hasAmountContext && !isStandalone) continue;

    const matches = line.match(/\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/g) || [];
    for (const value of matches) {
      const amount = Number(value.replace(/,/g, ""));
      if (Number.isFinite(amount) && Math.abs(amount - expected) < 0.009) {
        return { decimalPointRecovered: false };
      }
      if (!/[.,]/.test(value) && Number(value) === expectedTimesOneHundred) {
        return { decimalPointRecovered: true };
      }
    }
  }
  return null;
}
