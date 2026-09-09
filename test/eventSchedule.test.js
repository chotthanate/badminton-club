import assert from "node:assert/strict";
import test from "node:test";

import {
  buildArrivalTimeOptionsForEvent,
  normalizeArrivalTimeForEvent,
  sessionBoundsForEvent,
} from "../supabase/functions/_shared/eventSchedule.js";

test("court schedule overrides a stale earlier event start", () => {
  const event = {
    starts_at: "21:00:00",
    ends_at: "00:00:00",
    event_courts: [
      { starts_at: "22:00:00", ends_at: "01:00:00" },
      { starts_at: "22:00:00", ends_at: "01:00:00" },
    ],
  };

  assert.deepEqual(sessionBoundsForEvent(event), { startTime: "22:00", endTime: "01:00" });
  assert.equal(buildArrivalTimeOptionsForEvent(event)[0], "22:00");
  assert.equal(buildArrivalTimeOptionsForEvent(event).includes("21:00"), false);
  assert.equal(normalizeArrivalTimeForEvent(event, "21:00:00"), "22:00");
});

test("court schedule supports sessions whose courts begin after midnight", () => {
  const event = {
    starts_at: "22:00:00",
    ends_at: "02:00:00",
    event_courts: [
      { starts_at: "22:00:00", ends_at: "01:00:00" },
      { starts_at: "00:00:00", ends_at: "02:00:00" },
    ],
  };

  assert.deepEqual(sessionBoundsForEvent(event), { startTime: "22:00", endTime: "02:00" });
  assert.deepEqual(buildArrivalTimeOptionsForEvent(event).slice(0, 2), ["22:00", "22:15"]);
});
