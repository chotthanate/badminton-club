export function buildQueuePlayerSearchOptions({
  waitingCandidates = [],
  playingCandidates = [],
  queuePositionByMember = new Map(),
  currentMemberIds = new Set(),
} = {}) {
  const usedLabels = new Map();
  return [...waitingCandidates, ...playingCandidates].map((player) => {
    const queueNote = queuePositionByMember.has(player.memberId) && !currentMemberIds.has(player.memberId)
      ? ` · ย้ายจากคิว ${queuePositionByMember.get(player.memberId)}`
      : "";
    const baseLabel = `${player.name} · ${player.skillLevel || "ไม่ระบุมือ"}${queueNote}`;
    const occurrence = (usedLabels.get(baseLabel) || 0) + 1;
    usedLabels.set(baseLabel, occurrence);
    return {
      memberId: player.memberId,
      label: occurrence === 1 ? baseLabel : `${baseLabel} (${occurrence})`,
    };
  });
}

export function resolveQueuePlayerSearch(options, value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return options.find((option) => option.label === normalized)?.memberId || null;
}

export function filterQueuePlayerSearchOptions(options, query) {
  const normalizedQuery = normalizeMemberSearch(query);
  if (!normalizedQuery) return options;
  return options.filter((option) => normalizeMemberSearch(option.label).includes(normalizedQuery));
}

export function updateQueuePlayerSlots(slots, slotIndex, memberId) {
  const next = slots.map((slot) => ({ ...slot }));
  const otherIndex = memberId
    ? next.findIndex((slot, index) => index !== slotIndex && slot.memberId === memberId)
    : -1;
  if (otherIndex >= 0) next[otherIndex].memberId = next[slotIndex].memberId;
  next[slotIndex].memberId = memberId;
  return next;
}
import { normalizeMemberSearch } from "./memberSearch.js";
