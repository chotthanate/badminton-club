// Read-only live verification. Supply credentials via environment; never print them.
import { createClient } from "@supabase/supabase-js";
import { loadPaymentBalances, readPaymentPages } from "../supabase/functions/_shared/paymentRead.js";

if (!process.env.PAYMENT_CHECK_URL || !process.env.PAYMENT_CHECK_KEY) throw new Error("Missing payment-check environment");
const admin = createClient(process.env.PAYMENT_CHECK_URL, process.env.PAYMENT_CHECK_KEY, { auth: { persistSession: false } });
const clubs = await readPaymentPages(() => admin.from("clubs").select("id,is_test").order("id"));
for (const club of clubs) {
  const warnings = [];
  const balances = await loadPaymentBalances(admin, club.id, (stage) => warnings.push(stage));
  const events = await readPaymentPages(() => admin.from("events").select("id,status")
    .eq("club_id", club.id).eq("status", "open").order("id"));
  const rounds = [];
  for (const event of events) {
    const counts = {};
    for (const table of ["signups", "attendance", "queue_matches", "payments"]) {
      const rows = await readPaymentPages(() => admin.from(table).select(table === "queue_matches" ? "id,status" : "id")
        .eq("event_id", event.id).order("id"));
      counts[table] = rows.length;
      if (table === "queue_matches") counts.queueStates = rows.reduce((result, row) => {
        result[row.status] = (result[row.status] || 0) + 1; return result;
      }, {});
    }
    rounds.push({ eventId: event.id, status: event.status, ...counts });
  }
  console.log(JSON.stringify({ isTest: club.is_test, members: balances.clubMembers.length,
    duePayments: balances.duePayments.length, slips: balances.slips.length, extras: balances.dueExtras.length,
    warnings, rounds }));
}
