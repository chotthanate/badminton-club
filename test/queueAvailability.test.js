import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { queueAttendanceStatus } from "../src/queueAvailability.js";
import { buildQueuePlanningState } from "../src/queuePlanning.js";
import { normalizePlayableSkillLevels } from "../src/skillLevels.js";

const coming = { status: "coming" };
const present = { arrived: true, left_at: null };
test("stale queue candidates cannot outlive departure, unchecked arrival or withdrawn signup", () => {
  for (const status of ["waiting", "reserved", "proposed"]) {
    assert.equal(queueAttendanceStatus({ status }, coming, present), status);
    for (const attendance of [undefined, { arrived: false }, { ...present, left_at: "00:30" }, { ...present, removed_at: "now" }]) {
      assert.equal(queueAttendanceStatus({ status }, coming, attendance), "left");
    }
    for (const signup of [undefined, { status: "cancelled" }, { ...coming, removed_at: "now" }]) {
      assert.equal(queueAttendanceStatus({ status }, signup, present), "left");
    }
  }
});
test("defense keeps playing states visible and never revives a server-side left state", () => {
  assert.equal(queueAttendanceStatus({ status: "playing" }, undefined, { arrived: true, left_at: "00:30" }), "playing");
  assert.equal(queueAttendanceStatus({ status: "left" }, coming, present), "left");
});

const source = readFileSync(new URL("../src/QueuePanel.jsx", import.meta.url), "utf8");
const start = source.indexOf("export function mapQueueDashboard");
const end = source.indexOf("export default function QueuePanel", start);
assert.ok(start >= 0 && end > start);
const mapQueueDashboard = new Function("normalizePlayableSkillLevels", "queueAttendanceStatus", "memberName", `${source.slice(start, end).replace("export function", "function")}; return mapQueueDashboard;`)(normalizePlayableSkillLevels, queueAttendanceStatus, (member) => member?.nickname || member?.display_name || "Unknown");

test("actual dashboard mapper hides stale waiting rows but preserves current game and historical names", () => {
  const ids = ["departed", "unchecked", "withdrawn", "present", "playing"];
  const dashboard = {
    members: ids.map((id) => ({ id, nickname: id, skill_level: "N" })),
    signups: ids.map((member_id) => ({ member_id, status: member_id === "withdrawn" ? "cancelled" : "coming", skill_level_snapshot: "N" })),
    attendance: ids.map((member_id) => ({ member_id, arrived: member_id !== "unchecked", left_at: ["departed", "playing"].includes(member_id) ? "00:30" : null })),
    queuePlayers: ids.map((member_id) => ({ member_id, status: member_id === "playing" ? "playing" : member_id === "departed" ? "reserved" : "waiting" })),
    queueMatches: [{ id: "upcoming", status: "approved", queue_position: 1 }, { id: "current-game", status: "playing", court_id: "court" }, { id: "history", status: "completed" }],
    queueMatchPlayers: [{ match_id: "upcoming", member_id: "departed", team: "A", position: 1 }, { match_id: "current-game", member_id: "playing", team: "A", position: 1 }, { match_id: "history", member_id: "departed", team: "A", position: 1 }],
  };
  const original = structuredClone(dashboard);
  const queue = mapQueueDashboard(dashboard);
  assert.deepEqual(queue.players.map((player) => player.status), ["left", "left", "left", "waiting", "playing"]);
  const state = buildQueuePlanningState(queue.players, queue.matches.filter((match) => match.status === "approved"));
  assert.deepEqual(state.visibleWaiting.map((player) => player.memberId), ["present"]);
  assert.deepEqual(state.availableWaiting.map((player) => player.memberId), ["present"]);
  assert.equal(state.proposalPlayers.find((player) => player.memberId === "departed").status, "left");
  assert.equal(queue.matches.find((match) => match.id === "current-game").players[0].name, "playing");
  assert.equal(queue.matches.find((match) => match.id === "history").players[0].name, "departed");
  assert.deepEqual(dashboard, original);
});

test("upcoming membership cannot resurrect left players in waiting lists or proposals", () => {
  const left = { memberId: "departed", status: "left" };
  const state = buildQueuePlanningState([left], [{ id: "queue", status: "approved", queuePosition: 1, players: [{ memberId: "departed" }] }]);
  assert.deepEqual(state.visibleWaiting, []);
  assert.deepEqual(state.availableWaiting, []);
  assert.equal(state.proposalPlayers[0], left);
  assert.equal(state.queuePositionsByMember.get("departed"), 1);
});
