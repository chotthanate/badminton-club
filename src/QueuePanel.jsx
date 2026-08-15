import React, { useEffect, useMemo, useState } from "react";
import { Check, ListOrdered, Pencil, Play, Plus, Save, Settings, Timer, Trash2, Users, X } from "lucide-react";
import {
  approveQueueDraft,
  cancelQueueMatch,
  createManualQueueDraft,
  createQueueDraft,
  finishQueueMatch,
  moveUpcomingQueue,
  startNextQueueOnCourt,
  updateQueueDraftLineup,
  removeOperatorCourt,
  upsertOperatorCourt,
} from "./clubRepository.js";
import { lineupCompatibility, proposeQueueMatch } from "./queueLogic.js";
import { normalizePlayableSkillLevels } from "./skillLevels.js";

const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`);
const SLOT_DEFINITIONS = [{ team: "A", position: 1 }, { team: "A", position: 2 }, { team: "B", position: 1 }, { team: "B", position: 2 }];

function memberName(member) {
  return member?.nickname || member?.display_name || "ไม่ทราบชื่อ";
}

export function mapQueueDashboard(dashboard) {
  const membersById = new Map((dashboard.members || []).map((member) => [member.id, member]));
  const signupsByMember = new Map((dashboard.signups || []).map((signup) => [signup.member_id, signup]));
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
      status: row.status,
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
    players: (matchPlayersByMatch.get(match.id) || []).sort((left, right) => left.team.localeCompare(right.team) || left.position - right.position),
  }));
  return { players, matches };
}

export default function QueuePanel({ dashboard, event, isStaff = false, mutate }) {
  const [editingMatchId, setEditingMatchId] = useState(null);
  const [finishingMatchId, setFinishingMatchId] = useState(null);
  const [clock, setClock] = useState(Date.now());
  const queue = useMemo(() => mapQueueDashboard(dashboard), [dashboard]);
  const nextSequence = Math.max(0, ...queue.matches.map((match) => match.sequence)) + 1;
  const playingMatches = queue.matches.filter((match) => match.status === "playing");
  const playingByCourt = new Map(playingMatches.map((match) => [match.courtId, match]));
  const upcoming = queue.matches.filter((match) => ["draft", "approved"].includes(match.status)).sort((a, b) => a.queuePosition - b.queuePosition);
  const approved = upcoming.filter((match) => match.status === "approved");
  const queueHeadIsApproved = upcoming[0]?.status === "approved";
  const draft = upcoming.find((match) => match.status === "draft");
  const waiting = queue.players.filter((player) => player.status === "waiting").sort((a, b) => a.gamesPlayed - b.gamesPlayed || a.minutesPlayed - b.minutesPlayed || new Date(a.queuedAt) - new Date(b.queuedAt));

  useEffect(() => {
    if (!playingMatches.length) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [playingMatches.map((match) => match.id).join("|")]);

  async function createAutomaticDraft() {
    const proposal = proposeQueueMatch(queue.players, queue.matches, nextSequence);
    if (!proposal) throw new Error(waiting.length < 4 ? `มีผู้เล่นพร้อมเข้าคิว ${waiting.length} คน ต้องมีอย่างน้อย 4 คน` : "ยังไม่มีผู้เล่น 4 คนที่เงื่อนไขตรงกัน กรุณารอผู้เล่นที่เหมาะสมกลับเข้าคิว");
    await createQueueDraft({ eventId: event.id, memberIds: proposal.lineup.map((player) => player.memberId), teamAIds: proposal.teamA.map((player) => player.memberId) });
  }

  async function finishMatch(match, court) {
    if (finishingMatchId) return;
    setFinishingMatchId(match.id);
    try { await mutate(() => finishQueueMatch(match.id), `จบเกม ${court.name} แล้ว สนามว่าง`); } finally { setFinishingMatchId(null); }
  }

  return <section className="badminton-queue-workspace">
    <article className="badminton-card badminton-queue-summary"><div><ListOrdered size={20} /><span>รอเล่น<strong>{waiting.length}</strong></span></div><div><Play size={20} /><span>กำลังเล่น<strong>{playingMatches.length * 4}</strong></span></div><div><Timer size={20} /><span>คิวล่วงหน้า<strong>{upcoming.length}/{event.courts.length}</strong></span></div></article>
    <div className="badminton-queue-courts">{event.courts.map((court) => {
      const match = playingByCourt.get(court.id);
      const elapsedSeconds = match?.startedAt ? Math.max(0, Math.floor((clock - new Date(match.startedAt).getTime()) / 1000)) : 0;
      return <article className={`badminton-card badminton-queue-court ${match ? "is-playing" : "is-empty"}`} key={court.id}><header><div><strong>{court.name}</strong><span>{court.startsAt}–{court.endsAt}</span></div>{match ? <b>กำลังเล่น</b> : <b>ว่าง</b>}</header>{!match ? <button className="badminton-primary" disabled={event.status !== "open" || !queueHeadIsApproved} onClick={() => mutate(() => startNextQueueOnCourt({ eventId: event.id, courtId: court.id }), `นำคิว 1 ลง ${court.name} แล้ว`)} type="button"><Play size={17} /> {queueHeadIsApproved ? "นำคิว 1 ลงสนาม" : upcoming.length ? "อนุมัติคิว 1 ก่อน" : "รอคิวที่อนุมัติ"}</button> : <><QueueTeamPreview match={match} /><div className="badminton-queue-playing"><span>เล่นมาแล้ว <strong>{String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:{String(elapsedSeconds % 60).padStart(2, "0")}</strong></span><button className="badminton-primary" disabled={finishingMatchId === match.id} onClick={() => finishMatch(match, court)} type="button"><Check size={17} /> {finishingMatchId === match.id ? "กำลังจบเกม..." : "จบเกม"}</button></div></>}</article>;
    })}</div>
    <article className="badminton-card badminton-upcoming-queues"><div className="badminton-card-title"><ListOrdered size={20} /><div><h2>คิวล่วงหน้า</h2><p>อนุมัติก่อน จึงจะแสดงให้ผู้เล่นเห็น</p></div></div><div className="badminton-queue-create-actions"><button className="badminton-primary" disabled={event.status !== "open" || Boolean(draft) || upcoming.length >= event.courts.length || waiting.length < 4} onClick={() => mutate(createAutomaticDraft, "ระบบจัดคิวร่างแล้ว กรุณาตรวจและอนุมัติ")} type="button"><Plus size={17} /> สร้างคิวอัตโนมัติ</button><button className="badminton-secondary" disabled={event.status !== "open" || Boolean(draft) || upcoming.length >= event.courts.length || waiting.length < 4} onClick={() => mutate(() => createManualQueueDraft(event.id), "สร้างคิวเปล่าแล้ว เลือกผู้เล่น 4 คนได้เลย")} type="button"><Users size={17} /> สร้างคิวด้วยตัวเอง</button></div>{upcoming.map((match, index) => {
      const editing = match.status === "draft" || editingMatchId === match.id;
      return <section className={`badminton-upcoming-card is-${match.status}`} key={match.id}><header><div><strong>คิว {index + 1}</strong><span>{match.status === "approved" ? "อนุมัติแล้ว" : "รอตรวจสอบ"}</span></div>{match.status === "approved" ? <div className="badminton-queue-order-actions"><button aria-label="เลื่อนขึ้น" disabled={index === 0 || upcoming[index - 1]?.status !== "approved"} onClick={() => mutate(() => moveUpcomingQueue(match.id, -1), "เลื่อนคิวขึ้นแล้ว")} type="button">↑</button><button aria-label="เลื่อนลง" disabled={index === upcoming.length - 1 || upcoming[index + 1]?.status !== "approved"} onClick={() => mutate(() => moveUpcomingQueue(match.id, 1), "เลื่อนคิวลงแล้ว")} type="button">↓</button><button onClick={() => setEditingMatchId(match.id)} type="button"><Pencil size={15} /> แก้</button></div> : null}</header>{editing ? <QueueLineupEditor match={match} onClose={() => setEditingMatchId(null)} mutate={mutate} waiting={waiting} /> : <QueueTeamPreview match={match} />}<button className="badminton-delete-button badminton-full-button" onClick={() => mutate(() => cancelQueueMatch(match.id), `ยกเลิกคิว ${index + 1} แล้ว`)} type="button"><X size={16} /> ยกเลิกคิว</button></section>;
    })}{!upcoming.length ? <div className="badminton-empty">ยังไม่มีคิวล่วงหน้า</div> : null}</article>
    <article className="badminton-card badminton-queue-waiting"><div className="badminton-card-title"><Users size={20} /><div><h2>คิวรอเล่น</h2><p>เรียงตามความยุติธรรมของระบบ</p></div></div>{waiting.length ? <ol>{waiting.map((player) => <li key={player.memberId}><span><strong>{player.name}</strong><em>{player.skillLevel}</em></span><small>รอเข้าคิว</small></li>)}</ol> : <div className="badminton-empty">ยังไม่มีผู้เล่นเช็กชื่อรอเข้าคิว</div>}</article>
  </section>;
}

function QueueTeamPreview({ match }) {
  return <div className="badminton-queue-teams">{["A", "B"].map((team) => <div key={team}><span>ทีม {team}</span>{match.players.filter((player) => player.team === team).map((player) => <div key={player.memberId}><strong>{player.name}</strong><em>{player.skillLevel}</em></div>)}</div>)}</div>;
}

function QueueLineupEditor({ match, mutate, onClose, waiting }) {
  const [slots, setSlots] = useState(() => SLOT_DEFINITIONS.map((slot) => ({ ...slot, memberId: match.players.find((player) => player.team === slot.team && player.position === slot.position)?.memberId || "" })));
  const candidates = [...match.players, ...waiting].filter((player, index, rows) => rows.findIndex((row) => row.memberId === player.memberId) === index);
  const selectedPlayers = slots.map((slot) => candidates.find((player) => player.memberId === slot.memberId)).filter(Boolean);
  const hasCompatibilityWarning = selectedPlayers.length === 4
    && !selectedPlayers.some((basePlayer) => lineupCompatibility(selectedPlayers, basePlayer).valid);
  function selectPlayer(slotIndex, memberId) {
    setSlots((current) => {
      const next = current.map((slot) => ({ ...slot }));
      const otherIndex = next.findIndex((slot, index) => index !== slotIndex && slot.memberId === memberId);
      if (otherIndex >= 0) next[otherIndex].memberId = next[slotIndex].memberId;
      next[slotIndex].memberId = memberId;
      return next;
    });
  }
  async function save(approve) {
    const assignments = slots.filter((slot) => slot.memberId);
    return mutate(async () => { await updateQueueDraftLineup({ matchId: match.id, slots: assignments }); if (approve) await approveQueueDraft(match.id); }, approve ? "อนุมัติคิวแล้ว" : "บันทึกคิวร่างแล้ว");
  }
  return <div className="badminton-queue-editor"><div className="badminton-queue-slots">{slots.map((slot, index) => <label key={`${slot.team}${slot.position}`}><span>{slot.team}{slot.position}</span><select onChange={(event) => selectPlayer(index, event.target.value)} value={slot.memberId}><option value="">ว่าง</option>{candidates.map((player) => <option key={player.memberId} value={player.memberId}>{player.name} · {player.skillLevel}</option>)}</select></label>)}</div>{hasCompatibilityWarning ? <p className="badminton-queue-compatibility-warning">ระดับมือของผู้เล่นชุดนี้ห่างกันหรือไม่ตรงกับค่าที่ตั้งไว้ แต่คิวที่จัดเองยังบันทึกและอนุมัติได้</p> : null}<div className="badminton-queue-actions"><button className="badminton-secondary" onClick={() => save(false)} type="button"><Save size={16} /> บันทึกร่าง</button><button className="badminton-primary" disabled={slots.some((slot) => !slot.memberId)} onClick={() => save(true)} type="button"><Check size={16} /> อนุมัติคิว</button>{match.status === "approved" ? <button onClick={onClose} type="button">ปิด</button> : null}</div></div>;
}

function TimeSelect({ label, onChange, value }) {
  return <select aria-label={label} onChange={(event) => onChange(event.target.value)} value={value}>{TIME_OPTIONS.map((time) => <option key={time}>{time}</option>)}</select>;
}

export function OperatorCourtControls({ event, mutate }) {
  const [newCourt, setNewCourt] = useState({ name: "", startsAt: event.startTime, endsAt: event.endTime });
  async function addCourt(eventObject) {
    eventObject.preventDefault();
    const saved = await mutate(() => upsertOperatorCourt({ eventId: event.id, courtName: newCourt.name, startsAt: newCourt.startsAt, endsAt: newCourt.endsAt }), "เพิ่มคอร์ทแล้ว");
    if (saved) setNewCourt({ name: "", startsAt: event.startTime, endsAt: event.endTime });
  }
  return <article className="badminton-card badminton-operator-courts"><div className="badminton-card-title"><Settings size={20} /><div><h2>คอร์ทและเวลา</h2><p>แก้เวลา เพิ่ม หรือลดคอร์ทได้จากหน้านี้</p></div></div>{event.courts.map((court) => <OperatorCourtRow court={court} eventId={event.id} key={court.id} mutate={mutate} />)}<form className="badminton-court-row badminton-operator-add-court" onSubmit={addCourt}><input aria-label="ชื่อคอร์ทใหม่" onChange={(eventObject) => setNewCourt({ ...newCourt, name: eventObject.target.value })} placeholder="เช่น คอร์ท 13" required value={newCourt.name} /><TimeSelect label="เวลาเริ่มคอร์ทใหม่" onChange={(value) => setNewCourt({ ...newCourt, startsAt: value })} value={newCourt.startsAt} /><TimeSelect label="เวลาจบคอร์ทใหม่" onChange={(value) => setNewCourt({ ...newCourt, endsAt: value })} value={newCourt.endsAt} /><button className="badminton-primary" type="submit"><Plus size={16} /> เพิ่ม</button></form></article>;
}

function OperatorCourtRow({ court, eventId, mutate }) {
  const [form, setForm] = useState({ name: court.name, startsAt: court.startsAt, endsAt: court.endsAt });
  return <div className="badminton-court-row"><input aria-label={`ชื่อ ${court.name}`} onChange={(eventObject) => setForm({ ...form, name: eventObject.target.value })} value={form.name} /><TimeSelect label={`เวลาเริ่ม ${court.name}`} onChange={(value) => setForm({ ...form, startsAt: value })} value={form.startsAt} /><TimeSelect label={`เวลาจบ ${court.name}`} onChange={(value) => setForm({ ...form, endsAt: value })} value={form.endsAt} /><div className="badminton-operator-court-actions"><button aria-label={`บันทึก ${court.name}`} className="badminton-icon-button" onClick={() => mutate(() => upsertOperatorCourt({ eventId, courtId: court.id, courtName: form.name, startsAt: form.startsAt, endsAt: form.endsAt }), `บันทึก ${form.name} แล้ว`)} type="button"><Save size={16} /></button><button aria-label={`ลบ ${court.name}`} className="badminton-delete-button" onClick={() => { if (window.confirm(`ลบ ${court.name} ออกจากรอบนี้ใช่ไหม?`)) mutate(() => removeOperatorCourt({ eventId, courtId: court.id }), `ลบ ${court.name} แล้ว`); }} type="button"><Trash2 size={16} /></button></div></div>;
}
