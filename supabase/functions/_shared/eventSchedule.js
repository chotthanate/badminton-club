function timeMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function formatMinutes(value) {
  const normalized = ((value % (24 * 60)) + (24 * 60)) % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function shortTime(value) {
  const minutes = timeMinutes(value);
  return minutes === null ? null : formatMinutes(minutes);
}

export function sessionBoundsForEvent(event = {}) {
  const courts = Array.isArray(event.event_courts) ? event.event_courts : [];
  const starts = [...new Set(courts.map((court) => timeMinutes(court?.starts_at)).filter((value) => value !== null))]
    .sort((left, right) => left - right);
  if (!starts.length) {
    return { startTime: shortTime(event.starts_at), endTime: shortTime(event.ends_at) };
  }

  let start = starts[0];
  if (starts.length > 1) {
    let largestGap = -1;
    starts.forEach((value, index) => {
      const next = index === starts.length - 1 ? starts[0] + (24 * 60) : starts[index + 1];
      const gap = next - value;
      if (gap > largestGap) {
        largestGap = gap;
        start = next % (24 * 60);
      }
    });
  }

  const ends = courts
    .map((court) => timeMinutes(court?.ends_at))
    .filter((value) => value !== null)
    .map((value) => value <= start ? value + (24 * 60) : value);
  return {
    startTime: formatMinutes(start),
    endTime: ends.length ? formatMinutes(Math.max(...ends)) : shortTime(event.ends_at),
  };
}

export function buildArrivalTimeOptionsForEvent(event = {}) {
  const { startTime, endTime } = sessionBoundsForEvent(event);
  const start = timeMinutes(startTime);
  let end = timeMinutes(endTime);
  if (start === null || end === null) return [];
  if (end <= start) end += 24 * 60;
  const options = [];
  for (let minute = start; minute < end; minute += 15) options.push(formatMinutes(minute));
  return options;
}

export function normalizeArrivalTimeForEvent(event, value) {
  const arrivalTime = shortTime(value);
  const options = buildArrivalTimeOptionsForEvent(event);
  if (!options.length) return arrivalTime;
  return arrivalTime && options.includes(arrivalTime) ? arrivalTime : options[0];
}
