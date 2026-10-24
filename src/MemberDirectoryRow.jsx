import React, { useEffect, useRef, useState } from "react";
import { SKILL_LEVELS, defaultPlayableSkillLevels } from "./skillLevels.js";
import { skillLabel } from "./skillLevels.js";
import { usePersistentEditor } from "./usePersistentEditor.js";

export default function MemberDirectoryRow({ member, onSave, onDetails, onDirtyChange, disabled = false }) {
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
    <label>ชื่อเล่น<input aria-label={`ชื่อเล่น ${member.nickname || member.display_name}`} maxLength="40" required value={name} disabled={saving || disabled} onChange={(event) => { setName(event.target.value); setSaved(false); setError(""); }} /></label>
    <label>มือ<select aria-label={`ระดับมือ ${member.nickname || member.display_name}`} required value={level} disabled={saving || disabled} onChange={(event) => { setLevel(event.target.value); setSaved(false); setError(""); }}><option value="">เลือกระดับ</option>{SKILL_LEVELS.map((value) => <option key={value} value={value}>{skillLabel(value)}</option>)}</select></label>
    <button className="badminton-secondary" disabled={!dirty || saving || disabled} type="submit">{saving ? "บันทึก…" : saved && !dirty ? "บันทึกแล้ว" : "บันทึก"}</button>
    <small>{member.line_user_id ? `LINE: ${member.display_name}` : "ยังไม่เชื่อม LINE"}{dirty ? " · ยังไม่บันทึก" : saved ? " · บันทึกแล้ว" : ""}</small>
    {onDetails ? <button className="directory-details" disabled={saving || disabled || dirty} onClick={() => onDetails(member)} type="button">ข้อมูลเพิ่มเติม</button> : null}
    {error ? <small className="member-directory-error" role="alert">{error}</small> : null}
    {dirty && !editor.conflict ? <button className="directory-details" disabled={saving || disabled} onClick={() => { editor.reset(); setError(""); setSaved(false); }} type="button">ยกเลิกการแก้ไข</button> : null}
    {editor.conflict ? <small className="editor-dirty">ข้อมูลเปลี่ยนจากเครื่องอื่น <button type="button" onClick={() => { if (window.confirm("ทิ้งร่างชื่อและมือ แล้วใช้ข้อมูลล่าสุด?")) editor.reset(); }}>ใช้ข้อมูลล่าสุด</button></small> : null}
  </form>;
}
