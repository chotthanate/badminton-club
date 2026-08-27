import React, { useEffect, useState } from "react";
import { Check, Clock3, Edit3, LoaderCircle, MapPin, Plus, Users, X } from "lucide-react";
import { buildArrivalTimeOptions, buildLiveQueueUrl, getEventIdFromSearch, getLiffTestContext, isLatestEventSearch, sortRosterBySignupOrder } from "./liffSignup.js";
import SkillCompatibilityPicker from "./SkillCompatibilityPicker.jsx";
import { defaultPlayableSkillLevels, normalizePlayableSkillLevels, SKILL_LEVELS } from "./skillLevels.js";
import LanguageToggle from "./LanguageToggle.jsx";
import { formatMemberDate, localizeError, pickLanguage, useLanguage } from "./language.js";

export default function LiffSignupApp() {
  const { language, setLanguage } = useLanguage();
  const tr = (thai, english) => pickLanguage(language, thai, english);
  const [event, setEvent] = useState(null);
  const [profile, setProfile] = useState(null);
  const [nickname, setNickname] = useState("");
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [skillLevel, setSkillLevel] = useState("");
  const [skillDraft, setSkillDraft] = useState("");
  const [playableSkillLevels, setPlayableSkillLevels] = useState([]);
  const [playableSkillLevelsDraft, setPlayableSkillLevelsDraft] = useState([]);
  const [roster, setRoster] = useState({ coming: [] });
  const [savedStatus, setSavedStatus] = useState(null);
  const [savedArrivalTime, setSavedArrivalTime] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestArrivalTime, setGuestArrivalTime] = useState("");
  const [guestSkill, setGuestSkill] = useState("");
  const [guestPlayableSkillLevels, setGuestPlayableSkillLevels] = useState([]);
  const [queueStatus, setQueueStatus] = useState(null);
  const [guestSaving, setGuestSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const requestedEventId = getEventIdFromSearch(window.location.search);
  const latestRequested = isLatestEventSearch(window.location.search);
  const { testMode, testClubId } = getLiffTestContext(window.location.search);
  const activeEventId = event?.id || requestedEventId;
  const testPayload = { testMode, testClubId };

  useEffect(() => {
    let active = true;

    async function start() {
      try {
        const liffId = import.meta.env.VITE_LINE_LIFF_ID;
        if (!liffId || !window.liff) throw new Error(tr("ระบบลงชื่อ LINE ยังตั้งค่าไม่ครบ", "LINE registration is not configured."));
        if (!requestedEventId && !latestRequested) throw new Error(tr("ไม่พบรอบที่ต้องการลงชื่อ", "The selected session was not found."));

        await window.liff.init({ liffId });
        if (!window.liff.isLoggedIn()) {
          window.liff.login({ redirectUri: window.location.href });
          return;
        }

        const idToken = window.liff.getIDToken();
        if (!idToken) throw new Error(tr("ไม่สามารถยืนยันบัญชี LINE ได้", "Unable to verify your LINE account."));
        const data = await callLiffApi("get_liff_event", { eventId: requestedEventId, latest: latestRequested, idToken, ...testPayload });
        if (!active) return;
        setEvent(data.event);
        setProfile(data.profile);
        const storedNickname = data.profile.nickname || "";
        setNickname(storedNickname);
        setNicknameDraft(storedNickname);
        const storedSkill = data.profile.skillLevel || "";
        setSkillLevel(storedSkill);
        setSkillDraft(storedSkill);
        const storedPlayableLevels = normalizePlayableSkillLevels(storedSkill, data.profile.playableSkillLevels, {
          allowLowerLevel: data.profile.allowLowerLevel,
          allowHigherLevel: data.profile.allowHigherLevel,
        });
        setPlayableSkillLevels(storedPlayableLevels);
        setPlayableSkillLevelsDraft(storedPlayableLevels);
        setShowNicknameModal(!storedNickname || !storedSkill);
        setRoster(data.roster || { coming: [] });
        setSavedStatus(data.currentStatus || null);
        setSavedArrivalTime(data.currentArrivalTime || "");
        setGuestArrivalTime(data.event.arrivalTimes?.[0] || data.event.startTime || "");
        setQueueStatus(data.queue || null);
      } catch (nextError) {
        if (active) setError(localizeError(nextError.message, language, tr("เปิดหน้าลงชื่อไม่สำเร็จ", "Unable to open registration.")));
      } finally {
        if (active) setLoading(false);
      }
    }

    start();
    return () => { active = false; };
  }, [latestRequested, requestedEventId, testMode, testClubId]);

  useEffect(() => {
    if (!event?.id || !window.liff?.isLoggedIn()) return undefined;
    let active = true;
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const idToken = window.liff.getIDToken();
        if (!idToken) return;
        const data = await callLiffApi("get_liff_event", { eventId: activeEventId, idToken, ...testPayload });
        if (!active) return;
        setEvent(data.event);
        setRoster(data.roster || { coming: [] });
        setSavedStatus(data.currentStatus || null);
        setSavedArrivalTime(data.currentArrivalTime || "");
        setQueueStatus(data.queue || null);
      } catch {
        // Keep the current screen usable during a temporary refresh failure.
      }
    };
    const timer = window.setInterval(refresh, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [activeEventId, event?.id, testMode, testClubId]);

  useEffect(() => {
    if (!event) return;
    const availableTimes = event.arrivalTimes?.length
      ? event.arrivalTimes
      : buildArrivalTimeOptions(event.startTime, event.endTime);
    setGuestArrivalTime((currentTime) => availableTimes.includes(currentTime) ? currentTime : (availableTimes[0] || ""));
  }, [event?.id, event?.startTime, event?.endTime, event?.arrivalTimes?.join("|")]);

  async function saveNickname(submitEvent) {
    submitEvent.preventDefault();
    const nextNickname = nicknameDraft.trim();
    if (!nextNickname || !skillDraft) {
      setError(!nextNickname ? tr("กรุณากรอกชื่อเล่น", "Please enter your nickname.") : tr("กรุณาเลือกระดับมือ", "Please select your skill level."));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const idToken = window.liff.getIDToken();
      const data = await callLiffApi("save_liff_profile", { eventId: activeEventId, idToken, nickname: nextNickname, skillLevel: skillDraft, playableSkillLevels: playableSkillLevelsDraft, ...testPayload });
      setNickname(data.nickname);
      setNicknameDraft(data.nickname);
      setSkillLevel(data.skillLevel);
      setSkillDraft(data.skillLevel);
      setPlayableSkillLevels(data.playableSkillLevels || defaultPlayableSkillLevels(data.skillLevel));
      setPlayableSkillLevelsDraft(data.playableSkillLevels || defaultPlayableSkillLevels(data.skillLevel));
      setShowNicknameModal(false);
    } catch (nextError) {
      setError(localizeError(nextError.message, language, tr("บันทึกชื่อเล่นไม่สำเร็จ", "Unable to save your profile.")));
    } finally {
      setSaving(false);
    }
  }

  async function chooseTime(arrivalTime) {
    if (saving || savedStatus === "coming") return;
    if (!nickname.trim() || !skillLevel) {
      setNicknameDraft(nickname);
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
        skillLevel,
        playableSkillLevels,
        ...testPayload,
      });
      setSavedStatus("coming");
      setSavedArrivalTime(data.arrivalTime || arrivalTime);
      setRoster(data.roster || { coming: [] });
    } catch (nextError) {
      setError(localizeError(nextError.message, language, tr("ลงเวลาไม่สำเร็จ", "Unable to register your arrival time.")));
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
      const data = await callLiffApi("cancel_liff_signup", { eventId: activeEventId, idToken, ...testPayload });
      setSavedStatus(null);
      setSavedArrivalTime("");
      setRoster(data.roster || { coming: [] });
    } catch (nextError) {
      setError(localizeError(nextError.message, language, tr("ยกเลิกการลงชื่อไม่สำเร็จ", "Unable to cancel registration.")));
    } finally {
      setSaving(false);
    }
  }

  async function addGuest(submitEvent) {
    submitEvent.preventDefault();
    const nextGuestName = guestName.trim();
    if (!nextGuestName) {
      setError(tr("กรุณาพิมพ์ชื่อผู้เล่น", "Please enter the player's name."));
      return;
    }
    if (!nickname.trim()) {
      setNicknameDraft("");
      setShowNicknameModal(true);
      return;
    }
    if (!guestSkill) {
      setError(tr("กรุณาเลือกระดับมือของเพื่อน", "Please select your friend's skill level."));
      return;
    }
    setGuestSaving(true);
    setError("");
    try {
      const idToken = window.liff.getIDToken();
      const data = await callLiffApi("submit_liff_guest", {
        eventId: activeEventId,
        idToken,
        guestName: nextGuestName,
        arrivalTime: guestArrivalTime,
        skillLevel: guestSkill,
        playableSkillLevels: guestPlayableSkillLevels,
        ...testPayload,
      });
      setGuestName("");
      setGuestSkill("");
      setGuestPlayableSkillLevels([]);
      setRoster(data.roster || { coming: [] });
    } catch (nextError) {
      setError(localizeError(nextError.message, language, tr("เพิ่มผู้เล่นไม่สำเร็จ", "Unable to add the player.")));
    } finally {
      setGuestSaving(false);
    }
  }

  if (loading) {
    return <SignupShell language={language} setLanguage={setLanguage}><div className="liff-loading"><LoaderCircle size={30} /><strong>{tr("กำลังเปิดรอบลงชื่อ...", "Opening registration...")}</strong></div></SignupShell>;
  }

  if (error && !event) {
    return <SignupShell language={language} setLanguage={setLanguage}><div className="liff-error"><strong>{tr("เปิดหน้าลงชื่อไม่ได้", "Unable to open registration")}</strong><span>{error}</span></div></SignupShell>;
  }

  const closed = event.status !== "open";
  const arrivalTimes = event.arrivalTimes?.length
    ? event.arrivalTimes
    : buildArrivalTimeOptions(event.startTime, event.endTime);

  return (
    <SignupShell language={language} setLanguage={setLanguage}>
      <section className="liff-event-card">
        <h1>{language === "en" ? formatMemberDate(event.date, language) : event.dateLabel}</h1>
        <div className="liff-venue"><MapPin size={18} /><span>{event.venue}</span></div>
        <div className="liff-courts">
          {event.courts.map((court) => <span key={court.name}><strong>{court.name} :</strong> {court.time}</span>)}
        </div>
      </section>
      <a className="liff-live-link" href={buildLiveQueueUrl({ eventId: testMode ? activeEventId : null, testClubId: testMode ? testClubId : null, language })}><Users size={17} /> {tr("ดูสนามและผู้เล่นคิวถัดไป", "View courts and upcoming queues")}</a>

      <section className="liff-answer-card">
        <div className="liff-signup-as"><span>{tr("ลงชื่อเป็น", "Registering as")}</span><strong>{nickname}</strong>{skillLevel ? <em>{skillLevel}</em> : null}<button onClick={() => { setNicknameDraft(nickname); setSkillDraft(skillLevel); setPlayableSkillLevelsDraft(playableSkillLevels); setShowNicknameModal(true); }} type="button"><Edit3 size={14} /> {tr("แก้โปรไฟล์", "Edit profile")}</button></div>
        {queueStatus ? <div className={`liff-queue-status is-${queueStatus.status}`}><span>{queueStatus.status === "playing" ? `${tr("กำลังเล่น", "Playing on")} ${queueStatus.courtName || tr("ในสนาม", "court")}` : queueStatus.status === "reserved" ? tr("อยู่ในคิวที่กำลังเตรียม", "Reserved in a draft queue") : queueStatus.status === "waiting" ? tr("อยู่ในคิวรอเล่น", "Waiting to play") : tr("ออกจากคิวแล้ว", "Left the queue")}</span>{queueStatus.team ? <small>{tr("ทีม", "Team")} {queueStatus.team}</small> : null}</div> : null}
        <div className="liff-answer-heading">
          <div><span>{tr("เวลาของคุณ", "Your arrival time")}</span><strong>{closed ? tr("รอบนี้ปิดรับลงเวลาแล้ว", "Registration is closed") : savedStatus === "coming" ? tr("ลงเวลาเรียบร้อยแล้ว", "Arrival time saved") : tr("เลือกเวลาที่จะไป", "Choose your arrival time")}</strong></div>
          {savedStatus === "coming" ? <Check className="liff-saved-check" size={24} /> : <Clock3 size={22} />}
        </div>

        {savedStatus === "coming" ? (
          <div className="liff-saved-time-card">
            <span>{tr("เวลาที่ลงไว้", "Registered time")}</span>
            <strong>{savedArrivalTime}</strong>
          </div>
        ) : closed ? null : (
          <div className="liff-time-options">
            {arrivalTimes.map((value) => <button disabled={saving} key={value} onClick={() => chooseTime(value)} type="button">{value}</button>)}
          </div>
        )}

        {saving ? <div className="liff-saving"><LoaderCircle size={18} /> {tr("กำลังบันทึก...", "Saving...")}</div> : null}
        {error ? <div className="liff-inline-error">{error}</div> : null}
        {savedStatus === "coming" && !closed ? <button className="liff-cancel-signup" disabled={saving} onClick={cancelSignup} type="button"><X size={16} /> {tr("ยกเลิกการลงชื่อ", "Cancel registration")}</button> : null}
      </section>

      {!closed ? (
        <form className="liff-guest-signup-row" onSubmit={addGuest}>
          <input
            aria-label={tr("ชื่อผู้เล่นที่ต้องการลงชื่อให้", "Player name")}
            maxLength="40"
            onChange={(changeEvent) => setGuestName(changeEvent.target.value)}
            placeholder={tr("ลงชื่อให้เพื่อน", "Register a friend")}
            value={guestName}
          />
          <select aria-label={tr("ระดับมือของเพื่อน", "Friend's skill level")} onChange={(changeEvent) => { setGuestSkill(changeEvent.target.value); setGuestPlayableSkillLevels(defaultPlayableSkillLevels(changeEvent.target.value)); }} value={guestSkill}><option value="">{tr("ระดับมือ", "Skill")}</option>{SKILL_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}</select>
          <select
            aria-label={tr("เวลาที่เพื่อนจะมา", "Friend's arrival time")}
            onChange={(changeEvent) => setGuestArrivalTime(changeEvent.target.value)}
            value={guestArrivalTime}
          >
            {arrivalTimes.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <button aria-label={tr("เพิ่มผู้เล่น", "Add player")} disabled={guestSaving || !guestName.trim() || !guestArrivalTime || !guestSkill} type="submit">
            {guestSaving ? <LoaderCircle size={18} /> : <Plus size={19} />}
          </button>
          <SkillCompatibilityPicker className="liff-guest-preferences" language={language} onChange={setGuestPlayableSkillLevels} skillLevel={guestSkill} value={guestPlayableSkillLevels} />
        </form>
      ) : null}

      <section className="liff-roster-card">
        <div className="liff-roster-title"><strong>{tr("รายชื่อผู้เล่น", "Players")}</strong><span>{roster.coming.length} {tr("คน", "players")}</span></div>
        <RosterGroup entries={roster.coming} language={language} />
      </section>

      {showNicknameModal ? (
        <div className="liff-modal-backdrop" role="presentation">
          <form className="liff-nickname-modal" onSubmit={saveNickname}>
            <div><h2>{tr("โปรไฟล์สมาชิก", "Member profile")}</h2><p>{tr("ระบบจะจำชื่อและระดับไว้สำหรับครั้งต่อไป", "Your name and skill level will be remembered next time.")}</p></div>
            <label htmlFor="liff-nickname"><span>{tr("ชื่อเล่น", "Nickname")}</span><input autoFocus id="liff-nickname" maxLength="40" onChange={(changeEvent) => setNicknameDraft(changeEvent.target.value)} required value={nicknameDraft} /></label>
            <label><span>{tr("ระดับมือ", "Skill level")}</span><select onChange={(changeEvent) => { setSkillDraft(changeEvent.target.value); setPlayableSkillLevelsDraft(defaultPlayableSkillLevels(changeEvent.target.value)); }} required value={skillDraft}><option value="">{tr("เลือกระดับมือ", "Select skill level")}</option>{SKILL_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
            <SkillCompatibilityPicker className="liff-skill-preferences" language={language} onChange={setPlayableSkillLevelsDraft} skillLevel={skillDraft} value={playableSkillLevelsDraft} />
            <small>{tr("ชื่อ LINE ของคุณคือ", "Your LINE name is")} {profile?.name || tr("สมาชิก LINE", "LINE member")}</small>
            {error ? <div className="liff-inline-error">{error}</div> : null}
            <div className="liff-modal-actions">
              {nickname && skillLevel ? <button className="liff-modal-cancel" disabled={saving} onClick={() => { setNicknameDraft(nickname); setSkillDraft(skillLevel); setPlayableSkillLevelsDraft(playableSkillLevels); setShowNicknameModal(false); setError(""); }} type="button">{tr("ยกเลิก", "Cancel")}</button> : null}
              <button className="liff-modal-save" disabled={saving} type="submit">{saving ? tr("กำลังบันทึก...", "Saving...") : tr("บันทึกโปรไฟล์", "Save profile")}</button>
            </div>
          </form>
        </div>
      ) : null}
    </SignupShell>
  );
}

function RosterGroup({ entries, language }) {
  const tr = (thai, english) => pickLanguage(language, thai, english);
  const orderedEntries = sortRosterBySignupOrder(entries);
  return (
    <div className="liff-roster-group is-coming">
      {orderedEntries.length ? <ol>{orderedEntries.map((entry, index) => <li key={`${entry.name}-${entry.arrivalTime}-${entry.signupOrder || index}`}><b>{index + 1}.</b><strong>{entry.name}</strong>{entry.skillLevel ? <em>{entry.skillLevel}</em> : null}<span>{entry.arrivalTime || tr("ยังไม่ระบุเวลา", "Time not set")}</span></li>)}</ol> : <p>{tr("ยังไม่มีคนลงเวลา", "No players have registered yet.")}</p>}
    </div>
  );
}

function SignupShell({ children, language, setLanguage }) {
  return <main className="badminton-app liff-signup-page"><div className="liff-signup-shell"><div className="public-language-bar"><LanguageToggle language={language} setLanguage={setLanguage} /></div>{children}</div></main>;
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
