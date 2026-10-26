import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { QUEUE_SAVE_FAILURE, saveQueueEditor } from "../src/queueSave.js";

function editorHarness() {
  const state = { selected: ["a", "b", "c", "d"], error: "", closed: false };
  return {
    state,
    async save(action) {
      state.error = "";
      return saveQueueEditor(action, {
        onError: (message) => { state.error = message; },
        onSaved: () => { state.selected = []; state.closed = true; },
      });
    },
  };
}

test("successful queue save clears the draft and closes the modal", async () => {
  const editor = editorHarness();
  assert.equal(await editor.save(async () => true), true);
  assert.deepEqual(editor.state, { selected: [], error: "", closed: true });
});

test("reported queue failure keeps all choices and exposes the actual error", async () => {
  const editor = editorHarness();
  assert.equal(await editor.save(async (onError) => { onError(new Error("คิวเปลี่ยนจากอีกเครื่อง")); return false; }), false);
  assert.deepEqual(editor.state.selected, ["a", "b", "c", "d"]);
  assert.equal(editor.state.closed, false);
  assert.equal(editor.state.error, "คิวเปลี่ยนจากอีกเครื่อง");
});

test("false without a callback still gives a visible retry explanation", async () => {
  const editor = editorHarness();
  assert.equal(await editor.save(async () => false), false);
  assert.equal(editor.state.error, QUEUE_SAVE_FAILURE);
  assert.equal(editor.state.selected.length, 4);
  assert.equal(editor.state.closed, false);
});

test("thrown queue failure is contained and a successful retry closes normally", async () => {
  const editor = editorHarness();
  assert.equal(await editor.save(async () => { throw new Error("เครือข่ายขัดข้อง"); }), false);
  assert.equal(editor.state.error, "เครือข่ายขัดข้อง");
  assert.equal(editor.state.selected.length, 4);
  assert.equal(await editor.save(async () => true), true);
  assert.equal(editor.state.error, "");
  assert.equal(editor.state.closed, true);
});

test("queue save error lives in the visible footer and parent forwards offline and action errors", () => {
  const source = readFileSync(new URL("../src/QueuePanel.jsx", import.meta.url), "utf8");
  const parent = readFileSync(new URL("../src/BadmintonApp.jsx", import.meta.url), "utf8");
  const editor = source.slice(source.indexOf("function QueueLineupEditor("), source.indexOf("function TimeSelect("));
  assert.match(editor, /footer=\{[\s\S]*className="queue-save-error" role="alert"[\s\S]*<p className="queue-picker-hint"/);
  assert.match(editor, /saveQueueEditor\(\(onError\)/);
  assert.match(editor, /draft\.memberIds\.length === 4 \? "บันทึกคิวพร้อมเล่นแล้ว" : `บันทึกคิว/);
  assert.match(editor, /selectedPlayers\.length < 1/);
  assert.doesNotMatch(editor, /errorMode: "alert"/);
  assert.match(editor, /onError: setSaveError, onSaved: \(\) => \{ writeQueueWork[\s\S]*onClose\(\)/);
  assert.ok((editor.match(/setSaveError\(""\)/g) || []).length >= 3, "selection, reload and retry clear stale error");
  assert.match(parent, /options.onError\(offlineError\)/);
  assert.match(parent, /options.onError\(nextError\)/);
});

test("queue fixture defaults to successful local-only saves and can report failures", () => {
  const fixture = readFileSync(new URL("./browser/queue-fixture.jsx", import.meta.url), "utf8");
  assert.match(fixture, /\[fail, setFail\] = useState\(false\)/);
  assert.match(fixture, /options.onError\?\.\(new Error/);
  assert.match(fixture, /ไม่บันทึกข้อมูลจริง/);
  assert.doesNotMatch(fixture, /_neverExecuted\(/);
});

test("queue edit and reorder buttons use rounded touch targets without heavy borders", () => {
  const styles = readFileSync(new URL("../src/queue-improvements.css", import.meta.url), "utf8");
  const buttons = styles.match(/\.queue-compact-card \.badminton-queue-order-actions button \{([^}]+)\}/)?.[1];
  assert.match(buttons, /min-width: 44px/);
  assert.match(buttons, /min-height: 44px/);
  assert.match(buttons, /border: 0/);
  assert.match(buttons, /border-radius: 12px/);
  assert.match(styles, /\.queue-picker-modal > footer \{[^}]*display: grid/);
  assert.match(styles, /\.queue-save-error \{[^}]*grid-column: 1 \/ -1/);
});
