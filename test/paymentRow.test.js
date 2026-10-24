import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildSync } from "esbuild";
import { renderToStaticMarkup } from "react-dom/server";

// Render and call the real component without introducing a second UI-state model.
const compiled = buildSync({
  entryPoints: [fileURLToPath(new URL("../src/PaymentRow.jsx", import.meta.url))],
  bundle: true,
  format: "cjs",
  packages: "external",
  platform: "node",
  write: false,
}).outputFiles[0].text;
const componentModule = { exports: {} };
new Function("require", "module", "exports", compiled)(createRequire(import.meta.url), componentModule, componentModule.exports);
const PaymentRow = componentModule.exports.default;
const baseRow = {
  memberId: "player-1", name: "ชื่อผู้เล่นทดสอบที่ยาวมากพร้อมนามสกุลเต็ม", signupOrder: 12,
  playedMinutes: 105, billingFinalized: true, paid: false, billedAmount: 195,
  extraCharges: [], overpaymentAmount: 0,
};

function nodes(element, predicate) {
  if (!element || typeof element !== "object") return [];
  const children = Array.isArray(element.props?.children) ? element.props.children.flat(Infinity) : [element.props?.children];
  return [...(predicate(element) ? [element] : []), ...children.flatMap((child) => nodes(child, predicate))];
}

function text(element) {
  if (element === null || element === undefined || typeof element === "boolean") return "";
  if (typeof element !== "object") return String(element);
  const children = Array.isArray(element.props?.children) ? element.props.children.flat(Infinity) : [element.props?.children];
  return children.map(text).join("");
}

function render(overrides = {}, props = {}) {
  const row = { ...baseRow, ...overrides };
  const element = PaymentRow({ row, onTogglePayment() {}, onEditBill() {}, ...props });
  const buttons = nodes(element, (node) => node.type === "button");
  return { row, element, buttons, action: buttons.at(-1), html: renderToStaticMarkup(element) };
}

test("finalized unpaid bill presents an action to receive money, not a completed payment", () => {
  const { element, action, html } = render();
  assert.equal(text(action).trim(), "รับเงิน");
  assert.equal(action.props.className, "is-awaiting");
  assert.equal(action.props.disabled, undefined);
  assert.ok(!element.props.className.includes("is-paid"));
  assert.ok(html.includes("สรุปยอดแล้ว · รอชำระ"));
  assert.ok(!html.includes("รับเงินแล้ว"));
});

test("paid state remains paid and retains the existing toggle callback", () => {
  const calls = [];
  const { row, element, action, buttons, html } = render({ paid: true }, { onTogglePayment: (value) => calls.push(value) });
  assert.equal(text(action).trim(), "จ่ายแล้ว");
  assert.equal(action.props.className, "is-paid");
  assert.ok(element.props.className.includes("is-paid"));
  assert.ok(html.includes("ชำระแล้ว"));
  assert.equal(buttons.length, 1, "paid bills cannot be edited");
  action.props.onClick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0], row);
});

test("zero-baht bills never imply payment without the explicit paid state", () => {
  const awaiting = render({ billedAmount: 0 });
  assert.equal(text(awaiting.action).trim(), "รับเงิน");
  assert.ok(awaiting.html.includes("0 บาท"));
  assert.ok(awaiting.html.includes("สรุปยอดแล้ว · รอชำระ"));
  assert.ok(!awaiting.element.props.className.includes("is-paid"));
  const paid = render({ billedAmount: 0, paid: true });
  assert.equal(text(paid.action).trim(), "จ่ายแล้ว");
  assert.ok(paid.html.includes("ชำระแล้ว"));
});

test("unsummarized time-based bill still opens summarize action without exposing estimated due", () => {
  const { action, buttons, html } = render({ billingFinalized: false, billedAmount: null });
  assert.equal(text(action).trim(), "สรุปยอด");
  assert.equal(buttons.length, 1);
  assert.ok(html.includes("ยังไม่สรุป"));
  assert.ok(html.includes("ยังไม่ได้สรุปยอด"));
  assert.ok(!html.includes("195 บาท"));
});

test("ongoing per-round bill remains disabled until finalized", () => {
  const pending = render({ billingFinalized: false }, { perRoundAwaitingClose: true });
  assert.equal(pending.action.props.disabled, true);
  assert.equal(text(pending.action).trim(), "รอจบรอบ");
  assert.ok(pending.html.includes("รอจบรอบก่อนสรุปยอด"));
  const finalized = render({}, { perRoundAwaitingClose: true });
  assert.equal(finalized.action.props.disabled, false);
  assert.equal(text(finalized.action).trim(), "รับเงิน");
});

test("long Thai and unbroken Latin names retain the complete label and signup order", () => {
  for (const name of [baseRow.name, "LongUnbrokenPlayerName".repeat(8), "น้องน้ำ ผู้เล่นทดสอบชื่อยาว (Walk-in)"]) {
    const { element, html } = render({ name });
    const identity = nodes(element, (node) => node.props?.className === "badminton-pay-person")[0];
    const nameNode = nodes(identity, (node) => node.type === "strong")[0];
    assert.equal(text(nameNode), `12. ${name}`);
    assert.ok(html.includes(name));
  }
});

test("edit and collect buttons call the correct handler with the untouched row", () => {
  const edits = [], payments = [];
  const { row, buttons, action } = render({}, { onEditBill: (value) => edits.push(value), onTogglePayment: (value) => payments.push(value) });
  const edit = buttons.find((button) => button.props.className === "badminton-edit-bill");
  assert.equal(edit.props["aria-label"], `แก้ยอดเรียกเก็บของ ${row.name}`);
  edit.props.onClick();
  assert.deepEqual(edits, [row]);
  assert.deepEqual(payments, []);
  action.props.onClick();
  assert.deepEqual(payments, [row]);
  assert.equal(row.paid, false, "rendering/clicking delegates rather than mutating settlement data");
  assert.ok(buttons.every((button) => button.props.type === "button"));
});

test("extra purchases and overpayment remain visible alongside the payment state", () => {
  const { html } = render({
    paid: true, overpaymentAmount: 5,
    extraCharges: [{ id: "water", name: "น้ำเปล่า", quantity: 2, unitPrice: 10 }, { id: "snack", name: "ขนม", quantity: 1, unitPrice: 15 }],
  }, { extraLabel: "น้ำเปล่า×2 20, ขนม 15" });
  assert.ok(html.includes("น้ำเปล่า×2 20, ขนม 15"));
  assert.ok(html.includes("น้ำเปล่า × 2 = 20 บาท"));
  assert.ok(html.includes("ขนม × 1 = 15 บาท"));
  assert.ok(html.includes("ชำระแล้ว · โอนเกิน 5 บาท"));
});
