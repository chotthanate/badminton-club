import React, { useMemo, useState } from "react";
import { Check, Pencil, Users, X } from "lucide-react";
import SkillCompatibilityPicker from "./SkillCompatibilityPicker.jsx";
import { updateOperatorAttendance, updateOperatorMemberSkill, updateOperatorSignupArrival } from "./clubRepository.js";
import { defaultPlayableSkillLevels, normalizePlayableSkillLevels } from "./skillLevels.js";

function nameOf(member) {
  return member?.nickname || member?.display_name || "ไม่ทราบชื่อ";
}

function minuteValue(value) {
  if (!value) return null;
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function roundNowToQuarter() {
  const date = new Date();
  const minutes = Math.round(date.getMinutes() / 15) * 15;
  date.setMinutes(minutes, 0, 0);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function timeOptions(start, end) {
  const startMinute = minuteValue(start);
  let endMinute = minuteValue(end);
  if (startMinute === null || endMinute === null) return [];
  if (endMinute <= startMinute) endMinute += 1440;
  const result = [];
  for (let minute = startMinute; minute <= endMinute; minute += 15) result.push(`${String(Math.floor((minute % 1440) / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
  return result;
}

function sessionMinute(value, sessionStart) {
  const minute = minuteValue(value);
  const startMinute = minuteValue(sessionStart);
  if (minute === null || startMinute === null) return null;
  return minute < startMinute ? minute + 1440 : minute;
}

export default function StaffParticipantsPanel({ dashboard, event, mutate }) {
  const [editing, setEditing] = useState(null);
  const options = useMemo(() => timeOptions(event.startTime, event.endTime), [event.startTime, event.endTime]);
  const membersById = new Map((dashboard.members || []).map((member) => [member.id, member]));
  const attendanceById = new Map((dashboard.attendance || []).map((row) => [row.member_id, row]));
  const players = (dashboard.signups || []).filter((signup) => signup.status === "coming").map((signup) => ({ signup, member: membersById.get(signup.member_id), attendance: attendanceById.get(signup.member_id) })).filter((row) => row.member);

  async function toggleArrival(player) {
    const checked = Boolean(player.attendance?.arrived && !player.attendance?.left_at);
    if (checked) return mutate(() => updateOperatorAttendance({ eventId: event.id, memberId: player.member.id, arrived: false }), `ยกเลิกเช็กชื่อ ${nameOf(player.member)} แล้ว`);
    const planned = player.signup.arrival_time?.slice(0, 5) || event.startTime;
    const now = roundNowToQuarter();
    const shouldSuggest = sessionMinute(now, event.startTime) > sessionMinute(planned, event.startTime);
    const arrivedAt = shouldSuggest && window.confirm(`เวลาปัจจุบันประมาณ ${now} น.\nอัปเดตเวลาเข้าจาก ${planned} เป็น ${now} ไหม?`) ? now : planned;
    return mutate(async () => {
      if (arrivedAt !== planned) await updateOperatorSignupArrival({ eventId: event.id, memberId: player.member.id, arrivalTime: arrivedAt });
      await updateOperatorAttendance({ eventId: event.id, memberId: player.member.id, arrived: true, arrivedAt });
    }, `เช็กชื่อ ${nameOf(player.member)} แล้ว`);
  }

  return <section className="badminton-card badminton-staff-players"><div className="badminton-card-title"><Users size={20} /><div><h2>ผู้เล่น</h2><p>{players.length} คน · เช็กชื่อ แก้เวลา และระดับมือ</p></div></div><div className="badminton-staff-player-list">{players.map((player, index) => {
    const arrived = Boolean(player.attendance?.arrived);
    const leftAt = player.attendance?.left_at?.slice(0, 5) || "";
    const arrival = player.signup.arrival_time?.slice(0, 5) || event.startTime;
    return <article className={`badminton-staff-player ${leftAt ? "has-left" : ""}`} key={player.member.id}><div className="badminton-staff-player-head"><button aria-label={`เช็กชื่อ ${nameOf(player.member)}`} className={`badminton-arrival-check ${arrived ? "is-checked" : ""}`} onClick={() => toggleArrival(player)} type="button">{arrived ? <Check size={18} /> : null}</button><strong>{index + 1}. {nameOf(player.member)}</strong>{player.member.display_name && player.member.display_name !== nameOf(player.member) ? <span className="badminton-line-name">LINE: {player.member.display_name}</span> : null}<em>{player.signup.skill_level_snapshot || player.member.skill_level || "-"}</em><button aria-label={`แก้ระดับ ${nameOf(player.member)}`} onClick={() => setEditing(player)} type="button"><Pencil size={16} /></button></div><div className="badminton-staff-time-row"><label>เข้า<select onChange={(changeEvent) => mutate(() => updateOperatorSignupArrival({ eventId: event.id, memberId: player.member.id, arrivalTime: changeEvent.target.value }), `ปรับเวลาเข้าของ ${nameOf(player.member)} แล้ว`)} value={arrival}>{options.map((time) => <option key={time}>{time}</option>)}</select></label><label>ออก<select onChange={(changeEvent) => mutate(() => updateOperatorAttendance({ eventId: event.id, memberId: player.member.id, arrived: true, arrivedAt: player.attendance?.arrived_at?.slice(0, 5) || arrival, leftAt: changeEvent.target.value || null }), `ปรับเวลาออกของ ${nameOf(player.member)} แล้ว`)} value={leftAt}><option value="">อยู่จนจบรอบ</option>{options.map((time) => <option key={time}>{time}</option>)}</select></label></div></article>;
  })}</div>{editing ? <SkillEditor eventId={event.id} member={editing.member} mutate={mutate} onClose={() => setEditing(null)} signup={editing.signup} /> : null}</section>;
}

function SkillEditor({ eventId, member, mutate, onClose, signup }) {
  const initialLevel = signup.skill_level_snapshot || member.skill_level || "";
  const [profile, setProfile] = useState({ level: initialLevel, playableLevels: normalizePlayableSkillLevels(initialLevel, signup.playable_skill_levels_snapshot?.length ? signup.playable_skill_levels_snapshot : member.playable_skill_levels, { allowLowerLevel: signup.allow_lower_level_snapshot, allowHigherLevel: signup.allow_higher_level_snapshot }) });
  async function save(eventObject) {
    eventObject.preventDefault();
    const saved = await mutate(() => updateOperatorMemberSkill({ eventId, memberId: member.id, skillLevel: profile.level, playableSkillLevels: profile.playableLevels }), `บันทึกระดับของ ${nameOf(member)} แล้ว`);
    if (saved) onClose();
  }
  return <div className="badminton-modal-backdrop" role="presentation"><form className="badminton-custom-charge-modal" onSubmit={save}><div className="badminton-modal-title"><div><p className="badminton-kicker">ข้อมูลผู้เล่น</p><h2>{nameOf(member)}</h2></div><button aria-label="ปิด" onClick={onClose} type="button"><X size={18} /></button></div><label>ระดับมือ<select onChange={(eventObject) => { const level = eventObject.target.value; setProfile({ level, playableLevels: defaultPlayableSkillLevels(level) }); }} value={profile.level}>{["Rookie-", "Rookie", "BG", "N", "S", "P"].map((level) => <option key={level}>{level}</option>)}</select></label><SkillCompatibilityPicker skillLevel={profile.level} onChange={(playableLevels) => setProfile({ ...profile, playableLevels })} value={profile.playableLevels} /><p className="badminton-note">ถ้ากำลังรอ ค่านี้มีผลกับคิวถัดไปทันที แต่คิวที่อนุมัติหรือเกมที่กำลังเล่นยังใช้ระดับเดิม</p><button className="badminton-primary" type="submit"><Check size={17} /> บันทึก</button></form></div>;
}
