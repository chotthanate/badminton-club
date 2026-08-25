const THAI_MONTHS = new Map([
  ["ม.ค.", 1], ["มค", 1], ["มกราคม", 1],
  ["ก.พ.", 2], ["กพ", 2], ["กุมภาพันธ์", 2],
  ["มี.ค.", 3], ["มีค", 3], ["มีนาคม", 3],
  ["เม.ย.", 4], ["เมย", 4], ["เมษายน", 4],
  ["พ.ค.", 5], ["พค", 5], ["พฤษภาคม", 5],
  ["มิ.ย.", 6], ["มิย", 6], ["มิถุนายน", 6],
  ["ก.ค.", 7], ["กค", 7], ["กรกฎาคม", 7],
  ["ส.ค.", 8], ["สค", 8], ["สิงหาคม", 8],
  ["ก.ย.", 9], ["กย", 9], ["กันยายน", 9],
  ["ต.ค.", 10], ["ตค", 10], ["ตุลาคม", 10],
  ["พ.ย.", 11], ["พย", 11], ["พฤศจิกายน", 11],
  ["ธ.ค.", 12], ["ธค", 12], ["ธันวาคม", 12],
]);

const ENGLISH_MONTHS = new Map([
  ["jan", 1], ["january", 1], ["feb", 2], ["february", 2],
  ["mar", 3], ["march", 3], ["apr", 4], ["april", 4],
  ["may", 5], ["jun", 6], ["june", 6], ["jul", 7], ["july", 7],
  ["aug", 8], ["august", 8], ["sep", 9], ["sept", 9], ["september", 9],
  ["oct", 10], ["october", 10], ["nov", 11], ["november", 11],
  ["dec", 12], ["december", 12],
]);

const SLIP_MONTHS = new Map([...THAI_MONTHS, ...ENGLISH_MONTHS]);

export const PAYMENT_RECIPIENT_NAME = "นาย ณฐกฤต อินนะใจ";

export function buildSlipRoundBreakdown(paymentIds = [], paymentsById = new Map()) {
  const uniquePaymentIds = [...new Set(Array.isArray(paymentIds) ? paymentIds : [])];
  const roundsByEvent = new Map();
  let resolvedPaymentCount = 0;
  let paidPaymentCount = 0;

  uniquePaymentIds.forEach((paymentId) => {
    const payment = paymentsById instanceof Map ? paymentsById.get(paymentId) : paymentsById?.[paymentId];
    if (!payment) return;
    resolvedPaymentCount += 1;
    if (payment.paid_at) paidPaymentCount += 1;
    const relatedEvent = Array.isArray(payment.events) ? payment.events[0] : payment.events;
    if (!relatedEvent || !payment.event_id) return;
    const existing = roundsByEvent.get(payment.event_id) || {
      id: payment.event_id,
      date: relatedEvent.event_date,
      venue: relatedEvent.venue,
      amount: 0,
    };
    existing.amount += Math.max(0, Number(payment.amount) || 0);
    roundsByEvent.set(payment.event_id, existing);
  });

  return {
    rounds: [...roundsByEvent.values()].sort((left, right) => String(left.date || "").localeCompare(String(right.date || ""))),
    allPaymentsPaid: uniquePaymentIds.length > 0
      && resolvedPaymentCount === uniquePaymentIds.length
      && paidPaymentCount === uniquePaymentIds.length,
    hasMissingPaymentData: uniquePaymentIds.length === 0 || resolvedPaymentCount !== uniquePaymentIds.length,
  };
}

export function slipRecipientMatches(text) {
  return classifySlipRecipient(text) === "match";
}

export function classifySlipRecipient(text) {
  const source = String(text || "").normalize("NFKC");
  const normalized = normalizeRecipientText(source);
  const recipientNames = ["ณฐกฤตอินนะใจ", "nathakritinnajai"];
  if (recipientNames.some((name) => normalized.includes(name)
    || containsApproximateText(normalized, name, 2))) return "match";

  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const recipientMarker = /(บัญชีผู้รับ|ผู้รับ|ไปยัง|recipient|receiver|transfer(?:red)?\s+to)/i;
  for (let index = 0; index < lines.length; index += 1) {
    if (!recipientMarker.test(lines[index])) continue;
    const context = lines.slice(index, index + 3).join(" ").replace(recipientMarker, " ");
    const normalizedContext = normalizeRecipientText(context);
    if (normalizedContext.includes("ณฐกฤตอินนะใจ")) return "match";
    if (normalizedContext.includes("ณฐกฤต") || normalizedContext.includes("อินนะใจ")) return "unclear";
    if (/(นาย|นางสาว|นาง|น\.?\s*ส\.?|คุณ|บริษัท|ห้างหุ้นส่วน)/i.test(context)
      && (context.match(/[ก-๙]/g) || []).length >= 7) {
      return "mismatch";
    }
  }
  return "unclear";
}

function normalizeRecipientText(text) {
  const normalized = String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^ก-๙a-z0-9]/g, "");
  return normalized;
}

function containsApproximateText(source, expected, maxDistance) {
  if (!source || !expected) return false;
  const minimumLength = Math.max(1, expected.length - maxDistance);
  const maximumLength = expected.length + maxDistance;
  for (let length = minimumLength; length <= maximumLength; length += 1) {
    for (let index = 0; index + length <= source.length; index += 1) {
      if (levenshteinWithin(source.slice(index, index + length), expected, maxDistance)) return true;
    }
  }
  return false;
}

function levenshteinWithin(left, right, maxDistance) {
  if (Math.abs(left.length - right.length) > maxDistance) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] + Number(left[leftIndex - 1] !== right[rightIndex - 1]);
      current[rightIndex] = Math.min(previous[rightIndex] + 1, current[rightIndex - 1] + 1, substitution);
    }
    previous = current;
  }
  return previous[right.length] <= maxDistance;
}

export function parseSlipText(text, expectedAmount = null) {
  const source = String(text || "").replace(/[๐-๙]/g, (digit) => String("๐๑๒๓๔๕๖๗๘๙".indexOf(digit)));
  return {
    amount: parseSlipAmount(source, expectedAmount),
    date: parseSlipDate(source),
    reference: parseSlipReference(source),
  };
}

export function parseSlipAmount(text, expectedAmount = null) {
  const normalizedExpectedAmount = Number(expectedAmount);
  const hasExpectedAmount = Number.isFinite(normalizedExpectedAmount) && normalizedExpectedAmount > 0;
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidates = lines.flatMap((originalLine, lineIndex) => {
    const line = originalLine.replace(/(\d)\s*\.\s*(\d{1,2})(?!\d)/g, "$1.$2");
    const matches = line.match(/\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/g) || [];
    const hasAmountLabel = /จำนวนเงิน|ยอดเงิน|ยอดโอน|ยอดชำระ|amount|total/i.test(line);
    const hasCurrency = /บาท|บา[ทต]|บท|baht|thb|฿/i.test(line);
    const isStandaloneAmount = /^(?:ยอด\s*)?(?:฿|thb)?\s*(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d{1,2})?\s*(?:บาท|thb)?$/i.test(line);
    const isFee = /ค่าธรรมเนียม|ค่าบริการ|fee/i.test(line);
    const isAccountOrReference = /บัญชี|account|เลข(?:ที่)?(?:รายการ|อ้างอิง)|รหัสอ้างอิง|หมายเลขอ้างอิง|transaction|reference|ref\.?|x{2,}|\*{2,}/i.test(line);
    const isDateOrTime = /วันที่|date|เวลา|time|\d{1,2}:\d{2}|\d{1,2}\s*(?:ม\.|ก\.|ส\.|เม\.|มิ\.|ต\.|พ\.|ธ\.)|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/i.test(line);
    const isBalance = /ยอดคงเหลือ|คงเหลือ|วงเงิน|balance|available/i.test(line);
    return matches.map((value) => {
      const number = Number(value.replace(/,/g, ""));
      // Mobile OCR commonly drops the decimal point from a large isolated bank
      // amount (for example 100.00 becomes 10000). Only repair that specific
      // shape when the selected payment total supplies an exact, safe hint.
      const decimalPointWasDropped = hasExpectedAmount
        && !/[.,]/.test(value)
        && Math.abs(number - (normalizedExpectedAmount * 100)) < 0.009
        && (hasAmountLabel || hasCurrency || isStandaloneAmount)
        && !isFee
        && !isAccountOrReference
        && !isDateOrTime
        && !isBalance;
      const normalizedNumber = decimalPointWasDropped ? normalizedExpectedAmount : number;
      const matchesExpected = hasExpectedAmount
        && Math.abs(normalizedNumber - normalizedExpectedAmount) < 0.009;
      const safeExpectedMatch = matchesExpected
        && !isFee
        && !isAccountOrReference
        && !isDateOrTime
        && !isBalance;
      return {
        value: normalizedNumber,
        lineIndex,
        matchesExpected,
        safeExpectedMatch,
        score: (hasAmountLabel ? 120 : 0)
          + (hasCurrency ? 55 : 0)
          + (isStandaloneAmount ? 90 : 0)
          + (value.includes(".") ? 20 : 0)
          + (safeExpectedMatch ? 80 : 0)
          - (isFee ? 250 : 0)
          - (isAccountOrReference ? 250 : 0)
          - (isDateOrTime ? 180 : 0)
          - (isBalance ? 250 : 0),
      };
    });
  }).filter((entry) => Number.isFinite(entry.value)
    && entry.value > 0
    && entry.value < 1_000_000
    && (entry.score >= 55 || entry.safeExpectedMatch));
  candidates.sort((left, right) =>
    Number(right.matchesExpected) - Number(left.matchesExpected)
    || right.score - left.score
    || left.lineIndex - right.lineIndex);
  return candidates[0]?.value ?? null;
}

export function parseSlipDate(text) {
  const source = String(text || "")
    // OCR sometimes places a stray Thai vowel between the July abbreviation.
    .replace(/ก\s*\.\s*[ุู]\s*ค\s*\./g, "ก.ค.");
  const numeric = /(?:^|\D)(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:\D|$)/.exec(source);
  if (numeric) return isoDate(numeric[1], numeric[2], numeric[3]);

  const monthNames = [...SLIP_MONTHS.keys()].sort((left, right) => right.length - left.length)
    .map(escapeRegExp).join("|");
  const textual = new RegExp(`(?:^|\\D)(\\d{1,2})\\s*(${monthNames})\\s*(\\d{2,4})(?:\\D|$)`, "i").exec(source);
  if (!textual) return null;
  return isoDate(textual[1], SLIP_MONTHS.get(textual[2].toLowerCase()), textual[3]);
}

export function parseSlipReference(text) {
  const source = String(text || "").normalize("NFKC");
  const marker = /(?:เลขที่(?:รายการ|อ้างอิง)|รหัสอ้างอิง|หมายเลขอ้างอิง|transaction\s*(?:id|no\.?|number)|reference\s*(?:id|no\.?|number)?|ref(?:erence)?\.?)/ig;
  let match;
  while ((match = marker.exec(source))) {
    const nearby = source.slice(match.index + match[0].length, match.index + match[0].length + 90);
    const candidate = /[:#\-\s]*([A-Z0-9][A-Z0-9\-]{5,49})/i.exec(nearby)?.[1];
    const normalized = normalizeSlipReference(candidate);
    if (normalized) return normalized;
  }
  return null;
}

export function normalizeSlipReference(value) {
  const normalized = String(value || "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized.length >= 6 && normalized.length <= 50 ? normalized : null;
}

export async function recognizeSlip(file, onProgress = () => {}, expectedAmount = null) {
  const optimized = await optimizeSlipImage(file);
  const { createWorker } = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/+esm");
  const worker = await createWorker("tha+eng", 1, {
    logger: (message) => {
      if (message.status === "recognizing text") onProgress(Math.round(Number(message.progress || 0) * 100));
    },
  });
  try {
    const result = await worker.recognize(optimized.blob);
    let text = result.data.text || "";
    let confidence = Number(result.data.confidence || 0);
    let parsed = parseSlipText(text, expectedAmount);
    const amountDoesNotMatchExpected = Number.isFinite(Number(expectedAmount))
      && parsed.amount !== null
      && Math.abs(Number(parsed.amount) - Number(expectedAmount)) >= 0.009;
    const needsRetry = parsed.amount === null
      || amountDoesNotMatchExpected
      || parsed.date === null
      || parsed.reference === null
      || classifySlipRecipient(text) !== "match";
    if (needsRetry && optimized.retryBlob) {
      onProgress(0);
      const retryResult = await worker.recognize(optimized.retryBlob);
      const retryText = retryResult.data.text || "";
      const retryParsed = parseSlipText(retryText, expectedAmount);
      text = [text, retryText].filter(Boolean).join("\n");
      confidence = Math.max(confidence, Number(retryResult.data.confidence || 0));
      parsed = {
        amount: chooseRecognizedAmount(parsed.amount, retryParsed.amount, expectedAmount),
        date: parsed.date ?? retryParsed.date,
        reference: parsed.reference ?? retryParsed.reference,
      };
    }
    const shouldReadAmountCrop = parsed.amount === null
      || (Number.isFinite(Number(expectedAmount))
        && Math.abs(Number(parsed.amount) - Number(expectedAmount)) >= 0.009);
    if (shouldReadAmountCrop && optimized.amountBlob) {
      onProgress(0);
      await worker.setParameters({ tessedit_pageseg_mode: "6" });
      const amountResult = await worker.recognize(optimized.amountBlob);
      const amountText = amountResult.data.text || "";
      text = [text, amountText].filter(Boolean).join("\n");
      confidence = Math.max(confidence, Number(amountResult.data.confidence || 0));
      parsed.amount = chooseRecognizedAmount(parsed.amount, parseSlipAmount(amountText, expectedAmount), expectedAmount);
    }
    if (parsed.date === null && optimized.dateBlob) {
      onProgress(0);
      await worker.setParameters({ tessedit_pageseg_mode: "6" });
      const dateResult = await worker.recognize(optimized.dateBlob);
      const dateText = dateResult.data.text || "";
      text = [text, dateText].filter(Boolean).join("\n");
      confidence = Math.max(confidence, Number(dateResult.data.confidence || 0));
      parsed.date = parseSlipDate(dateText);
      parsed.reference ??= parseSlipReference(dateText);
    }
    return {
      ...parsed,
      confidence,
      text,
      dataUrl: optimized.dataUrl,
      mimeType: optimized.blob.type,
      hash: await sha256(optimized.blob),
    };
  } finally {
    await worker.terminate();
  }
}

function chooseRecognizedAmount(currentAmount, candidateAmount, expectedAmount) {
  const expected = Number(expectedAmount);
  if (Number.isFinite(expected) && expected > 0) {
    if (candidateAmount !== null && Math.abs(Number(candidateAmount) - expected) < 0.009) return candidateAmount;
    if (currentAmount !== null && Math.abs(Number(currentAmount) - expected) < 0.009) return currentAmount;
  }
  return currentAmount ?? candidateAmount;
}

async function optimizeSlipImage(file) {
  const image = await createImageBitmap(file);
  const maxSide = 2000;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  image.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("เตรียมรูปสลิปไม่สำเร็จ");

  const cropHeight = Math.max(1, Math.round(height * 0.62));
  const retryScale = Math.min(2, 1500 / width);
  const retryCanvas = document.createElement("canvas");
  retryCanvas.width = Math.max(1, Math.round(width * retryScale));
  retryCanvas.height = Math.max(1, Math.round(cropHeight * retryScale));
  const retryContext = retryCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
  retryContext.fillStyle = "#fff";
  retryContext.fillRect(0, 0, retryCanvas.width, retryCanvas.height);
  retryContext.drawImage(canvas, 0, 0, width, cropHeight, 0, 0, retryCanvas.width, retryCanvas.height);
  enhanceMonochromeContrast(retryContext, retryCanvas.width, retryCanvas.height);
  const retryBlob = await new Promise((resolve) => retryCanvas.toBlob(resolve, "image/png"));

  // Several Thai bank slips render the transfer amount as a large isolated line
  // over a patterned background. Whole-page OCR may skip it even when the rest of
  // the slip is readable, so keep a tighter header crop for a final amount-only pass.
  const amountSourceX = Math.round(width * 0.07);
  const amountSourceY = Math.round(height * 0.04);
  const amountSourceWidth = Math.max(1, Math.round(width * 0.86));
  const amountSourceHeight = Math.max(1, Math.round(height * 0.29));
  const amountScale = Math.min(2.5, 1500 / amountSourceWidth);
  const amountCanvas = document.createElement("canvas");
  amountCanvas.width = Math.max(1, Math.round(amountSourceWidth * amountScale));
  amountCanvas.height = Math.max(1, Math.round(amountSourceHeight * amountScale));
  const amountContext = amountCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
  amountContext.fillStyle = "#fff";
  amountContext.fillRect(0, 0, amountCanvas.width, amountCanvas.height);
  amountContext.drawImage(
    canvas,
    amountSourceX,
    amountSourceY,
    amountSourceWidth,
    amountSourceHeight,
    0,
    0,
    amountCanvas.width,
    amountCanvas.height,
  );
  enhanceMonochromeContrast(amountContext, amountCanvas.width, amountCanvas.height);
  const amountBlob = await new Promise((resolve) => amountCanvas.toBlob(resolve, "image/png"));

  const dateSourceY = Math.round(height * 0.56);
  const dateSourceHeight = Math.max(1, height - dateSourceY);
  const dateScale = Math.min(2, 1500 / width);
  const dateCanvas = document.createElement("canvas");
  dateCanvas.width = Math.max(1, Math.round(width * dateScale));
  dateCanvas.height = Math.max(1, Math.round(dateSourceHeight * dateScale));
  const dateContext = dateCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
  dateContext.fillStyle = "#fff";
  dateContext.fillRect(0, 0, dateCanvas.width, dateCanvas.height);
  dateContext.drawImage(canvas, 0, dateSourceY, width, dateSourceHeight, 0, 0, dateCanvas.width, dateCanvas.height);
  enhanceMonochromeContrast(dateContext, dateCanvas.width, dateCanvas.height);
  const dateBlob = await new Promise((resolve) => dateCanvas.toBlob(resolve, "image/png"));
  return { blob, retryBlob, amountBlob, dateBlob, dataUrl: await blobToDataUrl(blob) };
}

function enhanceMonochromeContrast(context, width, height) {
  try {
    const imageData = context.getImageData(0, 0, width, height);
    const pixels = imageData.data;
    for (let index = 0; index < pixels.length; index += 4) {
      const luminance = (pixels[index] * 0.299) + (pixels[index + 1] * 0.587) + (pixels[index + 2] * 0.114);
      const contrasted = Math.max(0, Math.min(255, ((luminance - 128) * 1.65) + 128));
      pixels[index] = contrasted;
      pixels[index + 1] = contrasted;
      pixels[index + 2] = contrasted;
    }
    context.putImageData(imageData, 0, 0);
  } catch {
    // The enlarged crop still helps when a browser cannot expose canvas pixels.
  }
}

function isoDate(dayValue, monthValue, yearValue) {
  const day = Number(dayValue);
  const month = Number(monthValue);
  let year = Number(yearValue);
  if (year < 100) year += year >= 50 ? 2500 : 2000;
  if (year > 2400) year -= 543;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("อ่านรูปสลิปไม่สำเร็จ"));
    reader.readAsDataURL(blob);
  });
}

async function sha256(blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
