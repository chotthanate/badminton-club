import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { archiveMemberBlockedReason, filterDirectoryMembers, hasMemberDraft, memberInLiveQueue, mergeMembersBlockedReason, preferredMergeTarget, runDirectoryMutation, toggleMergeMember } from "../src/memberDirectory.js";

const member = (id, patch = {}) => ({ id, role: "member", active: true, nickname: id, ...patch });
const modal = readFileSync(new URL("../src/MemberDirectoryModal.jsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/BadmintonApp.jsx", import.meta.url), "utf8");

test("directory searches current names, LINE and old aliases without showing inactive or operator accounts", () => {
  const rows = [member("a", { nickname: "ต้น", display_name: "TON LINE", aliases: ["Walk-in ต้น"] }), member("b", { active: false }), member("c", { role: "owner" })];
  for (const query of ["ต้น", "ton", "walk in"]) assert.deepEqual(filterDirectoryMembers(rows, query).map((row) => row.id), ["a"]);
  assert.equal(filterDirectoryMembers(rows).length, 1);
});

test("manual merge selects exactly two distinct identities and supports deselection", () => {
  assert.deepEqual(toggleMergeMember(["a"], "a"), []);
  assert.deepEqual(toggleMergeMember(["a"], "b"), ["a", "b"]);
  assert.deepEqual(toggleMergeMember(["a", "b"], "c"), ["a", "b"]);
});

test("canonical suggestion prefers LINE identity then older registration, without mutating inputs", () => {
  const rows = [member("old", { created_at: "2020" }), member("line", { created_at: "2025", line_user_id: "line" })];
  assert.equal(preferredMergeTarget(rows), "line");
  assert.equal(rows[0].id, "old");
  assert.equal(preferredMergeTarget([member("new", { created_at: "2025" }), member("old", { created_at: "2020" })]), "old");
});

test("live queue guard includes draft, approved, playing and reserved queue-player records", () => {
  for (const status of ["draft", "approved", "playing"]) assert.equal(memberInLiveQueue("a", { queueMatches: [{ id: "q", status }], queueMatchPlayers: [{ member_id: "a", match_id: "q" }] }), true);
  assert.equal(memberInLiveQueue("a", { queuePlayers: [{ member_id: "a", status: "reserved" }] }), true);
  assert.equal(memberInLiveQueue("a", { queueMatches: [{ id: "q", status: "completed" }], queueMatchPlayers: [{ member_id: "a", match_id: "q" }] }), false);
});

test("archive rejects current open/draft participants but keeps closed-round history eligible", () => {
  for (const status of ["draft", "open"]) assert.match(archiveMemberBlockedReason(member("a"), { event: { status }, signups: [{ member_id: "a", status: "coming" }] }), /รอจบรอบ/);
  assert.match(archiveMemberBlockedReason(member("a"), { event: { status: "open" }, attendance: [{ member_id: "a", arrived: true, left_at: "20:00" }] }), /รอจบรอบ/);
  assert.match(archiveMemberBlockedReason(member("a"), { event: { status: "open" }, signups: [{ member_id: "a", status: "cancelled" }] }), /รอจบรอบ/);
  assert.match(archiveMemberBlockedReason(member("a"), { event: { status: "open" }, queuePlayers: [{ member_id: "a", status: "waiting" }] }), /รอจบรอบ/);
  assert.equal(archiveMemberBlockedReason(member("a"), { event: { status: "closed" }, signups: [{ member_id: "a", status: "coming" }] }), "");
});

test("archive cannot use stale removed or operator identities", () => {
  assert.ok(archiveMemberBlockedReason(undefined, {}));
  assert.ok(archiveMemberBlockedReason(member("a", { active: false }), {}));
  assert.ok(archiveMemberBlockedReason(member("a", { role: "owner" }), {}));
});

test("merge rejects different LINE/profile identities, missing selection, and live queues", () => {
  assert.match(mergeMembersBlockedReason([member("a", { line_user_id: "one" }), member("b", { line_user_id: "two" })], {}), /คนละบัญชี LINE/);
  assert.match(mergeMembersBlockedReason([member("a", { profile_id: "one" }), member("b", { profile_id: "two" })], {}), /คนละบัญชีผู้ใช้/);
  assert.ok(mergeMembersBlockedReason([member("a")], {}));
  assert.ok(mergeMembersBlockedReason([member("a"), member("a")], {}));
  assert.match(mergeMembersBlockedReason([member("a"), member("b")], { queuePlayers: [{ member_id: "a", status: "playing" }] }), /กำลังเล่น/);
  assert.equal(mergeMembersBlockedReason([member("a"), member("b", { line_user_id: "line" })], {}), "");
});

test("only unsaved member drafts block archive/merge, storage failure is safe", () => {
  const storage = (value) => ({ getItem: () => JSON.stringify(value) });
  assert.equal(hasMemberDraft("a", storage({ base: '{"name":"old"}', value: { name: "new" } })), true);
  assert.equal(hasMemberDraft("a", storage({ base: '{"name":"old"}', value: { name: "old" } })), false);
  assert.equal(hasMemberDraft("a", { getItem() { throw Error("denied"); } }), false);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  try {
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
    assert.equal(hasMemberDraft("a"), false);
  } finally {
    if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
    else delete globalThis.sessionStorage;
  }
});

test("successful directory save returns success even when parent reports refresh warning separately", async () => {
  const action = () => {};
  const result = await runDirectoryMutation(async (fn, notice, options) => { assert.equal(fn, action); assert.equal(options.actionKey, "members:merge"); return true; }, action, "saved", { actionKey: "members:merge" });
  assert.deepEqual(result, { saved: true, error: "" });
});

test("callback error, thrown error and bare false preserve explicit failure for the modal", async () => {
  assert.deepEqual(await runDirectoryMutation(async (_fn, _notice, options) => { options.onError(Error("server guard")); return false; }, () => {}, ""), { saved: false, error: "server guard" });
  assert.deepEqual(await runDirectoryMutation(async () => { throw Error("offline"); }, () => {}, ""), { saved: false, error: "offline" });
  assert.match((await runDirectoryMutation(async () => false, () => {}, "")).error, /ข้อมูลที่เลือกยังอยู่/);
});

test("merge/archive require explicit confirmation and keep selection/review intact on mutation failure", () => {
  assert.match(modal, /if \(!confirmed \|\| mergeBlocked \|\| !source \|\| !target\) return/);
  assert.match(modal, /if \(!confirmed \|\| archiveBlocked \|\| !archiveMember\) return/);
  assert.match(modal, /if \(saved\) \{ setHiddenIds[\s\S]*setSelectedIds\(\[\]\)[\s\S]*backToList\(\)/);
  assert.match(modal, /<footer className="member-directory-footer">[\s\S]*role="alert"/);
  assert.doesNotMatch(modal, /window\.confirm|window\.alert|\.from\("club_members"\)/);
  assert.match(modal, /busyRef\.current\) return false/);
});

test("directory is the only merge entry, all-member title and safe legacy archive wrapper are wired", () => {
  assert.match(app, /<MemberDirectoryModal context=\{context\} dashboard=\{dashboard\}/);
  assert.match(app, /เปิดรายชื่อผู้เล่นทั้งหมด/);
  assert.doesNotMatch(app, /mergeSourceId|mergeTargetId|function mergeDuplicateMember|className="badminton-member-merge-form"/);
  assert.match(app, /mutate\(\(\) => archiveClubMember\(editingMember.id\)[\s\S]*actionKey: `members:archive:/);
});

test("isolated directory fixture supports retry, guards current members and preserves archived records", async () => {
  const previous = globalThis.window;
  globalThis.window = { location: { search: "?directory=1" } };
  let fixture;
  try { fixture = await import(new URL("./browser/admin-fixture-state.js?directory-regression", import.meta.url)); }
  finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
  const { fixtureCall, armFailure, mockSupabase } = fixture;
  const [context] = await fixtureCall("getAdminContexts", []);
  const [event] = await fixtureCall("listClubEvents", [context.club_id]);
  const read = () => fixtureCall("loadDashboard", [context.club_id, event.id]);
  armFailure();
  await assert.rejects(fixtureCall("mergeClubMembers", [{ sourceMemberId: "local-member-8", targetMemberId: "local-member-7" }]), /จำลองบันทึกล้มเหลว/);
  assert.equal((await read()).members.length, 18);
  await fixtureCall("mergeClubMembers", [{ sourceMemberId: "local-member-8", targetMemberId: "local-member-7" }]);
  const merged = await read();
  assert.equal(merged.members.length, 17);
  assert.ok(merged.members.find((row) => row.id === "local-member-7").aliases.includes("Somchai Walk-in"));
  await assert.rejects(fixtureCall("archiveClubMember", ["local-member-1"]), /ยังอยู่ในรอบ/);
  await fixtureCall("archiveClubMember", ["local-member-11"]);
  const archived = await read();
  assert.equal(archived.members.length, 17);
  assert.equal(archived.members.find((row) => row.id === "local-member-11").active, false);
  assert.equal(archived.signups.length, 6);
  assert.throws(() => mockSupabase.rpc("archive_club_member"), /blocked/);
});
