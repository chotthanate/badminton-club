export function getEventIdFromSearch(search) {
  return liffSearchParams(search).get("event_id");
}

export function isLatestEventSearch(search) {
  return liffSearchParams(search).get("latest") === "1";
}

export function getLiffTestContext(search) {
  const params = liffSearchParams(search);
  return {
    testMode: params.get("test") === "1",
    testClubId: params.get("test_club_id") || null,
  };
}

export function buildTestSignupLiffUrl({ liffId, eventId, testClubId }) {
  if (!liffId || !eventId || !testClubId) return "";
  const params = new URLSearchParams({ event_id: eventId, test: "1", test_club_id: testClubId });
  return `https://liff.line.me/${encodeURIComponent(liffId)}?${params}`;
}

export function buildTestPaymentLiffUrl({ liffId, testClubId }) {
  if (!liffId || !testClubId) return "";
  const params = new URLSearchParams({ mode: "payment", test: "1", test_club_id: testClubId });
  return `https://liff.line.me/${encodeURIComponent(liffId)}?${params}`;
}

export function buildLiveQueueUrl({ eventId = null, testClubId = null, origin = window.location.origin + window.location.pathname } = {}) {
  const params = new URLSearchParams({ liff: "live" });
  if (eventId) params.set("event_id", eventId);
  else params.set("latest", "1");
  if (testClubId) {
    params.set("test", "1");
    params.set("test_club_id", testClubId);
  }
  return `${origin}?${params}`;
}

function liffSearchParams(search) {
  const params = new URLSearchParams(search);
  const liffState = params.get("liff.state");
  if (liffState) {
    const stateParams = new URLSearchParams(liffState.replace(/^\?/, ""));
    if (stateParams.has("event_id") || stateParams.has("latest")) return stateParams;
  }
  return params;
}

export function buildArrivalTimeOptions(startValue, endValue) {
  const start = timeMinutes(startValue);
  let end = timeMinutes(endValue);
  if (start === null || end === null) return [];
  if (end <= start) end += 24 * 60;

  const options = [];
  for (let minute = start; minute < end; minute += 15) {
    const normalized = minute % (24 * 60);
    options.push(`${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`);
  }
  return options;
}

export function sortRosterBySignupOrder(entries = []) {
  return entries
    .map((entry, originalIndex) => ({ entry, originalIndex }))
    .sort((left, right) => {
      const leftOrder = Number(left.entry?.signupOrder);
      const rightOrder = Number(right.entry?.signupOrder);
      if (Number.isFinite(leftOrder) && Number.isFinite(rightOrder) && leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.originalIndex - right.originalIndex;
    })
    .map(({ entry }) => entry);
}

function timeMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}
