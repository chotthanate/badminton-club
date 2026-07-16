import React, { useEffect, useState } from "react";
import { Check, Edit3, LoaderCircle, MapPin } from "lucide-react";
import { getEventIdFromSearch } from "./liffSignup.js";

const STATUS_OPTIONS = [
  { value: "coming", label: "ไป", detail: "เจอกันที่คอร์ท" },
  { value: "maybe", label: "อาจจะไป", detail: "ยังไม่แน่ใจ" },
  { value: "not_coming", label: "ไม่ไป", detail: "รอบนี้ไม่ได้ไป" },
];

export default function LiffSignupApp() {
  const [event, setEvent] = useState(null);
  const [profile, setProfile] = useState(null);
  const [savedStatus, setSavedStatus] = useState(null);
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
        setSavedStatus(data.currentStatus || null);
      } catch (nextError) {
        if (active) setError(nextError.message || "เปิดหน้าลงชื่อไม่สำเร็จ");
      } finally {
        if (active) setLoading(false);
      }
    }

    start();
    return () => { active = false; };
  }, [eventId]);

  async function choose(status) {
    if (saving || (savedStatus && !editing)) return;
    setSaving(true);
    setError("");
    try {
      const idToken = window.liff.getIDToken();
      const data = await callLiffApi("submit_liff_signup", { eventId, idToken, status });
      setSavedStatus(data.status);
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

  return (
    <SignupShell>
      <header className="liff-profile">
        {profile?.picture ? <img alt="" src={profile.picture} /> : <div className="liff-avatar">{profile?.name?.slice(0, 1) || "L"}</div>}
        <div><span>ลงชื่อในชื่อ</span><strong>{profile?.name || "สมาชิก LINE"}</strong></div>
      </header>

      <section className="liff-event-card">
        <p className="badminton-kicker">HEADSHOT BADMINTON</p>
        <h1>วันที่ {event.dateLabel}</h1>
        <div className="liff-venue"><MapPin size={18} /><span>{event.venue}</span></div>
        <div className="liff-courts">
          {event.courts.map((court) => <div key={court.name}><strong>{court.name}</strong><span>{court.time}</span></div>)}
        </div>
      </section>

      <section className="liff-answer-card">
        <div className="liff-answer-heading">
          <div><span>คำตอบของคุณ</span><strong>{closed ? "รอบนี้ปิดรับคำตอบแล้ว" : locked ? `คำตอบที่บันทึกไว้: ${savedLabel}` : "กรุณาเลือกคำตอบ"}</strong></div>
          {locked && savedStatus ? <Check className="liff-saved-check" size={24} /> : null}
        </div>

        <div className="liff-answer-options">
          {STATUS_OPTIONS.map((option) => {
            const selected = savedStatus === option.value;
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

        {saving ? <div className="liff-saving"><LoaderCircle size={18} /> กำลังบันทึก...</div> : null}
        {error ? <div className="liff-inline-error">{error}</div> : null}
        {locked && !closed ? (
          <button className="liff-edit-answer" onClick={() => setEditing(true)} type="button"><Edit3 size={16} /> แก้ไขคำตอบ</button>
        ) : null}
      </section>
    </SignupShell>
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
