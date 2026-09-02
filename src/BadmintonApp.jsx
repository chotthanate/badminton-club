import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpDown,
  BadgeCheck,
  CalendarDays,
  Check,
  Copy,
  Calculator,
  FlaskConical,
  History,
  Image,
  ListOrdered,
  LogIn,
  LogOut,
  PackagePlus,
  Pencil,
  Plus,
  Play,
  ReceiptText,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Timer,
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
  addRandomTestPlayers,
  approveQueueDraft,
  archiveClubMember,
  cancelQueueMatch,
  changeAdminPassword,
  configureStaffAccess,
  createClub,
  createEvent,
  createQueueDraft,
  createTestClub,
  correctEventShuttlecockCount,
  deleteCompletedEvent,
  dismissDuplicateMemberSuggestion,
  finalizeMemberBill,
  getAdminContexts,
  finishEvent,
  finishQueueMatch,
  getPaymentSlipImageUrl,
  incrementEventShuttlecockCount,
  listClubEvents,
  listOutstandingPayments,
  loadDashboard,
  loadStaffDashboard,
  markOutstandingPaymentPaid,
  mergeClubMembers,
  recordAudit,
  replaceEventCourts,
  resetTestClub,
  reviewPaymentSlip,
  prepareEventForLine,
  removeCourt,
  removeExtraCatalogItem,
  removeMemberExtraCharge,
  removeParticipant,
  removeShuttlecockCheckpoint,
  setPayment,
  setEventShuttlecockCount,
  signInStaff,
  snapshotPerRoundDeparture,
  startNextQueueOnCourt,
  updateAttendance,
  updateClubMember,
  updateCourts,
  updateEvent,
  updateEventDetails,
  updateEventPriceAndDefault,
  updateExtraCatalogItem,
  updateExpense,
  updateLinePaymentSummarySetting,
  updateSignup,
  updateSignupArrival,
  updateQueueDraftLineup,
  updateOperatorAttendance,
  updateOperatorMemberSkill,
  updateOperatorSignupArrival,
  upsertOperatorCourt,
  moveUpcomingQueue,
  upsertShuttlecockCheckpoint,
} from "./clubRepository.js";
import { buildSlipRoundBreakdown } from "./paymentSlip.js";
import {
  baht,
  billableHours,
  buildLineSummary,
  calculateSettlement,
  completedRoundsByMember,
  createInitialEvent,
  formatPlayedDuration,
  formatThaiLongDate,
  finalizedCollectionSummary,
  minutesBetween,
  playedMinutesWithinEvent,
  roundDefaultsForDate,
  suggestArrivalTimeOnCheck,
  suggestShuttlecockCheckpointTime,
  timePositionWithinEvent,
  totalCourtHours,
  weekdayFromIsoDate,
} from "./badmintonLogic.js";
import { duplicateGroupSignature, findExactDuplicateMemberGroups, normalizeMemberSearch, rankMemberSuggestions } from "./memberSearch.js";
import { buildLiveQueueUrl, buildTestPaymentLiffUrl, buildTestSignupLiffUrl } from "./liffSignup.js";
import { proposeQueueMatch, SKILL_LEVELS } from "./queueLogic.js";
import { randomTestPlayerCount } from "./randomTestPlayers.js";
import { loadPlayerSortMode, savePlayerSortMode } from "./playerSortPreference.js";
import SkillCompatibilityPicker from "./SkillCompatibilityPicker.jsx";
import QueuePanel, { OperatorCourtControls } from "./QueuePanel.jsx";
import StaffParticipantsPanel from "./StaffParticipantsPanel.jsx";
import { defaultPlayableSkillLevels, normalizePlayableSkillLevels } from "./skillLevels.js";
import { authenticateBackofficeCode } from "./backofficeAuth.js";
import { selectStaffWorkspace } from "./staffWorkspace.js";
import { isSupabaseConfigured, supabase } from "./supabase.js";

const EVENT_STATUS_LABELS = {
  draft: "เตรียมรอบ",
  open: "เปิดลงชื่อ",
  closed: "จบรอบแล้ว",
  cancelled: "ยกเลิก",
};

async function copyTextToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // LINE's in-app browser can deny Clipboard API even on HTTPS.
    }
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  input.setSelectionRange(0, value.length);
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("คัดลอกไม่สำเร็จ กรุณาลองเปิดผ่าน Safari");
}

const ADMIN_TABS = [
  { id: "round", label: "รอบ", icon: CalendarDays },
  { id: "players", label: "ผู้เล่น", icon: Users },
  { id: "queue", label: "คิว", icon: ListOrdered },
  { id: "costs", label: "ค่าใช้จ่าย", icon: Calculator },
  { id: "payments", label: "ชำระเงิน", icon: WalletCards },
  { id: "history", label: "ประวัติ", icon: History },
];

const HALF_HOUR_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 ? "30" : "00";
  return `${String(hour).padStart(2, "0")}:${minute}`;
});

const BILLING_PERCENT_OPTIONS = [100, 75, 50, 25];

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
    try {
      await authenticateBackofficeCode(accessCode, {
        signInOwner: (password) => supabase.auth.signInWithPassword({
          email: import.meta.env.VITE_ADMIN_EMAIL,
          password,
        }),
        signInStaff,
      });
      setMessage("เข้าสู่ระบบสำเร็จ");
    } catch (nextError) {
      setMessage("รหัสเข้าเว็บไม่ถูกต้อง");
    }
    setSending(false);
  }

  return (
    <main className="badminton-app badminton-auth-page">
      <section className="badminton-auth-card">
        <div className="badminton-auth-icon"><ShieldCheck size={30} /></div>
        <p className="badminton-kicker">สำหรับผู้ดูแล</p>
        <h1>หลังบ้านกลุ่มแบด</h1>
        <p>สมาชิกไม่ต้องเข้าเว็บ การลงชื่อทั้งหมดจะทำผ่าน LINE</p>
        <form onSubmit={submit}>
          <label htmlFor="admin-code">รหัสเข้าเว็บ</label>
          <input
            autoComplete="current-password"
            id="admin-code"
            onChange={(event) => setAccessCode(event.target.value)}
            placeholder="กรอกรหัสเข้าเว็บ"
            required
            type="password"
            value={accessCode}
          />
          <button className="badminton-primary" disabled={sending} type="submit">
            <LogIn size={18} /> {sending ? "กำลังตรวจสอบ..." : "เข้าสู่ระบบ"}
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
  const [staffAccessModalOpen, setStaffAccessModalOpen] = useState(false);
  const [eventSummaries, setEventSummaries] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [previousOutstanding, setPreviousOutstanding] = useState({ count: 0, total: 0, rows: [] });
  const [adminContexts, setAdminContexts] = useState([]);
  const selectedClubIdRef = useRef(null);
  const selectedEventIdRef = useRef(null);

  async function refresh(silent = false, options = {}) {
    if (!silent) setLoading(true);
    setError("");
    try {
      const nextContexts = await getAdminContexts(session.user.id);
      const isStaffSession = nextContexts.length > 0 && nextContexts.every((entry) => entry.role === "staff");
      const requestedClubId = options.clubId || selectedClubIdRef.current;
      let nextContext = null;
      let nextDashboard = null;
      if (isStaffSession) {
        const staffDashboards = Object.fromEntries(await Promise.all(nextContexts.map(async (entry) => [
          entry.club_id,
          await loadStaffDashboard(entry.club_id),
        ])));
        const selectedWorkspace = selectStaffWorkspace(nextContexts, staffDashboards, options.clubId || null);
        nextContext = selectedWorkspace?.context || null;
        nextDashboard = selectedWorkspace?.dashboard || null;
      } else {
        nextContext = nextContexts.find((entry) => entry.club_id === requestedClubId)
          || nextContexts.find((entry) => !entry.clubs.is_test)
          || nextContexts[0]
          || null;
      }
      setAdminContexts(nextContexts);
      selectedClubIdRef.current = nextContext?.club_id || null;
      setContext(nextContext);
      if (!nextContext) {
        setDashboard(null);
        setEventSummaries([]);
        setSelectedEventId(null);
        selectedEventIdRef.current = null;
        setPreviousOutstanding({ count: 0, total: 0, rows: [] });
        return;
      }
      const isStaffContext = nextContext.role === "staff";
      const nextEvents = isStaffContext ? [] : await listClubEvents(nextContext.club_id);
      const requestedEventId = options.preferLatest ? null : (options.eventId || selectedEventIdRef.current);
      const targetEventId = isStaffContext ? null : nextEvents.some((event) => event.id === requestedEventId)
        ? requestedEventId
        : nextEvents[0]?.id || null;
      if (!isStaffContext) nextDashboard = await loadDashboard(nextContext.club_id, targetEventId);
      const outstandingRows = isStaffContext ? [] : await listOutstandingPayments(nextContext.club_id);
      const nextOutstanding = {
        count: outstandingRows.length,
        total: outstandingRows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
        rows: outstandingRows,
      };
      setEventSummaries(nextEvents);
      setSelectedEventId(isStaffContext ? nextDashboard.event?.id || null : targetEventId);
      selectedEventIdRef.current = isStaffContext ? nextDashboard.event?.id || null : targetEventId;
      setDashboard(nextDashboard);
      setPreviousOutstanding(nextOutstanding);
      if (isStaffContext) setActiveTab((current) => ["round", "queue", "players"].includes(current) ? current : "queue");
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
      if (options.errorMode === "alert") {
        window.alert(nextError.message);
      } else {
        setError(nextError.message);
      }
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

  async function addDemoQueuePlayers() {
    if (!context?.clubs.is_test || dashboard?.event?.status !== "open") {
      window.alert("กรุณาเปิดลงชื่อในรอบทดลองก่อนเพิ่มผู้เล่นสุ่ม");
      return;
    }
    const count = randomTestPlayerCount();
    if (!window.confirm(`เพิ่มผู้เล่นสุ่มคละระดับ ${count} คน และเช็กชื่อให้พร้อมเข้าคิวเลยใช่ไหม?`)) return;
    const saved = await mutate(async () => {
      const addedCount = await addRandomTestPlayers({
        clubId: context.club_id,
        eventId: dashboard.event.id,
        count,
      });
      await recordAudit({
        clubId: context.club_id,
        eventId: dashboard.event.id,
        userId: session.user.id,
        action: `เพิ่มผู้เล่นสุ่มคละระดับ ${addedCount} คนในโหมดทดลอง`,
      });
    }, `เพิ่มผู้เล่นสุ่มคละระดับ ${count} คนและเช็กชื่อแล้ว`);
    if (saved) setActiveTab("queue");
  }

  async function copyTestLink(kind) {
    const liffId = import.meta.env.VITE_LINE_LIFF_ID;
    if (kind !== "live" && !liffId) {
      setError("ยังไม่ได้ตั้งค่า LINE LIFF ID สำหรับสร้างลิงก์ทดลอง");
      return;
    }
    const common = { liffId, testClubId: context.club_id };
    const link = kind === "signup"
      ? buildTestSignupLiffUrl({ ...common, eventId: dashboard.event?.id })
      : kind === "payment"
        ? buildTestPaymentLiffUrl(common)
        : buildLiveQueueUrl({ eventId: dashboard.event?.id, testClubId: context.club_id });
    if (!link) {
      setError(kind === "signup" ? "กรุณาสร้างและเปิดลงชื่อรอบทดลองก่อน" : "สร้างลิงก์ชำระเงินทดลองไม่สำเร็จ");
      return;
    }
    try {
      await copyTextToClipboard(link);
      setError("");
      setNotice(kind === "signup" ? "คัดลอกลิงก์ลงชื่อทดลองแล้ว" : kind === "payment" ? "คัดลอกลิงก์ชำระเงินทดลองแล้ว" : "คัดลอกลิงก์สนามและคิวทดลองแล้ว");
    } catch (copyError) {
      setError(copyError.message);
    }
  }

  if (loading && !dashboard) return <LoadingScreen label="กำลังโหลดหลังบ้าน" />;
  if (!context) return <ClubSetup session={session} onCreated={refresh} error={error} />;
  if (!dashboard) return <main className="badminton-app badminton-auth-page"><section className="badminton-auth-card"><h1>โหลดข้อมูลไม่สำเร็จ</h1><p>{error || "กรุณาลองโหลดข้อมูลอีกครั้ง"}</p><button className="badminton-primary" onClick={() => refresh()} type="button"><RefreshCw size={18} /> ลองใหม่</button></section></main>;

  const isStaff = context.role === "staff";
  const appEvent = dashboard.event ? mapDashboardToEvent(dashboard) : null;
  const settlement = appEvent && !isStaff ? calculateSettlement(appEvent) : null;
  const hasUnfinishedRound = eventSummaries.some((round) => ["draft", "open"].includes(round.status));
  const visibleTabs = isStaff ? ADMIN_TABS.filter((tab) => ["round", "players", "queue"].includes(tab.id)) : ADMIN_TABS;

  return (
    <main className="badminton-app">
      <section className="badminton-shell">
        <header className="badminton-header">
          <div>
            <p className="badminton-kicker">{isStaff ? "โหมดสตาฟ" : "หลังบ้าน"}</p>
            <h1>จัดการรอบแบด</h1>
            <p>{context.clubs.name}</p>
          </div>
          <div className="badminton-header-actions">
            <button
              aria-label="โหลดหน้าเว็บและข้อมูลล่าสุด"
              className="badminton-icon-button"
              onClick={() => window.location.reload()}
              title="โหลดหน้าเว็บและข้อมูลล่าสุด"
              type="button"
            >
              <RefreshCw size={18} />
            </button>
            {!isStaff ? <button aria-label="เปลี่ยนรหัสเข้าเว็บ" className="badminton-icon-button" onClick={() => setPasswordModalOpen(true)} title="เปลี่ยนรหัสเข้าเว็บ" type="button">
              <ShieldCheck size={18} />
            </button> : null}
            {!isStaff && !context.clubs.is_test ? <button aria-label="ตั้งค่ารหัสสตาฟ" className="badminton-icon-button" onClick={() => setStaffAccessModalOpen(true)} title="ตั้งค่ารหัสสตาฟ" type="button"><Users size={18} /></button> : null}
            {!isStaff ? <button aria-label={context.clubs.is_test ? "กลับข้อมูลจริง" : "เข้าโหมดทดลอง"} className={`badminton-icon-button ${context.clubs.is_test ? "is-test-mode" : ""}`} onClick={switchTestMode} title={context.clubs.is_test ? "กลับข้อมูลจริง" : "เข้าโหมดทดลอง"} type="button">
              <FlaskConical size={18} />
            </button> : null}
            <button className="badminton-secondary" onClick={() => supabase.auth.signOut()} type="button">
              <LogOut size={17} /> ออกจากระบบ
            </button>
          </div>
        </header>

        {notice ? <div className="badminton-alert is-success"><span>{notice}</span><button aria-label="ปิดข้อความแจ้งเตือน" onClick={() => setNotice("")} type="button"><X size={17} /></button></div> : null}
        {error ? <div className="badminton-alert is-error"><span>{error}</span><button aria-label="ปิดข้อความผิดพลาด" onClick={() => setError("")} type="button"><X size={17} /></button></div> : null}
        {!isStaff && context.clubs.is_test ? <div className="badminton-test-banner"><div><FlaskConical size={18} /><span><strong>โหมดทดลอง</strong> ข้อมูลนี้แยกจากรอบจริงและจะไม่ส่งเข้า LINE</span></div><div className="badminton-test-actions"><button disabled={saving || dashboard.event?.status !== "open"} onClick={addDemoQueuePlayers} title={dashboard.event?.status === "open" ? "สุ่มจำนวน ระดับ และความยินยอม พร้อมเช็กชื่อเข้าคิว" : "เปิดลงชื่อในรอบทดลองก่อน"} type="button"><Users size={15} /> เพิ่มผู้เล่นสุ่ม 23–40 คน</button><button disabled={saving || dashboard.event?.status !== "open"} onClick={() => copyTestLink("signup")} type="button"><Copy size={15} /> ลิงก์ลงชื่อทดลอง</button><button disabled={saving} onClick={() => copyTestLink("payment")} type="button"><Copy size={15} /> ลิงก์ชำระเงินทดลอง</button><button disabled={saving || !dashboard.event} onClick={() => copyTestLink("live")} type="button"><Copy size={15} /> ลิงก์สนามและคิวทดลอง</button><button disabled={saving} onClick={resetDemo} type="button">รีเซ็ตข้อมูลทดลอง</button></div></div> : null}

        {!dashboard.event && !isStaff ? (
          <CreateEventCard context={context} mutate={mutate} session={session} venues={dashboard.venues || []} />
        ) : !dashboard.event ? (
          <section className="badminton-card badminton-empty"><h2>ยังไม่มีรอบที่เปิดอยู่</h2><p>สตาฟจะเข้าใช้งานได้เมื่อเจ้าของเปิดรอบแล้ว</p></section>
        ) : (
          <>
            {!isStaff ? <RoundSwitcher
              events={eventSummaries}
              onChange={(eventId) => refresh(false, { eventId })}
              onDelete={(round) => mutate(
                () => deleteCompletedEvent(round.id),
                round.status === "draft" ? "ลบรอบที่กำลังเตรียมแล้ว" : "ลบรอบที่ชำระเงินครบแล้ว",
                { selectLatest: true, errorMode: "alert" },
              )}
              selectedEventId={selectedEventId}
            /> : null}
            <nav aria-label="เมนูหลังบ้าน" className="badminton-tabs">
              {visibleTabs.map(({ id, label, icon: Icon }) => (
                <button className={activeTab === id ? "is-active" : ""} key={id} onClick={() => setActiveTab(id)} type="button"><Icon size={18} /><span>{label}</span>{id === "payments" && appEvent.paymentSlips?.length ? <b className="badminton-tab-count" title={`${appEvent.paymentSlips.length} สลิปรอตรวจสอบ`}>{appEvent.paymentSlips.length}</b> : null}</button>
              ))}
            </nav>

            {!isStaff && activeTab === "round" ? <>
              <EventControlCard
                clubName={context.clubs.name}
                clubSettings={context.clubs}
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
              {dashboard.event.status === "closed" && !hasUnfinishedRound
                ? <CreateEventCard compact context={context} defaultVenue={dashboard.event.venue} mutate={mutate} session={session} venues={dashboard.venues || []} />
                : null}
            </> : null}

            {isStaff && activeTab === "round" ? <OperatorCourtControls event={appEvent} mutate={mutate} /> : null}

            {activeTab === "players" ? (
              isStaff ? <StaffParticipantsPanel dashboard={dashboard} event={appEvent} mutate={mutate} /> : <ParticipantsPanel
                context={context}
                dashboard={dashboard}
                event={appEvent}
                mutate={mutate}
                session={session}
                settlement={settlement}
              />
            ) : null}

            {activeTab === "queue" ? (
              <QueuePanel dashboard={dashboard} event={appEvent} isStaff={isStaff} mutate={mutate} />
            ) : null}

            {!isStaff && activeTab === "costs" ? <PricingPanel event={appEvent} mutate={mutate} session={session} settlement={settlement} /> : null}
            {!isStaff && activeTab === "payments" ? <SettlementPanel context={context} event={appEvent} mutate={mutate} previousOutstanding={previousOutstanding} session={session} settlement={settlement} /> : null}
            {!isStaff && activeTab === "history" ? <AuditPanel actions={appEvent.actions} /> : null}
          </>
        )}
        {!isStaff && passwordModalOpen ? (
          <AdminPasswordModal
            onClose={() => setPasswordModalOpen(false)}
            onSave={(password) => mutate(() => changeAdminPassword(password), "เปลี่ยนรหัสเข้าเว็บแล้ว")}
            saving={saving}
          />
        ) : null}
        {!isStaff && !context.clubs.is_test && staffAccessModalOpen ? <StaffAccessModal clubId={context.club_id} onClose={() => setStaffAccessModalOpen(false)} onSave={(settings) => mutate(() => configureStaffAccess({ clubId: context.club_id, ...settings }), settings.enabled ? "ตั้งค่ารหัสสตาฟแล้ว เซสชันเดิมถูกตัด" : "ปิดใช้งานรหัสสตาฟแล้ว")} saving={saving} /> : null}
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

function StaffAccessModal({ clubId, onClose, onSave, saving }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [localError, setLocalError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setLocalError("");
    if (password !== confirmation) return setLocalError("รหัสทั้งสองช่องไม่ตรงกัน");
    const saved = await onSave({ clubId, password, enabled: true });
    if (saved) onClose();
  }

  async function disable() {
    if (!window.confirm("ปิดรหัสสตาฟและให้ออกจากระบบทุกเครื่องใช่ไหม?")) return;
    const saved = await onSave({ clubId, enabled: false });
    if (saved) onClose();
  }

  return <div className="badminton-modal-backdrop" role="presentation"><form className="badminton-custom-charge-modal badminton-password-modal" onSubmit={submit}><div className="badminton-modal-title"><div><p className="badminton-kicker">สิทธิ์ทีมงาน</p><h2>ตั้งค่ารหัสสตาฟ</h2></div><button aria-label="ปิด" onClick={onClose} type="button"><X size={18} /></button></div><p>เปลี่ยนรหัสเมื่อใด สตาฟที่เปิดค้างไว้จะถูกให้ออกจากระบบทันที และต้องใช้รหัสใหม่</p><label>รหัสสตาฟใหม่<input autoComplete="new-password" minLength="6" maxLength="72" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label><label>ยืนยันรหัส<input autoComplete="new-password" minLength="6" maxLength="72" onChange={(event) => setConfirmation(event.target.value)} required type="password" value={confirmation} /></label>{localError ? <p className="badminton-form-message is-error">{localError}</p> : null}<button className="badminton-primary" disabled={saving} type="submit"><Save size={17} /> ตั้งหรือเปลี่ยนรหัสสตาฟ</button><button className="badminton-delete-button badminton-full-button" disabled={saving} onClick={disable} type="button"><X size={17} /> ปิดใช้งานรหัสสตาฟ</button></form></div>;
}

function RoundSwitcher({ events, onChange, onDelete, selectedEventId }) {
  const selectedRound = events.find((event) => event.id === selectedEventId);
  const canDelete = selectedRound && ["draft", "closed"].includes(selectedRound.status);

  function confirmDelete() {
    if (!selectedRound) return;
    const detail = selectedRound.status === "draft"
      ? "ข้อมูลคอร์ทและการตั้งค่าของรอบที่กำลังเตรียมจะถูกลบ"
      : "รายชื่อ ค่าใช้จ่าย การชำระเงิน และประวัติของรอบนี้จะถูกลบถาวร";
    const confirmed = window.confirm(`ลบรอบ ${formatRoundOption(selectedRound.event_date)} ใช่ไหม?\n\n${detail}`);
    if (confirmed) onDelete(selectedRound);
  }

  return (
    <section className="badminton-round-switcher">
      <label>
        <span>รอบทั้งหมด</span>
        <div className="badminton-round-switcher-controls">
          <select onChange={(event) => onChange(event.target.value)} value={selectedEventId || ""}>
            {events.map((event, index) => (
              <option key={event.id} value={event.id}>
                {index === 0 ? "รอบล่าสุด · " : ""}{formatRoundOption(event.event_date)} · {EVENT_STATUS_LABELS[event.status] || event.status}
              </option>
            ))}
          </select>
          <button aria-label="ลบรอบที่เลือก" disabled={!canDelete} onClick={confirmDelete} title={selectedRound?.status === "draft" ? "ลบรอบที่กำลังเตรียม" : selectedRound?.status === "closed" ? "ลบรอบที่ชำระเงินครบแล้ว" : "รอบที่เปิดลงชื่ออยู่ยังลบไม่ได้"} type="button"><Trash2 size={17} /></button>
        </div>
      </label>
      <small>ลบรอบที่กำลังเตรียมได้ทันที ส่วนรอบที่จบแล้วต้องเก็บเงินครบก่อน</small>
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
  const venue = defaultVenue || venues[0]?.name || "คอร์ทแบดเขาน้อย (คอร์ทใหม่)";
  const defaults = roundDefaultsForDate(initial.date, context.clubs);

  async function createRound() {
    await mutate(async () => {
      const created = await createEvent({
        clubId: context.club_id,
        clubName: context.clubs.name,
        userId: session.user.id,
        eventDate: initial.date,
        venue,
        startsAt: defaults.courts.map((court) => court.startsAt).sort()[0] || "21:00",
        endsAt: defaults.courts[0]?.endsAt || "00:00",
        courtHourlyRate: defaults.courtHourlyRate,
        shuttlecockUnitPrice: defaults.shuttlecockUnitPrice,
        courts: defaults.courts,
      });
      await recordAudit({
        clubId: context.club_id,
        eventId: created.id,
        userId: session.user.id,
        action: "สร้างรอบใหม่",
      });
    }, "สร้างรอบใหม่แล้ว", { selectLatest: true });
  }

  return (
    <div className={`badminton-create-round-wrap ${compact ? "is-compact" : ""}`}>
      <button className="badminton-create-next-button" onClick={createRound} type="button">
        <Plus size={18} /> {compact ? "สร้างรอบถัดไป" : "สร้างรอบแรก"}
      </button>
      {compact ? <small>สร้างได้ทันทีแม้ยังเก็บเงินไม่ครบ ยอดค้างจะยังอยู่ในรอบเดิม</small> : null}
    </div>
  );
}

function EventControlCard({ clubName, clubSettings, courts, event, isTestMode, mappedEvent, mutate, session, settlement, venues = [] }) {
  const [form, setForm] = useState({
    event_date: event.event_date,
    venue: event.venue,
  });
  const [editingDetails, setEditingDetails] = useState(event.status === "draft");
  const [newCourt, setNewCourt] = useState({ courtNumber: "", startsAt: event.starts_at.slice(0, 5), endsAt: event.ends_at.slice(0, 5) });
  const [courtDrafts, setCourtDrafts] = useState({});

  useEffect(() => {
    setCourtDrafts(Object.fromEntries(courts.map((court) => [court.id, {
      court_name: court.court_name,
      starts_at: court.starts_at.slice(0, 5),
      ends_at: court.ends_at.slice(0, 5),
    }])));
  }, [courts, event.id]);

  async function saveEventDetails() {
    const previousWeekday = weekdayFromIsoDate(event.event_date);
    const nextWeekday = weekdayFromIsoDate(form.event_date);
    const shouldApplyPreset = event.status === "draft"
      && previousWeekday !== nextWeekday
      && [5, 6].includes(nextWeekday);
    await mutate(async () => {
      const preset = shouldApplyPreset ? roundDefaultsForDate(form.event_date, clubSettings) : null;
      await updateEventDetails({
        clubId: event.club_id,
        eventId: event.id,
        patch: {
          ...form,
          ...(preset ? {
            court_hourly_rate: preset.courtHourlyRate,
            shuttlecock_unit_price: preset.shuttlecockUnitPrice,
          } : {}),
        },
      });
      if (preset) {
        await replaceEventCourts({
          clubId: event.club_id,
          eventId: event.id,
          courts: preset.courts,
        });
      }
    }, shouldApplyPreset
      ? `บันทึกรายละเอียดและใช้คอร์ทตั้งต้นของวัน${nextWeekday === 5 ? "ศุกร์" : "เสาร์"}แล้ว`
      : "บันทึกรายละเอียดรอบแล้ว");
  }

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

  async function saveAllCourts() {
    const updates = courts.map((court) => ({
      id: court.id,
      ...(courtDrafts[court.id] || {
        court_name: court.court_name,
        starts_at: court.starts_at.slice(0, 5),
        ends_at: court.ends_at.slice(0, 5),
      }),
    }));
    if (updates.some((court) => !court.court_name.trim())) {
      await mutate(async () => { throw new Error("กรุณากรอกชื่อคอร์ทให้ครบทุกคอร์ท"); }, "");
      return;
    }
    await mutate(() => updateCourts(event.id, updates), "บันทึกคอร์ททั้งหมดแล้ว");
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
        if (mappedEvent.billingModel === "per_round" && mappedEvent.hasPlayingGames) {
          throw new Error("ยังมีสนามกำลังเล่น กรุณากดจบเกมทุกสนามก่อนจบรอบและคำนวณยอดตามจำนวนรอบ");
        }
        if (mappedEvent.billingModel === "per_round" && settlement.sharedTotalCost > 0 && settlement.totalUnits <= 0) {
          throw new Error("ยังไม่มีเกมที่จบ ระบบจึงยังหารค่าส่วนกลางตามจำนวนรอบไม่ได้");
        }
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
          action: `จบรอบและบันทึกยอดที่ต้องชำระแบบ${mappedEvent.billingModel === "per_round" ? "ตามจำนวนรอบ" : "ตามเวลา"}`,
          details: {
            billing_model: mappedEvent.billingModel,
            completed_games: mappedEvent.completedGameCount,
          },
        });
      }, "จบรอบแล้ว ยอดของผู้เล่นทุกคนถูกเก็บไว้");
    }
    return null;
  }

  const paymentComplete = settlement.rows.length > 0 && settlement.rows.every((row) => row.paid);
  const statusLabel = event.status === "draft" && event.line_publish_ready && !isTestMode
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
          {event.status !== "closed" ? <button className="badminton-primary badminton-round-action" disabled={event.status === "draft" && event.line_publish_ready && !isTestMode} onClick={advanceRound} type="button">{event.status === "draft" ? (isTestMode ? "เปิดลงชื่อทดลอง" : event.line_publish_ready ? "รอพิมพ์ใน LINE" : "เตรียมเปิดลงชื่อ") : "จบรอบ"}</button> : null}
        </div>
      </div>
      {event.status === "draft" && event.line_publish_ready && !isTestMode ? <div className="badminton-line-command-ready"><strong>ขั้นตอนสุดท้าย</strong><span>ไปที่กลุ่ม LINE แล้วพิมพ์ <b>เปิดลงชื่อ</b> บอทจะตอบการ์ดโดยไม่หักโควตา</span></div> : null}
      {editingDetails ? <div className="badminton-event-form badminton-event-main-form">
        <label>วันที่<input type="date" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} /></label>
        <label>สถานที่<input list="round-saved-venues" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} /></label>
        <datalist id="round-saved-venues">{venues.map((venue) => <option key={venue.id} value={venue.name} />)}</datalist>
        <button className="badminton-secondary" onClick={saveEventDetails} type="button"><Save size={17} /> บันทึก</button>
      </div> : null}
      {event.status === "closed" ? (
        <div className="badminton-closed-courts">
          {courts.map((court) => <span key={court.id}><strong>{court.court_name}</strong> : {court.starts_at.slice(0, 5)}–{court.ends_at.slice(0, 5) === "00:00" ? "24:00" : court.ends_at.slice(0, 5)}</span>)}
        </div>
      ) : (
        <div className="badminton-courts-editor">
          <div className="badminton-courts-heading"><strong>คอร์ทที่จอง</strong></div>
          {courts.map((court) => <CourtEditor key={court.id} court={court} draft={courtDrafts[court.id]} onChange={(nextDraft) => setCourtDrafts((current) => ({ ...current, [court.id]: nextDraft }))} eventId={event.id} mutate={mutate} />)}
          <form className="badminton-court-row is-new" onSubmit={addNewCourt}>
            <div className="badminton-court-number-input"><span>คอร์ท</span><input aria-label="เลขคอร์ทใหม่" inputMode="numeric" placeholder="เลข" required value={newCourt.courtNumber} onChange={(e) => setNewCourt({ ...newCourt, courtNumber: e.target.value })} /></div>
            <HalfHourSelect ariaLabel="เวลาเริ่มคอร์ทใหม่" onChange={(value) => setNewCourt({ ...newCourt, startsAt: value })} value={newCourt.startsAt} />
            <HalfHourSelect ariaLabel="เวลาจบคอร์ทใหม่" onChange={(value) => setNewCourt({ ...newCourt, endsAt: value })} value={newCourt.endsAt} />
            <button aria-label="เพิ่มคอร์ท" className="badminton-secondary badminton-court-add" type="submit"><Plus size={16} /><span>เพิ่ม</span></button>
          </form>
          {courts.length ? <button className="badminton-secondary badminton-courts-save-all" onClick={saveAllCourts} type="button"><Save size={17} /> บันทึกคอร์ททั้งหมด</button> : null}
        </div>
      )}
    </section>
  );
}

function CourtEditor({ court, draft, eventId, mutate, onChange }) {
  const form = draft || {
    court_name: court.court_name,
    starts_at: court.starts_at.slice(0, 5),
    ends_at: court.ends_at.slice(0, 5),
  };
  return (
    <div className="badminton-court-row">
      <input aria-label={`ชื่อ ${court.court_name}`} value={form.court_name} onChange={(e) => onChange({ ...form, court_name: e.target.value })} />
      <HalfHourSelect ariaLabel={`เวลาเริ่ม ${court.court_name}`} onChange={(value) => onChange({ ...form, starts_at: value })} value={form.starts_at} />
      <HalfHourSelect ariaLabel={`เวลาจบ ${court.court_name}`} onChange={(value) => onChange({ ...form, ends_at: value })} value={form.ends_at} />
      <button aria-label={`ลบ ${court.court_name}`} className="badminton-delete-button" onClick={() => mutate(() => removeCourt(court.id, eventId), `ลบ ${court.court_name} แล้ว`)} type="button"><Trash2 size={16} /></button>
    </div>
  );
}

function HalfHourSelect({ ariaLabel, onChange, value }) {
  return <select aria-label={ariaLabel} onChange={(event) => onChange(event.target.value)} value={value}>{HALF_HOUR_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}</select>;
}

function mapQueueDashboard(dashboard) {
  const membersById = new Map((dashboard.members || []).map((member) => [member.id, member]));
  const signupsByMember = new Map((dashboard.signups || []).map((signup) => [signup.member_id, signup]));
  const players = (dashboard.queuePlayers || []).map((row) => {
    const member = membersById.get(row.member_id);
    const signup = signupsByMember.get(row.member_id);
    return {
      memberId: row.member_id,
      name: memberName(member) || "ไม่ทราบชื่อ",
      lineName: member?.display_name || "",
      skillLevel: signup?.skill_level_snapshot || member?.skill_level || null,
      playableSkillLevels: normalizePlayableSkillLevels(
        signup?.skill_level_snapshot || member?.skill_level,
        signup?.playable_skill_levels_snapshot?.length ? signup.playable_skill_levels_snapshot : member?.playable_skill_levels,
        {
          allowLowerLevel: signup?.allow_lower_level_snapshot ?? member?.allow_lower_level,
          allowHigherLevel: signup?.allow_higher_level_snapshot ?? member?.allow_higher_level,
        },
      ),
      allowLowerLevel: Boolean(signup?.allow_lower_level_snapshot),
      allowHigherLevel: Boolean(signup?.allow_higher_level_snapshot),
      status: row.status,
      gamesPlayed: Number(row.games_played) || 0,
      minutesPlayed: Number(row.minutes_played) || 0,
      queuedAt: row.queued_at,
      skipUntilSequence: Number(row.skip_until_sequence) || 0,
    };
  });
  const playersById = new Map(players.map((player) => [player.memberId, player]));
  const matchPlayersByMatch = new Map();
  for (const row of dashboard.queueMatchPlayers || []) {
    const livePlayer = playersById.get(row.member_id);
    const player = {
      ...(livePlayer || {}),
      memberId: row.member_id,
      name: livePlayer?.name || memberName(membersById.get(row.member_id)) || "ไม่ทราบชื่อ",
      skillLevel: row.skill_level_snapshot || livePlayer?.skillLevel,
      playableSkillLevels: row.playable_skill_levels_snapshot?.length
        ? row.playable_skill_levels_snapshot
        : livePlayer?.playableSkillLevels || [],
    };
    const next = matchPlayersByMatch.get(row.match_id) || [];
    next.push({ ...player, team: row.team, position: row.position });
    matchPlayersByMatch.set(row.match_id, next);
  }
  const matches = (dashboard.queueMatches || []).map((match) => ({
    id: match.id,
    courtId: match.court_id,
    sequence: Number(match.sequence),
    queuePosition: match.queue_position === null ? null : Number(match.queue_position),
    status: match.status,
    proposedAt: match.proposed_at,
    startedAt: match.started_at,
    endedAt: match.ended_at,
    players: (matchPlayersByMatch.get(match.id) || []).sort((left, right) => left.team.localeCompare(right.team) || left.position - right.position),
  }));
  return { players, matches };
}

function LegacyQueuePanel({ dashboard, event, mutate }) {
  const [replaceTarget, setReplaceTarget] = useState(null);
  const [manualReplacementId, setManualReplacementId] = useState("");
  const [finishingMatchId, setFinishingMatchId] = useState(null);
  const [clock, setClock] = useState(Date.now());
  const queue = mapQueueDashboard(dashboard);
  const nextSequence = Math.max(0, ...queue.matches.map((match) => match.sequence)) + 1;
  const activeMatches = queue.matches.filter((match) => ["proposed", "playing"].includes(match.status));
  const activeByCourt = new Map(activeMatches.map((match) => [match.courtId, match]));
  const waiting = queue.players.filter((player) => player.status === "waiting")
    .sort((left, right) => left.gamesPlayed - right.gamesPlayed
      || left.minutesPlayed - right.minutesPlayed
      || new Date(left.queuedAt) - new Date(right.queuedAt));

  useEffect(() => {
    if (!activeMatches.some((match) => match.status === "playing")) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeMatches.map((match) => `${match.id}:${match.status}`).join("|")]);

  async function buildProposalForCourt(courtId) {
    await ensureEventQueuePlayers({ clubId: event.clubId, eventId: event.id });
    const freshDashboard = await loadDashboard(event.clubId, event.id);
    const freshQueue = mapQueueDashboard(freshDashboard);
    const freshNextSequence = Math.max(0, ...freshQueue.matches.map((match) => match.sequence)) + 1;
    const proposal = proposeQueueMatch(freshQueue.players, freshQueue.matches, freshNextSequence);
    if (!proposal) {
      const ready = freshQueue.players.filter((player) => player.status === "waiting" && player.skillLevel).length;
      throw new Error(ready < 4
        ? `มีผู้เล่นพร้อมเข้าคิว ${ready} คน ต้องมีอย่างน้อย 4 คน`
        : "ยังไม่มีผู้เล่น 4 คนที่เงื่อนไขตรงกัน กรุณารอผู้เล่นที่เหมาะสมกลับเข้าคิว");
    }
    await claimQueueMatch({
      eventId: event.id,
      courtId,
      memberIds: proposal.lineup.map((player) => player.memberId),
      teamAIds: proposal.teamA.map((player) => player.memberId),
    });
  }

  function propose(court) {
    return mutate(() => buildProposalForCourt(court.id), `จัดผู้เล่นสำหรับ ${court.name} แล้ว`);
  }

  async function finishMatch(match, court) {
    if (finishingMatchId) return;
    setFinishingMatchId(match.id);
    try {
      await mutate(() => finishQueueMatch(match.id), `จบเกม ${court.name} แล้ว สนามว่าง`);
    } finally {
      setFinishingMatchId(null);
    }
  }

  function replacePlayer(match, outgoing, automatic) {
    const remaining = match.players.filter((player) => player.memberId !== outgoing.memberId);
    let incoming;
    let teams;
    if (automatic) {
      const replacement = proposeReplacement(remaining, queue.players, queue.matches, nextSequence);
      if (!replacement) {
        window.alert("ยังไม่มีผู้เล่นที่พร้อมแทน กรุณาเลือกคนเอง");
        return;
      }
      incoming = replacement.player;
      teams = replacement.teams;
    } else {
      incoming = waiting.find((player) => player.memberId === manualReplacementId);
      if (!incoming) return;
      if (!canReplaceQueuePlayer(remaining, incoming)) {
        window.alert("ผู้เล่นคนนี้ไม่ตรงกับเงื่อนไขระดับที่ทุกคนเลือกไว้ กรุณาเลือกคนอื่น");
        return;
      }
      teams = balanceTeams([...remaining, incoming], queue.matches);
    }
    mutate(() => replaceQueueMatchPlayer({
      matchId: match.id,
      outgoingMemberId: outgoing.memberId,
      incomingMemberId: incoming.memberId,
      skipAbsent: true,
      teamAIds: teams.teamA.map((player) => player.memberId),
    }), `เปลี่ยน ${outgoing.name} เป็น ${incoming.name} แล้ว`);
    setReplaceTarget(null);
    setManualReplacementId("");
  }

  return (
    <section className="badminton-queue-workspace">
      <article className="badminton-card badminton-queue-summary">
        <div><ListOrdered size={20} /><span>รอเล่น<strong>{waiting.length}</strong></span></div>
        <div><Play size={20} /><span>กำลังเล่น<strong>{activeMatches.filter((match) => match.status === "playing").length * 4}</strong></span></div>
        <div><Timer size={20} /><span>จบแล้ว<strong>{queue.matches.filter((match) => match.status === "completed").length} เกม</strong></span></div>
      </article>

      <div className="badminton-queue-courts">
        {event.courts.map((court) => {
          const match = activeByCourt.get(court.id);
          const elapsedMinutes = match?.startedAt ? Math.max(0, Math.floor((clock - new Date(match.startedAt).getTime()) / 60000)) : 0;
          return (
            <article className={`badminton-card badminton-queue-court ${match ? `is-${match.status}` : "is-empty"}`} key={court.id}>
              <header><div><strong>{court.name}</strong><span>{court.startsAt}–{court.endsAt}</span></div>{match ? <b>เกมที่ {match.sequence}</b> : <b>ว่าง</b>}</header>
              {!match ? (
                <button className="badminton-primary" disabled={event.status !== "open"} onClick={() => propose(court)} type="button"><ListOrdered size={17} /> จัด 4 คน</button>
              ) : (
                <>
                  <div className="badminton-queue-teams">
                    {["A", "B"].map((team) => <div key={team}><span>ทีม {team}</span>{match.players.filter((player) => player.team === team).map((player) => <div key={player.memberId}><strong>{player.name}</strong><em>{player.skillLevel}</em>{match.status === "proposed" ? <button aria-label={`เปลี่ยน ${player.name}`} onClick={() => { setReplaceTarget({ match, player }); setManualReplacementId(""); }} type="button">เปลี่ยน</button> : null}</div>)}</div>)}
                  </div>
                  {match.status === "proposed" ? <div className="badminton-queue-actions"><button className="badminton-secondary" onClick={() => mutate(() => cancelQueueMatch(match.id), `ยกเลิกเกม ${court.name} แล้ว`)} type="button"><X size={16} /> ยกเลิก</button><button className="badminton-primary" onClick={() => mutate(() => startQueueMatch(match.id), `เริ่มเกม ${court.name} แล้ว`)} type="button"><Play size={16} /> เริ่มเกม</button></div> : <div className="badminton-queue-playing"><span>เล่นมาแล้ว <strong>{elapsedMinutes} นาที</strong></span><button className="badminton-primary" disabled={finishingMatchId === match.id} onClick={() => finishMatch(match, court)} type="button"><Check size={17} /> {finishingMatchId === match.id ? "กำลังจบเกม..." : "จบเกม"}</button></div>}
                </>
              )}
            </article>
          );
        })}
      </div>

      <article className="badminton-card badminton-queue-waiting">
        <div className="badminton-card-title"><Users size={20} /><div><h2>คิวรอเล่น</h2><p>เรียงจากคนที่ได้เล่นน้อยที่สุด</p></div></div>
        {waiting.length ? <ol>{waiting.map((player) => <li key={player.memberId}><span><strong>{player.name}</strong><em>{player.skillLevel}</em></span><small>{player.gamesPlayed} เกม · {player.minutesPlayed} นาที</small></li>)}</ol> : <div className="badminton-empty">ยังไม่มีผู้เล่นเช็กชื่อรอเข้าคิว</div>}
      </article>

      {replaceTarget ? <div className="badminton-modal-backdrop" role="presentation"><div aria-modal="true" className="badminton-custom-charge-modal badminton-queue-replace-modal" role="dialog"><div className="badminton-modal-title"><div><p className="badminton-kicker">เปลี่ยนผู้เล่น</p><h2>{replaceTarget.player.name}</h2></div><button aria-label="ปิด" onClick={() => setReplaceTarget(null)} type="button"><X size={19} /></button></div><p>คนที่ไม่อยู่จะถูกข้ามคิวถัดไป 1 ครั้ง แล้วกลับมารอตามปกติ</p><button className="badminton-primary" onClick={() => replacePlayer(replaceTarget.match, replaceTarget.player, true)} type="button">ให้ระบบเลือกคนถัดไป</button><div className="badminton-queue-manual-replace"><select aria-label="เลือกผู้เล่นแทน" onChange={(changeEvent) => setManualReplacementId(changeEvent.target.value)} value={manualReplacementId}><option value="">หรือเลือกคนเอง…</option>{waiting.map((player) => { const compatible = canReplaceQueuePlayer(replaceTarget.match.players.filter((entry) => entry.memberId !== replaceTarget.player.memberId), player); return <option disabled={!compatible} key={player.memberId} value={player.memberId}>{player.name} · {player.skillLevel}{compatible ? "" : " · ไม่ตรงเงื่อนไข"}</option>; })}</select><button className="badminton-secondary" disabled={!manualReplacementId || !canReplaceQueuePlayer(replaceTarget.match.players.filter((entry) => entry.memberId !== replaceTarget.player.memberId), waiting.find((player) => player.memberId === manualReplacementId))} onClick={() => replacePlayer(replaceTarget.match, replaceTarget.player, false)} type="button">ยืนยัน</button></div></div></div> : null}
    </section>
  );
}

function ParticipantsPanel({ context, dashboard, event, mutate, session, settlement }) {
  const [name, setName] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [newMemberSkill, setNewMemberSkill] = useState({ level: "", playableLevels: [] });
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [newItem, setNewItem] = useState({ name: "", price: "" });
  const [customChargeFor, setCustomChargeFor] = useState(null);
  const [customCharge, setCustomCharge] = useState({ name: "", price: "" });
  const [editingMember, setEditingMember] = useState(null);
  const [memberEdit, setMemberEdit] = useState({ nickname: "", displayName: "", paymentExempt: false, skillLevel: "", playableSkillLevels: [] });
  const [pendingCheckIn, setPendingCheckIn] = useState(null);
  const [pendingDeparture, setPendingDeparture] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memberDirectoryOpen, setMemberDirectoryOpen] = useState(false);
  const [memberDirectoryQuery, setMemberDirectoryQuery] = useState("");
  const [sortMode, setSortMode] = useState(loadPlayerSortMode);
  const [exemptMemberId, setExemptMemberId] = useState("");
  const [mergeSourceId, setMergeSourceId] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
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
  const savedMembers = dashboard.members.filter((member) => member.role === "member" && member.active !== false);
  const dismissedDuplicateSignatures = new Set((dashboard.duplicateDismissals || []).map((entry) => entry.signature));
  const duplicateMemberGroups = findExactDuplicateMemberGroups(savedMembers)
    .filter((group) => !dismissedDuplicateSignatures.has(duplicateGroupSignature(group)));
  const normalizedDirectoryQuery = normalizeMemberSearch(memberDirectoryQuery);
  const directoryMembers = [...savedMembers]
    .filter((member) => !normalizedDirectoryQuery || [member.nickname, member.display_name, ...(member.aliases || [])]
      .some((value) => normalizeMemberSearch(value).includes(normalizedDirectoryQuery)))
    .sort((left, right) => memberName(left).localeCompare(memberName(right), "th"));
  const memberSuggestions = rankMemberSuggestions(
    savedMembers,
    name,
  ).slice(0, 8);

  function changeSortMode(nextMode) {
    setSortMode(nextMode);
    savePlayerSortMode(nextMode);
  }

  async function addMember(eventObject) {
    eventObject.preventDefault();
    const trimmedName = name.trim();
    const normalizedName = normalizeMemberSearch(trimmedName);
    const exactMember = savedMembers.find((member) =>
      member.role === "member"
      && normalizedName
      && [member.nickname, member.display_name, ...(member.aliases || [])]
        .some((value) => normalizeMemberSearch(value) === normalizedName));
    const existingMember = savedMembers.find((member) => member.id === selectedMemberId) || exactMember;
    const saved = await mutate(async () => {
      if (!trimmedName) throw new Error("กรุณาพิมพ์ชื่อเล่นหรือชื่อ LINE");
      const selectedSkill = existingMember?.skill_level || newMemberSkill.level;
      if (!selectedSkill) throw new Error("กรุณาเลือกระดับมือของผู้เล่น");
      const playableSkillLevels = normalizePlayableSkillLevels(
        selectedSkill,
        existingMember?.skill_level ? existingMember.playable_skill_levels : newMemberSkill.playableLevels,
        {
          allowLowerLevel: existingMember?.allow_lower_level,
          allowHigherLevel: existingMember?.allow_higher_level,
        },
      );
      const member = existingMember || await addLineMember({
        clubId: context.club_id,
        displayName: trimmedName,
        skillLevel: selectedSkill,
        playableSkillLevels,
      });
      if (existingMember && !existingMember.skill_level) {
        await updateClubMember(existingMember.id, {
          nickname: memberName(existingMember),
          displayName: existingMember.display_name || memberName(existingMember),
          paymentExempt: Boolean(existingMember.payment_exempt),
          skillLevel: selectedSkill,
          playableSkillLevels,
        });
      }
      await updateSignup({
        clubId: context.club_id,
        eventId: event.id,
        memberId: member.id,
        status: "coming",
        arrivalTime: event.startTime,
        skillLevel: selectedSkill,
        playableSkillLevels,
      });
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
      setNewMemberSkill({ level: "", playableLevels: [] });
      setSuggestionsOpen(false);
    }
  }

  async function addCatalogItem(submitEvent) {
    submitEvent.preventDefault();
    await mutate(() => addExtraCatalogItem({ clubId: context.club_id, name: newItem.name, price: newItem.price }), "เพิ่มสินค้าแล้ว");
    setNewItem({ name: "", price: "" });
  }

  async function addPaymentExemptMember(submitEvent) {
    submitEvent.preventDefault();
    const member = savedMembers.find((entry) => entry.id === exemptMemberId);
    if (!member) {
      await mutate(async () => {
        throw new Error("ไม่พบชื่อนี้ กรุณาเลือกชื่อจากรายชื่อผู้เล่นเดิม");
      }, "");
      return;
    }
    const saved = await mutate(
      () => updateClubMember(member.id, {
        nickname: memberName(member),
        displayName: member.display_name || memberName(member),
        paymentExempt: true,
      }),
      `เพิ่ม ${memberName(member)} ในรายชื่อไม่ต้องเก็บเงินแล้ว`,
    );
    if (saved) setExemptMemberId("");
  }

  function removePaymentExemptMember(member) {
    return mutate(
      () => updateClubMember(member.id, {
        nickname: memberName(member),
        displayName: member.display_name || memberName(member),
        paymentExempt: false,
      }),
      `นำ ${memberName(member)} ออกจากรายชื่อไม่ต้องเก็บเงินแล้ว`,
    );
  }

  function openMemberEditor(member) {
    setEditingMember(member);
    setMemberEdit({
      nickname: member.nickname || member.display_name || "",
      displayName: member.display_name || member.nickname || "",
      paymentExempt: Boolean(member.payment_exempt),
      skillLevel: member.skill_level || "",
      playableSkillLevels: normalizePlayableSkillLevels(member.skill_level, member.playable_skill_levels, {
        allowLowerLevel: member.allow_lower_level,
        allowHigherLevel: member.allow_higher_level,
      }),
    });
  }

  async function saveMember(submitEvent) {
    submitEvent.preventDefault();
    const nickname = memberEdit.nickname.trim();
    const displayName = memberEdit.displayName.trim();
    const saved = await mutate(async () => {
      if (!nickname) throw new Error("กรุณากรอกชื่อเล่น");
      if (!displayName) throw new Error("กรุณากรอกชื่อ LINE");
      if (!memberEdit.skillLevel) throw new Error("กรุณาเลือกระดับมือ");
      await updateClubMember(editingMember.id, {
        nickname,
        displayName,
        paymentExempt: memberEdit.paymentExempt,
        skillLevel: memberEdit.skillLevel,
        playableSkillLevels: memberEdit.playableSkillLevels,
      });
      await updateOperatorMemberSkill({
        eventId: event.id,
        memberId: editingMember.id,
        skillLevel: memberEdit.skillLevel,
        playableSkillLevels: memberEdit.playableSkillLevels,
      });
      await recordAudit({
        clubId: context.club_id,
        eventId: event.id,
        userId: session.user.id,
        action: `แก้ไขชื่อผู้เล่น ${nickname}`,
        details: { member_id: editingMember.id, payment_exempt: memberEdit.paymentExempt, skill_level: memberEdit.skillLevel },
      });
    }, `บันทึกชื่อ ${nickname} แล้ว`);
    if (saved) setEditingMember(null);
  }

  async function deleteMemberProfile() {
    if (!editingMember) return;
    const nickname = memberName(editingMember);
    const confirmed = window.confirm(
      `ลบ “${nickname}” ออกจากรายชื่อผู้เล่นเดิมใช่ไหม?\n\nประวัติรอบเก่า ยอดค้าง และข้อมูลการชำระเงินจะยังอยู่ ไม่ถูกลบตามไปด้วย`,
    );
    if (!confirmed) return;
    const saved = await mutate(async () => {
      await archiveClubMember(editingMember.id);
      await recordAudit({
        clubId: context.club_id,
        eventId: event.id,
        userId: session.user.id,
        action: `ลบ ${nickname} ออกจากรายชื่อผู้เล่นเดิม`,
        details: { member_id: editingMember.id, archived: true },
      });
    }, `ลบ ${nickname} ออกจากรายชื่อผู้เล่นเดิมแล้ว`);
    if (saved) setEditingMember(null);
  }

  async function dismissDuplicateGroup(group) {
    const names = group.map((member) => memberName(member)).join(" ↔ ");
    const confirmed = window.confirm(
      `ยืนยันว่า “${names}” ไม่ใช่คนเดียวกันใช่ไหม?\n\nระบบจะไม่แนะนำคู่นี้อีก`,
    );
    if (!confirmed) return;
    const saved = await mutate(async () => {
      const signature = duplicateGroupSignature(group);
      await dismissDuplicateMemberSuggestion({ clubId: context.club_id, signature });
      await recordAudit({
        clubId: context.club_id,
        eventId: event.id,
        userId: session.user.id,
        action: `ไม่รวมรายชื่อซ้ำ ${names}`,
        details: { signature, member_ids: group.map((member) => member.id) },
      });
    }, "ซ่อนคำแนะนำรายชื่อซ้ำนี้แล้ว");
    if (saved) {
      setMergeSourceId("");
      setMergeTargetId("");
    }
  }

  function chooseDuplicateGroup(group) {
    const [preferred, ...duplicates] = group;
    setMergeTargetId(preferred?.id || "");
    setMergeSourceId(duplicates[0]?.id || "");
  }

  async function mergeDuplicateMember(submitEvent) {
    submitEvent.preventDefault();
    if (!mergeSourceId || !mergeTargetId || mergeSourceId === mergeTargetId) {
      window.alert("กรุณาเลือกชื่อที่ต้องการเก็บ และชื่อซ้ำที่ต้องการรวม");
      return;
    }
    const source = savedMembers.find((member) => member.id === mergeSourceId);
    const target = savedMembers.find((member) => member.id === mergeTargetId);
    if (!source || !target) return;
    const confirmed = window.confirm(
      `รวม “${memberName(source)}” เข้าเป็นคนเดียวกับ “${memberName(target)}” ใช่ไหม?\n\nประวัติการลงชื่อ ยอดค้าง และรายการเดิมจะย้ายไปยังชื่อที่เก็บ ส่วนชื่อซ้ำจะถูกลบ`,
    );
    if (!confirmed) return;
    const saved = await mutate(async () => {
      await mergeClubMembers({ sourceMemberId: source.id, targetMemberId: target.id });
      await recordAudit({
        clubId: context.club_id,
        eventId: event.id,
        userId: session.user.id,
        action: `รวมรายชื่อซ้ำ ${memberName(source)} เข้ากับ ${memberName(target)}`,
        details: { source_member_id: source.id, target_member_id: target.id },
      });
    }, `รวม ${memberName(source)} เข้ากับ ${memberName(target)} แล้ว`);
    if (saved) {
      setMergeSourceId("");
      setMergeTargetId("");
    }
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

  async function completeCheckIn(target, useSuggestedTime) {
    const checkedArrival = useSuggestedTime ? target.suggestedArrival : target.plannedArrival;
    const saved = await mutate(async () => {
      if (useSuggestedTime) {
        await updateSignupArrival({
          eventId: event.id,
          memberId: target.memberId,
          arrivalTime: checkedArrival,
        });
      }
      await updateAttendance({
        clubId: event.clubId,
        eventId: event.id,
        memberId: target.memberId,
        patch: {
          arrived: true,
          arrived_at: checkedArrival,
          left_at: target.leftAt || null,
        },
      });
    }, useSuggestedTime
      ? `เช็กชื่อและปรับเวลามาของ ${target.participantName} แล้ว`
      : `เช็กชื่อ ${target.participantName} แล้ว`);
    if (saved) setPendingCheckIn(null);
  }

  async function saveDepartureAndLock({ memberId, participantName, plannedArrival, leftAt, cumulativeCount = null }) {
    const currentRow = settlementByMember.get(memberId);
    if (currentRow?.paid && !currentRow.paymentExempt) {
      throw new Error("คนนี้รับเงินแล้ว หากต้องแก้เวลากลับ กรุณายกเลิกสถานะรับเงินก่อน");
    }
    if (event.billingModel === "per_round" && leftAt) {
      if (currentRow?.billingFinalized) {
        throw new Error("คนนี้สรุปยอดแล้ว หากต้องแก้เวลากลับ กรุณาแก้ยอดหรือปลดล็อกก่อน");
      }
      return snapshotPerRoundDeparture({
        eventId: event.id,
        memberId,
        departureTime: leftAt,
        cumulativeShuttlecockCount: cumulativeCount,
      });
    }
    if (cumulativeCount !== null) {
      await upsertShuttlecockCheckpoint({
        clubId: event.clubId,
        eventId: event.id,
        time: leftAt,
        cumulativeCount,
        userId: session.user.id,
      });
    }
    await updateAttendance({
      clubId: event.clubId,
      eventId: event.id,
      memberId,
      patch: { arrived: true, arrived_at: plannedArrival, left_at: leftAt || null },
    });

    const freshDashboard = await loadDashboard(event.clubId, event.id);
    const freshEvent = mapDashboardToEvent(freshDashboard);
    const freshRow = freshEvent.attendance.find((row) => row.memberId === memberId);
    if (!freshRow) throw new Error("ไม่พบข้อมูลผู้เล่นหลังบันทึกเวลากลับ");
    if (freshEvent.billingModel === "per_round") {
      await recordAudit({
        clubId: event.clubId,
        eventId: event.id,
        userId: session.user.id,
        action: leftAt
          ? `${participantName} กลับ ${leftAt} · รอสรุปยอดตามจำนวนรอบหลังจบรอบ`
          : `ยกเลิกเวลากลับของ ${participantName}`,
        details: {
          member_id: memberId,
          left_at: leftAt || null,
          billing_model: "per_round",
          rounds_played: freshRow.roundsPlayed || 0,
        },
      });
      return;
    }
    const hasManualAdjustment = freshRow.billingFinalized
      && freshRow.calculatedAmount !== null
      && Number(freshRow.billedAmount) !== Number(freshRow.calculatedAmount);
    let lockedAmount = freshRow.billedAmount;
    if (leftAt && !freshRow.paymentExempt && !hasManualAdjustment) {
      const projectedEvent = {
        ...freshEvent,
        attendance: freshEvent.attendance.map((row) => row.memberId === memberId ? {
          ...row,
          paid: false,
          paidAmount: null,
          billingFinalized: false,
          billedAmount: null,
          calculatedAmount: null,
          lockedSharedAmount: null,
          lockedExtraAmount: null,
        } : row),
      };
      const projectedRow = calculateSettlement(projectedEvent).rows.find((row) => row.memberId === memberId);
      if (!projectedRow) throw new Error("คำนวณยอดของผู้เล่นไม่สำเร็จ");
      lockedAmount = projectedRow.roundedDue;
      await finalizeMemberBill({
        clubId: event.clubId,
        eventId: event.id,
        memberId,
        calculatedAmount: projectedRow.roundedDue,
        billedAmount: projectedRow.roundedDue,
        sharedAmount: projectedRow.sharedDue,
        extrasAmount: projectedRow.extraAmount,
        shuttlecockCount: freshEvent.shuttlecockCount,
        userId: session.user.id,
      });
    }
    await recordAudit({
      clubId: event.clubId,
      eventId: event.id,
      userId: session.user.id,
      action: leftAt
        ? `${participantName} กลับ ${leftAt} และล็อกยอด ${baht(lockedAmount)} บาท`
        : `ยกเลิกเวลากลับของ ${participantName}`,
      details: {
        member_id: memberId,
        left_at: leftAt || null,
        cumulative_shuttlecocks: cumulativeCount,
        billed_amount: lockedAmount,
        kept_manual_adjustment: hasManualAdjustment,
      },
    });
  }

  return (
    <section className="badminton-card badminton-participants-card">
      <div className="badminton-card-title badminton-player-card-title"><Users size={20} /><div><h2>ผู้เล่น</h2><p>{participants.length} คน</p></div><div className="badminton-player-title-actions"><label className="badminton-player-sort-icon" title={sortMode === "signup" ? "เรียงตามลำดับการลงชื่อ" : "เรียงตามตัวอักษร"}><ArrowUpDown size={18} /><select aria-label="เรียงลำดับผู้เล่น" onChange={(changeEvent) => changeSortMode(changeEvent.target.value)} value={sortMode}><option value="signup">ลำดับการลงชื่อ</option><option value="alphabetical">ตามตัวอักษร</option></select></label><button aria-label="เปิดรายชื่อผู้เล่นเดิม" className="badminton-player-settings-button" onClick={() => setMemberDirectoryOpen(true)} title="รายชื่อผู้เล่นเดิม" type="button"><Users size={18} /></button><button aria-label="ตั้งค่ารายชื่อและสินค้า" className="badminton-player-settings-button" onClick={() => setSettingsOpen(true)} title="ตั้งค่ารายชื่อและสินค้า" type="button"><Settings size={18} /></button></div></div>
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
              setNewMemberSkill({ level: "", playableLevels: [] });
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
                      setNewMemberSkill({
                        level: member.skill_level || "",
                        playableLevels: normalizePlayableSkillLevels(member.skill_level, member.playable_skill_levels, {
                          allowLowerLevel: member.allow_lower_level,
                          allowHigherLevel: member.allow_higher_level,
                        }),
                      });
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
        <div className="badminton-new-player-skill">
          <select aria-label="ระดับมือผู้เล่น" disabled={Boolean(selectedMemberId && newMemberSkill.level)} onChange={(changeEvent) => setNewMemberSkill({ level: changeEvent.target.value, playableLevels: defaultPlayableSkillLevels(changeEvent.target.value) })} required value={newMemberSkill.level}><option value="">เลือกระดับมือ</option>{SKILL_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}</select>
          {!selectedMemberId ? <SkillCompatibilityPicker onChange={(playableLevels) => setNewMemberSkill({ ...newMemberSkill, playableLevels })} skillLevel={newMemberSkill.level} value={newMemberSkill.playableLevels} /> : null}
        </div>
        <button className="badminton-primary badminton-add-player" type="submit"><UserPlus size={17} /> {selectedMemberId ? "เพิ่มคนเดิม" : "เพิ่มคน"}</button>
      </form>

      <div className="badminton-attendance-list">
        {sortedParticipants.length ? sortedParticipants.map(({ member, attendance: row, arrivalTime, submittedByLineName, skillLevel: roundSkillLevel }, playerIndex) => {
          const participantName = memberName(member);
          const rawPlannedArrival = arrivalTime || event.startTime;
          const plannedArrival = timeOptions.slice(0, -1).includes(rawPlannedArrival)
            ? rawPlannedArrival
            : event.startTime;
          const leftAt = row?.leftAt || "";
          const playedMinutes = playedMinutesWithinEvent(event.startTime, event.endTime, plannedArrival, leftAt);
          const billingPercentage = Number(row?.billingPercentage ?? 100);
          const charges = (dashboard.memberExtras || []).filter((charge) => charge.member_id === member.id);
          const extraTotal = charges.reduce((sum, charge) => sum + Number(charge.unit_price) * Number(charge.quantity), 0);
          const settlementRow = settlementByMember.get(member.id);
          const due = settlementRow?.roundedDue || 0;
          const isPaid = Boolean(settlementRow?.paid) && !settlementRow?.paymentExempt;
          const lineName = member.nickname && member.nickname !== member.display_name ? member.display_name : "";
          const checkedIn = Boolean(row?.checkedIn);

          function updateArrival(nextArrival) {
            return mutate(async () => {
              await updateSignupArrival({ eventId: event.id, memberId: member.id, arrivalTime: nextArrival });
              await updateAttendance({ clubId: event.clubId, eventId: event.id, memberId: member.id, patch: { arrived: checkedIn, arrived_at: checkedIn ? nextArrival : null } });
            }, `ปรับเวลามาของ ${participantName} แล้ว`);
          }

          function updateDeparture(nextDeparture) {
            const exactCheckpoint = (event.shuttlecockCheckpoints || []).find((item) => item.time === nextDeparture);
            if (nextDeparture && (event.billingModel === "per_round" || (event.billingModel === "time_segmented" && !exactCheckpoint))) {
              const previousCheckpoints = (event.shuttlecockCheckpoints || [])
                .filter((item) => timePositionWithinEvent(item.time, event.startTime, event.endTime) <= timePositionWithinEvent(nextDeparture, event.startTime, event.endTime))
                .map((item) => Number(item.cumulativeCount) || 0);
              const latestCount = exactCheckpoint?.cumulativeCount
                ?? (previousCheckpoints.length ? Math.max(...previousCheckpoints) : event.shuttlecockCount || 0);
              setPendingDeparture({
                memberId: member.id,
                participantName,
                plannedArrival,
                leftAt: nextDeparture,
                cumulativeCount: String(latestCount),
              });
              return null;
            }
            return mutate(
              () => saveDepartureAndLock({ memberId: member.id, participantName, plannedArrival, leftAt: nextDeparture }),
              nextDeparture
                ? event.billingModel === "per_round"
                  ? `สร้าง Snapshot และล็อกยอดของ ${participantName} แล้ว`
                  : `บันทึกเวลากลับและล็อกยอดของ ${participantName} แล้ว`
                : `ยกเลิกเวลากลับของ ${participantName} แล้ว`,
            );
          }

          function updateBillingPercentage(nextPercentage, selectElement) {
            const percentage = Number(nextPercentage);
            if (percentage === billingPercentage) return null;
            const confirmed = window.confirm(
              `ยืนยันเปลี่ยนสัดส่วนคิดเงินของ ${participantName}\nจาก ${billingPercentage}% เป็น ${percentage}% ใช่ไหม?`,
            );
            if (!confirmed) {
              if (selectElement) selectElement.value = String(billingPercentage);
              return null;
            }
            return mutate(
              async () => {
                await updateAttendance({
                  clubId: event.clubId,
                  eventId: event.id,
                  memberId: member.id,
                  patch: { billing_percentage: percentage },
                });
                await recordAudit({
                  clubId: event.clubId,
                  eventId: event.id,
                  userId: session.user.id,
                  action: `ปรับสัดส่วนคิดเงิน ${participantName} จาก ${billingPercentage}% เป็น ${percentage}%`,
                  details: { member_id: member.id, from: billingPercentage, to: percentage },
                });
              },
              `ปรับสัดส่วนคิดเงินของ ${participantName} เป็น ${percentage}% แล้ว`,
            );
          }

          function removePlayer() {
            if (!window.confirm(`ลบ ${participantName} ออกจากรอบนี้ใช่ไหม?`)) return null;
            return mutate(
              async () => {
                await removeParticipant({ eventId: event.id, memberId: member.id });
                await recordAudit({
                  clubId: event.clubId,
                  eventId: event.id,
                  userId: session.user.id,
                  action: `ลบผู้เล่น ${participantName} ออกจากรอบ`,
                  details: { member_id: member.id },
                });
              },
              `ลบ ${participantName} ออกจากรอบแล้ว`,
            );
          }

          function toggleCheckIn(nextChecked) {
            if (!nextChecked) {
              return mutate(
                () => updateAttendance({
                  clubId: event.clubId,
                  eventId: event.id,
                  memberId: member.id,
                  patch: { arrived: false, arrived_at: null, left_at: null },
                }),
                `ยกเลิกเช็กชื่อ ${participantName} แล้ว`,
              );
            }

            const suggestedArrival = suggestArrivalTimeOnCheck({
              eventDate: event.date,
              startTime: event.startTime,
              endTime: event.endTime,
              plannedArrival,
            });
            if (suggestedArrival) {
              setPendingCheckIn({
                memberId: member.id,
                participantName,
                plannedArrival,
                suggestedArrival,
                leftAt,
              });
              return null;
            }
            return completeCheckIn({
              memberId: member.id,
              participantName,
              plannedArrival,
              suggestedArrival: null,
              leftAt,
            }, false);
          }

          return (
            <article className={`badminton-attendance-row ${checkedIn ? "is-checked-in" : ""} ${leftAt ? "has-left" : ""} ${settlementRow?.billingFinalized ? "is-billed" : ""} ${settlementRow?.paid && !settlementRow?.paymentExempt ? "is-paid" : ""}`} key={member.id}>
              <div className="badminton-player-identity">
                <label className="badminton-check-in-box" title={`เช็กชื่อ ${participantName}`}><input aria-label={`เช็กชื่อ ${participantName}`} checked={checkedIn} onChange={(changeEvent) => toggleCheckIn(changeEvent.target.checked)} type="checkbox" /><span aria-hidden="true"><Check size={14} /></span></label>
                <b className="badminton-player-index">{playerIndex + 1}.</b>
                <div className="badminton-player-name"><strong>{participantName}</strong>{lineName ? <span title={`LINE: ${lineName}`}>LINE: {lineName}</span> : null}</div>
                {roundSkillLevel || member.skill_level ? <em className="badminton-skill-badge">{roundSkillLevel || member.skill_level}</em> : null}
                <button aria-label={`แก้ไขชื่อ ${participantName}`} className="badminton-member-edit-button" onClick={() => openMemberEditor(member)} type="button"><Pencil size={13} /></button>
                {submittedByLineName ? <small className="badminton-signup-attribution" title={`ลงชื่อให้โดย LINE: ${submittedByLineName}`}>ลงชื่อให้โดย LINE: {submittedByLineName}</small> : null}
              </div>
              <div className={`badminton-player-cost-status ${leftAt ? "has-departure-status" : ""}`}>{leftAt ? <span>กลับ {leftAt}</span> : null}<div className={`badminton-player-billing-meta ${settlementRow?.locked ? "is-locked" : ""}`}>{event.billingModel === "per_round" ? <span className="badminton-round-count">{settlementRow?.roundsPlayed || 0} รอบ</span> : <select aria-label={`เปอร์เซ็นต์คิดเงิน ${participantName}`} onChange={(changeEvent) => updateBillingPercentage(changeEvent.target.value, changeEvent.currentTarget)} value={billingPercentage}>{BILLING_PERCENT_OPTIONS.map((percentage) => <option key={percentage} value={percentage}>{percentage}%</option>)}</select>}<small>{event.billingModel === "per_round" ? "คิดตามเกมที่จบ" : formatPlayedDuration(playedMinutes)}</small><strong>{settlementRow?.paid && !settlementRow?.paymentExempt ? `จ่ายแล้ว ${baht(due)}` : settlementRow?.billingFinalized ? `ล็อกยอด ${baht(due)}` : event.billingModel === "per_round" ? `≈ ${baht(due)}` : leftAt ? `ยอด ${baht(due)}` : `≈ ${baht(due)}`} บาท</strong></div></div>
              <div className="badminton-player-controls">
                <label><span>มา</span><select aria-label={`เวลามา ${participantName}`} value={plannedArrival} onChange={(changeEvent) => updateArrival(changeEvent.target.value)}>{timeOptions.slice(0, -1).map((time) => <option key={time} value={time}>{time}</option>)}</select></label>
                <label><span>กลับ</span><select aria-label={`เวลากลับ ${participantName}`} value={leftAt} onChange={(changeEvent) => updateDeparture(changeEvent.target.value)}><option value="">อยู่จนจบรอบ</option>{timeOptions.filter((time) => timePositionWithinEvent(time, event.startTime, event.endTime) > timePositionWithinEvent(plannedArrival, event.startTime, event.endTime)).map((time) => <option key={time} value={time}>{time}</option>)}</select></label>
                <label className="badminton-extra-select-wrap"><span>น้ำ/ขนม</span><select aria-label={`เพิ่มน้ำหรือขนมให้ ${participantName}`} disabled={isPaid} onChange={(changeEvent) => chooseExtra(changeEvent.target.value, member.id, participantName)} title={isPaid ? "ยกเลิกรับเงินก่อนแก้สินค้า" : "เลือกน้ำหรือขนม"} value=""><option value="">+ น้ำ/ขนม{extraTotal ? ` ${baht(extraTotal)}` : ""}</option>{(dashboard.extraItems || []).map((item) => <option key={item.id} value={item.id}>{item.name} · {baht(item.price)} บาท</option>)}<option value="custom">กรอกค่าใช้จ่ายเอง…</option></select></label>
                <button aria-label={`ลบ ${participantName}`} className="badminton-delete-button" onClick={removePlayer} type="button"><Trash2 size={17} /></button>
              </div>
              {charges.length ? <div className="badminton-member-charges">{charges.map((charge) => <span key={charge.id}>{charge.item_name} {baht(Number(charge.unit_price) * Number(charge.quantity))}{!isPaid ? <button aria-label={`ลบ ${charge.item_name}`} onClick={() => mutate(() => removeMemberExtraCharge(charge.id), `ลบ ${charge.item_name} แล้ว`)} type="button">×</button> : null}</span>)}</div> : null}
            </article>
          );
        }) : <div className="badminton-empty">ยังไม่มีผู้เล่น</div>}
      </div>
      {settingsOpen ? <div className="badminton-modal-backdrop" role="presentation"><div aria-label="ตั้งค่าผู้เล่น" aria-modal="true" className="badminton-custom-charge-modal badminton-player-settings-modal" role="dialog"><div className="badminton-modal-title"><div><p className="badminton-kicker">ตั้งค่าผู้เล่น</p><h2>รายชื่อและสินค้า</h2></div><button aria-label="ปิดการตั้งค่าผู้เล่น" onClick={() => setSettingsOpen(false)} type="button"><X size={19} /></button></div><section className="badminton-settings-section"><div className="badminton-settings-section-title"><WalletCards size={17} /><strong>รายชื่อไม่ต้องเก็บเงิน</strong><em>{savedMembers.filter((member) => member.payment_exempt).length} คน</em></div><form className="badminton-exempt-member-form" onSubmit={addPaymentExemptMember}><select aria-label="เลือกสมาชิกที่ไม่ต้องเก็บเงิน" onChange={(changeEvent) => setExemptMemberId(changeEvent.target.value)} required value={exemptMemberId}><option value="">เลือกสมาชิกจากรายชื่อเดิม</option>{savedMembers.filter((member) => !member.payment_exempt).sort((left, right) => memberName(left).localeCompare(memberName(right), "th")).map((member) => <option key={member.id} value={member.id}>{paymentExemptIdentity(member)}</option>)}</select><button className="badminton-secondary" type="submit"><Plus size={15} /> เพิ่ม</button></form><div className="badminton-exempt-member-list">{savedMembers.filter((member) => member.payment_exempt).map((member) => <span key={member.id}><span><strong>{memberName(member)}</strong><small>{member.line_user_id ? `LINE: ${member.display_name || "เชื่อมแล้ว"}` : "ยังไม่เชื่อม LINE"}</small></span><button aria-label={`นำ ${memberName(member)} ออกจากรายชื่อไม่ต้องเก็บเงิน`} onClick={() => removePaymentExemptMember(member)} type="button"><X size={14} /></button></span>)}</div><small className="badminton-settings-help">เลือกจากสมาชิกตัวจริงโดยดูชื่อ LINE ประกอบ ระบบจะไม่จับคู่ด้วยชื่อเล่น จึงแยกคนชื่อซ้ำได้ถูกต้อง</small><small className="badminton-settings-help">คนในรายชื่อนี้ยังร่วมถูกหารค่าใช้จ่าย แต่ระบบจะถือว่าชำระแล้วและไม่ใส่ในข้อความส่ง LINE</small></section><section className="badminton-settings-section"><div className="badminton-settings-section-title"><Users size={17} /><strong>รายชื่อผู้เล่นเดิม</strong><em>{savedMembers.length} คน</em></div><div className="badminton-member-directory-list">{[...savedMembers].sort((left, right) => memberName(left).localeCompare(memberName(right), "th")).map((member) => { const nickname = memberName(member); const lineName = member.display_name && member.display_name !== nickname ? member.display_name : ""; return <button aria-label={`แก้ไขชื่อ ${nickname}`} key={member.id} onClick={() => openMemberEditor(member)} type="button"><span><strong>{nickname}</strong>{lineName ? <small>LINE: {lineName}</small> : null}</span><Pencil size={15} /></button>; })}</div></section><section className="badminton-settings-section"><div className="badminton-settings-section-title"><Users size={17} /><strong>รวมรายชื่อซ้ำ</strong><em>พบชื่อซ้ำ {duplicateMemberGroups.length} กลุ่ม</em></div>{duplicateMemberGroups.length ? <div className="badminton-duplicate-suggestions">{duplicateMemberGroups.map((group) => <button key={group.map((member) => member.id).join("-")} onClick={() => chooseDuplicateGroup(group)} type="button">{group.map((member) => memberName(member)).join(" ↔ ")}</button>)}</div> : <small className="badminton-settings-help">ไม่พบชื่อที่สะกดตรงกัน หากคนเดียวกันใช้คนละชื่อสามารถเลือกเองด้านล่าง</small>}<form className="badminton-member-merge-form" onSubmit={mergeDuplicateMember}><label><span>เก็บคนนี้ไว้</span><select aria-label="ชื่อหลักที่ต้องการเก็บ" onChange={(changeEvent) => setMergeTargetId(changeEvent.target.value)} required value={mergeTargetId}><option value="">เลือกชื่อหลัก</option>{[...savedMembers].sort((left, right) => memberName(left).localeCompare(memberName(right), "th")).map((member) => <option disabled={member.id === mergeSourceId} key={member.id} value={member.id}>{memberName(member)}{member.line_user_id ? " · เชื่อม LINE" : ""}</option>)}</select></label><label><span>รวมชื่อซ้ำนี้</span><select aria-label="ชื่อซ้ำที่ต้องการรวม" onChange={(changeEvent) => setMergeSourceId(changeEvent.target.value)} required value={mergeSourceId}><option value="">เลือกชื่อซ้ำ</option>{[...savedMembers].sort((left, right) => memberName(left).localeCompare(memberName(right), "th")).map((member) => <option disabled={member.id === mergeTargetId} key={member.id} value={member.id}>{memberName(member)}{member.line_user_id ? " · เชื่อม LINE" : ""}</option>)}</select></label><button className="badminton-secondary" type="submit">รวมประวัติและลบชื่อซ้ำ</button></form><small className="badminton-settings-help">ควรเก็บรายการที่มีคำว่า “เชื่อม LINE” เป็นชื่อหลัก ระบบจะย้ายประวัติ ยอดค้าง และจำชื่อเดิมไว้ค้นหาครั้งต่อไป</small></section><section className="badminton-settings-section"><div className="badminton-settings-section-title"><PackagePlus size={17} /><strong>รายการสินค้า น้ำ-ขนม</strong></div><div className="badminton-catalog-list">{(dashboard.extraItems || []).map((item) => <div className="badminton-catalog-item" key={item.id}><span>{item.name}</span><input aria-label={`ราคา ${item.name}`} defaultValue={item.price} min="0" onBlur={(changeEvent) => mutate(() => updateExtraCatalogItem(item.id, changeEvent.target.value), `แก้ราคา ${item.name} แล้ว`)} type="number" /><em>บาท</em><button aria-label={`ลบสินค้า ${item.name}`} className="badminton-catalog-delete" onClick={() => { if (window.confirm(`ลบ ${item.name} ออกจากรายการสินค้า?`)) mutate(() => removeExtraCatalogItem(item.id), `ลบ ${item.name} แล้ว`); }} type="button"><Trash2 size={15} /></button></div>)}</div><form className="badminton-catalog-add" onSubmit={addCatalogItem}><input aria-label="ชื่อรายการใหม่" placeholder="ชื่อรายการ" required value={newItem.name} onChange={(changeEvent) => setNewItem({ ...newItem, name: changeEvent.target.value })} /><input aria-label="ราคารายการใหม่" min="0" placeholder="ราคา" required type="number" value={newItem.price} onChange={(changeEvent) => setNewItem({ ...newItem, price: changeEvent.target.value })} /><button className="badminton-secondary" type="submit"><Plus size={15} /> เพิ่ม</button></form></section></div></div> : null}
      {editingMember ? (
        <div className="badminton-modal-backdrop badminton-member-edit-backdrop" role="presentation">
          <form className="badminton-custom-charge-modal badminton-member-edit-modal" onSubmit={saveMember}>
            <div className="badminton-modal-title"><div><p className="badminton-kicker">ข้อมูลสมาชิกเดิม</p><h2>แก้ไขโปรไฟล์ผู้เล่น</h2></div><button aria-label="ปิดหน้าต่างแก้ไขชื่อ" onClick={() => setEditingMember(null)} type="button"><X size={19} /></button></div>
            <label>ชื่อเล่น<input autoFocus maxLength="40" onChange={(changeEvent) => setMemberEdit({ ...memberEdit, nickname: changeEvent.target.value })} required value={memberEdit.nickname} /></label>
            <label>ชื่อ LINE<input maxLength="80" onChange={(changeEvent) => setMemberEdit({ ...memberEdit, displayName: changeEvent.target.value })} required value={memberEdit.displayName} /></label>
            <label>ระดับมือ<select onChange={(changeEvent) => setMemberEdit({ ...memberEdit, skillLevel: changeEvent.target.value, playableSkillLevels: defaultPlayableSkillLevels(changeEvent.target.value) })} required value={memberEdit.skillLevel}><option value="">เลือกระดับมือ</option>{SKILL_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
            <SkillCompatibilityPicker onChange={(playableSkillLevels) => setMemberEdit({ ...memberEdit, playableSkillLevels })} skillLevel={memberEdit.skillLevel} value={memberEdit.playableSkillLevels} />
            <p className="badminton-member-sync-note">การแก้ระดับตรงนี้มีผลตั้งแต่รอบถัดไป หากคนนี้ลงชื่อรอบปัจจุบันแล้ว ระบบจะเก็บระดับเดิมของรอบนี้ไว้เพื่อไม่ให้คิวเปลี่ยนย้อนหลัง</p>
            {editingMember.line_user_id ? <p className="badminton-member-sync-note">คนนี้เชื่อมกับ LINE แล้ว ชื่อ LINE จะอัปเดตอัตโนมัติเมื่อเข้าหน้าลงชื่อครั้งถัดไป</p> : null}
            <div className="badminton-member-edit-actions">
              <button className="badminton-primary" type="submit"><Save size={17} /> บันทึกโปรไฟล์</button>
              <button className="badminton-danger-button" onClick={deleteMemberProfile} type="button"><Trash2 size={17} /> ลบออกจากรายชื่อ</button>
            </div>
          </form>
        </div>
      ) : null}
      {customChargeFor ? <div className="badminton-modal-backdrop" role="presentation"><form className="badminton-custom-charge-modal" onSubmit={addCustomCharge}><div className="badminton-modal-title"><div><p className="badminton-kicker">ค่าใช้จ่ายเฉพาะคน</p><h2>เพิ่มรายการให้ {customChargeFor.name}</h2></div><button aria-label="ปิดหน้าต่าง" onClick={() => setCustomChargeFor(null)} type="button"><X size={19} /></button></div><label>ชื่อรายการ<input autoFocus maxLength="80" onChange={(changeEvent) => setCustomCharge({ ...customCharge, name: changeEvent.target.value })} placeholder="เช่น ค่าเอ็นไม้" required value={customCharge.name} /></label><label>ราคา (บาท)<input min="0" onChange={(changeEvent) => setCustomCharge({ ...customCharge, price: changeEvent.target.value })} placeholder="0" required type="number" value={customCharge.price} /></label><button className="badminton-primary" type="submit"><Plus size={17} /> เพิ่มค่าใช้จ่าย</button></form></div> : null}
      {memberDirectoryOpen ? (
        <div className="badminton-modal-backdrop badminton-member-directory-backdrop" role="presentation">
          <div aria-label="รายชื่อผู้เล่นเดิม" aria-modal="true" className="badminton-member-directory-modal" role="dialog">
            <header className="badminton-member-directory-header">
              <button aria-label="กลับ" onClick={() => setMemberDirectoryOpen(false)} type="button"><ArrowLeft size={20} /></button>
              <div><p className="badminton-kicker">ข้อมูลสมาชิก</p><h2>รายชื่อผู้เล่นเดิม</h2></div>
              <em>{savedMembers.length} คน</em>
            </header>
            <label className="badminton-member-directory-search">
              <Search size={18} />
              <input autoFocus onChange={(changeEvent) => setMemberDirectoryQuery(changeEvent.target.value)} placeholder="ค้นหาชื่อเล่นหรือชื่อ LINE" value={memberDirectoryQuery} />
              {memberDirectoryQuery ? <button aria-label="ล้างคำค้นหา" onClick={() => setMemberDirectoryQuery("")} type="button"><X size={16} /></button> : null}
            </label>
            {duplicateMemberGroups.length ? (
              <section className="badminton-member-directory-duplicates">
                <div><strong>คำแนะนำรายชื่อซ้ำ</strong><em>{duplicateMemberGroups.length} กลุ่ม</em></div>
                {duplicateMemberGroups.map((group) => (
                  <article key={duplicateGroupSignature(group)}>
                    <span>{group.map((member) => memberName(member)).join(" ↔ ")}</span>
                    <div>
                      <button className="badminton-secondary" onClick={() => { chooseDuplicateGroup(group); setMemberDirectoryOpen(false); setSettingsOpen(true); }} type="button">รวมรายชื่อ</button>
                      <button className="badminton-duplicate-dismiss" onClick={() => dismissDuplicateGroup(group)} type="button"><X size={15} /> ไม่ใช่คนเดียวกัน</button>
                    </div>
                  </article>
                ))}
              </section>
            ) : null}
            <div className="badminton-member-directory-full-list">
              {directoryMembers.length ? directoryMembers.map((member) => {
                const nickname = memberName(member);
                const lineName = member.display_name && member.display_name !== nickname ? member.display_name : "";
                return (
                  <button key={member.id} onClick={() => openMemberEditor(member)} type="button">
                    <span><strong>{nickname}</strong><small>{lineName ? `LINE: ${lineName}` : "ยังไม่เชื่อม LINE"}</small></span>
                    <Pencil size={17} />
                  </button>
                );
              }) : <div className="badminton-empty">ไม่พบรายชื่อที่ค้นหา</div>}
            </div>
          </div>
        </div>
      ) : null}
      {pendingCheckIn ? <div className="badminton-modal-backdrop" role="presentation"><div aria-label="ยืนยันเวลาเช็กชื่อ" aria-modal="true" className="badminton-custom-charge-modal badminton-check-in-modal" role="dialog"><div className="badminton-modal-title"><div><p className="badminton-kicker">เช็กชื่อผู้เล่น</p><h2>{pendingCheckIn.participantName} มาถึงแล้ว</h2></div><button aria-label="ปิด" onClick={() => setPendingCheckIn(null)} type="button"><X size={19} /></button></div><p>ลงชื่อไว้เวลา <strong>{pendingCheckIn.plannedArrival} น.</strong> ตอนนี้ประมาณ <strong>{pendingCheckIn.suggestedArrival} น.</strong></p><div className="badminton-check-in-actions"><button className="badminton-secondary" onClick={() => completeCheckIn(pendingCheckIn, false)} type="button">ใช้เวลาเดิม {pendingCheckIn.plannedArrival}</button><button className="badminton-primary" onClick={() => completeCheckIn(pendingCheckIn, true)} type="button">ปรับเป็น {pendingCheckIn.suggestedArrival}</button></div></div></div> : null}
      {pendingDeparture ? <div className="badminton-modal-backdrop" role="presentation"><form aria-label="บันทึกเวลากลับและจำนวนลูกแบด" className="badminton-custom-charge-modal" onSubmit={async (submitEvent) => {
        submitEvent.preventDefault();
        const affectedLocked = settlement.rows.filter((entry) => entry.billingFinalized && entry.leftAt === pendingDeparture.leftAt);
        if (affectedLocked.length && !window.confirm(`เวลา ${pendingDeparture.leftAt} มี ${affectedLocked.length} คนที่สรุปยอดแล้ว ยอดเหล่านั้นจะไม่ถูกเปลี่ยนอัตโนมัติ แต่คนที่ยังไม่สรุปจะคำนวณใหม่ ดำเนินการต่อไหม?`)) return;
        const saved = await mutate(async () => {
          await saveDepartureAndLock({
            memberId: pendingDeparture.memberId,
            participantName: pendingDeparture.participantName,
            plannedArrival: pendingDeparture.plannedArrival,
            leftAt: pendingDeparture.leftAt,
            cumulativeCount: pendingDeparture.cumulativeCount,
          });
        }, event.billingModel === "per_round"
          ? `สร้าง Snapshot และล็อกยอดของ ${pendingDeparture.participantName} แล้ว`
          : `บันทึกเวลากลับและล็อกยอดของ ${pendingDeparture.participantName} แล้ว`);
        if (saved) setPendingDeparture(null);
      }}><div className="badminton-modal-title"><div><p className="badminton-kicker">ผู้เล่นกลับก่อน</p><h2>{pendingDeparture.participantName} · {pendingDeparture.leftAt} น.</h2></div><button aria-label="ปิด" onClick={() => setPendingDeparture(null)} type="button"><X size={19} /></button></div><p>ตอนเวลานี้ใช้ลูกแบดสะสมไปทั้งหมดกี่ลูก?</p><label>จำนวนลูกแบดสะสม<input autoFocus min="0" onChange={(changeEvent) => setPendingDeparture({ ...pendingDeparture, cumulativeCount: changeEvent.target.value })} placeholder="กรอกจำนวนที่ใช้จริง" required type="number" value={pendingDeparture.cumulativeCount} /></label>{event.billingModel === "per_round" ? <small className="badminton-settings-help">ระบบจะเก็บยอดสะสมของทุกคนเป็น Snapshot และล็อกยอดของคนนี้ เกมที่กำลังเล่นครบ 11 นาทีจะนับในช่วงนี้ ส่วนเกมที่ยังไม่ถึง 11 นาทีจะไปคิดช่วงถัดไป</small> : <small className="badminton-settings-help">บันทึกครั้งเดียว ระบบจะล็อกยอดของคนนี้ให้ทันที และใช้จำนวนลูกนี้ร่วมกับคนที่กลับเวลาเดียวกัน</small>}<button className="badminton-primary" type="submit"><Check size={17} /> {event.billingModel === "per_round" ? "บันทึก Snapshot และล็อกยอด" : "บันทึกและล็อกยอด"}</button></form></div> : null}
    </section>
  );
}

function PricingPanel({ event, mutate, session, settlement }) {
  const [editingCourt, setEditingCourt] = useState(false);
  const [editingShuttle, setEditingShuttle] = useState(false);
  const [shuttleBatch, setShuttleBatch] = useState("");
  const [shuttleTotalDraft, setShuttleTotalDraft] = useState(String(event.shuttlecockCount || 0));
  const [shuttleBusy, setShuttleBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [checkpoint, setCheckpoint] = useState({ time: event.endTime, count: String(event.shuttlecockCount || 0) });
  const shuttleMutationRef = useRef(false);
  const courtHours = totalCourtHours(event.courts);
  const courtCost = courtHours * event.courtHourlyRate;
  const shuttleCost = event.shuttlecockCount * event.shuttlecockUnitPrice;
  const otherCost = event.extraCosts.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const sharedCost = courtCost + shuttleCost + otherCost;
  const exemptRows = settlement.rows.filter((row) => row.paymentExempt);
  const exemptTotal = exemptRows.reduce((sum, row) => sum + Number(row.roundedDue || 0), 0);

  useEffect(() => {
    setShuttleTotalDraft(String(event.shuttlecockCount || 0));
    setCheckpoint((current) => ({ ...current, count: String(event.shuttlecockCount || 0) }));
  }, [event.id, event.shuttlecockCount]);

  function currentShuttleCheckpointTime() {
    return suggestShuttlecockCheckpointTime({
      eventDate: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
    });
  }

  async function addShuttlecocks(increment) {
    const count = Number(increment);
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      window.alert("กรุณากรอกจำนวนที่ต้องการเพิ่มตั้งแต่ 1 ถึง 100 ลูก");
      return;
    }
    if (shuttleMutationRef.current) return;
    shuttleMutationRef.current = true;
    setShuttleBusy(true);
    const checkpointTime = currentShuttleCheckpointTime();
    try {
      const saved = await mutate(
        () => incrementEventShuttlecockCount({ eventId: event.id, increment: count, checkpointTime }),
        `เพิ่มลูกแบด ${count} ลูกแล้ว · บันทึกช่วงเวลา ${checkpointTime}`,
      );
      if (saved) setShuttleBatch("");
    } finally {
      shuttleMutationRef.current = false;
      setShuttleBusy(false);
    }
  }

  async function saveShuttlecockTotal(submitEvent) {
    submitEvent.preventDefault();
    const nextCount = Number(shuttleTotalDraft);
    const currentCount = Math.max(0, Number(event.shuttlecockCount) || 0);
    if (!Number.isInteger(nextCount) || nextCount < 0 || nextCount > 1000) {
      window.alert("จำนวนลูกแบดรวมต้องเป็นเลขเต็มตั้งแต่ 0 ถึง 1,000 ลูก");
      setShuttleTotalDraft(String(currentCount));
      return;
    }
    if (nextCount === currentCount) return;
    const finalizedRows = settlement.rows.filter((row) => row.billingFinalized);
    const paidAffectedRows = finalizedRows.filter((row) => row.paid && Number(row.shuttlecockCountSnapshot || 0) > nextCount);
    if (nextCount < currentCount && paidAffectedRows.length) {
      window.alert(`แก้เป็น ${nextCount} ลูกไม่ได้ เพราะมีผู้เล่น ${paidAffectedRows.length} คนชำระเงินจากยอดลูกแบดเดิมแล้ว\n\nกรุณาตรวจสอบยอดที่รับเงินจริงก่อนแก้ข้อมูล`);
      setShuttleTotalDraft(String(currentCount));
      return;
    }
    const unpaidFinalizedCount = finalizedRows.filter((row) => !row.paid).length;
    const correctionWarning = nextCount < currentCount && unpaidFinalizedCount
      ? `\n\nระบบจะเปิดยอดค้างที่สรุปแล้ว ${unpaidFinalizedCount} คนกลับมาคำนวณใหม่ทั้งหมด เพื่อไม่ให้แต่ละคนใช้ฐานจำนวนลูกไม่เท่ากัน หลังแก้แล้วต้องตรวจและสรุปยอดคนเหล่านี้อีกครั้ง`
      : "";
    if (!window.confirm(`ยืนยันแก้จำนวนลูกแบดรวมจาก ${currentCount} เป็น ${nextCount} ลูก?\n\nใช้เมนูนี้เฉพาะกรณีบันทึกยอดผิด${correctionWarning}`)) {
      setShuttleTotalDraft(String(currentCount));
      return;
    }
    if (shuttleMutationRef.current) return;
    shuttleMutationRef.current = true;
    setShuttleBusy(true);
    const checkpointTime = currentShuttleCheckpointTime();
    try {
      const useSafeCorrection = nextCount < currentCount && finalizedRows.length > 0;
      await mutate(async () => {
        const result = useSafeCorrection
          ? await correctEventShuttlecockCount({ eventId: event.id, count: nextCount, checkpointTime })
          : await setEventShuttlecockCount({ eventId: event.id, count: nextCount, checkpointTime });
        return result;
      }, useSafeCorrection
        ? `แก้จำนวนลูกแบดเป็น ${nextCount} ลูก และเปิดยอดค้างกลับมาคำนวณใหม่แล้ว`
        : `แก้จำนวนลูกแบดรวมเป็น ${nextCount} ลูกแล้ว`);
    } finally {
      shuttleMutationRef.current = false;
      setShuttleBusy(false);
    }
  }

  function changeBillingModel(nextModel) {
    if (nextModel === event.billingModel) return;
    if (event.status === "closed" || settlement.rows.some((row) => row.billingFinalized)) {
      window.alert("เปลี่ยนวิธีคิดเงินไม่ได้ เนื่องจากรอบนี้เริ่มสรุปยอดแล้ว");
      return;
    }
    const nextLabel = nextModel === "per_round" ? "ตามจำนวนรอบที่เล่น" : "ตามเวลาที่อยู่จริง";
    const warning = nextModel === "per_round"
      ? "ค่าสนาม ลูกแบด และค่าใช้จ่ายส่วนกลางจะหารตามจำนวนเกมที่เล่น ผู้เล่นที่กลับก่อนสามารถล็อกยอดด้วย Snapshot ส่วนคนที่ยังอยู่จะสรุปยอดเมื่อจบรอบ"
      : "ค่าสนามและลูกแบดจะกลับมาหารตามช่วงเวลาที่ผู้เล่นอยู่จริง";
    if (!window.confirm(`เปลี่ยนวิธีคิดเงินเป็น “${nextLabel}” ใช่ไหม?\n\n${warning}`)) return;
    mutate(async () => {
      await updateEvent(event.id, { billing_model: nextModel });
      await recordAudit({
        clubId: event.clubId,
        eventId: event.id,
        userId: session.user.id,
        action: `เปลี่ยนวิธีคิดเงินเป็น ${nextLabel}`,
        details: { from: event.billingModel, to: nextModel },
      });
    }, `เปลี่ยนวิธีคิดเงินเป็น ${nextLabel} แล้ว`);
  }

  return (
    <section className="badminton-card badminton-pricing-card">
      <div className="badminton-card-title badminton-pricing-title"><Calculator size={20} /><div><h2>ค่าใช้จ่ายรวม</h2></div><strong>{baht(sharedCost)} บาท</strong></div>
      <div className="badminton-billing-method">
        <div><strong>วิธีคิดค่าใช้จ่าย</strong><span>{event.billingModel === "per_round" ? "หารค่าส่วนกลางตามจำนวนเกมที่เล่นจบ" : "หารค่าส่วนกลางตามช่วงเวลาที่อยู่จริง"}</span></div>
        <div aria-label="เลือกวิธีคิดค่าใช้จ่าย" role="group">
          <button className={event.billingModel !== "per_round" ? "is-active" : ""} disabled={event.status === "closed" || settlement.rows.some((row) => row.billingFinalized)} onClick={() => changeBillingModel("time_segmented")} type="button">ตามเวลา</button>
          <button className={event.billingModel === "per_round" ? "is-active" : ""} disabled={event.status === "closed" || settlement.rows.some((row) => row.billingFinalized)} onClick={() => changeBillingModel("per_round")} type="button">ตามจำนวนรอบ</button>
        </div>
        {event.billingModel === "per_round" ? <small>จบแล้ว {event.completedGameCount} เกม · รวม {event.attendance.reduce((sum, row) => sum + Number(row.roundsPlayed || 0), 0)} รอบผู้เล่น{settlement.totalUnits > 0 ? ` · ประมาณ ${baht(settlement.unitPrice)} บาท/คน/รอบ` : " · ยังไม่มีเกมที่จบ"}</small> : null}
      </div>
      <div className="badminton-pricing-grid">
        <article className="badminton-price-box badminton-court-summary-box">
          <div className="badminton-price-head"><span>สรุปคอร์ท</span><strong>{baht(courtCost)} บาท</strong></div>
          <div className="badminton-court-summary-list">{event.courts.map((court) => <span key={court.id}><strong>{court.name}</strong> {court.startsAt}–{court.endsAt === "00:00" ? "24:00" : court.endsAt} · {formatPlayedDuration(minutesBetween(court.startsAt, court.endsAt))}</span>)}</div>
          <div className="badminton-price-setting">
            {editingCourt ? <input autoFocus min="0" type="number" defaultValue={event.courtHourlyRate} onBlur={(e) => { setEditingCourt(false); mutate(() => updateEventPriceAndDefault({ clubId: event.clubId, eventId: event.id, eventDate: event.date, priceType: "court", value: e.target.value }), "แก้ราคาคอร์ดและบันทึกเป็นค่าเริ่มต้นของวันนี้แล้ว"); }} /> : <span>{baht(event.courtHourlyRate)} บาท/ชม.</span>}
            <button className="badminton-edit-price" onClick={() => setEditingCourt(true)} type="button">แก้ราคา</button>
          </div>
        </article>
        <article className="badminton-price-box badminton-shuttle-box">
          <div className="badminton-shuttle-counter-head"><div><span>ลูกแบดที่ใช้แล้ว</span><strong>{event.shuttlecockCount}<small> ลูก</small></strong></div><div><span>ค่าลูกแบด</span><b>{baht(shuttleCost)} บาท</b></div></div>
          <button className="badminton-shuttle-plus-one" disabled={shuttleBusy} onClick={() => addShuttlecocks(1)} type="button"><Plus size={24} /> {shuttleBusy ? "กำลังบันทึก..." : "เพิ่ม 1 ลูก"}</button>
          <form className="badminton-shuttle-bulk-form" onSubmit={(submitEvent) => { submitEvent.preventDefault(); addShuttlecocks(shuttleBatch); }}>
            <label><span>เพิ่มหลายลูก</span><input aria-label="จำนวนลูกแบดที่ต้องการเพิ่ม" disabled={shuttleBusy} inputMode="numeric" max="100" min="1" onChange={(changeEvent) => setShuttleBatch(changeEvent.target.value)} placeholder="เช่น 12" required type="number" value={shuttleBatch} /></label>
            <button className="badminton-secondary" disabled={shuttleBusy} type="submit"><Plus size={16} /> เพิ่ม</button>
          </form>
          <small className="badminton-shuttle-auto-note">{event.billingModel === "per_round" ? "ค่าลูกแบดทั้งหมดจะรวมเป็นค่าใช้จ่ายส่วนกลาง แล้วหารตามจำนวนรอบที่ผู้เล่นแต่ละคนเล่นจบ" : "ทุกครั้งที่เพิ่ม ระบบจะบันทึกช่วงเวลา 15 นาทีอัตโนมัติ หากไม่ได้บันทึกตามเวลาเลย ระบบจะหารค่าลูกตามชั่วโมงที่แต่ละคนเล่นจริง"}</small>
          <form className="badminton-shuttle-total-form" onSubmit={saveShuttlecockTotal}>
            <label><span>แก้ยอดรวม</span><input aria-label="แก้จำนวนลูกแบดรวม" disabled={shuttleBusy} inputMode="numeric" max="1000" min="0" onChange={(changeEvent) => setShuttleTotalDraft(changeEvent.target.value)} type="number" value={shuttleTotalDraft} /></label>
            <button className="badminton-edit-price" disabled={shuttleBusy || Number(shuttleTotalDraft) === Number(event.shuttlecockCount)} type="submit">บันทึก</button>
          </form>
          <div className="badminton-price-setting">
            {editingShuttle ? <input autoFocus min="0" type="number" defaultValue={event.shuttlecockUnitPrice} onBlur={(e) => { setEditingShuttle(false); mutate(() => updateEventPriceAndDefault({ clubId: event.clubId, eventId: event.id, eventDate: event.date, priceType: "shuttlecock", value: e.target.value }), "แก้ราคาลูกแบดและบันทึกเป็นค่าเริ่มต้นแล้ว"); }} /> : <span>{baht(event.shuttlecockUnitPrice)} บาท/ลูก</span>}
            <button className="badminton-edit-price" onClick={() => setEditingShuttle(true)} type="button">แก้ราคา</button>
          </div>
        </article>
      </div>
      {event.billingModel === "time_segmented" ? (
        <div className="badminton-shuttle-checkpoints">
          <div className="badminton-checkpoint-heading"><div><strong>บันทึกลูกแบดตามเวลา</strong><span>ใส่จำนวนลูกสะสม ณ เวลานั้น ระบบจะใช้จุดเดียวกันกับทุกคนที่กลับเวลาเดียวกัน</span></div></div>
          <form className="badminton-checkpoint-form" onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            const existing = (event.shuttlecockCheckpoints || []).find((item) => item.time === checkpoint.time);
            const lockedCount = settlement.rows.filter((row) => row.billingFinalized).length;
            if (lockedCount && (!existing || Number(existing.cumulativeCount) !== Number(checkpoint.count)) && !window.confirm(`มีผู้เล่น ${lockedCount} คนที่สรุปยอดแล้ว ยอดเหล่านั้นจะไม่เปลี่ยนอัตโนมัติ แต่ยอดที่ยังไม่สรุปจะคำนวณใหม่ ดำเนินการต่อไหม?`)) return;
            mutate(() => upsertShuttlecockCheckpoint({
              clubId: event.clubId,
              eventId: event.id,
              time: checkpoint.time,
              cumulativeCount: checkpoint.count,
              userId: session.user.id,
            }), `บันทึกลูกแบดสะสม ${checkpoint.count} ลูก เวลา ${checkpoint.time} แล้ว`);
          }}>
            <label><span>เวลา</span><select value={checkpoint.time} onChange={(changeEvent) => setCheckpoint({ ...checkpoint, time: changeEvent.target.value })}>{buildTimeOptions(event.startTime, event.endTime).map((time) => <option key={time} value={time}>{time}</option>)}</select></label>
            <label><span>จำนวนสะสม</span><input min="0" required type="number" value={checkpoint.count} onChange={(changeEvent) => setCheckpoint({ ...checkpoint, count: changeEvent.target.value })} /></label>
            <button className="badminton-secondary" type="submit"><Plus size={16} /> บันทึก</button>
          </form>
          <div className="badminton-checkpoint-list">
            {(event.shuttlecockCheckpoints || []).length ? event.shuttlecockCheckpoints.map((item) => <span key={item.id}><strong>{item.time}</strong> {item.cumulativeCount} ลูก<button aria-label={`ลบจุดบันทึกเวลา ${item.time}`} onClick={() => { const lockedCount = settlement.rows.filter((row) => row.billingFinalized).length; if (lockedCount) { window.alert(`ลบจุดบันทึกไม่ได้ เพราะมีผู้เล่น ${lockedCount} คนที่สรุปยอดแล้ว\n\nหากจำนวนรวมผิด ให้ใช้ช่อง “แก้ยอดรวม” เพื่อให้ระบบเปิดยอดค้างและคำนวณใหม่อย่างปลอดภัย`); return; } if (window.confirm(`ลบข้อมูลลูกแบดเวลา ${item.time} ใช่ไหม?`)) mutate(() => removeShuttlecockCheckpoint(item.id, event.id), "ลบจุดบันทึกลูกแบดแล้ว"); }} type="button"><X size={14} /></button></span>) : <small>ยังไม่มีจุดบันทึก ระบบจะใช้จำนวนสุดท้ายตอนจบรอบ</small>}
          </div>
        </div>
      ) : null}
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
      <div className="badminton-exempt-cost-summary">
        <span><strong>ค่าใช้จ่ายรวมของคนที่ไม่ต้องเก็บเงิน</strong><small>{exemptRows.length} คน · ยังคงนำไปร่วมคำนวณค่าใช้จ่ายของรอบ</small></span>
        <b>{baht(exemptTotal)} บาท</b>
      </div>
    </section>
  );
}

function SettlementPanel({ context, event, mutate, previousOutstanding, session, settlement }) {
  const [copied, setCopied] = useState(false);
  const [billDraft, setBillDraft] = useState(null);
  const [paymentView, setPaymentView] = useState("current");
  const [paymentSettingsOpen, setPaymentSettingsOpen] = useState(false);
  const pendingSlipCount = event.paymentSlips?.length || 0;
  const lineSummary = useMemo(() => buildLineSummary(event), [event]);
  const perRoundAwaitingClose = event.billingModel === "per_round" && event.status !== "closed";
  const collectionRows = [...settlement.rows]
    .filter((row) => !row.paymentExempt)
    .sort((left, right) => Number(left.signupOrder || Number.MAX_SAFE_INTEGER) - Number(right.signupOrder || Number.MAX_SAFE_INTEGER));
  const previousRows = (previousOutstanding.rows || []).filter((row) => row.event_id !== event.id);
  const previousTotal = previousRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const collectionSummary = finalizedCollectionSummary(collectionRows, previousTotal);
  const paymentComplete = collectionSummary.paymentComplete;
  const roundPaymentStatus = collectionSummary.finalizedCount < collectionSummary.collectableCount
    ? `รอสรุปยอด ${collectionSummary.collectableCount - collectionSummary.finalizedCount} คน`
    : paymentComplete
      ? "ชำระครบแล้ว"
      : "สรุปครบแล้ว · รอชำระ";
  const outstandingGroups = useMemo(() => {
    const grouped = new Map();
    (previousOutstanding.rows || []).forEach((row) => {
      const current = grouped.get(row.member_id) || { member: row.member, rows: [], total: 0 };
      current.rows.push(row);
      current.total += Number(row.amount || 0);
      grouped.set(row.member_id, current);
    });
    return [...grouped.values()].sort((left, right) => left.member.nickname?.localeCompare(right.member.nickname || "", "th"));
  }, [previousOutstanding.rows]);

  async function copySummary() {
    await navigator.clipboard.writeText(lineSummary);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function togglePayment(row) {
    if (perRoundAwaitingClose && !row.billingFinalized) {
      window.alert("ผู้เล่นที่กลับก่อนให้กำหนดเวลากลับในหน้าผู้เล่นเพื่อสร้าง Snapshot ส่วนคนที่ยังเล่นอยู่จะสรุปยอดได้หลังจบรอบ");
      return undefined;
    }
    if (!row.billingFinalized) {
      setBillDraft({ row, amount: String(row.roundedDue) });
      return undefined;
    }
    const nextPaid = !row.paid;
    return mutate(async () => {
      await setPayment({
        clubId: event.clubId,
        eventId: event.id,
        memberId: row.memberId,
        amount: row.billedAmount,
        sharedAmount: row.sharedDue,
        extrasAmount: row.extraAmount,
        shuttlecockCount: event.shuttlecockCount,
        paid: nextPaid,
        userId: session.user.id,
      });
      await recordAudit({
        clubId: event.clubId,
        eventId: event.id,
        userId: session.user.id,
        action: nextPaid
          ? `รับเงิน ${row.name} จำนวน ${baht(row.billedAmount)} บาท`
          : `ยกเลิกสถานะรับเงินของ ${row.name}`,
        details: {
          member_id: row.memberId,
          amount: row.billedAmount,
          paid: nextPaid,
        },
      });
    }, nextPaid ? `รับเงิน ${row.name} และล็อกยอดแล้ว` : "ยกเลิกสถานะรับเงินแล้ว");
  }

  function confirmBill(submitEvent) {
    submitEvent.preventDefault();
    if (perRoundAwaitingClose) {
      window.alert("กรุณาจบรอบก่อนสรุปยอดตามจำนวนเกมที่เล่น");
      return;
    }
    if (!billDraft?.row) return;
    const billedAmount = Number(billDraft.amount);
    if (!Number.isFinite(billedAmount) || billedAmount < 0) {
      window.alert("กรุณากรอกยอดเรียกเก็บเป็นตัวเลขตั้งแต่ 0 บาท");
      return;
    }
    const row = billDraft.row;
    const previousBilledAmount = row.billingFinalized ? Number(row.billedAmount) : null;
    mutate(async () => {
      await finalizeMemberBill({
        clubId: event.clubId,
        eventId: event.id,
        memberId: row.memberId,
        calculatedAmount: row.billingFinalized && row.calculatedAmount !== null
          ? row.calculatedAmount
          : row.roundedDue,
        billedAmount,
        sharedAmount: row.sharedDue,
        extrasAmount: row.extraAmount,
        shuttlecockCount: event.shuttlecockCount,
        userId: session.user.id,
      });
      await recordAudit({
        clubId: event.clubId,
        eventId: event.id,
        userId: session.user.id,
        action: `${previousBilledAmount === null ? "สรุป" : "แก้"}ยอดเรียกเก็บ ${row.name} เป็น ${baht(billedAmount)} บาท`,
        details: {
          member_id: row.memberId,
          calculated_amount: row.billingFinalized && row.calculatedAmount !== null
            ? row.calculatedAmount
            : row.roundedDue,
          billed_amount: billedAmount,
          previous_billed_amount: previousBilledAmount,
          adjustment: billedAmount - Number(row.billingFinalized && row.calculatedAmount !== null
            ? row.calculatedAmount
            : row.roundedDue),
        },
      });
    }, `สรุปยอด ${row.name} เป็น ${baht(billedAmount)} บาทแล้ว`);
    setBillDraft(null);
  }

  function reviewSlip(slip, approved) {
    const roundCount = slip.paymentRounds?.length || slip.payment_ids?.length || 1;
    const expectedAmount = Number(slip.expected_amount || 0);
    const transferredAmount = slip.transferred_amount === null || slip.transferred_amount === undefined
      ? null
      : Number(slip.transferred_amount);
    const amountLabel = transferredAmount === null
      ? `${baht(expectedAmount)} บาท`
      : `${baht(transferredAmount)} บาท`;
    const message = approved
      ? slip.allPaymentsPaid
        ? `ยอดของ ${slip.beneficiaryName} ถูกบันทึกว่ารับเงินแล้ว\n\nยืนยันปิดรายการสลิปนี้ออกจากหน้าตรวจสอบโดยไม่ตัดยอดซ้ำ?`
        : `ยืนยันรับเงิน ${amountLabel} ให้ ${slip.beneficiaryName} จำนวน ${roundCount} รอบ?\n\nระบบจะตัดยอดของทุกรอบที่เลือกพร้อมกัน`
      : slip.hasMissingPaymentData
        ? `ยืนยันปิดรายการเก่าของ ${slip.beneficiaryName}?\n\nระบบไม่พบยอดที่เคยผูกกับสลิปนี้ การปิดรายการจะไม่แก้สถานะรับเงินของรอบใด`
        : `ปฏิเสธสลิปของ ${slip.beneficiaryName} ใช่ไหม?\n\nยอด ${baht(expectedAmount)} บาทจะกลับไปรอชำระ และสมาชิกสามารถส่งสลิปใหม่ได้`;
    if (!window.confirm(message)) return undefined;
    return mutate(async () => {
      await reviewPaymentSlip({ slip, approved, userId: session.user.id });
      await recordAudit({
        clubId: event.clubId,
        eventId: slip.paymentRounds?.[0]?.id || event.id,
        userId: session.user.id,
        action: `${approved ? "อนุมัติ" : "ปฏิเสธ"}สลิปของ ${slip.beneficiaryName}`,
        details: {
          slip_id: slip.id,
          expected_amount: slip.expected_amount,
          transferred_amount: slip.transferred_amount,
          approved,
        },
      });
    }, approved ? `รับเงิน ${slip.beneficiaryName} จากสลิปแล้ว` : "ปฏิเสธสลิปและคืนสถานะเป็นรอชำระแล้ว");
  }

  async function openSlipImage(slip) {
    const preview = window.open("", "_blank");
    try {
      const signedUrl = await getPaymentSlipImageUrl(slip.storage_path);
      if (preview) preview.location.href = signedUrl;
      else window.location.href = signedUrl;
    } catch (nextError) {
      if (preview) preview.close();
      window.alert(nextError.message || "เปิดรูปสลิปไม่สำเร็จ");
    }
  }

  function settleOutstanding(row) {
    const name = memberName(row.member);
    if (!window.confirm(`ยืนยันว่า ${name} จ่ายรอบ ${formatRoundOption(row.event.event_date)} จำนวน ${baht(row.amount)} บาทแล้ว?`)) return;
    mutate(async () => {
      await markOutstandingPaymentPaid({ paymentId: row.id, paid: true, userId: session.user.id });
      await recordAudit({
        clubId: event.clubId,
        eventId: row.event_id,
        userId: session.user.id,
        action: `รับเงินยอดค้าง ${name} จำนวน ${baht(row.amount)} บาท`,
        details: { payment_id: row.id, member_id: row.member_id },
      });
    }, `รับเงินยอดค้างของ ${name} แล้ว`);
  }

  function PaymentSubtabs() {
    return (
      <div className="badminton-payment-subtabs" role="tablist">
        <button aria-selected={paymentView === "current"} className={paymentView === "current" ? "is-active" : ""} onClick={() => setPaymentView("current")} role="tab" type="button">รอบนี้</button>
        <button aria-selected={paymentView === "outstanding"} className={paymentView === "outstanding" ? "is-active" : ""} onClick={() => setPaymentView("outstanding")} role="tab" type="button">ยอดค้าง <span>{previousOutstanding.count}</span></button>
        <button aria-selected={paymentView === "slips"} className={paymentView === "slips" ? "is-active" : ""} onClick={() => setPaymentView("slips")} role="tab" type="button">ตรวจสอบสลิป <span className={pendingSlipCount ? "has-pending" : ""}>{pendingSlipCount}</span></button>
      </div>
    );
  }

  if (paymentView === "slips") {
    return (
      <section className="badminton-card badminton-settlement-card" id="settlement">
        <PaymentSubtabs />
        <SlipReviewPanel onOpen={openSlipImage} onReview={reviewSlip} showEmpty slips={event.paymentSlips} />
      </section>
    );
  }

  if (paymentView === "outstanding") {
    return (
      <section className="badminton-card badminton-settlement-card" id="settlement">
        <PaymentSubtabs />
        <div className="badminton-card-title"><WalletCards size={20} /><div><h2>คนที่ค้างจ่าย</h2><p>{outstandingGroups.length} คน · {previousOutstanding.count} รอบ</p></div><strong>{baht(previousOutstanding.total)} บาท</strong></div>
        <div className="badminton-outstanding-list">
          {outstandingGroups.length ? outstandingGroups.map((group) => {
            const nickname = memberName(group.member);
            const lineName = String(group.member.display_name || "").trim();
            const lineLabel = lineName && lineName !== nickname ? `LINE: ${lineName} · ` : "";
            return <details key={group.member.id}><summary><span><strong>{nickname}</strong><small>{lineLabel}{group.rows.length} รอบ</small></span><b>{baht(group.total)} บาท</b></summary><div>{group.rows.map((row) => <article key={row.id}><span><strong>{formatRoundOption(row.event.event_date)}</strong><small>{row.event.venue}</small></span><b>{baht(row.amount)} บาท</b><button className="badminton-primary" onClick={() => settleOutstanding(row)} type="button"><Check size={15} /> จ่ายรอบนี้แล้ว</button></article>)}</div></details>;
          }) : <div className="badminton-empty"><Check size={20} /> ไม่มีใครค้างจ่าย</div>}
        </div>
      </section>
    );
  }

  return (
    <section className="badminton-card badminton-settlement-card" id="settlement">
      <PaymentSubtabs />
      <div className="badminton-payment-workspace">
        <div className="badminton-card-title badminton-payment-heading"><ReceiptText size={20} /><div><h2>สรุปยอด</h2></div><button aria-label="ตั้งค่าข้อความชำระเงินใน LINE" className="badminton-payment-settings-button" onClick={() => setPaymentSettingsOpen(true)} title="ตั้งค่าข้อความชำระเงินใน LINE" type="button"><Settings size={18} /></button></div>
        {perRoundAwaitingClose ? <div className="badminton-per-round-pending"><Timer size={18} /><div><strong>กำลังคำนวณตามจำนวนรอบ</strong><span>ผู้เล่นที่กลับก่อนสามารถล็อกยอดด้วย Snapshot จากหน้าผู้เล่น ส่วนคนที่ยังเล่นอยู่จะสรุปยอดเมื่อจบรอบ</span></div></div> : null}
        <div className={`badminton-settlement-overview ${paymentComplete ? "is-settled" : ""}`}>
          <div className="badminton-current-round-total"><span>ยอดที่สรุปแล้วรอบนี้</span><strong>{baht(collectionSummary.currentTotal)} บาท</strong><small>{collectionSummary.finalizedCount}/{collectionSummary.collectableCount} คน</small></div>
          <div className="badminton-summary-line"><span>ยอดค้างจากรอบก่อน</span><strong>{baht(previousTotal)} บาท</strong></div>
          <div className="badminton-summary-grand-total"><span>รวมทั้งหมด</span><strong>{baht(collectionSummary.combinedTotal)} บาท</strong></div>
          <div className="badminton-round-payment-status">
            <Check size={16} />
            <span>{roundPaymentStatus}</span>
          </div>
        </div>
        <div className="badminton-card-title badminton-payment-list-title"><WalletCards size={19} /><div><h2>ค่าใช้จ่ายรายคน</h2></div></div>
        <div className="badminton-pay-list">
          {collectionRows.map((row) => {
            const extraLabel = formatExtraItems(row.extraCharges);
            return <article className={`badminton-pay-row ${row.billingFinalized ? "is-billed" : ""} ${row.paid ? "is-paid" : ""}`} key={row.memberId}>
              <div className="badminton-pay-person"><strong>{row.signupOrder ? `${row.signupOrder}. ` : ""}{row.name}</strong><span>{event.billingModel === "per_round" ? `${row.roundsPlayed || 0} รอบ` : formatPlayedDuration(Number(row.hours) * 60)}</span>{extraLabel ? <details className="badminton-pay-extras"><summary>{extraLabel}</summary><div>{row.extraCharges.map((charge) => <span key={charge.id || `${charge.name}-${charge.unitPrice}`}>{charge.name} × {charge.quantity || 1} = {baht(Number(charge.unitPrice) * Number(charge.quantity || 1))} บาท</span>)}</div></details> : null}{row.billingFinalized ? <small>{row.paid ? "ชำระแล้ว" : "สรุปยอดแล้ว · รอชำระ"}{row.overpaymentAmount > 0 ? ` · โอนเกิน ${baht(row.overpaymentAmount)} บาท` : ""}</small> : <small>{perRoundAwaitingClose ? "รอจบรอบก่อนสรุปยอด" : "ยังไม่ได้สรุปยอด"}</small>}</div>
              <strong className={`badminton-pay-amount ${row.billingFinalized ? "" : "is-unfinalized"}`}>{row.billingFinalized ? `${baht(row.billedAmount)} บาท` : "ยังไม่สรุป"}{row.billingFinalized && !row.paid ? <button aria-label={`แก้ยอดเรียกเก็บของ ${row.name}`} className="badminton-edit-bill" onClick={() => setBillDraft({ row, amount: String(row.billedAmount) })} title="แก้ยอดเรียกเก็บ" type="button"><Pencil size={13} /></button> : null}</strong>
              <button className={row.paid ? "is-paid" : row.billingFinalized ? "is-awaiting" : ""} disabled={perRoundAwaitingClose && !row.billingFinalized} onClick={() => togglePayment(row)} type="button">{row.paid || row.billingFinalized ? <Check size={16} /> : perRoundAwaitingClose ? <Timer size={16} /> : <WalletCards size={16} />} {row.paid ? "จ่ายแล้ว" : row.billingFinalized ? "รับเงินแล้ว" : perRoundAwaitingClose ? "รอจบรอบ" : "สรุปยอด"}</button>
            </article>;
          })}
        </div>
        {collectionSummary.finalizedCount > 0 && lineSummary.trim() ? <><textarea readOnly value={lineSummary} /><button className="badminton-primary" onClick={copySummary} type="button"><Copy size={18} /> {copied ? "คัดลอกแล้ว" : "คัดลอกสรุปส่ง LINE"}</button></> : <p className="badminton-note">กด “สรุปยอด” ของผู้เล่นก่อน จึงจะมีข้อความยอดเรียกเก็บสำหรับส่ง LINE</p>}
      </div>
      {paymentSettingsOpen ? <div className="badminton-modal-backdrop" role="presentation"><div aria-label="ตั้งค่าข้อความชำระเงินใน LINE" aria-modal="true" className="badminton-custom-charge-modal badminton-payment-settings-modal" role="dialog"><div className="badminton-modal-title"><div><p className="badminton-kicker">ตั้งค่าชำระเงิน</p><h2>ข้อความที่บอทส่ง</h2></div><button aria-label="ปิดการตั้งค่าชำระเงิน" onClick={() => setPaymentSettingsOpen(false)} type="button"><X size={19} /></button></div><label className="badminton-line-payment-summary-toggle"><span><strong>ส่งรายชื่อพร้อมยอดค่าใช้จ่าย</strong><small>{context.clubs.line_payment_include_summary !== false ? "เปิดอยู่ · ส่งรายชื่อพร้อมยอด แล้วตามด้วยการ์ดชำระเงิน" : "ปิดอยู่ · ส่งเฉพาะการ์ดชำระเงิน"}</small></span><input aria-label="ส่งรายชื่อและยอดค่าใช้จ่ายใน LINE" checked={context.clubs.line_payment_include_summary !== false} onChange={(changeEvent) => mutate(() => updateLinePaymentSummarySetting(context.club_id, changeEvent.target.checked), changeEvent.target.checked ? "เปิดส่งรายชื่อพร้อมยอดใน LINE แล้ว" : "ปิดส่งรายชื่อพร้อมยอดใน LINE แล้ว")} type="checkbox" /></label><p className="badminton-settings-help">ใช้กับคำสั่ง “ชำระเงิน” และ “แจ้งโอน” ใน LINE</p></div></div> : null}
      {billDraft ? <div className="badminton-modal-backdrop" role="presentation"><form aria-label={`สรุปยอดเรียกเก็บ ${billDraft.row.name}`} className="badminton-custom-charge-modal badminton-bill-modal" onSubmit={confirmBill}><div className="badminton-modal-title"><div><p className="badminton-kicker">ยอดเรียกเก็บรายคน</p><h2>{billDraft.row.name}</h2></div><button aria-label="ปิดหน้าต่างสรุปยอด" onClick={() => setBillDraft(null)} type="button"><X size={19} /></button></div><div className="badminton-calculated-amount"><span>ยอดที่ระบบคำนวณ</span><strong>{baht(billDraft.row.billingFinalized && billDraft.row.calculatedAmount !== null ? billDraft.row.calculatedAmount : billDraft.row.roundedDue)} บาท</strong><small>ข้อมูลนี้แสดงเฉพาะแอดมิน สมาชิกจะไม่เห็น</small></div><label>ยอดเรียกเก็บจริง<input autoFocus inputMode="decimal" min="0" onChange={(changeEvent) => setBillDraft({ ...billDraft, amount: changeEvent.target.value })} required step="1" type="number" value={billDraft.amount} /><span>บาท</span></label><p className="badminton-bill-help">เมื่อยืนยัน สมาชิกจะเห็นเฉพาะยอดเรียกเก็บจริง และระบบตรวจสลิปจะเทียบกับยอดนี้</p><button className="badminton-primary" type="submit"><Check size={17} /> ยืนยันยอดเรียกเก็บ</button></form></div> : null}
    </section>
  );
}

function SlipReviewPanel({ slips = [], onOpen, onReview, showEmpty = false }) {
  if (!slips.length) return showEmpty ? <div className="badminton-slip-review is-empty" id="pending-slip-review"><ShieldCheck size={28} /><strong>ไม่มีสลิปรอตรวจสอบ</strong><span>สลิปที่ผ่านอัตโนมัติจะตัดยอดทันที ส่วนรายการที่อ่านไม่ชัดจะมาแสดงที่นี่</span></div> : null;
  const orderedSlips = [...slips].sort((left, right) => String(left.created_at || "").localeCompare(String(right.created_at || "")));
  const expectedTotal = orderedSlips.reduce((sum, slip) => sum + Number(slip.expected_amount || 0), 0);
  const readableAmountCount = orderedSlips.filter((slip) => slip.transferred_amount !== null && slip.transferred_amount !== undefined).length;
  return <div className="badminton-slip-review" id="pending-slip-review">
    <div className="badminton-slip-review-title"><ShieldCheck size={20} /><div><strong>สลิปรออนุมัติ</strong><span>รวมสลิปจากทุกรอบไว้ที่นี่ ตรวจรูปและเหตุผลก่อนตัดยอด</span></div></div>
    <div className="badminton-slip-review-summary"><span><small>รอตรวจ</small><strong>{orderedSlips.length} รายการ</strong></span><span><small>ยอดที่เลือกชำระ</small><strong>{baht(expectedTotal)} บาท</strong></span><span><small>อ่านยอดได้</small><strong>{readableAmountCount}/{orderedSlips.length}</strong></span></div>
    {orderedSlips.map((slip, index) => {
      const expectedAmount = Number(slip.expected_amount || 0);
      const transferredAmount = slip.transferred_amount === null || slip.transferred_amount === undefined
        ? null
        : Number(slip.transferred_amount);
      const amountMatches = transferredAmount !== null && Math.abs(transferredAmount - expectedAmount) < 0.009;
      const amountDifference = transferredAmount === null ? null : transferredAmount - expectedAmount;
      const submittedAt = slip.created_at ? new Date(slip.created_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "";
      return <article className="badminton-slip-review-card" key={slip.id}>
        <div className="badminton-slip-review-card-heading"><span className="badminton-slip-review-number">{index + 1}</span><div><strong>{slip.beneficiaryName}</strong><small>{slip.submittedByName ? `ส่งโดย ${slip.submittedByName}` : ""}{submittedAt ? `${slip.submittedByName ? " · " : ""}${submittedAt}` : ""}</small></div><b>รอตรวจ</b></div>
        {slip.paymentRounds?.length ? <div className="badminton-slip-round-list">{slip.paymentRounds.map((round) => <span key={round.id}><CalendarDays size={13} /><strong>{formatRoundOption(round.date)}</strong><b>{baht(round.amount)} บาท</b>{round.venue ? <small>{round.venue}</small> : null}</span>)}</div> : <p className="badminton-slip-missing-data">ไม่พบยอดที่ผูกกับสลิป อาจเป็นรายการเก่าที่ลบรอบไปแล้ว สามารถกด “ปิดรายการเก่า” ได้</p>}
        {slip.allPaymentsPaid ? <p className="badminton-slip-already-paid"><Check size={15} /> ยอดทุกรอบถูกบันทึกว่ารับเงินแล้ว สามารถปิดรายการนี้ได้โดยไม่ตัดเงินซ้ำ</p> : null}
        <div className="badminton-slip-amount-comparison"><span><small>ยอดที่ระบบเรียกเก็บ</small><strong>{baht(expectedAmount)} บาท</strong></span><span className={transferredAmount === null ? "is-unclear" : amountMatches ? "is-matched" : "is-mismatched"}><small>ยอดที่อ่านจากสลิป</small><strong>{transferredAmount === null ? "อ่านไม่ชัด" : `${baht(transferredAmount)} บาท`}</strong></span></div>
        {amountDifference !== null && !amountMatches ? <p className="badminton-slip-warning">ยอดในสลิป{amountDifference > 0 ? "มากกว่า" : "น้อยกว่า"}ยอดที่เลือก {baht(Math.abs(amountDifference))} บาท</p> : null}
        <div className="badminton-slip-review-reason"><strong>เหตุผลที่ต้องตรวจ</strong><span>{slip.review_reason || "ระบบไม่สามารถยืนยันข้อมูลครบทุกเงื่อนไขได้"}</span></div>
        <div className="badminton-slip-review-meta">{slip.transferred_on ? <span>วันที่โอน {formatRoundOption(slip.transferred_on)}</span> : <span className="is-unclear">วันที่อ่านไม่ชัด</span>}{slip.transaction_reference ? <span>อ้างอิง …{String(slip.transaction_reference).slice(-6)}</span> : <span className="is-unclear">เลขอ้างอิงอ่านไม่ชัด</span>}{Number.isFinite(Number(slip.ocr_confidence)) ? <span>ความชัด {Math.round(Number(slip.ocr_confidence))}%</span> : null}</div>
        <div className="badminton-slip-review-actions">{slip.storage_path ? <button className="badminton-secondary" onClick={() => onOpen(slip)} type="button"><Image size={16} /> เปิดรูปสลิป</button> : <span className="badminton-slip-no-image">ไม่มีรูปสลิป</span>}<button className="badminton-secondary is-reject" onClick={() => onReview(slip, false)} type="button"><X size={16} /> {slip.hasMissingPaymentData ? "ปิดรายการเก่า" : "ปฏิเสธ"}</button>{!slip.hasMissingPaymentData ? <button className="badminton-primary" disabled={!slip.storage_path && !slip.allPaymentsPaid} onClick={() => onReview(slip, true)} type="button"><Check size={16} /> {slip.allPaymentsPaid ? "ปิดรายการที่รับเงินแล้ว" : "อนุมัติและตัดยอด"}</button> : null}</div>
      </article>;
    })}
  </div>;
}

function AuditPanel({ actions }) {
  const [activeHistory, setActiveHistory] = useState("line");
  const lineActions = actions.filter((action) => action.source === "line");
  const adminActions = actions.filter((action) => action.source !== "line");

  function ActionList({ entries, emptyLabel }) {
    return entries.length
      ? <div className="badminton-audit-list">{entries.map((action) => <p key={action.id}><strong>{action.actorName}</strong> {action.action} <span>{action.at}</span></p>)}</div>
      : <p className="badminton-note">{emptyLabel}</p>;
  }

  return (
    <section className="badminton-audit-section">
      <div aria-label="เลือกประเภทประวัติ" className="badminton-history-tabs" role="tablist">
        <button aria-selected={activeHistory === "line"} className={activeHistory === "line" ? "is-active" : ""} onClick={() => setActiveHistory("line")} role="tab" type="button"><Users size={17} /> LINE bot</button>
        <button aria-selected={activeHistory === "admin"} className={activeHistory === "admin" ? "is-active" : ""} onClick={() => setActiveHistory("admin")} role="tab" type="button"><BadgeCheck size={17} /> ประวัติรายการ</button>
      </div>
      <article className="badminton-card badminton-audit" role="tabpanel">
        {activeHistory === "line" ? (
          <>
            <div className="badminton-card-title"><Users size={20} /><div><h2>LINE bot</h2><p>การลงชื่อ แก้คำตอบ และคำสั่งจากกลุ่ม LINE</p></div></div>
            <ActionList entries={lineActions} emptyLabel="ยังไม่มีกิจกรรมจาก LINE bot" />
          </>
        ) : (
          <>
            <div className="badminton-card-title"><BadgeCheck size={20} /><div><h2>ประวัติรายการ</h2><p>การเปลี่ยนแปลงสำคัญจากหน้าแอดมิน</p></div></div>
            <ActionList entries={adminActions} emptyLabel="ยังไม่มีรายการจากแอดมิน" />
          </>
        )}
      </article>
    </section>
  );
}

async function calculatePreviousOutstanding(clubId, eventIds) {
  if (!eventIds.length) return { count: 0, total: 0 };
  const dashboards = await Promise.all(eventIds.map((eventId) => loadDashboard(clubId, eventId)));
  const unpaidRows = dashboards.flatMap((dashboard) => {
    if (!dashboard?.event) return [];
    const previousSettlement = calculateSettlement(mapDashboardToEvent(dashboard));
    return previousSettlement.rows.filter((row) => row.billingFinalized && !row.paid);
  });
  return {
    count: unpaidRows.length,
    total: unpaidRows.reduce((sum, row) => sum + Number(row.roundedDue || 0), 0),
  };
}

function mapDashboardToEvent(dashboard) {
  const paymentsByMember = new Map(dashboard.payments.map((payment) => [payment.member_id, payment]));
  const slipPaymentsById = new Map((dashboard.paymentSlipPayments || []).map((payment) => [payment.id, payment]));
  const membersById = new Map(dashboard.members.map((member) => [member.id, member]));
  const attendanceByMember = new Map(dashboard.attendance.map((row) => [row.member_id, row]));
  const startTime = dashboard.event.starts_at.slice(0, 5);
  const endTime = dashboard.event.ends_at.slice(0, 5);
  const courtHourlyRate = Number(dashboard.event.court_hourly_rate ?? 200);
  const shuttlecockCount = Number(dashboard.event.shuttlecock_count ?? 0);
  const shuttlecockUnitPrice = Number(dashboard.event.shuttlecock_unit_price ?? 95);
  const extraCosts = dashboard.expenses.map((row) => ({ id: row.id, type: row.category, label: row.label, amount: Number(row.amount) }));
  const courts = dashboard.courts.map((court) => ({
    id: court.id,
    name: court.court_name,
    startsAt: court.starts_at.slice(0, 5),
    endsAt: court.ends_at.slice(0, 5),
  }));
  const courtHours = totalCourtHours(courts);
  const snapshottedMatchIds = new Set((dashboard.perRoundSnapshotMatches || []).map((row) => row.match_id));
  const snapshotByMember = new Map();
  (dashboard.perRoundSnapshotAllocations || []).forEach((allocation) => {
    const current = snapshotByMember.get(allocation.member_id) || { roundUnits: 0, sharedAmount: 0 };
    current.roundUnits += Number(allocation.round_units) || 0;
    current.sharedAmount += Number(allocation.allocated_shared_amount) || 0;
    snapshotByMember.set(allocation.member_id, current);
  });
  const roundsByMember = completedRoundsByMember(
    (dashboard.queueMatches || []).filter((match) => !snapshottedMatchIds.has(match.id)),
    dashboard.queueMatchPlayers || [],
  );
  const billableSignups = dashboard.signups.filter((row) => row.status === "coming");
  const attendance = billableSignups.map((signup, signupIndex) => {
    const row = attendanceByMember.get(signup.member_id);
    const payment = paymentsByMember.get(signup.member_id);
    const member = membersById.get(signup.member_id);
    const arrivalTime = signup.arrival_time?.slice(0, 5) || startTime;
    const leftAt = row?.left_at?.slice(0, 5) || "";
    const playedMinutes = playedMinutesWithinEvent(startTime, endTime, arrivalTime, leftAt);
    const billingPercentage = Number(row?.billing_percentage ?? 100);
    const weightedHours = billableHours(playedMinutes, billingPercentage);
    const snapshot = snapshotByMember.get(signup.member_id) || { roundUnits: 0, sharedAmount: 0 };
    const extraCharges = (dashboard.memberExtras || [])
      .filter((charge) => charge.member_id === signup.member_id)
      .map((charge) => ({ id: charge.id, name: charge.item_name, unitPrice: Number(charge.unit_price), quantity: Number(charge.quantity) }));
    return {
      memberId: signup.member_id,
      name: memberName(member) || "ไม่ทราบชื่อ",
      signupOrder: signupIndex + 1,
      arrived: true,
      checkedIn: Boolean(row?.arrived),
      weight: billingPercentage / 100,
      hours: weightedHours,
      playedMinutes,
      roundsPlayed: snapshot.roundUnits + (roundsByMember.get(signup.member_id) || 0),
      snapshotRoundUnits: snapshot.roundUnits,
      snapshotSharedAmount: snapshot.sharedAmount,
      billingPercentage,
      paymentExempt: Boolean(member?.payment_exempt),
      arrivedAt: arrivalTime,
      leftAt,
      note: row?.note || "",
      extraCharges,
      paid: Boolean(payment?.paid_at),
      paidAmount: payment?.paid_at ? Number(payment.amount || 0) : null,
      billingFinalized: Boolean(payment?.billed_at || payment?.paid_at),
      billedAmount: payment?.billed_at || payment?.paid_at ? Number(payment.amount || 0) : null,
      calculatedAmount: payment?.calculated_amount === null || payment?.calculated_amount === undefined ? null : Number(payment.calculated_amount),
      paymentStatus: payment?.payment_status || (payment?.paid_at ? "paid" : "draft"),
      paidSource: payment?.paid_source || null,
      transferredAmount: payment?.transferred_amount === null || payment?.transferred_amount === undefined ? null : Number(payment.transferred_amount),
      overpaymentAmount: Number(payment?.overpayment_amount || 0),
      lockedSharedAmount: (payment?.billed_at || payment?.paid_at) && payment.shared_amount !== null && payment.shared_amount !== undefined ? Number(payment.shared_amount) : null,
      lockedExtraAmount: (payment?.billed_at || payment?.paid_at) && payment.extras_amount !== null && payment.extras_amount !== undefined ? Number(payment.extras_amount) : null,
      shuttlecockCountSnapshot: payment?.billed_at || payment?.paid_at ? payment.shuttlecock_count_snapshot : null,
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
    billingModel: dashboard.event.billing_model || "legacy",
    completedGameCount: (dashboard.queueMatches || []).filter((match) => match.status === "completed").length,
    hasPlayingGames: (dashboard.queueMatches || []).some((match) => match.status === "playing"),
    shuttlecockCheckpoints: (dashboard.shuttlecockCheckpoints || []).map((checkpoint) => ({
      id: checkpoint.id,
      time: checkpoint.checkpoint_time?.slice(0, 5),
      cumulativeCount: Number(checkpoint.cumulative_count) || 0,
    })),
    perRoundSnapshots: (dashboard.perRoundSnapshots || []).map((snapshot) => ({
      id: snapshot.id,
      checkpointTime: snapshot.checkpoint_time?.slice(0, 5),
      includedMatches: Number(snapshot.included_match_count) || 0,
      includedPlayerRounds: Number(snapshot.included_player_rounds) || 0,
      shuttlecockCount: Number(snapshot.shuttlecock_count_cumulative) || 0,
      allocatedSharedCost: Number(snapshot.allocated_shared_cost) || 0,
      deferredSharedCost: Number(snapshot.deferred_shared_cost) || 0,
    })),
    snapshotAllocatedSharedTotal: (dashboard.perRoundSnapshotAllocations || [])
      .reduce((sum, allocation) => sum + Number(allocation.allocated_shared_amount || 0), 0),
    members: dashboard.members.map((member) => ({ id: member.id, name: memberName(member), lineName: member.display_name, nickname: member.nickname, aliases: member.aliases || [], role: member.role, lineUserId: member.line_user_id, active: member.active, paymentExempt: Boolean(member.payment_exempt), skillLevel: member.skill_level || null, playableSkillLevels: member.playable_skill_levels || [], allowLowerLevel: Boolean(member.allow_lower_level), allowHigherLevel: Boolean(member.allow_higher_level), createdAt: member.created_at })),
    signups: dashboard.signups.map((row) => ({ memberId: row.member_id, status: row.status, arrivalTime: row.arrival_time?.slice(0, 5) || "", note: row.note, createdAt: row.created_at, submittedByLineUserId: row.submitted_by_line_user_id || "", submittedByLineName: row.submitted_by_line_name || "", skillLevel: row.skill_level_snapshot || null, playableSkillLevels: row.playable_skill_levels_snapshot || [], allowLowerLevel: Boolean(row.allow_lower_level_snapshot), allowHigherLevel: Boolean(row.allow_higher_level_snapshot) })),
    attendance,
    paymentSlips: (dashboard.paymentSlips || []).map((slip) => {
      const paymentBreakdown = buildSlipRoundBreakdown(slip.payment_ids, slipPaymentsById);
      return {
        ...slip,
        submittedByName: memberName(membersById.get(slip.submitted_by_member_id)),
        beneficiaryName: [...new Set((slip.beneficiary_member_ids?.length
          ? slip.beneficiary_member_ids
          : [slip.beneficiary_member_id])
          .map((memberId) => memberName(membersById.get(memberId)))
          .filter(Boolean))].join(", ") || "สมาชิก",
        paymentRounds: paymentBreakdown.rounds,
        allPaymentsPaid: paymentBreakdown.allPaymentsPaid,
        hasMissingPaymentData: paymentBreakdown.hasMissingPaymentData,
      };
    }),
    extraCosts,
    costs: [
      { id: "computed-court", type: "court", label: `ค่าคอร์ดรวม ${courtHours} ชม.`, amount: courtHours * courtHourlyRate },
      { id: "computed-shuttle", type: "shuttle", label: `ค่าลูกแบด ${shuttlecockCount} ลูก`, amount: shuttlecockCount * shuttlecockUnitPrice },
      ...extraCosts,
    ],
    actions: dashboard.auditLogs.map((row) => ({
      id: row.id,
      actorName: row.actor_id ? "แอดมิน" : "LINE bot",
      source: row.actor_id ? "admin" : "line",
      action: row.action,
      at: new Date(row.created_at).toLocaleString("th-TH"),
    })),
  };
}

function memberName(member) {
  return member?.nickname?.trim() || member?.display_name?.trim() || "";
}

function paymentExemptIdentity(member) {
  const nickname = memberName(member);
  if (!member.line_user_id) return `${nickname} · ยังไม่เชื่อม LINE`;
  return `${nickname} · LINE: ${member.display_name || "เชื่อมแล้ว"}`;
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
    cursor += 15;
  }
  return options;
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
