import { demoInvoices, demoProducts, demoProfiles, demoSessions } from "./demoData.js";

const clone = (value) => structuredClone(value);

export function createDemoRepository() {
  let sessions = clone(demoSessions);
  let profiles = clone(demoProfiles);
  let products = clone(demoProducts);
  let invoices = clone(demoInvoices);

  return {
    mode: "demo",
    async getCurrentUser(role = "admin") {
      return clone(profiles.find((profile) => profile.role === role) || profiles[0]);
    },
    async listProfiles() { return clone(profiles); },
    async listSessions() { return clone(sessions); },
    async listProducts() { return clone(products); },
    async listInvoices(studentId = null) {
      return clone(studentId ? invoices.filter((invoice) => invoice.studentId === studentId) : invoices);
    },
    async createSession(input) {
      const session = { ...input, id: crypto.randomUUID(), teacherIds: input.teacherId ? [input.teacherId] : [], status: "open", registrations: [], purchases: [], kpis: [] };
      sessions = [session, ...sessions];
      return clone(session);
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
    async saveLearning(sessionId, { topic, kpis }) {
      sessions = sessions.map((session) => session.id !== sessionId ? session : { ...session, topic, kpis });
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
  };
}
