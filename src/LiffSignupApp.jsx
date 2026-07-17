import React, { useEffect, useState } from "react";
import { Check, Edit3, LoaderCircle, MapPin } from "lucide-react";
import { buildArrivalTimeOptions, getEventIdFromSearch } from "./liffSignup.js";

const STATUS_OPTIONS = [
  { value: "coming", label: "ไป", detail: "เลือกเวลาที่จะไป" },
  { value: "not_coming", label: "ไม่ไป", detail: "รอบนี้ไม่ได้ไป" },
];

export default function LiffSignupApp() {
  const [event, setEvent] = useState(null);
  const [profile, setProfile] = useState(null);
  const [nickname, setNickname] = useState("");
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [roster, setRoster] = useState({ coming: [] });
  const [savedStatus, setSavedStatus] = useState(null);
  const [savedArrivalTime, setSavedArrivalTime] = useState("");
  const [pendingStatus, setPendingStatus] = useState(null);
  const [arrivalTime, setArrivalTime] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const eventId = getEventIdFromSearch(window.location.search);

  useEffect(() => {
    let active = true;

    async function start() {
      try {
        const liffId = import.meta.env.VITE_LINE_LIFF_ID;
        if (!liffId || !window.liff) throw new Error("ระบบลงชื่อ LINE ยังตั้งค่าไม่ครบ");
        if (!eventId) throw new Error("ไม่พบรอบที่ต้องการลงชื่อ");

        await window.liff.init({ liffId });
        if (!window.liff.isLoggedIn()) {
          window.liff.login({ redirectUri: window.location.href });
          return;
        }

        const idToken = window.liff.getIDToken();
        if (!idToken) throw new Error("ไม่สามารถยืนยันบัญชี LINE ได้");
        const data = await callLiffApi("get_liff_event", { eventId, idToken });
        if (!active) return;
        setEvent(data.event);
        setProfile(data.profile);
        const storedNickname = data.profile.nickname || "";
        setNickname(storedNickname);
        setNicknameDraft(storedNickname);
        setShowNicknameModal(!storedNickname);
        setRoster(data.roster || { coming: [] });
        setSavedStatus(data.currentStatus || null);
        setSavedArrivalTime(data.currentArrivalTime || "");
        setArrivalTime(data.currentArrivalTime || "");
      } catch (nextError) {
        if (active) setError(nextError.message || "เปิดหน้าลงชื่อไม่สำเร็จ");
      } finally {
        if (active) setLoading(false);
      }
    }

    start();
    return () => { active = false; };
  }, [eventId]);

  async function saveNickname(submitEvent) {
    submitEvent.preventDefault();
    const nextNickname = nicknameDraft.trim();
    if (!nextNickname) {
      setError("กรุณากรอกชื่อเล่น");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const idToken = window.liff.getIDToken();
      const data = await callLiffApi("save_liff_nickname", { eventId, idToken, nickname: nextNickname });
      setNickname(data.nickname);
      setNicknameDraft(data.nickname);
      setShowNicknameModal(false);
    } catch (nextError) {
      setError(nextError.message || "บันทึกชื่อเล่นไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function choose(status) {
    if (saving || (savedStatus && !editing)) return;
    if (!nickname.trim()) {
      setNicknameDraft("");
      setShowNicknameModal(true);
      return;
    }
    if (status === "coming") {
      setPendingStatus("coming");
      setArrivalTime(savedArrivalTime || "");
      setError("");
      return;
    }
    await submitAnswer("not_coming", "");
  }

  async function submitAnswer(status, selectedArrivalTime) {
    if (saving) return;
    if (status === "coming" && !selectedArrivalTime) {
      setError("กรุณาเลือกเวลาที่จะไป");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const idToken = window.liff.getIDToken();
      const data = await callLiffApi("submit_liff_signup", {
        eventId,
        idToken,
        status,
        arrivalTime: status === "coming" ? selectedArrivalTime : null,
        nickname: nickname.trim(),
      });
      setSavedStatus(data.status);
      setSavedArrivalTime(data.arrivalTime || "");
      setArrivalTime(data.arrivalTime || "");
      setNickname(nickname.trim());
      setRoster(data.roster || { coming: [] });
      setPendingStatus(null);
      setEditing(false);
    } catch (nextError) {
      setError(nextError.message || "บันทึกคำตอบไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <SignupShell><div className="liff-loading"><LoaderCircle size={30} /><strong>กำลังเปิดรอบลงชื่อ...</strong></div></SignupShell>;
  }

  if (error && !event) {
    return <SignupShell><div className="liff-error"><strong>เปิดหน้าลงชื่อไม่ได้</strong><span>{error}</span></div></SignupShell>;
  }

  const closed = event.status !== "open";
  const locked = Boolean((savedStatus && !editing) || closed);
  const savedLabel = STATUS_OPTIONS.find((option) => option.value === savedStatus)?.label;
  const savedAnswer = savedStatus === "coming" && savedArrivalTime
    ? `${savedLabel} เวลา ${savedArrivalTime}`
    : savedLabel;
  const arrivalTimes = event.arrivalTimes?.length
    ? event.arrivalTimes
    : buildArrivalTimeOptions(event.startTime, event.endTime);

  return (
    <SignupShell>
      <section className="liff-event-card">
        <p className="badminton-kicker">HEADSHOT BADMINTON</p>
        <h1>วันที่ {event.dateLabel}</h1>
        <div className="liff-venue"><MapPin size={18} /><span>{event.venue}</span></div>
        <div className="liff-courts">
          {event.courts.map((court) => <span key={court.name}><strong>{court.name}</strong> {court.time}</span>)}
        </div>
      </section>

      <section className="liff-answer-card">
        <div className="liff-signup-as"><span>ลงชื่อเป็น</span><strong>{nickname}</strong><button onClick={() => { setNicknameDraft(nickname); setShowNicknameModal(true); }} type="button"><Edit3 size={14} /> แก้ชื่อเล่น</button></div>
        <div className="liff-answer-heading">
          <div><span>คำตอบของคุณ</span><strong>{closed ? "รอบนี้ปิดรับคำตอบแล้ว" : locked ? `คำตอบที่บันทึกไว้: ${savedAnswer}` : "กรุณาเลือกคำตอบ"}</strong></div>
          {locked && savedStatus ? <Check className="liff-saved-check" size={24} /> : null}
        </div>

        <div className="liff-answer-options">
          {STATUS_OPTIONS.map((option) => {
            const selected = locked ? savedStatus === option.value : pendingStatus === option.value;
            return (
              <button
                className={`${selected ? "is-selected" : ""} ${locked ? "is-locked" : ""}`}
                disabled={saving || locked}
                key={option.value}
                onClick={() => choose(option.value)}
                type="button"
              >
                <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                {selected && locked ? <Check size={21} /> : null}
              </button>
            );
          })}
        </div>

        {!locked && pendingStatus === "coming" ? (
          <div className="liff-arrival-picker">
            <label htmlFor="arrival-time">เวลาที่จะไป</label>
            <select id="arrival-time" onChange={(changeEvent) => setArrivalTime(changeEvent.target.value)} value={arrivalTime}>
              <option value="">เลือกเวลา</option>
              {arrivalTimes.map((value) => <option key={value} value={value}>{value} น.</option>)}
            </select>
            <button className="liff-save-answer" disabled={saving || !arrivalTime} onClick={() => submitAnswer("coming", arrivalTime)} type="button">บันทึกคำตอบ</button>
          </div>
        ) : null}

        {saving ? <div className="liff-saving"><LoaderCircle size={18} /> กำลังบันทึก...</div> : null}
        {error ? <div className="liff-inline-error">{error}</div> : null}
        {locked && !closed ? (
          <button className="liff-edit-answer" onClick={() => { setPendingStatus(savedStatus); setArrivalTime(savedArrivalTime); setEditing(true); }} type="button"><Edit3 size={16} /> แก้ไขคำตอบ</button>
        ) : null}
      </section>

      <section className="liff-roster-card">
        <div className="liff-roster-title"><strong>คนที่จะไป</strong><span>{roster.coming.length} คน</span></div>
        <div className="liff-roster-grid">
          <RosterGroup entries={roster.coming} />
        </div>
      </section>

      {showNicknameModal ? (
        <div className="liff-modal-backdrop" role="presentation">
          <form className="liff-nickname-modal" onSubmit={saveNickname}>
            <div><p className="badminton-kicker">ครั้งแรกครั้งเดียว</p><h2>ตั้งชื่อเล่นของคุณ</h2><p>ชื่อนี้จะแสดงในรายชื่อผู้เล่นและจำไว้สำหรับครั้งต่อไป</p></div>
            <label htmlFor="liff-nickname"><span>ชื่อเล่น</span><input autoFocus id="liff-nickname" maxLength="40" onChange={(changeEvent) => setNicknameDraft(changeEvent.target.value)} placeholder="เช่น บอย, หยก, แนน" required value={nicknameDraft} /></label>
            <small>ชื่อ LINE ของคุณคือ {profile?.name || "สมาชิก LINE"}</small>
            {error ? <div className="liff-inline-error">{error}</div> : null}
            <div className="liff-modal-actions">
              {nickname ? <button className="liff-modal-cancel" disabled={saving} onClick={() => { setNicknameDraft(nickname); setShowNicknameModal(false); setError(""); }} type="button">ยกเลิก</button> : null}
              <button className="liff-modal-save" disabled={saving} type="submit">{saving ? "กำลังบันทึก..." : "บันทึกชื่อเล่น"}</button>
            </div>
          </form>
        </div>
      ) : null}
    </SignupShell>
  );
}

function RosterGroup({ entries }) {
  return (
    <div className="liff-roster-group is-coming">
      {entries.length ? <ol>{entries.map((entry, index) => <li key={`${entry.name}-${entry.arrivalTime}-${index}`}><strong>{entry.name}</strong><span>{entry.arrivalTime ? `${entry.arrivalTime} น.` : "ยังไม่ระบุเวลา"}</span></li>)}</ol> : <p>ยังไม่มีคนลงชื่อว่าจะไป</p>}
    </div>
  );
}

function SignupShell({ children }) {
  return <main className="badminton-app liff-signup-page"><div className="liff-signup-shell">{children}</div></main>;
}

async function callLiffApi(action, payload) {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/line-bot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error || "เชื่อมต่อระบบไม่สำเร็จ");
  return data;
}
