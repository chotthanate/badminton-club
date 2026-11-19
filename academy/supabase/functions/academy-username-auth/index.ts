import { createClient } from "npm:@supabase/supabase-js@2.110.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const normalizeUsername = (value: unknown) => String(value || "").trim().toLowerCase();

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await request.json();
    const action = String(body.action || "");
    const username = normalizeUsername(body.username);
    const password = String(body.password || "");
    if (!/^[a-z0-9._-]{3,40}$/.test(username) || password.length < 8) {
      return json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const publishableKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

    if (action === "sign_in") {
      const { data: profile } = await admin.from("academy_profiles")
        .select("user_id, internal_email").ilike("username", username).eq("active", true).maybeSingle();
      if (!profile) return json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }, 401);
      const client = createClient(url, publishableKey, { auth: { persistSession: false } });
      const { data, error } = await client.auth.signInWithPassword({ email: profile.internal_email, password });
      if (error || !data.session) return json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }, 401);
      return json({ session: data.session });
    }

    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    const { data: caller } = await admin.from("academy_profiles").select("role").eq("user_id", user.id).maybeSingle();
    if (caller?.role !== "admin") return json({ error: "ไม่มีสิทธิ์ดำเนินการ" }, 403);

    if (action === "create_user") {
      const role = String(body.role || "student");
      const displayName = String(body.displayName || "").trim();
      if (!['admin', 'teacher', 'student'].includes(role) || !displayName) return json({ error: "ข้อมูลไม่ครบ" }, 400);
      const internalEmail = `${crypto.randomUUID()}@academy.invalid`;
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: internalEmail,
        password,
        email_confirm: true,
        app_metadata: { academy_role: role },
      });
      if (createError || !created.user) return json({ error: createError?.message || "สร้างบัญชีไม่สำเร็จ" }, 400);
      const userId = created.user.id;
      const { error: profileError } = await admin.from("academy_profiles").insert({ user_id: userId, username, internal_email: internalEmail, display_name: displayName, role });
      if (profileError) {
        await admin.auth.admin.deleteUser(userId);
        return json({ error: profileError.code === "23505" ? "Username นี้ถูกใช้แล้ว" : "สร้างโปรไฟล์ไม่สำเร็จ" }, 400);
      }
      return json({ userId });
    }

    if (action === "reset_password") {
      const targetUserId = String(body.userId || "");
      const { error } = await admin.auth.admin.updateUserById(targetUserId, { password });
      if (error) return json({ error: "ตั้งรหัสผ่านใหม่ไม่สำเร็จ" }, 400);
      return json({ ok: true });
    }
    return json({ error: "Unknown action" }, 400);
  } catch {
    return json({ error: "ระบบเข้าสู่ระบบขัดข้อง กรุณาลองใหม่" }, 500);
  }
});
