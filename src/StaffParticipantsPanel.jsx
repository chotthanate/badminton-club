import React, { useMemo, useState } from "react";
import { ArrowUpDown, Check, PackagePlus, Pencil, Plus, Trash2, UserPlus, Users, X } from "lucide-react";
import SkillCompatibilityPicker from "./SkillCompatibilityPicker.jsx";
import {
  addOperatorCustomMemberExtra,
  addOperatorMemberExtra,
  addOperatorParticipant,
  removeOperatorMemberExtra,
  removeOperatorParticipant,
  updateOperatorAttendance,
  updateOperatorMemberSkill,
  updateOperatorSignupArrival,
} from "./clubRepository.js";
import { loadPlayerSortMode, savePlayerSortMode } from "./playerSortPreference.js";
import { defaultPlayableSkillLevels, normalizePlayableSkillLevels, SKILL_LEVELS } from "./skillLevels.js";

function nameOf(member) {
  return member?.nickname || member?.display_name || "ไม่ทราบชื่อ";
}

function priceOf(value) {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(Number(value) || 0);
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
  for (let minute = startMinute; minute <= endMinute; minute += 15) {
    result.push(`${String(Math.floor((minute % 1440) / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
  }
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
  const [sortMode, setSortMode] = useState(loadPlayerSortMode);
  const [existingMemberId, setExistingMemberId] = useState("");
  const [existingSkill, setExistingSkill] = useState("");
  const [newPlayer, setNewPlayer] = useState({ name: "", skillLevel: "" });
  const [customExtraFor, setCustomExtraFor] = useState(null);
  const [customExtra, setCustomExtra] = useState({ name: "", price: "" });
  const options = useMemo(() => timeOptions(event.startTime, event.endTime), [event.startTime, event.endTime]);
  const membersById = new Map((dashboard.members || []).map((member) => [member.id, member]));
  const attendanceById = new Map((dashboard.attendance || []).map((row) => [row.member_id, row]));
  const signupMemberIds = new Set((dashboard.signups || []).filter((signup) => signup.status === "coming").map((signup) => signup.member_id));
  const availableMembers = (dashboard.members || [])
    .filter((member) => member.role === "member" && !signupMemberIds.has(member.id))
    .sort((left, right) => nameOf(left).localeCompare(nameOf(right), "th"));
  const players = (dashboard.signups || [])
    .filter((signup) => signup.status === "coming")
    .map((signup) => ({ signup, member: membersById.get(signup.member_id), attendance: attendanceById.get(signup.member_id) }))
    .filter((row) => row.member)
    .sort((left, right) => sortMode === "alphabetical"
      ? nameOf(left.member).localeCompare(nameOf(right.member), "th")
      : String(left.signup.created_at || "").localeCompare(String(right.signup.created_at || "")));
  const extrasByMember = new Map();
  for (const charge of dashboard.memberExtras || []) {
    const rows = extrasByMember.get(charge.member_id) || [];
    rows.push(charge);
    extrasByMember.set(charge.member_id, rows);
  }

  function changeSortMode(nextMode) {
    setSortMode(nextMode);
    savePlayerSortMode(nextMode);
  }

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

  async function addExistingPlayer(submitEvent) {
    submitEvent.preventDefault();
    const member = membersById.get(existingMemberId);
    if (!member) return;
    const saved = await mutate(
      () => addOperatorParticipant({ eventId: event.id, memberId: member.id, skillLevel: existingSkill || member.skill_level }),
      `เพิ่ม ${nameOf(member)} เข้ารอบแล้ว`,
    );
    if (saved) {
      setExistingMemberId("");
      setExistingSkill("");
    }
  }

  async function addNewPlayer(submitEvent) {
    submitEvent.preventDefault();
    const saved = await mutate(
      () => addOperatorParticipant({ eventId: event.id, nickname: newPlayer.name.trim(), skillLevel: newPlayer.skillLevel }),
      `เพิ่ม ${newPlayer.name.trim()} เข้ารอบแล้ว`,
    );
    if (saved) setNewPlayer({ name: "", skillLevel: "" });
  }

  function removePlayer(player) {
    const playerName = nameOf(player.member);
    if (!window.confirm(`ลบ ${playerName} ออกจากรอบนี้ใช่ไหม?`)) return;
    mutate(
      () => removeOperatorParticipant({ eventId: event.id, memberId: player.member.id }),
      `ลบ ${playerName} ออกจากรอบแล้ว`,
      { errorMode: "alert" },
    );
  }

  async function addCustomExtra(submitEvent) {
    submitEvent.preventDefault();
    if (!customExtraFor) return;
    const itemName = customExtra.name.trim();
    const saved = await mutate(
      () => addOperatorCustomMemberExtra({
        eventId: event.id,
        memberId: customExtraFor.memberId,
        itemName,
        unitPrice: Number(customExtra.price),
      }),
      `เพิ่ม ${itemName} ให้ ${customExtraFor.name} แล้ว`,
    );
    if (saved) {
      setCustomExtraFor(null);
      setCustomExtra({ name: "", price: "" });
    }
  }

  function chooseExtra(itemId, player) {
    if (!itemId) return;
    if (itemId === "custom") {
      setCustomExtraFor({ memberId: player.member.id, name: nameOf(player.member) });
      setCustomExtra({ name: "", price: "" });
      return;
    }
    const item = (dashboard.extraItems || []).find((entry) => entry.id === itemId);
    if (!item) return;
    mutate(
      () => addOperatorMemberExtra({ eventId: event.id, memberId: player.member.id, itemId }),
      `เพิ่ม ${item.name} ${priceOf(item.price)} บาท ให้ ${nameOf(player.member)} แล้ว`,
    );
  }

  return <section className="badminton-card badminton-staff-players">
    <div className="badminton-card-title badminton-staff-player-title"><Users size={20} /><div><h2>ผู้เล่น</h2><p>{players.length} คน</p></div><label className="badminton-player-sort-icon" title={sortMode === "signup" ? "เรียงตามลำดับการลงชื่อ" : "เรียงตามตัวอักษร"}><ArrowUpDown size={18} /><select aria-label="เรียงลำดับผู้เล่นสำหรับสตาฟ" onChange={(changeEvent) => changeSortMode(changeEvent.target.value)} value={sortMode}><option value="signup">ลำดับการลงชื่อ</option><option value="alphabetical">ตามตัวอักษร</option></select></label></div>
    <details className="badminton-staff-add-player"><summary><UserPlus size={17} /> เพิ่มผู้เล่น</summary><div><form onSubmit={addExistingPlayer}><label>เลือกจากรายชื่อเดิม<select onChange={(changeEvent) => { const member = membersById.get(changeEvent.target.value); setExistingMemberId(changeEvent.target.value); setExistingSkill(member?.skill_level || ""); }} required value={existingMemberId}><option value="">เลือกผู้เล่น</option>{availableMembers.map((member) => <option key={member.id} value={member.id}>{nameOf(member)}{member.display_name && member.display_name !== nameOf(member) ? ` · LINE: ${member.display_name}` : ""}</option>)}</select></label><label>ระดับมือ<select onChange={(changeEvent) => setExistingSkill(changeEvent.target.value)} required value={existingSkill}><option value="">เลือกระดับ</option>{SKILL_LEVELS.map((level) => <option key={level}>{level}</option>)}</select></label><button className="badminton-secondary" type="submit"><Plus size={16} /> เพิ่ม</button></form><form onSubmit={addNewPlayer}><label>เพิ่มชื่อใหม่<input aria-label="ชื่อเล่นผู้เล่นใหม่" onChange={(changeEvent) => setNewPlayer({ ...newPlayer, name: changeEvent.target.value })} placeholder="ชื่อเล่น" required value={newPlayer.name} /></label><label>ระดับมือ<select onChange={(changeEvent) => setNewPlayer({ ...newPlayer, skillLevel: changeEvent.target.value })} required value={newPlayer.skillLevel}><option value="">เลือกระดับ</option>{SKILL_LEVELS.map((level) => <option key={level}>{level}</option>)}</select></label><button className="badminton-secondary" type="submit"><Plus size={16} /> เพิ่มชื่อใหม่</button></form></div></details>
    <div className="badminton-staff-player-list">{players.map((player, index) => {
      const arrived = Boolean(player.attendance?.arrived);
      const leftAt = player.attendance?.left_at?.slice(0, 5) || "";
      const arrival = player.signup.arrival_time?.slice(0, 5) || event.startTime;
      const playerExtras = extrasByMember.get(player.member.id) || [];
      const lineName = player.member.display_name && player.member.display_name !== nameOf(player.member) ? player.member.display_name : "";
      return <article className={`badminton-staff-player ${leftAt ? "has-left" : ""}`} key={player.member.id}>
        <div className="badminton-staff-player-head"><button aria-label={`เช็กชื่อ ${nameOf(player.member)}`} className={`badminton-arrival-check ${arrived ? "is-checked" : ""}`} onClick={() => toggleArrival(player)} type="button">{arrived ? <Check size={16} /> : null}</button><span className="badminton-staff-player-index">{index + 1}.</span><div className="badminton-staff-player-identity"><div><strong>{nameOf(player.member)}</strong><em>{player.signup.skill_level_snapshot || player.member.skill_level || "-"}</em></div>{lineName ? <span className="badminton-line-name" title={`LINE: ${lineName}`}>LINE: {lineName}</span> : null}</div><button aria-label={`แก้ระดับ ${nameOf(player.member)}`} className="badminton-staff-edit-button" onClick={() => setEditing(player)} type="button"><Pencil size={16} /></button><button aria-label={`ลบ ${nameOf(player.member)}`} className="badminton-delete-button badminton-staff-delete-button" onClick={() => removePlayer(player)} type="button"><Trash2 size={16} /></button></div>
        <div className="badminton-staff-controls"><div className="badminton-staff-time-row"><label><span>เข้า</span><select onChange={(changeEvent) => mutate(() => updateOperatorSignupArrival({ eventId: event.id, memberId: player.member.id, arrivalTime: changeEvent.target.value }), `ปรับเวลาเข้าของ ${nameOf(player.member)} แล้ว`)} value={arrival}>{options.map((time) => <option key={time}>{time}</option>)}</select></label><label><span>ออก</span><select onChange={(changeEvent) => mutate(() => updateOperatorAttendance({ eventId: event.id, memberId: player.member.id, arrived: true, arrivedAt: player.attendance?.arrived_at?.slice(0, 5) || arrival, leftAt: changeEvent.target.value || null }), `ปรับเวลาออกของ ${nameOf(player.member)} แล้ว`)} value={leftAt}><option value="">อยู่จนจบรอบ</option>{options.map((time) => <option key={time}>{time}</option>)}</select></label></div><label className="badminton-staff-extra-select"><PackagePlus size={16} /><select aria-label={`เพิ่มน้ำหรือขนมให้ ${nameOf(player.member)}`} onChange={(changeEvent) => chooseExtra(changeEvent.target.value, player)} value=""><option value="">+ น้ำ/ขนม</option>{(dashboard.extraItems || []).map((item) => <option key={item.id} value={item.id}>{item.name} · {priceOf(item.price)} บาท</option>)}<option value="custom">กรอกรายการเอง…</option></select></label></div>
        {playerExtras.length ? <div className="badminton-staff-extra-chips">{playerExtras.map((charge) => <span key={charge.id}>{charge.item_name}{Number(charge.quantity) > 1 ? ` ×${charge.quantity}` : ""} · {priceOf(Number(charge.unit_price) * Number(charge.quantity || 1))} บาท<button aria-label={`ลบ ${charge.item_name}`} onClick={() => { if (window.confirm(`ลบ ${charge.item_name} ของ ${nameOf(player.member)} ใช่ไหม?`)) mutate(() => removeOperatorMemberExtra({ eventId: event.id, chargeId: charge.id }), `ลบ ${charge.item_name} แล้ว`); }} type="button">×</button></span>)}</div> : null}
      </article>;
    })}</div>
    {editing ? <SkillEditor eventId={event.id} member={editing.member} mutate={mutate} onClose={() => setEditing(null)} signup={editing.signup} /> : null}
    {customExtraFor ? <div className="badminton-modal-backdrop" role="presentation"><form className="badminton-custom-charge-modal" onSubmit={addCustomExtra}><div className="badminton-modal-title"><div><p className="badminton-kicker">น้ำ/ขนม</p><h2>เพิ่มรายการให้ {customExtraFor.name}</h2></div><button aria-label="ปิดหน้าต่าง" onClick={() => setCustomExtraFor(null)} type="button"><X size={18} /></button></div><label>ชื่อรายการ<input autoFocus maxLength="80" onChange={(changeEvent) => setCustomExtra({ ...customExtra, name: changeEvent.target.value })} placeholder="ชื่อสินค้า" required value={customExtra.name} /></label><label>ราคา (บาท)<input inputMode="decimal" min="0" onChange={(changeEvent) => setCustomExtra({ ...customExtra, price: changeEvent.target.value })} placeholder="0" required step="0.01" type="number" value={customExtra.price} /></label><button className="badminton-primary" type="submit"><Plus size={17} /> เพิ่มรายการ</button></form></div> : null}
  </section>;
}

function SkillEditor({ eventId, member, mutate, onClose, signup }) {
  const initialLevel = signup.skill_level_snapshot || member.skill_level || "";
  const [profile, setProfile] = useState({ level: initialLevel, playableLevels: normalizePlayableSkillLevels(initialLevel, signup.playable_skill_levels_snapshot?.length ? signup.playable_skill_levels_snapshot : member.playable_skill_levels, { allowLowerLevel: signup.allow_lower_level_snapshot, allowHigherLevel: signup.allow_higher_level_snapshot }) });
  async function save(eventObject) {
    eventObject.preventDefault();
    const saved = await mutate(() => updateOperatorMemberSkill({ eventId, memberId: member.id, skillLevel: profile.level, playableSkillLevels: profile.playableLevels }), `บันทึกระดับของ ${nameOf(member)} แล้ว`);
    if (saved) onClose();
  }
  return <div className="badminton-modal-backdrop" role="presentation"><form className="badminton-custom-charge-modal" onSubmit={save}><div className="badminton-modal-title"><div><p className="badminton-kicker">ข้อมูลผู้เล่น</p><h2>{nameOf(member)}</h2></div><button aria-label="ปิด" onClick={onClose} type="button"><X size={18} /></button></div><label>ระดับมือ<select onChange={(eventObject) => { const level = eventObject.target.value; setProfile({ level, playableLevels: defaultPlayableSkillLevels(level) }); }} value={profile.level}>{SKILL_LEVELS.map((level) => <option key={level}>{level}</option>)}</select></label><SkillCompatibilityPicker skillLevel={profile.level} onChange={(playableLevels) => setProfile({ ...profile, playableLevels })} value={profile.playableLevels} /><p className="badminton-note">ถ้ากำลังรอ ค่านี้มีผลกับคิวถัดไปทันที แต่คิวที่อนุมัติหรือเกมที่กำลังเล่นยังใช้ระดับเดิม</p><button className="badminton-primary" type="submit"><Check size={17} /> บันทึก</button></form></div>;
}
