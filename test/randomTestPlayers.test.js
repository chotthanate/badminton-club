import assert from "node:assert/strict";
import test from "node:test";

import { buildRandomTestPlayerProfiles, randomTestPlayerCount } from "../src/randomTestPlayers.js";
import { SKILL_LEVELS } from "../src/skillLevels.js";

function seededRandom(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = ((state * 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("จำนวนผู้เล่นทดลองสุ่มอยู่ระหว่าง 23 ถึง 40 คน", () => {
  assert.equal(randomTestPlayerCount(() => 0), 23);
  assert.equal(randomTestPlayerCount(() => 0.999999), 40);
});

test("ข้อมูลทดลองมีครบทุกระดับแต่จำนวนไม่เท่ากันทั้งหมด", () => {
  const profiles = buildRandomTestPlayerProfiles(30, seededRandom(20260810));
  assert.equal(profiles.length, 30);
  const counts = SKILL_LEVELS.map((level) => profiles.filter((profile) => profile.skillLevel === level).length);
  assert.ok(counts.every((count) => count >= 2));
  assert.ok(new Set(counts).size > 1);
});

test("ทุกโปรไฟล์ทดลองเก็บระดับตัวเองและสุ่มความยินยอมแบบไม่เหมือนกันทั้งหมด", () => {
  const profiles = buildRandomTestPlayerProfiles(40, seededRandom(99));
  assert.ok(profiles.every((profile) => profile.playableSkillLevels.includes(profile.skillLevel)));
  assert.ok(profiles.some((profile) => profile.playableSkillLevels.length === 1));
  assert.ok(new Set(profiles.map((profile) => profile.playableSkillLevels.join("|"))).size > SKILL_LEVELS.length);
});
