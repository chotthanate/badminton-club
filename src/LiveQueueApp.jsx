import React, { useEffect, useMemo, useState } from "react";
import { Clock3, Edit3, ListOrdered, LoaderCircle, MapPin, RefreshCw, Users, X } from "lucide-react";
import SkillCompatibilityPicker from "./SkillCompatibilityPicker.jsx";
import { getEventIdFromSearch, getLiffTestContext, isLatestEventSearch } from "./liffSignup.js";
import { defaultPlayableSkillLevels, SKILL_LEVELS } from "./skillLevels.js";

export default function LiveQueueApp() {
  const [data, setData] = useState(null);
  const [clock, setClock] = useState(Date.now());
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [profile, setProfile] = useState({ nickname: "", skillLevel: "", playableSkillLevels: [] });
  const [saving, setSaving] = useState(false);
  const eventId = getEventIdFromSearch(window.location.search);
  const latest = isLatestEventSearch(window.location.search);
  const { testMode, testClubId } = getLiffTestContext(window.location.search);

  async function refresh(options = {}) {
    try {
      const response = await callLiveApi("get_live_queue", { eventId, latest, testMode, testClubId, idToken: options.idToken });
      setData(response);
      if (response.serverNow) setServerOffsetMs(new Date(response.serverNow).getTime() - Date.now());
      setError("");
      if (response.profile) setProfile({ nickname: response.profile.nickname || "", skillLevel: response.profile.skillLevel || "", playableSkillLevels: response.profile.playableSkillLevels || defaultPlayableSkillLevels(response.profile.skillLevel) });
      return response;
    } catch (nextError) {
      setError(nextError.message || "โหลดสนามและคิวไม่สำเร็จ");
      return null;
    } finally { setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    refresh();
    const poll = window.setInterval(() => { if (active && !document.hidden) refresh(); }, 5000);
    const tick = window.setInterval(() => setClock(Date.now()), 1000);
    const visible = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; window.clearInterval(poll); window.clearInterval(tick); document.removeEventListener("visibilitychange", visible); };
  }, [eventId, latest, testMode, testClubId]);

  async function openProfile() {
    try {
      const liffId = import.meta.env.VITE_LINE_LIFF_ID;
      if (!liffId || !window.liff) throw new Error("ยังไม่ได้ตั้งค่า LINE LIFF");
      await window.liff.init({ liffId });
      if (!window.liff.isLoggedIn()) {
        window.liff.login({ redirectUri: window.location.href });
        return;
      }
      const response = await refresh({ idToken: window.liff.getIDToken() });
      if (response) setEditing(true);
    } catch (nextError) { setError(nextError.message); }
  }

  async function saveProfile(eventObject) {
    eventObject.preventDefault();
    setSaving(true);
    try {
      const response = await callLiveApi("save_live_profile", { eventId: data?.event?.id || eventId, testMode, testClubId, idToken: window.liff?.getIDToken(), nickname: profile.nickname, skillLevel: profile.skillLevel, playableSkillLevels: profile.playableSkillLevels });
      setProfile({ nickname: response.nickname, skillLevel: response.skillLevel, playableSkillLevels: response.playableSkillLevels });
      setEditing(false);
      await refresh({ idToken: window.liff?.getIDToken() });
    } catch (nextError) { setError(nextError.message); } finally { setSaving(false); }
  }

  if (loading) return <main className="badminton-app live-queue-page"><div className="live-loading"><LoaderCircle className="is-spinning" /><span>กำลังโหลดสนามและคิว</span></div></main>;
  if (!data?.event) return <main className="badminton-app live-queue-page"><section className="live-empty"><h1>ยังไม่มีรอบที่กำลังเล่น</h1><p>{error || "กรุณาลองอีกครั้งเมื่อเปิดรอบแล้ว"}</p><button onClick={() => refresh()} type="button"><RefreshCw size={18} /> ลองใหม่</button></section></main>;

  return <main className="badminton-app live-queue-page"><div className="live-queue-shell"><header className="live-header"><div><p className="badminton-kicker">สนามและคิว</p><h1>Headshot Badminton</h1><p><MapPin size={15} /> {data.event.venue}</p></div><button onClick={openProfile} type="button"><Edit3 size={17} /> โปรไฟล์</button></header>{error ? <div className="badminton-alert is-error"><span>{error}</span><button onClick={() => setError("")} type="button"><X size={16} /></button></div> : null}<section className="live-courts"><h2>สนามตอนนี้</h2><div>{data.courts.map((court) => <LiveCourt clock={clock + serverOffsetMs} court={court} key={court.id} />)}</div></section><section className="live-upcoming"><div className="live-section-title"><h2><ListOrdered size={20} /> คิวถัดไป</h2><span>{data.upcoming.length} คิว</span></div>{data.upcoming.length ? data.upcoming.map((queue, index) => <article key={queue.id}><strong>คิว {index + 1}</strong><div>{queue.players.map((player) => <span key={`${queue.id}-${player.slot}`}><b>{player.nickname}</b><em>{player.skillLevel}</em></span>)}</div></article>) : <p>ยังไม่มีคิวที่อนุมัติ</p>}</section><section className="live-waiting"><div className="live-section-title"><h2>ผู้เล่นที่รอ</h2><span>{data.waiting.reduce((sum, group) => sum + group.count, 0)} คน</span></div><div className="live-waiting-grid">{data.waiting.map((group) => <article key={group.skillLevel}><header><strong>{group.skillLevel}</strong><span>{group.count} คน</span></header><p>{group.players.map((player) => player.nickname).join(" · ") || "—"}</p></article>)}</div></section><p className="live-updated">อัปเดตอัตโนมัติทุก 5 วินาที</p></div>{editing ? <ProfileModal onClose={() => setEditing(false)} onSave={saveProfile} profile={profile} saving={saving} setProfile={setProfile} /> : null}</main>;
}

function LiveCourt({ clock, court }) {
  const elapsed = court.startedAt ? Math.max(0, Math.floor((clock - new Date(court.startedAt).getTime()) / 1000)) : 0;
  return <article className={`live-court ${court.playing ? "is-playing" : "is-empty"}`}><header><div><strong>{court.name}</strong><span>{court.playing ? "กำลังเล่น" : "ว่าง"}</span></div><b><Clock3 size={17} /> {court.playing ? `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}` : "00:00"}</b></header>{court.playing ? <div className="live-court-teams">{["A", "B"].map((team) => <div key={team}><span>ทีม {team}</span>{court.players.filter((player) => player.team === team).map((player) => <p key={player.slot}><strong>{player.nickname}</strong><em>{player.skillLevel}</em></p>)}</div>)}</div> : <p className="live-court-empty">พร้อมรับคิว 1</p>}</article>;
}

function ProfileModal({ onClose, onSave, profile, saving, setProfile }) {
  return <div className="liff-modal-backdrop" role="presentation"><form className="liff-nickname-modal" onSubmit={onSave}><div className="badminton-modal-title"><div><h2>โปรไฟล์สมาชิก</h2><p>ระบบจะจำชื่อและระดับไว้สำหรับครั้งต่อไป</p></div><button aria-label="ปิด" onClick={onClose} type="button"><X size={18} /></button></div><label><span>ชื่อเล่น</span><input maxLength="40" onChange={(event) => setProfile({ ...profile, nickname: event.target.value })} required value={profile.nickname} /></label><label><span>ระดับมือ</span><select onChange={(event) => setProfile({ ...profile, skillLevel: event.target.value, playableSkillLevels: defaultPlayableSkillLevels(event.target.value) })} required value={profile.skillLevel}><option value="">เลือกระดับ</option>{SKILL_LEVELS.map((level) => <option key={level}>{level}</option>)}</select></label><SkillCompatibilityPicker onChange={(levels) => setProfile({ ...profile, playableSkillLevels: levels })} skillLevel={profile.skillLevel} value={profile.playableSkillLevels} /><p className="badminton-note">ถ้ากำลังรอ ระดับใหม่มีผลกับคิวถัดไปทันที คิวที่อนุมัติหรือเกมที่กำลังเล่นจะไม่เปลี่ยนกลางทาง</p><button className="liff-modal-save" disabled={saving} type="submit">{saving ? "กำลังบันทึก..." : "บันทึกโปรไฟล์"}</button></form></div>;
}

async function callLiveApi(action, payload) {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/line-bot`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error || "เชื่อมต่อระบบไม่สำเร็จ");
  return data;
}
