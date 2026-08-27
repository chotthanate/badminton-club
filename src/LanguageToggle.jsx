import React from "react";
import { Languages } from "lucide-react";

export default function LanguageToggle({ language, setLanguage, className = "" }) {
  const nextLanguage = language === "en" ? "th" : "en";
  return (
    <button
      aria-label={language === "en" ? "เปลี่ยนภาษาเป็นไทย" : "Switch language to English"}
      className={`public-language-toggle ${className}`.trim()}
      onClick={() => setLanguage(nextLanguage)}
      type="button"
    >
      <Languages size={16} /> {nextLanguage.toUpperCase()}
    </button>
  );
}
