export const QUEUE_SAVE_FAILURE = "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง รายชื่อที่เลือกยังอยู่ครบ";

export async function saveQueueEditor(action, { onError, onSaved }) {
  let reported = false;
  const reportError = (error) => {
    reported = true;
    onError(error?.message || (typeof error === "string" && error) || QUEUE_SAVE_FAILURE);
  };
  let saved;
  try { saved = await action(reportError); }
  catch (error) { reportError(error); return false; }
  if (!saved) {
    if (!reported) reportError();
    return false;
  }
  onSaved();
  return true;
}
