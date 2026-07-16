export function getEventIdFromSearch(search) {
  const params = new URLSearchParams(search);
  const liffState = params.get("liff.state");
  if (liffState) {
    const stateEventId = new URLSearchParams(liffState.replace(/^\?/, "")).get("event_id");
    if (stateEventId) return stateEventId;
  }
  return params.get("event_id");
}
