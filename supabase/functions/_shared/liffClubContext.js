// Never infer sandbox privileges from request flags alone: confirm the club in the DB.
export async function resolveLiffClubContext(admin, payload, configuredClubId) {
  if (!payload?.testMode) return { clubId: configuredClubId, isTestClub: false };
  const testClubId = String(payload.testClubId || "");
  if (!testClubId) throw new Error("ไม่พบกลุ่มทดลองสำหรับลิงก์นี้");
  const { data: club, error } = await admin.from("clubs")
    .select("id, is_test")
    .eq("id", testClubId)
    .maybeSingle();
  if (error) throw error;
  if (club?.is_test !== true) throw new Error("ลิงก์นี้ไม่ได้เชื่อมกับกลุ่มทดลอง");
  return { clubId: club.id, isTestClub: true };
}

export async function resolveLiffClubId(admin, payload, configuredClubId) {
  return (await resolveLiffClubContext(admin, payload, configuredClubId)).clubId;
}
