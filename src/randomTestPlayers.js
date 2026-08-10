import { SKILL_LEVELS } from "./skillLevels.js";

function randomIndex(length, random) {
  return Math.min(length - 1, Math.floor(Math.max(0, Math.min(0.999999, random())) * length));
}

export function randomTestPlayerCount(random = Math.random) {
  return 23 + randomIndex(18, random);
}

export function buildRandomTestPlayerProfiles(count, random = Math.random) {
  const safeCount = Math.max(23, Math.min(40, Math.round(Number(count) || 23)));
  const levels = SKILL_LEVELS.flatMap((level) => [level, level]);
  while (levels.length < safeCount) levels.push(SKILL_LEVELS[randomIndex(SKILL_LEVELS.length, random)]);

  const counts = new Map(SKILL_LEVELS.map((level) => [level, levels.filter((entry) => entry === level).length]));
  if (new Set(counts.values()).size === 1) {
    const source = [...SKILL_LEVELS].reverse().find((level) => counts.get(level) > 2);
    const sourceIndex = levels.lastIndexOf(source);
    if (sourceIndex >= 0) levels[sourceIndex] = SKILL_LEVELS[0];
  }

  for (let index = levels.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1, random);
    [levels[index], levels[swapIndex]] = [levels[swapIndex], levels[index]];
  }

  return levels.map((skillLevel) => {
    const skillIndex = SKILL_LEVELS.indexOf(skillLevel);
    const selected = new Set([skillLevel]);
    const preferenceRoll = random();
    if (preferenceRoll >= 0.25) {
      if (skillIndex > 0 && random() < 0.75) selected.add(SKILL_LEVELS[skillIndex - 1]);
      if (skillIndex < SKILL_LEVELS.length - 1 && random() < 0.75) selected.add(SKILL_LEVELS[skillIndex + 1]);
      if (selected.size === 1) {
        const adjacent = [SKILL_LEVELS[skillIndex - 1], SKILL_LEVELS[skillIndex + 1]].filter(Boolean);
        selected.add(adjacent[randomIndex(adjacent.length, random)]);
      }
      if (random() < 0.15) {
        const distant = SKILL_LEVELS.filter((_, index) => Math.abs(index - skillIndex) > 1);
        if (distant.length) selected.add(distant[randomIndex(distant.length, random)]);
      }
    }
    return {
      skillLevel,
      playableSkillLevels: SKILL_LEVELS.filter((level) => selected.has(level)),
    };
  });
}
