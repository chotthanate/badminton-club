import React, { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { SKILL_LEVELS, defaultPlayableSkillLevels } from "./skillLevels.js";
import { skillLabel } from "./skillLevels.js";
import { usePersistentEditor } from "./usePersistentEditor.js";

export default function MemberDirectoryRow({ member, onSave, onDetails, onArchive, onMerge, selectedForMerge = false, onDirtyChange, disabled = false }) {
  const editor = usePersistentEditor(`badminton:member:${member.id}`, { name: member.nickname || member.display_name || "", level: member.skill_level || "" });
  const { name, level } = editor.value;
  const setName = (value) => editor.setValue((current) => ({ ...current, name: value }));
  const setLevel = (value) => editor.setValue((current) => ({ ...current, level: value }));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const dirty = editor.dirty;
  useEffect(() => { onDirtyChange?.(member.id, dirty); }, [member.id, dirty, onDirtyChange]);
  async function submit(event) {
    event.preventDefault();
    if (disabled || savingRef.current) return;
    if (editor.conflict) { setError("ข้อมูลสมาชิกเปลี่ยนจากเครื่องอื่น กรุณาใช้ข้อมูลล่าสุดก่อนแก้ใหม่"); return; }
    if (!name.trim()) { setError("กรุณากรอกชื่อเล่น"); return; }
    const changes = [];
    if (name.trim() !== (member.nickname || member.display_name || "")) changes.push(`ชื่อเล่น: ${member.nickname || member.display_name || "—"} → ${name.trim()}`);
    if (level !== (member.skill_level || "")) changes.push(`ระดับมือ: ${skillLabel(member.skill_level) || "—"} → ${skillLabel(level) || "—"}`);
    if (!window.confirm(`ยืนยันแก้ไขข้อมูลผู้เล่นคนนี้?\n\n${changes.join("\n")}`)) return;
    savingRef.current = true;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      if (await onSave(member, { nickname: name.trim(), skillLevel: level, playableSkillLevels: level === member.skill_level ? member.playable_skill_levels : defaultPlayableSkillLevels(level) })) {
        const submitted = { name: name.trim(), level };
        editor.setValue(submitted); editor.accept(submitted); setSaved(true);
      }
    } catch (failure) { setError(failure.message || "บันทึกไม่สำเร็จ กรุณาลองใหม่"); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <form className="member-directory-edit-row" onSubmit={submit}>
    <label className="member-directory-name"><span className="member-directory-visually-hidden">ชื่อเล่น</span><input aria-label={`ชื่อเล่น ${member.nickname || member.display_name}`} maxLength="40" required value={name} disabled={saving || disabled} onChange={(event) => { setName(event.target.value); setSaved(false); setError(""); }} /></label>
    <label className="member-directory-level"><span className="member-directory-visually-hidden">มือ</span><select aria-label={`ระดับมือ ${member.nickname || member.display_name}`} required value={level} disabled={saving || disabled} onChange={(event) => { setLevel(event.target.value); setSaved(false); setError(""); }}><option value="">เลือกระดับ</option>{SKILL_LEVELS.map((value) => <option key={value} value={value}>{skillLabel(value)}</option>)}</select></label>
    <small className="member-directory-line-name" title={member.line_user_id ? `LINE: ${member.display_name}` : "ยังไม่เชื่อม LINE"}>{member.line_user_id ? `LINE: ${member.display_name}` : "ยังไม่เชื่อม LINE"}{dirty ? " · ยังไม่บันทึก" : saved ? " · บันทึกแล้ว" : ""}</small>
    <div className="member-directory-row-actions">
      {dirty ? <button className="member-directory-quick-save" disabled={saving || disabled || editor.conflict} type="submit">{saving ? "กำลังบันทึก…" : "ยืนยัน"}</button> : <>
        {onMerge ? <button aria-label={`รวมรายชื่อ ${member.nickname || member.display_name}`} aria-pressed={selectedForMerge} className="member-directory-merge" disabled={saving || disabled} onClick={() => onMerge(member)} type="button">{selectedForMerge ? "เลือกแล้ว" : "รวม"}</button> : null}
        {onDetails ? <button className="directory-details" disabled={saving || disabled} onClick={() => onDetails(member)} type="button">แก้ไข</button> : null}
        {onArchive ? <button aria-label={`ลบ ${member.nickname || member.display_name} ออกจากรายชื่อ`} className="member-directory-archive" disabled={saving || disabled} onClick={() => onArchive(member)} type="button"><Trash2 size={15} /></button> : null}
      </>}
    </div>
    {error ? <small className="member-directory-error" role="alert">{error}</small> : null}
    {dirty && !editor.conflict ? <button className="member-directory-reset" disabled={saving || disabled} onClick={() => { editor.reset(); setError(""); setSaved(false); }} type="button">ยกเลิก</button> : null}
    {editor.conflict ? <small className="editor-dirty">ข้อมูลเปลี่ยนจากเครื่องอื่น <button type="button" onClick={() => { if (window.confirm("ทิ้งร่างชื่อและมือ แล้วใช้ข้อมูลล่าสุด?")) editor.reset(); }}>ใช้ข้อมูลล่าสุด</button></small> : null}
  </form>;
}
