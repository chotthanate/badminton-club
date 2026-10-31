import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bookingDuration, bookingEndLabel, bookingMinutes, bookingTimeOptions, clearLegacyCourtWork, courtNameSuffix, extendedBookingEnd, legacyCourtWork, normalizedCourtForm, normalizedCourtName, runCourtBookingMutation, safeCourtStorage } from "../src/courtBooking.js";

test("court extension crosses midnight without changing the booked start or event date", () => {
  const court = { startsAt: "21:00", endsAt: "00:00" };
  assert.equal(bookingDuration(court.startsAt, court.endsAt), 180);
  assert.equal(extendedBookingEnd(court), "00:30");
  assert.deepEqual(court, { startsAt: "21:00", endsAt: "00:00" });
  assert.equal(extendedBookingEnd({ ...court, endsAt: "00:30" }), "01:00");
  assert.equal(bookingEndLabel("00:30", "21:00"), "00:30 · วันถัดไป");
  assert.equal(bookingEndLabel("23:30", "21:00"), "23:30");
});

test("end options are chronological across midnight and preserve non-half-hour bookings", () => {
  const values = bookingTimeOptions("00:15", "21:00");
  assert.deepEqual(values.slice(0, 8).map((option) => option.value), ["21:30", "22:00", "22:30", "23:00", "23:30", "00:00", "00:15", "00:30"]);
  assert.match(values.find((option) => option.value === "00:30").label, /วันถัดไป/);
  assert.ok(!values.some((option) => option.value === "21:00"));
  assert.equal(bookingTimeOptions("00:00", "21:00", 180)[0].value, "00:00");
  assert.ok(bookingTimeOptions("00:00", "21:00", 180).every((option) => bookingDuration("21:00", option.value) >= 180));
});

test("invalid time and a full-day rollover cannot silently shrink a booking", () => {
  for (const value of ["", "25:00", "24:30", "12:60", "oops"]) assert.equal(bookingMinutes(value), null);
  assert.equal(bookingMinutes("24:00"), 0);
  assert.equal(extendedBookingEnd({ startsAt: "21:00", endsAt: "20:30" }), null);
  assert.equal(extendedBookingEnd({ startsAt: "21:00", endsAt: "21:00" }), null);
  assert.equal(extendedBookingEnd({ startsAt: "21:00", endsAt: "00:00" }, -30), null);
});

test("saved court values normalize both repository rows and mapped UI courts", () => {
  assert.deepEqual(normalizedCourtForm({ court_name: "Court", starts_at: "21:00:00", ends_at: "00:30:00" }), { name: "Court", startsAt: "21:00", endsAt: "00:30" });
});

test("court editor shows a fixed Thai prefix and stores one normalized name", () => {
  assert.equal(courtNameSuffix("คอร์ท 13"), "13");
  assert.equal(courtNameSuffix(" 8 "), "8");
  assert.equal(normalizedCourtName("13"), "คอร์ท 13");
  assert.equal(normalizedCourtName("คอร์ท 13"), "คอร์ท 13");
  assert.equal(normalizedCourtName(""), "");
});

test("mutation captures authoritative returned end time even when parent returns only boolean", async () => {
  const row = { id: "court", ends_at: "01:00:00" };
  let seen;
  const result = await runCourtBookingMutation(async (action, message, options) => { seen = { message, options }; await action(); return true; }, async () => row, "saved", "court:event:court");
  assert.equal(result.saved, true);
  assert.equal(result.result, row);
  assert.equal(seen.options.actionKey, "court:event:court");
  assert.equal(typeof seen.options.onError, "function");
});

test("save failure, offline callback and thrown exception remain visible without discarding work", async () => {
  const action = async () => { throw Error("must not run"); };
  const reported = await runCourtBookingMutation(async (_action, _message, options) => { options.onError(Error("offline")); return false; }, action, "", "court");
  assert.equal(reported.saved, false); assert.equal(reported.error, "offline");
  const fallback = await runCourtBookingMutation(async () => false, action, "", "court");
  assert.match(fallback.error, /ข้อมูลที่กรอกยังอยู่/);
  const thrown = await runCourtBookingMutation(async () => { throw Error("network failure"); }, action, "", "court");
  assert.equal(thrown.error, "network failure");
});

function memoryStorage(values = {}) {
  return { getItem: (key) => values[key] ?? null, setItem: (key, value) => { values[key] = value; }, removeItem: (key) => { delete values[key]; } };
}
test("old owner court drafts survive upgrade and saving one cannot discard another court", () => {
  const base = { one: { court_name: "one", starts_at: "21:00", ends_at: "00:00" }, two: { court_name: "two", starts_at: "21:00", ends_at: "00:00" } };
  const value = { one: { ...base.one, ends_at: "00:30" }, two: { ...base.two, court_name: "renamed" } };
  const storage = memoryStorage({ "badminton:courts:event": JSON.stringify({ base: JSON.stringify(base), value }) });
  assert.equal(legacyCourtWork("event", "one", storage).form.endsAt, "00:30");
  clearLegacyCourtWork("event", "one", storage);
  assert.equal(legacyCourtWork("event", "one", storage), null);
  assert.equal(legacyCourtWork("event", "two", storage).form.name, "renamed");
  clearLegacyCourtWork("event", "two", storage);
  assert.equal(storage.getItem("badminton:courts:event"), null);
});
test("blocked browser storage getter does not crash the court panel", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw Error("SecurityError"); } });
  try { assert.equal(safeCourtStorage("sessionStorage"), null); assert.equal(legacyCourtWork("event", "court"), null); assert.doesNotThrow(() => clearLegacyCourtWork("event", "court")); }
  finally { if (descriptor) Object.defineProperty(globalThis, "sessionStorage", descriptor); else delete globalThis.sessionStorage; }
});

const panel = readFileSync(new URL("../src/CourtBookingPanel.jsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/BadmintonApp.jsx", import.meta.url), "utf8");
test("owner and staff use the same court panel with playing status and no closed-round blanket block", () => {
  assert.match(app, /OperatorCourtControls dashboard=\{dashboard\} event=\{mappedEvent\}/);
  assert.match(app, /OperatorCourtControls dashboard=\{dashboard\} event=\{appEvent\} isStaff isTestMode=\{context.clubs.is_test\}/);
  assert.match(panel, /const canWrite = \["draft", "open", "closed"\].includes\(event.status\)/);
  const button = panel.match(/<button aria-label=\{`ต่อเวลา[^\n]+/)[0];
  assert.match(button, /disabled=\{Boolean\(busy\) \|\| !canWrite \|\| !nextEnd\}/);
  assert.doesNotMatch(button, /disabled=\{[^}]*isPlaying|disabled=\{[^}]*expired/);
});
test("same-id extension uses server atomic delta; active game can extend end but cannot shift start", () => {
  assert.match(panel, /extendCourtBooking\(\{ eventId: event.id, courtId: court.id, minutes: 30 \}\)/);
  assert.match(panel, /if \(busyRef.current \|\| !canWrite\) return/);
  assert.match(panel, /busyRef.current = true/);
  assert.match(panel, /label>เริ่ม<BookingTimeSelect disabled=\{Boolean\(busy\) \|\| !canWrite \|\| isPlaying\}/);
  assert.match(panel, /label>จบ<BookingTimeSelect disabled=\{Boolean\(busy\) \|\| !canWrite\}/);
  assert.doesNotMatch(panel, /minimumDuration=\{isPlaying/);
  assert.doesNotMatch(panel, /updateEvent\(|replaceEventCourts|updateCourts\(/);
  assert.match(panel, /event.status !== "closed" \? <button aria-label=\{`ลบ/);
});

test("live-court migration permits an earlier end while keeping a playing start immutable", () => {
  const migration = readFileSync(new URL("../supabase/migrations/20261031183000_allow_live_court_end_corrections.sql", import.meta.url), "utf8");
  assert.match(migration, /and next_starts_at<>old_court\.starts_at/);
  assert.doesNotMatch(migration, /new_duration<old_duration/);
  assert.match(migration, /แก้เวลาจบได้ แต่ห้ามเปลี่ยนเวลาเริ่ม/);
});

test("isolated closed staff fixture extends same court preserving status, rosters, games and bills", async () => {
  const previous = globalThis.window; globalThis.window = { location: { search: "?courts=1&closed=1&staff=1" } };
  let fixture;
  try { fixture = await import(new URL("./browser/admin-fixture-state.js?court-booking", import.meta.url)); }
  finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
  const read = () => fixture.fixtureCall("loadStaffDashboard", ["local-admin-fixture-club"]);
  const before = await read();
  assert.equal(before.event.status, "closed");
  const updated = await fixture.fixtureCall("extendCourtBooking", [{ eventId: before.event.id, courtId: before.courts[0].id, minutes: 30 }]);
  const after = await read();
  assert.equal(updated.ends_at, "00:30:00"); assert.equal(after.event.id, before.event.id); assert.equal(after.event.status, "closed");
  assert.equal(after.courts[0].id, before.courts[0].id); assert.equal(after.courts[0].starts_at, "21:00:00");
  for (const key of ["signups", "attendance", "queueMatches", "queueMatchPlayers", "payments", "paymentSlips"]) assert.deepEqual(after[key], before[key]);
});
