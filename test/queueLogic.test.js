import test from "node:test";
import assert from "node:assert/strict";
import {
  balanceTeams,
  compatibilityTier,
  eligibleQueuePlayers,
  proposeQueueMatch,
  proposeReplacement,
} from "../src/queueLogic.js";

function player(id, level, overrides = {}) {
  return {
    memberId: id,
    name: id,
    skillLevel: level,
    allowLowerLevel: false,
    allowHigherLevel: false,
    status: "waiting",
    gamesPlayed: 0,
    minutesPlayed: 0,
    queuedAt: "2026-08-10T10:00:00Z",
    skipUntilSequence: 0,
    ...overrides,
  };
}

test("จัดกลุ่มระดับเดียวกันก่อนแม้มีระดับข้างเคียงรออยู่", () => {
  const result = proposeQueueMatch([
    player("a", "BG"), player("b", "BG"), player("c", "BG"), player("d", "BG"),
    player("e", "N", { gamesPlayed: 0 }),
  ]);
  assert.equal(result.tier, 1);
  assert.deepEqual(new Set(result.lineup.map((entry) => entry.skillLevel)), new Set(["BG"]));
});

test("ข้ามระดับแบบสมัครใจต้องยินยอมทั้งสองฝั่ง", () => {
  const willing = [
    player("a", "BG", { allowHigherLevel: true }),
    player("b", "BG", { allowHigherLevel: true }),
    player("c", "N", { allowLowerLevel: true }),
    player("d", "N", { allowLowerLevel: true }),
  ];
  assert.equal(compatibilityTier(willing), 2);
  assert.equal(compatibilityTier(willing.map((entry) => entry.memberId === "d" ? { ...entry, allowLowerLevel: false } : entry)), 3);
});

test("ความยุติธรรมยึดจำนวนเกมก่อนนาทีและเวลารอ", () => {
  const result = proposeQueueMatch([
    player("anchor", "N", { gamesPlayed: 0, minutesPlayed: 50 }),
    player("b", "N", { gamesPlayed: 1, minutesPlayed: 10 }),
    player("c", "N", { gamesPlayed: 1, minutesPlayed: 20 }),
    player("d", "N", { gamesPlayed: 1, minutesPlayed: 30 }),
    player("e", "N", { gamesPlayed: 2, minutesPlayed: 0 }),
  ]);
  assert.deepEqual(result.lineup.map((entry) => entry.memberId).sort(), ["anchor", "b", "c", "d"].sort());
});

test("ผู้เล่นที่ถูกข้ามหนึ่งลำดับยังไม่เข้า proposal ถัดไป", () => {
  const rows = [
    player("skip", "N", { skipUntilSequence: 6 }),
    player("ready", "N"),
  ];
  assert.deepEqual(eligibleQueuePlayers(rows, 6).map((entry) => entry.memberId), ["ready"]);
  assert.deepEqual(new Set(eligibleQueuePlayers(rows, 7).map((entry) => entry.memberId)), new Set(["skip", "ready"]));
});

test("จัดทีมให้ผลรวมระดับใกล้กันและหลีกเลี่ยงคู่เดิม", () => {
  const lineup = [player("a", "BG"), player("b", "BG"), player("c", "N"), player("d", "N")];
  const result = balanceTeams(lineup, [{
    status: "completed",
    players: [
      { memberId: "a", team: "A" }, { memberId: "c", team: "A" },
      { memberId: "b", team: "B" }, { memberId: "d", team: "B" },
    ],
  }]);
  assert.notDeepEqual(new Set(result.teamA.map((entry) => entry.memberId)), new Set(["a", "c"]));
  const sum = (team) => team.reduce((total, entry) => total + ["Rookie-", "Rookie", "BG", "N", "S", "P"].indexOf(entry.skillLevel), 0);
  assert.equal(Math.abs(sum(result.teamA) - sum(result.teamB)), 0);
});

test("ระบบหาคนแทนจากคิวและไม่เลือกคนในสนามซ้ำ", () => {
  const remaining = [player("a", "BG"), player("b", "BG"), player("c", "N")];
  const replacement = proposeReplacement(remaining, [
    ...remaining,
    player("d", "N", { allowLowerLevel: true }),
    player("e", "P"),
  ]);
  assert.equal(replacement.player.memberId, "d");
});
