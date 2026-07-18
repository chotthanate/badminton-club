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
  const unitPrice = totalHours > 0 ? sharedTotalCost / totalHours : 0;
  let roundedSharedTotal = 0;

  const rows = billableRows.map((row) => {
    const hours = billingUnits(row);
    const rawSharedDue = unitPrice * hours;
    const sharedDue = Math.round(rawSharedDue);
    const extraAmount = (row.extraCharges || []).reduce(
      (sum, charge) => sum + Number(charge.unitPrice || 0) * Number(charge.quantity || 1),
      Number(row.extraAmount || 0),
    );
    roundedSharedTotal += sharedDue;
    return {
      ...row,
      hours,
      rawDue: rawSharedDue + extraAmount,
      sharedDue,
      extraAmount,
      roundedDue: sharedDue + Math.round(extraAmount),
      paymentRecorded: Boolean(row.paid),
      paidAmount: row.paidAmount === undefined ? null : Number(row.paidAmount || 0),
      paid: false,
    };
  });

  const delta = Math.round(sharedTotalCost) - roundedSharedTotal;
  if (rows.length && delta !== 0) {
    rows[rows.length - 1] = {
      ...rows[rows.length - 1],
      sharedDue: rows[rows.length - 1].sharedDue + delta,
      roundedDue: rows[rows.length - 1].roundedDue + delta,
      roundingDelta: delta,
    };
  }

  rows.forEach((row) => {
    row.paid = row.paymentRecorded && (row.paidAmount === null || Math.round(row.paidAmount) === row.roundedDue);
  });

  const personalExtrasTotal = rows.reduce((sum, row) => sum + Math.round(row.extraAmount), 0);
  const totalCost = sharedTotalCost + personalExtrasTotal;

  return {
    totalCost,
    sharedTotalCost,
    personalExtrasTotal,
    totalHours,
    totalUnits: totalHours,
    unitPrice,
    rows,
  };
}

export function buildLineSummary(event) {
  const settlement = calculateSettlement(event);
  const lines = [
    `สรุปค่าแบด ${formatThaiLongDate(event.date)}`,
    event.venue ? `สถานที่ : ${event.venue}` : "",
    ...(event.courts || []).map((court) => `${court.name} : ${court.startsAt}-${court.endsAt === "00:00" ? "24:00" : court.endsAt}`),
    `รวม ${baht(settlement.totalCost)} บาท / ${decimalBaht(settlement.totalHours)} ชั่วโมงผู้เล่น`,
    "",
    ...settlement.rows.map((row) => {
      const duration = formatPlayedDuration(Number(row.hours || 0) * 60);
      const extras = row.extraAmount ? ` รวมของเพิ่ม ${baht(row.extraAmount)} บาท` : "";
      const paid = row.paid ? " จ่ายแล้ว" : "";
      return `${row.name} (${duration}) ${baht(row.roundedDue)} บาท${extras}${paid}`;
    }),
  ];

  return lines.join("\n");
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
