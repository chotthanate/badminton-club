import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { buildSync } from "esbuild";
import { activeParticipantSignup, participantRemovalMessage, participantTimeLabel, participantTimeOptions, resolveParticipantMember } from "../src/participantControls.js";

const require = createRequire(import.meta.url);
const member = { id: "one", nickname: "ต้น", display_name: "Ton LINE", aliases: ["ต้นเก่า"], role: "member", skill_level: "N" };
const second = { id: "two", nickname: "น้องใหม่", display_name: "New LINE", role: "member", skill_level: "Rookie" };
const event = { id: "event", date: "2026-10-24", startTime: "21:00", endTime: "01:10", status: "closed" };
const dashboard = { members: [member, second], signups: [{ member_id: "one", status: "coming", arrival_time: "21:07:00" }], attendance: [{ member_id: "one", arrived: true, arrived_at: "21:07:00", left_at: "00:37:00" }], extraItems: [] };
const children = (node) => [node?.props?.children].flat(Infinity).filter((value) => value !== undefined && value !== null && value !== false);
const nodes = (node) => node && typeof node === "object" ? [node, ...children(node).flatMap(nodes)] : [];
const text = (node) => node === undefined || node === null || node === false ? "" : typeof node === "object" ? children(node).map(text).join("") : String(node);

function harness(file, props, repository = {}) {
  const compiled = buildSync({ entryPoints: [fileURLToPath(new URL(`../src/${file}`, import.meta.url))], bundle: true, format: "cjs", packages: "external", external: ["./clubRepository.js"], platform: "node", write: false, loader: { ".css": "empty" } }).outputFiles[0].text;
  const slots = [], effects = [], listeners = new Map();
  let cursor = 0, tree;
  const mockReact = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (value) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useId() { return `picker-${cursor++}`; },
    useMemo(run) { cursor++; return run(); },
    useEffect(run, deps) { const i = cursor++, previous = slots[i]; if (!previous || deps.some((dep, j) => !Object.is(dep, previous.deps[j]))) effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: run() }; }); },
  };
  const module = { exports: {} };
  const document = { addEventListener: (type, listener) => listeners.set(type, listener), removeEventListener: (type) => listeners.delete(type) };
  const window = { confirm: () => true };
  new Function("require", "module", "exports", "document", "window", compiled)((id) => id === "react" ? mockReact : id.endsWith("clubRepository.js") ? repository : require(id), module, module.exports, document, window);
  function render() { cursor = 0; tree = module.exports.default(props); effects.splice(0).forEach((effect) => effect()); return tree; }
  render();
  return { render, props, window, listeners, all: () => nodes(tree), find: (predicate) => nodes(tree).find(predicate), label: (label) => nodes(tree).find((node) => node.props["aria-label"] === label), text: () => text(tree) };
}

test("participant picker resolves exact aliases but refuses ambiguous same-name identities", () => {
  assert.equal(resolveParticipantMember([member], "ต้น เก่า", null), member);
  assert.equal(resolveParticipantMember([member], "คนใหม่", null), null);
  const duplicate = { ...second, nickname: member.nickname };
  assert.throws(() => resolveParticipantMember([member, duplicate], "ต้น", null), /พบชื่อซ้ำ/);
  assert.equal(resolveParticipantMember([member, duplicate], "ต้น", duplicate.id), duplicate);
});

test("only participant visibility excludes removed signups; supplied finance rows are never mutated", () => {
  const rows = [{ status: "coming" }, { status: "coming", removedAt: "now" }, { status: "coming", removed_at: "now" }, { status: "cancelled" }];
  const snapshot = structuredClone(rows);
  assert.equal(rows.filter(activeParticipantSignup).length, 1);
  assert.deepEqual(rows, snapshot);
});

test("time choices preserve off-grid arrival and departure, include exact end, order midnight correctly", () => {
  const arrival = participantTimeOptions({ ...event, current: "21:07", before: "00:37", includeEnd: false });
  const departure = participantTimeOptions({ ...event, current: "00:37", after: "23:45" });
  assert.ok(arrival.includes("21:07"));
  assert.ok(!arrival.includes("00:45"));
  assert.deepEqual(departure, ["00:00", "00:15", "00:30", "00:37", "00:45", "01:00", "01:10"]);
  assert.equal(participantTimeLabel("00:37", "21:00", "01:10"), "00:37 (วันถัดไป)");
  assert.equal(participantTimeLabel("21:07", "21:00", "01:10"), "21:07");
});

test("saved pre-start value remains visible rather than silently becoming start time", () => {
  const result = participantTimeOptions({ startTime: "22:00", endTime: "00:30", current: "21:00", includeEnd: false });
  assert.equal(result[0], "21:00");
  assert.equal(participantTimeLabel("21:00", "22:00", "00:30"), "21:00");
});

test("staff has one shared searchable add flow, uses existing ID and clears only after success", async () => {
  const calls = [];
  let success = false;
  const panel = harness("StaffParticipantsPanel.jsx", { dashboard, event: { ...event, status: "open" }, mutate: async (work) => { if (!success) return false; await work(); return true; } }, { addOperatorParticipant: async (value) => calls.push(value) });
  const picker = () => panel.find((node) => node.type?.name === "ParticipantPicker");
  assert.equal(panel.all().filter((node) => node.type === "form").length, 1);
  picker().props.onSelect(second); panel.render();
  await panel.find((node) => node.type === "form").props.onSubmit({ preventDefault() {} }); panel.render();
  assert.equal(picker().props.value, second.nickname);
  assert.equal(calls.length, 0);
  success = true;
  await panel.find((node) => node.type === "form").props.onSubmit({ preventDefault() {} }); panel.render();
  assert.deepEqual(calls, [{ eventId: "event", memberId: "two", nickname: null, skillLevel: "Rookie" }]);
  assert.equal(picker().props.value, "");
});

test("staff new name follows the same form and sends no existing member ID", async () => {
  const calls = [];
  const panel = harness("StaffParticipantsPanel.jsx", { dashboard, event: { ...event, status: "open" }, mutate: async (work) => { await work(); return true; } }, { addOperatorParticipant: async (value) => calls.push(value) });
  panel.find((node) => node.type?.name === "ParticipantPicker").props.onQuery("คนใหม่จริง"); panel.render();
  panel.label("ระดับมือผู้เล่น").props.onChange({ target: { value: "N" } }); panel.render();
  await panel.find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.deepEqual(calls, [{ eventId: "event", memberId: null, nickname: "คนใหม่จริง", skillLevel: "N" }]);
});

test("staff arrival/departure handlers capture selected values before queued work and preserve midnight", async () => {
  const calls = [], work = [];
  const panel = harness("StaffParticipantsPanel.jsx", { dashboard, event, mutate: (action) => work.push(action) }, { updateOperatorSignupArrival: async (value) => calls.push(value), updateOperatorAttendance: async (value) => calls.push(value) });
  assert.equal(panel.label("เวลามา ต้น").props.value, "21:07");
  assert.equal(panel.label("เวลากลับ ต้น").props.value, "00:37");
  const change = { target: { value: "00:15" } };
  panel.label("เวลามา ต้น").props.onChange(change); change.target.value = "wrong";
  panel.label("เวลากลับ ต้น").props.onChange({ target: { value: "01:10" } });
  await work[0](); await work[1]();
  assert.equal(calls[0].arrivalTime, "00:15");
  assert.equal(calls[1].leftAt, "01:10");
  assert.equal(calls[1].arrivedAt, "21:07");
});

test("safe removal requires warning confirmation and retains existing API identity", async () => {
  const calls = [], prompts = [];
  const panel = harness("StaffParticipantsPanel.jsx", { dashboard, event, mutate: async (work, message, options) => { calls.push(options.actionKey); await work(); return true; } }, { removeOperatorParticipant: async (value) => calls.push(value) });
  panel.window.confirm = (message) => { prompts.push(message); return false; };
  await panel.label("ลบ ต้น").props.onClick();
  assert.equal(calls.length, 0);
  assert.equal(prompts[0], participantRemovalMessage("ต้น"));
  assert.match(prompts[0], /เกมที่เล่นแล้ว.*การชำระเงินยังเก็บไว้/);
  panel.window.confirm = () => true;
  await panel.label("ลบ ต้น").props.onClick();
  assert.deepEqual(calls, ["player:remove:one", { eventId: "event", memberId: "one" }]);
});

test("removed staff player stays out of active roster but can be selected for restore", () => {
  const removed = { ...dashboard, signups: [{ ...dashboard.signups[0], removed_at: "2026-10-25T00:00:00Z" }] };
  const panel = harness("StaffParticipantsPanel.jsx", { dashboard: removed, event, mutate() {} });
  assert.equal(panel.label("เช็กชื่อ ต้น"), undefined);
  const picker = panel.find((node) => node.type?.name === "ParticipantPicker");
  assert.equal(picker.props.participantIds.has("one"), false);
  assert.ok(picker.props.members.some((entry) => entry.id === "one"));
});

test("picker displays all existing matches, keeps touch blur open, filters and refuses duplicate-in-round selection", () => {
  const selected = [], queries = [];
  const panel = harness("ParticipantPicker.jsx", { members: [member, second], participantIds: new Set(["one"]), value: "", onQuery: (query) => queries.push(query), onSelect: (entry) => selected.push(entry) });
  panel.label("ค้นหาหรือเพิ่มผู้เล่น").props.onFocus(); panel.render();
  assert.equal(panel.all().filter((node) => node.props.role === "option").length, 2);
  panel.find((node) => node.props.className === "participant-picker").props.onBlur({ relatedTarget: null }); panel.render();
  assert.equal(panel.label("ค้นหาหรือเพิ่มผู้เล่น").props["aria-expanded"], true);
  panel.all().find((node) => node.props.role === "option" && text(node).includes("ต้น")).props.onClick();
  assert.equal(selected.length, 0);
  panel.label("ค้นหาหรือเพิ่มผู้เล่น").props.onChange({ target: { value: "New LINE" } });
  panel.props.value = queries.at(-1); panel.render();
  assert.equal(panel.all().filter((node) => node.props.role === "option").length, 1);
  panel.find((node) => node.props.role === "option").props.onClick(); panel.render();
  assert.deepEqual(selected, [second]);
  assert.equal(panel.label("ค้นหาหรือเพิ่มผู้เล่น").props["aria-expanded"], false);
});

test("owner actual add handler restores a removed identity without overwriting old times or bills", async () => {
  const source = readFileSync(new URL("../src/BadmintonApp.jsx", import.meta.url), "utf8");
  const start = source.indexOf("  async function addMember(eventObject)");
  const end = source.indexOf("\n  async function addCatalogItem", start);
  const calls = [];
  const context = { name: "ต้น", selectedMemberId: "one", savedMembers: [member], removedMemberIds: new Set(["one"]), participantIds: new Set(), event: { ...event, signups: [{ memberId: "one", removedAt: "now" }] }, normalizeMemberSearch: (value) => value.trim(), resolveParticipantMember, mutate: async (work) => { await work(); return true; }, restoreParticipant: async (value) => calls.push(value), memberName: (value) => value.nickname, setName: (value) => calls.push(["name", value]), setSelectedMemberId() {}, setNewMemberSkill() {} };
  const action = new Function(...Object.keys(context), `${source.slice(start, end)}; return addMember;`)(...Object.values(context));
  await action({ preventDefault() {} });
  assert.deepEqual(calls, [{ eventId: "event", memberId: "one" }, ["name", ""]]);
});

test("owner actual arrival handler issues one atomic operation even for a closed midnight round", async () => {
  const source = readFileSync(new URL("../src/BadmintonApp.jsx", import.meta.url), "utf8");
  const start = source.indexOf("          function updateArrival(nextArrival)");
  const end = source.indexOf("\n          function updateDeparture", start);
  const calls = [], queued = [];
  const context = { event, member, participantName: member.nickname, mutate: (work, message, options) => { queued.push(work); calls.push(options); }, updateSignupArrival: async (value) => calls.push(value) };
  const action = new Function(...Object.keys(context), `${source.slice(start, end)}; return updateArrival;`)(...Object.values(context));
  action("00:15");
  assert.equal(queued.length, 1);
  await queued[0]();
  assert.deepEqual(calls, [{ actionKey: "arrival:one" }, { eventId: "event", memberId: "one", arrivalTime: "00:15" }]);
});

test("staff add controls stay disabled while their save is pending", () => {
  const panel = harness("StaffParticipantsPanel.jsx", { dashboard, event, pendingKeys: ["player:add:event:two"], mutate() {} });
  assert.equal(panel.find((node) => node.type?.name === "ParticipantPicker").props.disabled, true);
  assert.equal(panel.label("ระดับมือผู้เล่น").props.disabled, true);
  assert.equal(panel.find((node) => node.type === "button" && text(node).includes("กำลังเพิ่ม")).props.disabled, true);
});

test("participant fixture add/remove/restore preserves the original signup and completed games", async () => {
  const previous = globalThis.window;
  globalThis.window = { location: { search: "?overnight=1" } };
  let fixture;
  try { fixture = await import(`./browser/admin-fixture-state.js?participant-test=${Date.now()}`); }
  finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
  const { fixtureCall } = fixture;
  const [context] = await fixtureCall("getAdminContexts", []);
  const [round] = await fixtureCall("listClubEvents", [context.club_id]);
  const read = () => fixtureCall("loadDashboard", [context.club_id, round.id]);
  const before = await read();
  const memberId = before.signups[2].member_id;
  await fixtureCall("removeParticipant", [{ eventId: round.id, memberId }]);
  const removed = await read();
  assert.ok(removed.signups[2].removed_at);
  assert.deepEqual(removed.queueMatches, before.queueMatches);
  assert.deepEqual(removed.queueMatchPlayers, before.queueMatchPlayers);
  await fixtureCall("addOperatorParticipant", [{ eventId: round.id, memberId, skillLevel: "N" }]);
  const restored = await read();
  assert.equal(restored.signups[2].removed_at, null);
  assert.equal(restored.signups[2].arrival_time, before.signups[2].arrival_time);
  assert.deepEqual(restored.queueMatchPlayers, before.queueMatchPlayers);
  const created = await fixtureCall("addLineMember", [{ clubId: context.club_id, displayName: "ผู้เล่นทดสอบใหม่", skillLevel: "N" }]);
  assert.ok(created.id);
  await fixtureCall("updateSignup", [{ clubId: context.club_id, eventId: round.id, memberId: created.id, status: "coming", arrivalTime: "21:00", skillLevel: "N" }]);
  assert.equal((await read()).signups.length, before.signups.length + 1);
});
