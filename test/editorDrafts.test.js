import test from "node:test";
import assert from "node:assert/strict";
import { acknowledgeEditor, editorIsDirty, reconcileEditor, hasUnsavedEditorWork } from "../src/editorDrafts.js";
test("background refresh updates clean fields but never overwrites dirty work", () => {
  const clean = { base: '{"name":"A"}', value: { name: "A" } };
  assert.deepEqual(reconcileEditor(clean, { name: "B" }).value, { name: "B" });
  const dirty = { ...clean, value: { name: "unsaved" } };
  assert.equal(reconcileEditor(dirty, { name: "remote edit" }), dirty);
});
test("saving acknowledges the submitted snapshot, preserving edits typed during request", () => {
  const editing = { base: '{"name":"A"}', value: { name: "C" } };
  const saved = acknowledgeEditor(editing, { name: "B" });
  assert.equal(editorIsDirty(saved), true);
  assert.deepEqual(saved.value, { name: "C" });
  assert.equal(editorIsDirty(acknowledgeEditor(saved, { name: "C" })), false);
});
test("leaving a tab can detect retained event and member drafts", () => {
  const storage = { length: 1, key: () => "badminton:courts:one" };
  assert.equal(hasUnsavedEditorWork("one", storage), true);
  assert.equal(hasUnsavedEditorWork("two", storage), false);
  assert.equal(hasUnsavedEditorWork("one", { length: 0 }), false);
});
