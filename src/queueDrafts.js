const PREFIX = "badminton:queue-work:v1:";

export function queueWorkKey(eventId, workId) {
  return `${PREFIX}${eventId}:${workId}`;
}

export function readQueueWork(eventId, workId, storage = globalThis.localStorage) {
  try { return JSON.parse(storage?.getItem(queueWorkKey(eventId, workId)) || "null"); } catch { return null; }
}

export function writeQueueWork(eventId, workId, value, storage = globalThis.localStorage) {
  try {
    if (value) storage?.setItem(queueWorkKey(eventId, workId), JSON.stringify(value));
    else storage?.removeItem(queueWorkKey(eventId, workId));
    return true;
  } catch { return false; }
}

export function hasUnsavedQueueWork(eventId, storage = globalThis.localStorage) {
  try {
    for (let index = 0; index < (storage?.length || 0); index += 1) {
      if (storage.key(index)?.startsWith(`${PREFIX}${eventId}:`)) return true;
    }
  } catch { /* Private mode may disable local storage. */ }
  return false;
}

export function queueLineupSignature(players = []) {
  return players.map((player) => `${player.memberId}:${player.team}:${player.position}`).sort().join("|");
}

export function queueDraftConflicts(draft, match) {
  return Boolean(draft && match && (Number(draft.baseVersion) !== Number(match.revision)
    || draft.baseSignature !== queueLineupSignature(match.players)));
}

export function toggleQueueSelection(selectedIds, memberId, maximum = 4) {
  if (selectedIds.includes(memberId)) return selectedIds.filter((id) => id !== memberId);
  return selectedIds.length < maximum ? [...selectedIds, memberId] : selectedIds;
}
