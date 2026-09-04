import test from "node:test";
import assert from "node:assert/strict";
import { buildQueuePlanningState } from "../src/queuePlanning.js";

const player = (memberId, status, queuedAt = "2026-09-04T12:00:00Z") => ({
  memberId, status, queuedAt, gamesPlayed: 0, minutesPlayed: 0,
});

test("คนในคิวร่างยังแสดงในคิวรอ แต่ไม่ถูกเลือกซ้ำโดยคิวอัตโนมัติ", () => {
  const state = buildQueuePlanningState([
    player("draft-player", "waiting"),
    player("free-player", "waiting"),
  ], [{ id: "draft-2", status: "draft", queuePosition: 2, players: [{ memberId: "draft-player" }] }]);

  assert.deepEqual(state.visibleWaiting.map((entry) => entry.memberId), ["draft-player", "free-player"]);
  assert.deepEqual(state.availableWaiting.map((entry) => entry.memberId), ["free-player"]);
  assert.equal(state.proposalPlayers.find((entry) => entry.memberId === "draft-player").status, "reserved");
  assert.equal(state.draftPositionsByMember.get("draft-player"), 2);
});

test("ผู้เล่นในสนามเลือกเข้าคิวถัดไปได้ แต่เลือกซ้ำในคิวอื่นไม่ได้", () => {
  const state = buildQueuePlanningState([
    player("playing-free", "playing"),
    player("playing-booked", "playing"),
  ], [{ id: "draft-2", status: "draft", queuePosition: 2, players: [{ memberId: "playing-booked" }] }]);

  assert.deepEqual(state.availablePlaying.map((entry) => entry.memberId), ["playing-free"]);
  assert.equal(state.unavailableForMatch("draft-3").has("playing-booked"), true);
  assert.equal(state.unavailableForMatch("draft-2").has("playing-booked"), false);
});

test("รองรับหลายคิวร่างและระบุตำแหน่งของแต่ละคนได้", () => {
  const state = buildQueuePlanningState([
    player("a", "waiting"), player("b", "waiting"), player("c", "waiting"),
  ], [
    { id: "draft-2", status: "draft", queuePosition: 2, players: [{ memberId: "a" }] },
    { id: "draft-3", status: "draft", queuePosition: 3, players: [{ memberId: "b" }] },
  ]);

  assert.equal(state.draftPositionsByMember.get("a"), 2);
  assert.equal(state.draftPositionsByMember.get("b"), 3);
  assert.deepEqual(state.availableWaiting.map((entry) => entry.memberId), ["c"]);
});
