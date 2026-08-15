import test from "node:test";
import assert from "node:assert/strict";
import { courtHasStarted, scheduledCourtStartMs } from "../supabase/functions/_shared/liveQueueTime.js";

test("public live queue hides a later court until its scheduled start", () => {
  const before = Date.parse("2026-08-14T22:59:59+07:00");
  const atStart = Date.parse("2026-08-14T23:00:00+07:00");
  assert.equal(courtHasStarted("2026-08-14", "21:00", "23:00", before), false);
  assert.equal(courtHasStarted("2026-08-14", "21:00", "23:00", atStart), true);
});

test("court start after midnight belongs to the next day of an evening event", () => {
  assert.equal(
    scheduledCourtStartMs("2026-08-14", "21:00", "00:30"),
    Date.parse("2026-08-15T00:30:00+07:00"),
  );
  assert.equal(courtHasStarted("2026-08-14", "21:00", "00:30", Date.parse("2026-08-14T23:59:00+07:00")), false);
  assert.equal(courtHasStarted("2026-08-14", "21:00", "00:30", Date.parse("2026-08-15T00:30:00+07:00")), true);
});
