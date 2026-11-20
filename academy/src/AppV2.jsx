import React, { useEffect, useMemo, useState } from "react";
import {
  BookOpen, CalendarDays, Check, ChevronDown, ChevronUp, CreditCard,
  GraduationCap, LayoutDashboard, LogOut, PackagePlus, Plus, Save, Star, UserRound,
  Users, Wallet, X,
} from "lucide-react";
import { createAcademyRepository } from "./academyRepository.js";
import { buildBillingPreview, formatBaht, validateScore } from "./billing.js";
import { createDemoRepository } from "./demoRepository.js";
import { academySupabase, isAcademySupabaseConfigured, linkCurrentLineAccount, signInWithUsername } from "./supabase.js";

const DEFAULT_VENUE = "สนามแบดมินตันเขาน้อย (สนามใหม่)";
const isDemo = import.meta.env.VITE_ACADEMY_DEMO_MODE !== "false" || !isAcademySupabaseConfigured;
const repository = isDemo ? createDemoRepository() : createAcademyRepository();
const NAV = {
  admin: [["dashboard", "ภาพรวม", LayoutDashboard], ["players", "ผู้เล่นวันนี้", Users], ["classes", "คลาส", BookOpen], ["students", "นักเรียน", GraduationCap], ["payments", "ชำระเงิน", CreditCard], ["finance", "การเงิน", Wallet]],
  teacher: [["players", "ผู้เล่นวันนี้", Users], ["classes", "คลาส", BookOpen], ["students", "นักเรียน", GraduationCap]],
  student: [["classes", "คลาส", CalendarDays], ["payments", "ชำระเงิน", CreditCard], ["profile", "โปรไฟล์", UserRound]],
};

function useAcademyData(user) {
  const [data, setData] = useState({ sessions: [], profiles: [], products: [], invoices: [], paymentOptions: [], venues: [] });
  const [state, setState] = useState({ loading: true, error: "" });
  const reload = async () => {
    setState({ loading: true, error: "" });
    try {
      const [sessions, profiles, products, invoices, paymentOptions, venues] = await Promise.all([
        repository.listSessions(), repository.listProfiles(), repository.listProducts(),
        repository.listInvoices(user?.role === "student" ? user.id : null), user?.role === "teacher" ? Promise.resolve([]) : repository.listPaymentOptions(), repository.listVenues(),
      ]);
      setData({ sessions, profiles, products, invoices, paymentOptions, venues });
      setState({ loading: false, error: "" });
    } catch (error) { setState({ loading: false, error: error.message || "โหลดข้อมูลไม่สำเร็จ" }); }
  };
  useEffect(() => { if (user) void reload(); }, [user?.id]);
  return { ...data, ...state, reload };
}

export default function AppV2() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [notice, setNotice] = useState("");
  useEffect(() => { (isDemo ? repository.getCurrentUser("admin") : repository.getCurrentUser()).then(setUser).catch(() => setUser(null)); }, []);
  if (!user) return <Login onLogin={setUser}/>;
  const nav = NAV[user.role] || NAV.student;
  const activeTab = nav.some(([key]) => key === tab) ? tab : nav[0][0];
  const notify = (message) => { setNotice(message); window.setTimeout(() => setNotice(""), 3200); };
  const switchRole = async (role) => { const next = await repository.getCurrentUser(role); setUser(next); setTab(NAV[role][0][0]); };
  return <div className="academy-shell">
    <header className="topbar"><div><span className="eyebrow">HEADSHOT</span><h1>Badminton Academy</h1></div><div className="top-actions">{isDemo && <select value={user.role} onChange={(e) => switchRole(e.target.value)} aria-label="บทบาททดลอง"><option value="admin">แอดมิน</option><option value="teacher">ครู</option><option value="student">นักเรียน</option></select>}<span className="user-chip">{user.displayName}</span>{!isDemo && <button className="icon-button" aria-label="ออกจากระบบ" onClick={() => academySupabase.auth.signOut().then(() => setUser(null))}><LogOut/></button>}</div></header>
    {isDemo && <div className="demo-banner">โหมดตัวอย่าง · ไม่แตะข้อมูลชมรมและข้อมูลจริง</div>}
    <main><AcademyPage tab={activeTab} user={user} notify={notify}/></main>
    <nav className="bottom-nav detailed-nav">{nav.map(([key, label, Icon]) => <button key={key} className={activeTab === key ? "active" : ""} onClick={() => setTab(key)}><Icon/><span>{label}</span></button>)}</nav>
    {notice && <div className="toast"><Check/> {notice}</div>}
  </div>;
}

function AcademyPage({ tab, user, notify }) {
  const data = useAcademyData(user);
  if (data.loading) return <section className="loading-card">กำลังโหลดข้อมูล Academy…</section>;
  if (data.error) return <section className="empty-state"><h2>โหลดข้อมูลไม่สำเร็จ</h2><p>{data.error}</p><button onClick={data.reload}>ลองอีกครั้ง</button></section>;
  const props = { ...data, user, notify };
  if (tab === "dashboard") return <Dashboard {...props}/>;
  if (tab === "players") return <TodayPlayers {...props}/>;
  if (tab === "classes") return <Classes {...props}/>;
  if (tab === "payments") return <Payments {...props}/>;
  if (tab === "finance") return <Finance {...props}/>;
  if (tab === "students") return <Students {...props}/>;
  return <StudentProfile {...props}/>;
}

function Login({ onLogin }) {
  const [value, setValue] = useState({ username: "", password: "" }); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event) => { event.preventDefault(); setBusy(true); setError(""); try { await signInWithUsername(value.username, value.password); onLogin(await repository.getCurrentUser()); } catch (caught) { setError(caught.message); } finally { setBusy(false); } };
  return <main className="login-page"><form className="login-card" onSubmit={submit}><GraduationCap/><p className="eyebrow">HEADSHOT</p><h1>Badminton Academy</h1><p>สำหรับนักเรียน ครู และแอดมิน</p><label>Username<input value={value.username} onChange={(e) => setValue({ ...value, username: e.target.value })} required/></label><label>Password<input type="password" value={value.password} onChange={(e) => setValue({ ...value, password: e.target.value })} required/></label>{error && <p className="error-text">{error}</p>}<button className="primary" disabled={busy}>{busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}</button></form></main>;
}

function Dashboard({ sessions, paymentOptions }) {
  const today = todayIso(); const current = sessions.filter((session) => session.date === today);
  const registrations = current.flatMap((session) => session.registrations.filter((entry) => entry.status === "registered"));
  const outstanding = paymentOptions.filter((item) => item.status === "unpaid").reduce((sum, item) => sum + item.totalSatang, 0);
  return <section className="page"><PageTitle title="ภาพรวม Academy" subtitle="แยกงานวันนี้ คลาสเรียน และการเงินออกจากกันแล้ว"/><div className="metric-grid"><Metric label="คลาสวันนี้" value={current.length}/><Metric label="ลงชื่อวันนี้" value={registrations.length}/><Metric label="มาแล้ว" value={registrations.filter((item) => item.attendance === "present").length}/><Metric label="ยอดค้าง" value={formatBaht(outstanding)}/></div><Card title="คลาสวันนี้">{current.length ? current.map((session) => <SessionSummary key={session.id} session={session}/>) : <p className="muted">ไม่มีคลาสวันนี้</p>}</Card></section>;
}

function TodayPlayers({ sessions, profiles, products, reload, notify }) {
  const [selectedId, setSelectedId] = useState(sessions.find((session) => session.date === todayIso())?.id || sessions[0]?.id || "");
  const session = sessions.find((item) => item.id === selectedId) || sessions[0];
  const students = profiles.filter((profile) => profile.role === "student");
  const mutate = async (action, message) => { try { await action(); await reload(); notify(message); } catch (error) { window.alert(error.message); } };
  if (!session) return <section className="page"><PageTitle title="ผู้เล่นวันนี้" subtitle="เช็กชื่อ เพิ่มหน้างาน และบันทึกน้ำขนม"/><div className="empty-state">ยังไม่มีคลาส</div></section>;
  const active = session.registrations.filter((entry) => entry.status === "registered");
  return <section className="page"><PageTitle title="ผู้เล่นวันนี้" subtitle="หน้านี้ใช้เช็กชื่อ เพิ่มคน และบวกน้ำขนมเท่านั้น"/><SessionSelector sessions={sessions} value={session.id} onChange={setSelectedId}/><SessionHero session={session}/><div className="today-layout"><Card title={`รายชื่อ ${active.length} คน`} subtitle="ไม่ต้องกรอกเวลามา–กลับ เพราะหารเท่ากัน"><div className="attendance-list">{active.map((entry) => <div className="attendance-row" key={entry.studentId}><div><strong>{entry.name}</strong><small>{entry.source === "walk_in" ? "เพิ่มหน้างาน" : "ลงชื่อไว้"}</small></div><div className="segmented"><button className={entry.attendance === "present" ? "selected yes" : ""} onClick={() => mutate(() => repository.setAttendance(session.id, entry.studentId, "present"), `เช็กชื่อ ${entry.name} แล้ว`)}>มา</button><button className={entry.attendance === "absent" ? "selected no" : ""} onClick={() => mutate(() => repository.setAttendance(session.id, entry.studentId, "absent"), "บันทึกขาดแล้ว")}>ขาด</button></div></div>)}</div><WalkIn students={students} session={session} onAdd={(student) => mutate(() => repository.addWalkIn(session.id, student), `เพิ่ม ${student.displayName} แล้ว`)}/></Card><Purchases session={session} products={products} onAdd={(purchase) => mutate(() => repository.addPurchase(session.id, purchase), "เพิ่มน้ำ/ขนมแล้ว")}/></div></section>;
}

function Classes({ sessions, profiles, venues, user, reload, notify }) {
  const [selectedId, setSelectedId] = useState(sessions[0]?.id || ""); const [showCreate, setShowCreate] = useState(false); const [showLesson, setShowLesson] = useState(false);
  const session = sessions.find((item) => item.id === selectedId) || sessions[0]; const isStaff = user.role !== "student";
  const mutate = async (action, message) => { try { await action(); await reload(); notify(message); } catch (error) { window.alert(error.message); } };
  return <section className="page"><PageTitle title="คลาสและเนื้อหาที่เรียน" subtitle="หนึ่งหัวข้อเรียนเป็นหนึ่งการ์ด กดเพื่อดูรายละเอียดและให้คะแนน" action={user.role === "admin" && <button className="primary small" onClick={() => setShowCreate(true)}><Plus/> สร้างคลาส</button>}/>{session ? <><SessionSelector sessions={sessions} value={session.id} onChange={setSelectedId}/><SessionHero session={session}/>{user.role === "student" && <StudentSignup session={session} user={user} onDone={() => reload()}/>}<div className="lesson-toolbar"><div><strong>เนื้อหาในคลาสนี้</strong><span>{session.lessons?.length || 0} หัวข้อ</span></div>{isStaff && <button className="primary small" onClick={() => setShowLesson(true)}><Plus/> เพิ่มหัวข้อเรียน</button>}</div><div className="lesson-grid">{(session.lessons || []).map((lesson) => <LessonCard key={lesson.id} lesson={lesson} students={session.registrations.filter((entry) => entry.attendance === "present")} editable={isStaff} onSave={(kpis) => mutate(() => repository.saveLessonScores(session.id, lesson.id, kpis), "บันทึกคะแนนแล้ว")}/>)}{!session.lessons?.length && <div className="empty-state lesson-empty">ยังไม่มีหัวข้อเรียนในคลาสนี้</div>}</div></> : <div className="empty-state">ยังไม่มีคลาส</div>}{showCreate && <CreateSessionModal venues={venues} teachers={profiles.filter((profile) => profile.role === "teacher")} onClose={() => setShowCreate(false)} onCreateVenue={async (name) => { const created = await repository.createVenue({ name }); await reload(); return created; }} onCreated={async (value) => { const created = await repository.createSession(value); setShowCreate(false); await reload(); setSelectedId(created.id); notify("สร้างคลาสแล้ว"); }}/>} {showLesson && session && <LessonModal onClose={() => setShowLesson(false)} onSave={(value) => mutate(async () => { await repository.addLesson(session.id, value); setShowLesson(false); }, "เพิ่มหัวข้อเรียนแล้ว")}/>}</section>;
}

function LessonCard({ lesson, students, editable, onSave }) {
  const [open, setOpen] = useState(false); const [kpis, setKpis] = useState(() => structuredClone(lesson.kpis || []));
  useEffect(() => setKpis(structuredClone(lesson.kpis || [])), [lesson]);
  const valid = kpis.every((kpi) => Object.values(kpi.scores || {}).every((score) => score === "" || validateScore(score, kpi.maximum)));
  return <article className={`lesson-card ${open ? "open" : ""}`}><button className="lesson-card-head" onClick={() => setOpen(!open)}><div><span className="lesson-number">หัวข้อเรียน</span><h2>{lesson.title}</h2><p>{lesson.description || "ยังไม่มีรายละเอียด"}</p></div>{open ? <ChevronUp/> : <ChevronDown/>}</button>{open && <div className="lesson-body">{!students.length && <p className="muted">ยังไม่มีผู้เรียนที่เช็กชื่อมา</p>}{kpis.map((kpi, index) => <div className="lesson-kpi" key={kpi.id}><div className="lesson-kpi-title"><strong>{kpi.name}</strong><span>คะแนนเต็ม {kpi.maximum}</span></div>{students.map((student) => <label className="lesson-score" key={student.studentId}><span>{student.name}</span><input disabled={!editable} type="number" min="0" max={kpi.maximum} value={kpi.scores?.[student.studentId] ?? ""} onChange={(e) => setKpis(kpis.map((item, i) => i === index ? { ...item, scores: { ...item.scores, [student.studentId]: e.target.value } } : item))}/><small>/ {kpi.maximum}</small></label>)}</div>)}{!kpis.length && <p className="muted">หัวข้อนี้ยังไม่มี KPI</p>}{editable && kpis.length > 0 && <button className="primary save-scores" disabled={!valid} onClick={() => onSave(kpis)}><Save/> บันทึกคะแนน</button>}</div>}</article>;
}

function Payments({ paymentOptions, profiles, user, reload, notify }) {
  const [studentIds, setStudentIds] = useState(user.role === "student" ? [user.id] : []); const [picker, setPicker] = useState(""); const [selected, setSelected] = useState([]); const [file, setFile] = useState(null);
  const paymentStudents = [...new Map(paymentOptions.map((item) => [item.studentId, { id: item.studentId, displayName: item.studentName }])).values()];
  const candidates = paymentStudents.filter((profile) => !studentIds.includes(profile.id));
  const visible = paymentOptions.filter((item) => studentIds.includes(item.studentId));
  const total = visible.filter((item) => selected.includes(item.id)).reduce((sum, item) => sum + item.totalSatang, 0);
  const submit = async () => { if (!selected.length || (!isDemo && !file)) return; try { await repository.submitPayment(selected, file); await reload(); setSelected([]); setFile(null); notify("ส่งสลิปแล้ว รอตรวจสอบ"); } catch (error) { window.alert(error.message); } };
  return <section className="page payment-page"><PageTitle title="ชำระเงิน" subtitle="เลือกผู้เรียนและหลายวันที่ค้าง แล้วแนบสลิปครั้งเดียวเหมือนเว็บแบด"/><Card title="เลือกผู้เรียนที่จะชำระ"><div className="beneficiary-picker"><select value={picker} onChange={(e) => setPicker(e.target.value)}><option value="">ค้นหา/เลือกผู้เรียน</option>{candidates.map((student) => <option key={student.id} value={student.id}>{student.displayName}</option>)}</select><button disabled={!picker} onClick={() => { setStudentIds([...studentIds, picker]); setPicker(""); }}><Plus/> เพิ่ม</button></div><div className="beneficiary-chips">{studentIds.map((id) => { const profile = profiles.find((item) => item.id === id) || paymentStudents.find((item) => item.id === id); return <button key={id} onClick={() => { setStudentIds(studentIds.filter((item) => item !== id)); setSelected(selected.filter((invoiceId) => paymentOptions.find((item) => item.id === invoiceId)?.studentId !== id)); }}>{profile?.displayName || "ผู้เรียน"}<X/></button>; })}</div></Card><Card title="เลือกรายการค้าง">{visible.map((invoice) => <label className="invoice-row" key={invoice.id}><input type="checkbox" disabled={invoice.status !== "unpaid"} checked={selected.includes(invoice.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, invoice.id] : selected.filter((id) => id !== invoice.id))}/><div><strong>{invoice.studentName} · {formatDate(invoice.date)}</strong><small>{invoice.details}</small></div><span>{formatBaht(invoice.totalSatang)}<small>{statusLabel(invoice.status)}</small></span></label>)}{studentIds.length > 0 && !visible.length && <p className="muted">ผู้เรียนที่เลือกไม่มียอดค้าง</p>}{studentIds.length === 0 && <p className="muted">เลือกผู้เรียนด้านบนก่อน</p>}<div className="payment-box"><strong>ยอดที่เลือก {formatBaht(total)}</strong><input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)}/><button className="primary" disabled={!selected.length || (!isDemo && !file)} onClick={submit}>แนบสลิปและส่งตรวจ</button></div></Card><p className="hint">สถานะ: ยังไม่ส่ง / ส่งแล้วรอตรวจ / ตรวจด้วยมือ / ชำระแล้ว</p></section>;
}

function Finance({ sessions, products, paymentOptions, reload, notify }) {
  const [selectedId, setSelectedId] = useState(sessions[0]?.id || ""); const session = sessions.find((item) => item.id === selectedId) || sessions[0];
  const outstanding = paymentOptions.filter((item) => item.status === "unpaid").reduce((sum, item) => sum + item.totalSatang, 0);
  return <section className="page"><PageTitle title="การเงินและสรุปยอด" subtitle="ใส่ค่าสนาม สรุปยอดคลาส และจัดการสินค้า"/><div className="metric-grid"><Metric label="ยอดค้างทั้งหมด" value={formatBaht(outstanding)}/><Metric label="รายการค้าง" value={paymentOptions.filter((item) => item.status === "unpaid").length}/></div>{session && <><SessionSelector sessions={sessions} value={session.id} onChange={setSelectedId}/><SessionCosts session={session} onSave={async (value) => { await repository.updateSessionCosts(session.id, value); await reload(); notify("บันทึกค่าเรียนและค่าสนามแล้ว"); }}/><BillingCard session={session} onFinalize={async (preview) => { await repository.finalizeSession(session.id, preview); await reload(); notify("สรุปยอดแล้ว"); }}/></>}<ProductManager products={products} onCreate={async (value) => { await repository.saveProduct(value); await reload(); notify("เพิ่มสินค้าแล้ว"); }}/></section>;
}

function Students({ profiles, sessions, user, reload, notify }) {
  const [show, setShow] = useState(false); const students = profiles.filter((item) => item.role === "student");
  return <section className="page"><PageTitle title="รายชื่อนักเรียน" subtitle="ข้อมูลรวมและสถานะ LINE" action={user.role === "admin" && <button className="primary small" onClick={() => setShow(true)}><Plus/> เพิ่มบัญชี</button>}/><div className="student-grid">{students.map((student) => { const records = sessions.flatMap((session) => session.registrations.filter((entry) => entry.studentId === student.id)); return <Card key={student.id} title={student.displayName} subtitle={`@${student.username}`}><div className="student-stats"><span><strong>{records.filter((item) => item.attendance === "present").length}</strong> มา</span><span><strong>{records.filter((item) => item.attendance === "absent").length}</strong> ขาด</span><span className={student.lineConnected ? "line-ok" : "muted"}>{student.lineConnected ? "LINE แล้ว" : "ยังไม่เชื่อม"}</span></div></Card>; })}</div>{show && <AccountModal onClose={() => setShow(false)} onSave={async (value) => { await repository.createProfile(value); setShow(false); await reload(); notify("สร้างบัญชีแล้ว"); }}/>}</section>;
}

function StudentProfile({ sessions, invoices, user }) {
  const [lineError, setLineError] = useState("");
  const records = sessions.flatMap((session) => session.registrations.filter((entry) => entry.studentId === user.id).map((entry) => ({ ...entry, session })));
  const scores = sessions.flatMap((session) => (session.lessons || []).flatMap((lesson) => lesson.kpis.flatMap((kpi) => Object.hasOwn(kpi.scores, user.id) ? [{ title: lesson.title, name: kpi.name, score: kpi.scores[user.id], maximum: kpi.maximum, date: session.date }] : [])));
  const connect = async () => { setLineError(""); try { const result = await linkCurrentLineAccount(); if (!result?.redirecting) window.location.reload(); } catch (error) { setLineError(error.message); } };
  return <section className="page"><PageTitle title={`โปรไฟล์ ${user.displayName}`} subtitle="การมาเรียน คะแนน และยอดค้างของฉัน"/><div className="metric-grid"><Metric label="มาเรียน" value={records.filter((item) => item.attendance === "present").length}/><Metric label="ขาด" value={records.filter((item) => item.attendance === "absent").length}/><Metric label="ยอดค้าง" value={formatBaht(invoices.filter((item) => item.status === "unpaid").reduce((sum, item) => sum + item.totalSatang, 0))}/><Metric label="LINE" value={user.lineConnected ? "เชื่อมแล้ว" : "ยังไม่เชื่อม"}/></div>{!user.lineConnected && !isDemo && <><button className="line-connect" onClick={connect}>เชื่อม LINE เพื่อใช้บอตลงชื่อ</button>{lineError && <p className="error-text">{lineError}</p>}</>}<Card title="คะแนนล่าสุด">{scores.map((item) => <div className="score-card" key={`${item.date}-${item.name}`}><Star/><div><strong>{item.title} · {item.name}</strong><small>{formatDate(item.date)}</small></div><span>{item.score}/{item.maximum}</span></div>)}{!scores.length && <p className="muted">ยังไม่มีคะแนน</p>}</Card></section>;
}

function StudentSignup({ session, user, onDone }) {
  const registered = session.registrations.some((entry) => entry.studentId === user.id && entry.status === "registered");
  const act = async () => { if (registered) await repository.cancelRegistration(session.id, user.id); else await repository.register(session.id, user); await onDone(); };
  return <button className={registered ? "signup-action registered" : "signup-action"} onClick={act}>{registered ? <><Check/> ลงชื่อแล้ว · กดเพื่อยกเลิก</> : <><Plus/> ลงชื่อคลาสนี้</>}</button>;
}

function WalkIn({ students, session, onAdd }) {
  const available = students.filter((student) => !session.registrations.some((entry) => entry.studentId === student.id && entry.status === "registered")); const [id, setId] = useState(available[0]?.id || "");
  useEffect(() => { if (!available.some((item) => item.id === id)) setId(available[0]?.id || ""); }, [session.id, available.length]);
  return <div className="inline-form"><select value={id} onChange={(e) => setId(e.target.value)}><option value="">เลือกคนเพิ่มหน้างาน</option>{available.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select><button disabled={!id} onClick={() => onAdd(available.find((student) => student.id === id))}><Plus/> เพิ่มและเช็กชื่อ</button></div>;
}

function Purchases({ session, products, onAdd }) {
  const present = session.registrations.filter((item) => item.attendance === "present"); const [value, setValue] = useState({ studentId: present[0]?.studentId || "", productId: products[0]?.id || "", quantity: 1 });
  return <Card title="น้ำและขนม" subtitle="เลือกของใครของมัน ระบบรวมให้ตอนสรุปยอด"><div className="purchase-controls"><select value={value.studentId} onChange={(e) => setValue({ ...value, studentId: e.target.value })}><option value="">เลือกผู้เรียนที่มา</option>{present.map((item) => <option key={item.studentId} value={item.studentId}>{item.name}</option>)}</select><select value={value.productId} onChange={(e) => setValue({ ...value, productId: e.target.value })}>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {formatBaht(product.priceSatang)}</option>)}</select><input type="number" min="1" value={value.quantity} onChange={(e) => setValue({ ...value, quantity: Number(e.target.value) })}/><button onClick={() => { const product = products.find((item) => item.id === value.productId); if (product && value.studentId) onAdd({ studentId: value.studentId, productId: product.id, name: product.name, unitPriceSatang: product.priceSatang, quantity: value.quantity }); }}><PackagePlus/> เพิ่ม</button></div><div className="purchase-history">{session.purchases.map((item) => <span key={item.id}>{session.registrations.find((entry) => entry.studentId === item.studentId)?.name} · {item.name} × {item.quantity} <strong>{formatBaht(item.unitPriceSatang * item.quantity)}</strong></span>)}</div></Card>;
}

function BillingCard({ session, onFinalize }) {
  const preview = useMemo(() => buildBillingPreview({ serviceFeeSatang: session.serviceFeeSatang, courtCostSatang: session.courtCostSatang, attendees: session.registrations, purchases: session.purchases }), [session]);
  return <Card title="สรุปยอดคลาส" subtitle={`ค่าเรียน ${formatBaht(session.serviceFeeSatang)} + ค่าสนามหาร ${preview.attendeeCount} คน + น้ำ/ขนม`}><div className="billing-summary"><span>ค่าสนามรวม<strong>{formatBaht(session.courtCostSatang)}</strong></span><span>สนามต่อคน<strong>{formatBaht(preview.court.perPersonSatang)}</strong></span><span>ส่วนเกินปัดขึ้น<strong>{formatBaht(preview.court.surplusSatang)}</strong></span></div>{preview.rows.map((row) => <div className="invoice-preview" key={row.studentId}><strong>{row.name}</strong><span>{formatBaht(row.totalSatang)}</span><small>เรียน {formatBaht(row.serviceFeeSatang)} · สนาม {formatBaht(row.courtShareSatang)} · ส่วนตัว {formatBaht(row.productsSatang)}</small></div>)}<button className="primary full" disabled={!preview.attendeeCount || session.status === "finalized"} onClick={() => onFinalize(preview)}>{session.status === "finalized" ? "สรุปยอดแล้ว" : "ยืนยันและล็อกยอด"}</button></Card>;
}

function SessionCosts({ session, onSave }) {
  const [value, setValue] = useState({ serviceFeeSatang: session.serviceFeeSatang, courtCostSatang: session.courtCostSatang });
  useEffect(() => setValue({ serviceFeeSatang: session.serviceFeeSatang, courtCostSatang: session.courtCostSatang }), [session.id, session.serviceFeeSatang, session.courtCostSatang]);
  const locked = session.status === "finalized";
  return <Card title="ค่าใช้จ่ายของคลาส" subtitle="กรอกค่าสนามภายหลังได้ก่อนสรุปยอด"><div className="form-grid"><label>ค่าเรียนต่อคน (บาท)<input disabled={locked} type="number" min="0" value={value.serviceFeeSatang / 100} onChange={(e) => setValue({ ...value, serviceFeeSatang: Math.round(Number(e.target.value) * 100) })}/></label><label>ค่าสนามรวม (บาท)<input disabled={locked} type="number" min="0" value={value.courtCostSatang / 100} onChange={(e) => setValue({ ...value, courtCostSatang: Math.round(Number(e.target.value) * 100) })}/></label></div><button className="secondary full" disabled={locked} onClick={() => onSave(value)}><Save/> {locked ? "ล็อกหลังสรุปยอดแล้ว" : "บันทึกค่าใช้จ่าย"}</button></Card>;
}

function CreateSessionModal({ venues, teachers, onClose, onCreated, onCreateVenue }) {
  const defaultVenue = venues.find((item) => item.isDefault) || venues[0];
  const [value, setValue] = useState({ date: todayIso(), venueId: defaultVenue?.id || "", venue: defaultVenue?.name || DEFAULT_VENUE, teacherId: teachers[0]?.id || "", startTime: "21:00", endTime: "23:00", serviceFeeSatang: 5000, courtCostSatang: 0 });
  const [addingVenue, setAddingVenue] = useState(false); const [newVenue, setNewVenue] = useState("");
  const addVenue = async () => { if (!newVenue.trim()) return; const created = await onCreateVenue(newVenue.trim()); setValue({ ...value, venueId: created?.id || "", venue: newVenue.trim() }); setAddingVenue(false); };
  return <Modal title="สร้างคลาส" eyebrow="ข้อมูลคลาส" onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); onCreated(value); }}><div className="venue-first"><label>สนาม<select value={value.venueId} onChange={(e) => { if (e.target.value === "__new") { setAddingVenue(true); return; } const venue = venues.find((item) => item.id === e.target.value); setValue({ ...value, venueId: venue?.id || "", venue: venue?.name || DEFAULT_VENUE }); }}><option value="">{DEFAULT_VENUE}</option>{venues.map((venue) => <option value={venue.id} key={venue.id}>{venue.name}</option>)}<option value="__new">+ เพิ่มสนามใหม่</option></select></label>{addingVenue && <div className="add-venue"><input value={newVenue} onChange={(e) => setNewVenue(e.target.value)} placeholder="ชื่อสนามใหม่"/><button type="button" onClick={addVenue}>บันทึกสนาม</button></div>}</div><div className="form-grid"><label>วันที่<input type="date" value={value.date} onChange={(e) => setValue({ ...value, date: e.target.value })} required/></label><label>ครูผู้สอน<select value={value.teacherId} onChange={(e) => setValue({ ...value, teacherId: e.target.value })}><option value="">ยังไม่ระบุ</option>{teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>)}</select></label><label>เวลาเริ่ม<input type="time" value={value.startTime} onChange={(e) => setValue({ ...value, startTime: e.target.value })} required/></label><label>เวลาจบ<input type="time" value={value.endTime} onChange={(e) => setValue({ ...value, endTime: e.target.value })} required/></label><label>ค่าเรียนต่อคน (บาท)<input type="number" min="0" value={value.serviceFeeSatang / 100} onChange={(e) => setValue({ ...value, serviceFeeSatang: Math.round(Number(e.target.value) * 100) })}/></label><label>ค่าสนามรวม (ใส่ทีหลังได้)<input type="number" min="0" value={value.courtCostSatang / 100} onChange={(e) => setValue({ ...value, courtCostSatang: Math.round(Number(e.target.value) * 100) })}/></label></div><button className="primary full"><CalendarDays/> สร้างและเปิดลงชื่อ</button></form></Modal>;
}

function LessonModal({ onClose, onSave }) {
  const [value, setValue] = useState({ title: "", description: "", kpis: [{ name: "", maximum: 10 }] });
  return <Modal title="เพิ่มหัวข้อเรียน" eyebrow="การ์ดใหม่" onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); onSave(value); }}><label>ชื่อหัวข้อหลัก<input value={value.title} onChange={(e) => setValue({ ...value, title: e.target.value })} placeholder="เช่น ฝึกเซฟหน้าเน็ต" required/></label><label>รายละเอียดที่ต้องทำ<textarea value={value.description} onChange={(e) => setValue({ ...value, description: e.target.value })} placeholder="อธิบายขั้นตอนและเป้าหมายของหัวข้อนี้" rows="4"/></label><h3>KPI และคะแนนเต็ม</h3>{value.kpis.map((kpi, index) => <div className="kpi-create" key={index}><input value={kpi.name} onChange={(e) => setValue({ ...value, kpis: value.kpis.map((item, i) => i === index ? { ...item, name: e.target.value } : item) })} placeholder="ชื่อ KPI" required/><input type="number" min="1" value={kpi.maximum} onChange={(e) => setValue({ ...value, kpis: value.kpis.map((item, i) => i === index ? { ...item, maximum: Number(e.target.value) } : item) })} required/>{value.kpis.length > 1 && <button type="button" onClick={() => setValue({ ...value, kpis: value.kpis.filter((_, i) => i !== index) })}><X/></button>}</div>)}<button type="button" className="secondary full" onClick={() => setValue({ ...value, kpis: [...value.kpis, { name: "", maximum: 10 }] })}><Plus/> เพิ่ม KPI</button><button className="primary full">เพิ่มการ์ดหัวข้อเรียน</button></form></Modal>;
}

function AccountModal({ onClose, onSave }) {
  const [value, setValue] = useState({ displayName: "", username: "", password: "", role: "student" });
  return <Modal title="เพิ่มบัญชี" eyebrow="นักเรียนหรือครู" onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); onSave(value); }}><div className="form-grid"><label>ชื่อแสดง<input value={value.displayName} onChange={(e) => setValue({ ...value, displayName: e.target.value })} required/></label><label>ประเภท<select value={value.role} onChange={(e) => setValue({ ...value, role: e.target.value })}><option value="student">นักเรียน</option><option value="teacher">ครู</option></select></label><label>Username<input value={value.username} onChange={(e) => setValue({ ...value, username: e.target.value.toLowerCase() })} pattern="[a-zA-Z0-9._-]{3,40}" required/></label><label>รหัสผ่านเริ่มต้น<input type="password" minLength="8" value={value.password} onChange={(e) => setValue({ ...value, password: e.target.value })} required/></label></div><button className="primary full">สร้างบัญชี</button></form></Modal>;
}

function ProductManager({ products, onCreate }) { const [value, setValue] = useState({ name: "", price: 10 }); return <Card title="รายการน้ำและขนม"><div className="product-list">{products.map((item) => <span key={item.id}>{item.name}<strong>{formatBaht(item.priceSatang)}</strong></span>)}</div><form className="inline-form" onSubmit={(e) => { e.preventDefault(); onCreate({ name: value.name, priceSatang: Math.round(Number(value.price) * 100) }); setValue({ ...value, name: "" }); }}><input value={value.name} onChange={(e) => setValue({ ...value, name: e.target.value })} placeholder="ชื่อสินค้า" required/><div className="price-add"><input type="number" min="0" value={value.price} onChange={(e) => setValue({ ...value, price: e.target.value })}/><button><Plus/> เพิ่ม</button></div></form></Card>; }

function SessionSelector({ sessions, value, onChange }) { return <div className="session-tabs">{sessions.map((session) => <button key={session.id} className={value === session.id ? "active" : ""} onClick={() => onChange(session.id)}><strong>{formatDate(session.date)}</strong><span>{session.startTime}–{session.endTime}</span></button>)}</div>; }
function SessionHero({ session }) { return <div className="session-hero"><div><span>{formatDate(session.date)}</span><h2>{session.venue}</h2><p>{session.startTime}–{session.endTime} น. · ค่าเรียน {formatBaht(session.serviceFeeSatang)}</p></div><strong>{session.status === "finalized" ? "สรุปยอดแล้ว" : "เปิดลงชื่อ"}</strong></div>; }
function SessionSummary({ session }) { return <div className="session-summary"><CalendarDays/><div><strong>{formatDate(session.date)} · {session.startTime}–{session.endTime}</strong><small>{session.venue} · {session.lessons?.length || 0} หัวข้อเรียน</small></div><span>{session.status === "finalized" ? "สรุปแล้ว" : "เปิด"}</span></div>; }
function Modal({ title, eyebrow, onClose, children }) { return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="modal"><div className="modal-head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><button type="button" className="icon-button" aria-label="ปิด" onClick={onClose}><X/></button></div>{children}</div></div>; }
function PageTitle({ title, subtitle, action }) { return <div className="page-title"><div><h2>{title}</h2><p>{subtitle}</p></div>{action}</div>; }
function Card({ title, subtitle, children }) { return <article className="card"><header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></header>{children}</article>; }
function Metric({ label, value }) { return <article className="metric"><span>{label}</span><strong>{value}</strong></article>; }
function todayIso() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }); }
function formatDate(value) { return value ? new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "2-digit" }).format(new Date(`${value}T12:00:00+07:00`)) : "ไม่ระบุวัน"; }
function statusLabel(status) { return ({ unpaid: "ยังไม่ส่ง", slip_pending: "ส่งแล้วรอตรวจ", manual_review: "ตรวจด้วยมือ", paid: "ชำระแล้ว" })[status] || status; }
