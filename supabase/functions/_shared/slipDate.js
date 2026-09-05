const MONTHS = new Map([
  ["ม.ค.", 1], ["มค", 1], ["มกราคม", 1], ["ก.พ.", 2], ["กพ", 2], ["กุมภาพันธ์", 2],
  ["มี.ค.", 3], ["มีค", 3], ["มีนาคม", 3], ["เม.ย.", 4], ["เมย", 4], ["เมษายน", 4],
  ["พ.ค.", 5], ["พค", 5], ["พฤษภาคม", 5], ["มิ.ย.", 6], ["มิย", 6], ["มิถุนายน", 6],
  ["ก.ค.", 7], ["กค", 7], ["กรกฎาคม", 7], ["ส.ค.", 8], ["สค", 8], ["สิงหาคม", 8],
  ["ก.ย.", 9], ["กย", 9], ["กันยายน", 9], ["ต.ค.", 10], ["ตค", 10], ["ตุลาคม", 10],
  ["พ.ย.", 11], ["พย", 11], ["พฤศจิกายน", 11], ["ธ.ค.", 12], ["ธค", 12], ["ธันวาคม", 12],
  ["jan", 1], ["january", 1], ["feb", 2], ["february", 2], ["mar", 3], ["march", 3],
  ["apr", 4], ["april", 4], ["may", 5], ["jun", 6], ["june", 6], ["jul", 7], ["july", 7],
  ["aug", 8], ["august", 8], ["sep", 9], ["sept", 9], ["september", 9], ["oct", 10],
  ["october", 10], ["nov", 11], ["november", 11], ["dec", 12], ["december", 12],
]);

export function parseSlipDateValue(text) {
  const source = String(text || "")
    .replace(/[๐-๙]/g, (digit) => String("๐๑๒๓๔๕๖๗๘๙".indexOf(digit)))
    .replace(/(\d{1,2}\s*)ก\s*\.\s*[ุู]\s*ค\s*\.(\s*\d{2,4})/g, "$1ก.ค.$2")
    // K PLUS screenshots repeatedly OCR ก.ย. as กุย. or กูย.
    .replace(/(\d{1,2}\s*)ก\s*\.?\s*[ุู]\s*ย\s*\.?(\s*\d{2,4})/g, "$1ก.ย.$2");
  const numeric = /(?:^|\D)(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:\D|$)/.exec(source);
  if (numeric) return isoDate(numeric[1], numeric[2], numeric[3]);
  const monthNames = [...MONTHS.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
  const textual = new RegExp(`(?:^|\\D)(\\d{1,2})\\s*(${monthNames})\\s*(\\d{2,4})(?:\\D|$)`, "i").exec(source);
  return textual ? isoDate(textual[1], MONTHS.get(textual[2].toLowerCase()), textual[3]) : null;
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
