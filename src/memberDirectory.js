import { normalizeMemberSearch } from "./memberSearch.js";

export function directoryMemberName(member) {
  return member?.nickname?.trim() || member?.display_name?.trim() || "ไม่ระบุชื่อ";
}

export function filterDirectoryMembers(members, query = "") {
  const search = normalizeMemberSearch(query);
  return members.filter((member) => member.role === "member" && member.active !== false)
    .filter((member) => !search || [member.nickname, member.display_name, ...(member.aliases || [])]
      .some((name) => normalizeMemberSearch(name).includes(search)))
    .sort((a, b) => directoryMemberName(a).localeCompare(directoryMemberName(b), "th"));
}

export function toggleMergeMember(ids, id) {
  return ids.includes(id) ? ids.filter((value) => value !== id) : ids.length < 2 ? [...ids, id] : ids;
}

export function preferredMergeTarget(members) {
  return [...members].sort((a, b) => Number(Boolean(b.line_user_id)) - Number(Boolean(a.line_user_id))
    || String(a.created_at || "").localeCompare(String(b.created_at || ""))
    || String(a.id).localeCompare(String(b.id)))[0]?.id || "";
}

export function memberInLiveQueue(memberId, dashboard) {
  const activeMatches = new Set((dashboard.queueMatches || []).filter((match) => ["draft", "approved", "playing"].includes(match.status)).map((match) => match.id));
  return (dashboard.queueMatchPlayers || []).some((row) => row.member_id === memberId && activeMatches.has(row.match_id))
    || (dashboard.queuePlayers || []).some((row) => row.member_id === memberId && ["reserved", "playing"].includes(row.status));
}

export function archiveMemberBlockedReason(member, dashboard) {
  if (!member || member.role !== "member" || member.active === false) return "ไม่พบสมาชิกที่ใช้งานอยู่ กรุณาโหลดข้อมูลล่าสุด";
  if (memberInLiveQueue(member.id, dashboard)) return "คนนี้กำลังเล่นหรืออยู่ในคิว กรุณาจบเกมหรือนำออกจากคิวก่อน";
  if (["draft", "open"].includes(dashboard.event?.status)
    && [dashboard.signups, dashboard.attendance, dashboard.queuePlayers].some((rows) => (rows || []).some((row) => row.member_id === member.id))) {
    return "คนนี้ยังมีข้อมูลอยู่ในรอบที่กำลังใช้งาน กรุณารอจบรอบก่อนลบออกจากรายชื่อ";
  }
  return "";
}

export function mergeMembersBlockedReason(members, dashboard) {
  if (members.length !== 2 || members[0]?.id === members[1]?.id || members.some((member) => !member || member.active === false || member.role !== "member")) return "กรุณาเลือกผู้เล่นที่ใช้งานอยู่ 2 รายชื่อ";
  const [a, b] = members;
  if (a.line_user_id && b.line_user_id && a.line_user_id !== b.line_user_id) return "สองรายชื่อนี้เชื่อมคนละบัญชี LINE จึงรวมไม่ได้";
  if (a.profile_id && b.profile_id && a.profile_id !== b.profile_id) return "สองรายชื่อนี้เชื่อมคนละบัญชีผู้ใช้ จึงรวมไม่ได้";
  if (members.some((member) => memberInLiveQueue(member.id, dashboard))) return "มีชื่อที่กำลังเล่นหรืออยู่ในคิว กรุณาจบเกมหรือนำออกจากคิวก่อนรวม";
  return "";
}

export function hasMemberDraft(memberId, storage) {
  try {
    const targetStorage = storage === undefined ? globalThis.sessionStorage : storage;
    const draft = JSON.parse(targetStorage?.getItem(`badminton:member:${memberId}`) || "null");
    return Boolean(draft && JSON.stringify(draft.value) !== draft.base);
  } catch { return false; }
}

export async function runDirectoryMutation(mutate, action, notice, options = {}) {
  let reportedError;
  const onError = (error) => { reportedError = error?.message || "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง"; };
  try {
    const saved = await mutate(action, notice, { ...options, onError });
    return saved ? { saved: true, error: "" } : { saved: false, error: reportedError || "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง ข้อมูลที่เลือกยังอยู่" };
  } catch (error) {
    return { saved: false, error: error?.message || "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง" };
  }
}
