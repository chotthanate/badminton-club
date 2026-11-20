import { academySupabase } from "./supabase.js";

function assertClient() {
  if (!academySupabase) throw new Error("ยังไม่ได้เชื่อมต่อ Supabase ของ Academy");
  return academySupabase;
}

function mapSession(row) {
  return {
    id: row.id,
    date: row.session_date,
    startTime: row.starts_at?.slice(11, 16),
    endTime: row.ends_at?.slice(11, 16),
    venue: row.venue,
    serviceFeeSatang: Number(row.service_fee_satang),
    courtCostSatang: Number(row.court_cost_satang),
    status: row.status,
    venueId: row.venue_id,
    registrations: (row.registrations || []).map((registration) => ({
      studentId: registration.student_id,
      name: registration.student?.display_name || "ผู้เรียน",
      status: registration.status,
      source: registration.source,
      attendance: registration.attendance?.status || null,
    })),
    purchases: (row.purchases || []).map((purchase) => ({
      id: purchase.id,
      studentId: purchase.student_id,
      productId: purchase.product_id,
      name: purchase.product_name_snapshot,
      quantity: purchase.quantity,
      unitPriceSatang: Number(purchase.unit_price_satang),
    })),
    teachers: (row.teachers || []).map((teacher) => ({ id: teacher.teacher_id, checkedAt: teacher.checked_at })),
    lessons: (row.lesson_topics || []).map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      description: lesson.description || "",
      kpis: (lesson.kpis || []).map((kpi) => ({
        id: kpi.id,
        name: kpi.name,
        maximum: Number(kpi.maximum_score),
        scores: Object.fromEntries((kpi.scores || []).map((score) => [score.student_id, Number(score.score)])),
      })),
    })),
  };
}

export function createAcademyRepository() {
  return {
    mode: "supabase",
    async getCurrentUser() {
      const client = assertClient();
      const { data: { user }, error: userError } = await client.auth.getUser();
      if (userError) throw userError;
      if (!user) return null;
      const { data, error } = await client.from("academy_profiles").select("*, academy_line_accounts(id)").eq("user_id", user.id).single();
      if (error) throw error;
      return { id: data.user_id, username: data.username, displayName: data.display_name, role: data.role, lineConnected: data.academy_line_accounts?.length > 0 };
    },
    async listProfiles() {
      const { data, error } = await assertClient().from("academy_profiles").select("user_id, username, display_name, role, academy_line_accounts(id)").order("display_name");
      if (error) throw error;
      return data.map((row) => ({ id: row.user_id, username: row.username, displayName: row.display_name, role: row.role, lineConnected: row.academy_line_accounts?.length > 0 }));
    },
    async listSessions() {
      const { data, error } = await assertClient().from("academy_sessions").select(`
        *, teachers:academy_session_teachers(teacher_id, checked_at), registrations:academy_registrations(*, student:academy_profiles!academy_registrations_student_id_fkey(display_name), attendance:academy_attendance(status)),
        purchases:academy_purchases(*),
        lesson_topics:academy_lesson_topics(*, kpis:academy_kpis(*, scores:academy_scores(student_id, score)))
      `).order("starts_at", { ascending: true });
      if (error) throw error;
      return data.map(mapSession);
    },
    async listProducts() {
      const { data, error } = await assertClient().from("academy_products").select("*").eq("active", true).order("name");
      if (error) throw error;
      return data.map((row) => ({ id: row.id, name: row.name, priceSatang: Number(row.price_satang), active: row.active }));
    },
    async listVenues() {
      const { data, error } = await assertClient().from("academy_venues").select("*").eq("active", true).order("is_default", { ascending: false }).order("name");
      if (error) throw error;
      return data.map((row) => ({ id: row.id, name: row.name, active: row.active, isDefault: row.is_default }));
    },
    async listInvoices(studentId = null) {
      let query = assertClient().from("academy_invoices").select("*, session:academy_sessions(session_date), items:academy_invoice_items(description)").order("created_at", { ascending: false });
      if (studentId) query = query.eq("student_id", studentId);
      const { data, error } = await query;
      if (error) throw error;
      return data.map((row) => ({
        id: row.id, studentId: row.student_id, sessionId: row.session_id, date: row.session?.session_date,
        totalSatang: Number(row.total_satang), status: row.status, details: row.items?.map((item) => item.description).join(" · ") || "",
      }));
    },
    async listPaymentOptions() {
      const { data, error } = await assertClient().rpc("academy_list_payable_invoices");
      if (error) throw error;
      return data.map((row) => ({
        id: row.invoice_id,
        studentId: row.student_id,
        studentName: row.student_name,
        sessionId: row.session_id,
        date: row.session_date,
        totalSatang: Number(row.total_satang),
        status: row.status,
        details: row.details || "",
      }));
    },
    async createSession(input) {
      const client = assertClient();
      const startsAt = `${input.date}T${input.startTime}:00+07:00`;
      const endsAt = `${input.date}T${input.endTime}:00+07:00`;
      const { data, error } = await client.from("academy_sessions").insert({
        session_date: input.date, starts_at: startsAt, ends_at: endsAt, venue_id: input.venueId, venue: input.venue,
        service_fee_satang: input.serviceFeeSatang, court_cost_satang: input.courtCostSatang, status: "open",
      }).select().single();
      if (error) throw error;
      if (input.teacherId) {
        const { error: teacherError } = await client.from("academy_session_teachers").insert({ session_id: data.id, teacher_id: input.teacherId });
        if (teacherError) throw teacherError;
      }
      return mapSession({ ...data, registrations: [], purchases: [], lesson_topics: [] });
    },
    async updateSessionCosts(sessionId, input) {
      const { error } = await assertClient().from("academy_sessions").update({
        service_fee_satang: input.serviceFeeSatang,
        court_cost_satang: input.courtCostSatang,
        updated_at: new Date().toISOString(),
      }).eq("id", sessionId).neq("status", "finalized");
      if (error) throw error;
    },
    async register(sessionId, student) {
      const { error } = await assertClient().from("academy_registrations").upsert({ session_id: sessionId, student_id: student.id, status: "registered", source: "student", cancelled_at: null }, { onConflict: "session_id,student_id" });
      if (error) throw error;
    },
    async cancelRegistration(sessionId, studentId) {
      const { error } = await assertClient().from("academy_registrations").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("session_id", sessionId).eq("student_id", studentId);
      if (error) throw error;
    },
    async addWalkIn(sessionId, student) {
      const { error: registrationError } = await assertClient().from("academy_registrations").upsert({ session_id: sessionId, student_id: student.id, status: "registered", source: "walk_in" }, { onConflict: "session_id,student_id" });
      if (registrationError) throw registrationError;
      return this.setAttendance(sessionId, student.id, "present");
    },
    async setAttendance(sessionId, studentId, status) {
      const { error } = await assertClient().from("academy_attendance").upsert({ session_id: sessionId, student_id: studentId, status, checked_at: new Date().toISOString() }, { onConflict: "session_id,student_id" });
      if (error) throw error;
    },
    async checkInTeacher(sessionId, teacherId) {
      const { error } = await assertClient().rpc("academy_check_in_teacher", { p_session_id: sessionId });
      if (error) throw error;
    },
    async addPurchase(sessionId, purchase) {
      const { error } = await assertClient().from("academy_purchases").insert({
        session_id: sessionId, student_id: purchase.studentId, product_id: purchase.productId,
        product_name_snapshot: purchase.name, quantity: purchase.quantity, unit_price_satang: purchase.unitPriceSatang,
      });
      if (error) throw error;
    },
    async addLesson(sessionId, lesson) {
      const client = assertClient();
      const { data: topicRow, error: topicError } = await client.from("academy_lesson_topics").insert({ session_id: sessionId, title: lesson.title, description: lesson.description }).select().single();
      if (topicError) throw topicError;
      for (const [index, kpi] of lesson.kpis.entries()) {
        const result = await client.from("academy_kpis").insert({ lesson_topic_id: topicRow.id, name: kpi.name, maximum_score: kpi.maximum, display_order: index }).select().single();
        if (result.error) throw result.error;
      }
      return topicRow;
    },
    async saveLessonScores(sessionId, lessonId, kpis) {
      const client = assertClient();
      const rows = kpis.flatMap((kpi) => Object.entries(kpi.scores || {}).filter(([, score]) => score !== "" && score !== null).map(([studentId, score]) => ({ kpi_id: kpi.id, student_id: studentId, score: Number(score) })));
      if (!rows.length) return;
      const { error } = await client.from("academy_scores").upsert(rows, { onConflict: "kpi_id,student_id" });
      if (error) throw error;
    },
    async finalizeSession(sessionId) {
      const { error } = await assertClient().rpc("academy_finalize_session_billing", { p_session_id: sessionId });
      if (error) throw error;
    },
    async submitPayment(invoiceIds, file) {
      const client = assertClient();
      const { data: { user } } = await client.auth.getUser();
      const path = `${user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: uploadError } = await client.storage.from("academy-payment-slips").upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { error } = await client.rpc("academy_submit_payment", { p_invoice_ids: invoiceIds, p_slip_path: path });
      if (error) {
        await client.storage.from("academy-payment-slips").remove([path]);
        throw error;
      }
    },
    async saveProduct(input) {
      const { data, error } = await assertClient().from("academy_products").insert({ name: input.name, price_satang: input.priceSatang }).select().single();
      if (error) throw error;
      return { id: data.id, name: data.name, priceSatang: Number(data.price_satang), active: data.active };
    },
    async createVenue(input) {
      const { data, error } = await assertClient().from("academy_venues").insert({ name: input.name }).select().single();
      if (error) throw error;
      return { id: data.id, name: data.name, active: data.active, isDefault: data.is_default };
    },
    async createProfile(input) {
      const { data, error } = await assertClient().functions.invoke("academy-username-auth", {
        body: { action: "create_user", username: input.username, password: input.password, displayName: input.displayName, role: input.role },
      });
      if (error || !data?.userId) throw new Error(data?.error || "สร้างบัญชีไม่สำเร็จ");
      return { id: data.userId, ...input, lineConnected: false };
    },
  };
}
