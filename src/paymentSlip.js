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

export function parseSlipText(text) {
  const source = String(text || "").replace(/[๐-๙]/g, (digit) => String("๐๑๒๓๔๕๖๗๘๙".indexOf(digit)));
  return {
    amount: parseSlipAmount(source),
    date: parseSlipDate(source),
  };
}

export function parseSlipAmount(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const preferred = lines.filter((line) => /จำนวนเงิน|ยอดเงิน|ยอดโอน|amount|total|บาท|thb/i.test(line));
  const candidates = [...preferred, ...lines].flatMap((line, lineIndex) => {
    const matches = line.match(/\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/g) || [];
    return matches.map((value) => ({
      value: Number(value.replace(/,/g, "")),
      priority: lineIndex < preferred.length ? 2 : 1,
      hasMoneyKeyword: /จำนวนเงิน|ยอดเงิน|ยอดโอน|amount|total|บาท|thb/i.test(line),
    }));
  }).filter((entry) => Number.isFinite(entry.value) && entry.value > 0 && entry.value < 1_000_000);
  candidates.sort((left, right) =>
    Number(right.hasMoneyKeyword) - Number(left.hasMoneyKeyword)
    || right.priority - left.priority
    || right.value - left.value);
  return candidates[0]?.value ?? null;
}

export function parseSlipDate(text) {
  const source = String(text || "");
  const numeric = /(?:^|\D)(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:\D|$)/.exec(source);
  if (numeric) return isoDate(numeric[1], numeric[2], numeric[3]);

  const monthNames = [...THAI_MONTHS.keys()].sort((left, right) => right.length - left.length)
    .map(escapeRegExp).join("|");
  const textual = new RegExp(`(?:^|\\D)(\\d{1,2})\\s*(${monthNames})\\s*(\\d{2,4})(?:\\D|$)`, "i").exec(source);
  if (!textual) return null;
  return isoDate(textual[1], THAI_MONTHS.get(textual[2].toLowerCase()), textual[3]);
}

export async function recognizeSlip(file, onProgress = () => {}) {
  const optimized = await optimizeSlipImage(file);
  const { createWorker } = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/+esm");
  const worker = await createWorker("tha+eng", 1, {
    logger: (message) => {
      if (message.status === "recognizing text") onProgress(Math.round(Number(message.progress || 0) * 100));
    },
  });
  try {
    const result = await worker.recognize(optimized.blob);
    const text = result.data.text || "";
    const parsed = parseSlipText(text);
    return {
      ...parsed,
      confidence: Number(result.data.confidence || 0),
      text,
      dataUrl: optimized.dataUrl,
      mimeType: optimized.blob.type,
      hash: await sha256(optimized.blob),
    };
  } finally {
    await worker.terminate();
  }
}

async function optimizeSlipImage(file) {
  const image = await createImageBitmap(file);
  const maxSide = 1600;
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
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error("เตรียมรูปสลิปไม่สำเร็จ");
  return { blob, dataUrl: await blobToDataUrl(blob) };
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
