// Local UI verification only. The mutation stub never executes repository calls.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import QueuePanel, { OperatorCourtControls } from "../../src/QueuePanel.jsx";
import "../../src/badminton.css";

const now = Date.now();
const levels = ["Rookie-", "Rookie", "BG", "N", "S", "P"];
const members = Array.from({ length: 40 }, (_, index) => ({ id: `fixture-player-${index}`, nickname: index === 20 ? "ชื่อผู้เล่นยาวทดสอบ" : `ทดสอบ ${String(index + 1).padStart(2, "0")}`, display_name: `Player ${index + 1}`, skill_level: levels[Math.min(5, Math.floor(index / 7))] }));
const date = new Date().toLocaleDateString("sv-SE");
const event = { id: "fixture-queue-only", date, startTime: "00:00", endTime: "23:30", status: "open", courts: [{ id: "fixture-court", name: "คอร์ททดสอบ", startsAt: "00:00", endsAt: "23:30" }] };
const initial = {
  members,
  signups: members.map((member) => ({ member_id: member.id, event_id: event.id, status: "coming", arrival_time: "00:00", skill_level_snapshot: member.skill_level })),
  attendance: members.map((member) => ({ member_id: member.id, event_id: event.id, arrived: true, arrived_at: "00:00", left_at: null })),
  queuePlayers: members.map((member, index) => ({ member_id: member.id, status: index < 8 ? "reserved" : index < 12 ? "playing" : "waiting", games_played: index % 4, queued_at: new Date(now - ((40 - index) * 60000)).toISOString() })),
  queueMatches: [{ id: "fixture-draft", status: "draft", queue_position: 1, sequence: 1, revision: 1 }, { id: "fixture-approved", status: "approved", queue_position: 2, sequence: 2, revision: 1 }, { id: "fixture-playing", status: "playing", court_id: "fixture-court", sequence: 3, started_at: new Date(now - 420000).toISOString(), revision: 1 }],
  queueMatchPlayers: members.slice(0, 12).map((member, index) => ({ match_id: index < 4 ? "fixture-draft" : index < 8 ? "fixture-approved" : "fixture-playing", member_id: member.id, skill_level_snapshot: member.skill_level, team: index % 4 < 2 ? "A" : "B", position: (index % 2) + 1 })),
};
const reorderMode = new URLSearchParams(window.location.search).get("reorder") === "1";
const reorderIds = ["fixture-reorder-a", "fixture-reorder-b", "fixture-reorder-c", "fixture-playing"];
const reorderInitial = {
  ...initial,
  queuePlayers: initial.queuePlayers.map((player, index) => ({ ...player, status: index < 12 ? "reserved" : index < 16 ? "playing" : "waiting" })),
  queueMatches: [
    ...reorderIds.slice(0, 3).map((id, index) => ({ id, status: "approved", queue_position: index + 1, sequence: index + 1, revision: 1 })),
    { id: "fixture-playing", status: "playing", court_id: "fixture-court", sequence: 4, started_at: new Date(now - 420000).toISOString(), revision: 1 },
  ],
  queueMatchPlayers: members.slice(0, 16).map((member, index) => ({ match_id: reorderIds[Math.floor(index / 4)], member_id: member.id, skill_level_snapshot: member.skill_level, team: index % 4 < 2 ? "A" : "B", position: (index % 2) + 1 })),
  diagnostic: { requests: 0, swaps: 0, failures: 0, pending: 0, noOps: 0 },
};
// The diagnostic serializes local state updates like the real mutation queue,
// but still never invokes repository calls, even when a move is successful.
let reorderMutationTail = Promise.resolve();

function Fixture() {
  const [dashboard, setDashboard] = useState(() => reorderMode ? reorderInitial : initial);
  const [show, setShow] = useState(true);
  const [fail, setFail] = useState(false);
  const [notice, setNotice] = useState("");
  async function mutate(_neverExecuted, text, options = {}) {
    const movePrefix = `queue:${event.id}:move:`;
    if (reorderMode && options.actionKey?.startsWith(movePrefix)) {
      const matchId = options.actionKey.slice(movePrefix.length);
      const direction = text.includes("ขึ้น") ? -1 : 1;
      setDashboard((current) => ({ ...current, diagnostic: { ...current.diagnostic, requests: current.diagnostic.requests + 1, pending: current.diagnostic.pending + 1 } }));
      setNotice("กำลังจำลองเลื่อนคิวในเครื่อง (หน่วง 1 วินาที)");
      const result = reorderMutationTail.then(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (fail) {
          options.onError?.(new Error("จำลองเลื่อนคิวไม่สำเร็จ ลำดับคิวเดิมยังอยู่"));
          setNotice("จำลองเลื่อนคิวไม่สำเร็จ ลำดับคิวเดิมยังอยู่");
          setDashboard((current) => ({ ...current, diagnostic: { ...current.diagnostic, failures: current.diagnostic.failures + 1, pending: current.diagnostic.pending - 1 } }));
          return false;
        }
        setDashboard((current) => {
          const target = current.queueMatches.find((match) => match.id === matchId && match.status === "approved");
          const adjacent = target && current.queueMatches.find((match) => match.status === "approved" && match.queue_position === target.queue_position + direction);
          return {
            ...current,
            queueMatches: !adjacent ? current.queueMatches : current.queueMatches.map((match) => match.id === target.id ? { ...match, queue_position: adjacent.queue_position, revision: match.revision + 1 } : match.id === adjacent.id ? { ...match, queue_position: target.queue_position, revision: match.revision + 1 } : match),
            diagnostic: { ...current.diagnostic, pending: current.diagnostic.pending - 1, swaps: current.diagnostic.swaps + Number(Boolean(adjacent)), noOps: current.diagnostic.noOps + Number(!adjacent) },
          };
        });
        setNotice(text);
        return true;
      });
      reorderMutationTail = result.catch(() => {});
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    setNotice(fail ? "ทดสอบบันทึกล้มเหลว: ร่างต้องคงอยู่" : text);
    if (fail) options.onError?.(new Error("จำลองบันทึกไม่สำเร็จ รายชื่อที่เลือกยังอยู่ครบ กรุณาลองอีกครั้ง"));
    return !fail;
  }
  function remoteChange() {
    setDashboard((current) => ({ ...current, queueMatches: current.queueMatches.map((match) => match.id === "fixture-draft" ? { ...match, revision: match.revision + 1 } : match), queueMatchPlayers: current.queueMatchPlayers.map((player, index) => index === 0 ? { ...player, member_id: "fixture-player-10" } : player) }));
  }
  return <main className="badminton-app" style={{ padding: 16 }}><p>หน้าทดสอบในเครื่องเท่านั้น · ไม่บันทึกข้อมูลจริง</p>{reorderMode ? <section aria-label="ผลทดสอบเลื่อนคิว"><strong>ทดสอบเลื่อนคิว · 3 คิวพร้อมเล่น + 1 เกมในสนาม</strong><output data-testid="reorder-diagnostic">{JSON.stringify({ ...dashboard.diagnostic, order: dashboard.queueMatches.filter((match) => match.status === "approved").sort((left, right) => left.queue_position - right.queue_position).map((match) => match.id.replace("fixture-reorder-", "")).join(" → "), playing: dashboard.queueMatches.filter((match) => match.status === "playing").length })}</output></section> : null}<nav style={{ display: "flex", gap: 12, flexWrap: "wrap" }}><button onClick={() => setShow((value) => !value)} type="button">สลับแท็บทดสอบ</button>{!reorderMode ? <><button onClick={remoteChange} type="button">จำลองคิวเปลี่ยนจากเครื่องอื่น</button><button onClick={() => setTimeout(remoteChange, 4000)} type="button">จำลองคิวเปลี่ยนใน 4 วินาที</button></> : null}<button onClick={() => setFail((value) => !value)} type="button">บันทึกจำลอง: {fail ? "ล้มเหลว" : "สำเร็จ"}</button></nav><p role="status">{notice}</p>{show ? <><QueuePanel dashboard={dashboard} event={event} mutate={mutate} /><OperatorCourtControls event={event} mutate={mutate} /></> : <p>อีกแท็บหนึ่ง</p>}</main>;
}
const fixtureRoot = import.meta.hot?.data.fixtureRoot || createRoot(document.getElementById("root"));
if (import.meta.hot) { import.meta.hot.data.fixtureRoot = fixtureRoot; import.meta.hot.accept(); }
fixtureRoot.render(<Fixture />);
