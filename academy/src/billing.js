export const PAYMENT_STATUSES = Object.freeze({
  UNPAID: "unpaid",
  SLIP_PENDING: "slip_pending",
  MANUAL_REVIEW: "manual_review",
  PAID: "paid",
  VOID: "void",
});

export function bahtToSatang(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("จำนวนเงินไม่ถูกต้อง");
  return Math.round(amount * 100);
}

export function satangToBaht(value) {
  return Number(value || 0) / 100;
}

export function formatBaht(value) {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: Number(value) % 100 === 0 ? 0 : 2,
  }).format(satangToBaht(value));
}

export function calculateCourtShare(courtCostSatang, attendeeCount) {
  const cost = Number(courtCostSatang);
  const count = Number(attendeeCount);
  if (!Number.isInteger(cost) || cost < 0) throw new Error("ค่าสนามไม่ถูกต้อง");
  if (!Number.isInteger(count) || count < 0) throw new Error("จำนวนผู้เรียนไม่ถูกต้อง");
  if (count === 0) return { perPersonSatang: 0, collectedSatang: 0, surplusSatang: 0 };
  const perPersonSatang = Math.ceil(cost / count / 100) * 100;
  const collectedSatang = perPersonSatang * count;
  return {
    perPersonSatang,
    collectedSatang,
    surplusSatang: collectedSatang - cost,
  };
}

export function buildBillingPreview({ serviceFeeSatang, courtCostSatang, attendees, purchases = [] }) {
  const activeAttendees = attendees.filter((entry) => entry.status === "present" || entry.attendance === "present");
  const court = calculateCourtShare(courtCostSatang, activeAttendees.length);
  const purchasesByStudent = new Map();
  purchases.forEach((purchase) => {
    const current = purchasesByStudent.get(purchase.studentId) || [];
    current.push(purchase);
    purchasesByStudent.set(purchase.studentId, current);
  });

  const rows = activeAttendees.map((attendee) => {
    const studentPurchases = purchasesByStudent.get(attendee.studentId) || [];
    const productsSatang = studentPurchases.reduce(
      (sum, item) => sum + (Number(item.unitPriceSatang) * Number(item.quantity)),
      0,
    );
    return {
      studentId: attendee.studentId,
      name: attendee.name,
      serviceFeeSatang,
      courtShareSatang: court.perPersonSatang,
      productsSatang,
      totalSatang: Number(serviceFeeSatang) + court.perPersonSatang + productsSatang,
      purchases: studentPurchases,
    };
  });

  return {
    rows,
    attendeeCount: activeAttendees.length,
    court,
    totalSatang: rows.reduce((sum, row) => sum + row.totalSatang, 0),
  };
}

export function validateScore(score, maximum) {
  const numericScore = Number(score);
  const numericMaximum = Number(maximum);
  if (!Number.isFinite(numericMaximum) || numericMaximum <= 0) return false;
  return Number.isFinite(numericScore) && numericScore >= 0 && numericScore <= numericMaximum;
}

export function attendanceSummary(registrations = []) {
  return registrations.reduce((summary, item) => {
    if (item.attendance === "present") summary.present += 1;
    else if (item.status === "registered" && item.attendance !== "present") summary.absent += 1;
    return summary;
  }, { present: 0, absent: 0 });
}
