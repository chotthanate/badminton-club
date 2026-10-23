import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrations = [
  "supabase/migrations/20260905144443_scope_playing_queue_to_current_event.sql",
  "supabase/migrations/20260905145535_finalize_queue_state_before_event_close.sql",
  "supabase/migrations/20260907091643_queue_four_slots_fairness_and_undo.sql",
  "supabase/migrations/20260918151337_fallback_queue_drafts.sql",
  "supabase/migrations/20261003203503_remove_upcoming_queue_limit.sql",
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
  assert.match(queuePanel, /refreshQueueOnly:\s*true/);
});

test("latest queue migration removes the arbitrary queue cap and keeps batch creation transactional", () => {
  const sql = readFileSync(migrations[4], "utf8");

  assert.match(sql, /create or replace function public\.create_queue_drafts_batch/i);
  assert.match(sql, /perform pg_advisory_xact_lock\(hashtext\(target_event_id::text\)\)/i);
  assert.doesNotMatch(sql, /สูงสุด 4 คิว|requested_count\s*>\s*4|\)\s*>=\s*4/i);
  assert.match(sql, /revoke all on function public\.create_queue_drafts_batch\(uuid, jsonb\) from public, anon/i);
});

test("cross-queue edits swap players and an accidental start can return to queue one", () => {
  const sql = readFileSync(migrations[2], "utf8");

  assert.match(sql, /แก้รายชื่อหรือสลับผู้เล่นข้ามคิว/);
  assert.match(sql, /create or replace function public\.return_playing_queue_to_head/i);
  assert.match(sql, /set status = 'approved', court_id = null, queue_position = 1,[\s\S]*started_at = null/i);
  assert.doesNotMatch(sql, /return_playing_queue_to_head[\s\S]*games_played\s*=\s*games_played\s*\+/i);
});

test("queue screen allows every available future queue", () => {
  const queuePanel = readFileSync("src/QueuePanel.jsx", "utf8");

  assert.doesNotMatch(queuePanel, /MAX_UPCOMING_QUEUES|สูงสุด 4 คิว/);
  assert.match(queuePanel, /Math\.floor\(availableWaiting\.length \/ 4\)/);
  assert.match(queuePanel, /สร้าง 1 คิว/);
  assert.match(queuePanel, /สร้างทั้งหมด/);
  assert.match(queuePanel, /returnPlayingQueueToHead/);
});

test("queue picker uses a scrollable modal above the page", () => {
  const queuePanel = readFileSync("src/QueuePanel.jsx", "utf8");
  const styles = readFileSync("src/queue-improvements.css", "utf8");
  assert.match(queuePanel, /aria-modal="true"/);
  assert.match(queuePanel, /createPortal/);
  assert.match(styles, /\.queue-modal-backdrop\s*\{[^}]*position:\s*fixed/s);
  assert.match(styles, /\.queue-modal-body\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /\.queue-modal-body\s*\{[^}]*touch-action:\s*pan-y/s);
});

test("players remain marked as playing when their court booking expires", () => {
  const queuePanel = readFileSync("src/QueuePanel.jsx", "utf8");
  const statusMap = queuePanel.slice(queuePanel.indexOf("const playingCourtByMember"), queuePanel.indexOf("const upcoming ="));
  assert.match(statusMap, /playingMatches\.flatMap/);
  assert.match(statusMap, /match\.players\.map/);
  assert.doesNotMatch(statusMap, /courtTimeStatus|expired/);
});

test("cancelling an upcoming queue always asks for confirmation", () => {
  const queuePanel = readFileSync("src/QueuePanel.jsx", "utf8");

  assert.match(queuePanel, /window\.confirm\(`ยกเลิกคิว \$\{position\} ใช่ไหม\?/);
  assert.match(queuePanel, /onClick=\{\(\) => cancelUpcomingQueue\(match, index \+ 1\)\}/);
});

test("fallback draft is atomic, stays unapproved, and does not grant anonymous execution", () => {
  const sql = readFileSync(migrations[3], "utf8");
  assert.match(sql, /created_id := public\.create_manual_queue_draft\(target_event_id\)/);
  assert.match(sql, /perform public\.update_manual_queue_draft_lineup\(created_id, assignments\)/);
  assert.match(sql, /revoke all on function public\.create_fallback_queue_draft[\s\S]*from public, anon/i);
  assert.doesNotMatch(sql, /approve_queue_draft/);
});
