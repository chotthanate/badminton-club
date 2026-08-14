import assert from "node:assert/strict";
import test from "node:test";

import {
  loadPlayerSortMode,
  PLAYER_SORT_STORAGE_KEY,
  savePlayerSortMode,
} from "../src/playerSortPreference.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("player sort preference defaults to alphabetical on a new device", () => {
  assert.equal(loadPlayerSortMode(memoryStorage()), "alphabetical");
});

test("player sort preference remembers the selected mode on that device", () => {
  const storage = memoryStorage();
  assert.equal(savePlayerSortMode("signup", storage), true);
  assert.equal(storage.getItem(PLAYER_SORT_STORAGE_KEY), "signup");
  assert.equal(loadPlayerSortMode(storage), "signup");
});

test("player sort preference ignores an invalid saved value", () => {
  const storage = memoryStorage({ [PLAYER_SORT_STORAGE_KEY]: "unexpected" });
  assert.equal(loadPlayerSortMode(storage), "alphabetical");
});
