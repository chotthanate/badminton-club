import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FlaskConical } from "lucide-react";

export default function SandboxModeBadge({ busy, onExit }) {
  const [confirming, setConfirming] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [error, setError] = useState("");
  const triggerRef = useRef(null);
  const cancelRef = useRef(null);
  const dialogRef = useRef(null);
  const pendingRef = useRef(false);
  const disabled = busy || exiting;

  useEffect(() => {
    if (!confirming) return;
    return () => triggerRef.current?.focus({ preventScroll: true });
  }, [confirming]);
  useEffect(() => {
    // Disabling the focused confirmation button can blur to the page. Restore
    // focus inside the still-open dialog after a failed exit, without scrolling.
    if (confirming && !disabled) cancelRef.current?.focus({ preventScroll: true });
  }, [confirming, disabled]);

  async function exitSandbox() {
    if (disabled || pendingRef.current) return;
    pendingRef.current = true;
    setExiting(true);
    setError("");
    try {
      if (await onExit()) setConfirming(false);
      else setError("ยังออกจากโหมดทดลองไม่ได้ กรุณาตรวจข้อความแจ้งเตือนแล้วลองอีกครั้ง");
    } catch (nextError) {
      setError(nextError.message || "กลับข้อมูลจริงไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      pendingRef.current = false;
      setExiting(false);
    }
  }

  function onDialogKeyDown(event) {
    if (event.key === "Escape" && !disabled) setConfirming(false);
    if (event.key !== "Tab") return;
    const buttons = [...dialogRef.current.querySelectorAll("button:not(:disabled)")];
    if (!buttons.length) { event.preventDefault(); return; }
    const first = buttons[0];
    const last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return <>
    <button aria-label="โหมดทดลอง — กดเพื่อกลับข้อมูลจริง" className="badminton-admin-mode is-test" disabled={disabled} onClick={() => { setError(""); setConfirming(true); }} ref={triggerRef} type="button"><FlaskConical size={14} /> โหมดทดลอง</button>
    {confirming ? createPortal(<div className="badminton-modal-backdrop badminton-sandbox-exit-backdrop">
      <section aria-labelledby="sandbox-exit-title" aria-modal="true" className="badminton-modal badminton-sandbox-exit" onKeyDown={onDialogKeyDown} ref={dialogRef} role="dialog">
        <h2 id="sandbox-exit-title">ออกจากโหมดทดลองไหม?</h2>
        <p>กลับไปดูรอบและรายชื่อจริง ข้อมูลทดลองจะยังอยู่ และไม่เปลี่ยนแปลงรอบหรือเกมที่กำลังเล่น</p>
        {error ? <p className="badminton-error" role="alert">{error}</p> : null}
        <div className="badminton-sandbox-exit-actions">
          <button className="badminton-secondary" disabled={disabled} onClick={() => setConfirming(false)} ref={cancelRef} type="button">ยังไม่ออก</button>
          <button className="badminton-primary" disabled={disabled} onClick={exitSandbox} type="button">{exiting ? "กำลังกลับข้อมูลจริง…" : "กลับข้อมูลจริง"}</button>
        </div>
      </section>
    </div>, document.body) : null}
  </>;
}
