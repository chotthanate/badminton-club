import { useEffect, useState } from "react";

export const LANGUAGE_STORAGE_KEY = "headshot-language";

export function languageFromSearch(search = "") {
  let params = new URLSearchParams(search);
  for (let depth = 0; depth < 3; depth += 1) {
    const language = params.get("lang");
    if (language === "en" || language === "th") return language;
    const nestedState = params.get("liff.state");
    if (!nestedState) break;
    let decoded = nestedState;
    for (let pass = 0; pass < 2 && /%[0-9a-f]{2}/i.test(decoded); pass += 1) {
      try { decoded = decodeURIComponent(decoded); } catch { break; }
    }
    params = new URLSearchParams(decoded.startsWith("?") ? decoded : `?${decoded}`);
  }
  return null;
}

export function useLanguage() {
  const [language, setLanguage] = useState(() => {
    const requested = languageFromSearch(window.location.search);
    if (requested) return requested;
    try {
      const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored === "en" || stored === "th") return stored;
    } catch {
      // Private browsing can deny localStorage.
    }
    return "th";
  });

  useEffect(() => {
    document.documentElement.lang = language;
    try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language); } catch { /* Keep the current session usable. */ }
  }, [language]);

  return { language, setLanguage, isEnglish: language === "en" };
}

export function pickLanguage(language, thai, english) {
  return language === "en" ? english : thai;
}

export function formatMemberDate(isoDate, language) {
  if (!isoDate) return "";
  const date = new Date(`${isoDate}T12:00:00+07:00`);
  if (Number.isNaN(date.getTime())) return String(isoDate);
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "th-TH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: language === "en" ? "numeric" : undefined,
    timeZone: "Asia/Bangkok",
  }).format(date);
}

const ENGLISH_ERRORS = new Map([
  ["กรุณากรอกชื่อเล่น", "Please enter your nickname."],
  ["กรุณาเลือกระดับมือ", "Please select your skill level."],
  ["กรุณาพิมพ์ชื่อผู้เล่น", "Please enter the player's name."],
  ["กรุณาเลือกระดับมือของเพื่อน", "Please select your friend's skill level."],
  ["ไม่พบรอบที่ต้องการลงชื่อ", "The selected session was not found."],
  ["ตอนนี้ยังไม่มีรอบที่เปิดให้ลงชื่อ", "There is no open session right now."],
  ["รอบนี้ปิดรับคำตอบแล้ว", "Registration for this session is closed."],
  ["กรุณาเลือกรอบที่ต้องการชำระ", "Please select at least one session to pay."],
  ["กรุณาแนบรูปสลิป", "Please attach your transfer slip."],
  ["กรุณาเลือกรูปสลิป", "Please choose a slip image."],
  ["ไม่มียอดค้างชำระ", "There is no outstanding balance."],
  ["เชื่อมต่อระบบไม่สำเร็จ", "Unable to connect. Please try again."],
]);

export function localizeError(message, language, fallback = "Something went wrong. Please try again.") {
  const source = String(message || "").trim();
  if (language !== "en") return source || fallback;
  if (ENGLISH_ERRORS.has(source)) return ENGLISH_ERRORS.get(source);
  if (/^[\x00-\x7F]*$/.test(source)) return source || fallback;
  return fallback;
}
