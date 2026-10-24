import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { normalizeMemberSearch } from "./memberSearch.js";
import { skillLabel } from "./skillLevels.js";
import "./participantControls.css";

export default function ParticipantPicker({ members, participantIds, value, selectedId, onQuery, onSelect, disabled = false, allowCreate = true }) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const root = useRef(null);
  const listId = useId();
  const suggestions = useMemo(() => {
    const query = normalizeMemberSearch(value);
    return members.filter((member) => !query || [member.nickname, member.display_name, ...(member.aliases || [])]
      .some((field) => normalizeMemberSearch(field).includes(query)))
      .sort((left, right) => (left.nickname || left.display_name || "").localeCompare(right.nickname || right.display_name || "", "th"));
  }, [members, value]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  function choose(member) {
    if (disabled || participantIds.has(member.id)) return;
    onSelect(member);
    setOpen(false);
    setHighlighted(-1);
  }
  function keyDown(event) {
    if (event.key === "Escape") { setOpen(false); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); setOpen(true);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setHighlighted((previous) => suggestions.length ? (previous + direction + suggestions.length) % suggestions.length : -1);
    } else if (event.key === "Enter" && open && highlighted >= 0 && suggestions[highlighted]) {
      event.preventDefault(); choose(suggestions[highlighted]);
    }
  }
  return <div className="participant-picker" ref={root} onBlur={(event) => {
    // Keep touch-scrolling inside the list alive; unlike a timeout, this does
    // not close the menu when a finger begins scrolling a long list.
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <div className="participant-picker-input"><input role="combobox" aria-label="ค้นหาหรือเพิ่มผู้เล่น" aria-autocomplete="list" aria-controls={listId} aria-expanded={open} aria-activedescendant={open && highlighted >= 0 ? `${listId}-${highlighted}` : undefined} autoComplete="off" disabled={disabled} maxLength={80} onChange={(event) => { onQuery(event.target.value); setOpen(true); setHighlighted(-1); }} onFocus={() => setOpen(true)} onKeyDown={keyDown} placeholder="ค้นหาชื่อเดิม หรือพิมพ์ชื่อใหม่" required value={value} /><button aria-label={open ? "ปิดรายชื่อผู้เล่น" : "เปิดรายชื่อผู้เล่น"} disabled={disabled} onClick={() => setOpen(!open)} type="button"><ChevronDown size={18} /></button></div>
    {open && !disabled ? <div className="participant-picker-menu" id={listId} role="listbox" aria-label="รายชื่อผู้เล่น">{suggestions.map((member, index) => {
      const name = member.nickname || member.display_name;
      const inRound = participantIds.has(member.id);
      return <button id={`${listId}-${index}`} key={member.id} role="option" aria-selected={selectedId === member.id} aria-disabled={inRound} className={highlighted === index ? "is-highlighted" : ""} onClick={() => choose(member)} type="button"><span><strong>{name}</strong>{member.display_name && member.display_name !== name ? <small>LINE: {member.display_name}</small> : null}</span><span><small>{skillLabel(member.skill_level) || "ยังไม่ระบุมือ"}</small><small>{inRound ? "อยู่ในรอบแล้ว" : "ใช้ประวัติเดิม"}</small></span></button>;
    })}{!suggestions.length ? <p>{allowCreate ? "ไม่พบรายชื่อเดิม · เลือกระดับมือแล้วกด “เพิ่มผู้เล่น” เพื่อสร้างชื่อใหม่" : "ไม่พบผู้เล่นที่นำกลับเข้ารอบนี้ได้"}</p> : null}</div> : null}
    <small className="participant-picker-hint">{selectedId ? "เลือกคนเดิมแล้ว ประวัติและยอดค้างจะต่อเนื่อง" : allowCreate ? "ค้นหาจากชื่อเล่นหรือชื่อ LINE · ไม่พบชื่อให้เพิ่มผู้เล่นใหม่ได้" : "ค้นหาชื่อที่เคยนำออกจากรอบนี้"}</small>
  </div>;
}
