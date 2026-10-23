import test from "node:test";
import assert from "node:assert/strict";
import { createMutationQueue } from "../src/mutationQueue.js";

test("rapid independent writes run in order and none are lost", async () => {
  const calls = [];
  const counts = [];
  const queue = createMutationQueue((keys) => counts.push(keys.length));
  const tasks = [1, 2, 3].map((id) => queue.enqueue(`member:${id}`, async () => {
    calls.push(id);
    await Promise.resolve();
    return id;
  }));
  assert.equal(queue.size, 3);
  assert.deepEqual(await Promise.all(tasks), [1, 2, 3]);
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(counts.at(-1), 0);
});
test("duplicate pending taps execute once, but a later intentional tap can run", async () => {
  const queue = createMutationQueue();
  let count = 0;
  const action = () => ++count;
  const first = queue.enqueue("water:add:1", action);
  assert.equal(queue.enqueue("water:add:1", action), first);
  await first;
  await queue.enqueue("water:add:1", action);
  assert.equal(count, 2);
});
test("failure releases the lock and later work still executes", async () => {
  const queue = createMutationQueue();
  const bad = queue.enqueue("one", () => { throw new Error("offline"); });
  const good = queue.enqueue("two", () => true);
  await assert.rejects(bad, /offline/);
  assert.equal(await good, true);
  assert.equal(queue.size, 0);
});
