import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrations = [
  "supabase/migrations/20260905144443_scope_playing_queue_to_current_event.sql",
  "supabase/migrations/20260905145535_finalize_queue_state_before_event_close.sql",
];

test("starting a queue only considers playing matches from the current event", () => {
  const sql = readFileSync(migrations[0], "utf8");

  assert.match(sql, /playing\.event_id\s*=\s*target_event_id/i);
  assert.match(sql, /match\.event_id\s*=\s*target_event_id/i);
  assert.match(sql, /where event_id\s*=\s*target_event_id\s+and court_id\s*=\s*target_court_id/i);
});

test("closing a round atomically finishes games, cancels queues and releases players", () => {
  const sql = readFileSync(migrations[1], "utf8");

  assert.match(sql, /perform public\.finish_queue_match\(playing_match_id\)/i);
  assert.match(sql, /status\s*=\s*'cancelled'/i);
  assert.match(sql, /update public\.event_queue_players[\s\S]*status\s*=\s*'left'/i);
  assert.match(sql, /before update of status on public\.events/i);
});

test("finishing a game refreshes only queue state before the next full dashboard poll", () => {
  const app = readFileSync("src/BadmintonApp.jsx", "utf8");
  const queuePanel = readFileSync("src/QueuePanel.jsx", "utf8");
  const repository = readFileSync("src/clubRepository.js", "utf8");

  assert.match(repository, /export async function loadQueueState\(eventId\)/);
  assert.match(app, /finishQueueMatch\(match\.id\)[\s\S]{0,160}refreshQueueOnly:\s*true/);
  assert.match(queuePanel, /finishQueueMatch\(match\.id\)[\s\S]{0,160}refreshQueueOnly:\s*true/);
});
