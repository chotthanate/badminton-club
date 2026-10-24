import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transformSync } from "esbuild";
import { compareCourtNames } from "../supabase/functions/_shared/paymentSummary.js";
import { sortBySignupOrder } from "../supabase/functions/_shared/signupOrder.js";

// Compile only real handlers/helpers; never execute Deno.serve or initialize a
// Supabase/LINE network client. Every possible table write is captured below.
const source = readFileSync(new URL("../supabase/functions/line-bot/index.ts", import.meta.url), "utf8");
const names = ["publishFromAdmin", "handleSignupCommand", "latestEvent", "buildSignupMessage", "languageCardHeading", "buildRosterText", "thaiLongDate", "time", "displayEndTime"];
const code = names.map((name) => {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const remaining = source.slice(start);
  const next = remaining.search(/\n(?:async )?function /);
  return remaining.slice(0, next < 0 ? undefined : next);
}).join("\n");
const compiled = transformSync(code, { loader: "ts", target: "es2022" }).code;

function fixture({ status = "open", ready = true, authenticated = true, authorized = true, replyFailure = false, beforeReply, beforeUpdate } = {}) {
  const state = {
    events: [{ id: "same-event", club_id: "same-club", event_date: "2026-10-24", status,
      venue: "สนามเดิม", starts_at: "18:00:00", ends_at: "22:00:00", line_publish_ready: ready,
      clubs: { line_group_id: "local-group" }, event_courts: [{ court_name: "คอร์ท 2", starts_at: "18:00:00", ends_at: "22:00:00", position: 0 }] }],
    signups: [{ member_id: "player", event_id: "same-event" }], attendance: [{ member_id: "player", arrived: true }],
    queues: [{ id: "playing", status: "playing" }], payments: [{ id: "paid", amount: 95, paid: true }],
    audit: [], writes: [], replies: [], queries: [],
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: "local-owner" } : null }, error: null }) },
    from(table) {
      assert.ok(["events", "club_members", "audit_logs"].includes(table), `unexpected table ${table}`);
      const query = { table, kind: "select", patch: null, filters: [] };
      const execute = () => {
        state.queries.push(structuredClone(query));
        if (table === "club_members") return { data: authorized ? { id: "local-admin" } : null, error: null };
        if (table === "audit_logs") {
          assert.equal(query.kind, "insert"); state.audit.push(structuredClone(query.patch)); return { data: null, error: null };
        }
        if (query.kind === "update") beforeUpdate?.(state, query);
        const rows = state.events.filter((row) => query.filters.every(([key, value]) => row[key] === value));
        if (query.kind === "update") {
          state.writes.push(structuredClone(query));
          rows.forEach((row) => Object.assign(row, query.patch));
        }
        return { data: rows[0] ? structuredClone(rows[0]) : null, error: null };
      };
      const builder = {
        select() { return builder; },
        eq(key, value) { query.filters.push([key, value]); return builder; },
        order() { return builder; }, limit() { return builder; },
        update(patch) { query.kind = "update"; query.patch = patch; return builder; },
        insert(patch) { query.kind = "insert"; query.patch = patch; return builder; },
        single: async () => execute(), maybeSingle: async () => execute(),
        then(resolve, reject) { return Promise.resolve().then(execute).then(resolve, reject); },
      };
      return builder;
    },
  };
  const deps = {
    createClient: () => client,
    Deno: { env: { get: (name) => name === "LINE_LIFF_ID" ? "local-liff" : "local-placeholder" } },
    safeJson: JSON.parse,
    json: (body, responseStatus = 200) => ({ body, status: responseStatus }),
    compareCourtNames, sortBySignupOrder,
    getLiffRoster: async (_client, currentEvent) => {
      assert.equal(currentEvent.id, "same-event");
      return { coming: [
        { name: "Second", arrivalTime: "18:30", signupOrder: 2 },
        { name: "First", arrivalTime: "18:00", signupOrder: 1 },
      ] };
    },
    replyLine: async (_token, text) => state.replies.push({ text }),
    replyLineMessages: async (_token, messages) => {
      state.replies.push({ messages }); beforeReply?.(state);
      if (replyFailure) throw new Error("simulated LINE reply failure");
    },
  };
  const api = new Function(...Object.keys(deps), `${compiled}\nreturn { publishFromAdmin, handleSignupCommand, buildRosterText };`)(...Object.values(deps));
  return {
    state,
    prepare: () => api.publishFromAdmin({}, JSON.stringify({ action: "publish_event", eventId: "same-event" }), "local-placeholder"),
    command: (command = "เปิดลงชื่อ") => api.handleSignupCommand({ admin: client, club: { id: "same-club" }, command, event: { replyToken: "local-reply", source: { userId: "local-line-user" } }, lineToken: "local-placeholder" }),
    roster: api.buildRosterText,
  };
}

function protectedData(state) {
  return structuredClone({ signups: state.signups, attendance: state.attendance, queues: state.queues, payments: state.payments });
}

for (const status of ["draft", "open"]) {
  test(`admin prepares ${status} round by setting only its ready flag on the same event and club`, async () => {
    const f = fixture({ status, ready: false }); const before = protectedData(f.state);
    const result = await f.prepare();
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, command: "เปิดลงชื่อ", eventId: "same-event", status, republish: status === "open" });
    assert.equal(f.state.events[0].status, status);
    assert.equal(f.state.events[0].line_publish_ready, true);
    assert.equal(f.state.writes.length, 1);
    assert.deepEqual(f.state.writes[0].patch, { line_publish_ready: true });
    assert.deepEqual(f.state.writes[0].filters, [["id", "same-event"], ["club_id", "same-club"], ["status", status]]);
    assert.deepEqual(protectedData(f.state), before);
  });

  test(`LINE publish from ${status} uses current venue and same event URL without changing game data`, async () => {
    const f = fixture({ status, beforeUpdate: (state, query) => {
      if (query.patch?.line_publish_ready === false) {
        state.events[0].venue = "สนามแก้ไขล่าสุด";
        state.events[0].event_courts[0].court_name = "คอร์ท 9";
      }
    } });
    const before = protectedData(f.state); await f.command();
    assert.equal(f.state.events[0].status, "open");
    assert.equal(f.state.events[0].line_publish_ready, false);
    const card = f.state.replies[0].messages[0];
    assert.match(card.altText, /สนามแก้ไขล่าสุด/); assert.match(card.altText, /คอร์ท 9/);
    assert.equal(card.contents.footer.contents[0].action.uri, "https://liff.line.me/local-liff?event_id=same-event");
    assert.deepEqual(f.state.writes[0].patch, status === "draft" ? { status: "open", line_publish_ready: false } : { line_publish_ready: false });
    assert.deepEqual(protectedData(f.state), before);
  });

  test(`LINE reply failure after ${status} publish keeps the round open and restores retry only`, async () => {
    const f = fixture({ status, replyFailure: true }); const before = protectedData(f.state);
    await assert.rejects(f.command(), /simulated LINE reply failure/);
    assert.equal(f.state.events[0].status, "open"); assert.equal(f.state.events[0].line_publish_ready, true);
    assert.deepEqual(f.state.writes.at(-1).patch, { line_publish_ready: true });
    assert.deepEqual(f.state.writes.at(-1).filters, [["id", "same-event"], ["club_id", "same-club"], ["status", "open"]]);
    assert.ok(f.state.writes.every(({ patch }) => patch.status !== "draft"));
    assert.deepEqual(protectedData(f.state), before);
  });
}

test("failed LINE delivery never reopens a round closed concurrently", async () => {
  const f = fixture({ replyFailure: true, beforeReply: (state) => { state.events[0].status = "closed"; } });
  await assert.rejects(f.command(), /simulated LINE reply failure/);
  assert.equal(f.state.events[0].status, "closed");
  assert.equal(f.state.events[0].line_publish_ready, false);
});

test("closed rounds and non-admin preparation cannot mutate publication state", async () => {
  for (const options of [{ status: "closed" }, { authorized: false }]) {
    const f = fixture(options); const before = structuredClone(f.state.events);
    assert.equal((await f.prepare()).status, options.authorized === false ? 403 : 409);
    assert.deepEqual(f.state.events, before); assert.deepEqual(f.state.writes, []);
  }
});

test("admin preparation requires a verified user and active admin membership of the event's club", async () => {
  const invalidSession = fixture({ authenticated: false });
  assert.equal((await invalidSession.prepare()).status, 401);
  assert.deepEqual(invalidSession.state.queries, []);
  const f = fixture(); await f.prepare();
  assert.deepEqual(f.state.queries.find(({ table }) => table === "club_members").filters, [
    ["club_id", "same-club"], ["profile_id", "local-owner"], ["role", "admin"], ["active", true],
  ]);
});

test("a round without a linked LINE group cannot be marked ready", async () => {
  const f = fixture({ ready: false }); f.state.events[0].clubs.line_group_id = null;
  assert.equal((await f.prepare()).status, 409);
  assert.equal(f.state.events[0].line_publish_ready, false);
  assert.deepEqual(f.state.writes, []);
});

test("a preparation race with round closing returns conflict rather than false success", async () => {
  const f = fixture({ beforeUpdate: (state) => { state.events[0].status = "closed"; } });
  assert.equal((await f.prepare()).status, 409);
  assert.equal(f.state.events[0].status, "closed");
});

test("a LINE claim racing with round closure neither reopens it nor sends a signup card", async () => {
  const f = fixture({ status: "draft", beforeUpdate: (state) => { state.events[0].status = "closed"; } });
  const before = protectedData(f.state); await f.command();
  assert.equal(f.state.events[0].status, "closed");
  assert.equal(f.state.replies.filter(({ messages }) => messages).length, 0);
  assert.deepEqual(protectedData(f.state), before);
});

test("LINE publish does not open an incomplete round without courts", async () => {
  const f = fixture({ status: "draft" }); f.state.events[0].event_courts = [];
  await f.command();
  assert.equal(f.state.events[0].status, "draft");
  assert.deepEqual(f.state.writes, []);
  assert.match(f.state.replies.at(-1).text, /ยังไม่มีคอร์ท/);
});

test("repeated command after a successful claim does not send another card or edit the round", async () => {
  const f = fixture(); await f.command();
  const writeCount = f.state.writes.length; await f.command();
  assert.equal(f.state.replies.filter(({ messages }) => messages).length, 1);
  assert.equal(f.state.writes.length, writeCount);
  assert.match(f.state.replies.at(-1).text, /เปิดลงชื่ออยู่แล้ว/);
});

test("the today roster command replies with current venue on the second line without writes", async () => {
  const f = fixture(); f.state.events[0].venue = "สนามใหม่ล่าสุด";
  await f.command("รายชื่อตีแบดวันนี้");
  const lines = f.state.replies[0].text.split("\n");
  assert.match(lines[0], /^รายชื่อตีแบด /);
  assert.equal(lines[1], "สถานที่: สนามใหม่ล่าสุด");
  assert.match(lines[3], /^1\. First/); assert.match(lines[4], /^2\. Second/);
  assert.deepEqual(f.state.writes, []);
});

test("the signup command sends the existing round's latest venue/courts without changing its status", async () => {
  const f = fixture(); f.state.events[0].venue = "สนามใหม่ล่าสุด";
  f.state.events[0].event_courts[0].court_name = "คอร์ท 12";
  await f.command("ลงชื่อ");
  const card = f.state.replies[0].messages[0];
  assert.match(card.altText, /สนามใหม่ล่าสุด/); assert.match(card.altText, /คอร์ท 12/);
  assert.equal(card.contents.footer.contents[0].action.uri, "https://liff.line.me/local-liff?event_id=same-event");
  assert.deepEqual(f.state.writes, []);
});

test("today roster puts venue on line two immediately after date and preserves signup order", () => {
  const f = fixture();
  const lines = f.roster(f.state.events[0], [
    { name: "Second", arrivalTime: "18:30", signupOrder: 2 },
    { name: "First", arrivalTime: "18:00", signupOrder: 1 },
  ]).split("\n");
  assert.match(lines[0], /^รายชื่อตีแบด /); assert.equal(lines[1], "สถานที่: สนามเดิม");
  assert.match(lines[2], /^คอร์ท 2/); assert.match(lines[3], /^1\. First/); assert.match(lines[4], /^2\. Second/);
  assert.equal(f.roster({ ...f.state.events[0], venue: "" }, []).split("\n")[1], "สถานที่: ยังไม่ได้ระบุสถานที่");
});
