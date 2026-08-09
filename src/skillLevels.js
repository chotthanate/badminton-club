export const SKILL_LEVELS = ["Rookie-", "Rookie", "BG", "N", "S", "P"];

export function defaultPlayableSkillLevels(skillLevel) {
  const index = SKILL_LEVELS.indexOf(skillLevel);
  if (index < 0) return [];
  return SKILL_LEVELS.filter((_, levelIndex) => Math.abs(levelIndex - index) <= 1);
}

export function normalizePlayableSkillLevels(skillLevel, values, legacy = {}) {
  const index = SKILL_LEVELS.indexOf(skillLevel);
  if (index < 0) return [];
  let candidates = Array.isArray(values) ? values : null;
  if (!candidates) {
    candidates = [skillLevel];
    if (legacy.allowLowerLevel && index > 0) candidates.push(SKILL_LEVELS[index - 1]);
    if (legacy.allowHigherLevel && index < SKILL_LEVELS.length - 1) candidates.push(SKILL_LEVELS[index + 1]);
  }
  const selected = new Set(candidates.filter((level) => SKILL_LEVELS.includes(level)));
  selected.add(skillLevel);
  return SKILL_LEVELS.filter((level) => selected.has(level));
}

export function legacyPreferencesForPlayable(skillLevel, playableSkillLevels) {
  const index = SKILL_LEVELS.indexOf(skillLevel);
  const selected = new Set(playableSkillLevels || []);
  return {
    allowLowerLevel: index > 0 && selected.has(SKILL_LEVELS[index - 1]),
    allowHigherLevel: index >= 0 && index < SKILL_LEVELS.length - 1 && selected.has(SKILL_LEVELS[index + 1]),
  };
}
