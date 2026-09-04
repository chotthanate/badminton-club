const DEFAULT_GAME_SECONDS = 15 * 60;

function validDate(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function estimateGameDurationSeconds(matches = []) {
  const durations = matches
    .filter((match) => match.status === "completed")
    .map((match) => {
      const startedAt = validDate(match.startedAt);
      const endedAt = validDate(match.endedAt);
      return startedAt !== null && endedAt !== null ? Math.round((endedAt - startedAt) / 1000) : 0;
    })
    .filter((seconds) => seconds >= 5 * 60 && seconds <= 90 * 60)
    .sort((left, right) => left - right);
  if (!durations.length) return DEFAULT_GAME_SECONDS;
  const middle = Math.floor(durations.length / 2);
  const median = durations.length % 2 ? durations[middle] : Math.round((durations[middle - 1] + durations[middle]) / 2);
  return Math.min(45 * 60, Math.max(10 * 60, median));
}

export function courtStartDelaySeconds({ eventDate, eventStartTime, courtStartTime, now = Date.now() }) {
  if (!eventDate || !courtStartTime) return 0;
  const [year, month, day] = eventDate.split("-").map(Number);
  const [hour, minute] = courtStartTime.split(":").map(Number);
  const [eventHour, eventMinute] = (eventStartTime || courtStartTime).split(":").map(Number);
  if (![year, month, day, hour, minute, eventHour, eventMinute].every(Number.isFinite)) return 0;
  const start = new Date(year, month - 1, day, hour, minute, 0, 0);
  if ((hour * 60) + minute < (eventHour * 60) + eventMinute) start.setDate(start.getDate() + 1);
  return Math.max(0, Math.ceil((start.getTime() - now) / 1000));
}

export function buildWaitingTimeEstimates({ waiting = [], upcomingCount = 0, courtAvailableInSeconds = [], gameDurationSeconds = DEFAULT_GAME_SECONDS }) {
  const availability = courtAvailableInSeconds.length ? [...courtAvailableInSeconds] : [0];
  const assignGame = () => {
    let courtIndex = 0;
    for (let index = 1; index < availability.length; index += 1) {
      if (availability[index] < availability[courtIndex]) courtIndex = index;
    }
    const startsIn = Math.max(0, Math.round(availability[courtIndex]));
    availability[courtIndex] = startsIn + gameDurationSeconds;
    return startsIn;
  };
  for (let index = 0; index < upcomingCount; index += 1) assignGame();
  const estimates = new Map();
  for (let index = 0; index < waiting.length; index += 4) {
    const startsIn = assignGame();
    waiting.slice(index, index + 4).forEach((player) => estimates.set(player.memberId, startsIn));
  }
  return estimates;
}

export function elapsedWaitSeconds(queuedAt, now = Date.now()) {
  const queuedTime = validDate(queuedAt);
  return queuedTime === null ? 0 : Math.max(0, Math.floor((now - queuedTime) / 1000));
}

export function formatMinuteSecondDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
