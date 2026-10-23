// Shared by the payment endpoint and its behavioral tests. Manual review is
// deliberately decided on the server, never just by hiding the automatic button.
export function evaluatePaymentSubmission({ manualReviewRequested, recipientStatus, transferredAmount, expectedAmount, datePasses, confidence, transferredOn, transactionReference }) {
  const manualReview = manualReviewRequested === true;
  const amountMismatch = transferredAmount !== null && Math.abs(transferredAmount - expectedAmount) >= 0.009;
  const error = !manualReview && recipientStatus === "mismatch" ? "recipient"
    : !manualReview && amountMismatch ? (transferredAmount < expectedAmount ? "underpaid" : "overpaid")
      : null;
  return {
    error,
    manualReview,
    autoPaidCandidate: !manualReview && !error && datePasses && confidence !== null && confidence >= 35
      && Boolean(transferredOn) && transferredAmount !== null && recipientStatus === "match" && Boolean(transactionReference),
  };
}

export function paymentSubmissionState(payment, latestSlip = null) {
  const paid = Boolean(payment.paid_at) || payment.payment_status === "paid";
  const pending = !paid && (latestSlip?.status === "pending" || payment.payment_status === "review");
  return {
    paymentStatus: paid ? "paid" : pending ? "review" : "awaiting",
    paidAt: payment.paid_at || null,
    submissionId: latestSlip?.id || null,
    submittedAt: latestSlip?.created_at || null,
    submissionStatus: latestSlip?.status || null,
    reviewReason: latestSlip?.review_reason || null,
  };
}

export function isSamePaymentSubmission(duplicate, submitterId, paymentIds) {
  if (duplicate?.submitted_by_member_id !== submitterId) return false;
  const storedIds = new Set(duplicate.payment_ids || []);
  const requestedIds = new Set(paymentIds || []);
  return storedIds.size > 0 && storedIds.size === requestedIds.size && [...requestedIds].every((id) => storedIds.has(id));
}
