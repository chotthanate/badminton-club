import React, { useEffect, useMemo, useState } from "react";
import {
  CalendarDays, Check, ClipboardCheck, CreditCard, GraduationCap, LayoutDashboard,
  LogOut, PackagePlus, Plus, Save, Star, UserRound, Users, Wallet, X,
} from "lucide-react";
import { createAcademyRepository } from "./academyRepository.js";
import { buildBillingPreview, formatBaht, validateScore } from "./billing.js";
import { createDemoRepository } from "./demoRepository.js";
import { academySupabase, isAcademySupabaseConfigured, linkCurrentLineAccount, signInWithUsername } from "./supabase.js";

const isDemo = import.meta.env.VITE_ACADEMY_DEMO_MODE !== "false" || !isAcademySupabaseConfigured;
const repository = isDemo ? createDemoRepository() : createAcademyRepository();
const NAV = {
  admin: [["dashboard", "ภาพรวม", LayoutDashboard], ["classes", "คลาส", CalendarDays], ["students", "นักเรียน", Users], ["finance", "การเงิน", Wallet]],
  teacher: [["dashboard", "วันนี้", LayoutDashboard], ["classes", "คลาส", ClipboardCheck], ["students", "นักเรียน", Users]],
  student: [["classes", "ลงชื่อ", CalendarDays], ["profile", "โปรไฟล์", UserRound], ["finance", "ชำระเงิน", CreditCard]],
};

function useAcademyData(user) {
  const [data, setData] = useState({ sessions: [], profiles: [], products: [], invoices: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = async () => {
    setLoading(true); setError("");
    try {
      const [sessions, profiles, products, invoices] = await Promise.all([
        repository.listSessions(), repository.listProfiles(), repository.listProducts(),
        repository.listInvoices(user?.role === "student" ? user.id : null),
      ]);
      setData({ sessions, profiles, products, invoices });
    } catch (caught) { setError(caught.message || "โหลดข้อมูลไม่สำเร็จ"); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (user) reload(); }, [user?.id]);
  return { ...data, loading, error, reload };
}

export default function App() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (isDemo) repository.getCurrentUser("admin").then(setUser);
    else repository.getCurrentUser().then(setUser).catch(() => setUser(null));
  }, []);

  if (!user) return <Login onLogin={setUser} />;
  const nav = NAV[user.role] || NAV.student;
  const activeTab = nav.some(([key]) => key === tab) ? tab : nav[0][0];
  const showNotice = (message) => { setNotice(message); window.setTimeout(() => setNotice(""), 3200); };
  const switchDemoRole = async (role) => { const next = await repository.getCurrentUser(role); setUser(next); setTab(NAV[role][0][0]); };

  return (
    <div className="academy-shell">
      <header className="topbar">
        <div><span className="eyebrow">HEADSHOT</span><h1>Badminton Academy</h1></div>
        <div className="top-actions">
          {isDemo && <select aria-label="เปลี่ยนบทบาททดลอง" value={user.role} onChange={(event) => switchDemoRole(event.target.value)}><option value="admin">แอดมิน</option><option value="teacher">ครู</option><option value="student">นักเรียน</option></select>}
          <span className="user-chip">{user.displayName}</span>
          {!isDemo && <button className="icon-button" aria-label="ออกจากระบบ" onClick={() => academySupabase.auth.signOut().then(() => setUser(null))}><LogOut /></button>}
        </div>
      </header>
      {isDemo && <div className="demo-banner">โหมดตัวอย่าง · ข้อมูลทั้งหมดอยู่เฉพาะในเบราว์เซอร์และไม่แตะระบบชมรม</div>}
      <main>
        <AcademyPage tab={activeTab} user={user} notify={showNotice} />
      </main>
      <nav className="bottom-nav" aria-label="เมนูหลัก">
        {nav.map(([key, label, Icon]) => <button key={key} className={activeTab === key ? "active" : ""} onClick={() => setTab(key)}><Icon/><span>{label}</span></button>)}
      </nav>
      {notice && <div className="toast"><Check/> {notice}</div>}
    </div>
  );
}

function Login({ onLogin }) {
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await signInWithUsername(username, password); onLogin(await repository.getCurrentUser()); }
    catch (caught) { setError(caught.message); } finally { setBusy(false); }
  };
  return <main className="login-page"><form className="login-card" onSubmit={submit}><GraduationCap/><p className="eyebrow">HEADSHOT</p><h1>Badminton Academy</h1><p>เข้าสู่ระบบสำหรับนักเรียน ครู และแอดมิน</p><label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required /></label><label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>{error && <p className="error-text">{error}</p>}<button className="primary" disabled={busy}>{busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}</button></form></main>;
}

function AcademyPage({ tab, user, notify }) {
  const data = useAcademyData(user);
  if (data.loading) return <section className="loading-card">กำลังโหลดข้อมูล Academy…</section>;
  if (data.error) return <section className="empty-state"><h2>โหลดข้อมูลไม่สำเร็จ</h2><p>{data.error}</p><button onClick={data.reload}>ลองอีกครั้ง</button></section>;
  const props = { ...data, user, notify };
  if (tab === "dashboard") return <Dashboard {...props}/>;
  if (tab === "classes") return <Classes {...props}/>;
  if (tab === "students") return <Students {...props}/>;
  if (tab === "finance") return <Finance {...props}/>;
  return <StudentProfile {...props}/>;
}

function Dashboard({ sessions, invoices, profiles }) {
  const today = new Date().toISOString().slice(0, 10);
  const todaySessions = sessions.filter((session) => session.date === today);
  const registrations = todaySessions.flatMap((session) => session.registrations);
  const present = registrations.filter((entry) => entry.attendance === "present").length;
  const outstanding = invoices.filter((invoice) => invoice.status === "unpaid").reduce((sum, invoice) => sum + invoice.totalSatang, 0);
  return <section className="page"><PageTitle title="ภาพรวม Academy" subtitle="งานสำคัญและสถานะของวันนี้"/><div className="metric-grid"><Metric label="คลาสวันนี้" value={todaySessions.length}/><Metric label="ลงชื่อ" value={registrations.filter((r) => r.status === "registered").length}/><Metric label="มาเรียนแล้ว" value={present}/><Metric label="ยอดค้าง" value={formatBaht(outstanding)}/></div><div className="two-columns"><Card title="คลาสวันนี้">{todaySessions.length ? todaySessions.map((session) => <SessionSummary key={session.id} session={session}/>) : <p className="muted">ยังไม่มีคลาสวันนี้</p>}</Card><Card title="สถานะระบบ"><StatusLine ok label={`นักเรียน ${profiles.filter((p) => p.role === "student").length} คน`}/><StatusLine ok label="ระบบคิดเงินแยกจากเว็บชมรม"/><StatusLine ok={isAcademySupabaseConfigured} label={isAcademySupabaseConfigured ? "เชื่อม Supabase Academy แล้ว" : "ยังเป็นโหมดตัวอย่าง"}/></Card></div></section>;
}

function Classes({ sessions, profiles, products, user, reload, notify }) {
  const [selectedId, setSelectedId] = useState(sessions[0]?.id || null);
  const [showCreate, setShowCreate] = useState(false);
  const selected = sessions.find((session) => session.id === selectedId) || sessions[0];
  const students = profiles.filter((profile) => profile.role === "student");
  const isStaff = user.role !== "student";
  const mutate = async (action, message) => { await action(); await reload(); notify(message); };
  const teacherCheckedIn = selected?.teachers?.some((teacher) => teacher.id === user.id && teacher.checkedAt);
  return <section className="page"><PageTitle title={user.role === "student" ? "ลงชื่อเรียน" : "จัดการคลาส"} subtitle="ลงชื่อ เช็กชื่อ บันทึกเนื้อหา และสรุปยอดในที่เดียว" action={user.role === "admin" && <button className="primary small" onClick={() => setShowCreate(true)}><Plus/> สร้างคลาส</button>}/><div className="session-tabs">{sessions.map((session) => <button key={session.id} className={selected?.id === session.id ? "active" : ""} onClick={() => setSelectedId(session.id)}><strong>{formatDate(session.date)}</strong><span>{session.startTime}–{session.endTime}</span></button>)}</div>{selected ? <div className="class-layout"><Card title={`${formatDate(selected.date)} · ${selected.venue}`} subtitle={`${selected.startTime}–${selected.endTime} · ค่าบริการ ${formatBaht(selected.serviceFeeSatang)}`}>{user.role === "teacher" && <button className="teacher-checkin" disabled={teacherCheckedIn} onClick={() => mutate(() => repository.checkInTeacher(selected.id, user.id), "เช็กชื่อครูแล้ว")}><Check/> {teacherCheckedIn ? "ครูเช็กชื่อแล้ว" : "เช็กชื่อครูผู้สอน"}</button>}<div className="section-heading"><h3>รายชื่อผู้เรียน</h3><span>{selected.registrations.filter((r) => r.status === "registered").length} คน</span></div>{selected.registrations.filter((r) => r.status === "registered").map((registration) => <div className="person-row" key={registration.studentId}><div><strong>{registration.name}</strong><small>{registration.source === "walk_in" ? "เพิ่มหน้างาน" : "ลงชื่อเอง"}</small></div>{isStaff ? <div className="segmented"><button className={registration.attendance === "present" ? "selected yes" : ""} onClick={() => mutate(() => repository.setAttendance(selected.id, registration.studentId, "present"), `เช็กชื่อ ${registration.name} แล้ว`)}>มา</button><button className={registration.attendance === "absent" ? "selected no" : ""} onClick={() => mutate(() => repository.setAttendance(selected.id, registration.studentId, "absent"), `บันทึกขาดเรียนแล้ว`)}>ขาด</button></div> : registration.studentId === user.id && <button className="text-danger" onClick={() => mutate(() => repository.cancelRegistration(selected.id, user.id), "ยกเลิกการลงชื่อแล้ว")}><X/> ยกเลิก</button>}</div>)}{user.role === "student" && !selected.registrations.some((r) => r.studentId === user.id && r.status === "registered") && <button className="primary full" onClick={() => mutate(() => repository.register(selected.id, user), "ลงชื่อเรียนแล้ว")}><Check/> ลงชื่อคลาสนี้</button>}{isStaff && <WalkInForm students={students} session={selected} onAdd={(student) => mutate(() => repository.addWalkIn(selected.id, student), `เพิ่ม ${student.displayName} และเช็กชื่อแล้ว`)}/>}</Card>{isStaff && <div className="stack"><ProductsCard session={selected} products={products} onSave={(purchase) => mutate(() => repository.addPurchase(selected.id, purchase), "เพิ่มรายการสินค้าแล้ว")}/><LearningCard session={selected} onSave={(value) => mutate(() => repository.saveLearning(selected.id, value), "บันทึกเนื้อหาและคะแนนแล้ว")}/>{user.role === "admin" && <BillingCard session={selected} onFinalize={(preview) => mutate(() => repository.finalizeSession(selected.id, preview), "สรุปยอดและล็อกรายการแล้ว")}/>}</div>}</div> : <div className="empty-state">ยังไม่มีคลาส</div>}{showCreate && <CreateSessionModal teachers={profiles.filter((profile) => profile.role === "teacher")} onClose={() => setShowCreate(false)} onCreated={async (input) => { await repository.createSession(input); setShowCreate(false); await reload(); notify("สร้างและเปิดลงชื่อคลาสแล้ว"); }}/>}</section>;
}

function WalkInForm({ students, session, onAdd }) {
  const available = students.filter((student) => !session.registrations.some((entry) => entry.studentId === student.id && entry.status === "registered"));
  const [studentId, setStudentId] = useState(available[0]?.id || "");
  if (!available.length) return null;
  return <div className="inline-form"><select value={studentId} onChange={(e) => setStudentId(e.target.value)}>{available.map((student) => <option key={student.id} value={student.id}>{student.displayName}</option>)}</select><button onClick={() => onAdd(available.find((student) => student.id === studentId))}><Plus/> เพิ่มหน้างาน</button></div>;
}

function ProductsCard({ session, products, onSave }) {
  const present = session.registrations.filter((entry) => entry.attendance === "present");
  const [studentId, setStudentId] = useState(present[0]?.studentId || ""); const [productId, setProductId] = useState(products[0]?.id || ""); const [quantity, setQuantity] = useState(1);
  const add = () => { const product = products.find((entry) => entry.id === productId); if (!studentId || !product) return; onSave({ studentId, productId, name: product.name, unitPriceSatang: product.priceSatang, quantity: Number(quantity) }); };
  return <Card title="น้ำและสินค้า" subtitle="ราคาจะถูกบันทึกตามวันที่ซื้อ"><div className="form-grid compact"><select value={studentId} onChange={(e) => setStudentId(e.target.value)}><option value="">เลือกผู้เรียน</option>{present.map((entry) => <option key={entry.studentId} value={entry.studentId}>{entry.name}</option>)}</select><select value={productId} onChange={(e) => setProductId(e.target.value)}>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {formatBaht(product.priceSatang)}</option>)}</select><input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)}/><button onClick={add}><PackagePlus/> เพิ่ม</button></div>{session.purchases.map((purchase) => <p className="purchase-line" key={purchase.id}>{purchase.name} × {purchase.quantity} · {formatBaht(purchase.unitPriceSatang * purchase.quantity)}</p>)}</Card>;
}

function LearningCard({ session, onSave }) {
  const [topic, setTopic] = useState(session.topic || "");
  const [kpis, setKpis] = useState(session.kpis.length ? session.kpis : [{ id: `kpi-${crypto.randomUUID()}`, name: "", maximum: 10, scores: {} }]);
  const present = session.registrations.filter((entry) => entry.attendance === "present");
  const save = () => {
    if (kpis.some((kpi) => !kpi.name.trim() || Number(kpi.maximum) <= 0 || Object.values(kpi.scores).some((score) => !validateScore(score, kpi.maximum)))) return;
    onSave({ topic, kpis });
  };
  return <Card title="เนื้อหาและ KPI"><label>เนื้อหาที่เรียน<input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="เช่น ลูกหน้ามือและการเคลื่อนที่"/></label>{kpis.map((kpi, index) => <div className="kpi-block" key={kpi.id}><div className="kpi-head"><input value={kpi.name} onChange={(e) => setKpis(kpis.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} placeholder="ชื่อ KPI"/><label>เต็ม <input type="number" min="1" value={kpi.maximum} onChange={(e) => setKpis(kpis.map((item, i) => i === index ? { ...item, maximum: Number(e.target.value) } : item))}/></label></div>{present.map((student) => <label className="score-row" key={student.studentId}><span>{student.name}</span><input type="number" min="0" max={kpi.maximum} value={kpi.scores[student.studentId] ?? ""} onChange={(e) => setKpis(kpis.map((item, i) => i === index ? { ...item, scores: { ...item.scores, [student.studentId]: e.target.value } } : item))}/><small>/ {kpi.maximum}</small></label>)}</div>)}<div className="card-actions"><button onClick={() => setKpis([...kpis, { id: `kpi-${crypto.randomUUID()}`, name: "", maximum: 10, scores: {} }])}><Plus/> เพิ่ม KPI</button><button className="primary" onClick={save}><Save/> บันทึกการเรียน</button></div></Card>;
}

function BillingCard({ session, onFinalize }) {
  const preview = useMemo(() => buildBillingPreview({ serviceFeeSatang: session.serviceFeeSatang, courtCostSatang: session.courtCostSatang, attendees: session.registrations, purchases: session.purchases }), [session]);
  return <Card title="สรุปค่าใช้จ่าย" subtitle="คิดเฉพาะผู้ที่เช็กชื่อมา"><div className="billing-summary"><span>ผู้มาเรียน <strong>{preview.attendeeCount} คน</strong></span><span>ค่าสนามต่อคน <strong>{formatBaht(preview.court.perPersonSatang)}</strong></span><span>ส่วนเกินจากปัดขึ้น <strong>{formatBaht(preview.court.surplusSatang)}</strong></span></div>{preview.rows.map((row) => <div className="invoice-preview" key={row.studentId}><strong>{row.name}</strong><span>{formatBaht(row.totalSatang)}</span><small>บริการ {formatBaht(row.serviceFeeSatang)} + สนาม {formatBaht(row.courtShareSatang)} + ส่วนตัว {formatBaht(row.productsSatang)}</small></div>)}<button className="primary full" disabled={!preview.attendeeCount || session.status === "finalized"} onClick={() => onFinalize(preview)}>{session.status === "finalized" ? "สรุปยอดแล้ว" : "ยืนยันและล็อกยอด"}</button></Card>;
}

function Students({ profiles, sessions, user, reload, notify }) {
  const [showCreate, setShowCreate] = useState(false);
  const students = profiles.filter((profile) => profile.role === "student");
  return <section className="page"><PageTitle title="รายชื่อนักเรียน" subtitle="การมาเรียน LINE และพัฒนาการของแต่ละคน" action={user.role === "admin" && <button className="primary small" onClick={() => setShowCreate(true)}><Plus/> เพิ่มบัญชี</button>}/><div className="student-grid">{students.map((student) => { const registrations = sessions.flatMap((session) => session.registrations.filter((entry) => entry.studentId === student.id)); const present = registrations.filter((entry) => entry.attendance === "present").length; const absent = registrations.filter((entry) => entry.status === "registered" && entry.attendance === "absent").length; return <Card key={student.id} title={student.displayName} subtitle={`@${student.username}`}><div className="student-stats"><span><strong>{present}</strong> มาเรียน</span><span><strong>{absent}</strong> ขาด</span><span className={student.lineConnected ? "line-ok" : "muted"}>{student.lineConnected ? "เชื่อม LINE แล้ว" : "ยังไม่เชื่อม LINE"}</span></div></Card>; })}</div>{showCreate && <CreateAccountModal onClose={() => setShowCreate(false)} onCreate={async (value) => { await repository.createProfile(value); setShowCreate(false); await reload(); notify("สร้างบัญชีแล้ว"); }}/>}</section>;
}

function Finance({ invoices, products, user, reload, notify }) {
  const [selected, setSelected] = useState([]); const [file, setFile] = useState(null);
  const visible = user.role === "student" ? invoices.filter((item) => item.studentId === user.id) : invoices;
  const unpaid = visible.filter((item) => item.status === "unpaid");
  const total = unpaid.reduce((sum, item) => sum + item.totalSatang, 0);
  const submit = async () => { if (!selected.length || (!isDemo && !file)) return; await repository.submitPayment(selected, file); await reload(); setSelected([]); setFile(null); notify("ส่งสลิปแล้ว รอแอดมินตรวจสอบ"); };
  return <section className="page"><PageTitle title={user.role === "student" ? "ยอดค้างและชำระเงิน" : "ภาพรวมการเงิน"} subtitle="เลือกหลายวันที่ค้างและชำระด้วยสลิปเดียว"/><div className="metric-grid"><Metric label="ยอดค้าง" value={formatBaht(total)}/><Metric label="รายการค้าง" value={unpaid.length}/><Metric label="รอตรวจสลิป" value={visible.filter((item) => item.status === "slip_pending").length}/></div><Card title="รายการเรียกเก็บ">{visible.map((invoice) => <label className="invoice-row" key={invoice.id}><input type="checkbox" disabled={invoice.status !== "unpaid" || user.role !== "student"} checked={selected.includes(invoice.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, invoice.id] : selected.filter((id) => id !== invoice.id))}/><div><strong>{formatDate(invoice.date)}</strong><small>{invoice.details}</small></div><span>{formatBaht(invoice.totalSatang)}<small>{statusLabel(invoice.status)}</small></span></label>)}{!visible.length && <p className="muted">ไม่มีรายการเรียกเก็บ</p>}{user.role === "student" && <div className="payment-box"><strong>ยอดที่เลือก {formatBaht(visible.filter((item) => selected.includes(item.id)).reduce((sum, item) => sum + item.totalSatang, 0))}</strong><input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)}/><button className="primary" disabled={!selected.length || (!isDemo && !file)} onClick={submit}>แนบสลิปและส่งตรวจ</button></div>}</Card>{user.role === "admin" && <ProductManager products={products} onCreate={async (value) => { await repository.saveProduct(value); await reload(); notify("เพิ่มสินค้าแล้ว"); }}/>}</section>;
}

function StudentProfile({ sessions, invoices, user }) {
  const [lineError, setLineError] = useState("");
  const registrations = sessions.flatMap((session) => session.registrations.filter((entry) => entry.studentId === user.id).map((entry) => ({ ...entry, session })));
  const scores = sessions.flatMap((session) => session.kpis.flatMap((kpi) => Object.hasOwn(kpi.scores, user.id) ? [{ name: kpi.name, score: kpi.scores[user.id], maximum: kpi.maximum, date: session.date }] : []));
  const connectLine = async () => { setLineError(""); try { const result = await linkCurrentLineAccount(); if (!result?.redirecting) window.location.reload(); } catch (error) { setLineError(error.message); } };
  return <section className="page"><PageTitle title={`โปรไฟล์ ${user.displayName}`} subtitle="สรุปการมาเรียน คะแนน และยอดค้างของฉัน"/><div className="metric-grid"><Metric label="มาเรียน" value={registrations.filter((r) => r.attendance === "present").length}/><Metric label="ขาด" value={registrations.filter((r) => r.attendance === "absent").length}/><Metric label="ยอดค้าง" value={formatBaht(invoices.filter((i) => i.status === "unpaid").reduce((sum, i) => sum + i.totalSatang, 0))}/><Metric label="LINE" value={user.lineConnected ? "เชื่อมแล้ว" : "ยังไม่เชื่อม"}/></div>{!user.lineConnected && !isDemo && <><button className="line-connect" onClick={connectLine}>เชื่อม LINE เพื่อใช้บอตลงชื่อ</button>{lineError && <p className="error-text">{lineError}</p>}</>}<div className="two-columns"><Card title="คะแนนล่าสุด">{scores.map((item) => <div className="score-card" key={`${item.date}-${item.name}`}><Star/><div><strong>{item.name}</strong><small>{formatDate(item.date)}</small></div><span>{item.score}/{item.maximum}</span></div>)}{!scores.length && <p className="muted">ยังไม่มีคะแนน</p>}</Card><Card title="ประวัติการเรียน">{registrations.map((entry) => <SessionSummary key={entry.session.id} session={entry.session}/>)}</Card></div></section>;
}

function CreateAccountModal({ onClose, onCreate }) {
  const [value, setValue] = useState({ displayName: "", username: "", password: "", role: "student" });
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><form className="modal compact-modal" onSubmit={(e) => { e.preventDefault(); onCreate(value); }}><div className="modal-head"><div><span className="eyebrow">บัญชีใหม่</span><h2>เพิ่มนักเรียนหรือครู</h2></div><button type="button" className="icon-button" onClick={onClose}><X/></button></div><div className="form-grid"><label>ชื่อแสดง<input value={value.displayName} onChange={(e) => setValue({ ...value, displayName: e.target.value })} required/></label><label>ประเภท<select value={value.role} onChange={(e) => setValue({ ...value, role: e.target.value })}><option value="student">นักเรียน</option><option value="teacher">ครู</option><option value="admin">แอดมิน</option></select></label><label>Username<input pattern="[a-zA-Z0-9._-]{3,40}" value={value.username} onChange={(e) => setValue({ ...value, username: e.target.value.toLowerCase() })} required/></label><label>รหัสผ่านเริ่มต้น<input type="password" minLength="8" value={value.password} onChange={(e) => setValue({ ...value, password: e.target.value })} required/></label></div><p className="hint">แจ้งรหัสผ่านเริ่มต้นให้เจ้าของบัญชีโดยตรง และให้เปลี่ยนเมื่อเข้าใช้ครั้งแรก</p><button className="primary full">สร้างบัญชี</button></form></div>;
}

function ProductManager({ products, onCreate }) {
  const [name, setName] = useState(""); const [price, setPrice] = useState(10);
  return <Card title="สินค้าและน้ำ" subtitle="ราคาที่แก้ใหม่จะไม่เปลี่ยนรายการซื้อเก่า"><div className="product-list">{products.map((product) => <span key={product.id}>{product.name}<strong>{formatBaht(product.priceSatang)}</strong></span>)}</div><form className="inline-form" onSubmit={(e) => { e.preventDefault(); onCreate({ name, priceSatang: Math.round(Number(price) * 100) }); setName(""); }}><input placeholder="ชื่อสินค้า" value={name} onChange={(e) => setName(e.target.value)} required/><div className="price-add"><input type="number" min="0" step="1" value={price} onChange={(e) => setPrice(e.target.value)} required/><button><Plus/> เพิ่ม</button></div></form></Card>;
}

function CreateSessionModal({ teachers, onClose, onCreated }) {
  const [value, setValue] = useState({ date: new Date().toISOString().slice(0, 10), startTime: "17:00", endTime: "19:00", venue: "สนาม Headshot", serviceFeeSatang: 5000, courtCostSatang: 0, teacherId: teachers[0]?.id || "" });
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><form className="modal" onSubmit={(e) => { e.preventDefault(); onCreated(value); }}><div className="modal-head"><div><span className="eyebrow">คลาสใหม่</span><h2>เปิดลงชื่อเรียน</h2></div><button type="button" className="icon-button" onClick={onClose}><X/></button></div><div className="form-grid"><label>วันที่<input type="date" value={value.date} onChange={(e) => setValue({ ...value, date: e.target.value })} required/></label><label>ครูผู้สอน<select value={value.teacherId} onChange={(e) => setValue({ ...value, teacherId: e.target.value })} required><option value="">เลือกครู</option>{teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>)}</select></label><label>เวลาเริ่ม<input type="time" value={value.startTime} onChange={(e) => setValue({ ...value, startTime: e.target.value })} required/></label><label>เวลาจบ<input type="time" value={value.endTime} onChange={(e) => setValue({ ...value, endTime: e.target.value })} required/></label><label>สนาม<input value={value.venue} onChange={(e) => setValue({ ...value, venue: e.target.value })} required/></label><label>ค่าบริการต่อคน (บาท)<input type="number" min="0" value={value.serviceFeeSatang / 100} onChange={(e) => setValue({ ...value, serviceFeeSatang: Math.round(Number(e.target.value) * 100) })}/></label><label>ค่าสนามรวม (บาท)<input type="number" min="0" value={value.courtCostSatang / 100} onChange={(e) => setValue({ ...value, courtCostSatang: Math.round(Number(e.target.value) * 100) })}/></label></div><button className="primary full"><CalendarDays/> สร้างและเปิดลงชื่อ</button></form></div>;
}

function PageTitle({ title, subtitle, action }) { return <div className="page-title"><div><h2>{title}</h2><p>{subtitle}</p></div>{action}</div>; }
function Card({ title, subtitle, children }) { return <article className="card"><header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></header>{children}</article>; }
function Metric({ label, value }) { return <article className="metric"><span>{label}</span><strong>{value}</strong></article>; }
function StatusLine({ ok, label }) { return <p className="status-line"><span className={ok ? "ok" : "warn"}>{ok ? <Check/> : <X/>}</span>{label}</p>; }
function SessionSummary({ session }) { return <div className="session-summary"><CalendarDays/><div><strong>{formatDate(session.date)} · {session.startTime}</strong><small>{session.venue} · {session.topic || "ยังไม่บันทึกเนื้อหา"}</small></div><span>{session.status === "finalized" ? "สรุปแล้ว" : "เปิดลงชื่อ"}</span></div>; }
function formatDate(value) { if (!value) return "ไม่ระบุวัน"; return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "2-digit" }).format(new Date(`${value}T12:00:00`)); }
function statusLabel(status) { return ({ unpaid: "ยังไม่ส่ง", slip_pending: "ส่งแล้วรอตรวจ", manual_review: "ตรวจด้วยมือ", paid: "ชำระแล้ว", void: "ยกเลิก" })[status] || status; }
