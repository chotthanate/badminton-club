import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
import { buildSync } from "esbuild";
import { createMutationQueue } from "../src/mutationQueue.js";
import { selectStaffWorkspace } from "../src/staffWorkspace.js";

const compiledBadge = buildSync({
  entryPoints: [fileURLToPath(new URL("../src/SandboxModeBadge.jsx", import.meta.url))],
  bundle: true, format: "cjs", packages: "external", platform: "node", write: false,
}).outputFiles[0].text;
const require = createRequire(import.meta.url);

function children(node) { return [node?.props?.children].flat(Infinity).filter((value) => value !== undefined && value !== null && value !== false); }
function allNodes(node) { return typeof node === "object" && node !== null ? [node, ...children(node).flatMap(allNodes)] : []; }
function text(node) { return node === undefined || node === null || node === false ? "" : typeof node === "object" ? children(node).map(text).join("") : String(node); }

// Small deterministic hook host. It executes the production component/event
// handlers and effects, with only DOM focus and the portal host substituted.
function badgeHarness(onExit, initialBusy = false) {
  const slots = [], effects = [], focus = [], domNodes = new Map();
  const document = { body: {}, activeElement: null };
  let cursor = 0, tree, busy = initialBusy;
  const mockReact = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(run, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, position) => !Object.is(value, previous.deps[position]))) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: run() }; });
      }
    },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "document", compiledBadge)((id) => id === "react" ? mockReact : id === "react-dom" ? { createPortal: (node) => node } : require(id), module, module.exports, document);
  function render() {
    cursor = 0;
    tree = module.exports.default({ busy, onExit });
    for (const node of allNodes(tree).filter((element) => typeof element.type === "string")) {
      const key = node.props.ref || `${node.type}:${text(node)}`;
      let host = domNodes.get(key);
      if (!host) {
        host = { label: text(node), focus: (options) => { document.activeElement = host; focus.push({ label: host.label, options }); } };
        domNodes.set(key, host);
      }
      host.disabled = node.props.disabled;
      host.querySelectorAll = () => allNodes(node).filter((element) => element.type === "button" && !element.props.disabled).map((element) => domNodes.get(element.props.ref || `${element.type}:${text(element)}`));
      if (node.props.ref) node.props.ref.current = host;
    }
    effects.splice(0).forEach((effect) => effect());
    return tree;
  }
  render();
  return {
    render, focus, document,
    button(label) { return allNodes(tree).find((node) => node.type === "button" && text(node).trim() === label); },
    dialog() { return allNodes(tree).find((node) => node.props?.role === "dialog"); },
    alert() { return allNodes(tree).find((node) => node.props?.role === "alert"); },
    setBusy(value) { busy = value; render(); },
  };
}

test("sandbox badge opens confirmation but cancellation never requests an exit", () => {
  let exits = 0;
  const badge = badgeHarness(() => { exits += 1; });
  assert.equal(badge.dialog(), undefined);
  badge.button("โหมดทดลอง").props.onClick(); badge.render();
  assert.equal(badge.dialog().props["aria-modal"], "true");
  assert.equal(exits, 0);
  assert.equal(badge.focus.at(-1).label, "ยังไม่ออก");
  assert.deepEqual(badge.focus.at(-1).options, { preventScroll: true });
  badge.button("ยังไม่ออก").props.onClick(); badge.render();
  assert.equal(badge.dialog(), undefined);
  assert.equal(exits, 0);
  assert.equal(badge.focus.at(-1).label.trim(), "โหมดทดลอง");
  assert.deepEqual(badge.focus.at(-1).options, { preventScroll: true });
});

test("sandbox confirmation prevents duplicate taps and closes only on successful exit", async () => {
  let resolve, exits = 0;
  const pending = new Promise((done) => { resolve = done; });
  const badge = badgeHarness(() => { exits += 1; return pending; });
  badge.button("โหมดทดลอง").props.onClick(); badge.render();
  const confirm = badge.button("กลับข้อมูลจริง");
  const first = confirm.props.onClick();
  await confirm.props.onClick();
  assert.equal(exits, 1);
  badge.render();
  assert.ok(badge.button("กำลังกลับข้อมูลจริง…").props.disabled);
  assert.ok(badge.button("ยังไม่ออก").props.disabled);
  assert.ok(badge.button("โหมดทดลอง").props.disabled);
  badge.dialog().props.onKeyDown({ key: "Escape" }); badge.render();
  assert.ok(badge.dialog(), "pending exit cannot be dismissed");
  resolve(true); await first; badge.render();
  assert.equal(badge.dialog(), undefined);
});

for (const [label, onExit, message] of [
  ["false", async () => false, "ยังออกจากโหมดทดลองไม่ได้"],
  ["throw", async () => { throw new Error("network failed"); }, "network failed"],
]) test(`sandbox exit ${label} keeps confirmation and a visible retry error`, async () => {
  const badge = badgeHarness(onExit);
  badge.button("โหมดทดลอง").props.onClick(); badge.render();
  await badge.button("กลับข้อมูลจริง").props.onClick(); badge.render();
  assert.ok(badge.dialog());
  assert.ok(text(badge.alert()).includes(message));
  assert.equal(badge.button("กลับข้อมูลจริง").props.disabled, false);
});

test("busy state blocks exit, escape and tab focus remain inside the confirmation", async () => {
  let exits = 0;
  const badge = badgeHarness(() => { exits += 1; return true; });
  badge.button("โหมดทดลอง").props.onClick(); badge.render();
  let prevented = 0;
  badge.dialog().props.onKeyDown({ key: "Tab", shiftKey: true, preventDefault: () => { prevented += 1; } });
  assert.equal(badge.document.activeElement.label, "กลับข้อมูลจริง");
  badge.dialog().props.onKeyDown({ key: "Tab", preventDefault: () => { prevented += 1; } });
  assert.equal(badge.document.activeElement.label, "ยังไม่ออก");
  assert.equal(prevented, 2);
  badge.setBusy(true);
  await badge.button("กลับข้อมูลจริง").props.onClick();
  badge.dialog().props.onKeyDown({ key: "Escape" }); badge.render();
  assert.equal(exits, 0);
  assert.ok(badge.dialog());
  badge.setBusy(false);
  badge.dialog().props.onKeyDown({ key: "Escape" }); badge.render();
  assert.equal(badge.dialog(), undefined);
  assert.equal(exits, 0);
});

test("failed pending exit restores focus inside the dialog after a disabled button blurs", async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const badge = badgeHarness(() => pending);
  badge.button("โหมดทดลอง").props.onClick(); badge.render();
  const result = badge.button("กลับข้อมูลจริง").props.onClick(); badge.render();
  badge.document.activeElement = badge.document.body;
  const before = badge.focus.length;
  resolve(false); await result; badge.render();
  assert.ok(badge.dialog());
  assert.equal(badge.document.activeElement.label, "ยังไม่ออก");
  assert.equal(badge.focus.length, before + 1);
  assert.deepEqual(badge.focus.at(-1).options, { preventScroll: true });
});

const appSource = readFileSync(new URL("../src/BadmintonApp.jsx", import.meta.url), "utf8");
function sourceSection(start, end) {
  const from = appSource.indexOf(start), to = appSource.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return appSource.slice(from, to);
}

function switchHarness({ confirm = true, dirty = false, failure = "", contexts, readGate, rememberedEvents = [], events = [{ id: "real-event", status: "open" }] } = {}) {
  const sandbox = { club_id: "test", role: "owner", clubs: { is_test: true } };
  const production = { club_id: "real", role: "owner", clubs: { is_test: false } };
  const calls = [];
  const state = { context: sandbox, dashboard: { event: { id: "test-event", status: "open" }, queueMatches: [{ id: "test-playing", status: "playing" }] }, eventSummaries: [{ id: "test-event" }], selectedEventId: "test-event", activeTab: "queue", notice: "", error: "", outstanding: { rows: [] } };
  const original = structuredClone(state);
  const selectedClubIdRef = { current: "test" }, selectedEventIdRef = { current: "test-event" }, refreshRequestRef = { current: 0 }, savingRef = { current: false };
  const selectedEventsByClubRef = { current: new Map(rememberedEvents) };
  const read = async (name, args, value) => { calls.push([name, ...args]); if (readGate && name === "getAdminContexts") await readGate; if (failure === name) throw new Error(`${name} failed`); return structuredClone(value); };
  const forbidden = (name) => async (...args) => { calls.push([name, ...args]); throw new Error(`Unexpected write: ${name}`); };
  const environment = {
    context: sandbox, adminContexts: [sandbox, production], session: { user: { id: "owner" } },
    selectedClubIdRef, selectedEventIdRef, refreshRequestRef, savingRef,
    fullRefreshCountRef: { current: 0 }, latestFullRefreshRef: { current: 0 }, selectedEventsByClubRef,
    mutationsRef: { current: createMutationQueue((keys) => { savingRef.current = keys.length > 0; }) },
    hasUnsavedQueueWork: () => dirty, hasUnsavedEditorWork: () => false,
    window: { confirm: (...args) => { calls.push(["confirm", ...args]); return confirm; } },
    getAdminContexts: (...args) => read("getAdminContexts", args, contexts || [sandbox, production]),
    listClubEvents: (...args) => read("listClubEvents", args, events),
    loadDashboard: (...args) => read("loadDashboard", args, { event: events.find((event) => event.id === args[1]) || null, queueMatches: [{ id: "real-playing", status: "playing" }] }),
    listOutstandingPayments: (...args) => read("listOutstandingPayments", args, []),
    loadStaffDashboard: forbidden("loadStaffDashboard"), selectStaffWorkspace,
    createTestClub: forbidden("createTestClub"), prepareTestRound: forbidden("prepareTestRound"), resetTestClub: forbidden("resetTestClub"),
    setLoading: (value) => { state.loading = value; }, setError: (value) => { state.error = value; },
    setNotice: (value) => { state.notice = value; }, setAdminContexts: () => {},
    setContext: (value) => { state.context = value; }, setDashboard: (value) => { state.dashboard = value; },
    setEventSummaries: (value) => { state.eventSummaries = value; }, setSelectedEventId: (value) => { state.selectedEventId = value; },
    setPreviousOutstanding: (value) => { state.outstanding = value; }, setLastSyncedAt: () => {},
    setActiveTab: (value) => { state.activeTab = typeof value === "function" ? value(state.activeTab) : value; },
  };
  const refreshCode = sourceSection("async function refresh(silent", "\n  useEffect(() => { refresh(); }");
  const guardCode = sourceSection("function canLeaveRound()", "function changeTab(");
  const switchCode = sourceSection("async function switchTestMode()", "async function resetDemo()");
  const handlers = new Function(...Object.keys(environment), `${refreshCode}\n${guardCode}\n${switchCode}\nreturn { switchTestMode, refresh };`)(...Object.values(environment));
  return { ...handlers, state, original, calls, selectedClubIdRef, selectedEventIdRef, refreshRequestRef, selectedEventsByClubRef };
}

test("cancelled dirty-work exit never reads or writes another club and preserves the active game", async () => {
  const harness = switchHarness({ dirty: true, confirm: false });
  assert.equal(await harness.switchTestMode(), false);
  assert.deepEqual(harness.calls.map(([name]) => name), ["confirm"]);
  assert.deepEqual(harness.state, harness.original);
  assert.equal(harness.selectedClubIdRef.current, "test");
});

test("confirmed exit loads production context without reset/create/prepare or game writes", async () => {
  const harness = switchHarness({ dirty: true });
  assert.equal(await harness.switchTestMode(), true);
  assert.deepEqual(harness.calls.map(([name]) => name), ["confirm", "getAdminContexts", "listClubEvents", "loadDashboard", "listOutstandingPayments"]);
  assert.equal(harness.state.context.club_id, "real");
  assert.equal(harness.state.context.clubs.is_test, false);
  assert.equal(harness.selectedClubIdRef.current, "real");
  assert.equal(harness.selectedEventIdRef.current, "real-event");
  assert.deepEqual(harness.state.dashboard.queueMatches, [{ id: "real-playing", status: "playing" }]);
  assert.equal(harness.state.activeTab, "round");
});

for (const failure of ["getAdminContexts", "listClubEvents", "loadDashboard", "listOutstandingPayments"]) {
  test(`exit ${failure} failure preserves sandbox and its active queue`, async () => {
    const harness = switchHarness({ failure });
    assert.equal(await harness.switchTestMode(), false);
    assert.deepEqual(harness.state.context, harness.original.context);
    assert.deepEqual(harness.state.dashboard, harness.original.dashboard);
    assert.deepEqual(harness.state.eventSummaries, harness.original.eventSummaries);
    assert.equal(harness.state.selectedEventId, "test-event");
    assert.equal(harness.selectedClubIdRef.current, "test");
    assert.equal(harness.selectedEventIdRef.current, "test-event");
    assert.equal(harness.state.activeTab, "queue");
    assert.equal(harness.state.notice, "");
    assert.ok(harness.state.error.includes("failed"));
  });
}

test("duplicate switch taps while reading do not issue duplicate reads or toggle back into sandbox", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const harness = switchHarness({ readGate: gate });
  const first = harness.switchTestMode();
  assert.equal(await harness.switchTestMode(), false);
  release();
  assert.equal(await first, true);
  assert.equal(harness.calls.filter(([name]) => name === "getAdminContexts").length, 1);
  assert.equal(harness.state.context.clubs.is_test, false);
});

test("lost production access never silently falls back to sandbox and claims a successful exit", async () => {
  for (const contexts of [[], [{ club_id: "test", role: "owner", clubs: { is_test: true } }]]) {
    const harness = switchHarness({ contexts });
    assert.equal(await harness.switchTestMode(), false);
    assert.deepEqual(harness.calls.map(([name]) => name), ["getAdminContexts"]);
    assert.deepEqual(harness.state.context, harness.original.context);
    assert.deepEqual(harness.state.dashboard, harness.original.dashboard);
    assert.equal(harness.state.notice, "");
    assert.equal(harness.selectedClubIdRef.current, "test");
    assert.equal(harness.state.activeTab, "queue");
  }
});

test("a superseded exit refresh returns failure without committing stale context or success notice", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const harness = switchHarness({ readGate: gate });
  const request = harness.switchTestMode();
  await Promise.resolve();
  harness.refreshRequestRef.current += 1;
  release();
  assert.equal(await request, false);
  assert.deepEqual(harness.state.dashboard, harness.original.dashboard);
  assert.deepEqual(harness.state.context, harness.original.context);
  assert.equal(harness.selectedClubIdRef.current, "test");
  assert.equal(harness.state.notice, "");
  assert.equal(harness.state.activeTab, "queue");
});

test("returning to production restores its selected active round rather than a newer draft", async () => {
  const harness = switchHarness({
    rememberedEvents: [["real", "real-active"], ["test", "test-event"]],
    events: [{ id: "real-new-draft", status: "draft" }, { id: "real-active", status: "open" }],
  });
  assert.equal(await harness.switchTestMode(), true);
  assert.equal(harness.selectedEventIdRef.current, "real-active");
  assert.equal(harness.state.dashboard.event.id, "real-active");
  assert.equal(harness.state.dashboard.event.status, "open");
  assert.equal(harness.selectedEventsByClubRef.current.get("test"), "test-event");
  assert.equal(harness.selectedEventsByClubRef.current.get("real"), "real-active");
  assert.ok(harness.calls.some(([name, clubId, eventId]) => name === "loadDashboard" && clubId === "real" && eventId === "real-active"));
});

test("explicit round selection and preferLatest override remembered selection only when requested", async () => {
  const events = [{ id: "new-draft", status: "draft" }, { id: "active", status: "open" }];
  const explicit = switchHarness({ rememberedEvents: [["real", "active"]], events });
  assert.equal(await explicit.refresh(false, { clubId: "real", eventId: "new-draft", throwOnError: true }), true);
  assert.equal(explicit.selectedEventIdRef.current, "new-draft");
  assert.equal(explicit.selectedEventsByClubRef.current.get("real"), "new-draft");
  const latest = switchHarness({ rememberedEvents: [["real", "active"]], events });
  assert.equal(await latest.refresh(false, { clubId: "real", preferLatest: true }), true);
  assert.equal(latest.selectedEventIdRef.current, "new-draft");
});

test("same-club refresh retains current round when no remembered selection exists", async () => {
  const harness = switchHarness({ events: [{ id: "newer-test", status: "draft" }, { id: "test-event", status: "open" }] });
  assert.equal(await harness.refresh(true), true);
  assert.equal(harness.selectedEventIdRef.current, "test-event");
  assert.equal(harness.selectedEventsByClubRef.current.get("test"), "test-event");
  assert.equal(harness.state.dashboard.event.status, "open");
});
