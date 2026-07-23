export const STATUS_LABELS = {
  coming: "มา",
  not_coming: "ไม่มา",
};

export function baht(value) {
  return new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(Math.round(Number(value) || 0));
}

export function decimalBaht(value) {
  return new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);
}

export function minutesBetween(startTime, endTime) {
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  if (start === null || end === null) return 0;
  let diff = end - start;
  if (diff <= 0) diff += 24 * 60;
  return diff;
}

export function totalCourtHours(courts = []) {
  return courts.reduce(
    (sum, court) => sum + minutesBetween(court.startsAt, court.endsAt) / 60,
    0,
  );
}

export function weightFromTimes(startTime, endTime, leftAt) {
  const total = minutesBetween(startTime, endTime);
  const played = minutesBetween(startTime, leftAt);
  if (!total || !played) return 1;
  return clamp(roundToStep(played / total, 0.01), 0.05, 1);
}

export function playedMinutesWithinEvent(startTime, endTime, arrivalTime, leftAt = "") {
  const eventStart = parseTime(startTime);
  const duration = minutesBetween(startTime, endTime);
  const arrival = parseTime(arrivalTime || startTime);
  const departure = parseTime(leftAt || endTime);
  if (eventStart === null || arrival === null || departure === null || !duration) return 0;

  const eventEnd = eventStart + duration;
  let arrivalPoint = arrival < eventStart ? arrival + 24 * 60 : arrival;
  let departurePoint = departure < eventStart ? departure + 24 * 60 : departure;
  if (departurePoint <= arrivalPoint && leftAt) departurePoint += 24 * 60;
  arrivalPoint = clamp(arrivalPoint, eventStart, eventEnd);
  departurePoint = clamp(departurePoint, arrivalPoint, eventEnd);
  return departurePoint - arrivalPoint;
}

export function formatPlayedDuration(minutes) {
  const value = Math.max(0, Number(minutes) || 0);
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  if (!remainder) return `${hours} ชม.`;
  if (!hours) return `${remainder} นาที`;
  return `${hours} ชม. ${remainder} นาที`;
}

export function calculateSettlement(event) {
  const sharedTotalCost = event.costs.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const billableRows = event.attendance.filter((row) => row.arrived && billingUnits(row) > 0);
  const totalHours = billableRows.reduce((sum, row) => sum + billingUnits(row), 0);
  const preparedRows = billableRows.map((row) => {
    const hours = billingUnits(row);
    const currentExtraAmount = (row.extraCharges || []).reduce(
      (sum, charge) => sum + Number(charge.unitPrice || 0) * Number(charge.quantity || 1),
      Number(row.extraAmount || 0),
    );
    const paidAmount = row.paidAmount === null || row.paidAmount === undefined ? null : Number(row.paidAmount);
    const locked = Boolean(row.paid) && Number.isFinite(paidAmount);
    const explicitExtra = Number(row.lockedExtraAmount);
    const lockedExtraAmount = locked
      ? (row.lockedExtraAmount !== null && row.lockedExtraAmount !== undefined && Number.isFinite(explicitExtra) ? Math.max(0, explicitExtra) : Math.min(currentExtraAmount, Math.max(0, paidAmount)))
      : null;
    const explicitShared = Number(row.lockedSharedAmount);
    const lockedSharedAmount = locked
      ? (row.lockedSharedAmount !== null && row.lockedSharedAmount !== undefined && Number.isFinite(explicitShared) ? Math.max(0, explicitShared) : Math.max(0, paidAmount - lockedExtraAmount))
      : null;
    return {
      ...row,
      hours,
      paymentRecorded: Boolean(row.paid),
      paidAmount,
      currentExtraAmount,
      locked,
      lockedExtraAmount,
      lockedSharedAmount,
    };
  });

  const lockedSharedTotal = preparedRows.reduce((sum, row) => sum + Number(row.lockedSharedAmount || 0), 0);
  const remainingSharedCost = Math.max(0, sharedTotalCost - lockedSharedTotal);
  const openHours = preparedRows.filter((row) => !row.locked).reduce((sum, row) => sum + row.hours, 0);
  const unitPrice = openHours > 0 ? remainingSharedCost / openHours : 0;
  let roundedOpenSharedTotal = 0;

  const rows = preparedRows.map((row) => {
    if (row.locked) {
      return {
        ...row,
        rawDue: row.paidAmount,
        sharedDue: row.lockedSharedAmount,
        extraAmount: row.lockedExtraAmount,
        roundedDue: Math.round(row.paidAmount),
        paid: true,
      };
    }
    const rawSharedDue = unitPrice * row.hours;
    const sharedDue = Math.round(rawSharedDue);
    roundedOpenSharedTotal += sharedDue;
    return {
      ...row,
      rawDue: rawSharedDue + row.currentExtraAmount,
      sharedDue,
      extraAmount: row.currentExtraAmount,
      roundedDue: sharedDue + Math.round(row.currentExtraAmount),
      paid: row.paymentRecorded,
    };
  });

  const lastOpenIndex = rows.findLastIndex((row) => !row.locked);
  const delta = Math.round(remainingSharedCost) - roundedOpenSharedTotal;
  if (lastOpenIndex >= 0 && delta !== 0) {
    rows[lastOpenIndex] = {
      ...rows[lastOpenIndex],
      sharedDue: rows[lastOpenIndex].sharedDue + delta,
      roundedDue: rows[lastOpenIndex].roundedDue + delta,
      roundingDelta: delta,
    };
  }

  const personalExtrasTotal = rows.reduce((sum, row) => sum + Math.round(row.extraAmount), 0);
  const totalCost = Math.max(sharedTotalCost, lockedSharedTotal) + personalExtrasTotal;

  return {
    totalCost,
    sharedTotalCost,
    personalExtrasTotal,
    totalHours,
    totalUnits: totalHours,
    unitPrice,
    lockedSharedTotal,
    remainingSharedCost,
    rows,
  };
}

export function buildLineSummary(event) {
  const settlement = calculateSettlement(event);
  const lines = [
    `ค่าตีแบต ${formatThaiDate(event.date)}`,
    event.venue || "",
    ...(event.courts || []).map((court) => `${court.name} : ${court.startsAt}-${court.endsAt === "00:00" ? "24:00" : court.endsAt}`),
    "",
    ...settlement.rows.map((row, index) => {
      const extraItems = summarizeExtraCharges(row.extraCharges || []);
      const extras = extraItems ? ` (${extraItems})` : "";
      return `${index + 1}.${row.name} = ${baht(row.roundedDue)} บาท${extras}`;
    }),
    "",
    "โอนเงิน : ธนาคารกสิกร",
    "389-2-36746-8",
    "ณฐกฤต อินนะใจ",
  ];

  return lines.join("\n");
}

function summarizeExtraCharges(charges) {
  const grouped = new Map();
  charges.forEach((charge) => {
    const name = charge.name || "รายการอื่น";
    const current = grouped.get(name) || { quantity: 0, amount: 0 };
    current.quantity += Number(charge.quantity || 1);
    current.amount += Number(charge.unitPrice || 0) * Number(charge.quantity || 1);
    grouped.set(name, current);
  });
  return [...grouped.entries()].map(([name, value]) => `${name}${value.quantity > 1 ? `×${value.quantity}` : ""} ${baht(value.amount)} บาท`).join(", ");
}

export function createInitialEvent() {
  return {
    id: "fri-current",
    date: nextFridayIso(),
    title: "แบดวันศุกร์",
    startTime: "21:00",
    endTime: "00:00",
    status: "open",
    members: [
      { id: "m-1", name: "แอดมิน", role: "admin", lineUserId: "demo-admin", active: true },
      { id: "m-2", name: "บอย", role: "member", lineUserId: "demo-boy", active: true },
      { id: "m-3", name: "นัท", role: "member", lineUserId: "demo-nut", active: true },
      { id: "m-4", name: "เมย์", role: "member", lineUserId: "demo-may", active: true },
      { id: "m-5", name: "ตั้ม", role: "member", lineUserId: "demo-tum", active: true },
    ],
    signups: [
      { memberId: "m-1", status: "coming", arrivalTime: "21:00", note: "" },
      { memberId: "m-2", status: "coming", arrivalTime: "21:00", note: "" },
      { memberId: "m-3", status: "not_coming", arrivalTime: "", note: "" },
    ],
    attendance: [
      { memberId: "m-1", name: "แอดมิน", arrived: true, weight: 1, arrivedAt: "21:00", leftAt: "", note: "", paid: false },
      { memberId: "m-2", name: "บอย", arrived: true, weight: 1, arrivedAt: "21:00", leftAt: "", note: "", paid: false },
      { memberId: "m-3", name: "นัท", arrived: false, weight: 1, arrivedAt: "", leftAt: "", note: "", paid: false },
    ],
    costs: [
      { id: "c-court", type: "court", label: "ค่าคอร์ด 3 ชม.", amount: 1800 },
      { id: "c-shuttle", type: "shuttle", label: "ค่าลูกแบด 10 ลูก", amount: 600 },
    ],
    actions: [],
  };
}

export function memberName(event, memberId) {
  return event.members.find((member) => member.id === memberId)?.name || "ไม่ทราบชื่อ";
}

export function formatThaiDate(isoDate) {
  try {
    return new Intl.DateTimeFormat("th-TH", {
      day: "numeric",
      month: "short",
      year: "2-digit",
    }).format(new Date(`${isoDate}T12:00:00`));
  } catch {
    return isoDate;
  }
}

export function formatThaiLongDate(isoDate) {
  try {
    return new Intl.DateTimeFormat("th-TH", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(`${isoDate}T12:00:00`));
  } catch {
    return isoDate;
  }
}

export function suggestArrivalTimeOnCheck({
  now = new Date(),
  eventDate,
  startTime,
  endTime,
  plannedArrival,
}) {
  const dateParts = String(eventDate || "").split("-").map(Number);
  const startMinutes = parseTime(startTime);
  const endMinutes = parseTime(endTime);
  const arrivalMinutes = parseTime(plannedArrival);
  const current = now instanceof Date ? now : new Date(now);
  if (dateParts.length !== 3 || dateParts.some(Number.isNaN) || startMinutes === null || endMinutes === null || arrivalMinutes === null || Number.isNaN(current.getTime())) return null;

  const [year, month, day] = dateParts;
  const startsAt = new Date(year, month - 1, day, Math.floor(startMinutes / 60), startMinutes % 60);
  const endsAt = new Date(year, month - 1, day, Math.floor(endMinutes / 60), endMinutes % 60);
  if (endsAt <= startsAt) endsAt.setDate(endsAt.getDate() + 1);
  if (current < startsAt || current >= endsAt) return null;

  const plannedAt = new Date(year, month - 1, day, Math.floor(arrivalMinutes / 60), arrivalMinutes % 60);
  if (plannedAt < startsAt) plannedAt.setDate(plannedAt.getDate() + 1);

  const halfHourMs = 30 * 60 * 1000;
  const roundedAt = new Date(Math.round(current.getTime() / halfHourMs) * halfHourMs);
  if (roundedAt <= plannedAt || roundedAt >= endsAt) return null;
  return `${String(roundedAt.getHours()).padStart(2, "0")}:${String(roundedAt.getMinutes()).padStart(2, "0")}`;
}

function nextFridayIso() {
  const date = new Date();
  const day = date.getDay();
  const diff = (5 - day + 7) % 7 || 7;
  date.setDate(date.getDate() + diff);
  return date.toISOString().slice(0, 10);
}

function parseTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value || "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function roundToStep(value, step) {
  return Math.round(value / step) * step;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function billingUnits(row) {
  if (Number.isFinite(Number(row.hours)) && Number(row.hours) > 0) return Number(row.hours);
  return Number(row.weight || 0);
}
