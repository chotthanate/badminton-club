import React, { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { extendCourtBooking, removeOperatorCourt, upsertOperatorCourt } from "./clubRepository.js";
import { readQueueWork, writeQueueWork } from "./queueDrafts.js";
import { courtTimeStatus } from "./queueCourtTime.js";
import { bookingDuration, bookingEndLabel, bookingTimeOptions, clearLegacyCourtWork, extendedBookingEnd, legacyCourtWork, normalizedCourtForm, runCourtBookingMutation, safeCourtStorage } from "./courtBooking.js";
import "./court-booking.css";

function readWork(eventId, workId) { return readQueueWork(eventId, workId, safeCourtStorage()); }
function writeWork(eventId, workId, work) { writeQueueWork(eventId, workId, work, safeCourtStorage()); }

function BookingTimeSelect({ value, onChange, label, startsAt = null, minimumDuration = 0, disabled = false }) {
  return <select aria-label={label} disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}>{bookingTimeOptions(value, startsAt, minimumDuration).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
}

export default function CourtBookingPanel({ event, dashboard, mutate, isTestMode = false, onBusyChange, onDirtyChange }) {
  const initialNewCourt = () => readWork(event.id, "court:new") || { name: "", startsAt: event.startTime, endsAt: event.endTime };
  const [newCourt, setNewCourt] = useState(initialNewCourt);
  const [addingOpen, setAddingOpen] = useState(() => Boolean(readWork(event.id, "court:new")));
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [rowStates, setRowStates] = useState({});
  const [clock, setClock] = useState(Date.now());
  const addingRef = useRef(false);
  const newDirty = Boolean(newCourt.name || readWork(event.id, "court:new"));
  const busy = adding || Object.values(rowStates).some((state) => state.busy);
  const dirty = newDirty || Object.values(rowStates).some((state) => state.dirty);
  // Authentication and role/status permissions are checked by the guarded RPC.
  // Closed-round time corrections must not require reopening the round.
  const canWrite = ["draft", "open", "closed"].includes(event.status);
  const rowStateChanged = useCallback((id, next) => setRowStates((current) => {
    if (current[id]?.busy === next.busy && current[id]?.dirty === next.dirty) return current;
    return { ...current, [id]: next };
  }), []);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { const interval = setInterval(() => setClock(Date.now()), 30000); return () => clearInterval(interval); }, []);
  useEffect(() => { setNewCourt(initialNewCourt()); setRowStates({}); setAddingOpen(Boolean(readWork(event.id, "court:new"))); }, [event.id]);
  const playingIds = new Set((dashboard?.queueMatches || []).filter((match) => match.status === "playing").map((match) => match.court_id));
  function changeNewCourt(patch) { const next = { ...newCourt, ...patch }; setNewCourt(next); writeWork(event.id, "court:new", next); setAddError(""); }
  async function addCourt(submitEvent) {
    submitEvent.preventDefault();
    if (addingRef.current || !canWrite) return;
    if (!newCourt.name.trim() || !bookingDuration(newCourt.startsAt, newCourt.endsAt)) { setAddError("กรอกชื่อคอร์ทและเวลาเริ่ม–จบให้ถูกต้อง"); return; }
    addingRef.current = true; setAdding(true); setAddError("");
    try {
      const result = await runCourtBookingMutation(mutate, () => upsertOperatorCourt({ eventId: event.id, courtName: newCourt.name.trim(), startsAt: newCourt.startsAt, endsAt: newCourt.endsAt }), "เพิ่มคอร์ทแล้ว", `court:${event.id}:new`);
      if (!result.saved) setAddError(result.error);
      else { writeWork(event.id, "court:new", null); setNewCourt({ name: "", startsAt: event.startTime, endsAt: event.endTime }); setAddingOpen(false); }
    } finally { addingRef.current = false; setAdding(false); }
  }
  return <section className="court-booking-panel">
    <header className="court-booking-heading"><Clock3 size={21} /><div><h2>คอร์ทและเวลา</h2><p>{event.status === "closed" ? "แก้เวลาจองในรอบเดิม ไม่เปิดรอบใหม่หรือเปลี่ยนรายชื่อ" : "ต่อเวลาได้แม้เลยเวลาจองหรือกำลังเล่นอยู่"}</p></div></header>
    <div className="court-booking-list">{event.courts.map((court) => <CourtBookingRow canWrite={canWrite} clock={clock} court={court} event={event} isPlaying={playingIds.has(court.id)} isTestMode={isTestMode} key={`${event.id}:${court.id}`} mutate={mutate} onStateChange={rowStateChanged} />)}</div>
    {!event.courts.length ? <p className="court-booking-help">ยังไม่มีคอร์ทในรอบนี้</p> : null}
    {canWrite && event.status !== "closed" ? addingOpen ? <form className="court-booking-add" onSubmit={addCourt}>
      <header><strong>เพิ่มคอร์ท</strong><button aria-label="ยกเลิกเพิ่มคอร์ท" disabled={adding} onClick={() => { if (!newDirty || window.confirm("ยกเลิกร่างคอร์ทใหม่?")) { writeWork(event.id, "court:new", null); setNewCourt({ name: "", startsAt: event.startTime, endsAt: event.endTime }); setAddingOpen(false); } }} type="button"><X size={18} /></button></header>
      <label className="court-booking-name">ชื่อคอร์ท<input aria-label="ชื่อคอร์ทใหม่" disabled={adding} onChange={(eventObject) => changeNewCourt({ name: eventObject.target.value })} placeholder="เช่น คอร์ท 13" required value={newCourt.name} /></label>
      <label>เริ่ม<BookingTimeSelect disabled={adding} label="เวลาเริ่มคอร์ทใหม่" onChange={(startsAt) => changeNewCourt({ startsAt })} value={newCourt.startsAt} /></label>
      <label>จบ<BookingTimeSelect disabled={adding} label="เวลาจบคอร์ทใหม่" onChange={(endsAt) => changeNewCourt({ endsAt })} startsAt={newCourt.startsAt} value={newCourt.endsAt} /></label>
      {addError ? <p className="court-booking-error" role="alert">{addError}</p> : null}
      <button className="badminton-primary" disabled={adding} type="submit"><Plus size={16} />{adding ? "กำลังเพิ่ม…" : "บันทึกคอร์ทใหม่"}</button>
    </form> : <button className="court-booking-add-toggle" onClick={() => setAddingOpen(true)} type="button"><Plus size={17} />เพิ่มคอร์ท</button> : null}
    <small className="court-booking-help">เวลาจบที่ผ่านเที่ยงคืนจะแสดง “วันถัดไป” เช่น 21:00–00:30</small>
  </section>;
}

function CourtBookingRow({ court, event, mutate, canWrite, isPlaying, isTestMode, clock, onStateChange }) {
  const workId = `court:${court.id}`;
  const propSignature = JSON.stringify(normalizedCourtForm(court));
  const [localCourt, setLocalCourt] = useState(null);
  const effectiveCourt = localCourt || court;
  const serverForm = normalizedCourtForm(effectiveCourt);
  const serverSignature = JSON.stringify(serverForm);
  const initialWork = () => readWork(event.id, workId) || legacyCourtWork(event.id, court.id) || { form: serverForm, baseSignature: serverSignature };
  const [work, setWork] = useState(initialWork);
  const dirty = JSON.stringify(work.form) !== work.baseSignature;
  const [editing, setEditing] = useState(() => dirty);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removed, setRemoved] = useState(false);
  const busyRef = useRef(false);
  const conflict = dirty && work.baseSignature !== serverSignature;
  const nextEnd = extendedBookingEnd(serverForm);
  const bookingStatus = isTestMode ? "active" : courtTimeStatus({ eventDate: event.date, eventStartTime: event.startTime, courtStartTime: serverForm.startsAt, courtEndTime: serverForm.endsAt, now: clock });
  useEffect(() => { setLocalCourt(null); }, [propSignature]);
  useEffect(() => { if (!dirty) setWork({ form: serverForm, baseSignature: serverSignature }); }, [serverSignature, dirty]);
  useEffect(() => { onStateChange(court.id, { busy: Boolean(busy), dirty }); }, [busy, dirty, court.id, onStateChange]);
  useEffect(() => () => onStateChange(court.id, { busy: false, dirty: false }), [court.id, onStateChange]);
  function change(patch) { if (busyRef.current) return; const next = { ...work, form: { ...work.form, ...patch } }; setWork(next); writeWork(event.id, workId, next); setError(""); setNotice(""); }
  function resetWork(nextForm = serverForm) { writeWork(event.id, workId, null); clearLegacyCourtWork(event.id, court.id); setWork({ form: nextForm, baseSignature: JSON.stringify(nextForm) }); setError(""); }
  async function run(kind, action, message) {
    if (busyRef.current || !canWrite) return { saved: false };
    busyRef.current = true; setBusy(kind); setError(""); setNotice("");
    try {
      const result = await runCourtBookingMutation(mutate, action, message, `court:${event.id}:${court.id}`);
      if (!result.saved) setError(result.error);
      else setNotice(kind === "delete" ? message : `${message} · ยอดที่สรุป ส่งสลิป หรือชำระแล้วไม่เปลี่ยน ประมาณการที่ยังไม่สรุปคำนวณตามเวลาล่าสุด`);
      return result;
    } finally { busyRef.current = false; setBusy(""); }
  }
  async function extend() {
    if (!nextEnd) return;
    const result = await run("extend", () => extendCourtBooking({ eventId: event.id, courtId: court.id, minutes: 30 }), `ต่อเวลา ${court.name} อีก 30 นาทีแล้ว`);
    if (result.saved) {
      const updated = result.result ? normalizedCourtForm(result.result) : { ...serverForm, endsAt: nextEnd };
      setLocalCourt(updated);
      if (!dirty) resetWork(updated);
    }
  }
  async function save() {
    if (conflict) { setError("ข้อมูลคอร์ทเปลี่ยนจากเครื่องอื่น กรุณาใช้ข้อมูลล่าสุดก่อนแก้ใหม่"); return; }
    if (!work.form.name.trim() || !bookingDuration(work.form.startsAt, work.form.endsAt)) { setError("กรอกชื่อคอร์ทและเวลาเริ่ม–จบให้ถูกต้อง"); return; }
    const submitted = { ...work.form, name: work.form.name.trim() };
    const result = await run("save", () => upsertOperatorCourt({ eventId: event.id, courtId: court.id, courtName: submitted.name, startsAt: submitted.startsAt, endsAt: submitted.endsAt }), `บันทึก ${submitted.name} แล้ว`);
    if (result.saved) { setLocalCourt(submitted); resetWork(submitted); setEditing(false); }
  }
  async function remove() {
    const result = await run("delete", () => removeOperatorCourt({ eventId: event.id, courtId: court.id }), `นำ ${court.name} ออกจากรอบแล้ว`);
    if (result.saved) { resetWork(); setRemoved(true); }
  }
  if (removed) return null;
  return <article className={`court-booking-card ${isPlaying ? "is-playing" : ""}`}>
    <header><div><h3>{serverForm.name}</h3><span className="court-booking-time">{serverForm.startsAt} – {bookingEndLabel(serverForm.endsAt, serverForm.startsAt)}</span></div><span className={`court-booking-status is-${isPlaying ? "playing" : bookingStatus}`}>{isPlaying ? "กำลังเล่น" : event.status === "closed" ? "จบรอบแล้ว" : bookingStatus === "expired" ? "ครบเวลาจอง" : bookingStatus === "upcoming" ? "ยังไม่ถึงเวลา" : "อยู่ในเวลาจอง"}</span></header>
    <div className="court-booking-actions"><button aria-label={`ต่อเวลา ${serverForm.name} อีก 30 นาที`} className="court-booking-extend" disabled={Boolean(busy) || !canWrite || !nextEnd} onClick={extend} type="button"><Plus size={18} /><span><strong>{busy === "extend" ? "กำลังต่อเวลา…" : "+30 นาที"}</strong><small>{nextEnd ? `ถึง ${bookingEndLabel(nextEnd, serverForm.startsAt)}` : "ครบระยะเวลาสูงสุดของรอบ"}</small></span></button><button className="court-booking-edit-toggle" disabled={Boolean(busy) || !canWrite} onClick={() => setEditing(!editing)} type="button"><Pencil size={16} />{editing ? "ซ่อน" : "แก้เวลา"}</button></div>
    {dirty ? <small className="court-booking-dirty">ยังไม่บันทึก · ปุ่ม +30 นาทีเพิ่มจากเวลาที่บันทึกจริง ไม่ทับร่างที่แก้ไว้</small> : null}
    {editing ? <div className="court-booking-edit">
      <label className="court-booking-name">ชื่อคอร์ท<input aria-label={`ชื่อ ${court.name}`} disabled={Boolean(busy) || !canWrite} onChange={(eventObject) => change({ name: eventObject.target.value })} value={work.form.name} /></label>
      <label>เริ่ม<BookingTimeSelect disabled={Boolean(busy) || !canWrite || isPlaying} label={`เวลาเริ่ม ${court.name}`} onChange={(startsAt) => change({ startsAt })} value={work.form.startsAt} /></label>
      <label>จบ<BookingTimeSelect disabled={Boolean(busy) || !canWrite} label={`เวลาจบ ${court.name}`} minimumDuration={isPlaying ? bookingDuration(serverForm.startsAt, serverForm.endsAt) : 0} onChange={(endsAt) => change({ endsAt })} startsAt={work.form.startsAt} value={work.form.endsAt} /></label>
      {isPlaying ? <small className="court-booking-help">ขณะกำลังเล่น ต่อเวลาจบได้ แต่ไม่เลื่อนเวลาเริ่มหรือย่อเวลาจอง</small> : null}
      {conflict ? <p className="court-booking-error" role="alert">เวลาคอร์ทเปลี่ยนแล้ว ร่างเดิมยังอยู่ <button disabled={Boolean(busy)} onClick={() => { if (window.confirm("ทิ้งร่างเวลาและใช้ข้อมูลคอร์ทล่าสุด?")) resetWork(); }} type="button">ใช้ข้อมูลล่าสุด</button></p> : null}
      <div className="court-booking-edit-actions"><button className="badminton-primary" disabled={Boolean(busy) || !canWrite || !dirty || conflict} onClick={save} type="button"><Save size={16} />{busy === "save" ? "กำลังบันทึก…" : "บันทึกเวลา"}</button>{dirty ? <button disabled={Boolean(busy)} onClick={() => { if (window.confirm("ยกเลิกร่างคอร์ทนี้และใช้ข้อมูลล่าสุด?")) resetWork(); }} type="button">ยกเลิกร่าง</button> : null}{event.status !== "closed" ? <button aria-label={`ลบ ${court.name}`} className="court-booking-delete" disabled={Boolean(busy) || !canWrite || isPlaying} onClick={() => setConfirmDelete(true)} type="button"><Trash2 size={16} />ลบคอร์ท</button> : null}</div>
      {confirmDelete ? <div className="court-booking-delete-confirm"><p>นำ {court.name} ออกจากรอบนี้? คอร์ทที่มีประวัติเกมหรือกำลังเล่นจะลบไม่ได้</p><button disabled={Boolean(busy)} onClick={() => setConfirmDelete(false)} type="button">เก็บไว้</button><button className="court-booking-delete" disabled={Boolean(busy) || isPlaying} onClick={remove} type="button">ยืนยันลบคอร์ท</button></div> : null}
    </div> : null}
    {error ? <p className="court-booking-error" role="alert">{error}</p> : notice ? <p className="court-booking-success" role="status">{notice}</p> : null}
  </article>;
}
