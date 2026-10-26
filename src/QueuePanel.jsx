import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ListOrdered, Pencil, Play, Plus, Settings, Timer, Trash2, Users, X } from "lucide-react";
import CourtBookingPanel from "./CourtBookingPanel.jsx";
import {
  cancelUpcomingQueues,
  createManualQueue,
  createFallbackQueueDraft,
  createQueueDraft,
  createQueueDraftsBatch,
  finishQueueMatch,
  moveUpcomingQueue,
  returnPlayingQueueToHead,
  startNextQueueOnCourt,
  saveQueueLineup,
} from "./clubRepository.js";
import { balanceTeams, proposeFallbackQueueMatch, proposeQueueMatch, queueProposalFailure, queueFairnessKey, compareKeys } from "./queueLogic.js";
import { planQueueDrafts } from "./queueBatchPlanning.js";
import { buildQueuePlanningState } from "./queuePlanning.js";
import { queueAttendanceStatus } from "./queueAvailability.js";
import { queueVersionRequests, selectedUpcomingQueues } from "./queueManagement.js";
import { saveQueueEditor } from "./queueSave.js";
import { courtTimeStatus } from "./queueCourtTime.js";
import { buildWaitingTimeEstimates, courtStartDelaySeconds, elapsedWaitSeconds, estimateGameDurationSeconds, formatMinuteSecondDuration } from "./queueWaitTime.js";
import { normalizePlayableSkillLevels, SKILL_LEVELS, skillLabel } from "./skillLevels.js";
import { normalizeMemberSearch } from "./memberSearch.js";
import { hasUnsavedQueueWork, queueDraftConflicts, queueLineupSignature, readQueueWork, toggleQueueSelection, writeQueueWork } from "./queueDrafts.js";
import "./queue-improvements.css";


function memberName(member) {
  return member?.nickname || member?.display_name || "ไม่ทราบชื่อ";
}

export function mapQueueDashboard(dashboard) {
  const membersById = new Map((dashboard.members || []).map((member) => [member.id, member]));
  const signupsByMember = new Map((dashboard.signups || []).map((signup) => [signup.member_id, signup]));
  const attendanceByMember = new Map((dashboard.attendance || []).map((attendance) => [attendance.member_id, attendance]));
  const players = (dashboard.queuePlayers || []).map((row) => {
    const member = membersById.get(row.member_id);
    const signup = signupsByMember.get(row.member_id);
    const skillLevel = signup?.skill_level_snapshot || member?.skill_level || null;
    return {
      memberId: row.member_id,
      name: memberName(member),
      lineName: member?.display_name || "",
      skillLevel,
      playableSkillLevels: normalizePlayableSkillLevels(
        skillLevel,
        signup?.playable_skill_levels_snapshot?.length ? signup.playable_skill_levels_snapshot : member?.playable_skill_levels,
        { allowLowerLevel: signup?.allow_lower_level_snapshot ?? member?.allow_lower_level, allowHigherLevel: signup?.allow_higher_level_snapshot ?? member?.allow_higher_level },
      ),
      status: queueAttendanceStatus(row, signup, attendanceByMember.get(row.member_id)),
      gamesPlayed: Number(row.games_played) || 0,
      minutesPlayed: Number(row.minutes_played) || 0,
      queuedAt: row.queued_at,
      skipUntilSequence: Number(row.skip_until_sequence) || 0,
    };
  });
  const playersById = new Map(players.map((player) => [player.memberId, player]));
  const matchPlayersByMatch = new Map();
  for (const row of dashboard.queueMatchPlayers || []) {
    const livePlayer = playersById.get(row.member_id);
    const player = {
      ...(livePlayer || {}),
      memberId: row.member_id,
      name: livePlayer?.name || memberName(membersById.get(row.member_id)),
      skillLevel: row.skill_level_snapshot || livePlayer?.skillLevel,
      playableSkillLevels: row.playable_skill_levels_snapshot?.length ? row.playable_skill_levels_snapshot : livePlayer?.playableSkillLevels || [],
      team: row.team,
      position: Number(row.position),
    };
    const next = matchPlayersByMatch.get(row.match_id) || [];
    next.push(player);
    matchPlayersByMatch.set(row.match_id, next);
  }
  const matches = (dashboard.queueMatches || []).map((match) => ({
    id: match.id,
    courtId: match.court_id,
    sequence: Number(match.sequence),
    queuePosition: match.queue_position === null ? null : Number(match.queue_position),
    status: match.status,
    proposedAt: match.proposed_at,
    startedAt: match.started_at,
    endedAt: match.ended_at,
    manualOverride: Boolean(match.manual_override),
    revision: Number(match.revision) || 0,
    players: (matchPlayersByMatch.get(match.id) || []).sort((left, right) => left.team.localeCompare(right.team) || left.position - right.position),
  }));
  return { players, matches };
}

export default function QueuePanel({ dashboard, event, isStaff = false, isTestMode = false, mutate }) {
  const [editingMatchId, setEditingMatchId] = useState(null);
  const [manageMode, setManageMode] = useState(false);
  const [selectedQueueIds, setSelectedQueueIds] = useState([]);
  const [planningProgress, setPlanningProgress] = useState(null);
  const [planningMessage, setPlanningMessage] = useState("");
  const [busyKeys, setBusyKeys] = useState(new Set());
  const busyRef = useRef(new Set());
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { setEditingMatchId(null); setManageMode(false); setSelectedQueueIds([]); setPlanningMessage(""); }, [event.id]);
  const queue = useMemo(() => mapQueueDashboard(dashboard), [dashboard]);
  const nextSequence = Math.max(0, ...queue.matches.map((match) => match.sequence)) + 1;
  const playingMatches = queue.matches.filter((match) => match.status === "playing");
  const playingByCourt = new Map(playingMatches.map((match) => [match.courtId, match]));
  const playingCourtByMember = new Map(playingMatches.flatMap((match) => {
    const court = event.courts.find((item) => item.id === match.courtId);
    // Booking time does not finish a live game; players stay busy until staff ends it.
    const courtName = court?.name || "สนามที่กำลังเล่น";
    return match.players.map((player) => [player.memberId, courtName]);
  }));
  const upcoming = queue.matches.filter((match) => ["draft", "approved"].includes(match.status)).sort((a, b) => a.queuePosition - b.queuePosition);
  const selectedQueues = selectedUpcomingQueues(upcoming, selectedQueueIds);
  const hasLocalWork = (matchId) => Boolean(readQueueWork(event.id, matchId));
  const managingBusy = busyKeys.has("cancel-batch");
  const queueHeadIsApproved = upcoming[0]?.status === "approved" && upcoming[0].players.length === 4;
  const planning = buildQueuePlanningState(queue.players, upcoming);
  const { availablePlaying, availableWaiting, draftPositionsByMember, proposalPlayers, queueStatusesByMember, visibleWaiting } = planning;
  const queueHeadPlayingCourts = [...new Set((upcoming[0]?.players || []).map((player) => playingCourtByMember.get(player.memberId)).filter(Boolean))];
  const queueHeadHasPlayingPlayer = queueHeadPlayingCourts.length > 0;
  const estimatedGameSeconds = estimateGameDurationSeconds(queue.matches);
  const courtAvailableInSeconds = event.courts.map((court) => {
    const match = playingByCourt.get(court.id);
    if (!match?.startedAt) return isTestMode ? 0 : courtStartDelaySeconds({ eventDate: event.date, eventStartTime: event.startTime, courtStartTime: court.startsAt, now: clock });
    const elapsedSeconds = Math.max(0, Math.floor((clock - new Date(match.startedAt).getTime()) / 1000));
    return Math.max(0, estimatedGameSeconds - elapsedSeconds);
  });
  const waitingTimeEstimates = buildWaitingTimeEstimates({ waiting: availableWaiting, upcomingCount: upcoming.length, courtAvailableInSeconds, gameDurationSeconds: estimatedGameSeconds });

  async function runAction(key, work, notice, options = {}) {
    if (busyRef.current.has(key)) return false;
    busyRef.current.add(key);
    setBusyKeys(new Set(busyRef.current));
    try { return await mutate(work, notice, { refreshQueueOnly: true, ...options, actionKey: `queue:${event.id}:${key}` }); }
    finally { busyRef.current.delete(key); setBusyKeys(new Set(busyRef.current)); }
  }

  useEffect(() => {
    const warnBeforeLeaving = (eventObject) => {
      if (!hasUnsavedQueueWork(event.id)) return;
      eventObject.preventDefault();
      eventObject.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [event.id]);

  useEffect(() => {
    if (!playingMatches.length && !visibleWaiting.length) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [playingMatches.map((match) => match.id).join("|"), visibleWaiting.length]);

  async function createAutomaticDraft() {
    const proposal = proposeQueueMatch(proposalPlayers, queue.matches, nextSequence)
      || proposeFallbackQueueMatch(proposalPlayers, queue.matches, nextSequence);
    if (!proposal) throw new Error(queueProposalFailure(proposalPlayers, nextSequence));
    const create = proposal.fallback ? createFallbackQueueDraft : createQueueDraft;
    await create({ eventId: event.id, memberIds: proposal.lineup.map((player) => player.memberId), teamAIds: proposal.teamA.map((player) => player.memberId) });
    setPlanningMessage("");
    return proposal.fallback;
  }

  async function createAllAutomaticDrafts() {
    setPlanningMessage("");
    setPlanningProgress({ completed: 0, maximum: Math.floor(availableWaiting.length / 4) });
    try {
      const { lineups, reason } = await planQueueDrafts({ players: proposalPlayers, matches: queue.matches, nextSequence, onProgress: setPlanningProgress });
      if (!lineups.length) throw new Error(reason || queueProposalFailure(proposalPlayers, nextSequence));
      await createQueueDraftsBatch({ eventId: event.id, lineups });
      setPlanningMessage(reason || "");
    } finally { setPlanningProgress(null); }
  }

  async function finishMatch(match, court) {
    return runAction(`finish:${match.id}`, () => finishQueueMatch(match.id), `จบเกม ${court.name} แล้ว สนามว่าง`);
  }


  async function undoPlayingMatch(match, court) {
    if (!window.confirm(`นำผู้เล่นออกจาก ${court.name} และคืนเกมนี้กลับเป็นคิว 1 ใช่ไหม?\n\nจำนวนรอบจะไม่เพิ่ม`)) return;
    await runAction(`undo:${match.id}`, () => returnPlayingQueueToHead(match.id), `นำเกมออกจาก ${court.name} และคืนเป็นคิว 1 แล้ว`);
  }

  async function cancelQueues(matches, all = false) {
    if (!matches.length || managingBusy) return;
    const snapshots = queueVersionRequests(matches);
    const dirtyCount = matches.filter((match) => hasLocalWork(match.id)).length;
    if (!window.confirm(`ลบ${all ? "คิวล่วงหน้าทั้งหมด" : "คิวที่เลือก"} ${matches.length} คิว ใช่ไหม?\n\nคิว ${matches.map((match) => match.queuePosition).join(", ")}\nผู้เล่นที่รอจะกลับเข้ารายการรอ เกมที่กำลังเล่นไม่เปลี่ยน${dirtyCount ? `\nร่างที่ยังไม่บันทึก ${dirtyCount} คิวจะถูกทิ้งด้วย` : ""}`)) return;
    const saved = await runAction("cancel-batch", () => cancelUpcomingQueues({ eventId: event.id, matches: snapshots }), `ลบคิวล่วงหน้า ${matches.length} คิวแล้ว`, { errorMode: "alert" });
    if (saved) {
      matches.forEach((match) => writeQueueWork(event.id, match.id, null));
      const cancelledIds = new Set(matches.map((match) => match.id));
      setSelectedQueueIds((current) => current.filter((id) => !cancelledIds.has(id)));
    }
  }

  return <section className="badminton-queue-workspace">
    <article className="badminton-card badminton-queue-summary"><div><ListOrdered size={20} /><span>รอเล่น<strong>{visibleWaiting.length}</strong></span></div><div><Play size={20} /><span>กำลังเล่น<strong>{playingMatches.length * 4}</strong></span></div><div><Timer size={20} /><span>คิวล่วงหน้า<strong>{upcoming.length}</strong></span></div></article>
    <div className="badminton-queue-courts">{event.courts.map((court) => {
      const match = playingByCourt.get(court.id);
      const timeStatus = isTestMode ? "active" : courtTimeStatus({ eventDate: event.date, eventStartTime: event.startTime, courtStartTime: court.startsAt, courtEndTime: court.endsAt, now: new Date(clock) });
      const elapsedSeconds = match?.startedAt ? Math.max(0, Math.floor((clock - new Date(match.startedAt).getTime()) / 1000)) : 0;
      const courtLabel = match ? "กำลังเล่น" : timeStatus === "expired" ? "หมดเวลาแล้ว" : timeStatus === "upcoming" ? "ยังไม่ถึงเวลา" : "ว่าง";
      const blockedByPlayingText = queueHeadPlayingCourts.length ? `รอเกม ${queueHeadPlayingCourts.join(", ")} จบก่อน` : "";
      return <article className={`badminton-card badminton-queue-court ${match ? "is-playing" : "is-empty"} is-${timeStatus}`} key={court.id}><header><div><strong>{court.name}</strong><span>{court.startsAt}–{court.endsAt}</span></div>{match ? <button aria-label={`นำเกมออกจาก ${court.name}`} className="badminton-queue-undo-court" disabled={busyKeys.has(`undo:${match.id}`)} onClick={() => undoPlayingMatch(match, court)} title="นำออกจากสนามและคืนเป็นคิว 1" type="button"><X size={18} /></button> : <b>{courtLabel}</b>}</header>{!match ? timeStatus === "active" ? <button className="badminton-primary" disabled={event.status !== "open" || !queueHeadIsApproved || queueHeadHasPlayingPlayer || busyKeys.has(`start:${court.id}`)} onClick={() => runAction(`start:${court.id}`, () => startNextQueueOnCourt({ eventId: event.id, courtId: court.id }), `นำคิว 1 ลง ${court.name} แล้ว`)} type="button"><Play size={17} /> {busyKeys.has(`start:${court.id}`) ? "กำลังลงสนาม…" : queueHeadHasPlayingPlayer ? blockedByPlayingText : queueHeadIsApproved ? "นำคิว 1 ลงสนาม" : upcoming.length ? upcoming[0].players.length < 4 ? "เติมคิว 1 ให้ครบ 4 คน" : "บันทึกคิว 1 ก่อน" : "รอคิวพร้อมเล่น"}</button> : <p className="badminton-queue-court-unavailable">{timeStatus === "expired" ? "คอร์ทนี้หมดเวลาแล้ว" : `เริ่มใช้คอร์ทได้เวลา ${court.startsAt}`}</p> : <><QueueTeamPreview fullNames match={match} /><div className="badminton-queue-playing"><span>เล่นมาแล้ว <strong>{String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:{String(elapsedSeconds % 60).padStart(2, "0")}</strong></span><button className="badminton-primary" disabled={busyKeys.has(`finish:${match.id}`)} onClick={() => finishMatch(match, court)} type="button"><Check size={17} /> {busyKeys.has(`finish:${match.id}`) ? "กำลังจบเกม..." : "จบเกม"}</button></div></>}</article>;
    })}</div>
    <article className="badminton-card badminton-upcoming-queues">
      <div className="badminton-card-title"><ListOrdered size={20} /><div><h2>คิวล่วงหน้า</h2><p>ไม่จำกัดจำนวนคิว · อัตโนมัติเลือกผู้รอนานที่สุดก่อน แล้วเติมมือใกล้เคียง</p></div></div>
      <div className="badminton-queue-create-actions"><div className="badminton-auto-queue-actions">
        <button className="badminton-primary" disabled={event.status !== "open" || availableWaiting.length < 4 || busyKeys.has("create")} onClick={() => runAction("create", createAutomaticDraft, "ระบบจัด 1 คิวพร้อมเล่นแล้ว", { errorMode: "alert" })} type="button"><Plus size={17} /> สร้าง 1 คิว</button>
        <button className="badminton-primary" disabled={event.status !== "open" || availableWaiting.length < 4 || busyKeys.has("create")} onClick={() => runAction("create", createAllAutomaticDrafts, "ระบบจัดคิวทั้งหมดที่ทำได้พร้อมเล่นแล้ว", { errorMode: "alert" })} type="button"><ListOrdered size={17} /> {busyKeys.has("create") ? "กำลังจัดคิว…" : "สร้างทั้งหมด"}</button>
      </div><button className="badminton-secondary" disabled={event.status !== "open" || availableWaiting.length + availablePlaying.length < 1} onClick={() => setEditingMatchId("new")} type="button"><Users size={17} /> สร้างคิวด้วยตัวเอง{readQueueWork(event.id, "new") ? " · มีร่างค้าง" : ""}</button></div>
      {planningProgress ? <p role="status">กำลังเตรียมคิว {planningProgress.completed} / {planningProgress.maximum}</p> : null}
      {planningMessage ? <p className="queue-work-notice" role="status">{planningMessage}</p> : null}
      {upcoming.length ? <div className="queue-batch-actions">
        <button aria-pressed={manageMode} className="badminton-secondary" disabled={managingBusy} onClick={() => { setManageMode((current) => !current); setSelectedQueueIds([]); }} type="button"><Settings size={16} /> {manageMode ? "เสร็จสิ้นการจัดการ" : "จัดการหลายคิว"}</button>
      </div> : null}
      {manageMode && upcoming.length ? <div className="queue-manage-toolbar" aria-label="จัดการคิวล่วงหน้า">
        <div><strong>เลือก {selectedQueues.length} / {upcoming.length} คิว</strong><button className="badminton-secondary" disabled={managingBusy} onClick={() => setSelectedQueueIds(selectedQueues.length === upcoming.length ? [] : upcoming.map((match) => match.id))} type="button">{selectedQueues.length === upcoming.length ? "ยกเลิกเลือกทั้งหมด" : "เลือกทั้งหมด"}</button></div>
        <div><button className="badminton-delete-button" disabled={managingBusy || !selectedQueues.length} onClick={() => cancelQueues(selectedQueues)} type="button"><Trash2 size={16} /> {busyKeys.has("cancel-batch") ? "กำลังลบ…" : `ลบที่เลือก (${selectedQueues.length})`}</button><button className="badminton-delete-button" disabled={managingBusy} onClick={() => cancelQueues(upcoming, true)} type="button">ลบคิวล่วงหน้าทั้งหมด ({upcoming.length})</button></div>
        <small>เลือกได้ทุกคิวล่วงหน้า · ไม่ลบเกมที่กำลังเล่น</small>
      </div> : null}
      {upcoming.map((match, index) => <section className={`badminton-upcoming-card queue-compact-card is-${match.status}`} key={match.id}>
        <header><div className="queue-compact-heading">{manageMode ? <label className="queue-manage-checkbox"><input aria-label={`เลือกคิว ${index + 1}`} checked={selectedQueueIds.includes(match.id)} disabled={managingBusy} onChange={(eventObject) => setSelectedQueueIds((current) => eventObject.target.checked ? [...new Set([...current, match.id])] : current.filter((id) => id !== match.id))} type="checkbox" /></label> : null}<strong>คิว {index + 1}</strong><span>{match.status === "draft" ? match.players.length ? "คิวเดิม · กดแก้ไขเพื่อบันทึก" : "คิวว่าง" : match.players.length === 4 ? "พร้อมเล่น" : `บันทึกแล้ว · รอเติมอีก ${4 - match.players.length} คน`}</span>{hasLocalWork(match.id) ? <span className="queue-dirty-badge">ยังไม่บันทึก</span> : null}</div>
          <div className="badminton-queue-order-actions">{match.status === "approved" ? <><button aria-label={`เลื่อนคิว ${index + 1} ขึ้น`} disabled={managingBusy || index === 0 || upcoming[index - 1]?.status !== "approved" || busyKeys.has(`move:${match.id}`)} onClick={() => runAction(`move:${match.id}`, () => moveUpcomingQueue(match.id, -1), "เลื่อนคิวขึ้นแล้ว")} type="button">↑</button><button aria-label={`เลื่อนคิว ${index + 1} ลง`} disabled={managingBusy || index === upcoming.length - 1 || upcoming[index + 1]?.status !== "approved" || busyKeys.has(`move:${match.id}`)} onClick={() => runAction(`move:${match.id}`, () => moveUpcomingQueue(match.id, 1), "เลื่อนคิวลงแล้ว")} type="button">↓</button></> : null}<button aria-label={`แก้ไขคิว ${index + 1}`} disabled={managingBusy} onClick={() => setEditingMatchId(match.id)} type="button"><Pencil size={15} /> แก้ไข</button></div>
        </header><QueueTeamPreview fullNames match={match} />
      </section>)}{!upcoming.length ? <div className="badminton-empty">ยังไม่มีคิวล่วงหน้า</div> : null}
    </article>
    {editingMatchId ? <QueueLineupEditor clock={clock} eventId={event.id} key={`${event.id}:${editingMatchId}`} match={upcoming.find((match) => match.id === editingMatchId)} workId={editingMatchId} isNew={editingMatchId === "new"} matches={queue.matches} onClose={() => setEditingMatchId(null)} playingCourtByMember={playingCourtByMember} queuePlayers={queue.players} runAction={runAction} upcoming={upcoming} /> : null}
    <article className="badminton-card badminton-queue-waiting"><div className="badminton-card-title"><Users size={20} /><div><h2>คิวรอเล่น</h2><p>แสดงเวลารอและลำดับคิวของแต่ละคน</p></div></div>{visibleWaiting.length ? <ol>{visibleWaiting.map((player) => {
      const draftPosition = draftPositionsByMember.get(player.memberId);
      const queuedStatus = queueStatusesByMember.get(player.memberId);
      const assignedQueue = upcoming.find((match) => match.queuePosition === draftPosition);
      return <li key={player.memberId}><span><QueuePlayerName player={player} /><em>{skillLabel(player.skillLevel)}</em></span><small className="badminton-queue-wait-time"><span>รอแล้ว {formatMinuteSecondDuration(elapsedWaitSeconds(player.queuedAt, clock))}</span><span>{draftPosition ? `${queuedStatus === "draft" ? "กดแก้ไขเพื่อบันทึก" : assignedQueue?.players.length === 4 ? "พร้อมเล่น" : "รอเติมผู้เล่น"} · คิว ${draftPosition}` : waitingTimeEstimates.get(player.memberId) > 0 ? `คาดว่าอีก ≈ ${formatMinuteSecondDuration(waitingTimeEstimates.get(player.memberId))}` : "ใกล้ถึงคิว"}</span></small></li>;
    })}</ol> : <div className="badminton-empty">ยังไม่มีผู้เล่นเช็กชื่อรอเข้าคิว</div>}</article>
  </section>;
}

function QueueTeamPreview({ fullNames = false, match }) {
  return <div className={`badminton-queue-teams${fullNames ? " show-full-names" : ""}`}>{["A", "B"].map((team) => <div key={team}><span>ทีม {team}</span>{match.players.filter((player) => player.team === team).map((player) => <div key={player.memberId}><QueuePlayerName player={player} /><em>{skillLabel(player.skillLevel)}</em></div>)}</div>)}</div>;
}

function QueuePlayerName({ player }) {
  return <strong className="badminton-queue-player-name"><span>{player.name}</span><small>{Number(player.gamesPlayed) || 0} รอบ</small></strong>;
}

function QueueModal({ title, onClose, children, footer, className = "" }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus({ preventScroll: true });
    const onKeyDown = (eventObject) => {
      if (eventObject.key === "Escape") { eventObject.preventDefault(); closeRef.current(); }
      if (eventObject.key !== "Tab") return;
      const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')];
      if (!focusable.length) { eventObject.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (eventObject.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { eventObject.preventDefault(); last.focus({ preventScroll: true }); }
      else if (!eventObject.shiftKey && document.activeElement === last) { eventObject.preventDefault(); first.focus({ preventScroll: true }); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); document.body.style.overflow = previousOverflow; previousFocus?.focus?.({ preventScroll: true }); };
  }, []);
  return createPortal(<div className="queue-modal-backdrop"><section aria-label={title} aria-modal="true" className={`queue-selection-modal ${className}`} ref={dialogRef} role="dialog" tabIndex={-1}><header><h2>{title}</h2><button aria-label="ปิดหน้าต่างเลือกคิว" onClick={onClose} type="button"><X size={22} /></button></header><div className="queue-modal-body">{children}</div><footer>{footer}</footer></section></div>, document.body);
}

function QueueLineupEditor({ clock, eventId, isNew, match, matches, onClose, playingCourtByMember, queuePlayers, runAction, upcoming, workId }) {
  const freshDraft = () => ({ memberIds: (match?.players || []).map((player) => player.memberId), baseVersion: match?.revision || 0, baseSignature: queueLineupSignature(match?.players) });
  const [draft, setDraft] = useState(() => readQueueWork(eventId, workId) || freshDraft());
  const [dirty, setDirty] = useState(() => Boolean(readQueueWork(eventId, workId)));
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const savingRef = useRef(false);
  const conflict = !isNew && (!match || queueDraftConflicts(draft, match));
  const liveSignature = queueLineupSignature(match?.players);
  useEffect(() => { if (!dirty && match) setDraft(freshDraft()); }, [liveSignature, match?.revision, dirty]);
  const currentMemberIds = new Set(match?.players.map((player) => player.memberId) || []);
  const queuePositionByMember = new Map(upcoming.filter((entry) => entry.id !== match?.id).flatMap((entry) => entry.players.map((player) => [player.memberId, entry.queuePosition])));
  const candidates = [...queuePlayers, ...(match?.players || [])]
    .filter((player) => currentMemberIds.has(player.memberId) || ["waiting", "playing", "reserved"].includes(player.status))
    .filter((player, index, rows) => rows.findIndex((row) => row.memberId === player.memberId) === index)
    .sort((left, right) => compareKeys(queueFairnessKey(left), queueFairnessKey(right)));
  const selectedPlayers = draft.memberIds.map((id) => candidates.find((player) => player.memberId === id)).filter(Boolean);
  const selectedUnavailable = draft.memberIds.some((id) => !candidates.some((player) => player.memberId === id && ["waiting", "playing", "reserved"].includes(player.status) && SKILL_LEVELS.includes(player.skillLevel)) || queuePositionByMember.has(id));
  const search = normalizeMemberSearch(query);
  const filtered = candidates.filter((player) => normalizeMemberSearch(`${player.name} ${player.lineName} ${skillLabel(player.skillLevel)}`).includes(search));
  function select(memberId) {
    if (savingRef.current) return;
    setSaveError("");
    const next = { ...draft, memberIds: toggleQueueSelection(draft.memberIds, memberId) };
    setDraft(next); setDirty(true);
    setStorageWarning(!writeQueueWork(eventId, workId, next));
  }
  function close() {
    if (savingRef.current) return;
    if (dirty && !window.confirm("มีรายชื่อที่ยังไม่บันทึก ปิดหน้าต่างและเก็บร่างไว้ทำต่อใช่ไหม?")) return;
    onClose();
  }
  function reload() {
    if (dirty && !window.confirm("ทิ้งการเลือกที่ยังไม่บันทึก และใช้รายชื่อคิวล่าสุดใช่ไหม?")) return;
    setSaveError("");
    writeQueueWork(eventId, workId, null); setDraft(freshDraft()); setDirty(false);
  }
  async function save() {
    if (savingRef.current || selectedPlayers.length < 1 || conflict || selectedUnavailable) return;
    savingRef.current = true; setSaving(true); setSaveError("");
    try {
      await saveQueueEditor((onError) => {
        const teams = selectedPlayers.length === 4 ? balanceTeams(selectedPlayers, matches) : { teamA: selectedPlayers.slice(0, 2), teamB: selectedPlayers.slice(2) };
        const slots = [...teams.teamA.map((player, index) => ({ memberId: player.memberId, team: "A", position: index + 1 })), ...teams.teamB.map((player, index) => ({ memberId: player.memberId, team: "B", position: index + 1 }))];
        return runAction(`save:${workId}`, () => isNew
          ? createManualQueue({ eventId, memberIds: draft.memberIds, teamAIds: teams.teamA.map((player) => player.memberId) })
          : saveQueueLineup({ matchId: match.id, slots, expectedVersion: draft.baseVersion, approve: true }), draft.memberIds.length === 4 ? "บันทึกคิวพร้อมเล่นแล้ว" : `บันทึกคิว ${draft.memberIds.length} คนแล้ว เติมผู้เล่นภายหลังได้`, { onError });
      }, { onError: setSaveError, onSaved: () => { writeQueueWork(eventId, workId, null); setDirty(false); onClose(); } });
    } finally { savingRef.current = false; setSaving(false); }
  }
  return <QueueModal className="queue-picker-modal" title={isNew ? "เลือกผู้เล่นเข้าคิว" : `แก้ไขคิว ${match?.queuePosition || ""}`} onClose={close} footer={<><span role="status">เลือก <strong>{draft.memberIds.length} / 4</strong>{dirty ? <b className="queue-dirty-badge">ยังไม่บันทึก</b> : null}</span><button className="badminton-primary" disabled={saving || selectedPlayers.length < 1 || conflict || selectedUnavailable} onClick={save} type="button"><Check size={17} />{saving ? "กำลังบันทึก…" : draft.memberIds.length === 4 ? "บันทึกพร้อมเล่น" : "บันทึกคิว"}</button>{saveError ? <p className="queue-save-error" role="alert">{saveError}</p> : null}</>}>
    <p className="queue-picker-hint">เลือกอย่างน้อย 1 คน · บันทึกเป็นคิวทันที · เติมให้ครบ 4 คนก่อนลงสนาม</p>
    {conflict ? <div className="queue-work-conflict" role="alert">{match ? "คิวนี้เปลี่ยนจากเครื่องอื่นแล้ว กรุณาโหลดรายชื่อล่าสุดก่อนบันทึก" : "คิวนี้ถูกนำลงสนามหรือยกเลิกแล้ว ร่างของคุณยังเก็บไว้"}{match ? <button onClick={reload} type="button">ใช้รายชื่อล่าสุด</button> : null}</div> : null}
    {storageWarning ? <p role="alert">เครื่องนี้เก็บร่างไม่ได้ กรุณาบันทึกก่อนปิดหน้าต่าง</p> : null}
    {selectedUnavailable ? <p className="queue-work-conflict" role="alert">มีคนที่เลือกไว้ไม่พร้อมแล้ว ถูกจัดเข้าคิวอื่น หรือยังไม่กำหนดมือ กรุณายกเลิกเลือกคนนั้นก่อนบันทึก</p> : null}
    <div className="queue-selected-people">{draft.memberIds.map((id) => <button disabled={saving} key={id} onClick={() => select(id)} type="button">{candidates.find((player) => player.memberId === id)?.name || "ผู้เล่นไม่พร้อมแล้ว"}<X size={14} /></button>)}</div>
    <input aria-label="ค้นหาผู้เล่นเข้าคิว" autoComplete="off" className="queue-picker-search" onChange={(eventObject) => setQuery(eventObject.target.value)} placeholder="ค้นหาชื่อหรือระดับมือ" type="search" value={query} />
    <div className="queue-player-groups">{[...SKILL_LEVELS, null].map((level) => {
      const rows = filtered.filter((player) => (player.skillLevel || null) === level);
      if (!rows.length) return null;
      return <section className="queue-player-group" key={level || "unknown"}><h3>{skillLabel(level) || "ไม่ระบุมือ"} <small>{rows.length} คน</small></h3><div>{rows.map((player) => {
        const checked = draft.memberIds.includes(player.memberId);
        const court = playingCourtByMember.get(player.memberId);
        const position = queuePositionByMember.get(player.memberId);
        const queueBadge = position ? `คิว ${position}` : "";
        const missingSkill = !SKILL_LEVELS.includes(player.skillLevel);
        const unavailable = !["waiting", "playing", "reserved"].includes(player.status) || missingSkill;
        return <label className={`queue-pick-player${checked ? " is-selected" : ""}${position ? " is-queued" : ""}${court ? " is-playing" : ""}${unavailable ? " is-unavailable" : ""}`} key={player.memberId}><input checked={checked} disabled={saving || (!checked && (draft.memberIds.length >= 4 || Boolean(position) || unavailable))} onChange={() => select(player.memberId)} type="checkbox" /><span><strong><span>{player.name}</span>{queueBadge ? <em className="queue-player-queue-tag">{queueBadge}</em> : null}</strong><small>{missingSkill ? "ยังไม่กำหนดมือ" : unavailable ? "กลับแล้ว / ไม่พร้อม" : court ? `กำลังเล่น · ${court}` : `รอ ${formatMinuteSecondDuration(elapsedWaitSeconds(player.queuedAt, clock))}`}</small></span></label>;
      })}</div></section>;
    })}</div>{!filtered.length ? <p className="badminton-empty">ไม่พบผู้เล่นตามคำค้นหา</p> : null}
  </QueueModal>;
}

export function OperatorCourtControls(props) {
  return <CourtBookingPanel {...props} />;
}
