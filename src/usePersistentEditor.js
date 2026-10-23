import { useEffect, useRef, useState } from "react";
import { acknowledgeEditor, editorIsDirty, reconcileEditor } from "./editorDrafts.js";

export function usePersistentEditor(key, serverValue) {
  const serialized = JSON.stringify(serverValue);
  const [editor, setEditor] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key));
      if (typeof saved?.base === "string" && saved.value && typeof saved.value === "object") return saved;
    } catch { /* Storage may be unavailable in private browsing. */ }
    return { base: serialized, value: serverValue };
  });
  const dirty = editorIsDirty(editor);
  const latest = useRef({ dirty, editor });
  latest.current = { dirty, editor };
  useEffect(() => {
    setEditor((current) => reconcileEditor(current, JSON.parse(serialized)));
  }, [serialized]);
  useEffect(() => {
    try {
      if (dirty) sessionStorage.setItem(key, JSON.stringify(editor));
      else sessionStorage.removeItem(key);
    } catch { /* In-memory drafts still work when browser storage is full. */ }
  }, [key, editor, dirty]);
  useEffect(() => {
    const warn = (event) => { if (latest.current.dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const setValue = (next) => setEditor((current) => ({ ...current, value: typeof next === "function" ? next(current.value) : next }));
  const reset = () => setEditor({ base: serialized, value: serverValue });
  // A user may keep typing while a save is in flight: acknowledge only what was submitted.
  const accept = (submittedValue = editor.value) => setEditor((current) => acknowledgeEditor(current, submittedValue));
  return { value: editor.value, setValue, dirty, conflict: dirty && serialized !== editor.base, reset, accept };
}
