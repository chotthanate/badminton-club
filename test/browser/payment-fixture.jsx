// Isolated UI fixture: no auth, repository calls, or production data.
import React, { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import PaymentRow from "../../src/PaymentRow.jsx";
import "../../src/badminton.css";

const initialRows = [
  { memberId: "thai", name: "น้องน้ำ ผู้เล่นทดสอบชื่อภาษาไทยยาวพร้อมนามสกุลเต็ม", billingFinalized: true, paid: false },
  { memberId: "latin", name: "LongUnbrokenPlayerName".repeat(5), billingFinalized: true, paid: true },
  { memberId: "draft", name: "ผู้เล่นที่ยังไม่สรุปยอด", billingFinalized: false, paid: false },
].map((row, index) => ({ ...row, signupOrder: index + 1, playedMinutes: 105, billedAmount: 195, extraCharges: [{ id: "water", name: "น้ำเปล่า", quantity: 2, unitPrice: 10 }], overpaymentAmount: 0 }));

function Fixture() {
  const [rows, setRows] = useState(initialRows);
  const [notice, setNotice] = useState("");
  const [layout, setLayout] = useState(null);
  useLayoutEffect(() => {
    function measure() {
      const cards = [...document.querySelectorAll(".badminton-pay-row")];
      if (!cards.length) return;
      const viewport = document.documentElement.clientWidth;
      const rowsFit = cards.every((card) => {
        const bounds = card.getBoundingClientRect();
        const name = card.querySelector(".badminton-pay-person > strong");
        const nameBounds = name.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= viewport + 1
          && nameBounds.left >= bounds.left && nameBounds.right <= bounds.right + 1
          && name.scrollWidth <= name.clientWidth + 1
          && getComputedStyle(name).textOverflow !== "ellipsis"
          && [...card.querySelectorAll("button")].every((button) => {
            const buttonBounds = button.getBoundingClientRect();
            return buttonBounds.right <= bounds.right + 1 && buttonBounds.width >= 44 && buttonBounds.height >= 44;
          });
      });
      setLayout({ viewport, rowsFit, pageFits: document.documentElement.scrollWidth <= viewport + 1 });
    }
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", measure); };
  }, [rows]);
  if (!new URLSearchParams(window.location.search).has("frame")) return <main style={{ display: "flex", alignItems: "start", gap: 24, padding: 12 }}>
    {[320, 390].map((width) => <section key={width}><h2>{width}px</h2><iframe title={`Payment ${width}px`} src="?frame=1" style={{ width, height: 1000, border: "1px solid #999" }} /></section>)}
  </main>;
  return <main className="badminton-app"><div className="badminton-shell"><section className="badminton-card badminton-settlement-card">
    <h2>ค่าใช้จ่ายรายคน · ทดสอบ</h2><p role="status">{notice || "ข้อมูลจำลอง ไม่บันทึกข้อมูลจริง"}</p>
    <output data-testid="payment-layout-check" style={{ display: "block", overflowWrap: "anywhere", fontSize: 11 }}>{layout ? `${layout.rowsFit && layout.pageFits ? "PASS" : "FAIL"} ${layout.viewport}px: names and buttons fit; page overflow ${!layout.pageFits}` : "กำลังตรวจขนาด"}</output>
    <div className="badminton-pay-list">{rows.map((row) => <PaymentRow
      key={row.memberId}
      row={row}
      extraLabel="น้ำเปล่า×2 20"
      onEditBill={(selected) => setNotice(`แก้ยอด ${selected.name}`)}
      onTogglePayment={(selected) => {
        setRows((current) => current.map((entry) => entry.memberId === selected.memberId ? { ...entry, billingFinalized: true, paid: entry.billingFinalized ? !entry.paid : false } : entry));
        setNotice(selected.billingFinalized ? "เปลี่ยนสถานะรับเงินจำลองแล้ว" : "สรุปยอดจำลองแล้ว ยังไม่ได้รับเงิน");
      }}
    />)}</div>
  </section></div></main>;
}

const root = import.meta.hot?.data.paymentFixtureRoot || createRoot(document.getElementById("root"));
if (import.meta.hot) { import.meta.hot.data.paymentFixtureRoot = root; import.meta.hot.accept(); }
root.render(<Fixture />);
