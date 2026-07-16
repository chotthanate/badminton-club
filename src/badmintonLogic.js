export const STATUS_LABELS = {
  coming: "มา",
  maybe: "อาจมา",
  not_coming: "ไม่มา",
};

export const WEIGHT_PRESETS = [
  { label: "เต็ม", value: 1 },
  { label: "75%", value: 0.75 },
  { label: "ครึ่ง", value: 0.5 },
  { label: "25%", value: 0.25 },
];

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

export function weightFromTimes(startTime, endTime, leftAt) {
  const total = minutesBetween(startTime, endTime);
  const played = minutesBetween(startTime, leftAt);
  if (!total || !played) return 1;
  return clamp(roundToStep(played / total, 0.01), 0.05, 1);
}

export function calculateSettlement(event) {
  const totalCost = event.costs.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const billableRows = event.attendance.filter((row) => row.arrived && Number(row.weight) > 0);
  const totalUnits = billableRows.reduce((sum, row) => sum + Number(row.weight || 0), 0);
  const unitPrice = totalUnits > 0 ? totalCost / totalUnits : 0;
  let roundedTotal = 0;

  const rows = billableRows.map((row) => {
    const rawDue = unitPrice * Number(row.weight || 0);
    const roundedDue = Math.round(rawDue);
    roundedTotal += roundedDue;
    return {
      ...row,
      rawDue,
      roundedDue,
      paid: Boolean(row.paid),
    };
  });

  const delta = Math.round(totalCost) - roundedTotal;
  if (rows.length && delta !== 0) {
    rows[rows.length - 1] = {
      ...rows[rows.length - 1],
      roundedDue: rows[rows.length - 1].roundedDue + delta,
      roundingDelta: delta,
    };
  }

  return {
    totalCost,
    totalUnits,
    unitPrice,
    rows,
  };
}

export function buildLineSummary(event) {
  const settlement = calculateSettlement(event);
  const lines = [
    `สรุปค่าแบด ${formatThaiDate(event.date)} ${event.startTime}-${event.endTime}`,
    `รวม ${baht(settlement.totalCost)} บาท / ${decimalBaht(settlement.totalUnits)} หน่วย`,
    "",
    ...settlement.rows.map((row) => {
      const weight = `${Math.round(Number(row.weight || 0) * 100)}%`;
      const paid = row.paid ? " จ่ายแล้ว" : "";
      return `${row.name} (${weight}) ${baht(row.roundedDue)} บาท${paid}`;
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
      { memberId: "m-1", status: "coming", note: "" },
      { memberId: "m-2", status: "coming", note: "" },
      { memberId: "m-3", status: "maybe", note: "อาจมาเลท" },
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
