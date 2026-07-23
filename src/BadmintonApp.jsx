import React, { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  CalendarDays,
  Check,
  Copy,
  Calculator,
  History,
  LogIn,
  LogOut,
  PackagePlus,
  Plus,
  ReceiptText,
  RefreshCw,
  Save,
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
  getAdminContext,
  loadDashboard,
  recordAudit,
  publishEventToLine,
  removeCourt,
  removeExtraCatalogItem,
  removeMemberExtraCharge,
  removeParticipant,
  setPayment,
  updateAttendance,
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
import { isSupabaseConfigured, supabase } from "./supabase.js";

const EVENT_STATUS_LABELS = {
  draft: "แบบร่าง",
  open: "เปิดลงชื่อ",
  closed: "ปิดรอบแล้ว",
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
      return true;
    } catch (nextError) {
      setError(nextError.message);
      return false;
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
            <p className="badminton-kicker">หลังบ้าน</p>
            <h1>จัดการรอบแบด</h1>
            <p>{context.clubs.name}</p>
          </div>
          <div className="badminton-header-actions">
            <button aria-label="รีเฟรชข้อมูล" className="badminton-icon-button" onClick={refresh} type="button">
              <RefreshCw size={18} />
            </button>
            <button aria-label="เปลี่ยนรหัสเข้าเว็บ" className="badminton-icon-button" onClick={() => setPasswordModalOpen(true)} title="เปลี่ยนรหัสเข้าเว็บ" type="button">
              <ShieldCheck size={18} />
            </button>
            <button className="badminton-secondary" onClick={() => supabase.auth.signOut()} type="button">
              <LogOut size={17} /> ออกจากระบบ
            </button>
          </div>
        </header>

        {notice ? <div className="badminton-alert is-success"><span>{notice}</span><button aria-label="ปิดข้อความแจ้งเตือน" onClick={() => setNotice("")} type="button"><X size={17} /></button></div> : null}
        {error ? <div className="badminton-alert is-error"><span>{error}</span><button aria-label="ปิดข้อความผิดพลาด" onClick={() => setError("")} type="button"><X size={17} /></button></div> : null}

        {!dashboard.event ? (
          <CreateEventCard context={context} mutate={mutate} session={session} venues={dashboard.venues || []} />
        ) : (
          <>
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
                mutate={mutate}
                venues={dashboard.venues || []}
              />
              {dashboard.event.status === "closed" ? <CreateEventCard compact context={context} defaultVenue={dashboard.event.venue} mutate={mutate} session={session} venues={dashboard.venues || []} /> : null}
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
            {activeTab === "payments" ? <SettlementPanel event={appEvent} mutate={mutate} session={session} settlement={settlement} /> : null}
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

function EventControlCard({ clubName, courts, event, mutate, venues = [] }) {
  const [form, setForm] = useState({
    event_date: event.event_date,
    venue: event.venue,
  });
  const [editingDetails, setEditingDetails] = useState(event.status !== "open");
  const [newCourt, setNewCourt] = useState({ courtNumber: "", startsAt: event.starts_at.slice(0, 5), endsAt: event.ends_at.slice(0, 5) });
  const nextStatus = event.status === "open" ? "closed" : "open";

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
    <section className={`badminton-event badminton-card ${event.status === "open" ? "is-open-compact" : ""}`}>
      <div className="badminton-event-main">
        <div className="badminton-event-title">
          <CalendarDays size={22} />
          <div><h2>{clubName} : วันที่ {formatThaiLongDate(event.event_date)}</h2><p>สถานที่ : {event.venue}</p></div>
        </div>
        <div className="badminton-event-actions">
          <span className={`badminton-status-pill is-${event.status}`}>{EVENT_STATUS_LABELS[event.status]}</span>
          {event.status === "open" ? <button className="badminton-secondary badminton-compact-action" onClick={() => setEditingDetails((value) => !value)} type="button">{editingDetails ? "ซ่อนตั้งค่า" : "แก้วันที่/สถานที่"}</button> : null}
          <button className="badminton-primary badminton-round-action" onClick={toggleSignup} type="button">{nextStatus === "open" ? "เปิดลงชื่อ" : "ปิดรอบ"}</button>
        </div>
      </div>
      {editingDetails ? <div className="badminton-event-form badminton-event-main-form">
        <label>วันที่<input type="date" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} /></label>
        <label>สถานที่<input list="round-saved-venues" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} /></label>
        <datalist id="round-saved-venues">{venues.map((venue) => <option key={venue.id} value={venue.name} />)}</datalist>
        <button className="badminton-secondary" onClick={() => mutate(() => updateEventDetails({ clubId: event.club_id, eventId: event.id, patch: form }), "บันทึกรายละเอียดรอบแล้ว")} type="button"><Save size={17} /> บันทึก</button>
      </div> : null}
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
  const [newItem, setNewItem] = useState({ name: "", price: "" });
  const [customChargeFor, setCustomChargeFor] = useState(null);
  const [customCharge, setCustomCharge] = useState({ name: "", price: "" });
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

  async function addMember(eventObject) {
    eventObject.preventDefault();
    await mutate(async () => {
      const member = await addLineMember({ clubId: context.club_id, displayName: name });
      await updateSignup({ clubId: context.club_id, eventId: event.id, memberId: member.id, status: "coming", arrivalTime: event.startTime });
      await recordAudit({ clubId: context.club_id, eventId: event.id, userId: session.user.id, action: `เพิ่มผู้เล่น ${name}` });
      setName("");
    }, "เพิ่มผู้เล่นแล้ว");
  }

  async function addCatalogItem(submitEvent) {
    submitEvent.preventDefault();
    await mutate(() => addExtraCatalogItem({ clubId: context.club_id, name: newItem.name, price: newItem.price }), "เพิ่มสินค้าแล้ว");
    setNewItem({ name: "", price: "" });
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
      <div className="badminton-card-title badminton-player-card-title"><Users size={20} /><div><h2>ผู้เล่น</h2><p>{participants.length} คน</p></div><label className="badminton-player-sort"><span>เรียงลำดับ</span><select aria-label="เรียงลำดับผู้เล่น" onChange={(changeEvent) => setSortMode(changeEvent.target.value)} value={sortMode}><option value="signup">ลำดับการลงชื่อ</option><option value="alphabetical">ตามตัวอักษร</option></select></label></div>
      <form className="badminton-inline-form" onSubmit={addMember}>
        <input aria-label="ชื่อเล่นผู้เล่น" placeholder="พิมพ์ชื่อเล่น" required value={name} onChange={(e) => setName(e.target.value)} />
        <button className="badminton-primary badminton-add-player" type="submit"><UserPlus size={17} /> เพิ่มคน</button>
      </form>

      <details className="badminton-catalog-settings">
        <summary><PackagePlus size={17} /> รายการสินค้า น้ำ-ขนม</summary>
        <div className="badminton-catalog-list">
          {(dashboard.extraItems || []).map((item) => (
            <div className="badminton-catalog-item" key={item.id}><span>{item.name}</span><input aria-label={`ราคา ${item.name}`} defaultValue={item.price} min="0" onBlur={(changeEvent) => mutate(() => updateExtraCatalogItem(item.id, changeEvent.target.value), `แก้ราคา ${item.name} แล้ว`)} type="number" /><em>บาท</em><button aria-label={`ลบสินค้า ${item.name}`} className="badminton-catalog-delete" onClick={() => { if (window.confirm(`ลบ ${item.name} ออกจากรายการสินค้า?`)) mutate(() => removeExtraCatalogItem(item.id), `ลบ ${item.name} แล้ว`); }} type="button"><Trash2 size={15} /></button></div>
          ))}
        </div>
        <form className="badminton-catalog-add" onSubmit={addCatalogItem}>
          <input aria-label="ชื่อรายการใหม่" placeholder="ชื่อรายการ" required value={newItem.name} onChange={(changeEvent) => setNewItem({ ...newItem, name: changeEvent.target.value })} />
          <input aria-label="ราคารายการใหม่" min="0" placeholder="ราคา" required type="number" value={newItem.price} onChange={(changeEvent) => setNewItem({ ...newItem, price: changeEvent.target.value })} />
          <button className="badminton-secondary" type="submit"><Plus size={15} /> เพิ่ม</button>
        </form>
      </details>

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
              <div className="badminton-player-identity"><b className="badminton-player-index">{playerIndex + 1}.</b><strong>{participantName}</strong>{lineName ? <span title={`LINE: ${lineName}`}>LINE: {lineName}</span> : null}<em>{formatPlayedDuration(playedMinutes)} · ≈ {baht(due)} บาท</em></div>
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
      <div className="badminton-card-title"><ReceiptText size={20} /><div><h2>ค่าใช้จ่ายรายคน</h2></div></div>
      <div className="badminton-settlement-hero"><span>ยอดรวมรอบนี้</span><strong>{baht(settlement.totalCost)} บาท</strong><small>ส่วนกลาง {baht(settlement.sharedTotalCost)} · ของเพิ่มรายคน {baht(settlement.personalExtrasTotal)} · {settlement.totalHours.toFixed(1)} ชั่วโมงผู้เล่น</small></div>
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

function LoadingScreen({ label }) {
  return <main className="badminton-app badminton-auth-page"><div className="badminton-loading"><RefreshCw size={24} /><strong>{label}</strong></div></main>;
}

function ConfigError() {
  return <main className="badminton-app badminton-auth-page"><section className="badminton-auth-card"><h1>ยังไม่ได้ตั้งค่า Supabase</h1><p>เพิ่ม Project URL และ Publishable key ใน environment variables ก่อนเปิดใช้งานหลังบ้าน</p></section></main>;
}
