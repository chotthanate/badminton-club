export function selectedPaymentRows(beneficiaries = [], selectedPaymentIds = []) {
  const selectedIds = new Set(selectedPaymentIds);
  return beneficiaries.flatMap((beneficiary) => (beneficiary.payments || [])
    .filter((payment) => selectedIds.has(payment.id))
    .map((payment) => ({
      ...payment,
      memberId: beneficiary.id,
      memberName: beneficiary.name,
    })));
}

export function selectedPaymentTotal(beneficiaries = [], selectedPaymentIds = []) {
  return selectedPaymentRows(beneficiaries, selectedPaymentIds)
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

export function selectedPaymentExtras(beneficiaries = [], selectedPaymentIds = []) {
  const payments = selectedPaymentRows(beneficiaries, selectedPaymentIds);
  const grouped = new Map();
  payments.forEach((payment) => (payment.extras || []).forEach((extra) => {
    const name = String(extra.name || "รายการอื่น");
    const current = grouped.get(name) || { name, quantity: 0, amount: 0 };
    current.quantity += Number(extra.quantity || 1);
    current.amount += Number(extra.amount || 0);
    grouped.set(name, current);
  }));
  return {
    total: payments.reduce((sum, payment) => sum + Number(payment.extrasAmount || 0), 0),
    items: [...grouped.values()],
  };
}
