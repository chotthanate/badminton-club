import React, { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  CalendarDays,
  Check,
  Copy,
  Clock3,
  Calculator,
  LogIn,
  LogOut,
  MessageCircle,
  Plus,
  ReceiptText,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import {
  addCourt,
  addExpense,
  addLineMember,
  createClub,
  createEvent,
  getAdminContext,
  loadDashboard,
  recordAudit,
  publishEventToLine,
  removeCourt,
  removeParticipant,
  setPayment,
  updateAttendance,
  updateCourt,
  updateEvent,
  updateExpense,
  updateSignup,
} from "./clubRepository.js";
import {
  STATUS_LABELS,
  WEIGHT_PRESETS,
  baht,
  buildLineSummary,
  calculateSettlement,
  createInitialEvent,
  formatThaiLongDate,
  minutesBetween,
  totalCourtHours,
  weightFromTimes,
} from "./badmintonLogic.js";
import { isSupabaseConfigured, supabase } from "./supabase.js";

const EVENT_STATUS_LABELS = {
  draft: "แบบร่าง",
  open: "เปิดลงชื่อ",
  closed: "ปิดรอบแล้ว",
  cancelled: "ยกเลิก",
};

export default function BadmintonApp() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return undefined;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (authLoading) return <LoadingScreen label="กำลังตรวจสอบสิทธิ์แอดมิน" />;
  if (!isSupabaseConfigured) return <ConfigError />;
  if (!session) return <AdminLogin />;
  return <AdminDashboard session={session} />;
}

function AdminLogin() {
  const [accessCode, setAccessCode] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSending(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({
      email: import.meta.env.VITE_ADMIN_EMAIL,
      password: accessCode,
    });
    setSending(false);
    setMessage(error ? "รหัสเข้าเว็บไม่ถูกต้อง" : "เข้าสู่ระบบสำเร็จ");
  }

  return (
    <main className="badminton-app badminton-auth-page">
      <section className="badminton-auth-card">
        <div className="badminton-auth-icon"><ShieldCheck size={30} /></div>
        <p className="badminton-kicker">Admin only</p>
        <h1>หลังบ้านกลุ่มแบด</h1>
        <p>สมาชิกไม่ต้องเข้าเว็บ การลงชื่อทั้งหมดจะทำผ่าน LINE</p>
        <form onSubmit={submit}>
          <label htmlFor="admin-code">รหัสเข้าเว็บ</label>
          <input
            autoComplete="current-password"
            id="admin-code"
            onChange={(event) => setAccessCode(event.target.value)}
            placeholder="กรอกรหัสแอดมิน"
            required
            type="password"
            value={accessCode}
          />
          <button className="badminton-primary" disabled={sending} type="submit">
            <LogIn size={18} /> {sending ? "กำลังตรวจสอบ..." : "เข้าสู่หลังบ้าน"}
          </button>
        </form>
        {message ? <p className="badminton-form-message">{message}</p> : null}
      </section>
    </main>
  );
}

function AdminDashboard({ session }) {
  const [context, setContext] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    setError("");
    try {
      const nextContext = await getAdminContext(session.user.id);
      setContext(nextContext);
      setDashboard(nextContext ? await loadDashboard(nextContext.club_id) : null);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [session.user.id]);

  useEffect(() => {
    if (!dashboard?.event || dashboard.event.status !== "open") return undefined;
    const timer = window.setInterval(() => refresh(true), 5000);
    return () => window.clearInterval(timer);
  }, [dashboard?.event?.id, dashboard?.event?.status]);

  async function mutate(action, successMessage) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(successMessage);
      await refresh();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading && !dashboard) return <LoadingScreen label="กำลังโหลดหลังบ้าน" />;
  if (!context) return <ClubSetup session={session} onCreated={refresh} error={error} />;

  const appEvent = dashboard.event ? mapDashboardToEvent(dashboard) : null;
  const settlement = appEvent ? calculateSettlement(appEvent) : null;

  return (
    <main className="badminton-app">
      <section className="badminton-shell">
        <header className="badminton-header">
          <div>
            <p className="badminton-kicker">Admin dashboard</p>
            <h1>{context.clubs.name}</h1>
            <p>สมาชิกลงชื่อผ่าน LINE · เว็บนี้สำหรับแอดมินเท่านั้น</p>
          </div>
          <div className="badminton-header-actions">
            <button aria-label="รีเฟรชข้อมูล" className="badminton-icon-button" onClick={refresh} type="button">
              <RefreshCw size={18} />
            </button>
            <button className="badminton-secondary" onClick={() => supabase.auth.signOut()} type="button">
              <LogOut size={17} /> ออกจากระบบ
            </button>
          </div>
        </header>

        {notice ? <div className="badminton-alert is-success">{notice}</div> : null}
        {error ? <div className="badminton-alert is-error">{error}</div> : null}

        {!dashboard.event ? (
          <CreateEventCard context={context} session={session} mutate={mutate} />
        ) : (
          <>
            <EventControlCard
              clubName={context.clubs.name}
              courts={dashboard.courts}
              event={dashboard.event}
              mutate={mutate}
            />
            <a className="badminton-summary-cta" href="#settlement">
              <span><Calculator size={24} /><strong>ดูสรุปยอด</strong></span>
              <span>{baht(settlement.totalCost)} บาท · {settlement.rows.length} คน</span>
            </a>
            <div className="badminton-admin-layout">
              <ParticipantsPanel
                context={context}
                dashboard={dashboard}
                event={appEvent}
                mutate={mutate}
                session={session}
                settlement={settlement}
              />
              <PricingPanel event={appEvent} mutate={mutate} session={session} />
            </div>
            <SettlementPanel dashboard={dashboard} event={appEvent} mutate={mutate} session={session} settlement={settlement} />
            <AuditPanel actions={appEvent.actions} />
            <CreateEventCard compact context={context} session={session} mutate={mutate} />
          </>
        )}
        {saving ? <div className="badminton-saving">กำลังบันทึก...</div> : null}
      </section>
    </main>
  );
}

function ClubSetup({ session, onCreated, error }) {
  const [name, setName] = useState("กลุ่มแบดของเรา");
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setLocalError("");
    try {
      await createClub({ name, ownerId: session.user.id });
      await onCreated();
    } catch (nextError) {
      setLocalError(nextError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="badminton-app badminton-auth-page">
      <section className="badminton-auth-card">
        <p className="badminton-kicker">First setup</p>
        <h1>สร้างหลังบ้านกลุ่มแรก</h1>
        <form onSubmit={submit}>
          <label htmlFor="club-name">ชื่อกลุ่ม</label>
          <input id="club-name" onChange={(event) => setName(event.target.value)} required value={name} />
          <button className="badminton-primary" disabled={saving} type="submit">
            <Plus size={18} /> สร้างกลุ่ม
          </button>
        </form>
        {error || localError ? <p className="badminton-form-message is-error">{error || localError}</p> : null}
      </section>
    </main>
  );
}

function CreateEventCard({ compact = false, context, session, mutate }) {
  const initial = createInitialEvent();
  const [form, setForm] = useState({
    eventDate: initial.date,
    venue: "คอร์ทแบดเขาน้อย (คอร์ทใหม่)",
    courtName: "คอร์ท 7",
    startsAt: "21:00",
    endsAt: "00:00",
  });

  function set(field, value) { setForm((current) => ({ ...current, [field]: value })); }

  async function submit(event) {
    event.preventDefault();
    await mutate(async () => {
      const created = await createEvent({
        clubId: context.club_id,
        clubName: context.clubs.name,
        userId: session.user.id,
        ...form,
      });
      await recordAudit({
        clubId: context.club_id,
        eventId: created.id,
        userId: session.user.id,
        action: "สร้างรอบใหม่",
      });
    }, "สร้างรอบใหม่แล้ว");
  }

  return (
    <section className={`badminton-card ${compact ? "badminton-compact-create" : ""}`}>
      <div className="badminton-card-title">
        <CalendarDays size={20} />
        <div><h2>{compact ? "สร้างรอบถัดไป" : "เริ่มรอบแรก"}</h2><p>ชื่อรอบจะสร้างจากชื่อกลุ่มและวันที่ให้อัตโนมัติ</p></div>
      </div>
      <form className="badminton-event-form" onSubmit={submit}>
        <label>วันที่<input onChange={(event) => set("eventDate", event.target.value)} required type="date" value={form.eventDate} /></label>
        <label>สถานที่<input onChange={(event) => set("venue", event.target.value)} required value={form.venue} /></label>
        <label>คอร์ท<input onChange={(event) => set("courtName", event.target.value)} required value={form.courtName} /></label>
        <label>เริ่ม<input onChange={(event) => set("startsAt", event.target.value)} required type="time" value={form.startsAt} /></label>
        <label>จบ<input onChange={(event) => set("endsAt", event.target.value)} required type="time" value={form.endsAt} /></label>
        <button className="badminton-primary" type="submit"><Plus size={17} /> สร้างรอบ</button>
      </form>
    </section>
  );
}

function EventControlCard({ clubName, courts, event, mutate }) {
  const [form, setForm] = useState({
    event_date: event.event_date,
    venue: event.venue,
  });
  const [newCourt, setNewCourt] = useState({ courtName: "", startsAt: "21:00", endsAt: "00:00" });
  const nextStatus = event.status === "open" ? "closed" : "open";

  async function addNewCourt(submitEvent) {
    submitEvent.preventDefault();
    await mutate(() => addCourt({
      clubId: event.club_id,
      eventId: event.id,
      ...newCourt,
    }), "เพิ่มคอร์ทแล้ว");
    setNewCourt({ courtName: "", startsAt: "21:00", endsAt: "00:00" });
  }

  function toggleSignup() {
    if (nextStatus === "open") {
      const message = event.status === "closed"
        ? "ล้างคำตอบเดิม ส่งรอบเข้า LINE และเปิดลงชื่อใหม่แล้ว"
        : "ส่งรอบเข้า LINE และเปิดลงชื่อแล้ว";
      return mutate(() => publishEventToLine(event.id), message);
    }
    return mutate(() => updateEvent(event.id, { status: "closed" }), "ปิดรอบแล้ว");
  }

  return (
    <section className="badminton-event badminton-card">
      <div className="badminton-event-main">
        <div className="badminton-event-title">
          <CalendarDays size={22} />
          <div><h2>{clubName} : วันที่ {formatThaiLongDate(event.event_date)}</h2><p>สถานที่ : {event.venue}</p></div>
        </div>
        <span className={`badminton-status-pill is-${event.status}`}>{EVENT_STATUS_LABELS[event.status]}</span>
      </div>
      <div className="badminton-event-form badminton-event-main-form">
        <label>วันที่<input type="date" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} /></label>
        <label>สถานที่<input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} /></label>
        <button className="badminton-secondary" onClick={() => mutate(() => updateEvent(event.id, form), "บันทึกรายละเอียดรอบแล้ว")} type="button"><Save size={17} /> บันทึก</button>
        <button className="badminton-primary" onClick={toggleSignup} type="button">
          {nextStatus === "open" ? "เปิดลงชื่อ" : "ปิดรอบ"}
        </button>
      </div>
      <div className="badminton-courts-editor">
        <div className="badminton-courts-heading"><strong>คอร์ทที่จอง</strong><span>แต่ละคอร์ทกำหนดเวลาไม่เท่ากันได้</span></div>
        {courts.map((court) => <CourtEditor key={court.id} court={court} eventId={event.id} mutate={mutate} />)}
        <form className="badminton-court-row is-new" onSubmit={addNewCourt}>
          <input aria-label="ชื่อคอร์ทใหม่" placeholder="เช่น คอร์ท 8" required value={newCourt.courtName} onChange={(e) => setNewCourt({ ...newCourt, courtName: e.target.value })} />
          <label>เริ่ม<input required type="time" value={newCourt.startsAt} onChange={(e) => setNewCourt({ ...newCourt, startsAt: e.target.value })} /></label>
          <label>จบ<input required type="time" value={newCourt.endsAt} onChange={(e) => setNewCourt({ ...newCourt, endsAt: e.target.value })} /></label>
          <button className="badminton-secondary" type="submit"><Plus size={16} /> เพิ่มคอร์ท</button>
        </form>
      </div>
    </section>
  );
}

function CourtEditor({ court, eventId, mutate }) {
  const [form, setForm] = useState({
    court_name: court.court_name,
    starts_at: court.starts_at.slice(0, 5),
    ends_at: court.ends_at.slice(0, 5),
  });
  return (
    <div className="badminton-court-row">
      <input aria-label={`ชื่อ ${court.court_name}`} value={form.court_name} onChange={(e) => setForm({ ...form, court_name: e.target.value })} />
      <label>เริ่ม<input type="time" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} /></label>
      <label>จบ<input type="time" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></label>
      <button aria-label={`บันทึก ${court.court_name}`} className="badminton-icon-button" onClick={() => mutate(() => updateCourt(court.id, eventId, form), `บันทึก ${form.court_name} แล้ว`)} type="button"><Save size={16} /></button>
      <button aria-label={`ลบ ${court.court_name}`} className="badminton-delete-button" onClick={() => mutate(() => removeCourt(court.id, eventId), `ลบ ${court.court_name} แล้ว`)} type="button"><Trash2 size={16} /></button>
    </div>
  );
}

function ParticipantsPanel({ context, dashboard, event, mutate, session, settlement }) {
  const [name, setName] = useState("");
  const coming = event.signups.filter((row) => row.status === "coming").length;
  const maybe = event.signups.filter((row) => row.status === "maybe").length;
  const notComing = event.signups.filter((row) => row.status === "not_coming").length;
  const participants = event.signups
    .filter((signup) => signup.status === "coming" || signup.status === "maybe")
    .map((signup) => ({
      ...signup,
      member: dashboard.members.find((member) => member.id === signup.memberId),
      attendance: event.attendance.find((row) => row.memberId === signup.memberId),
    }))
    .filter((row) => row.member);
  const leftTimeOptions = useMemo(() => buildTimeOptions(event.startTime, event.endTime), [event.startTime, event.endTime]);

  async function addMember(eventObject) {
    eventObject.preventDefault();
    await mutate(async () => {
      const member = await addLineMember({ clubId: context.club_id, displayName: name });
      await updateSignup({ clubId: context.club_id, eventId: event.id, memberId: member.id, status: "coming" });
      await recordAudit({ clubId: context.club_id, eventId: event.id, userId: session.user.id, action: `เพิ่มผู้เล่น ${name}` });
      setName("");
    }, "เพิ่มผู้เล่นแล้ว");
  }

  return (
    <section className="badminton-card badminton-participants-card">
      <div className="badminton-card-title"><Users size={20} /><div><h2>รายชื่อผู้เล่น</h2><p>รายชื่อที่ลงไว้ใน LINE · เพิ่มหรือลบได้ทันที</p></div></div>
      <div className="badminton-stats">
        <div><strong>{coming}</strong><span>มา</span></div>
        <div><strong>{maybe}</strong><span>อาจมา</span></div>
        <div><strong>{notComing}</strong><span>ไม่มา</span></div>
      </div>
      <div className="badminton-line-state is-compact">
        <MessageCircle size={17} />
        <span>{context.clubs.line_group_id ? "เชื่อม LINE แล้ว รายชื่อใหม่จะเข้ามาอัตโนมัติ" : "ตอนนี้เพิ่มรายชื่อจาก LINE ด้วยตัวเองได้"}</span>
      </div>
      <form className="badminton-inline-form" onSubmit={addMember}>
        <input aria-label="ชื่อผู้เล่น" placeholder="พิมพ์ชื่อจาก LINE" required value={name} onChange={(e) => setName(e.target.value)} />
        <button className="badminton-primary badminton-add-player" type="submit"><UserPlus size={17} /> เพิ่มคน</button>
      </form>
      <div className="badminton-attendance-list">
        {participants.length ? participants.map(({ member, attendance: row, status }) => {
          return (
            <article className="badminton-attendance-row" key={member.id}>
              <div><strong>{member.display_name}</strong><span>{STATUS_LABELS[status]}</span></div>
              <select aria-label={`สัดส่วน ${member.display_name}`} value={row?.weight ?? 1} onChange={(e) => mutate(() => updateAttendance({ clubId: event.clubId, eventId: event.id, memberId: member.id, patch: { arrived: true, weight: Number(e.target.value) } }), "อัปเดตสัดส่วนแล้ว")}>
                {WEIGHT_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
              </select>
              <select aria-label={`เวลาออก ${member.display_name}`} value={row?.leftAt || ""} onChange={(e) => mutate(() => updateAttendance({ clubId: event.clubId, eventId: event.id, memberId: member.id, patch: { arrived: true, left_at: e.target.value || null, weight: e.target.value ? weightFromTimes(event.startTime, event.endTime, e.target.value) : 1 } }), "อัปเดตเวลาออกแล้ว")}>
                <option value="">ยังไม่กลับ</option>
                {leftTimeOptions.map((time) => <option key={time} value={time}>{time}</option>)}
              </select>
              <button aria-label={`ลบ ${member.display_name}`} className="badminton-delete-button" onClick={() => mutate(() => removeParticipant({ eventId: event.id, memberId: member.id }), `ลบ ${member.display_name} ออกจากรอบแล้ว`)} type="button"><Trash2 size={17} /></button>
            </article>
          );
        }) : <div className="badminton-empty">ยังไม่มีรายชื่อ เพิ่มชื่อจาก LINE ด้านบนได้เลย</div>}
      </div>
      <div className="badminton-total"><span>คิดเงิน {settlement.rows.length} คน</span><strong>{settlement.totalUnits.toFixed(2)} หน่วย</strong></div>
    </section>
  );
}

function PricingPanel({ event, mutate, session }) {
  const [editingCourt, setEditingCourt] = useState(false);
  const [editingShuttle, setEditingShuttle] = useState(false);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const courtHours = totalCourtHours(event.courts);
  const courtCost = courtHours * event.courtHourlyRate;
  const shuttleCost = event.shuttlecockCount * event.shuttlecockUnitPrice;

  function extendCourt(court) {
    const endsAt = addMinutes(court.endsAt, 30);
    mutate(() => updateCourt(court.id, event.id, { ends_at: endsAt }), `ต่อเวลา ${court.name} เป็น ${endsAt} แล้ว`);
  }

  return (
    <section className="badminton-card badminton-pricing-card">
      <div className="badminton-card-title"><Calculator size={20} /><div><h2>เวลาและค่าใช้จ่าย</h2><p>คำนวณค่าคอร์ดและลูกแบดให้อัตโนมัติ</p></div></div>
      <div className="badminton-pricing-grid">
        <article className="badminton-price-box">
          <div className="badminton-price-head"><span><Clock3 size={18} /> เวลาคอร์ทรวม</span><strong>{courtHours.toFixed(courtHours % 1 ? 1 : 0)} ชม.</strong></div>
          <div className="badminton-court-time-list">
            {event.courts.map((court) => (
              <div key={court.id}>
                <span><strong>{court.name}</strong> {court.startsAt}–{displayEndTime(court.endsAt)}</span>
                <button className="badminton-edit-price" onClick={() => extendCourt(court)} type="button"><Plus size={14} /> 30 นาที</button>
              </div>
            ))}
          </div>
        </article>
        <article className="badminton-price-box">
          <div className="badminton-price-head"><span>ค่าคอร์ด</span><strong>{baht(courtCost)} บาท</strong></div>
          <div className="badminton-price-setting">
            {editingCourt ? <input autoFocus min="0" type="number" defaultValue={event.courtHourlyRate} onBlur={(e) => { setEditingCourt(false); mutate(() => updateEvent(event.id, { court_hourly_rate: Number(e.target.value) }), "แก้ราคาคอร์ดแล้ว"); }} /> : <span>{baht(event.courtHourlyRate)} บาท/ชม.</span>}
            <button className="badminton-edit-price" onClick={() => setEditingCourt(true)} type="button">แก้ราคา</button>
          </div>
        </article>
        <article className="badminton-price-box badminton-shuttle-box">
          <label>จำนวนลูกแบด<input defaultValue={event.shuttlecockCount} min="0" type="number" onBlur={(e) => mutate(() => updateEvent(event.id, { shuttlecock_count: Number(e.target.value) }), "อัปเดตจำนวนลูกแบดแล้ว")} /></label>
          <div className="badminton-price-head"><span>ค่าลูกแบด</span><strong>{baht(shuttleCost)} บาท</strong></div>
          <div className="badminton-price-setting">
            {editingShuttle ? <input autoFocus min="0" type="number" defaultValue={event.shuttlecockUnitPrice} onBlur={(e) => { setEditingShuttle(false); mutate(() => updateEvent(event.id, { shuttlecock_unit_price: Number(e.target.value) }), "แก้ราคาลูกแบดแล้ว"); }} /> : <span>{baht(event.shuttlecockUnitPrice)} บาท/ลูก</span>}
            <button className="badminton-edit-price" onClick={() => setEditingShuttle(true)} type="button">แก้ราคา</button>
          </div>
        </article>
      </div>
      <div className="badminton-other-expenses">
        <strong>ค่าใช้จ่ายอื่น</strong>
        <div className="badminton-expense-list">
          {event.extraCosts.map((cost) => (
            <label key={cost.id}><span>{cost.label}</span><input defaultValue={cost.amount} min="0" type="number" onBlur={(e) => mutate(() => updateExpense(cost.id, e.target.value), "อัปเดตค่าใช้จ่ายแล้ว")} /></label>
          ))}
        </div>
      </div>
      <form className="badminton-inline-form" onSubmit={(e) => { e.preventDefault(); mutate(() => addExpense({ clubId: event.clubId, eventId: event.id, userId: session.user.id, label, amount }), "เพิ่มค่าใช้จ่ายแล้ว"); setLabel(""); setAmount(""); }}>
        <input placeholder="รายการอื่น (ถ้ามี)" required value={label} onChange={(e) => setLabel(e.target.value)} />
        <input min="0" placeholder="บาท" required type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button className="badminton-secondary" type="submit"><Plus size={17} /> เพิ่ม</button>
      </form>
    </section>
  );
}

function SettlementPanel({ event, mutate, session, settlement }) {
  const [copied, setCopied] = useState(false);
  const lineSummary = useMemo(() => buildLineSummary(event), [event]);
  async function copySummary() {
    await navigator.clipboard.writeText(lineSummary);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return (
    <section className="badminton-card badminton-settlement-card" id="settlement">
      <div className="badminton-card-title"><ReceiptText size={20} /><div><h2>ยอดที่ต้องจ่าย</h2><p>{baht(settlement.totalCost)} บาท / {settlement.totalUnits.toFixed(2)} หน่วย</p></div></div>
      <div className="badminton-settlement-hero"><span>ยอดรวมรอบนี้</span><strong>{baht(settlement.totalCost)} บาท</strong><small>เฉลี่ย {baht(settlement.unitPrice)} บาท / 1 หน่วย</small></div>
      <div className="badminton-pay-list">
        {settlement.rows.map((row) => (
          <article className="badminton-pay-row" key={row.memberId}>
            <div><strong>{row.name}</strong><span>{Math.round(Number(row.weight) * 100)}%</span></div>
            <strong>{baht(row.roundedDue)} บาท</strong>
            <button className={row.paid ? "is-paid" : ""} onClick={() => mutate(() => setPayment({ clubId: event.clubId, eventId: event.id, memberId: row.memberId, amount: row.roundedDue, paid: !row.paid, userId: session.user.id }), "อัปเดตสถานะรับเงินแล้ว")} type="button"><Check size={16} /> {row.paid ? "จ่ายแล้ว" : "รับเงิน"}</button>
          </article>
        ))}
      </div>
      <textarea readOnly value={lineSummary} />
      <button className="badminton-primary" onClick={copySummary} type="button"><Copy size={18} /> {copied ? "คัดลอกแล้ว" : "คัดลอกสรุปส่ง LINE"}</button>
    </section>
  );
}

function AuditPanel({ actions }) {
  return (
    <section className="badminton-card badminton-audit">
      <div className="badminton-card-title"><BadgeCheck size={20} /><div><h2>Audit log</h2><p>กิจกรรมสำคัญของแอดมินและ LINE webhook</p></div></div>
      {actions.length ? <div className="badminton-audit-list">{actions.map((action) => <p key={action.id}><strong>{action.actorName}</strong> {action.action} <span>{action.at}</span></p>)}</div> : <p className="badminton-note">ยังไม่มีรายการ</p>}
    </section>
  );
}

function mapDashboardToEvent(dashboard) {
  const paymentsByMember = new Map(dashboard.payments.map((payment) => [payment.member_id, payment]));
  const membersById = new Map(dashboard.members.map((member) => [member.id, member]));
  const attendanceByMember = new Map(dashboard.attendance.map((row) => [row.member_id, row]));
  const startTime = dashboard.event.starts_at.slice(0, 5);
  const endTime = dashboard.event.ends_at.slice(0, 5);
  const courtHourlyRate = Number(dashboard.event.court_hourly_rate ?? 200);
  const shuttlecockCount = Number(dashboard.event.shuttlecock_count ?? 0);
  const shuttlecockUnitPrice = Number(dashboard.event.shuttlecock_unit_price ?? 60);
  const extraCosts = dashboard.expenses.map((row) => ({ id: row.id, type: row.category, label: row.label, amount: Number(row.amount) }));
  const courts = dashboard.courts.map((court) => ({
    id: court.id,
    name: court.court_name,
    startsAt: court.starts_at.slice(0, 5),
    endsAt: court.ends_at.slice(0, 5),
  }));
  const courtHours = totalCourtHours(courts);
  const billableSignups = dashboard.signups.filter((row) => row.status === "coming" || row.status === "maybe");
  const attendance = billableSignups.map((signup) => {
    const row = attendanceByMember.get(signup.member_id);
    return {
      memberId: signup.member_id,
      name: membersById.get(signup.member_id)?.display_name || "ไม่ทราบชื่อ",
      arrived: true,
      weight: Number(row?.weight ?? 1),
      arrivedAt: row?.arrived_at?.slice(0, 5) || "",
      leftAt: row?.left_at?.slice(0, 5) || "",
      note: row?.note || "",
      paid: Boolean(paymentsByMember.get(signup.member_id)?.paid_at),
    };
  });
  return {
    id: dashboard.event.id,
    clubId: dashboard.event.club_id,
    date: dashboard.event.event_date,
    title: dashboard.event.title,
    startTime,
    endTime,
    status: dashboard.event.status,
    venue: dashboard.event.venue,
    courts,
    courtHourlyRate,
    shuttlecockCount,
    shuttlecockUnitPrice,
    members: dashboard.members.map((member) => ({ id: member.id, name: member.display_name, role: member.role, lineUserId: member.line_user_id, active: member.active })),
    signups: dashboard.signups.map((row) => ({ memberId: row.member_id, status: row.status, note: row.note })),
    attendance,
    extraCosts,
    costs: [
      { id: "computed-court", type: "court", label: `ค่าคอร์ดรวม ${courtHours} ชม.`, amount: courtHours * courtHourlyRate },
      { id: "computed-shuttle", type: "shuttle", label: `ค่าลูกแบด ${shuttlecockCount} ลูก`, amount: shuttlecockCount * shuttlecockUnitPrice },
      ...extraCosts,
    ],
    actions: dashboard.auditLogs.map((row) => ({
      id: row.id,
      actorName: row.actor_id ? "แอดมิน" : "LINE bot",
      action: row.action,
      at: new Date(row.created_at).toLocaleString("th-TH"),
    })),
  };
}

function addMinutes(time, amount) {
  const [hours, minutes] = time.split(":").map(Number);
  const total = (hours * 60 + minutes + amount) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function displayEndTime(time) {
  return time === "00:00" ? "24:00" : time;
}

function buildTimeOptions(startTime, endTime) {
  const options = [];
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  let cursor = startHour * 60 + startMinute + 30;
  let end = endHour * 60 + endMinute;
  if (end <= startHour * 60 + startMinute) end += 24 * 60;
  while (cursor <= end) {
    const normalized = cursor % (24 * 60);
    options.push(`${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`);
    cursor += 30;
  }
  return options;
}

function LoadingScreen({ label }) {
  return <main className="badminton-app badminton-auth-page"><div className="badminton-loading"><RefreshCw size={24} /><strong>{label}</strong></div></main>;
}

function ConfigError() {
  return <main className="badminton-app badminton-auth-page"><section className="badminton-auth-card"><h1>ยังไม่ได้ตั้งค่า Supabase</h1><p>เพิ่ม Project URL และ Publishable key ใน environment variables ก่อนเปิดใช้งานหลังบ้าน</p></section></main>;
}
