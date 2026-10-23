import test from "node:test";
import assert from "node:assert/strict";
import { createMutationQueue } from "../src/mutationQueue.js";
import { PostCommitAuditError, runMutationLifecycle, writePostCommitAudit } from "../src/mutationOutcome.js";

function mutationHarness(action, refresh = async () => {}) {
  const state = { draft: "กรอกไว้", savedWarnings: [], errors: [], refreshErrors: [] };
  return {
    state,
    async save() {
      const saved = await runMutationLifecycle({
        action,
        refresh,
        onSaved: (warning) => state.savedWarnings.push(warning),
        onError: (error) => state.errors.push(error),
        onRefreshError: (error, auditWarning) => state.refreshErrors.push({ error, auditWarning }),
      });
      // The same success contract used by add-player, profile, bill and expense forms.
      if (saved) state.draft = null;
      return saved;
    },
  };
}

test("successful write and refresh clear the saved form exactly once", async () => {
  const calls = [];
  const harness = mutationHarness(async () => {
    calls.push("write");
    await writePostCommitAudit(async () => {
      calls.push("audit");
      return { error: null };
    });
  }, async () => calls.push("refresh"));
  assert.equal(await harness.save(), true);
  assert.deepEqual(calls, ["write", "audit", "refresh"]);
  assert.equal(harness.state.draft, null);
  assert.deepEqual(harness.state.savedWarnings, [""]);
});

test("returned Supabase audit failure carries an explicit committed marker and cause", async () => {
  const cause = { code: "42501", message: "audit insert denied" };
  await assert.rejects(writePostCommitAudit(async () => ({ error: cause })), (error) => {
    assert.ok(error instanceof PostCommitAuditError);
    assert.equal(error.code, "POST_COMMIT_AUDIT_FAILED");
    assert.equal(error.committed, true);
    assert.equal(error.cause, cause);
    return true;
  });
});

test("thrown or synchronous audit failures carry the same committed marker", async () => {
  for (const writeAudit of [
    async () => { throw new TypeError("network disconnected"); },
    () => { throw new Error("client unavailable"); },
  ]) {
    await assert.rejects(writePostCommitAudit(writeAudit), PostCommitAuditError);
  }
});

test("primary-write failure retains the form and does not refresh or claim success", async () => {
  const cause = new Error("write rejected");
  let refreshCount = 0;
  const harness = mutationHarness(async () => { throw cause; }, async () => { refreshCount += 1; });
  assert.equal(await harness.save(), false);
  assert.equal(harness.state.draft, "กรอกไว้");
  assert.equal(refreshCount, 0);
  assert.deepEqual(harness.state.errors, [cause]);
  assert.deepEqual(harness.state.savedWarnings, []);
});

test("audit failure warns, refreshes and clears the committed form instead of inviting retry", async () => {
  for (const audit of [
    async () => ({ error: new Error("audit rejected") }),
    async () => { throw new Error("audit offline"); },
  ]) {
    let writeCount = 0;
    let refreshCount = 0;
    const harness = mutationHarness(async () => {
      writeCount += 1;
      await writePostCommitAudit(audit);
    }, async () => { refreshCount += 1; });
    assert.equal(await harness.save(), true);
    assert.equal(writeCount, 1);
    assert.equal(refreshCount, 1);
    assert.equal(harness.state.draft, null);
    assert.match(harness.state.savedWarnings[0], /บันทึกข้อมูลแล้ว/);
    assert.match(harness.state.savedWarnings[0], /ไม่ต้องกดบันทึกซ้ำ/);
    assert.deepEqual(harness.state.errors, []);
  }
});

test("refresh failure after committed write is reported separately and still clears the form", async () => {
  const refreshError = new Error("refresh offline");
  let writeCount = 0;
  const harness = mutationHarness(async () => { writeCount += 1; }, async () => { throw refreshError; });
  assert.equal(await harness.save(), true);
  assert.equal(writeCount, 1);
  assert.equal(harness.state.draft, null);
  assert.deepEqual(harness.state.errors, []);
  assert.deepEqual(harness.state.refreshErrors, [{ error: refreshError, auditWarning: "" }]);
});

test("audit and refresh failures preserve both warnings without repeating the primary write", async () => {
  let writeCount = 0;
  const refreshError = new Error("refresh offline");
  const harness = mutationHarness(async () => {
    writeCount += 1;
    await writePostCommitAudit(async () => ({ error: new Error("audit rejected") }));
  }, async () => { throw refreshError; });
  assert.equal(await harness.save(), true);
  assert.equal(writeCount, 1);
  assert.equal(harness.state.draft, null);
  assert.equal(harness.state.refreshErrors[0].error, refreshError);
  assert.equal(harness.state.refreshErrors[0].auditWarning, harness.state.savedWarnings[0]);
});

test("audit failures neither duplicate pending taps nor drop the next independent queued action", async () => {
  const queue = createMutationQueue();
  const writes = [];
  const refreshes = [];
  const first = mutationHarness(async () => {
    writes.push("first");
    await writePostCommitAudit(async () => ({ error: new Error("audit failed") }));
  }, async () => refreshes.push("first"));
  const second = mutationHarness(async () => writes.push("second"), async () => refreshes.push("second"));
  const a = queue.enqueue("member:first", first.save);
  assert.equal(queue.enqueue("member:first", first.save), a);
  const b = queue.enqueue("member:second", second.save);
  assert.deepEqual(await Promise.all([a, b]), [true, true]);
  assert.deepEqual(writes, ["first", "second"]);
  assert.deepEqual(refreshes, ["first", "second"]);
  assert.equal(first.state.draft, null);
  assert.equal(second.state.draft, null);
  assert.equal(queue.size, 0);
});

test("ordinary errors cannot masquerade as committed writes through a code property alone", async () => {
  const error = Object.assign(new Error("primary write failed"), { code: "POST_COMMIT_AUDIT_FAILED", committed: true });
  const harness = mutationHarness(async () => { throw error; });
  assert.equal(await harness.save(), false);
  assert.equal(harness.state.draft, "กรอกไว้");
  assert.deepEqual(harness.state.errors, [error]);
});
