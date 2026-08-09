import test from "node:test";
import assert from "node:assert/strict";
import {
  balanceTeams,
  compatibilityPreferencePenalty,
  compatibilityTier,
  eligibleQueuePlayers,
  proposeQueueMatch,
  proposeReplacement,
  skillDistanceKey,
} from "../src/queueLogic.js";
import { defaultPlayableSkillLevels, normalizePlayableSkillLevels } from "../src/skillLevels.js";

function player(id, level, overrides = {}) {
  return {
    memberId: id,
    name: id,
    skillLevel: level,
    playableSkillLevels: [level],
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

test("มือที่สูงกว่ายอมรับมืออ่อนกว่าฝ่ายเดียวก็จับคู่ได้", () => {
  const strongerAccepts = [
    player("a", "BG"),
    player("b", "BG"),
    player("c", "N", { playableSkillLevels: ["BG", "N"] }),
    player("d", "N", { playableSkillLevels: ["BG", "N"] }),
  ];
  assert.equal(compatibilityTier(strongerAccepts), 2);
  const weakerOnly = strongerAccepts.map((entry) => entry.skillLevel === "BG"
    ? { ...entry, playableSkillLevels: ["BG", "N"] }
    : { ...entry, playableSkillLevels: ["N"] });
  assert.equal(compatibilityTier(weakerOnly), 3);
});

test("การยอมรับกันทั้งสองฝั่งได้คะแนนดีกว่าการยอมรับฝ่ายเดียว", () => {
  const oneWay = [
    player("a", "BG"), player("b", "BG"),
    player("c", "N", { playableSkillLevels: ["BG", "N"] }),
    player("d", "N", { playableSkillLevels: ["BG", "N"] }),
  ];
  const mutual = oneWay.map((entry) => entry.skillLevel === "BG"
    ? { ...entry, playableSkillLevels: ["BG", "N"] }
    : entry);
  assert.ok(compatibilityPreferencePenalty(mutual) < compatibilityPreferencePenalty(oneWay));
});

test("เลือกเล่นข้ามหลายระดับได้เมื่อมือที่สูงกว่ายินยอม", () => {
  const lineup = [
    player("a", "BG"), player("b", "BG"),
    player("c", "P", { playableSkillLevels: ["BG", "P"] }),
    player("d", "P", { playableSkillLevels: ["BG", "P"] }),
  ];
  assert.equal(compatibilityTier(lineup), 2);
  assert.equal(compatibilityTier(lineup.map((entry) => entry.skillLevel === "P" ? { ...entry, playableSkillLevels: ["P"] } : entry)), 4);
});

test("ถ้าไม่มีระดับที่เข้ากัน ระบบยังจัดให้ครบ 4 คน", () => {
  const result = proposeQueueMatch([
    player("anchor", "Rookie-"),
    player("b", "BG"),
    player("c", "S"),
    player("d", "P"),
  ]);
  assert.equal(result.tier, 4);
  assert.equal(result.lineup.length, 4);
});

test("fallback เลือกสามคนที่ระดับใกล้ anchor ที่สุด", () => {
  const result = proposeQueueMatch([
    player("anchor", "Rookie-", { queuedAt: "2026-08-10T09:00:00Z" }),
    player("b", "BG"),
    player("c", "N"),
    player("d", "S"),
    player("e", "P"),
  ]);
  assert.equal(result.tier, 4);
  assert.deepEqual(result.lineup.map((entry) => entry.memberId).sort(), ["anchor", "b", "c", "d"].sort());
  assert.deepEqual(skillDistanceKey(result.lineup), [4, 13]);
});

test("ค่าเริ่มต้นมือ N คือ BG N และ S โดยระดับตัวเองถูกบังคับไว้", () => {
  assert.deepEqual(defaultPlayableSkillLevels("N"), ["BG", "N", "S"]);
  assert.deepEqual(normalizePlayableSkillLevels("N", ["P", "P"]), ["N", "P"]);
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
    player("d", "N", { playableSkillLevels: ["BG", "N"] }),
    player("e", "P"),
  ]);
  assert.equal(replacement.player.memberId, "d");
});
