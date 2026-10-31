export function bookingMinutes(time) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(time || ""));
  if (!match) return null;
  const hours = Number(match[1]); const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes !== 0)) return null;
  return (hours % 24) * 60 + minutes;
}

export function bookingTime(minutes) {
  const value = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function bookingDuration(startsAt, endsAt) {
  const start = bookingMinutes(startsAt); const end = bookingMinutes(endsAt);
  if (start === null || end === null) return null;
  return (end - start + 1440) % 1440;
}

export function bookingEndLabel(time, startsAt) {
  const end = bookingMinutes(time); const start = bookingMinutes(startsAt);
  return `${time.slice(0, 5)}${end !== null && start !== null && end <= start ? " · วันถัดไป" : ""}`;
}

export function bookingTimeOptions(currentTime = "", startsAt = null, minimumDuration = 0) {
  const start = bookingMinutes(startsAt);
  const times = new Set(Array.from({ length: 48 }, (_, index) => bookingTime(index * 30)));
  if (bookingMinutes(currentTime) !== null) times.add(bookingTime(bookingMinutes(currentTime)));
  return [...times].map((value) => ({ value, duration: start === null ? bookingMinutes(value) : bookingDuration(startsAt, value) }))
    .filter(({ duration }) => start === null || (duration > 0 && duration >= minimumDuration))
    .sort((a, b) => a.duration - b.duration)
    .map(({ value }) => ({ value, label: start === null ? value : bookingEndLabel(value, startsAt) }));
}

export function extendedBookingEnd(court, minutes = 30) {
  const duration = bookingDuration(court.startsAt, court.endsAt);
  if (!Number.isInteger(minutes) || minutes <= 0 || !duration || duration + minutes >= 1440) return null;
  return bookingTime(bookingMinutes(court.endsAt) + minutes);
}

export function normalizedCourtForm(court) {
  return { name: court.name || court.court_name || "", startsAt: String(court.startsAt || court.starts_at || "").slice(0, 5), endsAt: String(court.endsAt || court.ends_at || "").slice(0, 5) };
}

export function courtNameSuffix(name) {
  return String(name || "").trim().replace(/^คอร์ท\s*/u, "");
}

export function normalizedCourtName(value) {
  const suffix = courtNameSuffix(value);
  return suffix ? `คอร์ท ${suffix}` : "";
}

export function safeCourtStorage(kind = "localStorage") {
  try { return globalThis[kind]; } catch { return null; }
}

export function legacyCourtWork(eventId, courtId, storage) {
  try {
    const saved = JSON.parse((storage === undefined ? safeCourtStorage("sessionStorage") : storage)?.getItem(`badminton:courts:${eventId}`) || "null");
    const value = saved?.value?.[courtId]; const base = saved?.base ? JSON.parse(saved.base)?.[courtId] : null;
    if (!value || !base || JSON.stringify(value) === JSON.stringify(base)) return null;
    return { form: normalizedCourtForm(value), baseSignature: JSON.stringify(normalizedCourtForm(base)) };
  } catch { return null; }
}

export function clearLegacyCourtWork(eventId, courtId, storage) {
  try {
    const target = storage === undefined ? safeCourtStorage("sessionStorage") : storage;
    const key = `badminton:courts:${eventId}`;
    const saved = JSON.parse(target?.getItem(key) || "null");
    if (!saved?.value || !saved.base) return;
    const base = JSON.parse(saved.base);
    delete saved.value[courtId]; delete base[courtId]; saved.base = JSON.stringify(base);
    if (saved.base === JSON.stringify(saved.value)) target.removeItem(key);
    else target.setItem(key, JSON.stringify(saved));
  } catch { /* Retain in-memory work when storage is unavailable. */ }
}

export async function runCourtBookingMutation(mutate, action, message, actionKey) {
  let result; let failure = "";
  try {
    const saved = await mutate(async () => { result = await action(); return result; }, message, { actionKey, onError: (error) => { failure = error?.message || "บันทึกไม่สำเร็จ"; } });
    return { saved: Boolean(saved), result, error: saved ? "" : failure || "บันทึกไม่สำเร็จ ข้อมูลที่กรอกยังอยู่ กรุณาลองอีกครั้ง" };
  } catch (error) { return { saved: false, error: error?.message || "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง" }; }
}
