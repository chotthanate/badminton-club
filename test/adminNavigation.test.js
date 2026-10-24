import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ADMIN_NAVIGATION, adminNavigationTabs } from "../src/adminNavigation.js";

test("owner navigation has six stable tabs and settings replaces the old history tab", () => {
  const tabs = adminNavigationTabs(false, true);
  assert.deepEqual(tabs.map(({ id }) => id), ["round", "players", "queue", "costs", "payments", "settings"]);
  assert.equal(tabs.at(-1).label, "ตั้งค่า");
  assert.ok(tabs.every(({ disabled }) => disabled === false));
  assert.equal(new Set(tabs.map(({ id }) => id)).size, tabs.length);
});

test("staff navigation excludes finances and still exposes round, players, queue and settings", () => {
  assert.deepEqual(adminNavigationTabs(true, true).map(({ id }) => id), ["round", "players", "queue", "settings"]);
  assert.ok(adminNavigationTabs(true, true).every(({ disabled }) => disabled === false));
});

test("without a round both roles can access round and settings only", () => {
  for (const staff of [false, true]) {
    const tabs = adminNavigationTabs(staff, false);
    assert.deepEqual(tabs.filter(({ disabled }) => !disabled).map(({ id }) => id), ["round", "settings"]);
    assert.ok(tabs.filter(({ id }) => !["round", "settings"].includes(id)).every(({ disabled }) => disabled));
  }
});

test("navigation projections never mutate shared metadata or other views", () => {
  const original = structuredClone(ADMIN_NAVIGATION);
  const first = adminNavigationTabs(false, false);
  first[0].label = "changed in caller";
  first[0].disabled = true;
  assert.deepEqual(ADMIN_NAVIGATION, original);
  assert.equal(adminNavigationTabs(false, true)[0].label, "รอบ");
  assert.equal(adminNavigationTabs(false, true)[0].disabled, false);
});

test("automatic queue success no longer displays the higher-skill fallback explanation", () => {
  const panel = readFileSync(new URL("../src/QueuePanel.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(panel, /เติมด้วยมือสูงกว่าที่ใกล้ที่สุด/);
  assert.match(panel, /setPlanningMessage\(reason \|\| ""\)/);
  assert.match(panel, /proposal\.fallback \? createFallbackQueueDraft : createQueueDraft/);
});

test("history remains permission-gated under settings and uses the selected round audit read", () => {
  const app = readFileSync(new URL("../src/BadmintonApp.jsx", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../src/AdminSettingsPanel.jsx", import.meta.url), "utf8");
  assert.ok(app.includes('activeTab === "settings" && settingsPage === "history" && context?.role !== "staff"'));
  assert.ok(app.includes('dashboard.event.status !== "open" && !viewingHistory'));
  assert.ok(app.includes('activeTab === "settings" && !viewingHistory'));
  assert.ok(app.includes('await loadAuditState(context.club_id, eventId)'));
  assert.ok(app.includes('!isStaff && settingsPage === "history" && appEvent'));
  assert.match(settings, /!isStaff && hasEvent \? <SettingsRow[\s\S]*?onClick=\{onHistory\}/);
  assert.ok(!app.includes('activeTab === "history"'));
});

test("navigation preserves unsaved-work confirmation and does not eject settings on round changes", () => {
  const app = readFileSync(new URL("../src/BadmintonApp.jsx", import.meta.url), "utf8");
  const changeTab = app.slice(app.indexOf("function changeTab(nextTab)"), app.indexOf("async function switchTestMode()"));
  assert.match(changeTab, /hasUnsavedQueueWork\(selectedEventIdRef\.current\)/);
  assert.match(changeTab, /hasUnsavedEditorWork\(selectedEventIdRef\.current\)/);
  assert.ok(changeTab.indexOf("window.confirm") < changeTab.indexOf("setActiveTab(nextTab)"));
  assert.ok(app.includes('current === "settings" ? current : "queue"'));
  assert.ok(app.includes('current === "settings" ? current : "round"'));
  assert.ok(app.includes('adminNavigationTabs(isStaff, Boolean(appEvent))'));
});

// Execute the real dashboard handlers, not a second copy of their behavior.
// Browser/native confirmation is substituted so both answers are deterministic.
function navigationHarness({ activeTab = "queue", queueDirty = false, editorDirty = false, confirm = true, saving = false } = {}) {
  const app = readFileSync(new URL("../src/BadmintonApp.jsx", import.meta.url), "utf8");
  const start = app.indexOf("function canLeaveRound()");
  const end = app.indexOf("async function switchTestMode()", start);
  assert.ok(start >= 0 && end > start);
  const effects = [];
  const checks = [];
  const drafts = new Map([
    ...(queueDirty ? [["queue:selected-event", '{"selectedIds":["p1","p2"]}']] : []),
    ...(editorDirty ? [["editor:selected-event", '{"courtName":"unsaved court"}']] : []),
    ["queue:other-event", '{"selectedIds":["p9"]}'],
  ]);
  const originalDrafts = [...drafts];
  const localStorage = {
    getItem: (key) => drafts.get(key) || null,
    setItem: (key, value) => { effects.push(["storage:set", key]); drafts.set(key, value); },
    removeItem: (key) => { effects.push(["storage:remove", key]); drafts.delete(key); },
    clear: () => { effects.push(["storage:clear"]); drafts.clear(); },
  };
  const environment = {
    activeTab,
    selectedEventIdRef: { current: "selected-event" },
    savingRef: { current: saving },
    hasUnsavedQueueWork: (eventId) => { checks.push(["queue", eventId]); return drafts.has(`queue:${eventId}`); },
    hasUnsavedEditorWork: (eventId) => { checks.push(["editor", eventId]); return drafts.has(`editor:${eventId}`); },
    setActiveTab: (tab) => effects.push(["active", tab]),
    setSettingsPage: (page) => effects.push(["settings", page]),
    setError: (message) => effects.push(["error", message]),
    localStorage,
    window: {
      localStorage,
      confirm: (message) => { effects.push(["confirm", message]); return confirm; },
      scrollTo: (...args) => effects.push(["scroll", ...args]),
    },
  };
  const handlers = new Function(...Object.keys(environment), `"use strict";\n${app.slice(start, end)}\nreturn { changeTab, canLeaveRound };`)(...Object.values(environment));
  return {
    ...handlers, effects, checks,
    assertDraftsRetained() {
      assert.deepEqual([...drafts], originalDrafts);
      assert.ok(effects.every(([kind]) => !kind.startsWith("storage:")));
    },
  };
}

for (const [kind, state] of [["queue", { queueDirty: true }], ["editor", { editorDirty: true }], ["both", { queueDirty: true, editorDirty: true }]]) {
  test(`cancelling navigation with ${kind} drafts changes no tab or scroll position`, () => {
    const harness = navigationHarness({ ...state, confirm: false });
    harness.changeTab("settings");
    assert.equal(harness.effects.length, 1);
    assert.equal(harness.effects[0][0], "confirm");
    assert.match(harness.effects[0][1], /ยังมีร่างที่ไม่บันทึก/);
    assert.ok(harness.checks.every(([, eventId]) => eventId === "selected-event"));
    harness.assertDraftsRetained();
  });

  test(`accepting navigation with ${kind} drafts changes page but never clears any draft`, () => {
    const harness = navigationHarness({ ...state, confirm: true });
    harness.changeTab("settings");
    assert.equal(harness.effects[0][0], "confirm");
    assert.deepEqual(harness.effects.slice(1), [["settings", "menu"], ["active", "settings"], ["scroll", 0, 0]]);
    harness.assertDraftsRetained();
  });
}

test("clean navigation changes the selected tab and scrolls without asking for confirmation", () => {
  for (const next of ["round", "players", "costs", "payments", "settings"]) {
    const harness = navigationHarness();
    harness.changeTab(next);
    assert.deepEqual(harness.effects, [...(next === "settings" ? [["settings", "menu"]] : []), ["active", next], ["scroll", 0, 0]]);
    assert.deepEqual(harness.checks, [["queue", "selected-event"], ["editor", "selected-event"]]);
    harness.assertDraftsRetained();
  }
});

test("pressing the current settings tab returns from history to its menu without leaving or clearing work", () => {
  const harness = navigationHarness({ activeTab: "settings", queueDirty: true, editorDirty: true, confirm: false });
  harness.changeTab("settings");
  assert.deepEqual(harness.effects, [["settings", "menu"], ["scroll", 0, 0]]);
  assert.deepEqual(harness.checks, []);
  harness.assertDraftsRetained();
});

test("pressing the current non-settings tab is a no-op even with unsaved work", () => {
  const harness = navigationHarness({ queueDirty: true, editorDirty: true });
  harness.changeTab("queue");
  assert.deepEqual(harness.effects, []);
  assert.deepEqual(harness.checks, []);
  harness.assertDraftsRetained();
});

test("leaving the round while a save is pending is blocked before asking to discard or leave", () => {
  const harness = navigationHarness({ saving: true, queueDirty: true, editorDirty: true });
  assert.equal(harness.canLeaveRound(), false);
  assert.equal(harness.effects.length, 1);
  assert.equal(harness.effects[0][0], "error");
  assert.match(harness.effects[0][1], /กำลังบันทึก/);
  assert.deepEqual(harness.checks, []);
  harness.assertDraftsRetained();
});

test("leaving a clean round succeeds without confirmation, navigation, or storage writes", () => {
  const harness = navigationHarness();
  assert.equal(harness.canLeaveRound(), true);
  assert.deepEqual(harness.effects, []);
  assert.deepEqual(harness.checks, [["queue", "selected-event"], ["editor", "selected-event"]]);
  harness.assertDraftsRetained();
});

test("leaving a dirty round honors both confirmation answers and retains queue/editor drafts", () => {
  for (const state of [{ queueDirty: true }, { editorDirty: true }, { queueDirty: true, editorDirty: true }]) {
    for (const confirm of [false, true]) {
      const harness = navigationHarness({ ...state, confirm });
      assert.equal(harness.canLeaveRound(), confirm);
      assert.equal(harness.effects.length, 1);
      assert.equal(harness.effects[0][0], "confirm");
      assert.match(harness.effects[0][1], /ยังมีข้อมูลที่แก้ไว้แต่ยังไม่บันทึก/);
      harness.assertDraftsRetained();
    }
  }
});

let fixtureSequence = 0;
async function loadFixture(search = "") {
  const previous = globalThis.window;
  globalThis.window = { location: { search } };
  try {
    const url = new URL("./browser/admin-fixture-state.js", import.meta.url);
    url.searchParams.set("test", String(++fixtureSequence));
    return await import(url.href);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
}

test("local staff fixture supplies the staff role and playable event without admin audit data", async () => {
  const { fixtureCall, fixture, mockSupabase } = await loadFixture("?staff=1");
  const [context] = await fixtureCall("getAdminContexts", []);
  assert.equal(context.role, "staff");
  const dashboard = await fixtureCall("loadStaffDashboard", [context.club_id]);
  assert.equal(dashboard.event.status, "open");
  assert.equal(dashboard.signups.length, 6);
  assert.deepEqual(dashboard.auditLogs, []);
  assert.deepEqual(fixture.readDetails, [{ name: "loadStaffDashboard", args: [context.club_id] }]);
  assert.throws(() => mockSupabase.from("club_members"), /blocked/);
  assert.throws(() => mockSupabase.rpc("anything"), /blocked/);
  assert.throws(() => mockSupabase.functions.invoke("anything"), /blocked/);
});

test("empty owner and staff fixtures return no event and no event-scoped rows", async () => {
  for (const search of ["?empty=1", "?staff=1&empty=1"]) {
    const { fixtureCall } = await loadFixture(search);
    const [context] = await fixtureCall("getAdminContexts", []);
    assert.equal(context.role, search.includes("staff") ? "staff" : "owner");
    assert.deepEqual(await fixtureCall("listClubEvents", [context.club_id]), []);
    const result = await fixtureCall(context.role === "staff" ? "loadStaffDashboard" : "loadDashboard", [context.club_id, null]);
    assert.equal(result.event, null);
    assert.equal(result.queueEventStatus, null);
    for (const field of ["signups", "attendance", "courts", "auditLogs", "queueMatches"]) assert.deepEqual(result[field], []);
  }
});

test("local history fixture scopes each read to the selected open or closed round", async () => {
  const { fixtureCall } = await loadFixture();
  const [context] = await fixtureCall("getAdminContexts", []);
  const [open, closed] = await fixtureCall("listClubEvents", [context.club_id]);
  assert.equal(open.status, "open");
  assert.equal(closed.status, "closed");
  for (const event of [open, closed]) {
    const result = await fixtureCall("loadAuditState", [context.club_id, event.id]);
    assert.deepEqual(Object.keys(result), ["auditLogs"]);
    assert.equal(result.auditLogs.length, 2);
    assert.ok(result.auditLogs.every((row) => row.event_id === event.id));
    const dashboard = await fixtureCall("loadDashboard", [context.club_id, event.id]);
    assert.equal(dashboard.event.id, event.id);
    assert.deepEqual(dashboard.auditLogs, result.auditLogs);
  }
});

test("existing sandbox fixture still starts as a future draft and prepares a playable round", async () => {
  const { fixtureCall } = await loadFixture("?sandbox");
  const [context] = await fixtureCall("getAdminContexts", []);
  assert.equal(context.role, "owner");
  assert.equal(context.clubs.is_test, true);
  const before = await fixtureCall("loadDashboard", [context.club_id, null]);
  assert.equal(before.event.status, "draft");
  assert.equal(before.event.event_date, "2099-01-01");
  const id = await fixtureCall("prepareTestRound", [{ clubId: context.club_id }]);
  const after = await fixtureCall("loadDashboard", [context.club_id, id]);
  assert.equal(after.event.id, id);
  assert.equal(after.event.status, "open");
  assert.equal(after.signups.length, before.signups.length);
});
