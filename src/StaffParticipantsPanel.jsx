import React, { useState } from "react";
import { ArrowUpDown, Check, PackagePlus, Pencil, Plus, Trash2, UserPlus, Users, X } from "lucide-react";
import SkillCompatibilityPicker from "./SkillCompatibilityPicker.jsx";
import ParticipantFilters, { filterParticipants } from "./ParticipantFilters.jsx";
import ParticipantPicker from "./ParticipantPicker.jsx";
import { activeParticipantSignup, participantRemovalMessage, participantTimeLabel, participantTimeOptions, resolveParticipantMember } from "./participantControls.js";
import { suggestArrivalTimeOnCheck } from "./badmintonLogic.js";
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
import { defaultPlayableSkillLevels, normalizePlayableSkillLevels, skillLabel, SKILL_LEVELS } from "./skillLevels.js";

function nameOf(member) {
  return member?.nickname || member?.display_name || "ไม่ทราบชื่อ";
}

function priceOf(value) {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

export default function StaffParticipantsPanel({ dashboard, event, mutate, pendingKeys = [] }) {
  const [editing, setEditing] = useState(null);
  const [sortMode, setSortMode] = useState(loadPlayerSortMode);
  const [rosterQuery, setRosterQuery] = useState("");
  const [rosterFilter, setRosterFilter] = useState("all");
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [newPlayer, setNewPlayer] = useState({ name: "", skillLevel: "" });
  const [customExtraFor, setCustomExtraFor] = useState(null);
  const [customExtra, setCustomExtra] = useState({ name: "", price: "" });
  const membersById = new Map((dashboard.members || []).map((member) => [member.id, member]));
  const attendanceById = new Map((dashboard.attendance || []).map((row) => [row.member_id, row]));
  const signupMemberIds = new Set((dashboard.signups || []).filter(activeParticipantSignup).map((signup) => signup.member_id));
  const removedMemberIds = new Set((dashboard.signups || []).filter((signup) => signup.removed_at).map((signup) => signup.member_id));
  const availableMembers = (dashboard.members || [])
    .filter((member) => member.role === "member" && member.active !== false && (event.status !== "closed" || removedMemberIds.has(member.id)))
    .sort((left, right) => nameOf(left).localeCompare(nameOf(right), "th"));
  const addingPlayer = pendingKeys.some((key) => key.startsWith(`player:add:${event.id}:`));
  const players = (dashboard.signups || [])
    .filter(activeParticipantSignup)
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
    if (checked) return mutate(() => updateOperatorAttendance({ eventId: event.id, memberId: player.member.id, arrived: false }), `ยกเลิกเช็กชื่อ ${nameOf(player.member)} แล้ว`, { actionKey: `attendance:${player.member.id}` });
    const planned = player.signup.arrival_time?.slice(0, 5) || event.startTime;
    const suggested = suggestArrivalTimeOnCheck({ eventDate: event.date, startTime: event.startTime, endTime: event.endTime, plannedArrival: planned });
    const arrivedAt = suggested && window.confirm(`เวลาปัจจุบันประมาณ ${participantTimeLabel(suggested, event.startTime, event.endTime)} น.\nอัปเดตเวลาเข้าจาก ${planned} ไหม?`) ? suggested : planned;
    return mutate(async () => {
      if (arrivedAt !== planned) await updateOperatorSignupArrival({ eventId: event.id, memberId: player.member.id, arrivalTime: arrivedAt });
      await updateOperatorAttendance({ eventId: event.id, memberId: player.member.id, arrived: true, arrivedAt });
    }, `เช็กชื่อ ${nameOf(player.member)} แล้ว`, { actionKey: `attendance:${player.member.id}` });
  }

  async function addNewPlayer(submitEvent) {
    submitEvent.preventDefault();
    const saved = await mutate(
      () => {
        const member = resolveParticipantMember(availableMembers, newPlayer.name, selectedMemberId);
        if (!newPlayer.name.trim()) throw new Error("กรุณาพิมพ์ชื่อผู้เล่น");
        if (event.status === "closed" && (!member || !removedMemberIds.has(member.id))) throw new Error("รอบปิดแล้ว เพิ่มกลับได้เฉพาะชื่อที่เคยนำออกจากรอบนี้");
        if (member && signupMemberIds.has(member.id)) throw new Error("ผู้เล่นคนนี้อยู่ในรอบแล้ว");
        const skillLevel = member?.skill_level || newPlayer.skillLevel;
        if (!skillLevel) throw new Error("กรุณาเลือกระดับมือของผู้เล่น");
        return addOperatorParticipant({ eventId: event.id, memberId: member?.id || null, nickname: member ? null : newPlayer.name.trim(), skillLevel });
      },
      `เพิ่ม ${newPlayer.name.trim()} เข้ารอบแล้ว`,
      { actionKey: `player:add:${event.id}:${selectedMemberId || newPlayer.name.trim()}` },
    );
    if (saved) { setNewPlayer({ name: "", skillLevel: "" }); setSelectedMemberId(null); }
  }

  function removePlayer(player) {
    const playerName = nameOf(player.member);
    if (!window.confirm(participantRemovalMessage(playerName))) return;
    return mutate(
      () => removeOperatorParticipant({ eventId: event.id, memberId: player.member.id }),
      `นำ ${playerName} ออกจากรายชื่อรอบแล้ว ประวัติยังอยู่`,
      { errorMode: "alert", actionKey: `player:remove:${player.member.id}` },
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
      { actionKey: `extra:${customExtraFor.memberId}` },
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
      `เพิ่ม ${item.name} ${priceOf(item.price)} บาท ให้ ${nameOf(player.member)} แล้ว`, { actionKey: `extra:${player.member.id}` },
    );
  }

  return <section className="badminton-card badminton-staff-players">
    <div className="badminton-card-title badminton-staff-player-title"><Users size={20} /><div><h2>ผู้เล่น</h2><p>{players.length} คน</p></div><label className="badminton-player-sort-icon" title={sortMode === "signup" ? "เรียงตามลำดับการลงชื่อ" : "เรียงตามตัวอักษร"}><ArrowUpDown size={18} /><select aria-label="เรียงลำดับผู้เล่นสำหรับสตาฟ" onChange={(changeEvent) => changeSortMode(changeEvent.target.value)} value={sortMode}><option value="signup">ลำดับการลงชื่อ</option><option value="alphabetical">ตามตัวอักษร</option></select></label></div>
    <details className="badminton-staff-add-player"><summary><UserPlus size={17} /> เพิ่มผู้เล่น</summary><div><form onSubmit={addNewPlayer}>
      <ParticipantPicker allowCreate={event.status !== "closed"} disabled={addingPlayer} members={availableMembers} participantIds={signupMemberIds} selectedId={selectedMemberId} value={newPlayer.name} onQuery={(name) => { setSelectedMemberId(null); setNewPlayer({ name, skillLevel: "" }); }} onSelect={(member) => { setSelectedMemberId(member.id); setNewPlayer({ name: nameOf(member), skillLevel: member.skill_level || "" }); }} />
      {event.status === "closed" ? <small>รอบปิดแล้ว เลือกได้เฉพาะผู้เล่นที่เคยนำออกจากรอบนี้</small> : null}
      <label>ระดับมือ<select aria-label="ระดับมือผู้เล่น" disabled={addingPlayer || Boolean(selectedMemberId && membersById.get(selectedMemberId)?.skill_level)} onChange={(changeEvent) => setNewPlayer({ ...newPlayer, skillLevel: changeEvent.target.value })} required value={newPlayer.skillLevel}><option value="">เลือกระดับ</option>{SKILL_LEVELS.map((level) => <option key={level} value={level}>{skillLabel(level)}</option>)}</select></label>
      <button className="badminton-secondary" disabled={addingPlayer} type="submit"><Plus size={16} /> {addingPlayer ? "กำลังเพิ่ม…" : "เพิ่มผู้เล่น"}</button>
    </form></div></details>
    <ParticipantFilters rows={players} query={rosterQuery} onQuery={setRosterQuery} filter={rosterFilter} onFilter={setRosterFilter} /><div className="badminton-staff-player-list">{filterParticipants(players, rosterQuery, rosterFilter).map((player, index) => {
      const arrived = Boolean(player.attendance?.arrived);
      const leftAt = player.attendance?.left_at?.slice(0, 5) || "";
      const arrival = player.signup.arrival_time?.slice(0, 5) || event.startTime;
      const arrivalOptions = participantTimeOptions({ startTime: event.startTime, endTime: event.endTime, current: arrival, before: leftAt || null, includeEnd: false });
      const departureOptions = participantTimeOptions({ startTime: event.startTime, endTime: event.endTime, current: leftAt, after: arrival });
      const playerExtras = extrasByMember.get(player.member.id) || [];
      const lineName = player.member.display_name && player.member.display_name !== nameOf(player.member) ? player.member.display_name : "";
      return <fieldset disabled={pendingKeys.some((key) => typeof key === "string" && key.endsWith(`:${player.member.id}`))} className={`participant-controls-lock badminton-staff-player ${leftAt ? "has-left" : ""}`} key={player.member.id}>
        <div className="badminton-staff-player-head"><button aria-label={`เช็กชื่อ ${nameOf(player.member)}`} className={`badminton-arrival-check ${arrived ? "is-checked" : ""}`} onClick={() => toggleArrival(player)} type="button">{arrived ? <Check size={16} /> : null}</button><span className="badminton-staff-player-index">{index + 1}.</span><div className="badminton-staff-player-identity"><div><strong>{nameOf(player.member)}</strong><em>{skillLabel(player.signup.skill_level_snapshot || player.member.skill_level) || "-"}</em></div>{lineName ? <span className="badminton-line-name" title={`LINE: ${lineName}`}>LINE: {lineName}</span> : null}</div><button aria-label={`แก้ระดับ ${nameOf(player.member)}`} className="badminton-staff-edit-button" onClick={() => setEditing(player)} type="button"><Pencil size={16} /></button><button aria-label={`ลบ ${nameOf(player.member)}`} className="badminton-delete-button badminton-staff-delete-button" onClick={() => removePlayer(player)} type="button"><Trash2 size={16} /></button></div>
        <div className="badminton-staff-controls"><div className="badminton-staff-time-row">
          <label><span>เข้า</span><select aria-label={`เวลามา ${nameOf(player.member)}`} onChange={(changeEvent) => { const arrivalTime = changeEvent.target.value; return mutate(() => updateOperatorSignupArrival({ eventId: event.id, memberId: player.member.id, arrivalTime }), `ปรับเวลาเข้าของ ${nameOf(player.member)} แล้ว`, { actionKey: `arrival:${player.member.id}` }); }} value={arrival}>{arrivalOptions.map((time) => <option key={time} value={time}>{participantTimeLabel(time, event.startTime, event.endTime)}</option>)}</select></label>
          <label><span>ออก</span><select aria-label={`เวลากลับ ${nameOf(player.member)}`} onChange={(changeEvent) => { const leftAt = changeEvent.target.value || null; return mutate(() => updateOperatorAttendance({ eventId: event.id, memberId: player.member.id, arrived: true, arrivedAt: player.attendance?.arrived_at?.slice(0, 5) || arrival, leftAt }), `ปรับเวลาออกของ ${nameOf(player.member)} แล้ว`, { actionKey: `departure:${player.member.id}` }); }} value={leftAt}><option value="">อยู่จนจบรอบ</option>{departureOptions.map((time) => <option key={time} value={time}>{time}</option>)}</select></label>
        </div><label className="badminton-staff-extra-select"><PackagePlus size={16} /><select aria-label={`เพิ่มน้ำหรือขนมให้ ${nameOf(player.member)}`} onChange={(changeEvent) => chooseExtra(changeEvent.target.value, player)} value=""><option value="">+ น้ำ/ขนม</option>{(dashboard.extraItems || []).map((item) => <option key={item.id} value={item.id}>{item.name} · {priceOf(item.price)} บาท</option>)}<option value="custom">กรอกรายการเอง…</option></select></label></div>
        {playerExtras.length ? <div className="badminton-staff-extra-chips">{playerExtras.map((charge) => <span key={charge.id}>{charge.item_name}{Number(charge.quantity) > 1 ? ` ×${charge.quantity}` : ""} · {priceOf(Number(charge.unit_price) * Number(charge.quantity || 1))} บาท<button aria-label={`ลบ ${charge.item_name}`} onClick={() => { if (window.confirm(`ลบ ${charge.item_name} ของ ${nameOf(player.member)} ใช่ไหม?`)) mutate(() => removeOperatorMemberExtra({ eventId: event.id, chargeId: charge.id }), `ลบ ${charge.item_name} แล้ว`, { actionKey: `extra:remove:${charge.id}` }); }} type="button">×</button></span>)}</div> : null}
      </fieldset>;
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
    const saved = await mutate(() => updateOperatorMemberSkill({ eventId, memberId: member.id, skillLevel: profile.level, playableSkillLevels: profile.playableLevels }), `บันทึกระดับของ ${nameOf(member)} แล้ว`, { actionKey: `profile:${member.id}` });
    if (saved) onClose();
  }
  return <div className="badminton-modal-backdrop" role="presentation"><form className="badminton-custom-charge-modal" onSubmit={save}><div className="badminton-modal-title"><div><p className="badminton-kicker">ข้อมูลผู้เล่น</p><h2>{nameOf(member)}</h2></div><button aria-label="ปิด" onClick={onClose} type="button"><X size={18} /></button></div><label>ระดับมือ<select onChange={(eventObject) => { const level = eventObject.target.value; setProfile({ level, playableLevels: defaultPlayableSkillLevels(level) }); }} value={profile.level}>{SKILL_LEVELS.map((level) => <option key={level} value={level}>{skillLabel(level)}</option>)}</select></label><SkillCompatibilityPicker skillLevel={profile.level} onChange={(playableLevels) => setProfile({ ...profile, playableLevels })} value={profile.playableLevels} /><p className="badminton-note">ถ้ากำลังรอ ค่านี้มีผลกับคิวถัดไปทันที แต่คิวที่อนุมัติหรือเกมที่กำลังเล่นยังใช้ระดับเดิม</p><button className="badminton-primary" type="submit"><Check size={17} /> บันทึก</button></form></div>;
}
