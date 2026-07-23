import assert from "node:assert/strict";
import test from "node:test";

import { normalizeMemberSearch, rankMemberSuggestions } from "../src/memberSearch.js";

const members = [
  { id: "jack", nickname: "Jack", display_name: "Jackalin☀️🐟" },
  { id: "boy", nickname: "บอย", display_name: "Thailand Team" },
  { id: "center", nickname: "เซ็นเตอร์", display_name: "C ⭕" },
];

test("member search ignores spaces and common separators", () => {
  assert.equal(normalizeMemberSearch(" C _ ⭕ "), "c⭕");
});

test("member search finds an existing member by nickname", () => {
  assert.equal(rankMemberSuggestions(members, "Jac")[0]?.id, "jack");
});

test("member search finds an existing member by LINE display name", () => {
  assert.equal(rankMemberSuggestions(members, "Thailand")[0]?.id, "boy");
});

test("member search tolerates a small typo", () => {
  assert.equal(rankMemberSuggestions(members, "Jcak")[0]?.id, "jack");
});
