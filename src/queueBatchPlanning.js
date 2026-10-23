import { proposeQueueMatch, proposeFallbackQueueMatch, queueProposalFailure } from "./queueLogic.js";

export async function planQueueDrafts({ players, matches = [], nextSequence = 1, onProgress = () => {}, yieldControl = () => new Promise((resolve) => setTimeout(resolve, 0)) }) {
  let remaining = players;
  const lineups = [];
  const maximum = Math.floor(players.filter((player) => player.status === "waiting").length / 4);
  let reason = "";
  for (let index = 0; index < maximum; index += 1) {
    const proposal = proposeQueueMatch(remaining, matches, nextSequence + index)
      || proposeFallbackQueueMatch(remaining, matches, nextSequence + index);
    if (!proposal) { reason = queueProposalFailure(remaining, nextSequence + index); break; }
    lineups.push({ memberIds: proposal.lineup.map((player) => player.memberId), teamAIds: proposal.teamA.map((player) => player.memberId), fallback: Boolean(proposal.fallback) });
    const selected = new Set(lineups.at(-1).memberIds);
    remaining = remaining.filter((player) => !selected.has(player.memberId));
    onProgress({ completed: lineups.length, maximum });
    await yieldControl();
  }
  return { lineups, reason };
}
