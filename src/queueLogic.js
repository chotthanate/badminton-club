import { SKILL_LEVELS, normalizePlayableSkillLevels } from "./skillLevels.js";

export { SKILL_LEVELS };

export function skillIndex(level) {
  return SKILL_LEVELS.indexOf(level);
}

export function queueFairnessKey(player) {
  return [
    Number(player.gamesPlayed) || 0,
    Number(player.minutesPlayed) || 0,
    new Date(player.queuedAt || 0).getTime() || 0,
    String(player.memberId || ""),
  ];
}

export function compareKeys(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === b) continue;
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b));
  }
  return 0;
}

export function eligibleQueuePlayers(players, nextSequence = 1) {
  return players
    .filter((player) => player.status === "waiting")
    .filter((player) => skillIndex(player.skillLevel) >= 0)
    .filter((player) => (Number(player.skipUntilSequence) || 0) < nextSequence)
    .sort((left, right) => compareKeys(queueFairnessKey(left), queueFairnessKey(right)));
}

function combinations(values, size, start = 0, prefix = [], result = []) {
  if (prefix.length === size) {
    result.push(prefix);
    return result;
  }
  for (let index = start; index <= values.length - (size - prefix.length); index += 1) {
    combinations(values, size, index + 1, [...prefix, values[index]], result);
  }
  return result;
}

function skillRange(lineup) {
  const levels = lineup.map((player) => skillIndex(player.skillLevel));
  return Math.max(...levels) - Math.min(...levels);
}

function playableLevels(player) {
  return new Set(normalizePlayableSkillLevels(player.skillLevel, player.playableSkillLevels, {
    allowLowerLevel: player.allowLowerLevel,
    allowHigherLevel: player.allowHigherLevel,
  }));
}

function pairCompatibility(left, right) {
  const leftIndex = skillIndex(left.skillLevel);
  const rightIndex = skillIndex(right.skillLevel);
  if (leftIndex === rightIndex) return { accepted: true, mutual: true };
  const stronger = leftIndex > rightIndex ? left : right;
  const weaker = stronger === left ? right : left;
  return {
    accepted: playableLevels(stronger).has(weaker.skillLevel),
    mutual: playableLevels(weaker).has(stronger.skillLevel),
  };
}

function selectedCompatibility(lineup) {
  for (let leftIndex = 0; leftIndex < lineup.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < lineup.length; rightIndex += 1) {
      if (!pairCompatibility(lineup[leftIndex], lineup[rightIndex]).accepted) return false;
    }
  }
  return true;
}

export function compatibilityPreferencePenalty(lineup) {
  let penalty = 0;
  for (let leftIndex = 0; leftIndex < lineup.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < lineup.length; rightIndex += 1) {
      const left = lineup[leftIndex];
      const right = lineup[rightIndex];
      if (left.skillLevel !== right.skillLevel && !pairCompatibility(left, right).mutual) penalty += 1;
    }
  }
  return penalty;
}

export function compatibilityTier(lineup) {
  const range = skillRange(lineup);
  if (range === 0) return 1;
  if (selectedCompatibility(lineup)) return 2;
  if (range <= 1) return 3;
  return 4;
}

export function skillDistanceKey(lineup) {
  const levels = lineup.map((player) => skillIndex(player.skillLevel));
  let pairDistance = 0;
  for (let leftIndex = 0; leftIndex < levels.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < levels.length; rightIndex += 1) {
      pairDistance += Math.abs(levels[leftIndex] - levels[rightIndex]);
    }
  }
  return [Math.max(...levels) - Math.min(...levels), pairDistance];
}

function compatibilitySortKey(candidate) {
  return candidate.tier === 4
    ? [candidate.tier, ...candidate.skillDistance, candidate.preferencePenalty]
    : [candidate.tier, candidate.preferencePenalty, ...candidate.skillDistance];
}

function pairKey(leftId, rightId) {
  return [String(leftId), String(rightId)].sort().join("|");
}

export function buildRepeatStats(matches = []) {
  const teammate = new Map();
  const opponent = new Map();
  const group = new Map();
  for (const match of matches.filter((entry) => entry.status === "completed" || entry.status === "playing")) {
    const players = match.players || [];
    for (let leftIndex = 0; leftIndex < players.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < players.length; rightIndex += 1) {
        const left = players[leftIndex];
        const right = players[rightIndex];
        const key = pairKey(left.memberId, right.memberId);
        group.set(key, (group.get(key) || 0) + 1);
        const destination = left.team === right.team ? teammate : opponent;
        destination.set(key, (destination.get(key) || 0) + 1);
      }
    }
  }
  return { teammate, opponent, group };
}

function lineupScore(lineup, repeatStats) {
  let repeatPenalty = 0;
  for (let leftIndex = 0; leftIndex < lineup.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < lineup.length; rightIndex += 1) {
      repeatPenalty += repeatStats.group.get(pairKey(lineup[leftIndex].memberId, lineup[rightIndex].memberId)) || 0;
    }
  }
  const waits = lineup.map((player) => new Date(player.queuedAt || 0).getTime() || 0);
  return [
    Math.max(...lineup.map((player) => Number(player.gamesPlayed) || 0)),
    lineup.reduce((sum, player) => sum + (Number(player.gamesPlayed) || 0), 0),
    Math.max(...lineup.map((player) => Number(player.minutesPlayed) || 0)),
    lineup.reduce((sum, player) => sum + (Number(player.minutesPlayed) || 0), 0),
    Math.max(...waits),
    waits.reduce((sum, value) => sum + value, 0),
    repeatPenalty,
  ];
}

function teamScore(teamA, teamB, repeatStats) {
  const levelA = teamA.reduce((sum, player) => sum + skillIndex(player.skillLevel), 0);
  const levelB = teamB.reduce((sum, player) => sum + skillIndex(player.skillLevel), 0);
  const teammateRepeats = (repeatStats.teammate.get(pairKey(teamA[0].memberId, teamA[1].memberId)) || 0)
    + (repeatStats.teammate.get(pairKey(teamB[0].memberId, teamB[1].memberId)) || 0);
  let opponentRepeats = 0;
  for (const left of teamA) {
    for (const right of teamB) opponentRepeats += repeatStats.opponent.get(pairKey(left.memberId, right.memberId)) || 0;
  }
  return [Math.abs(levelA - levelB), teammateRepeats, opponentRepeats];
}

export function balanceTeams(lineup, matches = []) {
  if (!Array.isArray(lineup) || lineup.length !== 4) return null;
  const repeatStats = buildRepeatStats(matches);
  const first = lineup[0];
  const partitions = combinations(lineup.slice(1), 1).map(([partner]) => {
    const teamA = [first, partner];
    const teamB = lineup.filter((player) => !teamA.includes(player));
    return { teamA, teamB, score: teamScore(teamA, teamB, repeatStats) };
  });
  partitions.sort((left, right) => compareKeys(left.score, right.score));
  return partitions[0];
}

export function proposeQueueMatch(players, matches = [], nextSequence = 1) {
  const eligible = eligibleQueuePlayers(players, nextSequence);
  if (eligible.length < 4) return null;
  const anchor = eligible[0];
  const repeatStats = buildRepeatStats(matches);
  const candidates = combinations(eligible.filter((player) => player.memberId !== anchor.memberId), 3)
    .map((others) => [anchor, ...others])
    .map((lineup) => ({
      lineup,
      tier: compatibilityTier(lineup),
      preferencePenalty: compatibilityPreferencePenalty(lineup),
      skillDistance: skillDistanceKey(lineup),
      score: lineupScore(lineup, repeatStats),
    }))
    .filter((candidate) => candidate.tier < 99);
  if (!candidates.length) return null;
  candidates.sort((left, right) => compareKeys(compatibilitySortKey(left), compatibilitySortKey(right))
    || compareKeys(left.score, right.score));
  const selected = candidates[0];
  const teams = balanceTeams(selected.lineup, matches);
  return { ...teams, lineup: selected.lineup, tier: selected.tier };
}

export function proposeReplacement(remainingPlayers, waitingPlayers, matches = [], nextSequence = 1) {
  const occupiedIds = new Set(remainingPlayers.map((player) => player.memberId));
  const candidates = eligibleQueuePlayers(waitingPlayers, nextSequence)
    .filter((player) => !occupiedIds.has(player.memberId))
    .map((player) => ({
      player,
      tier: compatibilityTier([...remainingPlayers, player]),
      preferencePenalty: compatibilityPreferencePenalty([...remainingPlayers, player]),
      skillDistance: skillDistanceKey([...remainingPlayers, player]),
    }))
    .filter((candidate) => candidate.tier < 99)
    .sort((left, right) => compareKeys(compatibilitySortKey(left), compatibilitySortKey(right))
      || compareKeys(queueFairnessKey(left.player), queueFairnessKey(right.player)));
  if (!candidates.length) return null;
  const player = candidates[0].player;
  return { player, teams: balanceTeams([...remainingPlayers, player], matches) };
}
