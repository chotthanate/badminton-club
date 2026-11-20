import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../supabase/migrations/20261119112931_academy_core.sql", import.meta.url);
const authFunctionUrl = new URL("../supabase/functions/academy-username-auth/index.ts", import.meta.url);
const lineFunctionUrl = new URL("../supabase/functions/academy-line/index.ts", import.meta.url);

test("every Academy public table enables RLS and Data API access is explicit", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const tables = [...sql.matchAll(/create table public\.(academy_[a-z_]+)/g)].map((match) => match[1]);
  assert.ok(tables.length >= 15);
  for (const table of tables) assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`));
  assert.match(sql, /grant select on public\.academy_settings/);
  assert.doesNotMatch(sql, /grant all .* to anon/i);
});

test("privileged Academy RPCs revoke anonymous execution and authorize internally", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const functionName of ["academy_finalize_session_billing", "academy_submit_payment", "academy_list_payable_invoices", "academy_review_payment", "academy_adjust_invoice", "academy_check_in_teacher"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${functionName}`));
  }
  assert.match(sql, /if not private\.academy_is_admin\(\) then raise exception 'not authorized'/);
  assert.match(sql, /split_part\(p_slip_path, '\/', 1\) <> auth\.uid\(\)::text/);
  assert.match(sql, /academy_sessions_finalized_immutable/);
  assert.doesNotMatch(sql, /academy_line_link_self/);
});

test("service role remains only in server-side Edge Functions", async () => {
  const authSource = await readFile(authFunctionUrl, "utf8");
  const lineSource = await readFile(lineFunctionUrl, "utf8");
  assert.match(authSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(lineSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(lineSource, /X-Line-Signature/);
  assert.match(lineSource, /crypto\.subtle\.sign/);
});
