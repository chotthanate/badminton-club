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
} from "lucide-react";
import {
  addCourt,
  addExpense,
  addExtraCatalogItem,
  addLineMember,
  addMemberExtraCharge,
  createClub,
  createEvent,
  getAdminContext,
  loadDashboard,
  recordAudit,
  publishEventToLine,
  removeCourt,
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
            <p className="badminton-kicker">หลังบ้าน</p>
            <h1>จัดการรอบแบด</h1>
            <p>{context.clubs.name}</p>
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

function CreateEventCard({ compact = false, context, defaultVenue = "", session, mutate, venues = [] }) {
  const initial = createInitialEvent();
  const [form, setForm] = useState({
    eventDate: initial.date,
    venue: defaultVenue || venues[0]?.name || "คอร์ทแบดเขาน้อย (คอร์ทใหม่)",
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
        <label>สถานที่<input list="saved-venues" onChange={(event) => set("venue", event.target.value)} required value={form.venue} /></label>
        <datalist id="saved-venues">{venues.map((venue) => <option key={venue.id} value={venue.name} />)}</datalist>
        <label>คอร์ท<input onChange={(event) => set("courtName", event.target.value)} required value={form.courtName} /></label>
        <label>เริ่ม<input onChange={(event) => set("startsAt", event.target.value)} required type="time" value={form.startsAt} /></label>
        <label>จบ<input onChange={(event) => set("endsAt", event.target.value)} required type="time" value={form.endsAt} /></label>
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
  const [newCourt, setNewCourt] = useState({ courtName: "", startsAt: event.starts_at.slice(0, 5), endsAt: event.ends_at.slice(0, 5) });
  const nextStatus = event.status === "open" ? "closed" : "open";

  async function addNewCourt(submitEvent) {
    submitEvent.preventDefault();
    await mutate(() => addCourt({
      clubId: event.club_id,
      eventId: event.id,
      ...newCourt,
    }), "เพิ่มคอร์ทแล้ว");
    setNewCourt({ courtName: "", startsAt: event.starts_at.slice(0, 5), endsAt: event.ends_at.slice(0, 5) });
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
        <div className="badminton-courts-heading"><strong>คอร์ทที่จอง</strong><span>แก้เวลาและเพิ่มคอร์ทที่นี่</span></div>
        {courts.map((court) => <CourtEditor key={court.id} court={court} eventId={event.id} mutate={mutate} />)}
        <form className="badminton-court-row is-new" onSubmit={addNewCourt}>
          <input aria-label="ชื่อคอร์ทใหม่" placeholder="เช่น คอร์ท 8" required value={newCourt.courtName} onChange={(e) => setNewCourt({ ...newCourt, courtName: e.target.value })} />
          <input aria-label="เวลาเริ่มคอร์ทใหม่" required type="time" value={newCourt.startsAt} onChange={(e) => setNewCourt({ ...newCourt, startsAt: e.target.value })} />
          <input aria-label="เวลาจบคอร์ทใหม่" required type="time" value={newCourt.endsAt} onChange={(e) => setNewCourt({ ...newCourt, endsAt: e.target.value })} />
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
      <input aria-label={`เวลาเริ่ม ${court.court_name}`} type="time" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
      <input aria-label={`เวลาจบ ${court.court_name}`} type="time" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
      <button aria-label={`บันทึก ${court.court_name}`} className="badminton-icon-button" onClick={() => mutate(() => updateCourt(court.id, eventId, form), `บันทึก ${form.court_name} แล้ว`)} type="button"><Save size={16} /></button>
      <button aria-label={`ลบ ${court.court_name}`} className="badminton-delete-button" onClick={() => mutate(() => removeCourt(court.id, eventId), `ลบ ${court.court_name} แล้ว`)} type="button"><Trash2 size={16} /></button>
    </div>
  );
}

function ParticipantsPanel({ context, dashboard, event, mutate, session, settlement }) {
  const [name, setName] = useState("");
  const [expandedExtras, setExpandedExtras] = useState(null);
  const [newItem, setNewItem] = useState({ name: "", price: "" });
  const participants = event.signups
    .filter((signup) => signup.status === "coming")
    .map((signup) => ({
      ...signup,
      member: dashboard.members.find((member) => member.id === signup.memberId),
      attendance: event.attendance.find((row) => row.memberId === signup.memberId),
    }))
    .filter((row) => row.member)
    .sort((a, b) => timePosition(a.arrivalTime, event.startTime) - timePosition(b.arrivalTime, event.startTime));
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
    await mutate(() => addExtraCatalogItem({ clubId: context.club_id, name: newItem.name, price: newItem.price }), "เพิ่มรายการหน้าคอร์ทแล้ว");
    setNewItem({ name: "", price: "" });
  }

  return (
    <section className="badminton-card badminton-participants-card">
      <div className="badminton-card-title"><Users size={20} /><div><h2>ผู้ร่วมเล่น</h2><p>{participants.length} คน</p></div></div>
      <form className="badminton-inline-form" onSubmit={addMember}>
        <input aria-label="ชื่อเล่นผู้เล่น" placeholder="พิมพ์ชื่อเล่น" required value={name} onChange={(e) => setName(e.target.value)} />
        <button className="badminton-primary badminton-add-player" type="submit"><UserPlus size={17} /> เพิ่มคน</button>
      </form>

      <details className="badminton-catalog-settings">
        <summary><PackagePlus size={17} /> รายการหน้าคอร์ท</summary>
        <div className="badminton-catalog-list">
          {(dashboard.extraItems || []).map((item) => (
            <label key={item.id}><span>{item.name}</span><input aria-label={`ราคา ${item.name}`} defaultValue={item.price} min="0" onBlur={(changeEvent) => mutate(() => updateExtraCatalogItem(item.id, changeEvent.target.value), `แก้ราคา ${item.name} แล้ว`)} type="number" /><em>บาท</em></label>
          ))}
        </div>
        <form className="badminton-catalog-add" onSubmit={addCatalogItem}>
          <input aria-label="ชื่อรายการใหม่" placeholder="ชื่อรายการ" required value={newItem.name} onChange={(changeEvent) => setNewItem({ ...newItem, name: changeEvent.target.value })} />
          <input aria-label="ราคารายการใหม่" min="0" placeholder="ราคา" required type="number" value={newItem.price} onChange={(changeEvent) => setNewItem({ ...newItem, price: changeEvent.target.value })} />
          <button className="badminton-secondary" type="submit"><Plus size={15} /> เพิ่ม</button>
        </form>
      </details>

      <div className="badminton-attendance-list">
        {participants.length ? participants.map(({ member, attendance: row, arrivalTime }) => {
          const participantName = memberName(member);
          const plannedArrival = arrivalTime || event.startTime;
          const leftAt = row?.leftAt || "";
          const playedMinutes = playedMinutesWithinEvent(event.startTime, event.endTime, plannedArrival, leftAt);
          const charges = (dashboard.memberExtras || []).filter((charge) => charge.member_id === member.id);
          const extraTotal = charges.reduce((sum, charge) => sum + Number(charge.unit_price) * Number(charge.quantity), 0);
          const due = settlementByMember.get(member.id)?.roundedDue || 0;
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
              <div className="badminton-player-identity"><strong>{participantName}</strong>{lineName ? <span>LINE: {lineName}</span> : null}<em>{formatPlayedDuration(playedMinutes)} · ประมาณ {baht(due)} บาท</em></div>
              <div className="badminton-player-controls">
                <label><span>มา</span><select aria-label={`เวลามา ${participantName}`} value={plannedArrival} onChange={(changeEvent) => updateArrival(changeEvent.target.value)}>{timeOptions.slice(0, -1).map((time) => <option key={time} value={time}>{time}</option>)}</select></label>
                <label><span>กลับ</span><select aria-label={`เวลากลับ ${participantName}`} value={leftAt} onChange={(changeEvent) => updateDeparture(changeEvent.target.value)}><option value="">อยู่จนจบรอบ</option>{timeOptions.filter((time) => timePosition(time, event.startTime) > timePosition(plannedArrival, event.startTime)).map((time) => <option key={time} value={time}>{time}</option>)}</select></label>
                <button className="badminton-extra-toggle" onClick={() => setExpandedExtras(expandedExtras === member.id ? null : member.id)} type="button"><Plus size={15} /> ของเพิ่ม{extraTotal ? ` ${baht(extraTotal)}` : ""}</button>
                <button aria-label={`ลบ ${participantName}`} className="badminton-delete-button" onClick={() => mutate(() => removeParticipant({ eventId: event.id, memberId: member.id }), `ลบ ${participantName} ออกจากรอบแล้ว`)} type="button"><Trash2 size={17} /></button>
              </div>
              {charges.length ? <div className="badminton-member-charges">{charges.map((charge) => <span key={charge.id}>{charge.item_name} {baht(Number(charge.unit_price) * Number(charge.quantity))}<button aria-label={`ลบ ${charge.item_name}`} onClick={() => mutate(() => removeMemberExtraCharge(charge.id), `ลบ ${charge.item_name} แล้ว`)} type="button">×</button></span>)}</div> : null}
              {expandedExtras === member.id ? <div className="badminton-extra-menu">{(dashboard.extraItems || []).map((item) => <button key={item.id} onClick={() => mutate(() => addMemberExtraCharge({ clubId: event.clubId, eventId: event.id, memberId: member.id, item: { name: item.name, price: Number(item.price) }, userId: session.user.id }), `เพิ่ม ${item.name} ให้ ${participantName} แล้ว`)} type="button"><strong>{item.name}</strong><span>{baht(item.price)} บาท</span></button>)}</div> : null}
            </article>
          );
        }) : <div className="badminton-empty">ยังไม่มีผู้ร่วมเล่น</div>}
      </div>
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

  return (
    <section className="badminton-card badminton-pricing-card">
      <div className="badminton-card-title"><Calculator size={20} /><div><h2>ค่าใช้จ่ายรอบนี้</h2><p>เวลาคอร์ทอ้างอิงจากแท็บ “รอบ” โดยอัตโนมัติ</p></div></div>
      <div className="badminton-pricing-grid">
        <article className="badminton-price-box">
          <div className="badminton-price-head"><span>เวลาคอร์ทรวม</span><strong>{courtHours.toFixed(courtHours % 1 ? 1 : 0)} ชม.</strong></div>
          <p>{event.courts.length} คอร์ท · หากเพิ่มเวลาให้แก้เวลาจบที่แท็บ “รอบ”</p>
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
      <div className="badminton-card-title"><ReceiptText size={20} /><div><h2>ยอดที่ต้องจ่าย</h2><p>หารค่าใช้จ่ายส่วนกลางตามเวลาที่อยู่จริง</p></div></div>
      <div className="badminton-settlement-hero"><span>ยอดรวมรอบนี้</span><strong>{baht(settlement.totalCost)} บาท</strong><small>ส่วนกลาง {baht(settlement.sharedTotalCost)} · ของเพิ่มรายคน {baht(settlement.personalExtrasTotal)} · {settlement.totalHours.toFixed(1)} ชั่วโมงผู้เล่น</small></div>
      <div className="badminton-pay-list">
        {settlement.rows.map((row) => (
          <article className={`badminton-pay-row ${row.paid ? "is-paid" : ""}`} key={row.memberId}>
            <div><strong>{row.name}</strong><span>{formatPlayedDuration(Number(row.hours) * 60)}{row.extraAmount ? ` · ของเพิ่ม ${baht(row.extraAmount)} บาท` : ""}</span></div>
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
      paidAmount: Number(payment?.amount || 0),
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
    signups: dashboard.signups.map((row) => ({ memberId: row.member_id, status: row.status, arrivalTime: row.arrival_time?.slice(0, 5) || "", note: row.note })),
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
