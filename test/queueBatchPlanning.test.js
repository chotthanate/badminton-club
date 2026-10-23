import test from "node:test";
import assert from "node:assert/strict";
import { planQueueDrafts } from "../src/queueBatchPlanning.js";

test("large automatic batch yields between queues and never repeats players", async () => {
  const players = Array.from({ length: 200 }, (_, index) => ({ memberId: String(index).padStart(3, "0"), name: String(index), status: "waiting", skillLevel: "N", queuedAt: new Date(Date.UTC(2026, 9, 24, 0, index)).toISOString() }));
  let yields = 0;
  const progress = [];
  const result = await planQueueDrafts({ players, onProgress: (value) => progress.push(value.completed), yieldControl: async () => { yields += 1; } });
  assert.equal(result.lineups.length, 50);
  assert.equal(yields, 50);
  assert.equal(progress.at(-1), 50);
  assert.equal(new Set(result.lineups.flatMap((lineup) => lineup.memberIds)).size, 200);
  assert.deepEqual(result.lineups[0].memberIds, ["000", "001", "002", "003"]);
});

test("batch stops at an unfillable oldest anchor and explains why", async () => {
  const players = ["P", "N", "N", "N", "N"].map((skillLevel, index) => ({ memberId: String(index), name: `คน${index}`, status: "waiting", skillLevel, queuedAt: new Date(Date.UTC(2026, 9, 24, 0, index)).toISOString() }));
  const result = await planQueueDrafts({ players });
  assert.equal(result.lineups.length, 0);
  assert.match(result.reason, /คน0/);
});
