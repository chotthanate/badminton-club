export const TOURNAMENT_SKILL_LEVELS = ["Rookie", "BG", "N", "S", "P"];

export function recommendTournamentCourts({
  teamCounts = [],
  startsAt,
  endsAt,
  qualifierMinutes = 30,
  knockoutMinutes = 45,
}) {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return 0;

  const totalMinutes = teamCounts.reduce((sum, rawCount) => {
    const teams = Math.max(0, Math.floor(Number(rawCount) || 0));
    if (teams < 4 || teams % 2 !== 0) return sum;
    const qualifiers = (teams * 3) / 2;
    const bracketTeams = teams / 2;
    const matchesPerBracket =
      Math.max(0, bracketTeams - 1) + (bracketTeams >= 4 ? 1 : 0);
    return (
      sum +
      qualifiers * Number(qualifierMinutes) +
      matchesPerBracket * 2 * Number(knockoutMinutes)
    );
  }, 0);

  if (!totalMinutes) return 0;
  return Math.max(1, Math.ceil(totalMinutes / ((end - start) / 60000)));
}

function hashSeed(seed) {
  let value = 2166136261;
  for (const char of String(seed || "headshot")) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function seededRandom(seed) {
  let value = hashSeed(seed);
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleWithSeed(items, seed) {
  const result = [...items];
  const random = seededRandom(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const nextIndex = Math.floor(random() * (index + 1));
    [result[index], result[nextIndex]] = [result[nextIndex], result[index]];
  }
  return result;
}

export function createQualificationDraw(teamIds, seed) {
  const unique = [...new Set(teamIds.filter(Boolean))];
  if (unique.length < 4) throw new Error("แต่ละระดับต้องมีอย่างน้อย 4 ทีม");
  if (unique.length % 2 !== 0) throw new Error("จำนวนทีมต้องเป็นเลขคู่");
  if (unique.length !== teamIds.length) throw new Error("พบทีมซ้ำในรายการ");

  const ordered = shuffleWithSeed(unique, seed);
  const rotating = [...ordered];
  const matches = [];
  for (let round = 1; round <= 3; round += 1) {
    for (let index = 0; index < rotating.length / 2; index += 1) {
      const home = rotating[index];
      const away = rotating[rotating.length - 1 - index];
      matches.push({
        phase: "qualifier",
        round,
        position: index + 1,
        team1Id: home,
        team2Id: away,
      });
    }
    rotating.splice(1, 0, rotating.pop());
  }
  return { seed: String(seed), drawOrder: ordered, matches };
}

function normalizedGame(game) {
  return {
    team1Score: Number(game?.team1Score),
    team2Score: Number(game?.team2Score),
  };
}

export function isValidQualificationGame(game) {
  const { team1Score, team2Score } = normalizedGame(game);
  if (!Number.isInteger(team1Score) || !Number.isInteger(team2Score))
    return false;
  if (team1Score < 0 || team2Score < 0 || team1Score === team2Score)
    return false;
  return (
    Math.max(team1Score, team2Score) === 21 &&
    Math.min(team1Score, team2Score) <= 20
  );
}

export function validateQualificationScore(games) {
  if (
    !Array.isArray(games) ||
    games.length !== 2 ||
    games.some((game) => !isValidQualificationGame(game))
  ) {
    throw new Error("รอบคัดเลือกต้องกรอกครบ 2 เกม เกมละ 21 แต้ม และไม่มีดิว");
  }
  return true;
}

export function isValidKnockoutGame(game) {
  const { team1Score, team2Score } = normalizedGame(game);
  if (!Number.isInteger(team1Score) || !Number.isInteger(team2Score))
    return false;
  if (team1Score < 0 || team2Score < 0 || team1Score === team2Score)
    return false;
  const winner = Math.max(team1Score, team2Score);
  const loser = Math.min(team1Score, team2Score);
  if (winner === 30) return loser >= 29 && loser <= 29;
  if (winner < 21 || winner > 29) return false;
  return winner - loser >= 2;
}

export function validateKnockoutScore(games) {
  if (!Array.isArray(games) || games.length < 2 || games.length > 3) {
    throw new Error("รอบน็อกเอาต์ต้องมี 2 หรือ 3 เกม");
  }
  let team1Wins = 0;
  let team2Wins = 0;
  games.forEach((game, index) => {
    if (!isValidKnockoutGame(game))
      throw new Error(`คะแนนเกม ${index + 1} ไม่ถูกต้อง`);
    if (Number(game.team1Score) > Number(game.team2Score)) team1Wins += 1;
    else team2Wins += 1;
    if (index < games.length - 1 && (team1Wins === 2 || team2Wins === 2)) {
      throw new Error("มีเกมต่อหลังจากได้ผู้ชนะแล้ว");
    }
  });
  if (Math.max(team1Wins, team2Wins) !== 2)
    throw new Error("ต้องชนะ 2 เกมจึงจบแมตช์ได้");
  return team1Wins > team2Wins ? 1 : 2;
}

export function rankQualificationTeams(teams, completedMatches) {
  const rows = new Map(
    teams.map((team, drawIndex) => [
      team.id,
      {
        ...team,
        drawOrder: Number.isInteger(team.drawOrder)
          ? team.drawOrder
          : drawIndex + 1,
        gamesWon: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        opponents: new Map(),
      },
    ]),
  );

  completedMatches.forEach((match) => {
    if (!rows.has(match.team1Id) || !rows.has(match.team2Id)) return;
    validateQualificationScore(match.games);
    const one = rows.get(match.team1Id);
    const two = rows.get(match.team2Id);
    let oneWins = 0;
    let twoWins = 0;
    match.games.forEach((game) => {
      const a = Number(game.team1Score);
      const b = Number(game.team2Score);
      one.pointsFor += a;
      one.pointsAgainst += b;
      two.pointsFor += b;
      two.pointsAgainst += a;
      if (a > b) oneWins += 1;
      else twoWins += 1;
    });
    one.gamesWon += oneWins;
    two.gamesWon += twoWins;
    one.opponents.set(two.id, oneWins - twoWins);
    two.opponents.set(one.id, twoWins - oneWins);
  });

  const result = [...rows.values()];
  result.sort((left, right) => {
    if (right.gamesWon !== left.gamesWon) return right.gamesWon - left.gamesWon;
    const rightDiff = right.pointsFor - right.pointsAgainst;
    const leftDiff = left.pointsFor - left.pointsAgainst;
    if (rightDiff !== leftDiff) return rightDiff - leftDiff;
    if (right.pointsFor !== left.pointsFor)
      return right.pointsFor - left.pointsFor;
    const exactlyTwoTied =
      result.filter(
        (row) =>
          row.gamesWon === left.gamesWon &&
          row.pointsFor - row.pointsAgainst === leftDiff &&
          row.pointsFor === left.pointsFor,
      ).length === 2;
    if (exactlyTwoTied) {
      const headToHead = left.opponents.get(right.id);
      if (headToHead) return -headToHead;
    }
    return left.drawOrder - right.drawOrder;
  });
  return result.map(({ opponents, ...row }, index) => ({
    ...row,
    rank: index + 1,
    pointDifference: row.pointsFor - row.pointsAgainst,
  }));
}

function nextPowerOfTwo(value) {
  return 2 ** Math.ceil(Math.log2(Math.max(2, value)));
}

export function createKnockoutBracket(rankedTeams, bracket) {
  if (!Array.isArray(rankedTeams) || rankedTeams.length < 2)
    throw new Error("สายแข่งขันต้องมีอย่างน้อย 2 ทีม");
  const size = nextPowerOfTwo(rankedTeams.length);
  const seedSlots = [];
  for (let index = 0; index < size / 2; index += 1)
    seedSlots.push([index + 1, size - index]);
  const teamsByRank = new Map(
    rankedTeams.map((team, index) => [index + 1, team]),
  );
  const firstRound = seedSlots.map(([oneRank, twoRank], index) => ({
    phase: bracket,
    round: 1,
    position: index + 1,
    team1Id: teamsByRank.get(oneRank)?.id || null,
    team2Id: teamsByRank.get(twoRank)?.id || null,
    bye: !teamsByRank.get(oneRank) || !teamsByRank.get(twoRank),
  }));
  const rounds = [firstRound];
  let count = firstRound.length;
  let round = 2;
  while (count > 1) {
    count /= 2;
    rounds.push(
      Array.from({ length: count }, (_, index) => ({
        phase: bracket,
        round,
        position: index + 1,
        team1Id: null,
        team2Id: null,
        bye: false,
      })),
    );
    round += 1;
  }
  return { size, rounds, hasThirdPlace: rankedTeams.length >= 4 };
}

export function scheduleTournamentMatches(matches, courts, settings) {
  if (!courts.length) throw new Error("กรุณาเพิ่มสนามอย่างน้อย 1 สนาม");
  const start = new Date(settings.startAt);
  if (Number.isNaN(start.getTime()))
    throw new Error("เวลาเริ่มการแข่งขันไม่ถูกต้อง");
  const courtReady = new Map(
    courts.map((court) => [court.id, start.getTime()]),
  );
  const teamReady = new Map();
  return matches.map((match) => {
    const duration =
      match.phase === "qualifier"
        ? Number(settings.qualifierMinutes || 30)
        : Number(settings.knockoutMinutes || 45);
    const restMs = Number(settings.minimumRestMinutes || 15) * 60_000;
    const available = courts
      .map((court) => {
        const teamTime = Math.max(
          teamReady.get(match.team1Id) || start.getTime(),
          teamReady.get(match.team2Id) || start.getTime(),
        );
        return { court, at: Math.max(courtReady.get(court.id), teamTime) };
      })
      .sort(
        (a, b) =>
          a.at - b.at ||
          Number(a.court.sortOrder || 0) - Number(b.court.sortOrder || 0),
      )[0];
    const scheduledAt = new Date(available.at).toISOString();
    const endAt = available.at + duration * 60_000;
    courtReady.set(available.court.id, endAt);
    if (match.team1Id) teamReady.set(match.team1Id, endAt + restMs);
    if (match.team2Id) teamReady.set(match.team2Id, endAt + restMs);
    return {
      ...match,
      courtId: available.court.id,
      scheduledAt,
      estimatedMinutes: duration,
    };
  });
}
