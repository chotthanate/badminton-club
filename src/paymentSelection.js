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
