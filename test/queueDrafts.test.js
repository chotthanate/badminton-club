import test from "node:test";
import assert from "node:assert/strict";
import { hasUnsavedQueueWork, queueDraftConflicts, queueLineupSignature, readQueueWork, toggleQueueSelection, writeQueueWork } from "../src/queueDrafts.js";

function storage() { const values = new Map(); return { get length() { return values.size; }, key: (index) => [...values.keys()][index], getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }; }

test("queue drafts survive reload and stay isolated by event and queue", () => {
  const local = storage();
  writeQueueWork("one", "queue", { memberIds: ["a"], baseVersion: 3 }, local);
  assert.deepEqual(readQueueWork("one", "queue", local).memberIds, ["a"]);
  assert.equal(readQueueWork("two", "queue", local), null);
  assert.equal(readQueueWork("one", "other", local), null);
  assert.equal(hasUnsavedQueueWork("one", local), true);
  writeQueueWork("one", "queue", null, local);
  assert.equal(hasUnsavedQueueWork("one", local), false);
});

test("selection is capped at four, can unselect, and never duplicates", () => {
  assert.deepEqual(toggleQueueSelection(["a", "b", "c", "d"], "e"), ["a", "b", "c", "d"]);
  assert.deepEqual(toggleQueueSelection(["a", "b", "c", "d"], "b"), ["a", "c", "d"]);
  assert.deepEqual(toggleQueueSelection(["a", "c", "d"], "e"), ["a", "c", "d", "e"]);
});

test("remote revisions and lineup changes conflict with a saved local draft", () => {
  const match = { revision: 7, players: [{ memberId: "a", team: "A", position: 1 }] };
  const draft = { baseVersion: 7, baseSignature: queueLineupSignature(match.players) };
  assert.equal(queueDraftConflicts(draft, match), false);
  assert.equal(queueDraftConflicts(draft, { ...match, revision: 8 }), true);
  assert.equal(queueDraftConflicts(draft, { ...match, players: [{ memberId: "b", team: "A", position: 1 }] }), true);
});

test("disabled local storage does not crash the picker", () => {
  const unavailable = { getItem() { throw new Error("disabled"); }, setItem() { throw new Error("disabled"); } };
  assert.equal(readQueueWork("one", "queue", unavailable), null);
  assert.equal(writeQueueWork("one", "queue", {}, unavailable), false);
});
