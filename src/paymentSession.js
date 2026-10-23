export function isPaymentSelectable(payment) {
  return !payment.paidAt && !["review", "paid"].includes(payment.paymentStatus);
}

export function retainSelectablePaymentIds(beneficiaries, paymentIds) {
  const allowed = new Set((beneficiaries || []).flatMap((entry) => entry.payments || []).filter(isPaymentSelectable).map((payment) => payment.id));
  return paymentIds.filter((id) => allowed.has(id));
}

// Keep the confirmed receipt visible even if the subsequent reload fails.
export function applyPaymentReceipt(data, receipt, paymentIds) {
  if (!data) return data;
  const submittedIds = new Set(receipt.paymentIds || paymentIds);
  const paid = receipt.status === "auto_paid";
  const recentlyPaid = [];
  const beneficiaries = data.beneficiaries.map((entry) => ({
    ...entry,
    payments: entry.payments.flatMap((payment) => {
      if (!submittedIds.has(payment.id)) return [payment];
      const updated = { ...payment, paymentStatus: paid ? "paid" : "review", submissionId: receipt.slipId || null,
        submissionStatus: receipt.status, submittedAt: receipt.submittedAt || null, paidAt: paid ? receipt.paidAt || receipt.submittedAt : null };
      if (paid) {
        if (entry.id === data.profile.memberId) recentlyPaid.push(updated);
        return [];
      }
      return [updated];
    }),
  }));
  return { ...data, beneficiaries, recentPaid: [...recentlyPaid, ...(data.recentPaid || []).filter((payment) => !submittedIds.has(payment.id))].slice(0, 12) };
}

export function reconcilePaymentReceipt(data, receipt) {
  if (!receipt || receipt.status !== "pending") return receipt;
  const ids = new Set(receipt.paymentIds || []);
  if (!ids.size) return receipt;
  const unpaid = data.beneficiaries.flatMap((entry) => entry.payments || []).filter((payment) => ids.has(payment.id));
  if (unpaid.some((payment) => payment.paymentStatus === "review")) return receipt;
  const paidIds = new Set((data.recentPaid || []).map((payment) => payment.id));
  if ([...ids].every((id) => paidIds.has(id))) return { ...receipt, status: "auto_paid" };
  // A rejection or a balance no longer returned should be shown by the fresh
  // round list instead of leaving an obsolete "pending" banner on screen.
  return null;
}

// Focus/visibility events often arrive together on mobile. Share one request,
// and suppress extra background reads until enough time has passed.
export function createPaymentRefreshGate(load, minInterval = 15000, now = Date.now) {
  let inFlight = null;
  let lastLoadedAt = 0;
  return (force = false) => {
    if (inFlight) return inFlight;
    if (!force && lastLoadedAt && now() - lastLoadedAt < minInterval) return Promise.resolve(null);
    inFlight = Promise.resolve().then(load).then((value) => {
      lastLoadedAt = now();
      return value;
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
}
