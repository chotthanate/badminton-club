import React from "react";
import { SKILL_LEVELS, normalizePlayableSkillLevels } from "./skillLevels.js";

export default function SkillCompatibilityPicker({ skillLevel, value, onChange, className = "", language = "th" }) {
  if (!skillLevel) return null;
  const selected = new Set(normalizePlayableSkillLevels(skillLevel, value));

  function toggleLevel(level, checked) {
    if (level === skillLevel) return;
    const next = new Set(selected);
    if (checked) next.add(level);
    else next.delete(level);
    onChange(SKILL_LEVELS.filter((entry) => next.has(entry) || entry === skillLevel));
  }

  return (
    <fieldset className={`skill-compatibility-picker ${className}`.trim()}>
      <legend>{language === "en" ? "Skill levels you can play with" : "ระดับที่สามารถเล่นด้วยได้"}</legend>
      <div>
        {SKILL_LEVELS.map((level) => {
          const ownLevel = level === skillLevel;
          return (
            <label className={ownLevel ? "is-own-level" : ""} key={level}>
              <input
                checked={ownLevel || selected.has(level)}
                disabled={ownLevel}
                onChange={(event) => toggleLevel(level, event.target.checked)}
                type="checkbox"
              />
              <span>{level}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
