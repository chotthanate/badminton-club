import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/BadmintonApp.jsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../src/AdminSettingsPanel.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/admin-improvements.css", import.meta.url), "utf8");
const baseStyles = readFileSync(new URL("../src/badminton.css", import.meta.url), "utf8");
function section(start, end) {
  const from = app.indexOf(start);
  const to = app.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `source boundary exists: ${start}`);
  return app.slice(from, to);
}

// The server preparation/authorization semantics are covered by the migration
// tests. These guards ensure every UI entry point actually uses that safe path.
test("entering sandbox prepares the test round then loads that exact club and round", () => {
  const enter = section("async function switchTestMode()", "async function resetDemo()");
  assert.match(enter, /enqueue\("sandbox:switch"/);
  assert.match(enter, /existingTestContext\?\.club_id \|\| \(await createTestClub/);
  assert.match(enter, /const eventId = await prepareTestRound\(\{ clubId \}\);\s*(?:const refreshed = )?await refresh\(false, \{ clubId, eventId, throwOnError: true \}\)/);
  assert.match(enter, /setActiveTab\("queue"\)/);
  const returningToReal = enter.slice(enter.indexOf("if (context?.clubs.is_test)"), enter.indexOf("} else {"));
  assert.doesNotMatch(returningToReal, /prepareTestRound|createTestClub/);
});

test("resetting sandbox prepares a replacement round and selects it only after save", () => {
  const reset = section("async function resetDemo()", "async function addDemoQueuePlayers()");
  assert.match(reset, /if \(!context\?\.clubs.is_test\) return/);
  assert.match(reset, /window\.confirm/);
  assert.match(reset, /await resetTestClub\(context.club_id\);\s*preparedEventId = await prepareTestRound/);
  assert.match(reset, /actionKey: "sandbox:reset", selectEventId: \(\) => preparedEventId/);
  assert.match(reset, /if \(saved\) setActiveTab\("queue"\)/);
});

test("adding demo players prepares a playable round instead of trusting a closed selected round", () => {
  const add = section("async function addDemoQueuePlayers()", "async function copyTestLink(kind)");
  assert.match(add, /if \(!context\?\.clubs.is_test\) return/);
  assert.ok(add.indexOf("await prepareTestRound") < add.indexOf("await addRandomTestPlayers"));
  assert.match(add, /addRandomTestPlayers\(\{\s*clubId: context.club_id,\s*eventId: preparedEventId,/);
  assert.match(add, /actionKey: "sandbox:add-players", selectEventId: \(\) => preparedEventId/);
  assert.doesNotMatch(add, /dashboard\.event.*status|eventId: dashboard\.event/);
  const settingsPanel = app.match(/<AdminSettingsPanel\b[\s\S]*?\n\s*\/>/)?.[0];
  assert.ok(settingsPanel, "settings component remains connected");
  assert.match(settingsPanel, /onAddTestPlayers=\{addDemoQueuePlayers\}/);
  const addButton = settings.match(/<SettingsRow\b[^>]*onClick=\{onAddTestPlayers\}[^>]*\/>/)?.[0];
  assert.ok(addButton, "the demo-player action remains available in settings");
  assert.match(addButton, /disabled=\{busy\}/);
  assert.doesNotMatch(addButton, /status|hasEvent|dashboard\.event/);
});

test("creating a sandbox round reuses the prepare RPC and bypasses only the normal create form", () => {
  const create = section("function CreateEventCard(", "await mutate(async () => {\n      const created = await createEvent");
  assert.match(create, /if \(context.clubs.is_test\)/);
  assert.match(create, /preparedEventId = await prepareTestRound\(\{ clubId: context.club_id \}\)/);
  assert.match(create, /selectEventId: \(\) => preparedEventId/);
  assert.match(create, /return;\s*\}/);
  assert.match(app, /<QueuePanel[^>]*isTestMode=\{Boolean\(context.clubs.is_test\)\}/);
});

test("live sandbox link tracks the current test club instead of freezing an event id", () => {
  const copy = section("async function copyTestLink(kind)", "if (loading && !dashboard)");
  assert.match(copy, /kind !== "live" && !liffId/);
  assert.match(copy, /buildLiveQueueUrl\(\{ testClubId: context.club_id \}\)/);
  assert.doesNotMatch(copy, /buildLiveQueueUrl\(\{[^}]*eventId/);
});

test("directory duplicates and editable members share one keyboard-accessible scroll region", () => {
  const directory = readFileSync(new URL("../src/MemberDirectoryModal.jsx", import.meta.url), "utf8");
  assert.match(app, /memberDirectoryOpen \? <MemberDirectoryModal/);
  assert.match(directory, /className="member-directory-scroll" role="region" aria-label="รายการสมาชิกและรายชื่อซ้ำ" tabIndex=\{0\}/);
  assert.match(directory, /className="member-directory-scroll"[\s\S]*className="badminton-member-directory-duplicates"[\s\S]*className="member-directory-inline-list"[\s\S]*<MemberDirectoryRow/);
  assert.equal((directory.match(/className="member-directory-scroll"/g) || []).length, 1);
  assert.ok(directory.indexOf('className="badminton-member-directory-search"') < directory.indexOf('className="member-directory-scroll"'));
});

test("directory scroll area can shrink inside a fixed-height flex modal on mobile", () => {
  const scrollRule = styles.match(/\.member-directory-scroll\s*\{([^}]+)\}/)?.[1];
  assert.ok(scrollRule);
  assert.match(scrollRule, /flex:\s*1 1 0/);
  assert.match(scrollRule, /min-height:\s*0/);
  assert.match(scrollRule, /overflow-y:\s*auto/);
  assert.match(scrollRule, /overscroll-behavior:\s*contain/);
  assert.match(scrollRule, /-webkit-overflow-scrolling:\s*touch/);
  const modalRule = baseStyles.match(/\.badminton-member-directory-modal\s*\{([^}]+)\}/)?.[1];
  assert.match(modalRule, /height:\s*min\(90dvh, 900px\)/);
  assert.match(modalRule, /display:\s*flex/);
  assert.match(modalRule, /flex-direction:\s*column/);
  assert.match(styles, /\.badminton-member-directory-header, \.badminton-member-directory-search\s*\{[^}]*flex-shrink:\s*0/);
});
