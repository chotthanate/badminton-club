import test from "node:test";
import assert from "node:assert/strict";
import { buildQueuePlayerSearchOptions, filterQueuePlayerSearchOptions, resolveQueuePlayerSearch, updateQueuePlayerSlots } from "../src/queuePlayerSearch.js";

test("queue player search options include queue origin and remain unique", () => {
  const options = buildQueuePlayerSearchOptions({
    waitingCandidates: [
      { memberId: "one", name: "ต้น", skillLevel: "N" },
      { memberId: "two", name: "ต้น", skillLevel: "N" },
    ],
    queuePositionByMember: new Map([["one", 2], ["two", 2]]),
    currentMemberIds: new Set(),
  });
  assert.deepEqual(options, [
    { memberId: "one", label: "ต้น · N · ย้ายจากคิว 2" },
    { memberId: "two", label: "ต้น · N · ย้ายจากคิว 2 (2)" },
  ]);
});

test("queue player search only resolves a complete option", () => {
  const options = [{ memberId: "one", label: "ต้น · N" }];
  assert.equal(resolveQueuePlayerSearch(options, "ต้น"), null);
  assert.equal(resolveQueuePlayerSearch(options, "ต้น · N"), "one");
  assert.equal(resolveQueuePlayerSearch(options, ""), "");
});

test("queue player dropdown filters Thai names and ignores spaces", () => {
  const options = [
    { memberId: "one", label: "อิ๋ง อิ๋ง · N" },
    { memberId: "two", label: "K-RodS · BG" },
  ];
  assert.deepEqual(filterQueuePlayerSearchOptions(options, "อิ๋งอิ๋ง"), [options[0]]);
  assert.deepEqual(filterQueuePlayerSearchOptions(options, "k-rods"), [options[1]]);
  assert.deepEqual(filterQueuePlayerSearchOptions(options, ""), options);
});

test("selecting an existing player swaps slots without duplicating the player", () => {
  const slots = [{ memberId: "one" }, { memberId: "two" }, { memberId: "" }, { memberId: "" }];
  assert.deepEqual(updateQueuePlayerSlots(slots, 0, "two"), [
    { memberId: "two" }, { memberId: "one" }, { memberId: "" }, { memberId: "" },
  ]);
});

test("clearing a slot does not move its player into another empty slot", () => {
  const slots = [{ memberId: "one" }, { memberId: "two" }, { memberId: "" }, { memberId: "" }];
  assert.deepEqual(updateQueuePlayerSlots(slots, 0, ""), [
    { memberId: "" }, { memberId: "two" }, { memberId: "" }, { memberId: "" },
  ]);
});
