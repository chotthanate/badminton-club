// Local UI verification only. The mutation stub never executes repository calls.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import QueuePanel, { OperatorCourtControls } from "../../src/QueuePanel.jsx";
import "../../src/badminton.css";

const now = Date.now();
const levels = ["Rookie-", "Rookie", "BG", "N", "S", "P"];
const members = Array.from({ length: 72 }, (_, index) => ({ id: `fixture-player-${index}`, nickname: `ทดสอบ ${String(index + 1).padStart(2, "0")}`, display_name: `Player ${index + 1}`, skill_level: levels[Math.floor(index / 12)] }));
const date = new Date().toLocaleDateString("sv-SE");
const event = { id: "fixture-queue-only", date, startTime: "00:00", endTime: "23:30", status: "open", courts: [{ id: "fixture-court", name: "คอร์ททดสอบ", startsAt: "00:00", endsAt: "23:30" }] };
const initial = {
  members,
  signups: [],
  queuePlayers: members.map((member, index) => ({ member_id: member.id, status: index < 4 ? "reserved" : index < 8 ? "playing" : "waiting", games_played: index % 4, queued_at: new Date(now - ((72 - index) * 60000)).toISOString() })),
  queueMatches: [{ id: "fixture-draft", status: "draft", queue_position: 1, sequence: 1, revision: 1 }, { id: "fixture-playing", status: "playing", court_id: "fixture-court", sequence: 2, started_at: new Date(now - 420000).toISOString(), revision: 1 }],
  queueMatchPlayers: members.slice(0, 8).map((member, index) => ({ match_id: index < 4 ? "fixture-draft" : "fixture-playing", member_id: member.id, skill_level_snapshot: member.skill_level, team: index % 4 < 2 ? "A" : "B", position: (index % 2) + 1 })),
};

function Fixture() {
  const [dashboard, setDashboard] = useState(initial);
  const [show, setShow] = useState(true);
  const [fail, setFail] = useState(true);
  const [notice, setNotice] = useState("");
  async function mutate(_neverExecuted, text) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    setNotice(fail ? "ทดสอบบันทึกล้มเหลว: ร่างต้องคงอยู่" : text);
    return !fail;
  }
  function remoteChange() {
    setDashboard((current) => ({ ...current, queueMatches: current.queueMatches.map((match) => match.id === "fixture-draft" ? { ...match, revision: match.revision + 1 } : match), queueMatchPlayers: current.queueMatchPlayers.map((player, index) => index === 0 ? { ...player, member_id: "fixture-player-10" } : player) }));
  }
  return <main className="badminton-app" style={{ padding: 16 }}><nav style={{ display: "flex", gap: 12, flexWrap: "wrap" }}><button onClick={() => setShow((value) => !value)} type="button">สลับแท็บทดสอบ</button><button onClick={remoteChange} type="button">จำลองคิวเปลี่ยนจากเครื่องอื่น</button><button onClick={() => setTimeout(remoteChange, 4000)} type="button">จำลองคิวเปลี่ยนใน 4 วินาที</button><button onClick={() => setFail((value) => !value)} type="button">บันทึกจำลอง: {fail ? "ล้มเหลว" : "สำเร็จ"}</button></nav><p role="status">{notice}</p>{show ? <><QueuePanel dashboard={dashboard} event={event} mutate={mutate} /><OperatorCourtControls event={event} mutate={mutate} /></> : <p>อีกแท็บหนึ่ง</p>}</main>;
}
const fixtureRoot = import.meta.hot?.data.fixtureRoot || createRoot(document.getElementById("root"));
if (import.meta.hot) { import.meta.hot.data.fixtureRoot = fixtureRoot; import.meta.hot.accept(); }
fixtureRoot.render(<Fixture />);
