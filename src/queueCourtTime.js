function parseCourtTime(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 24 || minutes < 0 || minutes > 59 || (hours === 24 && minutes !== 0)) return null;
  return (hours % 24) * 60 + minutes;
}

function bangkokInstant(eventDate, minutes, nextDay = false) {
  const [year, month, day] = String(eventDate || "").split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return null;
  return new Date(Date.UTC(year, month - 1, day + (nextDay ? 1 : 0), 0, minutes - (7 * 60)));
}

export function courtTimeStatus({ eventDate, eventStartTime, courtStartTime, courtEndTime, now = new Date() }) {
  const eventStart = parseCourtTime(eventStartTime);
  const courtStart = parseCourtTime(courtStartTime);
  const courtEnd = parseCourtTime(courtEndTime);
  const current = now instanceof Date ? now : new Date(now);
  if (eventStart === null || courtStart === null || courtEnd === null || Number.isNaN(current.getTime())) return "active";

  const startsAt = bangkokInstant(eventDate, courtStart, courtStart < eventStart);
  const endsNextDay = courtEnd < eventStart || courtEnd <= courtStart;
  const endsAt = bangkokInstant(eventDate, courtEnd, endsNextDay);
  if (!startsAt || !endsAt || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return "active";
  if (current < startsAt) return "upcoming";
  if (current >= endsAt) return "expired";
  return "active";
}
