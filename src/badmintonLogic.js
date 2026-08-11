export const STATUS_LABELS = {
  coming: "มา",
  not_coming: "ไม่มา",
};

export const DEFAULT_ROUND_SETTINGS = {
  fridayCourtHourlyRate: 200,
  saturdayCourtHourlyRate: 150,
  otherCourtHourlyRate: 200,
  shuttlecockUnitPrice: 95,
};

const FRIDAY_COURTS = [
  { name: "คอร์ท 11", startsAt: "21:00", endsAt: "00:00" },
  { name: "คอร์ท 12", startsAt: "21:00", endsAt: "00:00" },
  { name: "คอร์ท 10", startsAt: "22:00", endsAt: "00:00" },
];

const SATURDAY_COURTS = [
  { name: "คอร์ท 10", startsAt: "22:00", endsAt: "00:00" },
  { name: "คอร์ท 11", startsAt: "21:00", endsAt: "00:00" },
  { name: "คอร์ท 12", startsAt: "21:00", endsAt: "00:00" },
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

export function billableHours(playedMinutes, billingPercentage = 100) {
  const minutes = Math.max(0, Number(playedMinutes) || 0);
  const percentage = clamp(Number(billingPercentage) || 100, 0, 100);
  return (minutes / 60) * (percentage / 100);
}

export function calculateSettlement(event) {
  if (event.billingModel === "per_round") {
    return calculatePerRoundSettlement(event);
  }
  if (event.billingModel === "time_segmented") {
    return calculateTimeSegmentedSettlement(event);
  }

  const sharedTotalCost = event.costs.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const billableRows = event.attendance.filter((row) => row.arrived && billingUnits(row) > 0);
  const totalHours = billableRows.reduce((sum, row) => sum + billingUnits(row), 0);
  const preparedRows = billableRows.map((row) => {
    const hours = billingUnits(row);
    const currentExtraAmount = (row.extraCharges || []).reduce(
      (sum, charge) => sum + Number(charge.unitPrice || 0) * Number(charge.quantity || 1),
      Number(row.extraAmount || 0),
    );
    const billedAmount = row.billedAmount === null || row.billedAmount === undefined
      ? (row.paidAmount === null || row.paidAmount === undefined ? null : Number(row.paidAmount))
      : Number(row.billedAmount);
    const locked = !row.paymentExempt && Boolean(row.billingFinalized || row.paid) && Number.isFinite(billedAmount);
    const explicitExtra = Number(row.lockedExtraAmount);
    const lockedExtraAmount = locked
      ? (row.lockedExtraAmount !== null && row.lockedExtraAmount !== undefined && Number.isFinite(explicitExtra) ? Math.max(0, explicitExtra) : Math.min(currentExtraAmount, Math.max(0, billedAmount)))
      : null;
    const explicitShared = Number(row.lockedSharedAmount);
    const lockedSharedAmount = locked
      ? (row.lockedSharedAmount !== null && row.lockedSharedAmount !== undefined && Number.isFinite(explicitShared) ? Math.max(0, explicitShared) : Math.max(0, billedAmount - lockedExtraAmount))
      : null;
    return {
      ...row,
      hours,
      paymentRecorded: Boolean(row.paid),
      billedAmount,
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
        rawDue: row.billedAmount,
        sharedDue: row.lockedSharedAmount,
        extraAmount: row.lockedExtraAmount,
        roundedDue: Math.round(row.billedAmount),
        paid: Boolean(row.paymentRecorded),
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
      paid: Boolean(row.paymentExempt) || row.paymentRecorded,
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

export function calculatePerRoundSettlement(event) {
  const sharedTotalCost = (event.costs || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const preparedRows = (event.attendance || [])
    .filter((row) => row.arrived)
    .map((row) => {
      const roundsPlayed = Math.max(0, Number(row.roundsPlayed) || 0);
      const currentExtraAmount = (row.extraCharges || []).reduce(
        (sum, charge) => sum + Number(charge.unitPrice || 0) * Number(charge.quantity || 1),
        Number(row.extraAmount || 0),
      );
      const billedAmount = row.billedAmount === null || row.billedAmount === undefined
        ? (row.paidAmount === null || row.paidAmount === undefined ? null : Number(row.paidAmount))
        : Number(row.billedAmount);
      const locked = !row.paymentExempt && Boolean(row.billingFinalized || row.paid) && Number.isFinite(billedAmount);
      const explicitExtra = Number(row.lockedExtraAmount);
      const lockedExtraAmount = locked
        ? (row.lockedExtraAmount !== null && row.lockedExtraAmount !== undefined && Number.isFinite(explicitExtra)
          ? Math.max(0, explicitExtra)
          : Math.min(currentExtraAmount, Math.max(0, billedAmount)))
        : null;
      const explicitShared = Number(row.lockedSharedAmount);
      const lockedSharedAmount = locked
        ? (row.lockedSharedAmount !== null && row.lockedSharedAmount !== undefined && Number.isFinite(explicitShared)
          ? Math.max(0, explicitShared)
          : Math.max(0, billedAmount - lockedExtraAmount))
        : null;
      return {
        ...row,
        roundsPlayed,
        paymentRecorded: Boolean(row.paid),
        billedAmount,
        currentExtraAmount,
        locked,
        lockedExtraAmount,
        lockedSharedAmount,
      };
    })
    .filter((row) => row.roundsPlayed > 0 || row.currentExtraAmount > 0 || row.locked);

  const totalUnits = preparedRows.reduce((sum, row) => sum + row.roundsPlayed, 0);
  const lockedSharedTotal = preparedRows.reduce((sum, row) => sum + Number(row.lockedSharedAmount || 0), 0);
  const remainingSharedCost = Math.max(0, sharedTotalCost - lockedSharedTotal);
  const openUnits = preparedRows
    .filter((row) => !row.locked)
    .reduce((sum, row) => sum + row.roundsPlayed, 0);
  const unitPrice = openUnits > 0 ? remainingSharedCost / openUnits : 0;
  let roundedOpenSharedTotal = 0;

  const rows = preparedRows.map((row) => {
    if (row.locked) {
      return {
        ...row,
        rawDue: row.billedAmount,
        sharedDue: row.lockedSharedAmount,
        extraAmount: row.lockedExtraAmount,
        roundedDue: Math.round(row.billedAmount),
        paid: Boolean(row.paymentRecorded),
      };
    }
    const rawSharedDue = unitPrice * row.roundsPlayed;
    const sharedDue = Math.round(rawSharedDue);
    roundedOpenSharedTotal += sharedDue;
    return {
      ...row,
      rawDue: rawSharedDue + row.currentExtraAmount,
      sharedDue,
      extraAmount: row.currentExtraAmount,
      roundedDue: sharedDue + Math.round(row.currentExtraAmount),
      paid: Boolean(row.paymentExempt) || row.paymentRecorded,
    };
  });

  const lastOpenIndex = rows.findLastIndex((row) => !row.locked && row.roundsPlayed > 0);
  const delta = openUnits > 0 ? Math.round(remainingSharedCost) - roundedOpenSharedTotal : 0;
  if (lastOpenIndex >= 0 && delta !== 0) {
    rows[lastOpenIndex] = {
      ...rows[lastOpenIndex],
      sharedDue: rows[lastOpenIndex].sharedDue + delta,
      roundedDue: rows[lastOpenIndex].roundedDue + delta,
      roundingDelta: delta,
    };
  }

  const personalExtrasTotal = rows.reduce((sum, row) => sum + Math.round(row.extraAmount), 0);
  const allocatedSharedTotal = rows.reduce((sum, row) => sum + Number(row.sharedDue || 0), 0);
  return {
    totalCost: sharedTotalCost + personalExtrasTotal,
    sharedTotalCost,
    personalExtrasTotal,
    totalHours: 0,
    totalUnits,
    unitPrice,
    lockedSharedTotal,
    remainingSharedCost,
    allocatedSharedTotal,
    unallocatedSharedCost: Math.max(0, Math.round(sharedTotalCost) - allocatedSharedTotal),
    rows,
  };
}

export function completedRoundsByMember(queueMatches = [], queueMatchPlayers = []) {
  const completedIds = new Set(
    queueMatches.filter((match) => match.status === "completed").map((match) => match.id),
  );
  const seen = new Set();
  const rounds = new Map();
  queueMatchPlayers.forEach((player) => {
    if (!completedIds.has(player.match_id)) return;
    const uniqueKey = `${player.match_id}:${player.member_id}`;
    if (seen.has(uniqueKey)) return;
    seen.add(uniqueKey);
    rounds.set(player.member_id, (rounds.get(player.member_id) || 0) + 1);
  });
  return rounds;
}

export function calculateTimeSegmentedSettlement(event) {
  const billableRows = event.attendance.filter((row) => row.arrived && billingUnits(row) > 0);
  const preparedRows = billableRows.map((row) => prepareSettlementRow(row));
  const shares = new Map(preparedRows.map((row) => [row.memberId, {
    court: 0,
    shuttle: 0,
    other: 0,
  }]));
  const eventStart = timelinePoint(event.startTime, event.startTime);
  const eventEnd = eventStart + minutesBetween(event.startTime, event.endTime);
  const hourlyRate = Math.max(0, Number(event.courtHourlyRate) || 0);

  (event.courts || []).forEach((court) => {
    const courtStart = timelinePoint(court.startsAt, event.startTime);
    const courtEnd = timelinePoint(court.endsAt, event.startTime, courtStart);
    for (let sliceStart = courtStart; sliceStart < courtEnd; sliceStart += 15) {
      const sliceEnd = Math.min(sliceStart + 15, courtEnd);
      distributeByPresence(
        preparedRows,
        shares,
        sliceStart,
        sliceEnd,
        ((sliceEnd - sliceStart) / 60) * hourlyRate,
        "court",
        event.startTime,
        eventEnd,
      );
    }
  });

  const checkpoints = normalizeShuttlecockCheckpoints(event, eventEnd);
  let previousPoint = eventStart;
  let previousCount = 0;
  checkpoints.forEach((checkpoint) => {
    const point = timelinePoint(checkpoint.time, event.startTime, previousPoint);
    const count = Math.max(previousCount, Number(checkpoint.cumulativeCount) || 0);
    const increment = count - previousCount;
    if (increment > 0 && point > previousPoint) {
      distributeByPresence(
        preparedRows,
        shares,
        previousPoint,
        point,
        increment * Math.max(0, Number(event.shuttlecockUnitPrice) || 0),
        "shuttle",
        event.startTime,
        eventEnd,
      );
    }
    previousPoint = point;
    previousCount = count;
  });

  const otherSharedCost = (event.extraCosts || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  if (otherSharedCost > 0) {
    distributeByPresence(
      preparedRows,
      shares,
      eventStart,
      eventEnd,
      otherSharedCost,
      "other",
      event.startTime,
      eventEnd,
    );
  }

  const rows = preparedRows.map((row) => {
    const share = shares.get(row.memberId) || { court: 0, shuttle: 0, other: 0 };
    const calculatedSharedAmount = share.court + share.shuttle + share.other;
    const calculatedAmount = Math.round(calculatedSharedAmount) + Math.round(row.currentExtraAmount);
    if (row.locked) {
      return {
        ...row,
        courtDue: share.court,
        shuttleDue: share.shuttle,
        otherSharedDue: share.other,
        calculatedSharedAmount,
        rawDue: row.billedAmount,
        sharedDue: row.lockedSharedAmount,
        extraAmount: row.lockedExtraAmount,
        roundedDue: Math.round(row.billedAmount),
        paid: Boolean(row.paymentRecorded),
      };
    }
    return {
      ...row,
      courtDue: share.court,
      shuttleDue: share.shuttle,
      otherSharedDue: share.other,
      calculatedSharedAmount,
      rawDue: calculatedSharedAmount + row.currentExtraAmount,
      sharedDue: Math.round(calculatedSharedAmount),
      extraAmount: row.currentExtraAmount,
      roundedDue: calculatedAmount,
      paid: Boolean(row.paymentExempt) || row.paymentRecorded,
    };
  });

  const courtCost = totalCourtHours(event.courts || []) * hourlyRate;
  const shuttleCost = Math.max(0, Number(event.shuttlecockCount) || 0)
    * Math.max(0, Number(event.shuttlecockUnitPrice) || 0);
  const sharedTotalCost = courtCost + shuttleCost + otherSharedCost;
  const personalExtrasTotal = rows.reduce((sum, row) => sum + Math.round(row.extraAmount), 0);
  const allocatedSharedTotal = rows.reduce((sum, row) => sum + Number(row.sharedDue || 0), 0);
  const totalHours = rows.reduce((sum, row) => sum + row.hours, 0);

  return {
    totalCost: sharedTotalCost + personalExtrasTotal,
    sharedTotalCost,
    personalExtrasTotal,
    totalHours,
    totalUnits: totalHours,
    unitPrice: totalHours > 0 ? sharedTotalCost / totalHours : 0,
    lockedSharedTotal: rows.filter((row) => row.locked).reduce((sum, row) => sum + Number(row.sharedDue || 0), 0),
    remainingSharedCost: Math.max(0, sharedTotalCost - rows.filter((row) => row.locked).reduce((sum, row) => sum + Number(row.sharedDue || 0), 0)),
    allocatedSharedTotal,
    roundingDifference: Math.round(sharedTotalCost) - allocatedSharedTotal,
    rows,
  };
}

function prepareSettlementRow(row) {
  const hours = billingUnits(row);
  const currentExtraAmount = (row.extraCharges || []).reduce(
    (sum, charge) => sum + Number(charge.unitPrice || 0) * Number(charge.quantity || 1),
    Number(row.extraAmount || 0),
  );
  const billedAmount = row.billedAmount === null || row.billedAmount === undefined
    ? (row.paidAmount === null || row.paidAmount === undefined ? null : Number(row.paidAmount))
    : Number(row.billedAmount);
  const locked = !row.paymentExempt && Boolean(row.billingFinalized || row.paid) && Number.isFinite(billedAmount);
  const explicitExtra = Number(row.lockedExtraAmount);
  const lockedExtraAmount = locked
    ? (row.lockedExtraAmount !== null && row.lockedExtraAmount !== undefined && Number.isFinite(explicitExtra)
      ? Math.max(0, explicitExtra)
      : Math.min(currentExtraAmount, Math.max(0, billedAmount)))
    : null;
  const explicitShared = Number(row.lockedSharedAmount);
  const lockedSharedAmount = locked
    ? (row.lockedSharedAmount !== null && row.lockedSharedAmount !== undefined && Number.isFinite(explicitShared)
      ? Math.max(0, explicitShared)
      : Math.max(0, billedAmount - lockedExtraAmount))
    : null;
  return {
    ...row,
    hours,
    paymentRecorded: Boolean(row.paid),
    billedAmount,
    currentExtraAmount,
    locked,
    lockedExtraAmount,
    lockedSharedAmount,
  };
}

function distributeByPresence(rows, shares, intervalStart, intervalEnd, amount, bucket, startTime, eventEnd) {
  if (!(amount > 0) || intervalEnd <= intervalStart) return;
  const active = rows.map((row) => {
    const arrival = timelinePoint(row.arrivedAt || startTime, startTime);
    const departure = row.leftAt
      ? timelinePoint(row.leftAt, startTime, arrival)
      : eventEnd;
    const overlap = Math.max(0, Math.min(intervalEnd, departure, eventEnd) - Math.max(intervalStart, arrival));
    const weight = overlap * (Math.max(0, Number(row.billingPercentage) || 100) / 100);
    return { row, weight };
  }).filter((entry) => entry.weight > 0);
  const totalWeight = active.reduce((sum, entry) => sum + entry.weight, 0);
  if (!totalWeight) return;
  active.forEach(({ row, weight }) => {
    const current = shares.get(row.memberId);
    current[bucket] += amount * weight / totalWeight;
  });
}

function normalizeShuttlecockCheckpoints(event, eventEnd) {
  const checkpoints = (event.shuttlecockCheckpoints || [])
    .map((checkpoint) => ({
      time: String(checkpoint.time || "").slice(0, 5),
      cumulativeCount: Math.max(0, Number(checkpoint.cumulativeCount) || 0),
    }))
    .filter((checkpoint) => checkpoint.time)
    .sort((left, right) => timelinePoint(left.time, event.startTime) - timelinePoint(right.time, event.startTime));
  const finalTime = minutesToClock(eventEnd);
  const finalCount = Math.max(0, Number(event.shuttlecockCount) || 0);
  const existingFinal = checkpoints.find((checkpoint) => checkpoint.time === finalTime);
  if (existingFinal) existingFinal.cumulativeCount = Math.max(existingFinal.cumulativeCount, finalCount);
  else checkpoints.push({ time: finalTime, cumulativeCount: finalCount });
  return checkpoints;
}

function timelinePoint(time, startTime, after = null) {
  const value = parseTime(time);
  const start = parseTime(startTime);
  if (value === null || start === null) return start || 0;
  let point = value;
  if (point < start || (after !== null && point <= after - (24 * 60))) point += 24 * 60;
  if (after !== null && point < after && point + 24 * 60 <= after + 24 * 60) point += 24 * 60;
  return point;
}

function minutesToClock(minutes) {
  const normalized = ((minutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

export function buildLineSummary(event) {
  const settlement = calculateSettlement(event);
  const lines = [
    `ค่าตีแบต ${formatThaiDate(event.date)}`,
    event.venue || "",
    ...(event.courts || []).map((court) => `${court.name} : ${court.startsAt}-${court.endsAt === "00:00" ? "24:00" : court.endsAt}`),
    "",
    ...settlement.rows.filter((row) => !row.paymentExempt && row.billingFinalized !== false).map((row, index) => {
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

export function createInitialEvent(now = new Date()) {
  return {
    id: "fri-current",
    date: nextFridayIso(now),
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

export function roundDefaultsForDate(isoDate, settings = {}) {
  const weekday = weekdayFromIsoDate(isoDate);
  const shuttlecockUnitPrice = finiteOr(
    settings.default_shuttlecock_unit_price,
    DEFAULT_ROUND_SETTINGS.shuttlecockUnitPrice,
  );
  if (weekday === 5) {
    return {
      courtHourlyRate: finiteOr(
        settings.default_friday_court_hourly_rate,
        DEFAULT_ROUND_SETTINGS.fridayCourtHourlyRate,
      ),
      shuttlecockUnitPrice,
      courts: FRIDAY_COURTS.map((court) => ({ ...court })),
    };
  }
  if (weekday === 6) {
    return {
      courtHourlyRate: finiteOr(
        settings.default_saturday_court_hourly_rate,
        DEFAULT_ROUND_SETTINGS.saturdayCourtHourlyRate,
      ),
      shuttlecockUnitPrice,
      courts: SATURDAY_COURTS.map((court) => ({ ...court })),
    };
  }
  return {
    courtHourlyRate: finiteOr(
      settings.default_other_court_hourly_rate,
      DEFAULT_ROUND_SETTINGS.otherCourtHourlyRate,
    ),
    shuttlecockUnitPrice,
    courts: [],
  };
}

export function weekdayFromIsoDate(isoDate) {
  const parts = String(isoDate || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0).getDay();
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

  const quarterHourMs = 15 * 60 * 1000;
  const roundedAt = new Date(Math.round(current.getTime() / quarterHourMs) * quarterHourMs);
  if (roundedAt <= plannedAt || roundedAt >= endsAt) return null;
  return `${String(roundedAt.getHours()).padStart(2, "0")}:${String(roundedAt.getMinutes()).padStart(2, "0")}`;
}

export function suggestShuttlecockCheckpointTime({
  now = new Date(),
  eventDate,
  startTime,
  endTime,
}) {
  const dateParts = String(eventDate || "").split("-").map(Number);
  const startMinutes = parseTime(startTime);
  const endMinutes = parseTime(endTime);
  const current = now instanceof Date ? now : new Date(now);
  if (dateParts.length !== 3 || dateParts.some(Number.isNaN) || startMinutes === null || endMinutes === null || Number.isNaN(current.getTime())) {
    return endTime || startTime || "00:00";
  }

  const [year, month, day] = dateParts;
  const startsAt = new Date(year, month - 1, day, Math.floor(startMinutes / 60), startMinutes % 60);
  const endsAt = new Date(year, month - 1, day, Math.floor(endMinutes / 60), endMinutes % 60);
  if (endsAt <= startsAt) endsAt.setDate(endsAt.getDate() + 1);

  if (current >= endsAt) return endTime;
  const quarterHourMs = 15 * 60 * 1000;
  const elapsed = Math.max(0, current.getTime() - startsAt.getTime());
  const nextQuarter = Math.floor(elapsed / quarterHourMs) + 1;
  const checkpointAt = new Date(Math.min(
    endsAt.getTime(),
    startsAt.getTime() + (nextQuarter * quarterHourMs),
  ));
  return `${String(checkpointAt.getHours()).padStart(2, "0")}:${String(checkpointAt.getMinutes()).padStart(2, "0")}`;
}

export function nextFridayIso(now = new Date()) {
  const date = new Date(now);
  const day = date.getDay();
  const diff = (5 - day + 7) % 7 || 7;
  date.setDate(date.getDate() + diff);
  return localIsoDate(date);
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

function finiteOr(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function localIsoDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function billingUnits(row) {
  if (Number.isFinite(Number(row.hours)) && Number(row.hours) > 0) return Number(row.hours);
  if (Number.isFinite(Number(row.playedMinutes)) && Number(row.playedMinutes) > 0) {
    return billableHours(row.playedMinutes, row.billingPercentage ?? 100);
  }
  return Number(row.weight || 0);
}
