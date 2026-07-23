import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  BadgeCheck,
  CalendarDays,
  Check,
  Copy,
  Calculator,
  FlaskConical,
  History,
  LogIn,
  LogOut,
  PackagePlus,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import {
  addCourt,
  addExpense,
  addExtraCatalogItem,
  addLineMember,
  addMemberExtraCharge,
  changeAdminPassword,
  createClub,
  createEvent,
  createTestClub,
  getAdminContexts,
  finishEvent,
  listClubEvents,
  loadDashboard,
  recordAudit,
  resetTestClub,
  prepareEventForLine,
  removeCourt,
  removeExtraCatalogItem,
  removeMemberExtraCharge,
  removeParticipant,
  setPayment,
  updateAttendance,
  updateClubMember,
  updateCourt,
  updateEvent,
  updateEventDetails,
  updateExtraCatalogItem,
  updateExpense,
  updateSignup,
  updateSignupArrival,
} from "./clubRepository.js";
import {
  baht,
  buildLineSummary,
  calculateSettlement,
  createInitialEvent,
  formatPlayedDuration,
  formatThaiLongDate,
  minutesBetween,
  playedMinutesWithinEvent,
  totalCourtHours,
} from "./badmintonLogic.js";
import { normalizeMemberSearch, rankMemberSuggestions } from "./memberSearch.js";
import { isSupabaseConfigured, supabase } from "./supabase.js";

const EVENT_STATUS_LABELS = {
  draft: "เตรียมรอบ",
  open: "เปิดลงชื่อ",
  closed: "จบรอบแล้ว",
  cancelled: "ยกเลิก",
};

const ADMIN_TABS = [
  { id: "round", label: "รอบ", icon: CalendarDays },
  { id: "players", label: "ผู้เล่น", icon: Users },
  { id: "costs", label: "ค่าใช้จ่าย", icon: Calculator },
  { id: "payments", label: "ชำระเงิน", icon: WalletCards },
  { id: "history", label: "ประวัติ", icon: History },
];

const HALF_HOUR_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 ? "30" : "00";
  return `${String(hour).padStart(2, "0")}:${minute}`;
});

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
  const [activeTab, setActiveTab] = useState("round");
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [eventSummaries, setEventSummaries] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [previousOutstanding, setPreviousOutstanding] = useState({ count: 0, total: 0 });
  const [adminContexts, setAdminContexts] = useState([]);
  const selectedClubIdRef = useRef(null);
  const selectedEventIdRef = useRef(null);

  async function refresh(silent = false, options = {}) {
    if (!silent) setLoading(true);
    setError("");
    try {
      const nextContexts = await getAdminContexts(session.user.id);
      const requestedClubId = options.clubId || selectedClubIdRef.current;
      const nextContext = nextContexts.find((entry) => entry.club_id === requestedClubId)
        || nextContexts.find((entry) => !entry.clubs.is_test)
        || nextContexts[0]
        || null;
      setAdminContexts(nextContexts);
      selectedClubIdRef.current = nextContext?.club_id || null;
      setContext(nextContext);
      if (!nextContext) {
        setDashboard(null);
        setEventSummaries([]);
        setSelectedEventId(null);
        selectedEventIdRef.current = null;
        setPreviousOutstanding({ count: 0, total: 0 });
        return;
      }
      const nextEvents = await listClubEvents(nextContext.club_id);
      const requestedEventId = options.preferLatest ? null : (options.eventId || selectedEventIdRef.current);
      const targetEventId = nextEvents.some((event) => event.id === requestedEventId)
        ? requestedEventId
        : nextEvents[0]?.id || null;
      const nextDashboard = await loadDashboard(nextContext.club_id, targetEventId);
      const currentIndex = nextEvents.findIndex((event) => event.id === targetEventId);
      const previousEventIds = currentIndex >= 0
        ? nextEvents.slice(currentIndex + 1).filter((event) => event.status === "closed").map((event) => event.id)
        : [];
      const nextOutstanding = silent
        ? previousOutstanding
        : await calculatePreviousOutstanding(nextContext.club_id, previousEventIds);
      setEventSummaries(nextEvents);
      setSelectedEventId(targetEventId);
      selectedEventIdRef.current = targetEventId;
      setDashboard(nextDashboard);
      setPreviousOutstanding(nextOutstanding);
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

  async function mutate(action, successMessage, options = {}) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(successMessage);
      await refresh(false, { preferLatest: options.selectLatest });
      return true;
    } catch (nextError) {
      setError(nextError.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function switchTestMode() {
    const productionContext = adminContexts.find((entry) => !entry.clubs.is_test);
    if (context?.clubs.is_test) {
      if (productionContext) {
        setActiveTab("round");
        await refresh(false, { clubId: productionContext.club_id });
        setNotice("กลับสู่ข้อมูลจริงแล้ว");
      }
      return;
    }
    const existingTestContext = adminContexts.find((entry) => entry.clubs.is_test);
    if (existingTestContext) {
      setActiveTab("round");
      await refresh(false, { clubId: existingTestContext.club_id });
      setNotice("เข้าสู่โหมดทดลองแล้ว ข้อมูลในนี้ไม่กระทบรอบจริง");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const testClub = await createTestClub({ ownerId: session.user.id });
      setActiveTab("round");
      await refresh(false, { clubId: testClub.id });
      setNotice("สร้างโหมดทดลองแล้ว ข้อมูลในนี้ไม่กระทบรอบจริง");
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setSaving(false);
    }
  }

  async function resetDemo() {
    if (!context?.clubs.is_test) return;
    if (!window.confirm("ล้างรอบ ผู้เล่น และค่าใช้จ่ายทั้งหมดในโหมดทดลอง? ข้อมูลจริงจะไม่ถูกแตะต้อง")) return;
    await mutate(() => resetTestClub(context.club_id), "รีเซ็ตข้อมูลทดลองแล้ว");
    setActiveTab("round");
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
            <p className="badminton-kicker">หลังบ้าน</p>
            <h1>จัดการรอบแบด</h1>
            <p>{context.clubs.name}</p>
          </div>
          <div className="badminton-header-actions">
            <button aria-label="รีเฟรชข้อมูล" className="badminton-icon-button" onClick={() => refresh()} type="button">
              <RefreshCw size={18} />
            </button>
            <button aria-label="เปลี่ยนรหัสเข้าเว็บ" className="badminton-icon-button" onClick={() => setPasswordModalOpen(true)} title="เปลี่ยนรหัสเข้าเว็บ" type="button">
              <ShieldCheck size={18} />
            </button>
            <button aria-label={context.clubs.is_test ? "กลับข้อมูลจริง" : "เข้าโหมดทดลอง"} className={`badminton-icon-button ${context.clubs.is_test ? "is-test-mode" : ""}`} onClick={switchTestMode} title={context.clubs.is_test ? "กลับข้อมูลจริง" : "เข้าโหมดทดลอง"} type="button">
              <FlaskConical size={18} />
            </button>
            <button className="badminton-secondary" onClick={() => supabase.auth.signOut()} type="button">
              <LogOut size={17} /> ออกจากระบบ
            </button>
          </div>
        </header>

        {notice ? <div className="badminton-alert is-success"><span>{notice}</span><button aria-label="ปิดข้อความแจ้งเตือน" onClick={() => setNotice("")} type="button"><X size={17} /></button></div> : null}
        {error ? <div className="badminton-alert is-error"><span>{error}</span><button aria-label="ปิดข้อความผิดพลาด" onClick={() => setError("")} type="button"><X size={17} /></button></div> : null}
        {context.clubs.is_test ? <div className="badminton-test-banner"><div><FlaskConical size={18} /><span><strong>โหมดทดลอง</strong> ข้อมูลนี้แยกจากรอบจริงและจะไม่ส่งเข้า LINE</span></div><button onClick={resetDemo} type="button">รีเซ็ตข้อมูลทดลอง</button></div> : null}

        {!dashboard.event ? (
          <CreateEventCard context={context} mutate={mutate} session={session} venues={dashboard.venues || []} />
        ) : (
          <>
            <RoundSwitcher
              events={eventSummaries}
              onChange={(eventId) => refresh(false, { eventId })}
              selectedEventId={selectedEventId}
            />
            <nav aria-label="เมนูหลังบ้าน" className="badminton-tabs">
              {ADMIN_TABS.map(({ id, label, icon: Icon }) => (
                <button className={activeTab === id ? "is-active" : ""} key={id} onClick={() => setActiveTab(id)} type="button"><Icon size={18} /><span>{label}</span></button>
              ))}
            </nav>

            {activeTab === "round" ? <>
              <EventControlCard
                clubName={context.clubs.name}
                courts={dashboard.courts}
                event={dashboard.event}
                isTestMode={context.clubs.is_test}
                key={dashboard.event.id}
                mappedEvent={appEvent}
                mutate={mutate}
                session={session}
                settlement={settlement}
                venues={dashboard.venues || []}
              />
              {dashboard.event.status === "closed" && eventSummaries[0]?.id === dashboard.event.id
                ? <CreateEventCard compact context={context} defaultVenue={dashboard.event.venue} mutate={mutate} session={session} venues={dashboard.venues || []} />
                : null}
            </> : null}

            {activeTab === "players" ? (
              <ParticipantsPanel
                context={context}
                dashboard={dashboard}
                event={appEvent}
                mutate={mutate}
                session={session}
                settlement={settlement}
              />
            ) : null}

            {activeTab === "costs" ? <PricingPanel event={appEvent} mutate={mutate} session={session} /> : null}
            {activeTab === "payments" ? <SettlementPanel event={appEvent} mutate={mutate} previousOutstanding={previousOutstanding} session={session} settlement={settlement} /> : null}
            {activeTab === "history" ? <AuditPanel actions={appEvent.actions} /> : null}
          </>
        )}
        {passwordModalOpen ? (
          <AdminPasswordModal
            onClose={() => setPasswordModalOpen(false)}
            onSave={(password) => mutate(() => changeAdminPassword(password), "เปลี่ยนรหัสเข้าเว็บแล้ว")}
            saving={saving}
          />
        ) : null}
        {saving ? <div className="badminton-saving">กำลังบันทึก...</div> : null}
      </section>
    </main>
  );
}

function AdminPasswordModal({ onClose, onSave, saving }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [localError, setLocalError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setLocalError("");
    if (password !== confirmation) {
      setLocalError("รหัสทั้งสองช่องไม่ตรงกัน");
      return;
    }
    const saved = await onSave(password);
    if (saved) onClose();
  }

  return (
    <div className="badminton-modal-backdrop" role="presentation">
      <form className="badminton-custom-charge-modal badminton-password-modal" onSubmit={submit}>
        <div className="badminton-modal-title">
          <div><p className="badminton-kicker">ความปลอดภัย</p><h2>เปลี่ยนรหัสเข้าเว็บ</h2></div>
          <button aria-label="ปิด" onClick={onClose} type="button"><X size={18} /></button>
        </div>
        <label>รหัสใหม่<input autoComplete="new-password" minLength="6" maxLength="72" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
        <label>ยืนยันรหัสใหม่<input autoComplete="new-password" minLength="6" maxLength="72" onChange={(event) => setConfirmation(event.target.value)} required type="password" value={confirmation} /></label>
        {localError ? <p className="badminton-form-message is-error">{localError}</p> : null}
        <button className="badminton-primary" disabled={saving} type="submit"><Save size={17} /> {saving ? "กำลังเปลี่ยน..." : "บันทึกรหัสใหม่"}</button>
      </form>
    </div>
  );
}

function RoundSwitcher({ events, onChange, selectedEventId }) {
  return (
    <section className="badminton-round-switcher">
      <label>
        <span>กำลังดูรอบ</span>
        <select onChange={(event) => onChange(event.target.value)} value={selectedEventId || ""}>
          {events.map((event, index) => (
            <option key={event.id} value={event.id}>
              {index === 0 ? "รอบล่าสุด · " : ""}{formatRoundOption(event.event_date)} · {EVENT_STATUS_LABELS[event.status] || event.status}
            </option>
          ))}
        </select>
      </label>
      <small>เปลี่ยนรอบเพื่อดูรายชื่อ ค่าใช้จ่าย และรับเงินของรอบเก่า</small>
    </section>
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

function CreateEventCard({ compact = false, context, defaultVenue = "", session, mutate, venues = [] }) {
  const initial = createInitialEvent();
  const [expanded, setExpanded] = useState(!compact);
  const [form, setForm] = useState({
    eventDate: initial.date,
    venue: defaultVenue || venues[0]?.name || "คอร์ทแบดเขาน้อย (คอร์ทใหม่)",
    courtNumber: "7",
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
        courtName: `คอร์ท ${form.courtNumber.trim()}`,
      });
      await recordAudit({
        clubId: context.club_id,
        eventId: created.id,
        userId: session.user.id,
        action: "สร้างรอบใหม่",
      });
    }, "สร้างรอบใหม่แล้ว", { selectLatest: true });
  }

  if (!expanded) {
    return (
      <button className="badminton-create-next-button" onClick={() => setExpanded(true)} type="button">
        <Plus size={18} /> เตรียมรอบถัดไป
      </button>
    );
  }

  return (
    <section className={`badminton-card ${compact ? "badminton-compact-create" : ""}`}>
      <div className="badminton-card-title">
        <CalendarDays size={20} />
        <div><h2>{compact ? "เตรียมรอบถัดไป" : "เริ่มรอบแรก"}</h2><p>ระบุข้อมูลให้ครบก่อนเปิดลงชื่อใน LINE</p></div>
        {compact ? <button aria-label="ยกเลิกเตรียมรอบ" className="badminton-collapse-create" onClick={() => setExpanded(false)} type="button"><X size={17} /></button> : null}
      </div>
      <form className="badminton-event-form" onSubmit={submit}>
        <label>วันที่<input onChange={(event) => set("eventDate", event.target.value)} required type="date" value={form.eventDate} /></label>
        <label>สถานที่<input list="saved-venues" onChange={(event) => set("venue", event.target.value)} required value={form.venue} /></label>
        <datalist id="saved-venues">{venues.map((venue) => <option key={venue.id} value={venue.name} />)}</datalist>
        <label>เลขคอร์ท<input inputMode="numeric" onChange={(event) => set("courtNumber", event.target.value)} placeholder="7" required value={form.courtNumber} /></label>
        <label>เริ่ม<HalfHourSelect ariaLabel="เวลาเริ่มรอบ" onChange={(value) => set("startsAt", value)} value={form.startsAt} /></label>
        <label>จบ<HalfHourSelect ariaLabel="เวลาจบรอบ" onChange={(value) => set("endsAt", value)} value={form.endsAt} /></label>
        <button className="badminton-primary" type="submit"><Plus size={17} /> สร้างรอบ</button>
      </form>
    </section>
  );
}

function EventControlCard({ clubName, courts, event, isTestMode, mappedEvent, mutate, session, settlement, venues = [] }) {
  const [form, setForm] = useState({
    event_date: event.event_date,
    venue: event.venue,
  });
  const [editingDetails, setEditingDetails] = useState(event.status === "draft");
  const [newCourt, setNewCourt] = useState({ courtNumber: "", startsAt: event.starts_at.slice(0, 5), endsAt: event.ends_at.slice(0, 5) });

  async function addNewCourt(submitEvent) {
    submitEvent.preventDefault();
    await mutate(() => addCourt({
      clubId: event.club_id,
      eventId: event.id,
      ...newCourt,
      courtName: `คอร์ท ${newCourt.courtNumber.trim()}`,
    }), "เพิ่มคอร์ทแล้ว");
    setNewCourt({ courtNumber: "", startsAt: event.starts_at.slice(0, 5), endsAt: event.ends_at.slice(0, 5) });
  }

  function advanceRound() {
    if (event.status === "draft") {
      if (!courts.length) {
        return mutate(async () => {
          throw new Error("กรุณาเพิ่มคอร์ทอย่างน้อย 1 คอร์ทก่อนเปิดลงชื่อ");
        }, "");
      }
      if (isTestMode) {
        return mutate(async () => {
          await updateEvent(event.id, { status: "open" });
          await recordAudit({
            clubId: mappedEvent.clubId,
            eventId: event.id,
            userId: session.user.id,
            action: "เปิดลงชื่อในโหมดทดลอง",
          });
        }, "เปิดลงชื่อทดลองแล้ว โดยไม่ได้ส่งเข้า LINE");
      }
      if (event.line_publish_ready) return null;
      return mutate(
        () => prepareEventForLine(event.id),
        "เตรียมรอบแล้ว กรุณาพิมพ์ “เปิดลงชื่อ” ในกลุ่ม LINE",
      );
    }
    if (event.status === "open") {
      return mutate(async () => {
        await finishEvent({
          clubId: mappedEvent.clubId,
          eventId: event.id,
          rows: settlement.rows,
          shuttlecockCount: mappedEvent.shuttlecockCount,
          userId: session.user.id,
        });
        await recordAudit({
          clubId: mappedEvent.clubId,
          eventId: event.id,
          userId: session.user.id,
          action: "จบรอบและบันทึกยอดที่ต้องชำระ",
        });
      }, "จบรอบแล้ว ยอดของผู้เล่นทุกคนถูกเก็บไว้");
    }
    return null;
  }

  const paymentComplete = settlement.rows.length > 0 && settlement.rows.every((row) => row.paid);
  const statusLabel = event.status === "draft" && event.line_publish_ready
    ? "รอคำสั่ง LINE"
    : event.status === "closed"
    ? (paymentComplete ? "ชำระครบแล้ว" : "รอชำระครบ")
    : EVENT_STATUS_LABELS[event.status];

  return (
    <section className={`badminton-event badminton-card ${event.status === "open" ? "is-open-compact" : ""}`}>
      <div className="badminton-event-main">
        <div className="badminton-event-title">
          <CalendarDays size={22} />
          <div><h2>{clubName} : วันที่ {formatThaiLongDate(event.event_date)}</h2><p>สถานที่ : {event.venue}</p></div>
        </div>
        <div className="badminton-event-actions">
          <span className={`badminton-status-pill is-${event.status} ${paymentComplete ? "is-settled" : ""}`}>{statusLabel}</span>
          {event.status !== "closed" ? <button className="badminton-secondary badminton-compact-action" onClick={() => setEditingDetails((value) => !value)} type="button">{editingDetails ? "ซ่อนตั้งค่า" : "แก้วันที่/สถานที่"}</button> : null}
          {event.status !== "closed" ? <button className="badminton-primary badminton-round-action" disabled={event.status === "draft" && event.line_publish_ready} onClick={advanceRound} type="button">{event.status === "draft" ? (event.line_publish_ready ? "รอพิมพ์ใน LINE" : isTestMode ? "เปิดลงชื่อทดลอง" : "เตรียมเปิดลงชื่อ") : "จบรอบ"}</button> : null}
        </div>
      </div>
      {event.status === "draft" && event.line_publish_ready ? <div className="badminton-line-command-ready"><strong>ขั้นตอนสุดท้าย</strong><span>ไปที่กลุ่ม LINE แล้วพิมพ์ <b>เปิดลงชื่อ</b> บอทจะตอบการ์ดโดยไม่หักโควตา</span></div> : null}
      {editingDetails ? <div className="badminton-event-form badminton-event-main-form">
        <label>วันที่<input type="date" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} /></label>
        <label>สถานที่<input list="round-saved-venues" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} /></label>
        <datalist id="round-saved-venues">{venues.map((venue) => <option key={venue.id} value={venue.name} />)}</datalist>
        <button className="badminton-secondary" onClick={() => mutate(() => updateEventDetails({ clubId: event.club_id, eventId: event.id, patch: form }), "บันทึกรายละเอียดรอบแล้ว")} type="button"><Save size={17} /> บันทึก</button>
      </div> : null}
      {event.status === "closed" ? (
        <div className="badminton-closed-courts">
          {courts.map((court) => <span key={court.id}><strong>{court.court_name}</strong> : {court.starts_at.slice(0, 5)}–{court.ends_at.slice(0, 5) === "00:00" ? "24:00" : court.ends_at.slice(0, 5)}</span>)}
        </div>
      ) : (
        <div className="badminton-courts-editor">
          <div className="badminton-courts-heading"><strong>คอร์ทที่จอง</strong></div>
          {courts.map((court) => <CourtEditor key={court.id} court={court} eventId={event.id} mutate={mutate} />)}
          <form className="badminton-court-row is-new" onSubmit={addNewCourt}>
            <div className="badminton-court-number-input"><span>คอร์ท</span><input aria-label="เลขคอร์ทใหม่" inputMode="numeric" placeholder="เลข" required value={newCourt.courtNumber} onChange={(e) => setNewCourt({ ...newCourt, courtNumber: e.target.value })} /></div>
            <HalfHourSelect ariaLabel="เวลาเริ่มคอร์ทใหม่" onChange={(value) => setNewCourt({ ...newCourt, startsAt: value })} value={newCourt.startsAt} />
            <HalfHourSelect ariaLabel="เวลาจบคอร์ทใหม่" onChange={(value) => setNewCourt({ ...newCourt, endsAt: value })} value={newCourt.endsAt} />
            <button aria-label="เพิ่มคอร์ท" className="badminton-secondary badminton-court-add" type="submit"><Plus size={16} /><span>เพิ่ม</span></button>
          </form>
        </div>
      )}
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
      <HalfHourSelect ariaLabel={`เวลาเริ่ม ${court.court_name}`} onChange={(value) => setForm({ ...form, starts_at: value })} value={form.starts_at} />
      <HalfHourSelect ariaLabel={`เวลาจบ ${court.court_name}`} onChange={(value) => setForm({ ...form, ends_at: value })} value={form.ends_at} />
      <button aria-label={`บันทึก ${court.court_name}`} className="badminton-icon-button" onClick={() => mutate(() => updateCourt(court.id, eventId, form), `บันทึก ${form.court_name} แล้ว`)} type="button"><Save size={16} /></button>
      <button aria-label={`ลบ ${court.court_name}`} className="badminton-delete-button" onClick={() => mutate(() => removeCourt(court.id, eventId), `ลบ ${court.court_name} แล้ว`)} type="button"><Trash2 size={16} /></button>
    </div>
  );
}

function HalfHourSelect({ ariaLabel, onChange, value }) {
  return <select aria-label={ariaLabel} onChange={(event) => onChange(event.target.value)} value={value}>{HALF_HOUR_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}</select>;
}

function ParticipantsPanel({ context, dashboard, event, mutate, session, settlement }) {
  const [name, setName] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [newItem, setNewItem] = useState({ name: "", price: "" });
  const [customChargeFor, setCustomChargeFor] = useState(null);
  const [customCharge, setCustomCharge] = useState({ name: "", price: "" });
  const [editingMember, setEditingMember] = useState(null);
  const [memberEdit, setMemberEdit] = useState({ nickname: "", displayName: "" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sortMode, setSortMode] = useState("signup");
  const participants = event.signups
    .filter((signup) => signup.status === "coming")
    .map((signup) => ({
      ...signup,
      member: dashboard.members.find((member) => member.id === signup.memberId),
      attendance: event.attendance.find((row) => row.memberId === signup.memberId),
    }))
    .filter((row) => row.member);
  const sortedParticipants = [...participants].sort((a, b) => {
    if (sortMode === "alphabetical") return memberName(a.member).localeCompare(memberName(b.member), "th");
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
  const timeOptions = useMemo(() => buildTimeOptions(event.startTime, event.endTime), [event.startTime, event.endTime]);
  const settlementByMember = new Map(settlement.rows.map((row) => [row.memberId, row]));
  const participantIds = new Set(participants.map((participant) => participant.member.id));
  const savedMembers = dashboard.members.filter((member) => member.role !== "admin");
  const memberSuggestions = rankMemberSuggestions(
    savedMembers,
    name,
  ).slice(0, 8);

  async function addMember(eventObject) {
    eventObject.preventDefault();
    const trimmedName = name.trim();
    const normalizedName = normalizeMemberSearch(trimmedName);
    const exactMember = dashboard.members.find((member) =>
      member.role !== "admin"
      && normalizedName
      && [member.nickname, member.display_name].some((value) => normalizeMemberSearch(value) === normalizedName));
    const existingMember = dashboard.members.find((member) => member.id === selectedMemberId) || exactMember;
    const saved = await mutate(async () => {
      if (!trimmedName) throw new Error("กรุณาพิมพ์ชื่อเล่นหรือชื่อ LINE");
      const member = existingMember || await addLineMember({ clubId: context.club_id, displayName: trimmedName });
      await updateSignup({ clubId: context.club_id, eventId: event.id, memberId: member.id, status: "coming", arrivalTime: event.startTime });
      await recordAudit({
        clubId: context.club_id,
        eventId: event.id,
        userId: session.user.id,
        action: `${existingMember ? "เพิ่มผู้เล่นเดิม" : "สร้างและเพิ่มผู้เล่น"} ${memberName(member) || trimmedName}`,
      });
    }, existingMember ? `เพิ่ม ${memberName(existingMember)} จากประวัติเดิมแล้ว` : "สร้างผู้เล่นใหม่และเพิ่มเข้ารอบแล้ว");
    if (saved) {
      setName("");
      setSelectedMemberId(null);
      setSuggestionsOpen(false);
    }
  }

  async function addCatalogItem(submitEvent) {
    submitEvent.preventDefault();
    await mutate(() => addExtraCatalogItem({ clubId: context.club_id, name: newItem.name, price: newItem.price }), "เพิ่มสินค้าแล้ว");
    setNewItem({ name: "", price: "" });
  }

  function openMemberEditor(member) {
    setEditingMember(member);
    setMemberEdit({
      nickname: member.nickname || member.display_name || "",
      displayName: member.display_name || member.nickname || "",
    });
  }

  async function saveMember(submitEvent) {
    submitEvent.preventDefault();
    const nickname = memberEdit.nickname.trim();
    const displayName = memberEdit.displayName.trim();
    const saved = await mutate(async () => {
      if (!nickname) throw new Error("กรุณากรอกชื่อเล่น");
      if (!displayName) throw new Error("กรุณากรอกชื่อ LINE");
      await updateClubMember(editingMember.id, { nickname, displayName });
      await recordAudit({
        clubId: context.club_id,
        eventId: event.id,
        userId: session.user.id,
        action: `แก้ไขชื่อผู้เล่น ${nickname}`,
        details: { member_id: editingMember.id },
      });
    }, `บันทึกชื่อ ${nickname} แล้ว`);
    if (saved) setEditingMember(null);
  }

  async function addCustomCharge(submitEvent) {
    submitEvent.preventDefault();
    const target = customChargeFor;
    if (!target) return;
    await mutate(() => addMemberExtraCharge({
      clubId: event.clubId,
      eventId: event.id,
      memberId: target.memberId,
      item: { name: customCharge.name.trim(), price: Number(customCharge.price) },
      userId: session.user.id,
    }), `เพิ่ม ${customCharge.name.trim()} ให้ ${target.name} แล้ว`);
    setCustomChargeFor(null);
    setCustomCharge({ name: "", price: "" });
  }

  function chooseExtra(itemId, memberId, participantName) {
    if (!itemId) return;
    if (itemId === "custom") {
      setCustomChargeFor({ memberId, name: participantName });
      setCustomCharge({ name: "", price: "" });
      return;
    }
    const item = (dashboard.extraItems || []).find((entry) => entry.id === itemId);
    if (!item) return;
    mutate(() => addMemberExtraCharge({
      clubId: event.clubId,
      eventId: event.id,
      memberId,
      item: { name: item.name, price: Number(item.price) },
      userId: session.user.id,
    }), `เพิ่ม ${item.name} ให้ ${participantName} แล้ว`);
  }

  return (
    <section className="badminton-card badminton-participants-card">
      <div className="badminton-card-title badminton-player-card-title"><Users size={20} /><div><h2>ผู้เล่น</h2><p>{participants.length} คน</p></div><div className="badminton-player-title-actions"><label className="badminton-player-sort-icon" title={sortMode === "signup" ? "เรียงตามลำดับการลงชื่อ" : "เรียงตามตัวอักษร"}><ArrowUpDown size={18} /><select aria-label="เรียงลำดับผู้เล่น" onChange={(changeEvent) => setSortMode(changeEvent.target.value)} value={sortMode}><option value="signup">ลำดับการลงชื่อ</option><option value="alphabetical">ตามตัวอักษร</option></select></label><button aria-label="ตั้งค่ารายชื่อและสินค้า" className="badminton-player-settings-button" onClick={() => setSettingsOpen(true)} title="ตั้งค่ารายชื่อและสินค้า" type="button"><Settings size={18} /></button></div></div>
      <form className="badminton-inline-form" onSubmit={addMember}>
        <div className="badminton-member-search">
          <input
            aria-autocomplete="list"
            aria-controls="member-suggestions"
            aria-expanded={suggestionsOpen}
            aria-label="ค้นหาชื่อเล่นหรือชื่อ LINE"
            autoComplete="off"
            onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 120)}
            onChange={(changeEvent) => {
              setName(changeEvent.target.value);
              setSelectedMemberId(null);
              setSuggestionsOpen(true);
            }}
            onFocus={() => setSuggestionsOpen(true)}
            placeholder="ค้นหาชื่อเล่นหรือชื่อ LINE"
            required
            value={name}
          />
          {suggestionsOpen && memberSuggestions.length ? (
            <div className="badminton-member-suggestions" id="member-suggestions" role="listbox">
              {memberSuggestions.map((member) => {
                const displayName = memberName(member);
                const lineName = member.display_name && member.display_name !== displayName ? member.display_name : "";
                const inRound = participantIds.has(member.id);
                return (
                  <button
                    aria-selected={selectedMemberId === member.id}
                    className={selectedMemberId === member.id ? "is-selected" : ""}
                    key={member.id}
                    onMouseDown={(mouseEvent) => mouseEvent.preventDefault()}
                    onClick={() => {
                      setName(displayName);
                      setSelectedMemberId(member.id);
                      setSuggestionsOpen(false);
                    }}
                    role="option"
                    type="button"
                  >
                    <span><strong>{displayName}</strong>{lineName ? <small>LINE: {lineName}</small> : null}</span>
                    <em>{inRound ? "อยู่ในรอบแล้ว" : "ใช้ประวัติเดิม"}</em>
                  </button>
                );
              })}
            </div>
          ) : null}
          {selectedMemberId ? <small className="badminton-selected-member-note">เลือกคนเดิมแล้ว ประวัติและยอดค้างจะต่อเนื่อง</small> : null}
          {!selectedMemberId ? <small className="badminton-member-search-hint">{context.clubs.is_test ? "รายชื่อทดลอง" : "ผู้เล่นเดิมที่บันทึกไว้"} {savedMembers.length} คน · แตะช่องหรือพิมพ์เพื่อค้นหา</small> : null}
        </div>
        <button className="badminton-primary badminton-add-player" type="submit"><UserPlus size={17} /> {selectedMemberId ? "เพิ่มคนเดิม" : "เพิ่มคน"}</button>
      </form>

      <div className="badminton-attendance-list">
        {sortedParticipants.length ? sortedParticipants.map(({ member, attendance: row, arrivalTime }, playerIndex) => {
          const participantName = memberName(member);
          const plannedArrival = arrivalTime || event.startTime;
          const leftAt = row?.leftAt || "";
          const playedMinutes = playedMinutesWithinEvent(event.startTime, event.endTime, plannedArrival, leftAt);
          const charges = (dashboard.memberExtras || []).filter((charge) => charge.member_id === member.id);
          const extraTotal = charges.reduce((sum, charge) => sum + Number(charge.unit_price) * Number(charge.quantity), 0);
          const settlementRow = settlementByMember.get(member.id);
          const due = settlementRow?.roundedDue || 0;
          const isPaid = Boolean(settlementRow?.paid);
          const lineName = member.nickname && member.nickname !== member.display_name ? member.display_name : "";

          function updateArrival(nextArrival) {
            const weight = attendanceWeight(event.startTime, event.endTime, nextArrival, leftAt);
            return mutate(async () => {
              await updateSignupArrival({ eventId: event.id, memberId: member.id, arrivalTime: nextArrival });
              await updateAttendance({ clubId: event.clubId, eventId: event.id, memberId: member.id, patch: { arrived: true, arrived_at: nextArrival, weight } });
            }, `ปรับเวลามาของ ${participantName} แล้ว`);
          }

          function updateDeparture(nextDeparture) {
            const weight = attendanceWeight(event.startTime, event.endTime, plannedArrival, nextDeparture);
            return mutate(() => updateAttendance({ clubId: event.clubId, eventId: event.id, memberId: member.id, patch: { arrived: true, arrived_at: plannedArrival, left_at: nextDeparture || null, weight } }), `ปรับเวลากลับของ ${participantName} แล้ว`);
          }

          return (
            <article className="badminton-attendance-row" key={member.id}>
              <div className="badminton-player-identity"><b className="badminton-player-index">{playerIndex + 1}.</b><strong>{participantName}</strong>{lineName ? <span title={`LINE: ${lineName}`}>LINE: {lineName}</span> : null}<button aria-label={`แก้ไขชื่อ ${participantName}`} className="badminton-member-edit-button" onClick={() => openMemberEditor(member)} type="button"><Pencil size={13} /></button><em>{formatPlayedDuration(playedMinutes)} · ≈ {baht(due)} บาท</em></div>
              <div className="badminton-player-controls">
                <label><span>มา</span><select aria-label={`เวลามา ${participantName}`} value={plannedArrival} onChange={(changeEvent) => updateArrival(changeEvent.target.value)}>{timeOptions.slice(0, -1).map((time) => <option key={time} value={time}>{time}</option>)}</select></label>
                <label><span>กลับ</span><select aria-label={`เวลากลับ ${participantName}`} value={leftAt} onChange={(changeEvent) => updateDeparture(changeEvent.target.value)}><option value="">อยู่จนจบรอบ</option>{timeOptions.filter((time) => timePosition(time, event.startTime) > timePosition(plannedArrival, event.startTime)).map((time) => <option key={time} value={time}>{time}</option>)}</select></label>
                <label className="badminton-extra-select-wrap"><span>น้ำ/ขนม</span><select aria-label={`เพิ่มน้ำหรือขนมให้ ${participantName}`} disabled={isPaid} onChange={(changeEvent) => chooseExtra(changeEvent.target.value, member.id, participantName)} title={isPaid ? "ยกเลิกรับเงินก่อนแก้สินค้า" : "เลือกน้ำหรือขนม"} value=""><option value="">+ น้ำ/ขนม{extraTotal ? ` ${baht(extraTotal)}` : ""}</option>{(dashboard.extraItems || []).map((item) => <option key={item.id} value={item.id}>{item.name} · {baht(item.price)} บาท</option>)}<option value="custom">กรอกค่าใช้จ่ายเอง…</option></select></label>
                <button aria-label={`ลบ ${participantName}`} className="badminton-delete-button" onClick={() => mutate(() => removeParticipant({ eventId: event.id, memberId: member.id }), `ลบ ${participantName} ออกจากรอบแล้ว`)} type="button"><Trash2 size={17} /></button>
              </div>
              {charges.length ? <div className="badminton-member-charges">{charges.map((charge) => <span key={charge.id}>{charge.item_name} {baht(Number(charge.unit_price) * Number(charge.quantity))}{!isPaid ? <button aria-label={`ลบ ${charge.item_name}`} onClick={() => mutate(() => removeMemberExtraCharge(charge.id), `ลบ ${charge.item_name} แล้ว`)} type="button">×</button> : null}</span>)}</div> : null}
            </article>
          );
        }) : <div className="badminton-empty">ยังไม่มีผู้เล่น</div>}
      </div>
      {settingsOpen ? <div className="badminton-modal-backdrop" role="presentation"><div aria-label="ตั้งค่าผู้เล่น" aria-modal="true" className="badminton-custom-charge-modal badminton-player-settings-modal" role="dialog"><div className="badminton-modal-title"><div><p className="badminton-kicker">ตั้งค่าผู้เล่น</p><h2>รายชื่อและสินค้า</h2></div><button aria-label="ปิดการตั้งค่าผู้เล่น" onClick={() => setSettingsOpen(false)} type="button"><X size={19} /></button></div><section className="badminton-settings-section"><div className="badminton-settings-section-title"><Users size={17} /><strong>รายชื่อผู้เล่นเดิม</strong><em>{savedMembers.length} คน</em></div><div className="badminton-member-directory-list">{[...savedMembers].sort((left, right) => memberName(left).localeCompare(memberName(right), "th")).map((member) => { const nickname = memberName(member); const lineName = member.display_name && member.display_name !== nickname ? member.display_name : ""; return <button aria-label={`แก้ไขชื่อ ${nickname}`} key={member.id} onClick={() => openMemberEditor(member)} type="button"><span><strong>{nickname}</strong>{lineName ? <small>LINE: {lineName}</small> : null}</span><Pencil size={15} /></button>; })}</div></section><section className="badminton-settings-section"><div className="badminton-settings-section-title"><PackagePlus size={17} /><strong>รายการสินค้า น้ำ-ขนม</strong></div><div className="badminton-catalog-list">{(dashboard.extraItems || []).map((item) => <div className="badminton-catalog-item" key={item.id}><span>{item.name}</span><input aria-label={`ราคา ${item.name}`} defaultValue={item.price} min="0" onBlur={(changeEvent) => mutate(() => updateExtraCatalogItem(item.id, changeEvent.target.value), `แก้ราคา ${item.name} แล้ว`)} type="number" /><em>บาท</em><button aria-label={`ลบสินค้า ${item.name}`} className="badminton-catalog-delete" onClick={() => { if (window.confirm(`ลบ ${item.name} ออกจากรายการสินค้า?`)) mutate(() => removeExtraCatalogItem(item.id), `ลบ ${item.name} แล้ว`); }} type="button"><Trash2 size={15} /></button></div>)}</div><form className="badminton-catalog-add" onSubmit={addCatalogItem}><input aria-label="ชื่อรายการใหม่" placeholder="ชื่อรายการ" required value={newItem.name} onChange={(changeEvent) => setNewItem({ ...newItem, name: changeEvent.target.value })} /><input aria-label="ราคารายการใหม่" min="0" placeholder="ราคา" required type="number" value={newItem.price} onChange={(changeEvent) => setNewItem({ ...newItem, price: changeEvent.target.value })} /><button className="badminton-secondary" type="submit"><Plus size={15} /> เพิ่ม</button></form></section></div></div> : null}
      {editingMember ? <div className="badminton-modal-backdrop" role="presentation"><form className="badminton-custom-charge-modal badminton-member-edit-modal" onSubmit={saveMember}><div className="badminton-modal-title"><div><p className="badminton-kicker">ข้อมูลสมาชิกเดิม</p><h2>แก้ไขรายชื่อ</h2></div><button aria-label="ปิดหน้าต่างแก้ไขชื่อ" onClick={() => setEditingMember(null)} type="button"><X size={19} /></button></div><label>ชื่อเล่น<input autoFocus maxLength="40" onChange={(changeEvent) => setMemberEdit({ ...memberEdit, nickname: changeEvent.target.value })} required value={memberEdit.nickname} /></label><label>ชื่อ LINE<input maxLength="80" onChange={(changeEvent) => setMemberEdit({ ...memberEdit, displayName: changeEvent.target.value })} required value={memberEdit.displayName} /></label>{editingMember.line_user_id ? <p className="badminton-member-sync-note">คนนี้เชื่อมกับ LINE แล้ว หากเปลี่ยนชื่อ LINE ระบบจะอัปเดตชื่อใหม่อัตโนมัติเมื่อสมาชิกเข้าหน้าลงชื่อครั้งถัดไป โดยประวัติและยอดค้างยังเป็นคนเดิม</p> : <p className="badminton-member-sync-note">สมาชิกที่เพิ่มเองยังไม่เชื่อมกับบัญชี LINE การแก้ชื่อตรงนี้จะไม่กระทบประวัติและยอดค้างเดิม</p>}<button className="badminton-primary" type="submit"><Save size={17} /> บันทึกชื่อ</button></form></div> : null}
      {customChargeFor ? <div className="badminton-modal-backdrop" role="presentation"><form className="badminton-custom-charge-modal" onSubmit={addCustomCharge}><div className="badminton-modal-title"><div><p className="badminton-kicker">ค่าใช้จ่ายเฉพาะคน</p><h2>เพิ่มรายการให้ {customChargeFor.name}</h2></div><button aria-label="ปิดหน้าต่าง" onClick={() => setCustomChargeFor(null)} type="button"><X size={19} /></button></div><label>ชื่อรายการ<input autoFocus maxLength="80" onChange={(changeEvent) => setCustomCharge({ ...customCharge, name: changeEvent.target.value })} placeholder="เช่น ค่าเอ็นไม้" required value={customCharge.name} /></label><label>ราคา (บาท)<input min="0" onChange={(changeEvent) => setCustomCharge({ ...customCharge, price: changeEvent.target.value })} placeholder="0" required type="number" value={customCharge.price} /></label><button className="badminton-primary" type="submit"><Plus size={17} /> เพิ่มค่าใช้จ่าย</button></form></div> : null}
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
  const otherCost = event.extraCosts.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const sharedCost = courtCost + shuttleCost + otherCost;

  return (
    <section className="badminton-card badminton-pricing-card">
      <div className="badminton-card-title badminton-pricing-title"><Calculator size={20} /><div><h2>ค่าใช้จ่ายรวม</h2></div><strong>{baht(sharedCost)} บาท</strong></div>
      <div className="badminton-pricing-grid">
        <article className="badminton-price-box badminton-court-summary-box">
          <div className="badminton-price-head"><span>สรุปคอร์ท</span><strong>{baht(courtCost)} บาท</strong></div>
          <div className="badminton-court-summary-list">{event.courts.map((court) => <span key={court.id}><strong>{court.name}</strong> {court.startsAt}–{court.endsAt === "00:00" ? "24:00" : court.endsAt} · {formatPlayedDuration(minutesBetween(court.startsAt, court.endsAt))}</span>)}</div>
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

function SettlementPanel({ event, mutate, previousOutstanding, session, settlement }) {
  const [copied, setCopied] = useState(false);
  const lineSummary = useMemo(() => buildLineSummary(event), [event]);
  const paymentComplete = settlement.rows.length > 0 && settlement.rows.every((row) => row.paid);
  const combinedTotal = settlement.totalCost + previousOutstanding.total;
  async function copySummary() {
    await navigator.clipboard.writeText(lineSummary);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return (
    <section className="badminton-card badminton-settlement-card" id="settlement">
      <div className="badminton-card-title"><ReceiptText size={20} /><div><h2>สรุปยอด</h2></div></div>
      <div className={`badminton-settlement-overview ${paymentComplete ? "is-settled" : ""}`}>
        <div className="badminton-current-round-total"><span>ยอดรอบนี้</span><strong>{baht(settlement.totalCost)} บาท</strong></div>
        <div className="badminton-summary-line"><span>ยอดค้างจากรอบก่อน</span><strong>{baht(previousOutstanding.total)} บาท</strong></div>
        <div className="badminton-summary-grand-total"><span>รวมทั้งหมด</span><strong>{baht(combinedTotal)} บาท</strong></div>
        <div className="badminton-round-payment-status">
          <Check size={16} />
          <span>{paymentComplete ? "ชำระครบแล้ว" : "รอชำระครบ"}</span>
        </div>
      </div>
      <div className="badminton-card-title badminton-payment-list-title"><WalletCards size={19} /><div><h2>ค่าใช้จ่ายรายคน</h2></div></div>
      <div className="badminton-pay-list">
        {settlement.rows.map((row) => {
          const extraLabel = formatExtraItems(row.extraCharges);
          return <article className={`badminton-pay-row ${row.paid ? "is-paid" : ""}`} key={row.memberId}>
            <div className="badminton-pay-person"><strong>{row.name}</strong><span>{formatPlayedDuration(Number(row.hours) * 60)}</span>{extraLabel ? <details className="badminton-pay-extras"><summary>{extraLabel}</summary><div>{row.extraCharges.map((charge) => <span key={charge.id || `${charge.name}-${charge.unitPrice}`}>{charge.name} × {charge.quantity || 1} = {baht(Number(charge.unitPrice) * Number(charge.quantity || 1))} บาท</span>)}</div></details> : null}{row.paid && row.shuttlecockCountSnapshot !== null && row.shuttlecockCountSnapshot !== undefined ? <small>ปิดยอดตอนใช้ลูกแบด {row.shuttlecockCountSnapshot} ลูก</small> : null}</div>
            <strong className="badminton-pay-amount">{baht(row.roundedDue)} บาท</strong>
            <button className={row.paid ? "is-paid" : ""} onClick={() => mutate(() => setPayment({ clubId: event.clubId, eventId: event.id, memberId: row.memberId, amount: row.roundedDue, sharedAmount: row.sharedDue, extrasAmount: row.extraAmount, shuttlecockCount: event.shuttlecockCount, paid: !row.paid, userId: session.user.id }), row.paid ? "ยกเลิกสถานะรับเงินแล้ว" : `รับเงิน ${row.name} และล็อกยอดแล้ว`)} type="button"><Check size={16} /> {row.paid ? "จ่ายแล้ว" : "รับเงิน"}</button>
          </article>;
        })}
      </div>
      <textarea readOnly value={lineSummary} />
      <button className="badminton-primary" onClick={copySummary} type="button"><Copy size={18} /> {copied ? "คัดลอกแล้ว" : "คัดลอกสรุปส่ง LINE"}</button>
    </section>
  );
}

function AuditPanel({ actions }) {
  return (
    <section className="badminton-card badminton-audit">
      <div className="badminton-card-title"><BadgeCheck size={20} /><div><h2>ประวัติการทำรายการ</h2><p>กิจกรรมสำคัญของแอดมินและระบบ LINE</p></div></div>
      {actions.length ? <div className="badminton-audit-list">{actions.map((action) => <p key={action.id}><strong>{action.actorName}</strong> {action.action} <span>{action.at}</span></p>)}</div> : <p className="badminton-note">ยังไม่มีรายการ</p>}
    </section>
  );
}

async function calculatePreviousOutstanding(clubId, eventIds) {
  if (!eventIds.length) return { count: 0, total: 0 };
  const dashboards = await Promise.all(eventIds.map((eventId) => loadDashboard(clubId, eventId)));
  const unpaidRows = dashboards.flatMap((dashboard) => {
    if (!dashboard?.event) return [];
    const previousSettlement = calculateSettlement(mapDashboardToEvent(dashboard));
    return previousSettlement.rows.filter((row) => !row.paid);
  });
  return {
    count: unpaidRows.length,
    total: unpaidRows.reduce((sum, row) => sum + Number(row.roundedDue || 0), 0),
  };
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
  const billableSignups = dashboard.signups.filter((row) => row.status === "coming");
  const attendance = billableSignups.map((signup) => {
    const row = attendanceByMember.get(signup.member_id);
    const payment = paymentsByMember.get(signup.member_id);
    const arrivalTime = signup.arrival_time?.slice(0, 5) || startTime;
    const leftAt = row?.left_at?.slice(0, 5) || "";
    const playedMinutes = playedMinutesWithinEvent(startTime, endTime, arrivalTime, leftAt);
    const extraCharges = (dashboard.memberExtras || [])
      .filter((charge) => charge.member_id === signup.member_id)
      .map((charge) => ({ id: charge.id, name: charge.item_name, unitPrice: Number(charge.unit_price), quantity: Number(charge.quantity) }));
    return {
      memberId: signup.member_id,
      name: memberName(membersById.get(signup.member_id)) || "ไม่ทราบชื่อ",
      arrived: true,
      weight: attendanceWeight(startTime, endTime, arrivalTime, leftAt),
      hours: playedMinutes / 60,
      playedMinutes,
      arrivedAt: arrivalTime,
      leftAt,
      note: row?.note || "",
      extraCharges,
      paid: Boolean(payment?.paid_at),
      paidAmount: payment?.paid_at ? Number(payment.amount || 0) : null,
      lockedSharedAmount: payment?.paid_at && payment.shared_amount !== null && payment.shared_amount !== undefined ? Number(payment.shared_amount) : null,
      lockedExtraAmount: payment?.paid_at && payment.extras_amount !== null && payment.extras_amount !== undefined ? Number(payment.extras_amount) : null,
      shuttlecockCountSnapshot: payment?.paid_at ? payment.shuttlecock_count_snapshot : null,
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
    members: dashboard.members.map((member) => ({ id: member.id, name: memberName(member), lineName: member.display_name, nickname: member.nickname, role: member.role, lineUserId: member.line_user_id, active: member.active })),
    signups: dashboard.signups.map((row) => ({ memberId: row.member_id, status: row.status, arrivalTime: row.arrival_time?.slice(0, 5) || "", note: row.note, createdAt: row.created_at })),
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

function memberName(member) {
  return member?.nickname?.trim() || member?.display_name?.trim() || "";
}

function formatExtraItems(charges = []) {
  const grouped = new Map();
  charges.forEach((charge) => {
    const name = charge.name || "รายการอื่น";
    const current = grouped.get(name) || { quantity: 0, amount: 0 };
    current.quantity += Number(charge.quantity || 1);
    current.amount += Number(charge.unitPrice || 0) * Number(charge.quantity || 1);
    grouped.set(name, current);
  });
  return [...grouped.entries()].map(([name, value]) => `${name}${value.quantity > 1 ? `×${value.quantity}` : ""} ${baht(value.amount)}`).join(", ");
}

function buildTimeOptions(startTime, endTime) {
  const options = [];
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  let cursor = startHour * 60 + startMinute;
  let end = endHour * 60 + endMinute;
  if (end <= startHour * 60 + startMinute) end += 24 * 60;
  while (cursor <= end) {
    const normalized = cursor % (24 * 60);
    options.push(`${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`);
    cursor += 30;
  }
  return options;
}

function timePosition(time, eventStart) {
  const [hour, minute] = String(time || eventStart).split(":").map(Number);
  const [startHour, startMinute] = eventStart.split(":").map(Number);
  let value = hour * 60 + minute;
  const start = startHour * 60 + startMinute;
  if (value < start) value += 24 * 60;
  return value;
}

function attendanceWeight(startTime, endTime, arrivalTime, leftAt) {
  const total = minutesBetween(startTime, endTime);
  const played = playedMinutesWithinEvent(startTime, endTime, arrivalTime, leftAt);
  if (!total || !played) return 0.05;
  return Math.max(0.05, Math.min(1, Math.round((played / total) * 100) / 100));
}

function formatRoundOption(isoDate) {
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  }).format(new Date(`${isoDate}T12:00:00+07:00`));
}

function LoadingScreen({ label }) {
  return <main className="badminton-app badminton-auth-page"><div className="badminton-loading"><RefreshCw size={24} /><strong>{label}</strong></div></main>;
}

function ConfigError() {
  return <main className="badminton-app badminton-auth-page"><section className="badminton-auth-card"><h1>ยังไม่ได้ตั้งค่า Supabase</h1><p>เพิ่ม Project URL และ Publishable key ใน environment variables ก่อนเปิดใช้งานหลังบ้าน</p></section></main>;
}
