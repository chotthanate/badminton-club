import assert from "node:assert/strict";
import test from "node:test";

import { duplicateGroupSignature, findExactDuplicateMemberGroups, normalizeMemberSearch, rankMemberSuggestions } from "../src/memberSearch.js";

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

test("member search also finds a previous name kept as an alias", () => {
  const renamed = [{ id: "one", nickname: "เอ็ม", display_name: "M", aliases: ["น้องเอ็ม"] }];
  assert.equal(rankMemberSuggestions(renamed, "น้องเอ็ม")[0]?.id, "one");
});

test("exact duplicate groups prefer the LINE-linked member as the canonical row", () => {
  const groups = findExactDuplicateMemberGroups([
    { id: "guest", nickname: "นิว", display_name: "นิว", created_at: "2026-01-01" },
    { id: "line", nickname: "นิว", display_name: "💕ninew🎶💕", line_user_id: "U123", created_at: "2026-02-01" },
    { id: "other", nickname: "บอย", display_name: "Thailand Team", created_at: "2026-01-01" },
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map((member) => member.id), ["line", "guest"]);
});

test("duplicate suggestion signature stays stable when member order changes", () => {
  assert.equal(
    duplicateGroupSignature([{ id: "second" }, { id: "first" }]),
    duplicateGroupSignature([{ id: "first" }, { id: "second" }]),
  );
});
