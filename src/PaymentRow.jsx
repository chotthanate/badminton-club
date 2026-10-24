import React from "react";
import { Check, Pencil, Timer, WalletCards } from "lucide-react";
import { baht, formatPlayedDuration } from "./badmintonLogic.js";

export default function PaymentRow({ row, extraLabel, perRoundAwaitingClose, onTogglePayment, onEditBill }) {
  const awaitingClose = perRoundAwaitingClose && !row.billingFinalized;
  const actionLabel = row.paid ? "จ่ายแล้ว" : row.billingFinalized ? "รับเงิน" : awaitingClose ? "รอจบรอบ" : "สรุปยอด";
  const ActionIcon = row.paid ? Check : awaitingClose ? Timer : WalletCards;

  return (
    <article className={`badminton-pay-row ${row.billingFinalized ? "is-billed" : ""} ${row.paid ? "is-paid" : ""}`}>
      <div className="badminton-pay-person">
        <strong>{row.signupOrder ? `${row.signupOrder}. ` : ""}{row.name}</strong>
        <span className="badminton-pay-duration">{formatPlayedDuration(row.playedMinutes)}</span>
        {extraLabel ? <details className="badminton-pay-extras">
          <summary>{extraLabel}</summary>
          <div>{(row.extraCharges || []).map((charge) => <span key={charge.id || `${charge.name}-${charge.unitPrice}`}>
            {charge.name} × {charge.quantity || 1} = {baht(Number(charge.unitPrice) * Number(charge.quantity || 1))} บาท
          </span>)}</div>
        </details> : null}
        <small>{row.billingFinalized
          ? `${row.paid ? "ชำระแล้ว" : "สรุปยอดแล้ว · รอชำระ"}${row.overpaymentAmount > 0 ? ` · โอนเกิน ${baht(row.overpaymentAmount)} บาท` : ""}`
          : awaitingClose ? "รอจบรอบก่อนสรุปยอด" : "ยังไม่ได้สรุปยอด"}</small>
      </div>
      <strong className={`badminton-pay-amount ${row.billingFinalized ? "" : "is-unfinalized"}`}>
        {row.billingFinalized ? `${baht(row.billedAmount)} บาท` : "ยังไม่สรุป"}
        {row.billingFinalized && !row.paid ? <button
          aria-label={`แก้ยอดเรียกเก็บของ ${row.name}`}
          className="badminton-edit-bill"
          onClick={() => onEditBill(row)}
          title="แก้ยอดเรียกเก็บ"
          type="button"
        ><Pencil size={13} /></button> : null}
      </strong>
      <button
        className={row.paid ? "is-paid" : row.billingFinalized ? "is-awaiting" : ""}
        disabled={awaitingClose}
        onClick={() => onTogglePayment(row)}
        type="button"
      ><ActionIcon size={16} /> {actionLabel}</button>
    </article>
  );
}
