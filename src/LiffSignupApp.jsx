import React, { useEffect, useState } from "react";
import { Check, Clock3, Edit3, LoaderCircle, MapPin, X } from "lucide-react";
import { buildArrivalTimeOptions, getEventIdFromSearch, isLatestEventSearch } from "./liffSignup.js";

export default function LiffSignupApp() {
  const [event, setEvent] = useState(null);
  const [profile, setProfile] = useState(null);
  const [nickname, setNickname] = useState("");
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [roster, setRoster] = useState({ coming: [] });
  const [savedStatus, setSavedStatus] = useState(null);
  const [savedArrivalTime, setSavedArrivalTime] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const requestedEventId = getEventIdFromSearch(window.location.search);
  const latestRequested = isLatestEventSearch(window.location.search);
  const activeEventId = event?.id || requestedEventId;

  useEffect(() => {
    let active = true;

    async function start() {
      try {
        const liffId = import.meta.env.VITE_LINE_LIFF_ID;
        if (!liffId || !window.liff) throw new Error("ระบบลงชื่อ LINE ยังตั้งค่าไม่ครบ");
        if (!requestedEventId && !latestRequested) throw new Error("ไม่พบรอบที่ต้องการลงชื่อ");

        await window.liff.init({ liffId });
        if (!window.liff.isLoggedIn()) {
          window.liff.login({ redirectUri: window.location.href });
          return;
        }

        const idToken = window.liff.getIDToken();
        if (!idToken) throw new Error("ไม่สามารถยืนยันบัญชี LINE ได้");
        const data = await callLiffApi("get_liff_event", { eventId: requestedEventId, latest: latestRequested, idToken });
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
      } catch (nextError) {
        if (active) setError(nextError.message || "เปิดหน้าลงชื่อไม่สำเร็จ");
      } finally {
        if (active) setLoading(false);
      }
    }

    start();
    return () => { active = false; };
  }, [latestRequested, requestedEventId]);

  useEffect(() => {
    if (!event?.id || !window.liff?.isLoggedIn()) return undefined;
    let active = true;
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const idToken = window.liff.getIDToken();
        if (!idToken) return;
        const data = await callLiffApi("get_liff_event", { eventId: activeEventId, idToken });
        if (!active) return;
        setEvent(data.event);
        setRoster(data.roster || { coming: [] });
        setSavedStatus(data.currentStatus || null);
        setSavedArrivalTime(data.currentArrivalTime || "");
      } catch {
        // Keep the current screen usable during a temporary refresh failure.
      }
    };
    const timer = window.setInterval(refresh, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [activeEventId, event?.id]);

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
      const data = await callLiffApi("save_liff_nickname", { eventId: activeEventId, idToken, nickname: nextNickname });
      setNickname(data.nickname);
      setNicknameDraft(data.nickname);
      setShowNicknameModal(false);
    } catch (nextError) {
      setError(nextError.message || "บันทึกชื่อเล่นไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function chooseTime(arrivalTime) {
    if (saving || savedStatus === "coming") return;
    if (!nickname.trim()) {
      setNicknameDraft("");
      setShowNicknameModal(true);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const idToken = window.liff.getIDToken();
      const data = await callLiffApi("submit_liff_signup", {
        eventId: activeEventId,
        idToken,
        status: "coming",
        arrivalTime,
        nickname: nickname.trim(),
      });
      setSavedStatus("coming");
      setSavedArrivalTime(data.arrivalTime || arrivalTime);
      setRoster(data.roster || { coming: [] });
    } catch (nextError) {
      setError(nextError.message || "ลงเวลาไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function cancelSignup() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const idToken = window.liff.getIDToken();
      const data = await callLiffApi("cancel_liff_signup", { eventId: activeEventId, idToken });
      setSavedStatus(null);
      setSavedArrivalTime("");
      setRoster(data.roster || { coming: [] });
    } catch (nextError) {
      setError(nextError.message || "ยกเลิกการลงชื่อไม่สำเร็จ");
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
  const arrivalTimes = event.arrivalTimes?.length
    ? event.arrivalTimes
    : buildArrivalTimeOptions(event.startTime, event.endTime);

  return (
    <SignupShell>
      <section className="liff-event-card">
        <h1>{event.dateLabel}</h1>
        <div className="liff-venue"><MapPin size={18} /><span>{event.venue}</span></div>
        <div className="liff-courts">
          {event.courts.map((court) => <span key={court.name}><strong>{court.name} :</strong> {court.time}</span>)}
        </div>
      </section>

      <section className="liff-answer-card">
        <div className="liff-signup-as"><span>ลงชื่อเป็น</span><strong>{nickname}</strong><button onClick={() => { setNicknameDraft(nickname); setShowNicknameModal(true); }} type="button"><Edit3 size={14} /> แก้ชื่อเล่น</button></div>
        <div className="liff-answer-heading">
          <div><span>เวลาของคุณ</span><strong>{closed ? "รอบนี้ปิดรับลงเวลาแล้ว" : savedStatus === "coming" ? "ลงเวลาเรียบร้อยแล้ว" : "เลือกเวลาที่จะไป"}</strong></div>
          {savedStatus === "coming" ? <Check className="liff-saved-check" size={24} /> : <Clock3 size={22} />}
        </div>

        {savedStatus === "coming" ? (
          <div className="liff-saved-time-card">
            <span>เวลาที่ลงไว้</span>
            <strong>{savedArrivalTime} น.</strong>
          </div>
        ) : closed ? null : (
          <div className="liff-time-options">
            {arrivalTimes.map((value) => <button disabled={saving} key={value} onClick={() => chooseTime(value)} type="button">{value} น.</button>)}
          </div>
        )}

        {saving ? <div className="liff-saving"><LoaderCircle size={18} /> กำลังบันทึก...</div> : null}
        {error ? <div className="liff-inline-error">{error}</div> : null}
        {savedStatus === "coming" && !closed ? <button className="liff-cancel-signup" disabled={saving} onClick={cancelSignup} type="button"><X size={16} /> ยกเลิกการลงชื่อ</button> : null}
      </section>

      <section className="liff-roster-card">
        <div className="liff-roster-title"><strong>รายชื่อผู้เล่น</strong><span>{roster.coming.length} คน</span></div>
        <RosterGroup entries={roster.coming} />
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
      {entries.length ? <ol>{entries.map((entry, index) => <li key={`${entry.name}-${entry.arrivalTime}-${index}`}><b>{index + 1}.</b><strong>{entry.name}</strong><span>{entry.arrivalTime ? `${entry.arrivalTime} น.` : "ยังไม่ระบุเวลา"}</span></li>)}</ol> : <p>ยังไม่มีคนลงเวลา</p>}
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
