import assert from "node:assert/strict";
import test from "node:test";

import { formatMemberDate, languageFromSearch } from "../src/language.js";

test("language query supports direct and LIFF-encoded URLs", () => {
  assert.equal(languageFromSearch("?liff=signup&lang=en"), "en");
  assert.equal(languageFromSearch("?liff.state=%3Fliff%3Dsignup%26lang%3Den"), "en");
  assert.equal(languageFromSearch("?liff=signup"), null);
});

test("English member date is readable without a Buddhist year", () => {
  assert.equal(formatMemberDate("2026-08-28", "en"), "Friday, 28 August 2026");
});
