import test from "node:test";
import assert from "node:assert/strict";
import {
  createKnockoutBracket,
  createQualificationDraw,
  rankQualificationTeams,
  scheduleTournamentMatches,
  validateKnockoutScore,
  validateQualificationScore,
} from "../src/tournamentLogic.js";

for (const count of [4, 6, 8, 10]) {
  test(`qualification draw gives ${count} teams three unique opponents`, () => {
    const teams = Array.from({ length: count }, (_, index) => `team-${index + 1}`);
    const draw = createQualificationDraw(teams, "fixed-seed");
    const opponents = new Map(teams.map((team) => [team, new Set()]));
    draw.matches.forEach((match) => {
      assert.notEqual(match.team1Id, match.team2Id);
      assert.equal(opponents.get(match.team1Id).has(match.team2Id), false);
      opponents.get(match.team1Id).add(match.team2Id);
      opponents.get(match.team2Id).add(match.team1Id);
    });
    teams.forEach((team) => assert.equal(opponents.get(team).size, 3));
    assert.deepEqual(draw, createQualificationDraw(teams, "fixed-seed"));
  });
}

test("qualification rejects odd teams and invalid deuce score", () => {
  assert.throws(() => createQualificationDraw(["a", "b", "c", "d", "e"], "x"), /เลขคู่/);
  assert.throws(() => validateQualificationScore([{ team1Score: 22, team2Score: 20 }, { team1Score: 21, team2Score: 10 }]), /ไม่มีดิว/);
});

test("knockout validates deuce, cap 30, and best of three", () => {
  assert.equal(validateKnockoutScore([{ team1Score: 21, team2Score: 15 }, { team1Score: 22, team2Score: 20 }]), 1);
  assert.equal(validateKnockoutScore([{ team1Score: 30, team2Score: 29 }, { team1Score: 18, team2Score: 21 }, { team1Score: 21, team2Score: 19 }]), 1);
  assert.throws(() => validateKnockoutScore([{ team1Score: 21, team2Score: 20 }, { team1Score: 21, team2Score: 10 }]), /เกม 1/);
});

test("qualification ranking uses game wins, point difference, and points", () => {
  const teams = [{ id: "a", drawOrder: 2 }, { id: "b", drawOrder: 1 }, { id: "c", drawOrder: 3 }, { id: "d", drawOrder: 4 }];
  const matches = [
    { team1Id: "a", team2Id: "b", games: [{ team1Score: 21, team2Score: 10 }, { team1Score: 21, team2Score: 15 }] },
    { team1Id: "c", team2Id: "d", games: [{ team1Score: 21, team2Score: 20 }, { team1Score: 10, team2Score: 21 }] },
  ];
  const ranked = rankQualificationTeams(teams, matches);
  assert.equal(ranked[0].id, "a");
  assert.equal(ranked[0].gamesWon, 2);
});

test("bracket adds byes for six teams", () => {
  const bracket = createKnockoutBracket(Array.from({ length: 6 }, (_, index) => ({ id: `t${index + 1}` })), "upper");
  assert.equal(bracket.size, 8);
  assert.equal(bracket.rounds[0].length, 4);
  assert.equal(bracket.rounds[0].filter((match) => match.bye).length, 2);
  assert.equal(bracket.hasThirdPlace, true);
});

test("scheduler prevents a team from playing without rest", () => {
  const matches = [
    { phase: "qualifier", team1Id: "a", team2Id: "b" },
    { phase: "qualifier", team1Id: "a", team2Id: "c" },
  ];
  const result = scheduleTournamentMatches(matches, [{ id: "court-1" }, { id: "court-2" }], {
    startAt: "2026-09-04T09:00:00+07:00",
    qualifierMinutes: 30,
    minimumRestMinutes: 15,
  });
  assert.equal(new Date(result[1].scheduledAt).getTime() - new Date(result[0].scheduledAt).getTime(), 45 * 60_000);
});
