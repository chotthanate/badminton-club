import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Extract the real functions without initializing the production browser client.
const source = readFileSync(new URL("../src/clubRepository.js", import.meta.url), "utf8");
function repositoryFunction(name, client, extraDependencies = {}) {
  const body = source.match(new RegExp(`export async function ${name}\\([\\s\\S]*?\\n\\}`))?.[0];
  assert.ok(body, name);
  return new Function("client", "throwIfError", ...Object.keys(extraDependencies), `${body.replace("export ", "")}\nreturn ${name};`)(() => client, (error) => { if (error) throw error; }, ...Object.values(extraDependencies));
}

test("directory archival calls the guarded server operation once, not a direct delete/update", async () => {
  const calls = [];
  const archive = repositoryFunction("archiveClubMember", {
    rpc: async (...args) => { calls.push(args); return { data: "member-one", error: null }; },
    from: () => { throw new Error("Direct table writes are not allowed"); },
  });
  assert.equal(await archive("member-one"), "member-one");
  assert.deepEqual(calls, [["archive_club_member", { target_member_id: "member-one" }]]);
});

function resetHarness({ club = { id: "test-club", is_test: true }, error = null } = {}) {
  const calls = [];
  const api = { from(table) {
    calls.push(["from", table]);
    return {
      select(columns) { calls.push(["select", columns]); return { eq(column, value) { calls.push(["filter", column, value]); return { single: async () => ({ data: club, error }) }; } }; },
      delete() {
        calls.push(["delete", table]);
        const query = { eq(column, value) { calls.push(["deleteFilter", table, column, value]); return query; }, then(resolve) { return Promise.resolve({ error: null }).then(resolve); } };
        return query;
      },
    };
  } };
  const reset = repositoryFunction("resetTestClub", api, {
    seedDefaultExtraItems: async (id) => calls.push(["seed-items", id]),
    seedTestMembers: async (id) => calls.push(["seed-members", id]),
  });
  return { reset, calls };
}

test("test reset refuses real, unknown, mismatched or unverified clubs before any deletion", async () => {
  for (const state of [
    { club: { id: "test-club", is_test: false } }, { club: null },
    { club: { id: "other-club", is_test: true } }, { club: { id: "test-club", is_test: "true" } },
    { error: new Error("club read failed") },
  ]) {
    const { reset, calls } = resetHarness(state);
    await assert.rejects(reset("test-club"));
    assert.deepEqual(calls, [["from", "clubs"], ["select", "id, is_test"], ["filter", "id", "test-club"]]);
  }
});

test("verified sandbox reset keeps every destructive query scoped to that same club", async () => {
  const { reset, calls } = resetHarness();
  await reset("test-club");
  assert.deepEqual(calls.slice(0, 3), [["from", "clubs"], ["select", "id, is_test"], ["filter", "id", "test-club"]]);
  const tables = ["events", "club_members", "club_venues", "extra_item_catalog"];
  assert.deepEqual(calls.filter(([kind]) => kind === "delete").map(([, table]) => table), tables);
  for (const table of tables) assert.ok(calls.some(([kind, target, field, value]) => kind === "deleteFilter" && target === table && field === "club_id" && value === "test-club"));
  assert.ok(calls.some(([kind, table, field, value]) => kind === "deleteFilter" && table === "club_members" && field === "role" && value === "member"));
});

test("directory archival propagates active-round or permission failures to the caller", async () => {
  const error = new Error("ยังลบไม่ได้ ผู้เล่นมีชื่อในรอบที่ยังไม่จบ");
  const archive = repositoryFunction("archiveClubMember", { rpc: async () => ({ data: null, error }) });
  await assert.rejects(archive("member-one"), (actual) => actual === error);
});

test("attendance writes keep a zero percentage without defaulting it to 100", async () => {
  const calls = [];
  const update = repositoryFunction("updateAttendance", { from: (table) => ({ upsert: async (...args) => { calls.push([table, ...args]); return { error: null }; } }) });
  await update({ clubId: "club", eventId: "event", memberId: "member", patch: { billing_percentage: 0 } });
  assert.deepEqual(calls, [["attendance", { club_id: "club", event_id: "event", member_id: "member", billing_percentage: 0 }, { onConflict: "event_id,member_id" }]]);
});

test("venue edits call one scoped RPC with no status, date, court or lineup patch", async () => {
  const calls=[];
  const update=repositoryFunction("updateEventVenue", { rpc: async (...args) => { calls.push(args); return {data:{id:"event",venue:"New venue",status:"open"},error:null}; } });
  const result=await update({clubId:"club",eventId:"event",venue:"  New venue  "});
  assert.deepEqual(calls, [["update_event_venue", {target_club_id:"club",target_event_id:"event",next_venue:"New venue"}]]);
  assert.equal(result.id,"event"); assert.equal(result.status,"open");
});

function draftDetailsHarness({ data = { id: "event" }, error = null } = {}) {
  const calls = [];
  const query = {
    update(patch) { calls.push(["update", patch]); return this; },
    eq(key, value) { calls.push(["eq", key, value]); return this; },
    select(columns) { calls.push(["select", columns]); return this; },
    maybeSingle: async () => ({ data, error }),
  };
  const update = repositoryFunction("updateEventDetails", {
    from(table) { calls.push(["from", table]); return query; },
  }, { rememberVenue: async (...args) => calls.push(["rememberVenue", ...args]) });
  return { update, calls };
}

test("draft date and venue update scopes the actual write to the same club and still-draft event", async () => {
  const { update, calls } = draftDetailsHarness();
  await update({ clubId: "club", eventId: "event", patch: { event_date: "2026-10-24", venue: "  Venue  ", status: "closed", court_hourly_rate: 0 } });
  assert.deepEqual(calls, [
    ["from", "events"], ["update", { event_date: "2026-10-24", venue: "Venue" }],
    ["eq", "id", "event"], ["eq", "club_id", "club"], ["eq", "status", "draft"],
    ["select", "id"], ["rememberVenue", "club", "Venue"],
  ]);
});

test("a draft that was opened, closed, removed or moved to another club rejects a stale detail save", async () => {
  const { update, calls } = draftDetailsHarness({ data: null });
  await assert.rejects(update({ clubId: "club", eventId: "event", patch: { event_date: "2026-10-24", venue: "Venue" } }), /ถูกเปิดหรือเปลี่ยนแปลง/);
  assert.ok(!calls.some(([kind]) => kind === "rememberVenue"));
  const error = new Error("write unavailable");
  const failed = draftDetailsHarness({ error });
  await assert.rejects(failed.update({ clubId: "club", eventId: "event", patch: { venue: "Venue" } }), (actual) => actual === error);
  assert.ok(!failed.calls.some(([kind]) => kind === "rememberVenue"));
});

test("finishing a round forwards zero shared amounts and personal extras unchanged", async () => {
  const calls = [];
  const finish = repositoryFunction("finishEvent", { rpc: async (...args) => { calls.push(args); return { data: "event", error: null }; } });
  await finish({ eventId: "event", shuttlecockCount: 0, rows: [{ memberId: "free", roundedDue: 15, sharedDue: 0, extraAmount: 15 }, { memberId: "zero", roundedDue: 0, sharedDue: 0, extraAmount: 0 }] });
  assert.deepEqual(calls, [["finish_event", { target_event_id: "event", final_shuttlecock_count: 0, settlement_rows: [
    { member_id: "free", amount: 15, shared_amount: 0, extras_amount: 15 },
    { member_id: "zero", amount: 0, shared_amount: 0, extras_amount: 0 },
  ] }]]);
});
