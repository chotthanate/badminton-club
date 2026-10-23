import test from "node:test";
import assert from "node:assert/strict";
import { filterParticipants } from "../src/participantFilters.js";
const rows = [
  { member: { nickname: "A", display_name: "Alpha" } },
  { member: { nickname: "B", aliases: ["Bee"] }, attendance: { checkedIn: true } },
  { member: { nickname: "C" }, attendance: { arrived: true, left_at: "20:00" } },
];
test("not-arrived excludes both present and already departed; present excludes no-shows", () => {
  assert.deepEqual(filterParticipants(rows, "", "not-arrived"), [rows[0]]);
  assert.deepEqual(filterParticipants(rows, "", "present"), [rows[1]]);
  assert.equal(filterParticipants(rows, "", "all").length, 3);
});
test("roster searches names and aliases independently of adding a member", () => {
  assert.deepEqual(filterParticipants(rows, "ALPHA"), [rows[0]]);
  assert.deepEqual(filterParticipants(rows, "Bee", "present"), [rows[1]]);
  assert.deepEqual(filterParticipants(rows, "Bee", "not-arrived"), []);
});
