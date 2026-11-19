import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_ACADEMY_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_ACADEMY_SUPABASE_PUBLISHABLE_KEY;

export const isAcademySupabaseConfigured = Boolean(url && publishableKey);
export const academySupabase = isAcademySupabaseConfigured
  ? createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export async function signInWithUsername(username, password) {
  if (!academySupabase) throw new Error("ยังไม่ได้เชื่อมต่อ Supabase ของ Academy");
  const { data, error } = await academySupabase.functions.invoke("academy-username-auth", {
    body: { action: "sign_in", username, password },
  });
  if (error || !data?.session) throw new Error(data?.error || "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
  const { error: sessionError } = await academySupabase.auth.setSession(data.session);
  if (sessionError) throw sessionError;
  return data;
}

export async function linkCurrentLineAccount() {
  if (!academySupabase) throw new Error("ยังไม่ได้เชื่อมต่อ Supabase ของ Academy");
  const liffId = import.meta.env.VITE_ACADEMY_LINE_LIFF_ID;
  if (!liffId || !window.liff) throw new Error("ยังไม่ได้ตั้งค่า LINE LIFF ของ Academy");
  await window.liff.init({ liffId });
  if (!window.liff.isLoggedIn()) {
    window.liff.login({ redirectUri: window.location.href });
    return { redirecting: true };
  }
  const lineAccessToken = window.liff.getAccessToken();
  if (!lineAccessToken) throw new Error("ไม่สามารถอ่านบัญชี LINE ได้");
  const { data, error } = await academySupabase.functions.invoke("academy-line", { body: { action: "link", lineAccessToken } });
  if (error || !data?.ok) throw new Error(data?.error || "เชื่อม LINE ไม่สำเร็จ");
  return data;
}
