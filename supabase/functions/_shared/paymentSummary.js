const courtCollator = new Intl.Collator("th", { numeric: true, sensitivity: "base" });

function courtLabel(value) {
  if (typeof value === "string") return value;
  return String(value?.name || value?.court_name || "");
}

export function compareCourtNames(left, right) {
  return courtCollator.compare(courtLabel(left), courtLabel(right));
}

export function buildPaymentSummary({ date, venue, courts = [], rows = [] }) {
  return [
    `ค่าตีแบต ${formatThaiShortDate(date)}`,
    venue || "",
    ...[...courts].sort(compareCourtNames).map((court) => {
      const name = courtLabel(court);
      const startsAt = String(court.startsAt || court.starts_at || "").slice(0, 5);
      const rawEnd = String(court.endsAt || court.ends_at || "").slice(0, 5);
      return `${name} : ${startsAt}-${rawEnd === "00:00" ? "24:00" : rawEnd}`;
    }),
    "",
    ...rows.map((row, index) => `${index + 1}.${row.name} = ${formatBaht(row.amount)} บาท${row.extrasText ? ` (${row.extrasText})` : ""}`),
    "",
    "โอนเงิน : ธนาคารไทยพาณิชย์",
    "408-6-96159-5",
    "ณฐกฤต อินนะใจ",
  ].join("\n");
}

function formatThaiShortDate(isoDate) {
  try {
    return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "2-digit" })
      .format(new Date(`${isoDate}T12:00:00+07:00`));
  } catch {
    return isoDate;
  }
}

function formatBaht(value) {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0, minimumFractionDigits: 0 })
    .format(Math.round(Number(value) || 0));
}
