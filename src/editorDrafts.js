export function editorIsDirty(editor) {
  return JSON.stringify(editor.value) !== editor.base;
}

export function reconcileEditor(editor, serverValue) {
  return editorIsDirty(editor) ? editor : { base: JSON.stringify(serverValue), value: serverValue };
}

export function acknowledgeEditor(editor, submittedValue) {
  return { ...editor, base: JSON.stringify(submittedValue) };
}

export function hasUnsavedEditorWork(eventId, storage = globalThis.sessionStorage) {
  try {
    for (let index = 0; index < (storage?.length || 0); index += 1) {
      const key = storage.key(index) || "";
      if (key.startsWith("badminton:member:") || key === `badminton:courts:${eventId}` || key === `badminton:event:${eventId}`) return true;
    }
  } catch { /* Storage access can be denied in private browsing. */ }
  return false;
}
