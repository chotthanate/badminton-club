export function buildPaymentExtraRequests(payments, maxMembersPerRequest = 40) {
  const limit = Math.max(1, Number(maxMembersPerRequest) || 40);
  const membersByEvent = new Map();

  for (const payment of payments || []) {
    if (!payment?.event_id || !payment?.member_id) continue;
    const members = membersByEvent.get(payment.event_id) || new Set();
    members.add(payment.member_id);
    membersByEvent.set(payment.event_id, members);
  }

  const requests = [];
  for (const [eventId, members] of membersByEvent) {
    const memberIds = [...members];
    for (let index = 0; index < memberIds.length; index += limit) {
      requests.push({ eventId, memberIds: memberIds.slice(index, index + limit) });
    }
  }
  return requests;
}
