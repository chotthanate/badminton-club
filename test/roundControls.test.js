import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { modifiedCourtUpdates, roundDetailsPatch } from "../src/roundControls.js";

const app = readFileSync(new URL("../src/BadmintonApp.jsx", import.meta.url), "utf8");
const form = { event_date: "2099-01-01", venue: "  สนามใหม่  ", status: "closed", court_hourly_rate: 1 };

test("an open venue patch excludes date, status, rates and any injected form fields", () => {
  assert.deepEqual(roundDetailsPatch({ status: "open" }, form), { venue: "สนามใหม่" });
  assert.equal(form.venue, "  สนามใหม่  ");
});
test("draft details keep date/venue only; closed and empty venue fail before mutation", () => {
  assert.deepEqual(roundDetailsPatch({ status: "draft" }, form), { event_date: "2099-01-01", venue: "สนามใหม่" });
  assert.throws(() => roundDetailsPatch({ status: "closed" }, form), /ปิดแล้ว/);
  assert.throws(() => roundDetailsPatch({ status: "open" }, { venue: "  " }), /กรอกสถานที่/);
  assert.deepEqual(roundDetailsPatch({ status: "open" }, { venue: "a".repeat(120) }), { venue: "a".repeat(120) });
  assert.throws(() => roundDetailsPatch({ status: "open" }, { venue: "a".repeat(121) }), /120/);
});
test("court edits send only changed existing IDs, never recreate or include unchanged courts", () => {
  const courts = [{ id: "playing", court_name: "A", starts_at: "18:00:00", ends_at: "22:00:00" }, { id: "idle", court_name: "B", starts_at: "18:00:00", ends_at: "22:00:00" }];
  const drafts = { playing: { court_name: "A", starts_at: "18:00", ends_at: "22:00" }, idle: { court_name: " C ", starts_at: "18:00", ends_at: "22:00" }, removed: { court_name: "Z", starts_at: "20:00", ends_at: "21:00" } };
  assert.deepEqual(modifiedCourtUpdates(courts, drafts), [{ id: "idle", court_name: "C", starts_at: "18:00", ends_at: "22:00" }]);
  assert.equal(drafts.idle.court_name, " C ");
});

function harness({ status = "open", dirty = false, conflict = false, courtDirty = false, isTestMode = false, fails = false, wait } = {}) {
  const effects = [];
  const event = { id: "same-round", club_id: "same-club", event_date: "2026-10-24", status };
  const eventEditor = { conflict, dirty, setValue: (value) => effects.push(["setValue", value]), accept: (value) => effects.push(["accept", value]) };
  const env = {
    event, form, eventEditor, courtsDirty: courtDirty, isTestMode,
    detailsSavingRef: { current: false }, republishPendingRef: { current: false }, roundDetailsPatch,
    setRoundSettingsError: (value) => effects.push(["error", value]),
    setDetailsSaving: (value) => effects.push(["detailsSaving", value]),
    setEditingDetails: (value) => effects.push(["editing", value]),
    setRepublishPending: (value) => effects.push(["republishPending", value]),
    updateEventVenue: async (input) => effects.push(["venue", input]),
    updateEventDetails: async (input) => effects.push(["details", input]),
    prepareEventForLine: async (id) => effects.push(["prepare", id]),
    mutate: async (action, notice, options) => {
      effects.push(["mutate", options.actionKey, notice]);
      if (wait) await wait;
      if (fails) { options.onError(Error("network failed")); return false; }
      await action(); return true;
    },
  };
  const start = app.indexOf("  async function saveEventDetails()");
  const end = app.indexOf("  function advanceRound", start);
  assert.ok(start >= 0 && end > start);
  const handlers = new Function(...Object.keys(env), `${app.slice(start, end)}; return { saveEventDetails, prepareOpenRoundForLine };`)(...Object.values(env));
  return { ...handlers, effects };
}

test("real open-round handler changes only venue on same event and acknowledges normalized draft", async () => {
  const { saveEventDetails, effects } = harness();
  await saveEventDetails();
  assert.deepEqual(effects.find(([key]) => key === "venue"), ["venue", { clubId: "same-club", eventId: "same-round", venue: "สนามใหม่" }]);
  assert.ok(!effects.some(([key]) => key === "details"));
  assert.deepEqual(effects.find(([key]) => key === "accept"), ["accept", { event_date: "2026-10-24", venue: "สนามใหม่" }]);
  assert.ok(effects.some(([key, value]) => key === "editing" && value === false));
});
test("draft detail handler does not replace courts or apply new financial defaults", async () => {
  const { saveEventDetails, effects } = harness({ status: "draft" });
  await saveEventDetails();
  assert.deepEqual(effects.find(([key]) => key === "details"), ["details", { clubId: "same-club", eventId: "same-round", patch: { event_date: "2099-01-01", venue: "สนามใหม่" } }]);
  assert.doesNotMatch(app.slice(app.indexOf("function EventControlCard"), app.indexOf("function ParticipantsPanel")), /replaceEventCourts|roundDefaultsForDate/);
});
test("failed venue save preserves editor values and leaves form open with inline error", async () => {
  const { saveEventDetails, effects } = harness({ fails: true });
  await saveEventDetails();
  assert.ok(effects.some(([key, message]) => key === "error" && message === "network failed"));
  assert.ok(!effects.some(([key]) => ["accept", "setValue", "editing", "venue"].includes(key)));
});
test("conflicting details and double taps cannot overwrite or duplicate venue saves", async () => {
  const conflict = harness({ conflict: true }); await conflict.saveEventDetails();
  assert.ok(!conflict.effects.some(([key]) => key === "mutate"));
  let release; const wait = new Promise((resolve) => { release = resolve; });
  const pending = harness({ wait });
  const first = pending.saveEventDetails(); await pending.saveEventDetails();
  assert.equal(pending.effects.filter(([key]) => key === "mutate").length, 1);
  release(); await first;
});
test("LINE republish prepares the same open ID and never mutates status or creates a round", async () => {
  const { prepareOpenRoundForLine, effects } = harness();
  await prepareOpenRoundForLine();
  assert.deepEqual(effects.find(([key]) => key === "prepare"), ["prepare", "same-round"]);
  assert.match(effects.find(([key]) => key === "mutate")[2], /เปิดลงชื่อ/);
  for (const settings of [{ status: "closed" }, { status: "draft" }, { isTestMode: true }, { dirty: true }, { courtDirty: true }]) {
    const blocked = harness(settings); await blocked.prepareOpenRoundForLine();
    assert.ok(!blocked.effects.some(([key]) => key === "prepare"));
  }
});
test("round UI shows venue-only form when open, LINE instructions, and shared safe court controls", () => {
  assert.match(app, /event.status === "draft" \? <label>วันที่/);
  assert.match(app, /event.status === "open" \? "แก้ไขสถานที่"/);
  assert.match(app, /ส่งข้อมูลลงชื่อเข้า LINE อีกครั้ง/);
  assert.match(app, /OperatorCourtControls dashboard=\{dashboard\} event=\{mappedEvent\}/);
  assert.doesNotMatch(app, /updates.some\(\(court\) => playingCourtIds.has\(court.id\)\)/);
  assert.match(app, /roundSettingsError \? <p[^>]*role="alert"/);
});

test("isolated fixture venue/repost preserves event identity, date, courts and all member/game/finance arrays", async () => {
  const previous = globalThis.window; globalThis.window = { location: { search: "" } };
  let fixture;
  try { fixture = await import(new URL("./browser/admin-fixture-state.js?round-controls", import.meta.url)); }
  finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
  const { fixtureCall } = fixture;
  const [context] = await fixtureCall("getAdminContexts", []);
  const [event] = await fixtureCall("listClubEvents", [context.club_id]);
  const read = () => fixtureCall("loadDashboard", [context.club_id, event.id]);
  const before = await read();
  await fixtureCall("updateEventVenue", [{ clubId: context.club_id, eventId: event.id, venue: "New local venue" }]);
  const result = await fixtureCall("prepareEventForLine", [event.id]);
  const after = await read();
  assert.equal(result.eventId, event.id); assert.equal(result.republish, true);
  assert.equal(after.event.id, before.event.id); assert.equal(after.event.status, before.event.status);
  assert.equal(after.event.event_date, before.event.event_date); assert.equal(after.event.venue, "New local venue");
  for (const [key, value] of Object.entries(before)) if (key !== "event") assert.deepEqual(after[key], value, key);
});
