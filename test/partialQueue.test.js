import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const queue = readFileSync(new URL("../src/QueuePanel.jsx", import.meta.url), "utf8");
const repository = readFileSync(new URL("../src/clubRepository.js", import.meta.url), "utf8");
const owner = readFileSync(new URL("../src/BadmintonApp.jsx", import.meta.url), "utf8");
const staff = readFileSync(new URL("../src/StaffParticipantsPanel.jsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261027042000_saved_partial_manual_queues.sql", import.meta.url), "utf8");

test("manual queue accepts one player but keeps court start gated at four", () => {
  assert.match(queue, /availableWaiting\.length \+ availablePlaying\.length < 1/);
  assert.match(queue, /selectedPlayers\.length < 1/);
  assert.match(queue, /upcoming\[0\]\.players\.length === 4/);
  assert.match(queue, /writeQueueWork\(eventId, workId, null\); setDirty\(false\); onClose\(\)/);
  assert.match(repository, /memberIds\.length === 4 \? "create_manual_queue" : "create_partial_manual_queue"/);
  assert.match(repository, /slots\.length === 4 \? "save_queue_lineup" : "save_partial_queue_lineup"/);
});

test("partial queue RPCs are authenticated, additive and preserve zero-player validation", () => {
  assert.match(migration, /player_count not between 1 and 3/);
  assert.match(migration, /status = 'approved'/);
  assert.match(migration, /expected_revision is null or target_match\.revision <> expected_revision/);
  assert.match(migration, /grant execute on function public\.create_partial_manual_queue[^\n]*to authenticated/);
  assert.match(migration, /grant execute on function public\.save_partial_queue_lineup[^\n]*to authenticated/);
  assert.doesNotMatch(migration, /update public\.events|delete from public\.signups|update public\.payments/);
});

test("owner and staff departure lists show only the clock time", () => {
  assert.match(owner, /departureOptions\.map\(\(time\) => <option key=\{time\} value=\{time\}>\{time\}<\/option>\)/);
  assert.match(staff, /departureOptions\.map\(\(time\) => <option key=\{time\} value=\{time\}>\{time\}<\/option>\)/);
});
