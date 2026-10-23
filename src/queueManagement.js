export function selectedUpcomingQueues(upcoming = [], selectedIds = []) {
  const selected = new Set(selectedIds);
  return upcoming.filter((match) => selected.has(match.id) && ["draft", "approved"].includes(match.status));
}

export function queueVersionRequests(matches = []) {
  return matches.map((match) => ({ matchId: match.id, expectedVersion: match.revision }));
}
