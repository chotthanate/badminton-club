import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, Search, Users, X } from "lucide-react";
import { archiveClubMember, dismissDuplicateMemberSuggestion, listOutstandingPayments, mergeClubMembers, updateClubMember } from "./clubRepository.js";
import { duplicateGroupSignature, findExactDuplicateMemberGroups } from "./memberSearch.js";
import { archiveMemberBlockedReason, directoryMemberName, filterDirectoryMembers, hasMemberDraft, mergeMembersBlockedReason, preferredMergeTarget, runDirectoryMutation, toggleMergeMember } from "./memberDirectory.js";
import { skillLabel } from "./skillLevels.js";
import MemberDirectoryRow from "./MemberDirectoryRow.jsx";
import "./member-directory.css";

export default function MemberDirectoryModal({ context, dashboard, settlement, mutate, onClose, onDetails }) {
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [view, setView] = useState("list");
  const [targetId, setTargetId] = useState("");
  const [archiveId, setArchiveId] = useState("");
  const [archiveBalance, setArchiveBalance] = useState({ status: "idle", rows: [] });
  const [dismissGroup, setDismissGroup] = useState([]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [hiddenIds, setHiddenIds] = useState([]);
  const [hiddenSuggestions, setHiddenSuggestions] = useState([]);
  const [dirtyIds, setDirtyIds] = useState(new Set());
  const busyRef = useRef(false);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const members = filterDirectoryMembers((dashboard.members || []).filter((member) => !hiddenIds.includes(member.id)));
  const visibleMembers = filterDirectoryMembers(members, query);
  const dismissed = new Set([...(dashboard.duplicateDismissals || []).map((row) => row.signature), ...hiddenSuggestions]);
  const duplicateGroups = findExactDuplicateMemberGroups(members).filter((group) => !dismissed.has(duplicateGroupSignature(group)));
  const selected = selectedIds.map((id) => members.find((member) => member.id === id)).filter(Boolean);
  const target = selected.find((member) => member.id === targetId);
  const source = selected.find((member) => member.id !== targetId);
  const archiveMember = members.find((member) => member.id === archiveId);
  const archiveUnfinalized = settlement?.rows?.find((row) => row.memberId === archiveId && !row.billingFinalized);
  const archiveDue = archiveBalance.rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const memberDirty = (member) => dirtyIds.has(member?.id) || hasMemberDraft(member?.id);
  const mergeBlocked = mergeMembersBlockedReason(selected, dashboard) || (selected.some(memberDirty) ? "บันทึกหรือยกเลิกร่างชื่อและมือของ 2 คนนี้ก่อนรวมรายชื่อ" : "");
  const archiveBlocked = archiveMemberBlockedReason(archiveMember, dashboard) || (memberDirty(archiveMember) ? "บันทึกหรือยกเลิกร่างชื่อและมือของคนนี้ก่อนนำออกจากรายชื่อ" : "");

  function backToList() { setView("list"); setConfirmed(false); setError(""); }
  function requestClose() {
    if (busyRef.current) return;
    if (view !== "list") { backToList(); return; }
    if (members.some(memberDirty)) { setView("close"); return; }
    onClose();
  }
  closeRef.current = requestClose;
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus({ preventScroll: true });
    const handleKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')].filter((element) => element.getClientRects().length);
      const first = focusable[0]; const last = focusable.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); document.body.style.overflow = previousOverflow; previousFocus?.focus?.({ preventScroll: true }); };
  }, []);
  useEffect(() => { dialogRef.current?.focus({ preventScroll: true }); }, [view]);
  useEffect(() => {
    if (view !== "archive" || !archiveId) return;
    let active = true;
    setArchiveBalance({ status: "loading", rows: [] });
    listOutstandingPayments(context.club_id)
      .then((rows) => { if (active) setArchiveBalance({ status: "ready", rows: rows.filter((row) => row.member_id === archiveId) }); })
      .catch(() => { if (active) setArchiveBalance({ status: "error", rows: [] }); });
    return () => { active = false; };
  }, [view, archiveId, context.club_id]);

  async function run(action, message, actionKey) {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await runDirectoryMutation(mutate, action, message, { actionKey });
      if (!result.saved) setError(result.error); else setNotice(message);
      return result.saved;
    } finally { busyRef.current = false; setBusy(false); }
  }
  function reviewMerge(ids = selectedIds) {
    const pair = ids.map((id) => members.find((member) => member.id === id)).filter(Boolean).slice(0, 2);
    setSelectedIds(pair.map((member) => member.id)); setTargetId(preferredMergeTarget(pair));
    setConfirmed(false); setError(""); setView("merge");
  }
  function chooseMergeMember(member) {
    if (!selecting) { setSelecting(true); setSelectedIds([member.id]); setError(""); return; }
    const next = toggleMergeMember(selectedIds, member.id);
    if (next.length === 2) reviewMerge(next);
    else setSelectedIds(next);
  }
  async function commitMerge() {
    if (!confirmed || mergeBlocked || !source || !target) return;
    const saved = await run(() => mergeClubMembers({ sourceMemberId: source.id, targetMemberId: target.id }), `รวม ${directoryMemberName(source)} เข้ากับ ${directoryMemberName(target)} แล้ว`, "members:merge");
    if (saved) { setHiddenIds((ids) => [...ids, source.id]); setSelectedIds([]); setSelecting(false); backToList(); }
  }
  async function commitArchive() {
    if (!confirmed || archiveBlocked || !archiveMember || archiveBalance.status !== "ready") return;
    const saved = await run(() => archiveClubMember(archiveMember.id), `นำ ${directoryMemberName(archiveMember)} ออกจากรายชื่อแล้ว ประวัติยังอยู่`, `members:archive:${archiveMember.id}`);
    if (saved) { setHiddenIds((ids) => [...ids, archiveMember.id]); setSelectedIds((ids) => ids.filter((id) => id !== archiveMember.id)); backToList(); }
  }
  async function commitDismiss() {
    const signature = duplicateGroupSignature(dismissGroup);
    if (await run(() => dismissDuplicateMemberSuggestion({ clubId: context.club_id, signature }), "ซ่อนคำแนะนำรายชื่อซ้ำนี้แล้ว", `members:dismiss:${signature}`)) {
      setHiddenSuggestions((signatures) => [...signatures, signature]); backToList();
    }
  }
  function onDirtyChange(id, dirty) {
    setDirtyIds((current) => { if (current.has(id) === dirty) return current; const next = new Set(current); dirty ? next.add(id) : next.delete(id); return next; });
  }

  return <div className="badminton-modal-backdrop badminton-member-directory-backdrop" role="presentation">
    <section aria-label="รายชื่อผู้เล่นทั้งหมด" aria-modal="true" className="badminton-member-directory-modal member-directory-v2" ref={dialogRef} role="dialog" tabIndex={-1}>
      <header className="badminton-member-directory-header">
        <button aria-label={view === "list" ? "ปิดรายชื่อผู้เล่นทั้งหมด" : "กลับรายชื่อผู้เล่นทั้งหมด"} disabled={busy} onClick={requestClose} type="button"><ArrowLeft size={20} /></button>
        <div><p className="badminton-kicker">ข้อมูลสมาชิก</p><h2>รายชื่อผู้เล่นทั้งหมด</h2></div><em>{members.length} คน</em>
      </header>
      {view === "list" ? <>
        <label className="badminton-member-directory-search"><Search size={18} /><input aria-label="ค้นหารายชื่อผู้เล่นทั้งหมด" onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อเล่น ชื่อ LINE หรือชื่อเดิม" value={query} />{query ? <button aria-label="ล้างคำค้นหา" onClick={() => setQuery("")} type="button"><X size={16} /></button> : null}</label>
        <div className="member-directory-toolbar"><span>แก้ชื่อและมือได้จากรายชื่อด้านล่าง</span><button aria-pressed={selecting} disabled={busy} onClick={() => { setSelecting(!selecting); setSelectedIds([]); setError(""); }} type="button"><Users size={16} />{selecting ? "ยกเลิกการเลือก" : "เลือก 2 ชื่อเพื่อรวม"}</button></div>
        <div className="member-directory-scroll" role="region" aria-label="รายการสมาชิกและรายชื่อซ้ำ" tabIndex={0}>
          {duplicateGroups.length ? <details className="badminton-member-directory-duplicates" open={!query && !selecting}>
            <summary>ชื่อที่อาจซ้ำกัน · {duplicateGroups.length} กลุ่ม</summary><p>ตรวจว่าเป็นคนเดียวกันก่อนรวม ชื่อเหมือนกันอาจเป็นคนละคน</p>
            {duplicateGroups.map((group) => <article key={duplicateGroupSignature(group)}><span>{group.map(directoryMemberName).join(" ↔ ")}</span><div><button disabled={busy} onClick={() => reviewMerge(group.map((member) => member.id))} type="button">ตรวจแล้วรวม</button><button disabled={busy} onClick={() => { setDismissGroup(group); setView("dismiss"); setError(""); }} type="button">คนละคน</button></div></article>)}
          </details> : null}
          {selecting ? <p className="member-directory-help">เลือก 2 รายชื่อของคนเดียวกัน แล้วตรวจว่าต้องการเก็บชื่อใดไว้</p> : null}
          <div className="member-directory-inline-list">{visibleMembers.length ? visibleMembers.map((member) => <article className="member-directory-entry" key={member.id}>
            {selecting ? <label className="member-directory-select"><input checked={selectedIds.includes(member.id)} disabled={busy || (!selectedIds.includes(member.id) && selectedIds.length >= 2)} onChange={() => setSelectedIds((ids) => toggleMergeMember(ids, member.id))} type="checkbox" /><span>เลือก {directoryMemberName(member)}</span></label> : null}
            <MemberDirectoryRow disabled={busy} member={member} onDirtyChange={onDirtyChange} onDetails={selecting ? undefined : onDetails} onArchive={selecting ? undefined : () => { setArchiveId(member.id); setConfirmed(false); setError(""); setView("archive"); }} onMerge={chooseMergeMember} selectedForMerge={selectedIds.includes(member.id)} onSave={(targetMember, patch) => run(() => updateClubMember(targetMember.id, { displayName: targetMember.display_name || patch.nickname, paymentExempt: Boolean(targetMember.payment_exempt), ...patch }), `บันทึกชื่อและมือของ ${patch.nickname} แล้ว`, `profile:${targetMember.id}`)} />
          </article>) : <p className="badminton-empty">ไม่พบรายชื่อที่ค้นหา</p>}</div>
        </div>
      </> : <div className="member-directory-scroll member-directory-review" role="region" aria-label="ตรวจสอบก่อนดำเนินการ" tabIndex={0}>
        {view === "merge" ? <>
          <h3>เก็บรายชื่อใดเป็นชื่อหลัก?</h3><p>จะย้ายประวัติและยอดค้างเข้าชื่อหลัก เก็บชื่อเดิมไว้ค้นหา แล้วนำชื่อซ้ำออก ไม่ใช่การลบประวัติ</p>
          {selected.map((member) => <label className={`member-directory-target ${targetId === member.id ? "is-selected" : ""}`} key={member.id}><input checked={targetId === member.id} disabled={busy} name="merge-target" onChange={() => { setTargetId(member.id); setConfirmed(false); setError(""); }} type="radio" /><span><strong>{directoryMemberName(member)}</strong><small>{member.line_user_id ? `LINE: ${member.display_name || "เชื่อมแล้ว"}` : "ยังไม่เชื่อม LINE"} · มือ {skillLabel(member.skill_level)}</small><small>{targetId === member.id ? "ชื่อหลักที่จะเก็บไว้" : "ชื่อซ้ำที่จะย้ายประวัติออก"}</small></span></label>)}
          <p className="member-directory-help">แนะนำเก็บชื่อที่เชื่อม LINE ระบบจะไม่รวมคนละบัญชี หรือข้อมูลคิว/ยอดเงินที่ขัดกัน</p>
          {mergeBlocked ? <p className="member-directory-warning" role="status">{mergeBlocked}</p> : <label className="member-directory-confirm"><input checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" /><span>ตรวจแล้วว่าเป็นคนเดียวกัน และต้องการเก็บ “{directoryMemberName(target)}”</span></label>}
        </> : view === "archive" ? <>
          <h3>ลบ “{directoryMemberName(archiveMember)}” ออกจากรายชื่อ?</h3><p>ระบบจะซ่อนชื่อนี้จากรายการสำหรับเพิ่มเข้ารอบใหม่ ไม่ลบประวัติเกม ยอดค้าง หรือการชำระเงินเดิม</p>
          <p>ผู้เล่นที่อยู่ในรอบซึ่งยังไม่จบหรืออยู่ในคิวจะลบไม่ได้ ระบบจะตรวจรอบอื่นอีกครั้งก่อนบันทึกด้วย</p>
          <div className={`member-directory-balance ${archiveBalance.rows.length ? "has-due" : ""}`} role="status">
            {archiveBalance.status === "loading" ? "กำลังตรวจยอดค้างทุกรอบ…" : archiveBalance.status === "error" ? "ตรวจยอดค้างไม่ได้ กรุณากลับไปแล้วเปิดรายการนี้อีกครั้ง" : archiveBalance.status === "ready" ? archiveBalance.rows.length ? `มียอดค้างที่สรุปแล้ว ${archiveDue.toLocaleString("th-TH")} บาท · ${archiveBalance.rows.length} รอบ` : "ไม่มียอดค้างที่สรุปไว้" : ""}
            {archiveUnfinalized ? <small>รอบปัจจุบันยังไม่สรุปยอด จึงอาจมีค่าใช้จ่ายเพิ่ม</small> : null}
          </div>
          {archiveBlocked ? <p className="member-directory-warning" role="status">{archiveBlocked}</p> : <label className="member-directory-confirm"><input checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" /><span>ยืนยันนำ “{directoryMemberName(archiveMember)}” ออกจากรายชื่อ โดยเก็บประวัติไว้</span></label>}
        </> : view === "dismiss" ? <><h3>ยืนยันว่าเป็นคนละคน?</h3><p>{dismissGroup.map(directoryMemberName).join(" ↔ ")}</p><p>จะซ่อนคำแนะนำกลุ่มนี้เท่านั้น ไม่แก้รายชื่อหรือประวัติ</p></> : <><h3>ยังมีชื่อหรือมือที่ไม่บันทึก</h3><p>หากปิดตอนนี้ ร่างจะเก็บไว้ในเบราว์เซอร์นี้ แต่ยังไม่เปลี่ยนข้อมูลจริง</p></>}
      </div>}
      <footer className="member-directory-footer">
        {error ? <p className="member-directory-error" role="alert">{error}</p> : notice ? <p className="member-directory-success" role="status">{notice}</p> : null}
        {view === "list" ? selecting ? <><span>เลือกแล้ว {selectedIds.length}/2 คน</span><button className="badminton-primary" disabled={busy || selected.length !== 2} onClick={() => reviewMerge()} type="button">ตรวจสอบการรวม</button></> : <small>ลบออกจากรายชื่อเป็นการซ่อนชื่อ ประวัติและยอดค้างยังอยู่</small> : <><button className="badminton-secondary" disabled={busy} onClick={backToList} type="button">กลับไปตรวจรายชื่อ</button>{view === "merge" ? <button className="badminton-primary" disabled={busy || !confirmed || Boolean(mergeBlocked)} onClick={commitMerge} type="button">{busy ? "กำลังรวม…" : "ยืนยันรวมรายชื่อ"}</button> : view === "archive" ? <button className="badminton-danger-button" disabled={busy || !confirmed || Boolean(archiveBlocked) || archiveBalance.status !== "ready"} onClick={commitArchive} type="button">{busy ? "กำลังบันทึก…" : "ยืนยันลบออกจากรายชื่อ"}</button> : view === "dismiss" ? <button className="badminton-primary" disabled={busy} onClick={commitDismiss} type="button">ยืนยันว่าเป็นคนละคน</button> : <button className="badminton-secondary" onClick={onClose} type="button">ปิดและเก็บร่างไว้</button>}</>}
      </footer>
    </section>
  </div>;
}
