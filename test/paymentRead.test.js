import test from "node:test";
import assert from "node:assert/strict";
import { loadPaymentBalances, readPaymentPages, readPaymentBatches } from "../supabase/functions/_shared/paymentRead.js";

function database(tables, failTable) {
  const calls = [];
  return { calls, from(table) {
    const filters = [];
    const orders = [];
    const query = {
      select() { return query; },
      eq(key, value) { filters.push((row) => row[key] === value); return query; },
      in(key, values) { assert.ok(values.length <= 40); filters.push((row) => values.includes(row[key])); return query; },
      overlaps(key, values) { assert.ok(values.length <= 40); filters.push((row) => row[key].some((value) => values.includes(value))); return query; },
      not(key) { filters.push((row) => row[key] != null); return query; },
      is(key, value) { filters.push((row) => row[key] === value); return query; },
      order(key, options) { orders.push([key, options?.ascending !== false]); return query; },
      async range(start, end) {
        calls.push({ table, start, end });
        if (table === failTable) return { error: { code: "unavailable" } };
        const rows = tables[table].filter((row) => filters.every((filter) => filter(row))).sort((a, b) => {
          for (const [key, ascending] of orders) {
            const result = String(a[key]).localeCompare(String(b[key]));
            if (result) return ascending ? result : -result;
          }
          return 0;
        });
        return { data: rows.slice(start, end + 1), error: null };
      },
    };
    return query;
  } };
}

test("large payment history retains all balances, deduplicates cross-batch slips and reads beyond page limits", async () => {
  const club_members = Array.from({ length: 2000 }, (_, i) => ({ id: `m${i}`, club_id: "club", active: true, created_at: "same" }));
  const payments = club_members.flatMap((member) => Array.from({ length: 3 }, (_, i) => ({
    id: `${member.id}-p${i}`, member_id: member.id, event_id: `e${i}`, club_id: "club", created_at: "same", amount: 75,
    admin_confirmed_at: "confirmed", paid_at: null, payment_status: "awaiting",
  })));
  const payment_slips = [{ id: "slip", club_id: "club", created_at: "2026-01-01", payment_ids: payments.map((row) => row.id), status: "pending" }];
  const member_extra_charges = Array.from({ length: 1200 }, (_, i) => ({ id: `extra${i}`, club_id: "club", member_id: "m0", event_id: "e0", created_at: "same" }));
  const tables = { club_members, payments, payment_slips, member_extra_charges };
  const snapshot = JSON.stringify(tables);
  const result = await loadPaymentBalances(database(tables), "club");
  assert.equal(result.clubMembers.length, 2000);
  assert.equal(result.duePayments.length, 6000);
  assert.equal(result.duePayments.reduce((sum, row) => sum + row.amount, 0), 450000);
  assert.equal(result.slips.length, 1);
  assert.equal(result.dueExtras.length, 1200);
  assert.equal(result.extrasUnavailable, false);
  assert.equal(JSON.stringify(tables), snapshot);
});

test("extra-detail failure preserves balances while a slip-status failure blocks unsafe selection", async () => {
  const tables = {
    club_members: [{ id: "m", club_id: "c", active: true }],
    payments: [{ id: "p", club_id: "c", member_id: "m", event_id: "e", payment_status: "review", paid_at: null, admin_confirmed_at: "yes", amount: 100 }],
    payment_slips: [], member_extra_charges: [],
  };
  const reports = [];
  const result = await loadPaymentBalances(database(tables, "member_extra_charges"), "c", (stage) => reports.push(stage));
  assert.equal(result.duePayments[0].amount, 100);
  assert.equal(result.extrasUnavailable, true);
  assert.deepEqual(reports, ["extras_unavailable"]);
  await assert.rejects(loadPaymentBalances(database(tables, "payment_slips"), "c"));
});

test("paging fails closed on a later page instead of returning a truncated balance", async () => {
  await assert.rejects(readPaymentPages(() => ({ range: async (start) => start ? { error: new Error("offline") } : { data: [1, 2] } }), 2), /offline/);
});

test("large batches never exceed six simultaneous reads", async () => {
  let active = 0;
  let peak = 0;
  const rows = await readPaymentBatches(Array.from({ length: 1000 }, (_, i) => i), async (ids) => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--; return ids;
  });
  assert.equal(peak, 6);
  assert.equal(rows.length, 1000);
});
