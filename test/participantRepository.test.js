import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Exercise the actual repository function with isolated dependencies. Loading
// the complete browser module in Node would initialize the real Supabase client.
const source = readFileSync(new URL("../src/clubRepository.js", import.meta.url), "utf8");
const participantFunction = source.match(/export async function loadParticipantState\(clubId, eventId\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(participantFunction, "participant state loader is present");
const makeLoader = new Function("loadFinanceState", "client", "throwIfError",
  `${participantFunction.replace("export ", "")}\nreturn loadParticipantState;`);

function fixture({ data = [], error = null, financeError = null } = {}) {
  const reads = [];
  const finance = { members: [{ id: "fixture-member" }], payments: [{ id: "fixture-bill" }], duplicateDismissals: [{ signature: "old" }] };
  const load = makeLoader(async (clubId, eventId) => {
    reads.push(["finance", clubId, eventId]);
    if (financeError) throw financeError;
    return finance;
  }, () => ({ from(table) { reads.push(["table", table]); return {
    select(columns) { reads.push(["columns", columns]); return {
      eq(column, value) { reads.push(["filter", column, value]); return Promise.resolve({ data, error }); },
    }; },
  }; } }), (nextError) => { if (nextError) throw nextError; });
  return { load, reads, finance };
}

test("participant refresh includes current club-scoped duplicate dismissals and complete finance", async () => {
  const { load, reads, finance } = fixture({ data: [{ signature: "dismissed-pair" }] });
  const result = await load("fixture-club", "fixture-event");
  assert.deepEqual(result.duplicateDismissals, [{ signature: "dismissed-pair" }]);
  assert.equal(result.payments, finance.payments);
  assert.equal(result.members, finance.members);
  assert.deepEqual(reads, [["finance", "fixture-club", "fixture-event"], ["table", "member_duplicate_dismissals"], ["columns", "signature"], ["filter", "club_id", "fixture-club"]]);
});

test("empty dismissal results clear an older local dismissal snapshot", async () => {
  assert.deepEqual((await fixture({ data: null }).load("fixture-club", "fixture-event")).duplicateDismissals, []);
});

test("participant refresh does not report success with a failed dismissal or finance read", async () => {
  await assert.rejects(fixture({ error: new Error("dismissals unavailable") }).load("fixture-club", "fixture-event"), /dismissals unavailable/);
  await assert.rejects(fixture({ financeError: new Error("finance unavailable") }).load("fixture-club", "fixture-event"), /finance unavailable/);
});
