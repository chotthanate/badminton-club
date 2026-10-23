// A registration is not a profile edit. Use the latest stored profile so a
// browser tab opened before an admin edit cannot silently undo that edit.
export function registrationProfile(member, payload) {
  if (!member?.id) return payload;
  return {
    nickname: member.nickname || member.display_name || payload.nickname,
    skillLevel: member.skill_level || payload.skillLevel,
    playableSkillLevels: member.playable_skill_levels?.length ? member.playable_skill_levels : undefined,
    allowLowerLevel: Boolean(member.allow_lower_level),
    allowHigherLevel: Boolean(member.allow_higher_level),
  };
}

export function registrationSnapshot(skill, signup, queueStatus) {
  if (!signup?.skill_level_snapshot || !["reserved", "playing"].includes(queueStatus)) return skill;
  return {
    skillLevel: signup.skill_level_snapshot,
    playableSkillLevels: signup.playable_skill_levels_snapshot || [signup.skill_level_snapshot],
    allowLowerLevel: Boolean(signup.allow_lower_level_snapshot),
    allowHigherLevel: Boolean(signup.allow_higher_level_snapshot),
  };
}
