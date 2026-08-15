function minutesOfDay(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function scheduledCourtStartMs(eventDate, eventStartTime, courtStartTime) {
  const eventStartMinutes = minutesOfDay(eventStartTime);
  const courtStartMinutes = minutesOfDay(courtStartTime);
  const eventMidnight = Date.parse(`${eventDate}T00:00:00+07:00`);
  if (!Number.isFinite(eventMidnight) || eventStartMinutes === null || courtStartMinutes === null) return null;
  const nextDay = courtStartMinutes < eventStartMinutes ? 24 * 60 : 0;
  return eventMidnight + (courtStartMinutes + nextDay) * 60 * 1000;
}

export function courtHasStarted(eventDate, eventStartTime, courtStartTime, nowMs = Date.now()) {
  const startsAt = scheduledCourtStartMs(eventDate, eventStartTime, courtStartTime);
  return startsAt === null || nowMs >= startsAt;
}
