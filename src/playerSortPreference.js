export const PLAYER_SORT_STORAGE_KEY = "headshot-player-sort-mode-v1";

export function loadPlayerSortMode(storage = globalThis?.localStorage) {
  try {
    const saved = storage?.getItem(PLAYER_SORT_STORAGE_KEY);
    return saved === "signup" || saved === "alphabetical" ? saved : "alphabetical";
  } catch {
    return "alphabetical";
  }
}

export function savePlayerSortMode(mode, storage = globalThis?.localStorage) {
  if (mode !== "signup" && mode !== "alphabetical") return false;
  try {
    storage?.setItem(PLAYER_SORT_STORAGE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}
