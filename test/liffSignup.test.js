import assert from "node:assert/strict";
import test from "node:test";

import {
  buildArrivalTimeOptions,
  buildLiveQueueUrl,
  buildTestPaymentLiffUrl,
  buildTestSignupLiffUrl,
  getEventIdFromSearch,
  getLiffTestContext,
  isLatestEventSearch,
  sortRosterBySignupOrder,
} from "../src/liffSignup.js";

test("LIFF state event takes priority over a stale direct event", () => {
  const search = "?liff=signup&event_id=old-round&liff.state=%3Fevent_id%3Dnew-round";
  assert.equal(getEventIdFromSearch(search), "new-round");
});

test("direct event remains available outside a LIFF redirect", () => {
  assert.equal(getEventIdFromSearch("?liff=signup&event_id=current-round"), "current-round");
});

test("missing event returns null", () => {
  assert.equal(getEventIdFromSearch("?liff=signup"), null);
});

test("permanent latest link survives a LIFF redirect", () => {
  assert.equal(isLatestEventSearch("?liff.state=%3Flatest%3D1"), true);
  assert.equal(isLatestEventSearch("?latest=1"), true);
});

test("test context survives a LIFF redirect", () => {
  const context = getLiffTestContext("?liff=signup&liff.state=%3Fevent_id%3Devent-1%26test%3D1%26test_club_id%3Dclub-1");
  assert.deepEqual(context, { testMode: true, testClubId: "club-1" });
});

test("test LIFF links keep the event and isolated club", () => {
  assert.equal(
    buildTestSignupLiffUrl({ liffId: "123-demo", eventId: "event-1", testClubId: "club-1" }),
    "https://liff.line.me/123-demo?event_id=event-1&test=1&test_club_id=club-1",
  );
  assert.equal(
    buildTestPaymentLiffUrl({ liffId: "123-demo", testClubId: "club-1" }),
    "https://liff.line.me/123-demo?mode=payment&test=1&test_club_id=club-1",
  );
});

test("live queue links use latest production or an isolated test round", () => {
  assert.equal(
    buildLiveQueueUrl({ origin: "https://example.com/badminton-club/" }),
    "https://example.com/badminton-club/?liff=live&latest=1",
  );
  assert.equal(
    buildLiveQueueUrl({ origin: "https://example.com/badminton-club/", eventId: "event-1", testClubId: "club-1" }),
    "https://example.com/badminton-club/?liff=live&event_id=event-1&test=1&test_club_id=club-1",
  );
  assert.equal(
    buildLiveQueueUrl({ origin: "https://example.com/badminton-club/", language: "en" }),
    "https://example.com/badminton-club/?liff=live&latest=1&lang=en",
  );
});

test("arrival time options advance by 15 minutes and stop before session end", () => {
  assert.deepEqual(buildArrivalTimeOptions("21:00", "00:00"), [
    "21:00", "21:15", "21:30", "21:45",
    "22:00", "22:15", "22:30", "22:45",
    "23:00", "23:15", "23:30", "23:45",
  ]);
});

test("arrival time options reject malformed times", () => {
  assert.deepEqual(buildArrivalTimeOptions("bad", "00:00"), []);
});

test("member signup roster always displays the first signup as number one", () => {
  const roster = [
    { name: "คนที่ลงล่าสุด", signupOrder: 3 },
    { name: "คนที่ลงคนแรก", signupOrder: 1 },
    { name: "คนที่ลงคนที่สอง", signupOrder: 2 },
  ];

  assert.deepEqual(sortRosterBySignupOrder(roster).map((entry) => entry.name), [
    "คนที่ลงคนแรก",
    "คนที่ลงคนที่สอง",
    "คนที่ลงล่าสุด",
  ]);
});
