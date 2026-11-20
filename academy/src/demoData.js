const today = new Date();
const isoDate = (offset = 0) => {
  const value = new Date(today);
  value.setDate(value.getDate() + offset);
  return value.toISOString().slice(0, 10);
};

export const demoProfiles = [
  { id: "admin-1", username: "admin", displayName: "แอดมิน", role: "admin" },
  { id: "teacher-1", username: "coach", displayName: "ครูบอย", role: "teacher" },
  { id: "student-1", username: "nam", displayName: "น้องน้ำ", role: "student", lineConnected: true },
  { id: "student-2", username: "punn", displayName: "น้องปัน", role: "student", lineConnected: false },
  { id: "student-3", username: "august", displayName: "น้องออกัส", role: "student", lineConnected: true },
  { id: "student-4", username: "ing", displayName: "น้องอิง", role: "student", lineConnected: true },
];

export const demoProducts = [
  { id: "water", name: "น้ำเปล่า", priceSatang: 1000, active: true },
  { id: "sport", name: "เครื่องดื่มเกลือแร่", priceSatang: 2000, active: true },
];

export const demoVenues = [
  { id: "venue-khao-noi", name: "สนามแบดมินตันเขาน้อย (สนามใหม่)", active: true, isDefault: true },
];

export const demoSessions = [
  {
    id: "session-1", date: isoDate(0), startTime: "17:00", endTime: "19:00", venue: "สนาม Headshot",
    serviceFeeSatang: 5000, courtCostSatang: 120000, status: "open", teacherIds: ["teacher-1"],
    registrations: [
      { studentId: "student-1", name: "น้องน้ำ", status: "registered", attendance: "present", source: "student" },
      { studentId: "student-2", name: "น้องปัน", status: "registered", attendance: null, source: "student" },
      { studentId: "student-3", name: "น้องออกัส", status: "registered", attendance: "present", source: "walk_in" },
    ],
    purchases: [{ id: "purchase-1", studentId: "student-1", productId: "water", name: "น้ำเปล่า", quantity: 2, unitPriceSatang: 1000 }],
    lessons: [
      { id: "lesson-1", title: "ฝึกเซฟหน้าเน็ต", description: "ยืนตำแหน่งหน้าเน็ต อ่านทิศทางลูก และเซฟลูกให้ข้ามเน็ตอย่างควบคุมได้", kpis: [
        { id: "kpi-1", name: "เซฟลูกข้ามเน็ต", maximum: 10, scores: { "student-1": 8, "student-3": 6 } },
        { id: "kpi-2", name: "กลับเข้าตำแหน่งพร้อมเล่น", maximum: 5, scores: { "student-1": 4, "student-3": 3 } },
      ] },
      { id: "lesson-2", title: "ฟุตเวิร์กหน้า–หลัง", description: "เคลื่อนที่หกลูกและกลับจุดศูนย์กลางโดยไม่เสียสมดุล", kpis: [] },
    ],
  },
  {
    id: "session-2", date: isoDate(2), startTime: "17:00", endTime: "19:00", venue: "สนาม Headshot",
    serviceFeeSatang: 5000, courtCostSatang: 120000, status: "open", teacherIds: ["teacher-1"], topic: "ลูกหลังมือ",
    registrations: [{ studentId: "student-4", name: "น้องอิง", status: "registered", attendance: null, source: "student" }],
    purchases: [], lessons: [],
  },
];

export const demoInvoices = [
  { id: "invoice-1", studentId: "student-1", sessionId: "past-1", date: isoDate(-7), totalSatang: 27000, status: "unpaid", details: "ค่าบริการ 50 + สนาม 200 + น้ำ 20" },
  { id: "invoice-2", studentId: "student-1", sessionId: "past-2", date: isoDate(-14), totalSatang: 25000, status: "slip_pending", details: "ค่าบริการ 50 + สนาม 200" },
];
