import test from "node:test";
import assert from "node:assert/strict";
import { buildWaitingTimeEstimates, courtStartDelaySeconds, elapsedWaitSeconds, estimateGameDurationSeconds, formatMinuteSecondDuration } from "../src/queueWaitTime.js";

test("queue wait uses the median completed game duration", () => {
  const base = Date.parse("2026-09-04T14:00:00Z");
  const match = (minutes, index) => ({ status: "completed", startedAt: new Date(base + index * 3600000).toISOString(), endedAt: new Date(base + index * 3600000 + minutes * 60000).toISOString() });
  assert.equal(estimateGameDurationSeconds([match(12, 0), match(20, 1), match(40, 2)]), 20 * 60);
  assert.equal(estimateGameDurationSeconds([]), 15 * 60);
});

test("waiting estimates account for active courts and upcoming queues", () => {
  const waiting = Array.from({ length: 8 }, (_, index) => ({ memberId: `p${index + 1}` }));
  const estimates = buildWaitingTimeEstimates({ waiting, upcomingCount: 1, courtAvailableInSeconds: [5 * 60, 10 * 60], gameDurationSeconds: 15 * 60 });
  assert.equal(estimates.get("p1"), 10 * 60);
  assert.equal(estimates.get("p4"), 10 * 60);
  assert.equal(estimates.get("p5"), 20 * 60);
});

test("a court that starts later is not treated as immediately available", () => {
  const now = new Date(2026, 8, 4, 21, 0, 0).getTime();
  assert.equal(courtStartDelaySeconds({ eventDate: "2026-09-04", eventStartTime: "21:00", courtStartTime: "23:00", now }), 2 * 60 * 60);
});

test("wait duration updates locally in minutes and seconds", () => {
  const now = Date.parse("2026-09-04T15:10:45Z");
  assert.equal(elapsedWaitSeconds("2026-09-04T15:00:00Z", now), 10 * 60 + 45);
  assert.equal(elapsedWaitSeconds(null, now), 0);
  assert.equal(formatMinuteSecondDuration(10 * 60 + 45), "10:45");
});
