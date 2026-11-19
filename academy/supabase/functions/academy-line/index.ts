import { createClient } from "npm:@supabase/supabase-js@2.110.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-line-signature",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const encoder = new TextEncoder();

async function validLineSignature(body: string, signature: string | null, secret: string) {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest)));
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return mismatch === 0;
}

async function reply(replyToken: string, messages: Array<{ type: "text"; text: string }>) {
  const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") || "";
  if (!token || !replyToken) return;
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ replyToken, messages }),
  });
}

const formatDate = (value: string) => new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(`${value}T12:00:00+07:00`));

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const rawBody = await request.text();
  let body: any;
  try { body = JSON.parse(rawBody); } catch { return json({ error: "Invalid JSON" }, 400); }

  if (body.action === "link") {
    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    const lineAccessToken = String(body.lineAccessToken || "");
    const profileResponse = await fetch("https://api.line.me/v2/profile", { headers: { Authorization: `Bearer ${lineAccessToken}` } });
    if (!profileResponse.ok) return json({ error: "ยืนยันบัญชี LINE ไม่สำเร็จ" }, 400);
    const profile = await profileResponse.json();
    const { error } = await admin.from("academy_line_accounts").upsert({ user_id: user.id, line_user_id: profile.userId }, { onConflict: "user_id" });
    if (error) return json({ error: error.code === "23505" ? "LINE นี้เชื่อมกับบัญชีอื่นแล้ว" : "เชื่อม LINE ไม่สำเร็จ" }, 400);
    return json({ ok: true, displayName: profile.displayName });
  }

  const secret = Deno.env.get("LINE_CHANNEL_SECRET") || "";
  if (!await validLineSignature(rawBody, request.headers.get("X-Line-Signature"), secret)) return json({ error: "Invalid signature" }, 401);

  for (const event of body.events || []) {
    if (event.type !== "message" || event.message?.type !== "text") continue;
    const lineUserId = event.source?.userId;
    const command = String(event.message.text || "").trim();
    const { data: account } = await admin.from("academy_line_accounts").select("user_id, profile:academy_profiles(display_name)").eq("line_user_id", lineUserId).maybeSingle();
    if (!account) {
      await reply(event.replyToken, [{ type: "text", text: "กรุณาเข้าสู่เว็บ Academy และเชื่อมบัญชี LINE ก่อนใช้งาน" }]);
      continue;
    }

    if (command === "ดูคลาส" || command === "คลาส") {
      const { data: sessions } = await admin.from("academy_sessions").select("id, session_date, starts_at, ends_at, venue").eq("status", "open").gte("starts_at", new Date().toISOString()).order("starts_at").limit(5);
      const text = sessions?.length ? sessions.map((session, index) => `${index + 1}. ${formatDate(session.session_date)} · ${session.venue}\n${session.starts_at.slice(11, 16)}–${session.ends_at.slice(11, 16)}`).join("\n\n") : "ยังไม่มีคลาสที่เปิดลงชื่อ";
      await reply(event.replyToken, [{ type: "text", text }]);
      continue;
    }

    if (command === "ลงชื่อ") {
      const { data: session } = await admin.from("academy_sessions").select("id, session_date, starts_at, venue").eq("status", "open").gte("starts_at", new Date().toISOString()).order("starts_at").limit(1).maybeSingle();
      if (!session) { await reply(event.replyToken, [{ type: "text", text: "ยังไม่มีคลาสที่เปิดลงชื่อ" }]); continue; }
      const { error } = await admin.from("academy_registrations").upsert({ session_id: session.id, student_id: account.user_id, status: "registered", source: "line", cancelled_at: null }, { onConflict: "session_id,student_id" });
      await reply(event.replyToken, [{ type: "text", text: error ? "ลงชื่อไม่สำเร็จ กรุณาลองในเว็บ" : `ลงชื่อ ${formatDate(session.session_date)} ที่ ${session.venue} แล้ว` }]);
      continue;
    }

    if (command === "ยกเลิก") {
      const { data: registration } = await admin.from("academy_registrations").select("id, session:academy_sessions!inner(session_date, starts_at)").eq("student_id", account.user_id).eq("status", "registered").gte("session.starts_at", new Date().toISOString()).order("registered_at").limit(1).maybeSingle();
      if (!registration) { await reply(event.replyToken, [{ type: "text", text: "ไม่พบคลาสที่ลงชื่อไว้" }]); continue; }
      await admin.from("academy_registrations").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", registration.id);
      await reply(event.replyToken, [{ type: "text", text: `ยกเลิกคลาส ${formatDate(registration.session.session_date)} แล้ว` }]);
      continue;
    }

    if (command === "ยอดค้าง") {
      const { data: invoices } = await admin.from("academy_invoices").select("total_satang").eq("student_id", account.user_id).in("status", ["unpaid", "slip_pending", "manual_review"]);
      const total = (invoices || []).reduce((sum, invoice) => sum + Number(invoice.total_satang), 0) / 100;
      await reply(event.replyToken, [{ type: "text", text: `ยอดคงค้าง ${total.toLocaleString("th-TH")} บาท\nเปิดหน้า Academy เพื่อดูรายละเอียดหรือแนบสลิป` }]);
      continue;
    }

    await reply(event.replyToken, [{ type: "text", text: "คำสั่ง Academy\n• ดูคลาส\n• ลงชื่อ\n• ยกเลิก\n• ยอดค้าง" }]);
  }
  return json({ ok: true });
});
