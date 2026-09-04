function compareWaiting(left, right) {
  return (Number(left.gamesPlayed) || 0) - (Number(right.gamesPlayed) || 0)
    || (Number(left.minutesPlayed) || 0) - (Number(right.minutesPlayed) || 0)
    || new Date(left.queuedAt || 0) - new Date(right.queuedAt || 0);
}

export function buildQueuePlanningState(players = [], upcoming = []) {
  const upcomingMemberIds = new Set(upcoming.flatMap((match) => (match.players || []).map((player) => player.memberId)));
  const draftPositionsByMember = new Map(upcoming
    .filter((match) => match.status === "draft")
    .flatMap((match) => (match.players || []).map((player) => [player.memberId, match.queuePosition])));
  const availableWaiting = players
    .filter((player) => player.status === "waiting" && !upcomingMemberIds.has(player.memberId))
    .sort(compareWaiting);
  const visibleWaiting = players
    .filter((player) => player.status === "waiting" || (draftPositionsByMember.has(player.memberId) && player.status === "reserved"))
    .sort(compareWaiting);
  const availablePlaying = players.filter((player) => player.status === "playing" && !upcomingMemberIds.has(player.memberId));
  const proposalPlayers = players.map((player) => upcomingMemberIds.has(player.memberId) ? { ...player, status: "reserved" } : player);

  return {
    availablePlaying,
    availableWaiting,
    draftPositionsByMember,
    proposalPlayers,
    unavailableForMatch(matchId) {
      return new Set(upcoming
        .filter((match) => match.id !== matchId)
        .flatMap((match) => (match.players || []).map((player) => player.memberId)));
    },
    visibleWaiting,
  };
}
