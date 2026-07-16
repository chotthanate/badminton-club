import assert from "node:assert/strict";
import test from "node:test";

import { getEventIdFromSearch } from "../src/liffSignup.js";

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
