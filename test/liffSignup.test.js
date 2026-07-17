import assert from "node:assert/strict";
import test from "node:test";

import { buildArrivalTimeOptions, getEventIdFromSearch } from "../src/liffSignup.js";

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

test("arrival time options advance by 30 minutes and stop before session end", () => {
  assert.deepEqual(buildArrivalTimeOptions("21:00", "00:00"), [
    "21:00", "21:30", "22:00", "22:30", "23:00", "23:30",
  ]);
});

test("arrival time options reject malformed times", () => {
  assert.deepEqual(buildArrivalTimeOptions("bad", "00:00"), []);
});
