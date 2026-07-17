export function getEventIdFromSearch(search) {
  const params = new URLSearchParams(search);
  const liffState = params.get("liff.state");
  if (liffState) {
    const stateEventId = new URLSearchParams(liffState.replace(/^\?/, "")).get("event_id");
    if (stateEventId) return stateEventId;
  }
  return params.get("event_id");
}

export function buildArrivalTimeOptions(startValue, endValue) {
  const start = timeMinutes(startValue);
  let end = timeMinutes(endValue);
  if (start === null || end === null) return [];
  if (end <= start) end += 24 * 60;

  const options = [];
  for (let minute = start; minute < end; minute += 30) {
    const normalized = minute % (24 * 60);
    options.push(`${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`);
  }
  return options;
}

function timeMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}
