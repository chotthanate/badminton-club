import React, { useEffect, useMemo, useState } from "react";
import { Check, Copy, ImagePlus, LoaderCircle, ReceiptText, ShieldCheck, UserPlus, UserRound, Users, X } from "lucide-react";
import { baht, formatThaiDate } from "./badmintonLogic.js";
import { getLiffTestContext } from "./liffSignup.js";
import { selectedPaymentTotal } from "./paymentSelection.js";
import { classifySlipRecipient, PAYMENT_RECIPIENT_NAME, recognizeSlip } from "./paymentSlip.js";

const PAYMENT_BANK_NAME = "ธนาคารไทยพาณิชย์";
const PAYMENT_BANK_ACCOUNT_DISPLAY = "408-6-96159-5";
const PAYMENT_BANK_ACCOUNT_COPY = "4086961595";

export default function LiffPaymentApp() {
  const { testMode, testClubId } = getLiffTestContext(window.location.search);
  const testPayload = { testMode, testClubId };
  const [data, setData] = useState(null);
  const [beneficiaryId, setBeneficiaryId] = useState("");
  const [selectedBeneficiaryIds, setSelectedBeneficiaryIds] = useState([]);
  const [selectedPaymentIds, setSelectedPaymentIds] = useState([]);
  const [slip, setSlip] = useState(null);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [accountCopied, setAccountCopied] = useState(false);
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
        const ownBeneficiary = response.beneficiaries.find((entry) =>
          entry.id === response.profile.memberId && entry.payments.length);
        setSelectedBeneficiaryIds(ownBeneficiary ? [ownBeneficiary.id] : []);
      } catch (nextError) {
        if (active) setError(nextError.message || "เปิดหน้าแจ้งโอนไม่สำเร็จ");
      } finally {
        if (active) setLoading(false);
      }
    }
    start();
    return () => { active = false; };
  }, []);

  const selectedBeneficiaries = data?.beneficiaries.filter((entry) => selectedBeneficiaryIds.includes(entry.id)) || [];
  const selectableBeneficiaries = data?.beneficiaries.filter((entry) => entry.payments.length && !selectedBeneficiaryIds.includes(entry.id)) || [];
  const availablePayments = selectedBeneficiaries.flatMap((entry) => entry.payments);
  const total = useMemo(
    () => selectedPaymentTotal(selectedBeneficiaries, selectedPaymentIds),
    [selectedBeneficiaries, selectedPaymentIds],
  );
  const recipientStatus = slip ? classifySlipRecipient(slip.text) : "match";
  const amountDifference = slip?.amount === null || slip?.amount === undefined
    ? null
    : Number(slip.amount) - total;
  const amountMismatch = amountDifference !== null && Math.abs(amountDifference) >= 0.009;
  const futureTransferDate = Boolean(slip?.date && slip.date > todayIsoLocal());

  function addBeneficiary(nextId) {
    if (!nextId) return;
    setSelectedBeneficiaryIds((current) => current.includes(nextId) ? current : [...current, nextId]);
    setBeneficiaryId("");
    setSlip(null);
    setResult(null);
    setError("");
  }

  function removeBeneficiary(memberId) {
    const paymentIds = new Set(data?.beneficiaries.find((entry) => entry.id === memberId)?.payments.map((payment) => payment.id) || []);
    setSelectedBeneficiaryIds((current) => current.filter((id) => id !== memberId));
    setSelectedPaymentIds((current) => current.filter((id) => !paymentIds.has(id)));
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
      const nextSlip = await recognizeSlip(file, setProgress, total);
      setSlip(nextSlip);
    } catch (nextError) {
      setError(nextError.message || "อ่านข้อความจากสลิปไม่สำเร็จ");
    } finally {
      setReading(false);
    }
  }

  async function submitPayment() {
    if (!selectedPaymentIds.length) {
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
        beneficiaryMemberId: selectedBeneficiaryIds[0] || "",
        beneficiaryMemberIds: selectedBeneficiaryIds,
        paymentIds: selectedPaymentIds,
        slip: {
          amount: slip.amount,
          transferredOn: slip.date,
          confidence: slip.confidence,
          text: slip.text,
          hash: slip.hash,
          reference: slip.reference,
          dataUrl: slip.dataUrl,
          mimeType: slip.mimeType,
        },
        ...testPayload,
      });
      setResult(response);
      const refreshed = await callPaymentApi("get_liff_payments", { idToken: window.liff.getIDToken(), ...testPayload });
      setData(refreshed);
      setSlip(null);
      if (response.status === "auto_paid") {
        setSelectedPaymentIds([]);
        setSelectedBeneficiaryIds((current) => current.filter((memberId) =>
          refreshed.beneficiaries.some((entry) => entry.id === memberId && entry.payments.length)));
      }
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

  async function copyBankAccount() {
    try {
      await copyTextToClipboard(PAYMENT_BANK_ACCOUNT_COPY);
      setAccountCopied(true);
      window.setTimeout(() => setAccountCopied(false), 1800);
    } catch (nextError) {
      setError(nextError.message || "คัดลอกเลขบัญชีไม่สำเร็จ");
    }
  }

  if (loading) return <PaymentShell><div className="liff-loading"><LoaderCircle size={30} /><strong>กำลังเปิดยอดค้างชำระ...</strong></div></PaymentShell>;
  if (error && !data) return <PaymentShell><div className="liff-error"><strong>เปิดหน้าแจ้งโอนไม่ได้</strong><span>{error}</span></div></PaymentShell>;

  return (
    <PaymentShell>
      <header className="liff-payment-header">
        <ReceiptText size={25} />
        <div><h1>ชำระค่าตีแบด</h1></div>
      </header>

      <section className="liff-payment-card">
        <div className="liff-payment-profile"><UserRound size={20} /><span>เข้าใช้ด้วย LINE</span><strong>{data.profile.nickname || data.profile.name}</strong></div>
        <label className="liff-beneficiary-select">
          <span>เพิ่มผู้เล่นที่ต้องการชำระ</span>
          <select disabled={!selectableBeneficiaries.length} onChange={(event) => addBeneficiary(event.target.value)} value={beneficiaryId}>
            <option value="">{selectableBeneficiaries.length ? "เลือกชื่อผู้เล่น" : "เลือกผู้เล่นครบแล้ว"}</option>
            {selectableBeneficiaries.map((entry) => <option key={entry.id} value={entry.id}>{beneficiaryLabel(entry)}</option>)}
          </select>
          <small><Users size={13} /> เลือกได้หลายคน แล้วโอนยอดรวมเพียงครั้งเดียว</small>
        </label>
      </section>

      <section className="liff-payment-card">
        <div className="liff-payment-section-title"><div><strong>เลือกรอบที่ต้องการจ่าย</strong><span>{selectedBeneficiaries.length} คน · {availablePayments.length} รอบค้าง</span></div></div>
        {availablePayments.length ? <div className="liff-beneficiary-groups">{selectedBeneficiaries.map((entry) => <section className="liff-beneficiary-group" key={entry.id}>
          <header><div><UserPlus size={16} /><strong>{beneficiaryLabel(entry)}</strong></div><button aria-label={`นำ ${entry.name} ออกจากรายการ`} onClick={() => removeBeneficiary(entry.id)} type="button"><X size={16} /></button></header>
          <div className="liff-due-list">{entry.payments.map((payment) => <label className={selectedPaymentIds.includes(payment.id) ? "is-selected" : ""} key={payment.id}><input checked={selectedPaymentIds.includes(payment.id)} onChange={() => toggleRound(payment.id)} type="checkbox" /><span><strong>{formatThaiDate(payment.eventDate)}</strong><small>{payment.venue}</small></span><b>{baht(payment.amount)} บาท</b></label>)}</div>
        </section>)}</div> : selectableBeneficiaries.length ? <div className="liff-payment-empty"><UserPlus size={31} /><strong>กรุณาเลือกผู้เล่น</strong><span>เลือกชื่อด้านบนก่อน แล้วจึงเลือกรอบที่ต้องการชำระ</span></div> : <div className="liff-payment-empty"><ShieldCheck size={31} /><strong>{testMode ? "ยังไม่มียอดค้างทดลอง" : "ไม่มียอดค้างชำระ"}</strong><span>{testMode ? "ลงชื่อผ่านลิงก์ทดลอง แล้วให้แอดมินสรุปยอดของคุณก่อนทดสอบหน้านี้" : "ยอดที่ชำระแล้วหรือยังไม่ได้สรุปจะไม่แสดงในหน้านี้"}</span></div>}
        {availablePayments.length ? <>
          <div className="liff-payment-bank">
            <strong>{PAYMENT_BANK_NAME} {PAYMENT_BANK_ACCOUNT_DISPLAY}</strong>
            <button onClick={copyBankAccount} type="button"><Copy size={16} /> {accountCopied ? "คัดลอกแล้ว" : "คัดลอก"}</button>
          </div>
          <div className="liff-payment-total"><span>ยอดที่ต้องชำระ</span><strong>{baht(total)} บาท</strong></div>
          <p className="liff-payment-amount-note">จำนวนเงินในสลิปต้องตรงกับยอดที่ต้องชำระเท่านั้น</p>
        </> : null}
      </section>

      {availablePayments.length ? <section className="liff-payment-card">
        <div className="liff-payment-section-title"><div><strong>แนบรูปสลิป</strong><span>รองรับภาพจากแอปธนาคาร</span></div></div>
        <label className={`liff-slip-picker ${slip ? "has-slip" : ""}`}>
          <input accept="image/*" disabled={reading || submitting} onChange={readSlip} type="file" />
          {reading ? <><LoaderCircle className="is-spinning" size={28} /><strong>กำลังอ่านข้อความ {progress}%</strong></> : slip ? <><Check size={29} /><strong>อ่านสลิปแล้ว</strong><span>ยอด {slip.amount === null ? "อ่านไม่ชัด" : `${baht(slip.amount)} บาท`} · วันที่ {slip.date || "อ่านไม่ชัด"} · เลขอ้างอิง {slip.reference || "อ่านไม่ชัด"}</span></> : <><ImagePlus size={29} /><strong>เลือกรูปสลิป</strong><span>แตะเพื่อเลือกรูปจากเครื่อง</span></>}
        </label>
        {slip && recipientStatus === "mismatch" ? <p className="liff-slip-warning">บัญชีผู้รับไม่ถูกต้อง กรุณาตรวจสอบว่าโอนไปยัง {PAYMENT_RECIPIENT_NAME}</p> : null}
        {slip && recipientStatus === "unclear" ? <p className="liff-slip-warning">ระบบอ่านชื่อบัญชีผู้รับไม่ชัด สามารถส่งได้ แต่รายการจะไปรอแอดมินตรวจสอบ</p> : null}
        {slip && slip.amount === null ? <p className="liff-slip-warning">ระบบอ่านยอดเงินไม่ชัด สามารถส่งได้ แต่รายการจะไปรอแอดมินตรวจสอบ</p> : null}
        {slip && amountDifference !== null && amountDifference < -0.009 ? <p className="liff-slip-warning">ยอดเงินที่โอนไม่ถูกต้อง เนื่องจากน้อยกว่ายอดที่ต้องจ่ายจริง ต้องชำระ {baht(total)} บาท แต่สลิปเป็น {baht(slip.amount)} บาท</p> : null}
        {slip && amountDifference !== null && amountDifference > 0.009 ? <p className="liff-slip-warning">ยอดเงินที่โอนไม่ถูกต้อง เนื่องจากมากกว่ายอดที่ต้องจ่ายจริง ต้องชำระ {baht(total)} บาท แต่สลิปเป็น {baht(slip.amount)} บาท</p> : null}
        {slip && !slip.date ? <p className="liff-slip-warning">ระบบอ่านวันที่ไม่ชัด สามารถส่งได้ แต่รายการจะไปรอแอดมินตรวจสอบ</p> : null}
        {slip && futureTransferDate ? <p className="liff-slip-warning">วันที่บนสลิปเป็นวันอนาคต รายการจะไปรอแอดมินตรวจสอบ</p> : null}
        {slip && !slip.reference ? <p className="liff-slip-warning">ระบบอ่านเลขอ้างอิงไม่ชัด สามารถส่งได้ แต่รายการจะไปรอแอดมินตรวจสอบ</p> : null}
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

function beneficiaryLabel(entry) {
  const lineName = String(entry?.lineName || "").trim();
  const name = String(entry?.name || "สมาชิก").trim();
  return lineName && lineName !== name ? `${name} · LINE: ${lineName}` : name;
}

function todayIsoLocal(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function copyTextToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // LINE's in-app browser can deny Clipboard API even on HTTPS.
    }
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  input.setSelectionRange(0, value.length);
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("คัดลอกไม่สำเร็จ กรุณาลองเปิดผ่าน Safari");
}
