function compareWaiting(left, right) {
  return new Date(left.queuedAt || 0) - new Date(right.queuedAt || 0)
    || (Number(left.gamesPlayed) || 0) - (Number(right.gamesPlayed) || 0)
    || (Number(left.minutesPlayed) || 0) - (Number(right.minutesPlayed) || 0);
}

export function buildQueuePlanningState(players = [], upcoming = []) {
  const upcomingMemberIds = new Set(upcoming.flatMap((match) => (match.players || []).map((player) => player.memberId)));
  const queuePositionsByMember = new Map(upcoming
    .flatMap((match) => (match.players || []).map((player) => [player.memberId, match.queuePosition])));
  const queueStatusesByMember = new Map(upcoming
    .flatMap((match) => (match.players || []).map((player) => [player.memberId, match.status])));
  const availableWaiting = players
    .filter((player) => player.status === "waiting" && !upcomingMemberIds.has(player.memberId))
    .sort(compareWaiting);
  const visibleWaiting = players
    .filter((player) => ["waiting", "reserved"].includes(player.status) || queuePositionsByMember.has(player.memberId))
    .sort(compareWaiting);
  const availablePlaying = players.filter((player) => player.status === "playing" && !upcomingMemberIds.has(player.memberId));
  const proposalPlayers = players.map((player) => upcomingMemberIds.has(player.memberId) ? { ...player, status: "reserved" } : player);

  return {
    availablePlaying,
    availableWaiting,
    draftPositionsByMember: queuePositionsByMember,
    queuePositionsByMember,
    queueStatusesByMember,
    proposalPlayers,
    unavailableForMatch(matchId) {
      return new Set(upcoming
        .filter((match) => match.id !== matchId)
        .flatMap((match) => (match.players || []).map((player) => player.memberId)));
    },
    visibleWaiting,
  };
}
