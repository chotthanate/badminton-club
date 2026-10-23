import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/clubRepository.js", import.meta.url), "utf8");
function repositoryAction(name, result = { data: "fixture-result", error: null }) {
  const start = source.indexOf(`export async function ${name}(`);
  const end = source.indexOf("\n}", start) + 2;
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const action = new Function("client", "throwIfError", `${source.slice(start, end).replace("export ", "")}\nreturn ${name};`)(
    () => ({ rpc: async (...args) => { calls.push(args); return result; } }),
    (error) => { if (error) throw error; },
  );
  return { action, calls };
}

for (const name of ["createQueueDraft", "createFallbackQueueDraft"]) {
  test(`${name} uses atomic ready-queue RPC without a second approval call`, async () => {
    const { action, calls } = repositoryAction(name);
    assert.equal(await action({ eventId: "fixture-event", memberIds: ["a", "b", "c", "d"], teamAIds: ["a", "b"] }), "fixture-result");
    assert.deepEqual(calls, [["create_automatic_queue", { target_event_id: "fixture-event", selected_member_ids: ["a", "b", "c", "d"], team_a_member_ids: ["a", "b"] }]]);
  });
}

test("automatic batch sends preserved lineup order and fallback flags to one atomic approval RPC", async () => {
  const { action, calls } = repositoryAction("createQueueDraftsBatch", { data: ["q1", "q2"], error: null });
  const lineups = [false, true].map((fallback, i) => ({ memberIds: [`${i}a`, `${i}b`, `${i}c`, `${i}d`], teamAIds: [`${i}a`, `${i}b`], fallback }));
  assert.deepEqual(await action({ eventId: "fixture-event", lineups }), ["q1", "q2"]);
  assert.deepEqual(calls, [["create_automatic_queues", { target_event_id: "fixture-event", queue_lineups: lineups.map((lineup) => ({ member_ids: lineup.memberIds, team_a_member_ids: lineup.teamAIds, fallback: lineup.fallback })) }]]);
});

test("a failed automatic transaction remains an error instead of returning a ready queue", async () => {
  const { action } = repositoryAction("createQueueDraft", { data: null, error: new Error("transaction rejected") });
  await assert.rejects(action({ eventId: "fixture-event", memberIds: [], teamAIds: [] }), /transaction rejected/);
});

test("reorder sends the selected queue ID and numeric up/down direction", async () => {
  const { action, calls } = repositoryAction("moveUpcomingQueue");
  await action("fixture-second", -1);
  await action("fixture-first", "1");
  assert.deepEqual(calls, [
    ["move_upcoming_queue", { target_match_id: "fixture-second", direction: -1 }],
    ["move_upcoming_queue", { target_match_id: "fixture-first", direction: 1 }],
  ]);
});

test("reorder preserves server failure instead of reporting success", async () => {
  const { action } = repositoryAction("moveUpcomingQueue", { data: null, error: new Error("รอบนี้ปิดแล้ว") });
  await assert.rejects(action("fixture-second", -1), /รอบนี้ปิดแล้ว/);
});
