import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildSync } from "esbuild";

// Execute production Edge handlers with in-memory query builders and a local
// LINE-token verifier response. No database, LINE, or other network is called.
const edgeDirectory = fileURLToPath(new URL("../supabase/functions/line-bot/", import.meta.url));
const source = readFileSync(new URL("../supabase/functions/line-bot/index.ts", import.meta.url), "utf8");
const compiled = buildSync({ stdin: { contents: `${source}\nexport { handleLiffRequest, handleLiveQueueRequest, getLiffRoster };`, resolveDir: edgeDirectory, loader: "ts" }, bundle: true, format: "cjs", platform: "node", external: ["npm:@supabase/supabase-js@2"], write: false }).outputFiles[0].text;
const event = { id: "round", club_id: "club", event_date: "2099-01-01", starts_at: "21:00:00", ends_at: "01:00:00", status: "open", clubs: { name: "Local club" }, event_courts: [] };
const self = { id: "self", club_id: "club", role: "member", active: true, line_user_id: "verified-user", nickname: "ตัวเอง", display_name: "Self LINE", skill_level: "N", playable_skill_levels: ["N"] };
const removed = { event_id: "round", member_id: "self", status: "coming", removed_at: "2026-10-25T00:00:00Z", arrival_time: "21:15:00", skill_level_snapshot: "N", created_at: "2026-10-24T00:00:00Z" };

function edgeHarness(extra = {}, invalidToken = false) {
  const tables = { events: [structuredClone(event)], club_members: [structuredClone(self)], signups: [structuredClone(removed)], attendance: [], event_queue_players: [], queue_matches: [], queue_match_players: [], event_courts: [], member_extra_charges: [], ...structuredClone(extra) };
  const writes = [], reads = [];
  const admin = { from(table) {
    let mode = "select", value, single = false, head = false, cap = Infinity;
    const filters = [];
    const query = {
      select(fields, options) { head = Boolean(options?.head); return query; },
      eq(key, expected) { filters.push((row) => row[key] === expected); return query; },
      is(key, expected) { filters.push((row) => (row[key] ?? null) === expected); return query; },
      in(key, expected) { filters.push((row) => expected.includes(row[key])); return query; },
      order() { return query; }, limit(count) { cap = count; return query; },
      maybeSingle() { single = true; return query; }, single() { single = true; return query; },
      insert(next) { mode = "insert"; value = next; return query; },
      update(next) { mode = "update"; value = next; return query; },
      upsert(next) { mode = "upsert"; value = next; return query; },
      delete() { mode = "delete"; return query; },
      then(resolve, reject) {
        try {
          const rows = (tables[table] || []).filter((row) => filters.every((filter) => filter(row))).slice(0, cap);
          if (mode !== "select") {
            writes.push({ table, mode, value });
            if (mode === "delete") tables[table] = tables[table].filter((row) => !rows.includes(row));
            else if (mode === "update") rows.forEach((row) => Object.assign(row, value));
            else if (mode === "insert") (tables[table] ||= []).push({ id: "created", ...value });
          } else reads.push(table);
          return Promise.resolve({ data: head ? null : structuredClone(single ? rows[0] || null : rows), error: null, count: rows.length }).then(resolve, reject);
        } catch (error) { return Promise.reject(error).then(resolve, reject); }
      },
    };
    return query;
  } };
  const module = { exports: {} };
  const deno = { serve() {}, env: { get: (key) => key === "LINE_CLUB_ID" ? "club" : "local-placeholder" } };
  const fetch = async () => ({ ok: !invalidToken, json: async () => invalidToken ? {} : { sub: "verified-user", name: "Self LINE" } });
  new Function("require", "module", "exports", "Deno", "fetch", "console", compiled)(() => ({ createClient: () => admin }), module, module.exports, deno, fetch, { error() {} });
  const payload = { idToken: "local-fake-token", eventId: "round", nickname: "ตัวเอง", status: "coming", arrivalTime: "21:30", skillLevel: "N", playableSkillLevels: ["N"] };
  return { ...module.exports, tables, writes, reads, admin, request: (action, extraPayload = {}) => module.exports.handleLiffRequest({ ...payload, action, ...extraPayload }) };
}

test("removed LIFF member is not shown as coming or in stale queue on reopening", async () => {
  const fixture = edgeHarness({ event_queue_players: [{ event_id: "round", member_id: "self", status: "waiting" }] });
  const response = await fixture.request("get_liff_event");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.currentStatus, null);
  assert.equal(body.currentArrivalTime, null);
  assert.equal(body.queue, null);
  assert.deepEqual(body.roster.coming, []);
  assert.deepEqual(fixture.writes, []);
});

for (const action of ["submit_liff_signup", "cancel_liff_signup"]) test(`${action} cannot overwrite or delete a removed player's history`, async () => {
  const fixture = edgeHarness();
  const before = structuredClone(fixture.tables.signups);
  const response = await fixture.request(action);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /แจ้งแอดมิน/);
  assert.deepEqual(fixture.writes, []);
  assert.deepEqual(fixture.tables.signups, before);
});

test("guest submission cannot silently restore the same removed identity", async () => {
  const guest = { ...self, id: "guest", line_user_id: null, nickname: "เพื่อน", display_name: "Guest LINE" };
  const fixture = edgeHarness({ club_members: [self, guest], signups: [{ ...removed, member_id: "guest" }] });
  const response = await fixture.request("submit_liff_guest", { guestName: "เพื่อน" });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /แจ้งแอดมิน/);
  assert.deepEqual(fixture.writes, []);
});

test("explicit profile edits do not change removed signup skill snapshots", async () => {
  const fixture = edgeHarness();
  const before = structuredClone(fixture.tables.signups);
  const response = await fixture.request("save_liff_profile", { skillLevel: "BG", playableSkillLevels: ["BG"] });
  assert.equal(response.status, 200);
  assert.ok(fixture.writes.some((row) => row.table === "club_members"));
  assert.ok(!fixture.writes.some((row) => row.table === "signups"));
  assert.deepEqual(fixture.tables.signups, before);
});

test("public roster excludes removed identities while preserving active signup order", async () => {
  const fixture = edgeHarness({ club_members: [self, { ...self, id: "active", nickname: "ยังอยู่" }], signups: [removed, { ...removed, member_id: "active", removed_at: null }] });
  const roster = await fixture.getLiffRoster(fixture.admin, event);
  assert.deepEqual(roster.coming.map((row) => row.name), ["ยังอยู่"]);
  assert.equal(roster.coming[0].signupOrder, 1);
});

test("live waiting needs active signup and present attendance even with stale waiting status", async () => {
  const ids = ["active", "departed", "absent", "removed", "unsigned"];
  const fixture = edgeHarness({
    club_members: ids.map((id) => ({ ...self, id, nickname: id })),
    signups: ids.filter((id) => id !== "unsigned").map((id) => ({ ...removed, member_id: id, removed_at: id === "removed" ? "now" : null })),
    attendance: ids.map((id) => ({ event_id: "round", member_id: id, arrived: id !== "absent", left_at: id === "departed" ? "00:15" : null })),
    event_queue_players: ids.map((id) => ({ event_id: "round", member_id: id, status: "waiting" })),
  });
  const response = await fixture.handleLiveQueueRequest({ eventId: "round" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.waiting.flatMap((group) => group.players.map((player) => player.nickname)), ["active"]);
  assert.deepEqual(fixture.writes, []);
});

test("normal unchecked pregame cancellation still deletes only the active signup", async () => {
  const fixture = edgeHarness({ signups: [{ ...removed, removed_at: null }] });
  const response = await fixture.request("cancel_liff_signup");
  assert.equal(response.status, 200);
  assert.deepEqual(fixture.tables.signups, []);
  assert.equal(fixture.writes.filter((row) => row.table === "signups" && row.mode === "delete").length, 1);
});

test("invalid LINE identity fails before participant database reads or writes", async () => {
  const fixture = edgeHarness({}, true);
  const response = await fixture.request("submit_liff_signup");
  assert.equal(response.status, 401);
  assert.deepEqual(fixture.reads, []);
  assert.deepEqual(fixture.writes, []);
});
