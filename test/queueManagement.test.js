import assert from "node:assert/strict";
import test from "node:test";
import { queueVersionRequests, selectedUpcomingQueues } from "../src/queueManagement.js";

const players = ["a", "b", "c", "d"].map((memberId) => ({ memberId }));
const matches = [
  { id: "draft", status: "draft", revision: 4, players },
  { id: "approved", status: "approved", revision: 8, players },
  { id: "playing", status: "playing", revision: 9, players },
  { id: "cancelled", status: "cancelled", revision: 5, players },
  { id: "incomplete", status: "draft", revision: 1, players: players.slice(0, 3) },
];

test("manage selection includes draft and approved but never live or removed queues", () => {
  const selected = selectedUpcomingQueues(matches, ["draft", "approved", "playing", "cancelled", "deleted"]);
  assert.deepEqual(selected.map((match) => match.id), ["draft", "approved"]);
});

test("delete confirmation holds exact target versions and does not expand to later new queues", () => {
  const targets = queueVersionRequests(selectedUpcomingQueues(matches, ["draft", "approved"]));
  assert.deepEqual(targets, [{ matchId: "draft", expectedVersion: 4 }, { matchId: "approved", expectedVersion: 8 }]);
  const changed = matches.map((match) => ({ ...match, revision: match.revision + 1 }));
  changed.push({ id: "new", status: "draft", revision: 1, players });
  assert.deepEqual(targets, [{ matchId: "draft", expectedVersion: 4 }, { matchId: "approved", expectedVersion: 8 }]);
});
