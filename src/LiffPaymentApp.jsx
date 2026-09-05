import React, { useEffect, useMemo, useState } from "react";
import { Check, Copy, ImagePlus, LoaderCircle, ReceiptText, ShieldCheck, UserPlus, UserRound, Users, X } from "lucide-react";
import { baht, formatThaiDate } from "./badmintonLogic.js";
import { getLiffTestContext } from "./liffSignup.js";
import { selectedPaymentExtras, selectedPaymentTotal } from "./paymentSelection.js";
import { classifySlipRecipient, PAYMENT_RECIPIENT_NAME, recognizeSlip } from "./paymentSlip.js";
import LanguageToggle from "./LanguageToggle.jsx";
import { formatMemberDate, localizeError, pickLanguage, useLanguage } from "./language.js";

const PAYMENT_BANK_NAME = "ธนาคารไทยพาณิชย์";
const PAYMENT_BANK_ACCOUNT_DISPLAY = "408-6-96159-5";
const PAYMENT_BANK_ACCOUNT_COPY = "4086961595";

export default function LiffPaymentApp() {
  const { language, setLanguage } = useLanguage();
  const tr = (thai, english) => pickLanguage(language, thai, english);
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
        if (!liffId || !window.liff) throw new Error(tr("ระบบแจ้งโอน LINE ยังตั้งค่าไม่ครบ", "LINE payment is not configured."));
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
        if (active) setError(localizeError(nextError.message, language, tr("เปิดหน้าแจ้งโอนไม่สำเร็จ", "Unable to open the payment page.")));
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
  const selectedExtras = useMemo(
    () => selectedPaymentExtras(selectedBeneficiaries, selectedPaymentIds),
    [selectedBeneficiaries, selectedPaymentIds],
  );
  const recipientStatus = slip ? classifySlipRecipient(slip.text, data?.recipientNames) : "match";
  const amountDifference = slip?.amount === null || slip?.amount === undefined
    ? null
    : Number(slip.amount) - total;
  const amountMismatch = amountDifference !== null && Math.abs(amountDifference) >= 0.009;
  const futureTransferDate = Boolean(slip?.date && slip.date > todayIsoLocal());
  const needsManualReview = Boolean(slip && (
    recipientStatus === "unclear"
    || slip.amount === null
    || !slip.date
    || !slip.reference
    || futureTransferDate
  ));

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
      setError(tr("กรุณาเลือกรูปสลิป", "Please choose a slip image."));
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
      setError(localizeError(nextError.message, language, tr("อ่านข้อความจากสลิปไม่สำเร็จ", "Unable to read the slip.")));
    } finally {
      setReading(false);
    }
  }

  async function submitPayment() {
    if (!selectedPaymentIds.length) {
      setError(tr("กรุณาเลือกรอบที่ต้องการชำระ", "Please select at least one session to pay."));
      return;
    }
    if (!slip) {
      setError(tr("กรุณาแนบรูปสลิป", "Please attach your transfer slip."));
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
      setError(localizeError(nextError.message, language, tr("ตรวจสลิปไม่สำเร็จ", "Unable to verify the slip.")));
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
      setError(tr("คัดลอกเลขบัญชีไม่สำเร็จ", "Unable to copy the account number."));
    }
  }

  if (loading) return <PaymentShell language={language} setLanguage={setLanguage}><div className="liff-loading"><LoaderCircle size={30} /><strong>{tr("กำลังเปิดยอดค้างชำระ...", "Loading outstanding balances...")}</strong></div></PaymentShell>;
  if (error && !data) return <PaymentShell language={language} setLanguage={setLanguage}><div className="liff-error"><strong>{tr("เปิดหน้าแจ้งโอนไม่ได้", "Unable to open payment")}</strong><span>{error}</span></div></PaymentShell>;

  return (
    <PaymentShell language={language} setLanguage={setLanguage}>
      <header className="liff-payment-header">
        <ReceiptText size={25} />
        <div><h1>{tr("ชำระค่าตีแบด", "Badminton payment")}</h1></div>
      </header>

      <section className="liff-payment-card">
        <div className="liff-payment-profile"><UserRound size={20} /><span>{tr("เข้าใช้ด้วย LINE", "Signed in with LINE")}</span><strong>{data.profile.nickname || data.profile.name}</strong></div>
        <label className="liff-beneficiary-select">
          <span>{tr("เพิ่มผู้เล่นที่ต้องการชำระ", "Add players to this payment")}</span>
          <select disabled={!selectableBeneficiaries.length} onChange={(event) => addBeneficiary(event.target.value)} value={beneficiaryId}>
            <option value="">{selectableBeneficiaries.length ? tr("เลือกชื่อผู้เล่น", "Select a player") : tr("เลือกผู้เล่นครบแล้ว", "All players selected")}</option>
            {selectableBeneficiaries.map((entry) => <option key={entry.id} value={entry.id}>{beneficiaryLabel(entry)}</option>)}
          </select>
          <small><Users size={13} /> {tr("เลือกได้หลายคน แล้วโอนยอดรวมเพียงครั้งเดียว", "Select multiple players and make one combined transfer.")}</small>
        </label>
      </section>

      <section className="liff-payment-card">
        <div className="liff-payment-section-title"><div><strong>{tr("เลือกรอบที่ต้องการจ่าย", "Select sessions to pay")}</strong><span>{selectedBeneficiaries.length} {tr("คน", "players")} · {availablePayments.length} {tr("รอบค้าง", "outstanding sessions")}</span></div></div>
        {availablePayments.length ? <div className="liff-beneficiary-groups">{selectedBeneficiaries.map((entry) => <section className="liff-beneficiary-group" key={entry.id}>
          <header><div><UserPlus size={16} /><strong>{beneficiaryLabel(entry)}</strong></div><button aria-label={`${tr("นำ", "Remove")} ${entry.name}`} onClick={() => removeBeneficiary(entry.id)} type="button"><X size={16} /></button></header>
          <div className="liff-due-list">{entry.payments.map((payment) => <label className={selectedPaymentIds.includes(payment.id) ? "is-selected" : ""} key={payment.id}><input checked={selectedPaymentIds.includes(payment.id)} onChange={() => toggleRound(payment.id)} type="checkbox" /><span><strong>{language === "en" ? formatMemberDate(payment.eventDate, language) : formatThaiDate(payment.eventDate)}</strong><small>{payment.venue}</small>{Number(payment.extrasAmount || 0) > 0 ? <small className="liff-payment-extra-summary">{tr("รวมค่าน้ำ/ขนม", "Includes refreshments")} {baht(payment.extrasAmount)} {tr("บาท", "THB")}{payment.extras?.length ? ` · ${formatPaymentExtraItems(payment.extras, language)}` : ""}</small> : null}</span><b>{baht(payment.amount)} {tr("บาท", "THB")}</b></label>)}</div>
        </section>)}</div> : selectableBeneficiaries.length ? <div className="liff-payment-empty"><UserPlus size={31} /><strong>{tr("กรุณาเลือกผู้เล่น", "Select a player")}</strong><span>{tr("เลือกชื่อด้านบนก่อน แล้วจึงเลือกรอบที่ต้องการชำระ", "Choose a player above, then select the sessions to pay.")}</span></div> : <div className="liff-payment-empty"><ShieldCheck size={31} /><strong>{testMode ? tr("ยังไม่มียอดค้างทดลอง", "No test balance yet") : tr("ไม่มียอดค้างชำระ", "No outstanding balance")}</strong><span>{testMode ? tr("ลงชื่อผ่านลิงก์ทดลอง แล้วให้แอดมินสรุปยอดของคุณก่อนทดสอบหน้านี้", "Register through the test link and ask the admin to finalize your test balance first.") : tr("ยอดที่ชำระแล้วหรือยังไม่ได้สรุปจะไม่แสดงในหน้านี้", "Paid or unfinished balances are not shown here.")}</span></div>}
        {availablePayments.length ? <>
          <div className="liff-payment-bank">
            <strong>{language === "en" ? "Siam Commercial Bank" : PAYMENT_BANK_NAME} {PAYMENT_BANK_ACCOUNT_DISPLAY}</strong>
            <button onClick={copyBankAccount} type="button"><Copy size={16} /> {accountCopied ? tr("คัดลอกแล้ว", "Copied") : tr("คัดลอก", "Copy")}</button>
          </div>
          <div className="liff-payment-total"><span>{tr("ยอดที่ต้องชำระ", "Amount due")}</span><strong>{baht(total)} {tr("บาท", "THB")}</strong></div>
          {selectedExtras.total > 0 ? <p className="liff-payment-total-extras"><strong>{tr("ในยอดนี้มีค่าน้ำ/ขนม", "Refreshments included")} {baht(selectedExtras.total)} {tr("บาท", "THB")}</strong>{selectedExtras.items.length ? <span>{formatPaymentExtraItems(selectedExtras.items, language)}</span> : null}</p> : null}
          <p className="liff-payment-amount-note">{tr("จำนวนเงินในสลิปต้องตรงกับยอดที่ต้องชำระเท่านั้น", "The amount on the slip must exactly match the amount due.")}</p>
        </> : null}
      </section>

      {availablePayments.length ? <section className="liff-payment-card">
        <div className="liff-payment-section-title"><div><strong>{tr("แนบรูปสลิป", "Attach transfer slip")}</strong><span>{tr("รองรับภาพจากแอปธนาคาร", "Use an image from your banking app")}</span></div></div>
        <label className={`liff-slip-picker ${slip ? "has-slip" : ""}`}>
          <input accept="image/*" disabled={reading || submitting} onChange={readSlip} type="file" />
          {reading ? <><LoaderCircle className="is-spinning" size={28} /><strong>{tr("กำลังอ่านข้อความ", "Reading slip")} {progress}%</strong></> : slip ? <><Check size={29} /><strong>{tr("อ่านสลิปแล้ว", "Slip read")}</strong><span>{tr("ยอด", "Amount")} {slip.amount === null ? tr("อ่านไม่ชัด", "unclear") : `${baht(slip.amount)} ${tr("บาท", "THB")}`} · {tr("วันที่", "Date")} {slip.date || tr("อ่านไม่ชัด", "unclear")} · {tr("เลขอ้างอิง", "Reference")} {slip.reference || tr("อ่านไม่ชัด", "unclear")}</span></> : <><ImagePlus size={29} /><strong>{tr("เลือกรูปสลิป", "Choose slip image")}</strong><span>{tr("แตะเพื่อเลือกรูปจากเครื่อง", "Tap to choose an image")}</span></>}
        </label>
        {slip && recipientStatus === "mismatch" ? <p className="liff-slip-warning">{tr(`บัญชีผู้รับไม่ถูกต้อง กรุณาตรวจสอบว่าโอนไปยัง ${PAYMENT_RECIPIENT_NAME}`, `Incorrect recipient. Please make sure the transfer is sent to ${PAYMENT_RECIPIENT_NAME}.`)}</p> : null}
        {slip && amountDifference !== null && amountDifference < -0.009 ? <p className="liff-slip-warning">{tr(`ยอดเงินที่โอนไม่ถูกต้อง เนื่องจากน้อยกว่ายอดที่ต้องจ่ายจริง ต้องชำระ ${baht(total)} บาท แต่สลิปเป็น ${baht(slip.amount)} บาท`, `The transferred amount is too low. Amount due: ${baht(total)} THB; slip: ${baht(slip.amount)} THB.`)}</p> : null}
        {slip && amountDifference !== null && amountDifference > 0.009 ? <p className="liff-slip-warning">{tr(`ยอดเงินที่โอนไม่ถูกต้อง เนื่องจากมากกว่ายอดที่ต้องจ่ายจริง ต้องชำระ ${baht(total)} บาท แต่สลิปเป็น ${baht(slip.amount)} บาท`, `The transferred amount is too high. Amount due: ${baht(total)} THB; slip: ${baht(slip.amount)} THB.`)}</p> : null}
        {needsManualReview && recipientStatus !== "mismatch" && !amountMismatch ? <p className="liff-slip-warning">{tr("หลังส่ง รายการนี้จะอยู่ระหว่างรอตรวจสอบ", "After submission, this payment will be pending review.")}</p> : null}
        {error ? <div className="liff-inline-error">{error}</div> : null}
        <button className="liff-payment-submit" disabled={!selectedPaymentIds.length || !slip || recipientStatus === "mismatch" || amountMismatch || reading || submitting} onClick={submitPayment} type="button">{submitting ? tr("กำลังตรวจสอบ...", "Verifying...") : tr(`ยืนยันแจ้งโอน ${baht(total)} บาท`, `Submit payment of ${baht(total)} THB`)}</button>
      </section> : null}

      {result ? <section className={`liff-payment-result is-${result.status}`}><Check size={25} /><div><strong>{result.status === "auto_paid" ? tr("บันทึกว่าชำระแล้ว", "Payment recorded") : tr("รับสลิปแล้ว · รอตรวจสอบ", "Slip received · Pending review")}</strong><span>{result.status === "auto_paid" ? tr("ยอดที่เลือกถูกบันทึกว่าชำระแล้ว", "Your selected balances have been marked as paid.") : tr("แอดมินจะตรวจสอบและอัปเดตสถานะให้", "An admin will review and update the payment status.")}</span>{result.status === "pending" ? <button onClick={sendNewSlip} type="button"><ImagePlus size={16} /> {tr("ส่งสลิปใหม่", "Send another slip")}</button> : null}</div></section> : null}
    </PaymentShell>
  );
}

function PaymentShell({ children, language, setLanguage }) {
  return <main className="badminton-app liff-signup-page liff-payment-page"><div className="liff-signup-shell"><div className="public-language-bar"><LanguageToggle language={language} setLanguage={setLanguage} /></div>{children}</div></main>;
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

function formatPaymentExtraItems(items = [], language = "th") {
  return items.map((item) => {
    const quantity = Number(item.quantity || 1);
    return `${item.name}${quantity > 1 ? ` × ${quantity}` : ""} ${baht(item.amount)} ${language === "en" ? "THB" : "บาท"}`;
  }).join(" · ");
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
