import React, { useEffect, useMemo, useState } from "react";
import { Check, ImagePlus, LoaderCircle, ReceiptText, ShieldCheck, UserRound, Users } from "lucide-react";
import { baht, formatThaiDate } from "./badmintonLogic.js";
import { getLiffTestContext } from "./liffSignup.js";
import { classifySlipRecipient, PAYMENT_RECIPIENT_NAME, recognizeSlip } from "./paymentSlip.js";

export default function LiffPaymentApp() {
  const { testMode, testClubId } = getLiffTestContext(window.location.search);
  const testPayload = { testMode, testClubId };
  const [data, setData] = useState(null);
  const [beneficiaryId, setBeneficiaryId] = useState("");
  const [selectedPaymentIds, setSelectedPaymentIds] = useState([]);
  const [slip, setSlip] = useState(null);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    let active = true;
    async function start() {
      try {
        const liffId = import.meta.env.VITE_LINE_LIFF_ID;
        if (!liffId || !window.liff) throw new Error("ระบบแจ้งโอน LINE ยังตั้งค่าไม่ครบ");
        await window.liff.init({ liffId });
        if (!window.liff.isLoggedIn()) {
          window.liff.login({ redirectUri: window.location.href });
          return;
        }
        const response = await callPaymentApi("get_liff_payments", { idToken: window.liff.getIDToken(), ...testPayload });
        if (!active) return;
        setData(response);
        setBeneficiaryId(response.profile.memberId || response.beneficiaries[0]?.id || "");
      } catch (nextError) {
        if (active) setError(nextError.message || "เปิดหน้าแจ้งโอนไม่สำเร็จ");
      } finally {
        if (active) setLoading(false);
      }
    }
    start();
    return () => { active = false; };
  }, []);

  const currentBeneficiary = data?.beneficiaries.find((entry) => entry.id === beneficiaryId) || null;
  const availablePayments = currentBeneficiary?.payments || [];
  const selectedPayments = availablePayments.filter((payment) => selectedPaymentIds.includes(payment.id));
  const total = useMemo(
    () => selectedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    [selectedPayments],
  );
  const recipientStatus = slip ? classifySlipRecipient(slip.text) : "match";
  const amountDifference = slip?.amount === null || slip?.amount === undefined
    ? null
    : Number(slip.amount) - total;
  const amountMismatch = amountDifference !== null && Math.abs(amountDifference) >= 0.009;

  function selectBeneficiary(nextId) {
    setBeneficiaryId(nextId);
    setSelectedPaymentIds([]);
    setSlip(null);
    setResult(null);
    setError("");
  }

  function toggleRound(paymentId) {
    setSelectedPaymentIds((current) =>
      current.includes(paymentId)
        ? current.filter((id) => id !== paymentId)
        : [...current, paymentId]);
    setResult(null);
  }

  async function readSlip(changeEvent) {
    const file = changeEvent.target.files?.[0];
    changeEvent.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("กรุณาเลือกรูปสลิป");
      return;
    }
    setReading(true);
    setProgress(0);
    setSlip(null);
    setResult(null);
    setError("");
    try {
      const nextSlip = await recognizeSlip(file, setProgress);
      setSlip(nextSlip);
    } catch (nextError) {
      setError(nextError.message || "อ่านข้อความจากสลิปไม่สำเร็จ");
    } finally {
      setReading(false);
    }
  }

  async function submitPayment() {
    if (!beneficiaryId || !selectedPaymentIds.length) {
      setError("กรุณาเลือกรอบที่ต้องการชำระ");
      return;
    }
    if (!slip) {
      setError("กรุณาแนบรูปสลิป");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await callPaymentApi("submit_liff_payment", {
        idToken: window.liff.getIDToken(),
        beneficiaryMemberId: beneficiaryId,
        paymentIds: selectedPaymentIds,
        slip: {
          amount: slip.amount,
          transferredOn: slip.date,
          confidence: slip.confidence,
          text: slip.text,
          hash: slip.hash,
          dataUrl: slip.dataUrl,
          mimeType: slip.mimeType,
        },
        ...testPayload,
      });
      setResult(response);
      const refreshed = await callPaymentApi("get_liff_payments", { idToken: window.liff.getIDToken(), ...testPayload });
      setData(refreshed);
      setSlip(null);
      if (response.status === "auto_paid") setSelectedPaymentIds([]);
    } catch (nextError) {
      setError(nextError.message || "ตรวจสลิปไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }

  function sendNewSlip() {
    setResult(null);
    setSlip(null);
    setError("");
    window.setTimeout(() => document.querySelector(".liff-slip-picker")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  }

  if (loading) return <PaymentShell><div className="liff-loading"><LoaderCircle size={30} /><strong>กำลังเปิดยอดค้างชำระ...</strong></div></PaymentShell>;
  if (error && !data) return <PaymentShell><div className="liff-error"><strong>เปิดหน้าแจ้งโอนไม่ได้</strong><span>{error}</span></div></PaymentShell>;

  return (
    <PaymentShell>
      <header className="liff-payment-header">
        <ReceiptText size={25} />
        <div><h1>แจ้งโอนค่าแบด</h1><p>ระบบตรวจชื่อผู้รับ ยอด และวันที่จากสลิปให้อัตโนมัติ</p></div>
      </header>

      <section className="liff-payment-card">
        <div className="liff-payment-profile"><UserRound size={20} /><span>เข้าใช้ด้วย LINE</span><strong>{data.profile.nickname || data.profile.name}</strong></div>
        <label className="liff-beneficiary-select">
          <span>ต้องการจ่ายให้ใคร</span>
          <select onChange={(event) => selectBeneficiary(event.target.value)} value={beneficiaryId}>
            {data.beneficiaries.map((entry) => <option key={entry.id} value={entry.id}>{entry.isSelf ? `ตัวเอง · ${entry.name}` : `จ่ายแทนเพื่อน · ${entry.name}`}</option>)}
          </select>
          <small><Users size={13} /> รายชื่อจ่ายแทนแสดงเฉพาะคนที่ไม่ได้เชื่อมบัญชี LINE</small>
        </label>
      </section>

      <section className="liff-payment-card">
        <div className="liff-payment-section-title"><div><strong>เลือกรอบที่ต้องการจ่าย</strong><span>{availablePayments.length} รอบค้าง</span></div><b>{baht(total)} บาท</b></div>
        {availablePayments.length ? <div className="liff-due-list">{availablePayments.map((payment) => <label className={selectedPaymentIds.includes(payment.id) ? "is-selected" : ""} key={payment.id}><input checked={selectedPaymentIds.includes(payment.id)} onChange={() => toggleRound(payment.id)} type="checkbox" /><span><strong>{formatThaiDate(payment.eventDate)}</strong><small>{payment.venue}</small></span><b>{baht(payment.amount)} บาท</b></label>)}</div> : <div className="liff-payment-empty"><ShieldCheck size={31} /><strong>{testMode ? "ยังไม่มียอดค้างทดลอง" : "ไม่มียอดค้างชำระ"}</strong><span>{testMode ? "ลงชื่อผ่านลิงก์ทดลอง แล้วให้แอดมินสรุปยอดของคุณก่อนทดสอบหน้านี้" : "ยอดที่ชำระแล้วหรือยังไม่ได้สรุปจะไม่แสดงในหน้านี้"}</span></div>}
      </section>

      {availablePayments.length ? <section className="liff-payment-card">
        <div className="liff-payment-section-title"><div><strong>แนบรูปสลิป</strong><span>รองรับภาพจากแอปธนาคาร</span></div></div>
        <label className={`liff-slip-picker ${slip ? "has-slip" : ""}`}>
          <input accept="image/*" disabled={reading || submitting} onChange={readSlip} type="file" />
          {reading ? <><LoaderCircle className="is-spinning" size={28} /><strong>กำลังอ่านข้อความ {progress}%</strong></> : slip ? <><Check size={29} /><strong>อ่านสลิปแล้ว</strong><span>ยอด {slip.amount === null ? "อ่านไม่ชัด" : `${baht(slip.amount)} บาท`} · วันที่ {slip.date || "อ่านไม่ชัด"}</span></> : <><ImagePlus size={29} /><strong>เลือกรูปสลิป</strong><span>แตะเพื่อเลือกรูปจากเครื่อง</span></>}
        </label>
        {slip && recipientStatus === "mismatch" ? <p className="liff-slip-warning">บัญชีผู้รับไม่ถูกต้อง กรุณาตรวจสอบว่าโอนไปยัง {PAYMENT_RECIPIENT_NAME}</p> : null}
        {slip && recipientStatus === "unclear" ? <p className="liff-slip-warning">ระบบอ่านชื่อบัญชีผู้รับไม่ชัด สามารถส่งได้ แต่รายการจะไปรอแอดมินตรวจสอบ</p> : null}
        {slip && slip.amount === null ? <p className="liff-slip-warning">ระบบอ่านยอดเงินไม่ชัด สามารถส่งได้ แต่รายการจะไปรอแอดมินตรวจสอบ</p> : null}
        {slip && amountDifference !== null && amountDifference < -0.009 ? <p className="liff-slip-warning">ยอดเงินที่โอนไม่ถูกต้อง เนื่องจากน้อยกว่ายอดที่ต้องจ่ายจริง ต้องชำระ {baht(total)} บาท แต่สลิปเป็น {baht(slip.amount)} บาท</p> : null}
        {slip && amountDifference !== null && amountDifference > 0.009 ? <p className="liff-slip-warning">ยอดเงินที่โอนไม่ถูกต้อง เนื่องจากมากกว่ายอดที่ต้องจ่ายจริง ต้องชำระ {baht(total)} บาท แต่สลิปเป็น {baht(slip.amount)} บาท</p> : null}
        {slip && !slip.date ? <p className="liff-slip-warning">ระบบอ่านวันที่ไม่ชัด สามารถส่งได้ แต่รายการจะไปรอแอดมินตรวจสอบ</p> : null}
        {error ? <div className="liff-inline-error">{error}</div> : null}
        <button className="liff-payment-submit" disabled={!selectedPaymentIds.length || !slip || recipientStatus === "mismatch" || amountMismatch || reading || submitting} onClick={submitPayment} type="button">{submitting ? "กำลังตรวจสอบ..." : `ยืนยันแจ้งโอน ${baht(total)} บาท`}</button>
      </section> : null}

      {result ? <section className={`liff-payment-result is-${result.status}`}><Check size={25} /><div><strong>{result.status === "auto_paid" ? "บันทึกว่าชำระแล้ว" : "ส่งให้แอดมินตรวจสอบแล้ว"}</strong><span>{result.message}</span>{result.status === "pending" ? <button onClick={sendNewSlip} type="button"><ImagePlus size={16} /> ส่งสลิปใหม่</button> : null}</div></section> : null}
    </PaymentShell>
  );
}

function PaymentShell({ children }) {
  return <main className="badminton-app liff-signup-page liff-payment-page"><div className="liff-signup-shell">{children}</div></main>;
}

async function callPaymentApi(action, payload) {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/line-bot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const responseData = await response.json().catch(() => ({}));
  if (!response.ok || responseData.error) throw new Error(responseData.error || "เชื่อมต่อระบบไม่สำเร็จ");
  return responseData;
}
