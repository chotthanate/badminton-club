import { demoInvoices, demoProducts, demoProfiles, demoSessions, demoVenues } from "./demoData.js";

const clone = (value) => structuredClone(value);

export function createDemoRepository() {
  let sessions = clone(demoSessions);
  let profiles = clone(demoProfiles);
  let products = clone(demoProducts);
  let invoices = clone(demoInvoices);
  let venues = clone(demoVenues);

  return {
    mode: "demo",
    async getCurrentUser(role = "admin") {
      return clone(profiles.find((profile) => profile.role === role) || profiles[0]);
    },
    async listProfiles() { return clone(profiles); },
    async listSessions() { return clone(sessions); },
    async listProducts() { return clone(products); },
    async listVenues() { return clone(venues); },
    async listInvoices(studentId = null) {
      return clone(studentId ? invoices.filter((invoice) => invoice.studentId === studentId) : invoices);
    },
    async listPaymentOptions() {
      return clone(invoices.map((invoice) => ({
        ...invoice,
        studentName: profiles.find((profile) => profile.id === invoice.studentId)?.displayName || "นักเรียน",
      })));
    },
    async createSession(input) {
      const session = { ...input, id: crypto.randomUUID(), teacherIds: input.teacherId ? [input.teacherId] : [], status: "open", registrations: [], purchases: [], lessons: [] };
      sessions = [session, ...sessions];
      return clone(session);
    },
    async updateSessionCosts(sessionId, input) {
      const currentDate = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
      const session = sessions.find((entry) => entry.id === sessionId);
      if (!session || session.date !== currentDate || ["finalized", "cancelled"].includes(session.status)) throw new Error("แก้ค่าใช้จ่ายได้เฉพาะคลาสปัจจุบันก่อนสรุปยอด");
      sessions = sessions.map((entry) => entry.id === sessionId ? { ...entry, serviceFeeSatang: input.serviceFeeSatang, courtCostSatang: input.courtCostSatang } : entry);
    },
    async register(sessionId, student) {
      sessions = sessions.map((session) => session.id !== sessionId ? session : {
        ...session,
        registrations: session.registrations.some((entry) => entry.studentId === student.id)
          ? session.registrations.map((entry) => entry.studentId === student.id ? { ...entry, status: "registered" } : entry)
          : [...session.registrations, { studentId: student.id, name: student.displayName, status: "registered", attendance: null, source: "student" }],
      });
    },
    async cancelRegistration(sessionId, studentId) {
      sessions = sessions.map((session) => session.id !== sessionId ? session : {
        ...session,
        registrations: session.registrations.map((entry) => entry.studentId === studentId ? { ...entry, status: "cancelled" } : entry),
      });
    },
    async addWalkIn(sessionId, student) {
      await this.register(sessionId, student);
      sessions = sessions.map((session) => session.id !== sessionId ? session : {
        ...session,
        registrations: session.registrations.map((entry) => entry.studentId === student.id ? { ...entry, source: "walk_in", attendance: "present" } : entry),
      });
    },
    async setAttendance(sessionId, studentId, attendance) {
      sessions = sessions.map((session) => session.id !== sessionId ? session : {
        ...session,
        registrations: session.registrations.map((entry) => entry.studentId === studentId ? { ...entry, attendance } : entry),
      });
    },
    async checkInTeacher(sessionId, teacherId) {
      sessions = sessions.map((session) => session.id !== sessionId ? session : {
        ...session,
        teacherIds: [...new Set([...(session.teacherIds || []), teacherId])],
        teachers: [...(session.teachers || []).filter((teacher) => teacher.id !== teacherId), { id: teacherId, checkedAt: new Date().toISOString() }],
      });
    },
    async addPurchase(sessionId, purchase) {
      sessions = sessions.map((session) => session.id !== sessionId ? session : { ...session, purchases: [...session.purchases, { ...purchase, id: crypto.randomUUID() }] });
    },
    async addLesson(sessionId, lesson) {
      const created = { ...lesson, id: crypto.randomUUID(), kpis: lesson.kpis.map((kpi) => ({ ...kpi, id: crypto.randomUUID(), scores: {} })) };
      sessions = sessions.map((session) => session.id !== sessionId ? session : { ...session, lessons: [...(session.lessons || []), created] });
      return clone(created);
    },
    async saveLessonScores(sessionId, lessonId, kpis) {
      sessions = sessions.map((session) => session.id !== sessionId ? session : {
        ...session,
        lessons: session.lessons.map((lesson) => lesson.id === lessonId ? { ...lesson, kpis: clone(kpis) } : lesson),
      });
    },
    async finalizeSession(sessionId, preview) {
      const session = sessions.find((entry) => entry.id === sessionId);
      if (session.status === "finalized") return;
      invoices = [...invoices, ...preview.rows.map((row) => ({
        id: crypto.randomUUID(), studentId: row.studentId, sessionId, date: session.date,
        totalSatang: row.totalSatang, status: "unpaid", details: "ค่าบริการ + ค่าสนาม + รายการส่วนตัว",
      }))];
      sessions = sessions.map((entry) => entry.id === sessionId ? { ...entry, status: "finalized" } : entry);
    },
    async submitPayment(invoiceIds) {
      invoices = invoices.map((invoice) => invoiceIds.includes(invoice.id) ? { ...invoice, status: "slip_pending" } : invoice);
    },
    async markInvoicePaid(invoiceId) {
      const invoice = invoices.find((entry) => entry.id === invoiceId);
      if (!invoice || invoice.status !== "unpaid") throw new Error("รายการนี้รับเงินไม่ได้");
      invoices = invoices.map((entry) => entry.id === invoiceId ? { ...entry, status: "paid", paidAt: new Date().toISOString() } : entry);
    },
    async createProfile(input) {
      const { password: _password, ...safeInput } = input;
      const profile = { ...safeInput, id: crypto.randomUUID(), lineConnected: false };
      profiles = [...profiles, profile];
      return clone(profile);
    },
    async saveProduct(input) {
      const product = { ...input, id: crypto.randomUUID(), active: true };
      products = [...products, product];
      return clone(product);
    },
    async createVenue(input) {
      const venue = { id: crypto.randomUUID(), name: input.name, active: true, isDefault: false };
      venues = [...venues, venue];
      return clone(venue);
    },
  };
}
