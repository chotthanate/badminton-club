import { normalizeMemberSearch } from "./memberSearch.js";
import { timePositionWithinEvent } from "./badmintonLogic.js";

export function resolveParticipantMember(members, query, selectedId) {
  const selected = members.find((member) => member.id === selectedId);
  if (selected) return selected;
  const normalized = normalizeMemberSearch(query);
  const exact = normalized ? members.filter((member) => [member.nickname, member.display_name, ...(member.aliases || [])]
    .some((value) => normalizeMemberSearch(value) === normalized)) : [];
  if (exact.length > 1) throw new Error("พบชื่อซ้ำ กรุณาเลือกผู้เล่นจากรายชื่อโดยดูชื่อ LINE ประกอบ");
  return exact[0] || null;
}

export function activeParticipantSignup(signup) {
  return signup.status === "coming" && !signup.removedAt && !signup.removed_at;
}

export function participantRemovalMessage(name) {
  return `นำ “${name}” ออกจากรายชื่อรอบนี้ใช่ไหม?\n\nคิวที่ยังไม่เริ่มและมีชื่อนี้จะถูกยกเลิก ต้องจัดคิวใหม่ให้คนที่เหลือ ส่วนเกมที่เล่นแล้ว ประวัติการเงินและการชำระเงินยังเก็บไว้\n\nถ้ากำลังเล่นต้องจบเกมก่อน รายการนี้ไม่ใช่การรวมชื่อซ้ำหรือโอนยอดเงินไปอีกชื่อ`;
}

export function participantTimeLabel(time, startTime, endTime) {
  return `${time}${timePositionWithinEvent(time, startTime, endTime) >= 1440 ? " (วันถัดไป)" : ""}`;
}

export function participantTimeOptions({ startTime, endTime, current = "", after = null, before = null, includeEnd = true }) {
  const start = timePositionWithinEvent(startTime, startTime, endTime);
  const end = timePositionWithinEvent(endTime, startTime, endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return current ? [current.slice(0, 5)] : [];
  const values = new Set();
  for (let minute = start; minute < end; minute += 15) {
    values.add(`${String(Math.floor(minute % 1440 / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
  }
  if (includeEnd) values.add(endTime.slice(0, 5));
  if (current) values.add(current.slice(0, 5));
  const afterPosition = after ? timePositionWithinEvent(after, startTime, endTime) : null;
  const beforePosition = before ? timePositionWithinEvent(before, startTime, endTime) : null;
  return [...values].filter((time) => time === current.slice(0, 5) || (
    (afterPosition === null || timePositionWithinEvent(time, startTime, endTime) > afterPosition)
    && (beforePosition === null || timePositionWithinEvent(time, startTime, endTime) < beforePosition)
  )).sort((a, b) => timePositionWithinEvent(a, startTime, endTime) - timePositionWithinEvent(b, startTime, endTime));
}
