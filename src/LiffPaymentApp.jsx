import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ImagePlus, LoaderCircle, ReceiptText, RefreshCw, ShieldCheck, UserPlus, UserRound, Users, X } from "lucide-react";
import { baht, formatThaiDate } from "./badmintonLogic.js";
import { getLiffTestContext } from "./liffSignup.js";
import { selectedPaymentExtras, selectedPaymentTotal } from "./paymentSelection.js";
import { classifySlipRecipient, PAYMENT_RECIPIENT_NAME, recognizeSlip } from "./paymentSlip.js";
import LanguageToggle from "./LanguageToggle.jsx";
import { formatMemberDate, localizeError, pickLanguage, useLanguage } from "./language.js";
import { applyPaymentReceipt, createPaymentRefreshGate, isPaymentSelectable, reconcilePaymentReceipt, retainSelectablePaymentIds } from "./paymentSession.js";
import "./paymentStatus.css";

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
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const mountedRef = useRef(true);
  const liffReadyRef = useRef(false);
  const busyRef = useRef(false);
  const submitLockRef = useRef(false);
  const refreshPromiseRef = useRef(null);
  const refreshGateRef = useRef(null);
  busyRef.current = reading || submitting;
  if (!refreshGateRef.current) {
    refreshGateRef.current = createPaymentRefreshGate(() => callPaymentApi("get_liff_payments", {
      idToken: window.liff.getIDToken(), ...testPayload,
    }));
  }

  async function refreshPayments({ force = false, initial = false, afterSave = false } = {}) {
    if (!initial && !afterSave && busyRef.current) return null;
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    setRefreshing(true);
    const request = refreshGateRef.current(force).then((response) => {
      if (!response || !mountedRef.current) return response;
      setData(response);
      setResult((current) => reconcilePaymentReceipt(response, current));
      setLastUpdatedAt(new Date().toISOString());
      setRefreshError("");
      setSelectedPaymentIds((current) => retainSelectablePaymentIds(response.beneficiaries, current));
      if (initial) {
        const ownBeneficiary = response.beneficiaries.find((entry) => entry.id === response.profile.memberId);
        setSelectedBeneficiaryIds(ownBeneficiary ? [ownBeneficiary.id] : []);
      }
      return response;
    }).catch((nextError) => {
      if (mountedRef.current && !initial) setRefreshError(afterSave
        ? tr("รับสลิปแล้ว แต่โหลดข้อมูลล่าสุดไม่ได้ ไม่ต้องส่งซ้ำ กดอัปเดตสถานะเพื่อตรวจอีกครั้ง", "Your slip was received, but the latest status could not load. Do not resubmit; refresh the status instead.")
        : tr("โหลดสถานะล่าสุดไม่ได้ ข้อมูลที่เห็นอาจยังไม่อัปเดต กรุณาลองอีกครั้ง", "Unable to load the latest status. Please refresh again."));
      if (initial) throw nextError;
      return null;
    }).finally(() => {
      refreshPromiseRef.current = null;
      if (mountedRef.current) setRefreshing(false);
    });
    refreshPromiseRef.current = request;
    return request;
  }

  useEffect(() => {
    mountedRef.current = true;
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
        liffReadyRef.current = true;
        await refreshPayments({ force: true, initial: true });
      } catch (nextError) {
        if (active) setError(localizeError(nextError.message, language, tr("เปิดหน้าแจ้งโอนไม่สำเร็จ", "Unable to open the payment page.")));
      } finally {
        if (active) setLoading(false);
      }
    }
    start();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible" && liffReadyRef.current && !busyRef.current) void refreshPayments();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      mountedRef.current = false;
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  const selectedBeneficiaries = data?.beneficiaries.filter((entry) => selectedBeneficiaryIds.includes(entry.id) && entry.payments.length) || [];
  const selectableBeneficiaries = data?.beneficiaries.filter((entry) => entry.payments.length && !selectedBeneficiaryIds.includes(entry.id)) || [];
  const availablePayments = selectedBeneficiaries.flatMap((entry) => entry.payments);
  const payablePayments = availablePayments.filter(isPaymentSelectable);
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
    recipientStatus !== "match"
    || amountMismatch
    || slip.amount === null
    || !slip.date
    || !slip.reference
    || futureTransferDate
    || slip.readError
    || Number(slip.confidence || 0) < 35
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
    if (busyRef.current || !availablePayments.some((payment) => payment.id === paymentId && isPaymentSelectable(payment))) return;
    setSelectedPaymentIds((current) =>
      current.includes(paymentId)
        ? current.filter((id) => id !== paymentId)
        : [...current, paymentId]);
    setResult(null);
  }

  function requireSelectedRound() {
    if (selectedPaymentIds.length) return true;
    const message = tr("กรุณาเลือกรอบที่จะชำระเงิน", "Please select a session to pay first.");
    setError(message);
    window.alert(message);
    window.setTimeout(() => document.querySelector(".liff-due-list")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
    return false;
  }

  async function readSlip(changeEvent) {
    if (!requireSelectedRound()) {
      changeEvent.target.value = "";
      return;
    }
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

  async function submitPayment(manualReviewRequested = false) {
    if (submitLockRef.current || reading) return;
    if (!requireSelectedRound()) return;
    if (!slip) {
      setError(tr("กรุณาแนบรูปสลิป", "Please attach your transfer slip."));
      return;
    }
    submitLockRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      // Let any earlier read finish before saving, so it cannot overwrite the receipt.
      if (refreshPromiseRef.current) await refreshPromiseRef.current;
      const response = await callPaymentApi("submit_liff_payment", {
        idToken: window.liff.getIDToken(),
        beneficiaryMemberId: selectedBeneficiaryIds[0] || "",
        beneficiaryMemberIds: selectedBeneficiaryIds,
        paymentIds: selectedPaymentIds,
        manualReviewRequested: manualReviewRequested === true,
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
      setData((current) => applyPaymentReceipt(current, response, selectedPaymentIds));
      setSlip(null);
      setSelectedPaymentIds([]);
      await refreshPayments({ force: true, afterSave: true });
    } catch (nextError) {
      setError(localizeError(nextError.message, language, tr("ตรวจสลิปไม่สำเร็จ", "Unable to verify the slip.")));
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
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
      <div className="payment-refresh-bar">
        <small>{lastUpdatedAt ? `${tr("อัปเดตล่าสุด", "Updated")} ${formatPaymentTime(lastUpdatedAt, language)}` : ""}</small>
        <button disabled={refreshing || reading || submitting} onClick={() => refreshPayments({ force: true })} type="button"><RefreshCw className={refreshing ? "is-spinning" : ""} size={16} /> {refreshing ? tr("กำลังอัปเดต", "Refreshing") : tr("อัปเดตสถานะ", "Refresh status")}</button>
      </div>
      {refreshError ? <div className="payment-refresh-warning" role="status">{refreshError}</div> : null}
      {result ? <section aria-live="polite" className={`liff-payment-result is-${result.status}`}><Check size={25} /><div><strong>{result.status === "auto_paid" ? tr("บันทึกว่าชำระแล้ว", "Payment recorded") : tr("รับสลิปแล้ว · รอตรวจสอบ", "Slip received · Pending review")}</strong><span>{result.status === "auto_paid" ? tr("ยอดที่เลือกถูกบันทึกว่าชำระแล้ว", "Your selected balances have been marked as paid.") : tr("แอดมินจะตรวจสอบและอัปเดตสถานะให้ ไม่ต้องส่งสลิปซ้ำ", "An admin will review it. You do not need to resubmit the slip.")}</span>{result.submittedAt ? <small>{tr("ส่งเมื่อ", "Submitted")} {formatPaymentTime(result.submittedAt, language)}</small> : null}</div></section> : null}

      <section className="liff-payment-card">
        <div className="liff-payment-profile"><UserRound size={20} /><span>{tr("เข้าใช้ด้วย LINE", "Signed in with LINE")}</span><strong>{data.profile.nickname || data.profile.name}</strong></div>
        <label className="liff-beneficiary-select">
          <span>{tr("เพิ่มผู้เล่นที่ต้องการชำระ", "Add players to this payment")}</span>
          <select disabled={!selectableBeneficiaries.length || reading || submitting} onChange={(event) => addBeneficiary(event.target.value)} value={beneficiaryId}>
            <option value="">{selectableBeneficiaries.length ? tr("เลือกชื่อผู้เล่น", "Select a player") : tr("เลือกผู้เล่นครบแล้ว", "All players selected")}</option>
            {selectableBeneficiaries.map((entry) => <option key={entry.id} value={entry.id}>{beneficiaryLabel(entry)}</option>)}
          </select>
          <small><Users size={13} /> {tr("เลือกได้หลายคน แล้วโอนยอดรวมเพียงครั้งเดียว", "Select multiple players and make one combined transfer.")}</small>
        </label>
      </section>

      <section className="liff-payment-card">
        <div className="liff-payment-section-title"><div><strong>{tr("เลือกรอบที่ต้องการจ่าย", "Select sessions to pay")}</strong><span>{selectedBeneficiaries.length} {tr("คน", "players")} · {availablePayments.length} {tr("รอบค้าง", "outstanding sessions")}</span></div></div>
        {availablePayments.length ? <div className="liff-beneficiary-groups">{selectedBeneficiaries.map((entry) => <section className="liff-beneficiary-group" key={entry.id}>
          <header><div><UserPlus size={16} /><strong>{beneficiaryLabel(entry)}</strong></div><button aria-label={`${tr("นำ", "Remove")} ${entry.name}`} disabled={reading || submitting} onClick={() => removeBeneficiary(entry.id)} type="button"><X size={16} /></button></header>
          <div className="liff-due-list">{entry.payments.map((payment) => <label className={`${selectedPaymentIds.includes(payment.id) ? "is-selected" : ""} ${isPaymentSelectable(payment) ? "" : "is-under-review"}`} key={payment.id}>
            <input checked={selectedPaymentIds.includes(payment.id)} disabled={reading || submitting || !isPaymentSelectable(payment)} onChange={() => toggleRound(payment.id)} type="checkbox" />
            <span><strong>{language === "en" ? formatMemberDate(payment.eventDate, language) : formatThaiDate(payment.eventDate)}</strong><small>{payment.venue}</small>
              <span className={`payment-state-badge is-${payment.paymentStatus || "awaiting"}`}>{payment.paymentStatus === "review" ? tr("ส่งแล้วรอตรวจ", "Submitted · Pending review") : payment.paymentStatus === "paid" ? tr("ชำระแล้ว", "Paid") : tr("ยังไม่ส่งสลิป", "Not submitted")}</span>
              {payment.submittedAt ? <small>{tr("ส่งเมื่อ", "Submitted")} {formatPaymentTime(payment.submittedAt, language)}</small> : null}
              {payment.submissionStatus === "rejected" ? <small className="payment-rejected-note">{tr("สลิปก่อนหน้ายังไม่ผ่าน กรุณาตรวจสอบแล้วแนบสลิปใหม่", "The previous slip was not approved. Check and attach a new slip.")}{payment.reviewReason ? ` · ${payment.reviewReason}` : ""}</small> : null}
              {Number(payment.extrasAmount || 0) > 0 ? <span className="liff-payment-extra-summary"><strong>{tr("ค่าน้ำ/ขนม", "Refreshments")} {baht(payment.extrasAmount)} {tr("บาท", "THB")}</strong>{payment.extras?.length ? payment.extras.map((item, index) => <small key={`${item.name}-${index}`}>{item.name} × {Number(item.quantity || 1)} · {baht(item.amount)} {tr("บาท", "THB")}</small>) : <small>{tr("รายการสินค้ากำลังรอรายละเอียด กรุณาสอบถามแอดมิน", "Item details unavailable; please ask an admin.")}</small>}</span> : null}
            </span><b>{baht(payment.amount)} {tr("บาท", "THB")}</b>
          </label>)}</div>
        </section>)}</div> : selectableBeneficiaries.length ? <div className="liff-payment-empty"><UserPlus size={31} /><strong>{tr("กรุณาเลือกผู้เล่น", "Select a player")}</strong><span>{tr("เลือกชื่อด้านบนก่อน แล้วจึงเลือกรอบที่ต้องการชำระ", "Choose a player above, then select the sessions to pay.")}</span></div> : <div className="liff-payment-empty"><ShieldCheck size={31} /><strong>{testMode ? tr("ยังไม่มียอดค้างทดลอง", "No test balance yet") : tr("ไม่มียอดค้างชำระ", "No outstanding balance")}</strong><span>{testMode ? tr("ลงชื่อผ่านลิงก์ทดลอง แล้วให้แอดมินสรุปยอดของคุณก่อนทดสอบหน้านี้", "Register through the test link and ask the admin to finalize your test balance first.") : tr("ยอดที่ชำระแล้วหรือยังไม่ได้สรุปจะไม่แสดงในหน้านี้", "Paid or unfinished balances are not shown here.")}</span></div>}
        {payablePayments.length ? <>
          <div className="liff-payment-bank">
            <strong>{language === "en" ? "Siam Commercial Bank" : PAYMENT_BANK_NAME} {PAYMENT_BANK_ACCOUNT_DISPLAY}</strong>
            <button onClick={copyBankAccount} type="button"><Copy size={16} /> {accountCopied ? tr("คัดลอกแล้ว", "Copied") : tr("คัดลอก", "Copy")}</button>
          </div>
          <div className="liff-payment-total"><span>{tr("ยอดที่ต้องชำระ", "Amount due")}</span><strong>{baht(total)} {tr("บาท", "THB")}</strong></div>
          {selectedExtras.total > 0 ? <p className="liff-payment-total-extras"><strong>{tr("ในยอดนี้มีค่าน้ำ/ขนม", "Refreshments included")} {baht(selectedExtras.total)} {tr("บาท", "THB")}</strong>{selectedExtras.items.length ? <span>{formatPaymentExtraItems(selectedExtras.items, language)}</span> : null}</p> : null}
          <p className="liff-payment-amount-note">{tr("จำนวนเงินในสลิปต้องตรงกับยอดที่ต้องชำระเท่านั้น", "The amount on the slip must exactly match the amount due.")}</p>
        </> : null}
      </section>

      {payablePayments.length ? <section className="liff-payment-card">
        <div className="liff-payment-section-title"><div><strong>{tr("แนบรูปสลิป", "Attach transfer slip")}</strong><span>{tr("รองรับภาพจากแอปธนาคาร", "Use an image from your banking app")}</span></div></div>
        <label className={`liff-slip-picker ${slip ? "has-slip" : ""}`}>
          <input accept="image/*" disabled={reading || submitting} onChange={readSlip} onClick={(event) => { if (!requireSelectedRound()) event.preventDefault(); }} type="file" />
          {reading ? <><LoaderCircle className="is-spinning" size={28} /><strong>{tr("กำลังอ่านข้อความ", "Reading slip")} {progress}%</strong></> : slip ? <><ImagePlus size={29} /><strong>{tr("แนบรูปแล้ว · ยังไม่ได้ส่ง", "Image attached · Not submitted")}</strong><span>{tr("ยอด", "Amount")} {slip.amount === null ? tr("อ่านไม่ชัด", "unclear") : `${baht(slip.amount)} ${tr("บาท", "THB")}`} · {tr("วันที่", "Date")} {slip.date || tr("อ่านไม่ชัด", "unclear")} · {tr("เลขอ้างอิง", "Reference")} {slip.reference || tr("อ่านไม่ชัด", "unclear")}</span></> : <><ImagePlus size={29} /><strong>{tr("เลือกรูปสลิป", "Choose slip image")}</strong><span>{tr("แตะเพื่อเลือกรูปจากเครื่อง", "Tap to choose an image")}</span></>}
        </label>
        {slip && recipientStatus === "mismatch" ? <p className="liff-slip-warning">{tr(`บัญชีผู้รับไม่ถูกต้อง กรุณาตรวจสอบว่าโอนไปยัง ${PAYMENT_RECIPIENT_NAME}`, `Incorrect recipient. Please make sure the transfer is sent to ${PAYMENT_RECIPIENT_NAME}.`)}</p> : null}
        {slip?.readError ? <p className="liff-slip-warning">{tr("ระบบอ่านสลิปอัตโนมัติไม่พร้อม แต่เตรียมรูปแล้ว คุณส่งให้แอดมินตรวจได้", "Automatic slip reading is unavailable. Your image is ready to send for admin review.")}</p> : null}
        {slip && amountDifference !== null && amountDifference < -0.009 ? <p className="liff-slip-warning">{tr(`ยอดเงินที่โอนไม่ถูกต้อง เนื่องจากน้อยกว่ายอดที่ต้องจ่ายจริง ต้องชำระ ${baht(total)} บาท แต่สลิปเป็น ${baht(slip.amount)} บาท`, `The transferred amount is too low. Amount due: ${baht(total)} THB; slip: ${baht(slip.amount)} THB.`)}</p> : null}
        {slip && amountDifference !== null && amountDifference > 0.009 ? <p className="liff-slip-warning">{tr(`ยอดเงินที่โอนไม่ถูกต้อง เนื่องจากมากกว่ายอดที่ต้องจ่ายจริง ต้องชำระ ${baht(total)} บาท แต่สลิปเป็น ${baht(slip.amount)} บาท`, `The transferred amount is too high. Amount due: ${baht(total)} THB; slip: ${baht(slip.amount)} THB.`)}</p> : null}
        {needsManualReview ? <p className="liff-slip-warning">{tr("ถ้าระบบอ่านข้อมูลผิดหรืออ่านไม่ชัด ส่งให้แอดมินตรวจรูปสลิปได้ ยอดจะยังไม่ถูกตัดจนกว่าจะอนุมัติ", "If any details were read incorrectly, send the image for admin review. The balance stays outstanding until approved.")}</p> : null}
        {error ? <div className="liff-inline-error">{error}</div> : null}
        <button className="liff-payment-submit" disabled={reading || submitting || (selectedPaymentIds.length > 0 && (!slip || recipientStatus === "mismatch" || amountMismatch))} onClick={() => submitPayment(false)} type="button">{submitting ? tr("กำลังส่งสลิป...", "Submitting slip...") : tr(`ยืนยันแจ้งโอน ${baht(total)} บาท`, `Submit payment of ${baht(total)} THB`)}</button>
        {slip && needsManualReview ? <button className="payment-manual-review" disabled={reading || submitting} onClick={() => submitPayment(true)} type="button"><ShieldCheck size={18} /> {tr("ส่งให้แอดมินตรวจ", "Send for admin review")}</button> : null}
      </section> : null}

      {data.recentPaid?.length ? <section className="liff-payment-card payment-paid-history"><strong>{tr("ประวัติชำระล่าสุดของคุณ", "Your recent payments")}</strong>{data.recentPaid.map((payment) => <article key={payment.id}><div><strong>{formatMemberDate(payment.eventDate, language)}</strong><small>{payment.venue}</small><small>{tr("ชำระเมื่อ", "Paid")} {formatPaymentTime(payment.paidAt, language)}</small></div><div><span className="payment-state-badge is-paid">{tr("ชำระแล้ว", "Paid")}</span><b>{baht(payment.amount)} {tr("บาท", "THB")}</b></div></article>)}</section> : null}
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

function formatPaymentTime(value, language) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(language === "en" ? "en-GB" : "th-TH", {
    timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(date) : "";
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
