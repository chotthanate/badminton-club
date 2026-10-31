import React, { useEffect, useMemo, useRef, useState } from "react";
import TournamentAdminApp from "./TournamentAdminApp.jsx";
import SandboxModeBadge from "./SandboxModeBadge.jsx";
import ParticipantPicker from "./ParticipantPicker.jsx";
import { activeParticipantSignup, participantRemovalMessage, participantTimeLabel, participantTimeOptions, resolveParticipantMember } from "./participantControls.js";
import {
  ArrowLeft,
  ArrowUpDown,
  BadgeCheck,
  CalendarDays,
  Check,
  Copy,
  Calculator,
  History,
  Image,
  ListOrdered,
  LogIn,
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
  addExpense,
  addExtraCatalogItem,
  addLineMember,
  addMemberExtraCharge,
  addRandomTestPlayers,
  prepareTestRound,
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
  finalizeMemberBill,
  getAdminContexts,
  finishEvent,
  finishQueueMatch,
  getPaymentSlipImageUrl,
  incrementEventShuttlecockCount,
  listClubEvents,
  listOutstandingPayments,
  loadDashboard,
  loadFinanceState,
  loadEventControlState,
  loadAuditState,
  loadParticipantState,
  loadQueueState,
  loadStaffDashboard,
  markOutstandingPaymentPaid,
  recordAudit,
  resetTestClub,
  reviewPaymentSlip,
  prepareEventForLine,
  removeExtraCatalogItem,
  removeMemberExtraCharge,
  removeParticipant,
  restoreParticipant,
  removeShuttlecockCheckpoint,
  setPayment,
  setEventShuttlecockCount,
  signInStaff,
  snapshotPerRoundDeparture,
  startNextQueueOnCourt,
  updateAttendance,
  updateClubMember,
  updateEvent,
  updateEventDetails,
  updateEventVenue,
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
  currentEventArrivalTime,
  formatPlayedDuration,
  formatThaiLongDate,
  finalizedCollectionSummary,
  isPaymentAdminConfirmed,
  minutesBetween,
  playedMinutesWithinEvent,
  roundDefaultsForDate,
  sessionBoundsFromCourts,
  suggestArrivalTimeOnCheck,
  suggestShuttlecockCheckpointTime,
  timePositionWithinEvent,
  totalCourtHours,
} from "./badmintonLogic.js";
import { normalizeMemberSearch } from "./memberSearch.js";
import { buildLiveQueueUrl, buildTestPaymentLiffUrl, buildTestSignupLiffUrl } from "./liffSignup.js";
import { proposeQueueMatch, SKILL_LEVELS } from "./queueLogic.js";
import { randomTestPlayerCount } from "./randomTestPlayers.js";
import { loadPlayerSortMode, savePlayerSortMode } from "./playerSortPreference.js";
import SkillCompatibilityPicker from "./SkillCompatibilityPicker.jsx";
import QueuePanel, { OperatorCourtControls } from "./QueuePanel.jsx";
import StaffParticipantsPanel from "./StaffParticipantsPanel.jsx";
import { defaultPlayableSkillLevels, normalizePlayableSkillLevels, skillLabel } from "./skillLevels.js";
import { createMutationQueue } from "./mutationQueue.js";
import { runMutationLifecycle } from "./mutationOutcome.js";
import { hasUnsavedQueueWork } from "./queueDrafts.js";
import ParticipantFilters, { filterParticipants } from "./ParticipantFilters.jsx";
import MemberDirectoryModal from "./MemberDirectoryModal.jsx";
import { usePersistentEditor } from "./usePersistentEditor.js";
import { hasUnsavedEditorWork } from "./editorDrafts.js";
import "./admin-improvements.css";
import { authenticateBackofficeCode } from "./backofficeAuth.js";
import { selectStaffWorkspace } from "./staffWorkspace.js";
import { isSupabaseConfigured, supabase } from "./supabase.js";
import NetworkStatus, { useOnlineStatus } from "./NetworkStatus.jsx";
import { buildOutstandingLineMessage, filterAndSortOutstanding, outstandingAgeInDays } from "./outstandingPayments.js";
import AdminSettingsPanel from "./AdminSettingsPanel.jsx";
import PaymentRow from "./PaymentRow.jsx";
import { adminNavigationTabs } from "./adminNavigation.js";
import { roundDetailsPatch } from "./roundControls.js";
import "./round-controls.css";
import "./admin-navigation.css";

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

const ADMIN_TAB_ICONS = { round: CalendarDays, players: Users, queue: ListOrdered, costs: Calculator, payments: WalletCards, settings: Settings };

const HALF_HOUR_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 ? "30" : "00";
  return `${String(hour).padStart(2, "0")}:${minute}`;
});

const BILLING_PERCENT_OPTIONS = [100, 75, 50, 25, 0];

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
  return new URLSearchParams(window.location.search).get("app") === "tournament"
    ? <TournamentAdminApp session={session} />
    : <AdminDashboard session={session} />;
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
  const [settingsPage, setSettingsPage] = useState("menu");
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [staffAccessModalOpen, setStaffAccessModalOpen] = useState(false);
  const [eventSummaries, setEventSummaries] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [previousOutstanding, setPreviousOutstanding] = useState({ count: 0, total: 0, rows: [] });
  const [adminContexts, setAdminContexts] = useState([]);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const online = useOnlineStatus();
  const selectedClubIdRef = useRef(null);
  const selectedEventIdRef = useRef(null);
  const selectedEventsByClubRef = useRef(new Map());
  const refreshRequestRef = useRef(0);
  const savingRef = useRef(false);
  const [pendingKeys, setPendingKeys] = useState([]);
  const pollInFlightRef = useRef(false);
  const fullRefreshCountRef = useRef(0);
  const latestFullRefreshRef = useRef(0);
  const viewRef = useRef(null);
  viewRef.current = { activeTab, settingsPage, context, dashboard };
  const mutationsRef = useRef(null);
  if (!mutationsRef.current) mutationsRef.current = createMutationQueue((keys) => {
    savingRef.current = keys.length > 0;
    setSaving(keys.length > 0);
    setPendingKeys(keys);
  });

  async function refresh(silent = false, options = {}) {
    fullRefreshCountRef.current += 1;
    const fullRequestId = ++latestFullRefreshRef.current;
    const requestId = ++refreshRequestRef.current;
    if (!silent) setLoading(true);
    setError("");
    try {
      const nextContexts = await getAdminContexts(session.user.id);
      if (options.clubId && !nextContexts.some((entry) => entry.club_id === options.clubId)) {
        throw new Error("ไม่พบสิทธิ์เข้าถึงกลุ่มที่เลือก ข้อมูลเดิมยังอยู่ กรุณาโหลดใหม่อีกครั้ง");
      }
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
      if (!nextContext) {
        if (requestId !== refreshRequestRef.current) return;
        setAdminContexts(nextContexts);
        selectedClubIdRef.current = null;
        setContext(null);
        setDashboard(null);
        setEventSummaries([]);
        setSelectedEventId(null);
        selectedEventIdRef.current = null;
        setPreviousOutstanding({ count: 0, total: 0, rows: [] });
        return;
      }
      const isStaffContext = nextContext.role === "staff";
      const nextEvents = isStaffContext ? [] : await listClubEvents(nextContext.club_id);
      const requestedEventId = options.preferLatest ? null : (options.eventId
        || selectedEventsByClubRef.current.get(nextContext.club_id)
        || (nextContext.club_id === selectedClubIdRef.current ? selectedEventIdRef.current : null));
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
      if (requestId !== refreshRequestRef.current) return false;
      setAdminContexts(nextContexts);
      selectedClubIdRef.current = nextContext.club_id;
      setContext(nextContext);
      setEventSummaries(nextEvents);
      setSelectedEventId(isStaffContext ? nextDashboard.event?.id || null : targetEventId);
      selectedEventIdRef.current = isStaffContext ? nextDashboard.event?.id || null : targetEventId;
      selectedEventsByClubRef.current.set(nextContext.club_id, selectedEventIdRef.current);
      setDashboard(nextDashboard);
      setPreviousOutstanding(nextOutstanding);
      setLastSyncedAt(new Date());
      if (isStaffContext) setActiveTab((current) => ["round", "queue", "players", "settings"].includes(current) ? current : "queue");
      return true;
    } catch (nextError) {
      if (requestId === refreshRequestRef.current) setError(nextError.message);
      if (options.throwOnError) throw nextError;
      return false;
    } finally {
      fullRefreshCountRef.current -= 1;
      if (fullRequestId === latestFullRefreshRef.current) setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [session.user.id]);
  useEffect(() => {
    const warn = (event) => {
      if (savingRef.current || hasUnsavedQueueWork(selectedEventIdRef.current) || hasUnsavedEditorWork(selectedEventIdRef.current)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  useEffect(() => {
    const viewingHistory = activeTab === "settings" && settingsPage === "history" && context?.role !== "staff";
    if (!dashboard?.event || (dashboard.event.status !== "open" && !viewingHistory) || (activeTab === "settings" && !viewingHistory)) return undefined;
    let cancelled = false;
    const poll = async () => {
      if (cancelled || savingRef.current || fullRefreshCountRef.current || pollInFlightRef.current || document.hidden || !navigator.onLine || !selectedEventIdRef.current) return;
      pollInFlightRef.current = true;
      const eventId = selectedEventIdRef.current;
      const requestId = ++refreshRequestRef.current;
      try {
        const nextDashboard = activeTab === "queue"
          ? await loadQueueState(eventId)
          : activeTab === "players" && context?.role !== "staff"
            ? await loadParticipantState(context.club_id, eventId)
          : context?.role === "staff"
            ? await loadStaffDashboard(context.club_id)
            : activeTab === "round"
              ? await loadFinanceState(context.club_id, eventId)
              : viewingHistory
                ? await loadAuditState(context.club_id, eventId)
                : await loadFinanceState(context.club_id, eventId);
        if (!cancelled && requestId === refreshRequestRef.current) {
          setDashboard((current) => current?.event?.id === eventId
            ? { ...current, ...nextDashboard, event: nextDashboard.event || (nextDashboard.queueEventStatus
              ? { ...current.event, status: nextDashboard.queueEventStatus }
              : current.event) }
            : current);
          setLastSyncedAt(new Date());
        }
      } catch (nextError) {
        if (!cancelled && requestId === refreshRequestRef.current) setError(nextError.message);
      } finally {
        pollInFlightRef.current = false;
      }
    };
    const timer = window.setInterval(poll, activeTab === "queue" ? 5000 : 15000);
    document.addEventListener("visibilitychange", poll);
    window.addEventListener("online", poll);
    window.addEventListener("focus", poll);
    poll();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
      window.removeEventListener("online", poll);
      window.removeEventListener("focus", poll);
      cancelled = true;
    };
  }, [dashboard?.event?.id, dashboard?.event?.status, activeTab, settingsPage, context?.club_id, context?.role]);

  useEffect(() => {
    if (dashboard?.event?.status === "open") setActiveTab((current) => current === "settings" ? current : "queue");
  }, [dashboard?.event?.id, dashboard?.event?.status]);

  useEffect(() => {
    if (dashboard && !dashboard.event) setActiveTab((current) => current === "settings" ? current : "round");
  }, [dashboard?.event?.id]);

  function mutate(action, successMessage, options = {}) {
    ++refreshRequestRef.current;
    return mutationsRef.current.enqueue(options.actionKey, async () => {
      if (!navigator.onLine) {
        const offlineError = new Error("ยังไม่ได้เชื่อมต่ออินเทอร์เน็ต ข้อมูลที่กรอกยังอยู่ กรุณาเชื่อมต่อแล้วกดบันทึกอีกครั้ง");
        if (options.onError) options.onError(offlineError);
        else setError(offlineError.message);
        return false;
      }
      setError("");
      setNotice("");
      return runMutationLifecycle({
        action,
        onError: (nextError) => {
          if (options.onError) options.onError(nextError);
          else if (options.errorMode === "alert") window.alert(nextError.message);
          else setError(nextError.message);
        },
        onSaved: (auditWarning) => {
          setNotice(successMessage || "บันทึกแล้ว");
          if (auditWarning) setError(auditWarning);
        },
        onRefreshError: (nextError, auditWarning) => {
          setError(`${auditWarning ? `${auditWarning} · ` : ""}บันทึกแล้ว แต่โหลดข้อมูลล่าสุดไม่ได้ กรุณากดโหลดข้อมูลอีกครั้ง ไม่ต้องกดบันทึกซ้ำ (${nextError.message})`);
        },
        refresh: async () => {
          const { activeTab, context, dashboard } = viewRef.current;
          const selectedAfterSave = options.selectEventId?.();
          if (selectedAfterSave) {
            await refresh(false, { eventId: selectedAfterSave, throwOnError: true });
            return;
          }
          if ((options.refreshQueueOnly || (activeTab === "queue" && !options.selectLatest)) && selectedEventIdRef.current) {
            const eventId = selectedEventIdRef.current;
            const requestId = ++refreshRequestRef.current;
            const queueState = await loadQueueState(eventId);
            if (requestId === refreshRequestRef.current) {
              setDashboard((current) => current?.event?.id === eventId
                ? { ...current, ...queueState, event: queueState.event || { ...current.event, status: queueState.queueEventStatus } }
                : current);
              setLoading(false);
              setLastSyncedAt(new Date());
            }
          } else if (!options.selectLatest && activeTab === "players" && context?.role !== "staff" && context?.club_id && dashboard?.event?.id) {
            const eventId = dashboard.event.id;
            const requestId = ++refreshRequestRef.current;
            const participantState = await loadParticipantState(context.club_id, eventId);
            if (requestId === refreshRequestRef.current) {
              setDashboard((current) => current?.event?.id === eventId
                ? { ...current, ...participantState, event: participantState.event || { ...current.event, status: participantState.queueEventStatus } }
                : current);
              setLastSyncedAt(new Date());
            }
          } else if (!options.selectLatest && context?.club_id && dashboard?.event?.id) {
            const requestId = ++refreshRequestRef.current;
            if (context.role === "staff") {
              const nextDashboard = await loadStaffDashboard(context.club_id);
              if (requestId === refreshRequestRef.current) setDashboard(nextDashboard);
            } else {
              const [nextDashboard, outstandingRows, nextEvents] = await Promise.all([
                loadFinanceState(context.club_id, dashboard.event.id),
                listOutstandingPayments(context.club_id),
                listClubEvents(context.club_id),
              ]);
              if (requestId === refreshRequestRef.current) {
                setDashboard((current) => current?.event?.id === nextDashboard.event?.id ? { ...current, ...nextDashboard } : current);
                setEventSummaries(nextEvents);
                setPreviousOutstanding({
                  count: outstandingRows.length,
                  total: outstandingRows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
                  rows: outstandingRows,
                });
                setLastSyncedAt(new Date());
              }
            }
          } else {
            await refresh(false, { preferLatest: options.selectLatest, throwOnError: true });
          }
        },
      });
    });
  }

  function canLeaveRound() {
    if (savingRef.current) {
      setError("กำลังบันทึก กรุณารอให้เสร็จก่อนเปลี่ยนรอบหรือออกจากระบบ");
      return false;
    }
    return (!hasUnsavedQueueWork(selectedEventIdRef.current) && !hasUnsavedEditorWork(selectedEventIdRef.current))
      || window.confirm("ยังมีข้อมูลที่แก้ไว้แต่ยังไม่บันทึก ร่างจะเก็บไว้ในเครื่องนี้ ต้องการออกจากรอบนี้ไหม?");
  }

  function changeTab(nextTab) {
    if (nextTab === activeTab) {
      if (nextTab === "settings") { setSettingsPage("menu"); window.scrollTo(0, 0); }
      return;
    }
    if ((hasUnsavedQueueWork(selectedEventIdRef.current) || hasUnsavedEditorWork(selectedEventIdRef.current))
      && !window.confirm("ยังมีร่างที่ไม่บันทึก ร่างจะถูกเก็บไว้ให้เมื่อกลับมา ต้องการเปลี่ยนหน้าไหม?")) return;
    if (nextTab === "settings") setSettingsPage("menu");
    setActiveTab(nextTab);
    window.scrollTo(0, 0);
  }

  async function switchTestMode() {
    if (!canLeaveRound()) return false;
    return mutationsRef.current.enqueue("sandbox:switch", async () => {
      setLoading(true);
      setError("");
      try {
        if (context?.clubs.is_test) {
          const productionContext = adminContexts.find((entry) => !entry.clubs.is_test);
          if (!productionContext) throw new Error("ไม่พบกลุ่มข้อมูลจริงของบัญชีนี้");
          const refreshed = await refresh(false, { clubId: productionContext.club_id, throwOnError: true });
          if (refreshed !== true) throw new Error("ยังไม่ได้เปลี่ยนกลุ่มข้อมูล กรุณาลองอีกครั้ง");
          setActiveTab("round");
          setNotice("กลับสู่ข้อมูลจริงแล้ว");
        } else {
          const existingTestContext = adminContexts.find((entry) => entry.clubs.is_test);
          const clubId = existingTestContext?.club_id || (await createTestClub({ ownerId: session.user.id })).id;
          const eventId = await prepareTestRound({ clubId });
          const refreshed = await refresh(false, { clubId, eventId, throwOnError: true });
          if (refreshed !== true) throw new Error("ยังไม่ได้เปลี่ยนกลุ่มข้อมูล กรุณาลองอีกครั้ง");
          setActiveTab("queue");
          setNotice("โหมดทดลองพร้อมเล่นแล้ว ใช้ทุกคอร์ทได้ทันทีโดยไม่รอเวลาจอง และไม่กระทบรอบจริง");
        }
        return true;
      } catch (nextError) {
        setError(nextError.message);
        return false;
      } finally {
        setLoading(false);
      }
    });
  }

  async function resetDemo() {
    if (!context?.clubs.is_test) return;
    if (!window.confirm("ล้างรอบ ผู้เล่น และค่าใช้จ่ายทั้งหมดในโหมดทดลอง? ข้อมูลจริงจะไม่ถูกแตะต้อง")) return;
    let preparedEventId;
    const saved = await mutate(async () => {
      await resetTestClub(context.club_id);
      preparedEventId = await prepareTestRound({ clubId: context.club_id });
    }, "รีเซ็ตข้อมูลทดลองแล้ว พร้อมเริ่มเกมทดลองทันที", { actionKey: "sandbox:reset", selectEventId: () => preparedEventId });
    if (saved) setActiveTab("queue");
  }

  async function addDemoQueuePlayers() {
    if (!context?.clubs.is_test) return;
    const count = randomTestPlayerCount();
    if (!window.confirm(`เพิ่มผู้เล่นสุ่มคละระดับ ${count} คน และเช็กชื่อให้พร้อมเข้าคิวเลยใช่ไหม?`)) return;
    let preparedEventId;
    const saved = await mutate(async () => {
      preparedEventId = await prepareTestRound({ clubId: context.club_id });
      await addRandomTestPlayers({
        clubId: context.club_id,
        eventId: preparedEventId,
        count,
      });
    }, `เพิ่มผู้เล่นสุ่มคละระดับ ${count} คนและเช็กชื่อแล้ว`, { actionKey: "sandbox:add-players", selectEventId: () => preparedEventId });
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
        : buildLiveQueueUrl({ testClubId: context.club_id });
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
  const visibleTabs = adminNavigationTabs(isStaff, Boolean(appEvent));

  return (
    <main className={`badminton-app badminton-admin-layout ${dashboard.event?.status === "open" ? "is-game-mode" : ""}`}>
      <section className="badminton-shell">
        <header className="badminton-admin-topbar">
          <div className="badminton-admin-identity">
            <h1>{context.clubs.name}</h1>
            {context.clubs.is_test ? <SandboxModeBadge busy={saving || loading} onExit={switchTestMode} /> : isStaff ? <span className="badminton-admin-mode">โหมดสตาฟ</span> : null}
          </div>
          {!isStaff ? <RoundSwitcher
            disabled={saving || loading}
            events={eventSummaries}
            onChange={(eventId) => { if (canLeaveRound()) refresh(false, { eventId }); }}
            onDelete={(round) => mutate(
              () => deleteCompletedEvent(round.id),
              round.status === "draft" ? "ลบรอบที่กำลังเตรียมแล้ว" : "ลบรอบที่ชำระเงินครบแล้ว",
              { selectLatest: true, errorMode: "alert" },
            )}
            selectedEventId={selectedEventId}
          /> : <p className="badminton-admin-current-round"><CalendarDays size={17} /> {dashboard.event ? `${formatRoundOption(dashboard.event.event_date)} · ${EVENT_STATUS_LABELS[dashboard.event.status] || dashboard.event.status}` : "ยังไม่มีรอบที่เปิดอยู่"}</p>}
        </header>

        {!online ? <NetworkStatus lastSyncedAt={lastSyncedAt} online={online} /> : null}

        {notice ? <div className="badminton-alert is-success"><span>{notice}</span><button aria-label="ปิดข้อความแจ้งเตือน" onClick={() => setNotice("")} type="button"><X size={17} /></button></div> : null}
        {error ? <div className="badminton-alert is-error"><span>{error}</span><button aria-label="ปิดข้อความผิดพลาด" onClick={() => setError("")} type="button"><X size={17} /></button></div> : null}
        <div className="badminton-admin-content">
        {activeTab === "settings" ? <>
          {online ? <NetworkStatus lastSyncedAt={lastSyncedAt} online={online} /> : null}
          {!isStaff && settingsPage === "history" && appEvent ? <section className="badminton-settings-history">
            <button className="badminton-secondary" onClick={() => { setSettingsPage("menu"); window.scrollTo(0, 0); }} type="button"><ArrowLeft size={17} /> กลับหน้าตั้งค่า</button>
            <div className="badminton-card-title"><History size={20} /><div><h2>ประวัติของรอบที่เลือก</h2><p>{formatRoundOption(dashboard.event.event_date)}</p></div></div>
            <AuditPanel actions={appEvent.actions} />
          </section> : <AdminSettingsPanel
            busy={saving}
            refreshing={loading}
            clubName={context.clubs.name}
            isStaff={isStaff}
            isTestMode={Boolean(context.clubs.is_test)}
            eventStatus={dashboard.event?.status}
            hasEvent={Boolean(appEvent)}
            onRefresh={() => { if (!savingRef.current) refresh(false); }}
            onHistory={() => { setSettingsPage("history"); window.scrollTo(0, 0); }}
            onPassword={() => setPasswordModalOpen(true)}
            onStaffAccess={() => setStaffAccessModalOpen(true)}
            onToggleTestMode={switchTestMode}
            onSignOut={() => { if (canLeaveRound()) supabase.auth.signOut(); }}
            onTournamentNavigate={(eventObject) => { if (!canLeaveRound()) eventObject.preventDefault(); }}
            onAddTestPlayers={addDemoQueuePlayers}
            onCopyTestLink={copyTestLink}
            onResetTest={resetDemo}
          />}
        </> : !dashboard.event && !isStaff ? (
          <CreateEventCard context={context} mutate={mutate} session={session} venues={dashboard.venues || []} />
        ) : !dashboard.event ? (
          <section className="badminton-card badminton-empty"><h2>ยังไม่มีรอบที่เปิดอยู่</h2><p>สตาฟจะเข้าใช้งานได้เมื่อเจ้าของเปิดรอบแล้ว</p></section>
        ) : (
          <>
            {!isStaff && activeTab === "round" ? <>
              <EventControlCard
                dashboard={dashboard}
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

            {isStaff && activeTab === "round" ? <OperatorCourtControls dashboard={dashboard} event={appEvent} isStaff isTestMode={context.clubs.is_test} mutate={mutate} /> : null}

            {activeTab === "players" ? (
              isStaff ? <StaffParticipantsPanel dashboard={dashboard} event={appEvent} mutate={mutate} pendingKeys={pendingKeys} /> : <ParticipantsPanel
                context={context}
                dashboard={dashboard}
                event={appEvent}
                mutate={mutate}
                session={session}
                settlement={settlement}
                pendingKeys={pendingKeys}
              />
            ) : null}

            {activeTab === "queue" ? (
              <QueuePanel dashboard={dashboard} event={appEvent} isStaff={isStaff} isTestMode={Boolean(context.clubs.is_test)} mutate={mutate} />
            ) : null}

            {!isStaff && activeTab === "costs" ? <PricingPanel event={appEvent} mutate={mutate} session={session} settlement={settlement} /> : null}
            {!isStaff && activeTab === "payments" ? <SettlementPanel context={context} event={appEvent} mutate={mutate} previousOutstanding={previousOutstanding} session={session} settlement={settlement} /> : null}
          </>
        )}
        </div>
        <nav aria-label="เมนูหลังบ้าน" className="badminton-tabs badminton-bottom-nav" style={{ "--admin-tab-count": visibleTabs.length }}>
          {visibleTabs.map(({ id, label, disabled }) => {
            const Icon = ADMIN_TAB_ICONS[id];
            return <button aria-current={activeTab === id ? "page" : undefined} className={activeTab === id ? "is-active" : ""} disabled={disabled} key={id} onClick={() => changeTab(id)} title={disabled ? "กรุณาสร้างหรือเปิดรอบก่อน" : label} type="button"><Icon size={20} /><span>{label}</span>{id === "payments" && appEvent?.paymentSlips?.length ? <b className="badminton-tab-count" title={`${appEvent.paymentSlips.length} สลิปรอตรวจสอบ`}>{appEvent.paymentSlips.length}</b> : null}</button>;
          })}
        </nav>
        {!isStaff && passwordModalOpen ? (
          <AdminPasswordModal
            onClose={() => setPasswordModalOpen(false)}
            onSave={(password) => mutate(() => changeAdminPassword(password), "เปลี่ยนรหัสเข้าเว็บแล้ว")}
            saving={saving}
          />
        ) : null}
        {!isStaff && !context.clubs.is_test && staffAccessModalOpen ? <StaffAccessModal clubId={context.club_id} onClose={() => setStaffAccessModalOpen(false)} onSave={(settings) => mutate(() => configureStaffAccess({ clubId: context.club_id, ...settings }), settings.enabled ? "ตั้งค่ารหัสสตาฟแล้ว เซสชันเดิมถูกตัด" : "ปิดใช้งานรหัสสตาฟแล้ว")} saving={saving} /> : null}
        {saving ? <div className="badminton-saving" role="status">กำลังบันทึก{pendingKeys.length > 1 ? ` · ${pendingKeys.length} รายการ` : "..."}</div> : null}
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

function RoundSwitcher({ disabled = false, events, onChange, onDelete, selectedEventId }) {
  const selectedRound = events.find((event) => event.id === selectedEventId);
  const canDelete = selectedRound && ["draft", "closed"].includes(selectedRound.status);

  function confirmDelete() {
    if (disabled || !selectedRound) return;
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
          <select aria-label="รอบทั้งหมด" disabled={disabled || !events.length} onChange={(event) => onChange(event.target.value)} value={selectedEventId || ""}>
            {!events.length ? <option value="">ยังไม่มีรอบ</option> : null}
            {events.map((event, index) => (
              <option key={event.id} value={event.id}>
                {index === 0 ? "รอบล่าสุด · " : ""}{formatRoundOption(event.event_date)} · {EVENT_STATUS_LABELS[event.status] || event.status}
              </option>
            ))}
          </select>
          <details className="badminton-round-danger"><summary aria-label="เปิดเมนูจัดการรอบ" title="จัดการรอบ">•••</summary><div><strong>การดำเนินการเพิ่มเติม</strong><button aria-label="ลบรอบที่เลือก" disabled={disabled || !canDelete} onClick={confirmDelete} title={selectedRound?.status === "draft" ? "ลบรอบที่กำลังเตรียม" : "ลบรอบที่ชำระเงินครบแล้ว"} type="button"><Trash2 size={17} /> ลบรอบนี้</button></div></details>
        </div>
      </label>
      <small>เมนูลบรอบอยู่ในปุ่ม ••• เพื่อป้องกันการแตะผิดระหว่างใช้งาน</small>
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
    if (context.clubs.is_test) {
      let preparedEventId;
      await mutate(async () => {
        preparedEventId = await prepareTestRound({ clubId: context.club_id });
      }, "รอบทดลองพร้อมเล่นแล้ว", { actionKey: `round:create:${context.club_id}`, selectEventId: () => preparedEventId });
      return;
    }
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
    }, "สร้างรอบใหม่แล้ว", { selectLatest: true, actionKey: `round:create:${context.club_id}` });
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

function EventControlCard({ clubName, clubSettings, courts, dashboard, event, isTestMode, mappedEvent, mutate, session, settlement, venues = [] }) {
  const eventEditor = usePersistentEditor(`badminton:event:${event.id}`, {
    event_date: event.event_date,
    venue: event.venue,
  });
  const form = eventEditor.value;
  const setForm = eventEditor.setValue;
  const [editingDetails, setEditingDetails] = useState(event.status === "draft");
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [roundSettingsError, setRoundSettingsError] = useState("");
  const [republishPending, setRepublishPending] = useState(false);
  const [courtsSaving, setCourtsSaving] = useState(false);
  const [courtsDirty, setCourtsDirty] = useState(false);
  const detailsSavingRef = useRef(false);
  const republishPendingRef = useRef(false);
  async function saveEventDetails() {
    if (detailsSavingRef.current) return;
    if (eventEditor.conflict) { setRoundSettingsError("รายละเอียดรอบเปลี่ยนจากเครื่องอื่น กรุณาใช้ข้อมูลล่าสุดก่อนแก้ใหม่"); return; }
    setRoundSettingsError("");
    detailsSavingRef.current = true; setDetailsSaving(true);
    let reported = false;
    try {
      const patch = roundDetailsPatch(event, form);
      const saved = await mutate(() => event.status === "open"
        ? updateEventVenue({ clubId: event.club_id, eventId: event.id, venue: patch.venue })
        : updateEventDetails({ clubId: event.club_id, eventId: event.id, patch }),
      event.status === "open" ? "บันทึกสถานที่ในรอบเดิมแล้ว รายชื่อ คิว และยอดเงินยังอยู่" : "บันทึกรายละเอียดรอบแล้ว โดยคงคอร์ทเดิมไว้", {
        actionKey: `event-details:${event.id}`,
        onError: (error) => { reported = true; setRoundSettingsError(error.message); },
      });
      if (saved) {
        const submitted = { event_date: patch.event_date || event.event_date, venue: patch.venue };
        eventEditor.setValue(submitted); eventEditor.accept(submitted); setEditingDetails(false);
      } else if (!reported) setRoundSettingsError("บันทึกไม่สำเร็จ ข้อมูลที่แก้ยังอยู่ กรุณาลองอีกครั้ง");
    } catch (error) { setRoundSettingsError(error.message); }
    finally { detailsSavingRef.current = false; setDetailsSaving(false); }
  }

  async function prepareOpenRoundForLine() {
    if (republishPendingRef.current || event.status !== "open" || isTestMode) return;
    if (eventEditor.dirty || courtsDirty) { setRoundSettingsError("กรุณาบันทึกสถานที่และคอร์ทที่แก้ก่อนเตรียมส่งข้อมูลเข้า LINE"); return; }
    republishPendingRef.current = true; setRepublishPending(true); setRoundSettingsError("");
    let reported = false;
    try {
      const saved = await mutate(() => prepareEventForLine(event.id), "เตรียมข้อมูลรอบเดิมแล้ว ไปที่กลุ่ม LINE แล้วพิมพ์ “เปิดลงชื่อ” เพื่อส่งข้อมูลล่าสุดอีกครั้ง", {
        actionKey: `round:republish:${event.id}`,
        onError: (error) => { reported = true; setRoundSettingsError(error.message); },
      });
      if (!saved && !reported) setRoundSettingsError("เตรียมส่งข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง รอบและรายชื่อเดิมไม่ถูกเปลี่ยน");
    } catch (error) { setRoundSettingsError(error.message); }
    finally { republishPendingRef.current = false; setRepublishPending(false); }
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
        }, "เปิดลงชื่อทดลองแล้ว โดยไม่ได้ส่งเข้า LINE", { actionKey: `round:advance:${event.id}` });
      }
      if (event.line_publish_ready) return null;
      return mutate(
        () => prepareEventForLine(event.id),
        "เตรียมรอบแล้ว กรุณาพิมพ์ “เปิดลงชื่อ” ในกลุ่ม LINE",
        { actionKey: `round:advance:${event.id}` },
      );
    }
    if (event.status === "open") {
      return mutate(async () => {
        const freshDashboard = { ...dashboard, ...await loadFinanceState(event.club_id, event.id) };
        const freshEvent = mapDashboardToEvent(freshDashboard);
        if (freshEvent.status !== "open") throw new Error("รอบนี้ถูกปิดจากเครื่องอื่นแล้ว กรุณาโหลดข้อมูลล่าสุด");
        const freshSettlement = calculateSettlement(freshEvent);
        if (freshEvent.billingModel === "per_round" && freshEvent.hasPlayingGames) {
          throw new Error("ยังมีสนามกำลังเล่น กรุณากดจบเกมทุกสนามก่อนจบรอบและคำนวณยอดตามจำนวนรอบ");
        }
        if (freshEvent.billingModel === "per_round" && freshSettlement.sharedTotalCost > 0 && freshSettlement.totalUnits <= 0) {
          throw new Error("ยังไม่มีเกมที่จบ ระบบจึงยังหารค่าส่วนกลางตามจำนวนรอบไม่ได้");
        }
        await finishEvent({
          clubId: mappedEvent.clubId,
          eventId: event.id,
          rows: freshSettlement.rows,
          shuttlecockCount: freshEvent.shuttlecockCount,
          userId: session.user.id,
        });
      }, "จบรอบแล้ว ยอดของผู้เล่นทุกคนถูกเก็บไว้", { actionKey: `round:advance:${event.id}` });
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
          {event.status !== "closed" ? <button className="badminton-secondary badminton-compact-action" disabled={detailsSaving} onClick={() => setEditingDetails((value) => !value)} type="button">{editingDetails ? "ซ่อนตั้งค่า" : event.status === "open" ? "แก้ไขสถานที่" : "แก้วันที่/สถานที่"}</button> : null}
          {event.status !== "closed" ? <button className="badminton-primary badminton-round-action" disabled={detailsSaving || courtsSaving || republishPending || (event.status === "draft" && event.line_publish_ready && !isTestMode)} onClick={advanceRound} type="button">{event.status === "draft" ? (isTestMode ? "เปิดลงชื่อทดลอง" : event.line_publish_ready ? "รอพิมพ์ใน LINE" : "เตรียมเปิดลงชื่อ") : "จบรอบ"}</button> : null}
        </div>
      </div>
      {event.status === "draft" && event.line_publish_ready && !isTestMode ? <div className="badminton-line-command-ready"><strong>ขั้นตอนสุดท้าย</strong><span>ไปที่กลุ่ม LINE แล้วพิมพ์ <b>เปิดลงชื่อ</b> บอทจะตอบการ์ดโดยไม่หักโควตา</span></div> : null}
      {event.status === "open" && !isTestMode ? <div className="badminton-round-republish"><button className="badminton-secondary" disabled={detailsSaving || courtsSaving || republishPending} onClick={prepareOpenRoundForLine} type="button"><RefreshCw size={16} />{republishPending ? "กำลังเตรียมข้อมูล…" : "ส่งข้อมูลลงชื่อเข้า LINE อีกครั้ง"}</button><small>ใช้รอบเดิม ไม่ต้องจบรอบหรือสร้างรอบใหม่</small>{event.line_publish_ready ? <div className="badminton-line-command-ready"><strong>พร้อมส่งข้อมูลล่าสุด</strong><span>ไปที่กลุ่ม LINE แล้วพิมพ์ <b>เปิดลงชื่อ</b> บอทจะส่งสถานที่และคอร์ทล่าสุด โดยคงรายชื่อเดิมทั้งหมด</span></div> : null}</div> : null}
      {roundSettingsError ? <p className="badminton-form-message is-error" role="alert">{roundSettingsError}</p> : null}
      {editingDetails && event.status !== "closed" ? <div className="badminton-event-form badminton-event-main-form">
        {eventEditor.dirty ? <div className="editor-dirty">ยังไม่บันทึก{eventEditor.conflict ? " · มีข้อมูลใหม่จากเครื่องอื่น" : ""}<button type="button" onClick={() => { if (window.confirm("ทิ้งร่างรายละเอียดรอบและใช้ข้อมูลล่าสุด?")) eventEditor.reset(); }}>ใช้ข้อมูลล่าสุด</button></div> : null}
        {event.status === "draft" ? <label>วันที่<input disabled={detailsSaving} type="date" value={form.event_date} onChange={(e) => { setForm({ ...form, event_date: e.target.value }); setRoundSettingsError(""); }} /></label> : null}
        <label>สถานที่<input aria-label="สถานที่ของรอบ" disabled={detailsSaving} list="round-saved-venues" maxLength={120} value={form.venue} onChange={(e) => { setForm({ ...form, venue: e.target.value }); setRoundSettingsError(""); }} /></label>
        <datalist id="round-saved-venues">{venues.map((venue) => <option key={venue.id} value={venue.name} />)}</datalist>
        <button className="badminton-secondary" disabled={detailsSaving || !eventEditor.dirty} onClick={saveEventDetails} type="button"><Save size={17} /> {detailsSaving ? "กำลังบันทึก…" : event.status === "open" ? "บันทึกสถานที่" : "บันทึก"}</button>
        <small className="badminton-round-preserve-note">แก้ข้อมูลในรอบเดิม ไม่เปลี่ยนรายชื่อ เวลาเข้า–ออก คิว หรือยอดเงิน และไม่แทนที่คอร์ทเดิม</small>
      </div> : null}
      <OperatorCourtControls dashboard={dashboard} event={mappedEvent} isTestMode={isTestMode} mutate={mutate} onBusyChange={setCourtsSaving} onDirtyChange={setCourtsDirty} />
    </section>
  );
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
      await mutate(() => finishQueueMatch(match.id), `จบเกม ${court.name} แล้ว สนามว่าง`, { refreshQueueOnly: true });
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

function ParticipantsPanel({ context, dashboard, event, mutate, session, settlement, pendingKeys = [] }) {
  const [name, setName] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [newMemberSkill, setNewMemberSkill] = useState({ level: "", playableLevels: [] });
  const liveAddArrival = currentEventArrivalTime({ eventDate: event.date, startTime: event.startTime, endTime: event.endTime });
  const [newPlayerArrival, setNewPlayerArrival] = useState("");
  const addArrival = newPlayerArrival || liveAddArrival || event.startTime;
  const addArrivalOptions = participantTimeOptions({ startTime: event.startTime, endTime: event.endTime, current: addArrival, includeEnd: false });
  const [newItem, setNewItem] = useState({ name: "", price: "" });
  const [customChargeFor, setCustomChargeFor] = useState(null);
  const [customCharge, setCustomCharge] = useState({ name: "", price: "" });
  const [editingMember, setEditingMember] = useState(null);
  const [memberEdit, setMemberEdit] = useState({ nickname: "", displayName: "", paymentExempt: false, skillLevel: "", playableSkillLevels: [] });
  const [pendingCheckIn, setPendingCheckIn] = useState(null);
  const [pendingDeparture, setPendingDeparture] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memberDirectoryOpen, setMemberDirectoryOpen] = useState(false);
  const [sortMode, setSortMode] = useState(loadPlayerSortMode);
  const [rosterQuery, setRosterQuery] = useState("");
  const [rosterFilter, setRosterFilter] = useState("all");
  const [exemptMemberId, setExemptMemberId] = useState("");
  const participants = event.signups
    .filter(activeParticipantSignup)
    .map((signup) => ({
      ...signup,
      member: dashboard.members.find((member) => member.id === signup.memberId),
      attendance: event.attendance.find((row) => row.memberId === signup.memberId),
    }))
    .filter((row) => row.member);
  const sortedParticipants = filterParticipants(participants, rosterQuery, rosterFilter).sort((a, b) => {
    if (sortMode === "alphabetical") return memberName(a.member).localeCompare(memberName(b.member), "th");
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
  const settlementByMember = new Map(settlement.rows.map((row) => [row.memberId, row]));
  const participantIds = new Set(participants.map((participant) => participant.member.id));
  const savedMembers = dashboard.members.filter((member) => member.role === "member" && member.active !== false);
  const removedMemberIds = new Set(event.signups.filter((signup) => signup.removedAt || signup.removed_at).map((signup) => signup.memberId));
  const selectableMembers = event.status === "closed" ? savedMembers.filter((member) => removedMemberIds.has(member.id)) : savedMembers;
  const addingPlayer = pendingKeys.some((key) => key.startsWith(`add-player:${event.id}:`));

  function changeSortMode(nextMode) {
    setSortMode(nextMode);
    savePlayerSortMode(nextMode);
  }

  async function addMember(eventObject) {
    eventObject.preventDefault();
    const trimmedName = name.trim();
    const normalizedName = normalizeMemberSearch(trimmedName);
    let existingMember = savedMembers.find((member) => member.id === selectedMemberId);
    const saved = await mutate(async () => {
      if (!trimmedName) throw new Error("กรุณาพิมพ์ชื่อเล่นหรือชื่อ LINE");
      existingMember = resolveParticipantMember(savedMembers, trimmedName, selectedMemberId);
      if (existingMember && participantIds.has(existingMember.id)) throw new Error("ผู้เล่นคนนี้อยู่ในรอบแล้ว");
      if (event.status === "closed" && (!existingMember || !removedMemberIds.has(existingMember.id))) throw new Error("รอบปิดแล้ว เพิ่มกลับได้เฉพาะชื่อที่เคยนำออกจากรอบนี้");
      if (existingMember && event.signups.some((signup) => signup.memberId === existingMember.id && (signup.removedAt || signup.removed_at))) {
        await restoreParticipant({ eventId: event.id, memberId: existingMember.id });
        return;
      }
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
        arrivalTime: addArrival,
        skillLevel: selectedSkill,
        playableSkillLevels,
      });
      await recordAudit({
        clubId: context.club_id,
        eventId: event.id,
        userId: session.user.id,
        action: `${existingMember ? "เพิ่มผู้เล่นเดิม" : "สร้างและเพิ่มผู้เล่น"} ${memberName(member) || trimmedName}`,
      });
    }, existingMember ? `เพิ่ม ${memberName(existingMember)} จากประวัติเดิมแล้ว` : "สร้างผู้เล่นใหม่และเพิ่มเข้ารอบแล้ว", { actionKey: `add-player:${event.id}:${existingMember?.id || normalizedName}` });
    if (saved) {
      setName("");
      setSelectedMemberId(null);
      setNewMemberSkill({ level: "", playableLevels: [] });
      setNewPlayerArrival("");
    }
  }

  async function addCatalogItem(submitEvent) {
    submitEvent.preventDefault();
    const saved = await mutate(() => addExtraCatalogItem({ clubId: context.club_id, name: newItem.name, price: newItem.price }), "เพิ่มสินค้าแล้ว", { actionKey: "catalog:add" });
    if (saved) setNewItem({ name: "", price: "" });
  }

  async function addPaymentExemptMember(submitEvent) {
    submitEvent.preventDefault();
    const member = savedMembers.find((entry) => entry.id === exemptMemberId);
    if (!member) {
      await mutate(async () => {
        throw new Error("ไม่พบชื่อนี้ กรุณาเลือกชื่อจากรายชื่อผู้เล่นทั้งหมด");
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
    }, `บันทึกชื่อ ${nickname} แล้ว`, { actionKey: `profile:${editingMember.id}` });
    if (saved) setEditingMember(null);
  }

  async function deleteMemberProfile() {
    if (!editingMember) return;
    const nickname = memberName(editingMember);
    const confirmed = window.confirm(
      `ลบ “${nickname}” ออกจากรายชื่อผู้เล่นทั้งหมดใช่ไหม?\n\nเป็นการซ่อนชื่อ ไม่ลบประวัติรอบเก่า ยอดค้าง หรือข้อมูลชำระเงิน คนที่ยังอยู่ในรอบหรือคิวจะลบไม่ได้`,
    );
    if (!confirmed) return;
    const saved = await mutate(() => archiveClubMember(editingMember.id), `นำ ${nickname} ออกจากรายชื่อแล้ว ประวัติยังอยู่`, { actionKey: `members:archive:${editingMember.id}` });
    if (saved) setEditingMember(null);
  }


  async function addCustomCharge(submitEvent) {
    submitEvent.preventDefault();
    const target = customChargeFor;
    if (!target) return;
    const saved = await mutate(() => addMemberExtraCharge({
      clubId: event.clubId,
      eventId: event.id,
      memberId: target.memberId,
      item: { name: customCharge.name.trim(), price: Number(customCharge.price) },
      userId: session.user.id,
    }), `เพิ่ม ${customCharge.name.trim()} ให้ ${target.name} แล้ว`, { actionKey: `extra:${target.memberId}` });
    if (saved) {
      setCustomChargeFor(null);
      setCustomCharge({ name: "", price: "" });
    }
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
    }), `เพิ่ม ${item.name} ให้ ${participantName} แล้ว`, { actionKey: `extra:${memberId}` });
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
      : `เช็กชื่อ ${target.participantName} แล้ว`, { actionKey: `attendance:${target.memberId}` });
    if (saved) setPendingCheckIn(null);
  }

  async function saveDeparture({ memberId, participantName, plannedArrival, leftAt, cumulativeCount = null }) {
    const currentRow = settlementByMember.get(memberId);
    if (currentRow?.paid && !currentRow.paymentExempt) {
      throw new Error("คนนี้รับเงินแล้ว หากต้องแก้เวลากลับ กรุณายกเลิกสถานะรับเงินก่อน");
    }
    if (event.billingModel === "per_round" && leftAt && currentRow?.billingFinalized) {
      throw new Error("คนนี้สรุปยอดแล้ว หากต้องแก้เวลากลับ กรุณาแก้ยอดหรือปลดล็อกก่อน");
    }
    if (event.billingModel === "per_round" && leftAt && cumulativeCount !== null) {
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

    await recordAudit({
      clubId: event.clubId,
      eventId: event.id,
      userId: session.user.id,
      action: leftAt
        ? `บันทึกเวลากลับของ ${participantName} เป็น ${leftAt} · ยังไม่สรุปยอด`
        : `ยกเลิกเวลากลับของ ${participantName}`,
      details: {
        member_id: memberId,
        left_at: leftAt || null,
        cumulative_shuttlecocks: cumulativeCount,
        requires_manual_bill_confirmation: true,
      },
    });
  }

  async function submitPendingDeparture(includeShuttlecockCount) {
    if (!pendingDeparture) return;
    if (includeShuttlecockCount && pendingDeparture.cumulativeCount === "") {
      window.alert("กรุณากรอกจำนวนลูกแบดสะสม หรือเลือกลงเวลากลับอย่างเดียว");
      return;
    }
    if (includeShuttlecockCount) {
      const affectedLocked = settlement.rows.filter((entry) => entry.billingFinalized && entry.leftAt === pendingDeparture.leftAt);
      if (affectedLocked.length && !window.confirm(`เวลา ${pendingDeparture.leftAt} มี ${affectedLocked.length} คนที่สรุปยอดแล้ว หากแก้จำนวนลูกแบด ระบบจะถอนยอดที่ยังไม่รับเงินและให้สรุปใหม่เพื่อป้องกันยอดผิด ดำเนินการต่อไหม?`)) return;
    }
    const saved = await mutate(() => saveDeparture({
      memberId: pendingDeparture.memberId,
      participantName: pendingDeparture.participantName,
      plannedArrival: pendingDeparture.plannedArrival,
      leftAt: pendingDeparture.leftAt,
      cumulativeCount: includeShuttlecockCount ? pendingDeparture.cumulativeCount : null,
    }), includeShuttlecockCount
      ? event.billingModel === "per_round"
        ? `บันทึก Snapshot ของ ${pendingDeparture.participantName} แล้ว · ยังไม่สรุปยอด`
        : `บันทึกเวลากลับของ ${pendingDeparture.participantName} แล้ว · ยังไม่สรุปยอด`
      : `บันทึกเฉพาะเวลากลับของ ${pendingDeparture.participantName} แล้ว · ลูกแบดจะหารจากยอดรวมตอนจบรอบ`, { actionKey: `departure:${pendingDeparture.memberId}` });
    if (saved) setPendingDeparture(null);
  }

  return (
    <section className="badminton-card badminton-participants-card">
      <div className="badminton-card-title badminton-player-card-title"><Users size={20} /><div><h2>ผู้เล่น</h2><p>{participants.length} คน</p></div><div className="badminton-player-title-actions"><label className="badminton-player-sort-icon" title={sortMode === "signup" ? "เรียงตามลำดับการลงชื่อ" : "เรียงตามตัวอักษร"}><ArrowUpDown size={18} /><select aria-label="เรียงลำดับผู้เล่น" onChange={(changeEvent) => changeSortMode(changeEvent.target.value)} value={sortMode}><option value="signup">ลำดับการลงชื่อ</option><option value="alphabetical">ตามตัวอักษร</option></select></label><button aria-label="เปิดรายชื่อผู้เล่นทั้งหมด" className="badminton-player-settings-button" onClick={() => setMemberDirectoryOpen(true)} title="รายชื่อผู้เล่นทั้งหมด" type="button"><Users size={18} /></button><button aria-label="ตั้งค่ารายชื่อและสินค้า" className="badminton-player-settings-button" onClick={() => setSettingsOpen(true)} title="ตั้งค่ารายชื่อและสินค้า" type="button"><Settings size={18} /></button></div></div>
      <form className="badminton-inline-form" onSubmit={addMember}>
        <ParticipantPicker allowCreate={event.status !== "closed"} disabled={addingPlayer} members={selectableMembers} participantIds={participantIds} value={name} selectedId={selectedMemberId} onQuery={(value) => { setName(value); setSelectedMemberId(null); setNewMemberSkill({ level: "", playableLevels: [] }); }} onSelect={(member) => { setName(memberName(member)); setSelectedMemberId(member.id); setNewMemberSkill({ level: member.skill_level || "", playableLevels: normalizePlayableSkillLevels(member.skill_level, member.playable_skill_levels, { allowLowerLevel: member.allow_lower_level, allowHigherLevel: member.allow_higher_level }) }); }} />
        {event.status === "closed" ? <small>รอบปิดแล้ว เลือกได้เฉพาะชื่อที่เคยนำออกจากรอบนี้</small> : <fieldset className="badminton-new-player-skill participant-add-skills" disabled={addingPlayer}>
          <select aria-label="ระดับมือผู้เล่น" disabled={Boolean(savedMembers.find((member) => member.id === selectedMemberId)?.skill_level)} onChange={(changeEvent) => setNewMemberSkill({ level: changeEvent.target.value, playableLevels: defaultPlayableSkillLevels(changeEvent.target.value) })} required value={newMemberSkill.level}><option value="">เลือกระดับมือ</option>{SKILL_LEVELS.map((level) => <option key={level} value={level}>{skillLabel(level)}</option>)}</select>
          {!selectedMemberId ? <SkillCompatibilityPicker onChange={(playableLevels) => setNewMemberSkill({ ...newMemberSkill, playableLevels })} skillLevel={newMemberSkill.level} value={newMemberSkill.playableLevels} /> : null}
        </fieldset>}
        {event.status === "open" && liveAddArrival ? <label className="badminton-add-player-arrival">มาถึงเวลา<select aria-label="เวลามาถึงของผู้เล่นใหม่" disabled={addingPlayer} onChange={(changeEvent) => setNewPlayerArrival(changeEvent.target.value)} value={addArrival}>{addArrivalOptions.map((time) => <option key={time} value={time}>{participantTimeLabel(time, event.startTime, event.endTime)}</option>)}</select></label> : null}
        <button className="badminton-primary badminton-add-player" disabled={addingPlayer} type="submit"><UserPlus size={17} /> {addingPlayer ? "กำลังเพิ่ม…" : "เพิ่มผู้เล่น"}</button>
      </form>

      <ParticipantFilters rows={participants} query={rosterQuery} onQuery={setRosterQuery} filter={rosterFilter} onFilter={setRosterFilter} />
      <div className="badminton-attendance-list">
        {sortedParticipants.length ? sortedParticipants.map(({ member, attendance: row, arrivalTime, submittedByLineName, skillLevel: roundSkillLevel }, playerIndex) => {
          const participantName = memberName(member);
          const plannedArrival = (arrivalTime || event.startTime).slice(0, 5);
          const leftAt = row?.leftAt || "";
          const arrivalOptions = participantTimeOptions({ startTime: event.startTime, endTime: event.endTime, current: plannedArrival, before: leftAt || null, includeEnd: false });
          const departureOptions = participantTimeOptions({ startTime: event.startTime, endTime: event.endTime, current: leftAt, after: plannedArrival });
          const playedMinutes = playedMinutesWithinEvent(event.startTime, event.endTime, plannedArrival, leftAt);
          const billingPercentage = Number(row?.billingPercentage ?? 100);
          const charges = (dashboard.memberExtras || []).filter((charge) => charge.member_id === member.id);
          const extraTotal = charges.reduce((sum, charge) => sum + Number(charge.unit_price) * Number(charge.quantity), 0);
          const settlementRow = settlementByMember.get(member.id);
          const due = settlementRow?.roundedDue || 0;
          const isPaid = Boolean(settlementRow?.paid) && !settlementRow?.paymentExempt;
          const lineName = member.nickname && member.nickname !== member.display_name ? member.display_name : "";
          const checkedIn = Boolean(row?.checkedIn && !leftAt);
          const personPending = pendingKeys.some((key) => typeof key === "string" && key.endsWith(`:${member.id}`));

          function updateArrival(nextArrival) {
            return mutate(() => updateSignupArrival({ eventId: event.id, memberId: member.id, arrivalTime: nextArrival }), `ปรับเวลามาของ ${participantName} แล้ว`, { actionKey: `arrival:${member.id}` });
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
              () => saveDeparture({ memberId: member.id, participantName, plannedArrival, leftAt: nextDeparture }),
              nextDeparture
                ? event.billingModel === "per_round"
                  ? `บันทึก Snapshot ของ ${participantName} แล้ว · ยังไม่สรุปยอด`
                  : `บันทึกเวลากลับของ ${participantName} แล้ว · ยังไม่สรุปยอด`
                : `ยกเลิกเวลากลับของ ${participantName} แล้ว`,
              { actionKey: `departure:${member.id}` },
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
              `ปรับสัดส่วนคิดเงินของ ${participantName} เป็น ${percentage}% แล้ว`, { actionKey: `percentage:${member.id}` },
            );
          }

          function removePlayer() {
            if (!window.confirm(participantRemovalMessage(participantName))) return null;
            return mutate(
              () => removeParticipant({ eventId: event.id, memberId: member.id }),
              `นำ ${participantName} ออกจากรายชื่อรอบแล้ว ประวัติยังอยู่`,
              { errorMode: "alert", actionKey: `player:remove:${member.id}` },
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
                `ยกเลิกเช็กชื่อ ${participantName} แล้ว`, { actionKey: `attendance:${member.id}` },
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
            <fieldset disabled={personPending} aria-busy={personPending} className={`participant-controls-lock badminton-attendance-row ${checkedIn ? "is-checked-in" : ""} ${leftAt ? "has-left" : ""} ${settlementRow?.billingFinalized ? "is-billed" : ""} ${settlementRow?.paid && !settlementRow?.paymentExempt ? "is-paid" : ""}`} key={member.id}>
              <div className="badminton-player-identity">
                <label className="badminton-check-in-box" title={leftAt ? `${participantName} กลับแล้ว` : `เช็กชื่อ ${participantName}`}><input aria-label={`เช็กชื่อ ${participantName}`} checked={checkedIn} disabled={Boolean(leftAt)} onChange={(changeEvent) => toggleCheckIn(changeEvent.target.checked)} type="checkbox" /><span aria-hidden="true"><Check size={14} /></span></label>
                <b className="badminton-player-index">{playerIndex + 1}.</b>
                <div className="badminton-player-name"><strong>{participantName}</strong>{personPending ? <span className="participant-pending" role="status">กำลังบันทึก…</span> : null}{lineName ? <span title={`LINE: ${lineName}`}>LINE: {lineName}</span> : null}</div>
                {roundSkillLevel || member.skill_level ? <em className="badminton-skill-badge">{skillLabel(roundSkillLevel || member.skill_level)}</em> : null}
                <button aria-label={`แก้ไขชื่อ ${participantName}`} className="badminton-member-edit-button" onClick={() => openMemberEditor(member)} type="button"><Pencil size={13} /></button>
                {submittedByLineName ? <small className="badminton-signup-attribution" title={`ลงชื่อให้โดย LINE: ${submittedByLineName}`}>ลงชื่อให้โดย LINE: {submittedByLineName}</small> : null}
              </div>
              <div className={`badminton-player-cost-status ${leftAt ? "has-departure-status" : ""}`}>{leftAt ? <span className="participant-left-status">กลับแล้ว · {leftAt}<button onClick={() => { if (window.confirm(`ให้ ${participantName} กลับมาอยู่ในรายการรอเล่นต่อใช่ไหม?`)) updateDeparture(""); }} type="button">ยังไม่กลับ</button></span> : null}<div className={`badminton-player-billing-meta ${settlementRow?.locked ? "is-locked" : ""}`}>{event.billingModel === "per_round" ? <span className="badminton-round-count">{settlementRow?.roundsPlayed || 0} รอบ</span> : <select aria-label={`เปอร์เซ็นต์คิดเงิน ${participantName}`} onChange={(changeEvent) => updateBillingPercentage(changeEvent.target.value, changeEvent.currentTarget)} value={billingPercentage}>{BILLING_PERCENT_OPTIONS.map((percentage) => <option key={percentage} value={percentage}>{percentage}%</option>)}</select>}<small>{event.billingModel === "per_round" ? "คิดตามเกมที่จบ" : formatPlayedDuration(playedMinutes)}</small><strong>{settlementRow?.paid && !settlementRow?.paymentExempt ? `จ่ายแล้ว ${baht(due)}` : settlementRow?.billingFinalized ? `สรุปแล้ว ${baht(due)}` : `ยังไม่สรุป · ≈ ${baht(due)}`} บาท</strong></div></div>
              <div className="badminton-player-controls">
                <label><span>มา</span><select aria-label={`เวลามา ${participantName}`} value={plannedArrival} onChange={(changeEvent) => updateArrival(changeEvent.target.value)}>{arrivalOptions.map((time) => <option key={time} value={time}>{participantTimeLabel(time, event.startTime, event.endTime)}</option>)}</select></label>
                <label><span>กลับ</span><select aria-label={`เวลากลับ ${participantName}`} value={leftAt} onChange={(changeEvent) => updateDeparture(changeEvent.target.value)}><option value="">อยู่จนจบรอบ</option>{departureOptions.map((time) => <option key={time} value={time}>{time}</option>)}</select></label>
                <label className="badminton-extra-select-wrap"><span>น้ำ/ขนม</span><select aria-label={`เพิ่มน้ำหรือขนมให้ ${participantName}`} disabled={isPaid} onChange={(changeEvent) => chooseExtra(changeEvent.target.value, member.id, participantName)} title={isPaid ? "ยกเลิกรับเงินก่อนแก้สินค้า" : "เลือกน้ำหรือขนม"} value=""><option value="">+ น้ำ/ขนม{extraTotal ? ` ${baht(extraTotal)}` : ""}</option>{(dashboard.extraItems || []).map((item) => <option key={item.id} value={item.id}>{item.name} · {baht(item.price)} บาท</option>)}<option value="custom">กรอกค่าใช้จ่ายเอง…</option></select></label>
                <button aria-label={`ลบ ${participantName}`} className="badminton-delete-button" onClick={removePlayer} type="button"><Trash2 size={17} /></button>
              </div>
              {charges.length ? <div className="badminton-member-charges">{charges.map((charge) => <span key={charge.id}>{charge.item_name} {baht(Number(charge.unit_price) * Number(charge.quantity))}{!isPaid ? <button aria-label={`ลบ ${charge.item_name}`} onClick={() => mutate(() => removeMemberExtraCharge(charge.id), `ลบ ${charge.item_name} แล้ว`)} type="button">×</button> : null}</span>)}</div> : null}
            </fieldset>
          );
        }) : <div className="badminton-empty">ไม่พบผู้เล่นตามตัวกรอง</div>}
      </div>
      {settingsOpen ? <div className="badminton-modal-backdrop" role="presentation"><div aria-label="ตั้งค่าผู้เล่น" aria-modal="true" className="badminton-custom-charge-modal badminton-player-settings-modal" role="dialog"><div className="badminton-modal-title"><div><p className="badminton-kicker">ตั้งค่าผู้เล่น</p><h2>รายชื่อและสินค้า</h2></div><button aria-label="ปิดการตั้งค่าผู้เล่น" onClick={() => setSettingsOpen(false)} type="button"><X size={19} /></button></div><section className="badminton-settings-section"><div className="badminton-settings-section-title"><WalletCards size={17} /><strong>รายชื่อไม่ต้องเก็บเงิน</strong><em>{savedMembers.filter((member) => member.payment_exempt).length} คน</em></div><form className="badminton-exempt-member-form" onSubmit={addPaymentExemptMember}><select aria-label="เลือกสมาชิกที่ไม่ต้องเก็บเงิน" onChange={(changeEvent) => setExemptMemberId(changeEvent.target.value)} required value={exemptMemberId}><option value="">เลือกสมาชิกจากรายชื่อเดิม</option>{savedMembers.filter((member) => !member.payment_exempt).sort((left, right) => memberName(left).localeCompare(memberName(right), "th")).map((member) => <option key={member.id} value={member.id}>{paymentExemptIdentity(member)}</option>)}</select><button className="badminton-secondary" type="submit"><Plus size={15} /> เพิ่ม</button></form><div className="badminton-exempt-member-list">{savedMembers.filter((member) => member.payment_exempt).map((member) => <span key={member.id}><span><strong>{memberName(member)}</strong><small>{member.line_user_id ? `LINE: ${member.display_name || "เชื่อมแล้ว"}` : "ยังไม่เชื่อม LINE"}</small></span><button aria-label={`นำ ${memberName(member)} ออกจากรายชื่อไม่ต้องเก็บเงิน`} onClick={() => removePaymentExemptMember(member)} type="button"><X size={14} /></button></span>)}</div><small className="badminton-settings-help">เลือกจากสมาชิกตัวจริงโดยดูชื่อ LINE ประกอบ ระบบจะไม่จับคู่ด้วยชื่อเล่น จึงแยกคนชื่อซ้ำได้ถูกต้อง</small><small className="badminton-settings-help">คนในรายชื่อนี้ยังร่วมถูกหารค่าใช้จ่าย แต่ระบบจะถือว่าชำระแล้วและไม่ใส่ในข้อความส่ง LINE</small></section><section className="badminton-settings-section"><button className="badminton-secondary" onClick={() => { setSettingsOpen(false); setMemberDirectoryOpen(true); }} type="button"><Users size={17} /> รายชื่อผู้เล่นทั้งหมด · แก้ไข รวมชื่อซ้ำ หรือลบออกจากรายชื่อ</button></section><section className="badminton-settings-section"><div className="badminton-settings-section-title"><PackagePlus size={17} /><strong>รายการสินค้า น้ำ-ขนม</strong></div><div className="badminton-catalog-list">{(dashboard.extraItems || []).map((item) => <div className="badminton-catalog-item" key={item.id}><span>{item.name}</span><input aria-label={`ราคา ${item.name}`} defaultValue={item.price} min="0" onBlur={(changeEvent) => { const value = changeEvent.target.value; mutate(() => updateExtraCatalogItem(item.id, value), `แก้ราคา ${item.name} แล้ว`, { actionKey: `catalog:price:${item.id}` }); }} type="number" /><em>บาท</em><button aria-label={`ลบสินค้า ${item.name}`} className="badminton-catalog-delete" onClick={() => { if (window.confirm(`ลบ ${item.name} ออกจากรายการสินค้า?`)) mutate(() => removeExtraCatalogItem(item.id), `ลบ ${item.name} แล้ว`); }} type="button"><Trash2 size={15} /></button></div>)}</div><form className="badminton-catalog-add" onSubmit={addCatalogItem}><input aria-label="ชื่อรายการใหม่" placeholder="ชื่อรายการ" required value={newItem.name} onChange={(changeEvent) => setNewItem({ ...newItem, name: changeEvent.target.value })} /><input aria-label="ราคารายการใหม่" min="0" placeholder="ราคา" required type="number" value={newItem.price} onChange={(changeEvent) => setNewItem({ ...newItem, price: changeEvent.target.value })} /><button className="badminton-secondary" type="submit"><Plus size={15} /> เพิ่ม</button></form></section></div></div> : null}
      {editingMember ? (
        <div className="badminton-modal-backdrop badminton-member-edit-backdrop" role="presentation">
          <form className="badminton-custom-charge-modal badminton-member-edit-modal" onSubmit={saveMember}>
            <div className="badminton-modal-title"><div><p className="badminton-kicker">ข้อมูลสมาชิกเดิม</p><h2>แก้ไขโปรไฟล์ผู้เล่น</h2></div><button aria-label="ปิดหน้าต่างแก้ไขชื่อ" onClick={() => setEditingMember(null)} type="button"><X size={19} /></button></div>
            <label>ชื่อเล่น<input maxLength="40" onChange={(changeEvent) => setMemberEdit({ ...memberEdit, nickname: changeEvent.target.value })} required value={memberEdit.nickname} /></label>
            <label>ชื่อ LINE<input maxLength="80" onChange={(changeEvent) => setMemberEdit({ ...memberEdit, displayName: changeEvent.target.value })} required value={memberEdit.displayName} /></label>
            <label>ระดับมือ<select onChange={(changeEvent) => setMemberEdit({ ...memberEdit, skillLevel: changeEvent.target.value, playableSkillLevels: defaultPlayableSkillLevels(changeEvent.target.value) })} required value={memberEdit.skillLevel}><option value="">เลือกระดับมือ</option>{SKILL_LEVELS.map((level) => <option key={level} value={level}>{skillLabel(level)}</option>)}</select></label>
            <SkillCompatibilityPicker onChange={(playableSkillLevels) => setMemberEdit({ ...memberEdit, playableSkillLevels })} skillLevel={memberEdit.skillLevel} value={memberEdit.playableSkillLevels} />
            <p className="badminton-member-sync-note">บันทึกชื่อและมือในข้อมูลสมาชิก ใช้ต่อในรอบถัดไปและรอบที่ยังเปิดอยู่ โดยไม่เปลี่ยนประวัติเกมเดิม</p>
            {editingMember.line_user_id ? <p className="badminton-member-sync-note">คนนี้เชื่อมกับ LINE แล้ว ชื่อ LINE จะอัปเดตอัตโนมัติเมื่อเข้าหน้าลงชื่อครั้งถัดไป</p> : null}
            <div className="badminton-member-edit-actions">
              <button className="badminton-primary" type="submit"><Save size={17} /> บันทึกโปรไฟล์</button>
              <button className="badminton-danger-button" onClick={deleteMemberProfile} type="button"><Trash2 size={17} /> ลบออกจากรายชื่อ</button>
            </div>
          </form>
        </div>
      ) : null}
      {customChargeFor ? <div className="badminton-modal-backdrop" role="presentation"><form className="badminton-custom-charge-modal" onSubmit={addCustomCharge}><div className="badminton-modal-title"><div><p className="badminton-kicker">ค่าใช้จ่ายเฉพาะคน</p><h2>เพิ่มรายการให้ {customChargeFor.name}</h2></div><button aria-label="ปิดหน้าต่าง" onClick={() => setCustomChargeFor(null)} type="button"><X size={19} /></button></div><label>ชื่อรายการ<input autoFocus maxLength="80" onChange={(changeEvent) => setCustomCharge({ ...customCharge, name: changeEvent.target.value })} placeholder="เช่น ค่าเอ็นไม้" required value={customCharge.name} /></label><label>ราคา (บาท)<input min="0" onChange={(changeEvent) => setCustomCharge({ ...customCharge, price: changeEvent.target.value })} placeholder="0" required type="number" value={customCharge.price} /></label><button className="badminton-primary" type="submit"><Plus size={17} /> เพิ่มค่าใช้จ่าย</button></form></div> : null}
      {memberDirectoryOpen ? <MemberDirectoryModal context={context} dashboard={dashboard} settlement={settlement} mutate={mutate} onClose={() => setMemberDirectoryOpen(false)} onDetails={(member) => { setMemberDirectoryOpen(false); openMemberEditor(member); }} /> : null}
      {pendingCheckIn ? <div className="badminton-modal-backdrop" role="presentation"><div aria-label="ยืนยันเวลาเช็กชื่อ" aria-modal="true" className="badminton-custom-charge-modal badminton-check-in-modal" role="dialog"><div className="badminton-modal-title"><div><p className="badminton-kicker">เช็กชื่อผู้เล่น</p><h2>{pendingCheckIn.participantName} มาถึงแล้ว</h2></div><button aria-label="ปิด" onClick={() => setPendingCheckIn(null)} type="button"><X size={19} /></button></div><p>ลงชื่อไว้เวลา <strong>{pendingCheckIn.plannedArrival} น.</strong> ตอนนี้ประมาณ <strong>{pendingCheckIn.suggestedArrival} น.</strong></p><div className="badminton-check-in-actions"><button className="badminton-secondary" onClick={() => completeCheckIn(pendingCheckIn, false)} type="button">ใช้เวลาเดิม {pendingCheckIn.plannedArrival}</button><button className="badminton-primary" onClick={() => completeCheckIn(pendingCheckIn, true)} type="button">ปรับเป็น {pendingCheckIn.suggestedArrival}</button></div></div></div> : null}
      {pendingDeparture ? <div className="badminton-modal-backdrop" role="presentation"><form aria-label="บันทึกเวลากลับและจำนวนลูกแบด" className="badminton-custom-charge-modal" onSubmit={async (submitEvent) => {
        submitEvent.preventDefault();
        await submitPendingDeparture(true);
      }}><div className="badminton-modal-title"><div><p className="badminton-kicker">ผู้เล่นกลับก่อน</p><h2>{pendingDeparture.participantName} · {pendingDeparture.leftAt} น.</h2></div><button aria-label="ปิด" onClick={() => setPendingDeparture(null)} type="button"><X size={19} /></button></div><p>ตอนเวลานี้ใช้ลูกแบดสะสมไปทั้งหมดกี่ลูก?</p><label>จำนวนลูกแบดสะสม<input autoFocus min="0" onChange={(changeEvent) => setPendingDeparture({ ...pendingDeparture, cumulativeCount: changeEvent.target.value })} placeholder="กรอกจำนวนที่ใช้จริง" required type="number" value={pendingDeparture.cumulativeCount} /></label>{event.billingModel === "per_round" ? <small className="badminton-settings-help">ถ้าบันทึก Snapshot ระบบจะเก็บต้นทุนและจำนวนเกมของช่วงนี้ไว้ หากไม่ต้องการแยกลูกตามเวลา ให้เลือกลงเวลากลับอย่างเดียวแล้วหารลูกทั้งหมดตอนจบรอบ</small> : <small className="badminton-settings-help">เลือกลงเวลากลับอย่างเดียวได้ หากต้องการใช้จำนวนลูกแบดรวมตอนจบรอบ</small>}<div className="badminton-check-in-actions"><button className="badminton-secondary" onClick={() => submitPendingDeparture(false)} type="button">ลงเวลากลับอย่างเดียว</button><button className="badminton-primary" type="submit"><Check size={17} /> {event.billingModel === "per_round" ? "บันทึก Snapshot พร้อมลูก" : "บันทึกพร้อมจำนวนลูก"}</button></div></form></div> : null}
    </section>
  );
}

function PricingPanel({ event, mutate, session, settlement }) {
  const [editingCourt, setEditingCourt] = useState(false);
  const [editingShuttle, setEditingShuttle] = useState(false);
  const [priceSaving, setPriceSaving] = useState({ court: false, shuttlecock: false });
  const [expenseSaving, setExpenseSaving] = useState(false);
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

  async function savePrice(priceType, value) {
    setPriceSaving((current) => ({ ...current, [priceType]: true }));
    try {
      const saved = await mutate(() => updateEventPriceAndDefault({ clubId: event.clubId, eventId: event.id, eventDate: event.date, priceType, value }),
        priceType === "court" ? "แก้ราคาคอร์ทและบันทึกเป็นค่าเริ่มต้นของวันนี้แล้ว" : "แก้ราคาลูกแบดและบันทึกเป็นค่าเริ่มต้นแล้ว",
        { actionKey: `price:${priceType}:${event.id}` });
      if (saved) (priceType === "court" ? setEditingCourt : setEditingShuttle)(false);
    } finally {
      setPriceSaving((current) => ({ ...current, [priceType]: false }));
    }
  }

  async function submitExpense(submitEvent) {
    submitEvent.preventDefault();
    if (expenseSaving) return;
    setExpenseSaving(true);
    try {
      const saved = await mutate(() => addExpense({ clubId: event.clubId, eventId: event.id, userId: session.user.id, label, amount }), "เพิ่มค่าใช้จ่ายแล้ว", { actionKey: `expense:add:${event.id}` });
      if (saved) { setLabel(""); setAmount(""); }
    } finally { setExpenseSaving(false); }
  }

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
      ? "ค่าสนาม ลูกแบด และค่าใช้จ่ายส่วนกลางจะหารตามจำนวนเกมที่เล่น ผู้เล่นที่กลับก่อนจะบันทึก Snapshot ไว้คำนวณ และแอดมินสรุปยอดภายหลัง"
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
            {editingCourt ? <input autoFocus disabled={priceSaving.court} min="0" type="number" defaultValue={event.courtHourlyRate} onBlur={(e) => savePrice("court", e.target.value)} /> : <span>{baht(event.courtHourlyRate)} บาท/ชม.</span>}
            <button className="badminton-edit-price" disabled={priceSaving.court} onClick={() => setEditingCourt(true)} type="button">{priceSaving.court ? "บันทึก…" : "แก้ราคา"}</button>
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
            {editingShuttle ? <input autoFocus disabled={priceSaving.shuttlecock} min="0" type="number" defaultValue={event.shuttlecockUnitPrice} onBlur={(e) => savePrice("shuttlecock", e.target.value)} /> : <span>{baht(event.shuttlecockUnitPrice)} บาท/ลูก</span>}
            <button className="badminton-edit-price" disabled={priceSaving.shuttlecock} onClick={() => setEditingShuttle(true)} type="button">{priceSaving.shuttlecock ? "บันทึก…" : "แก้ราคา"}</button>
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
            <label key={cost.id}><span>{cost.label}</span><input defaultValue={cost.amount} min="0" type="number" onBlur={(e) => { const value = e.target.value; mutate(() => updateExpense(cost.id, value), "อัปเดตค่าใช้จ่ายแล้ว", { actionKey: `expense:update:${cost.id}` }); }} /></label>
          ))}
        </div>
      </div>
      <form className="badminton-inline-form" onSubmit={submitExpense}>
        <input disabled={expenseSaving} placeholder="รายการอื่น (ถ้ามี)" required value={label} onChange={(e) => setLabel(e.target.value)} />
        <input disabled={expenseSaving} min="0" placeholder="บาท" required type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button className="badminton-secondary" disabled={expenseSaving} type="submit"><Plus size={17} /> {expenseSaving ? "บันทึก…" : "เพิ่ม"}</button>
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
  const [outstandingCopied, setOutstandingCopied] = useState(false);
  const [outstandingQuery, setOutstandingQuery] = useState("");
  const [outstandingSource, setOutstandingSource] = useState("all");
  const [outstandingSort, setOutstandingSort] = useState("amount");
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
  const visibleOutstandingGroups = useMemo(() => filterAndSortOutstanding(outstandingGroups, {
    query: outstandingQuery,
    source: outstandingSource,
    sort: outstandingSort,
  }), [outstandingGroups, outstandingQuery, outstandingSource, outstandingSort]);

  async function copySummary() {
    await navigator.clipboard.writeText(lineSummary);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function copyAllOutstanding() {
    await copyTextToClipboard(buildOutstandingLineMessage(outstandingGroups, previousOutstanding.total));
    setOutstandingCopied(true);
    window.setTimeout(() => setOutstandingCopied(false), 1800);
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
    }, nextPaid ? `บันทึกรับเงิน ${row.name} แล้ว` : "ยกเลิกสถานะรับเงินแล้ว", { actionKey: `payment:${row.memberId}` });
  }

  async function confirmBill(submitEvent) {
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
    const saved = await mutate(async () => {
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
    }, `สรุปยอด ${row.name} เป็น ${baht(billedAmount)} บาทแล้ว`, { actionKey: `bill:${row.memberId}` });
    if (saved) setBillDraft(null);
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
        <div className="badminton-outstanding-tools">
          <label className="badminton-outstanding-search"><Search size={16} /><input aria-label="ค้นหาคนค้างจ่าย" onChange={(changeEvent) => setOutstandingQuery(changeEvent.target.value)} placeholder="ค้นหาชื่อหรือชื่อ LINE" type="search" value={outstandingQuery} /></label>
          <select aria-label="กรองประเภทผู้เล่น" onChange={(changeEvent) => setOutstandingSource(changeEvent.target.value)} value={outstandingSource}><option value="all">ทุกคน</option><option value="line">เชื่อม LINE</option><option value="walkin">Walk-in</option></select>
          <select aria-label="เรียงยอดค้าง" onChange={(changeEvent) => setOutstandingSort(changeEvent.target.value)} value={outstandingSort}><option value="amount">ยอดมากสุด</option><option value="rounds">จำนวนรอบมากสุด</option><option value="oldest">ค้างนานสุด</option><option value="name">เรียงตามชื่อ</option></select>
          <button className="badminton-primary badminton-copy-outstanding" disabled={!outstandingGroups.length} onClick={copyAllOutstanding} type="button"><Copy size={17} /> {outstandingCopied ? "คัดลอกแล้ว" : "คัดลอกรายชื่อและยอดค้างทั้งหมด"}</button>
        </div>
        <div className="badminton-outstanding-list">
          {visibleOutstandingGroups.length ? visibleOutstandingGroups.map((group) => {
            const nickname = memberName(group.member);
            const lineName = String(group.member.display_name || "").trim();
            const lineLabel = lineName && lineName !== nickname ? `LINE: ${lineName} · ` : "";
            const age = outstandingAgeInDays(group);
            return <details key={group.member.id}><summary><span><strong>{nickname}</strong><small>{lineLabel}{group.rows.length} รอบ · {age > 0 ? `ค้างสูงสุด ${age} วัน` : "ค้างวันนี้"}</small></span><b>{baht(group.total)} บาท</b></summary><div>{group.rows.map((row) => <article key={row.id}><span><strong>{formatRoundOption(row.event.event_date)}</strong><small>{row.event.venue}</small></span><b>{baht(row.amount)} บาท</b><button className="badminton-primary" onClick={() => settleOutstanding(row)} type="button"><Check size={15} /> จ่ายรอบนี้แล้ว</button></article>)}</div></details>;
          }) : <div className="badminton-empty"><Check size={20} /> {outstandingGroups.length ? "ไม่พบรายชื่อตามตัวกรอง" : "ไม่มีใครค้างจ่าย"}</div>}
        </div>
      </section>
    );
  }

  return (
    <section className="badminton-card badminton-settlement-card" id="settlement">
      <PaymentSubtabs />
      <div className="badminton-payment-workspace">
        <div className="badminton-card-title badminton-payment-heading"><ReceiptText size={20} /><div><h2>สรุปยอด</h2></div><button aria-label="ตั้งค่าข้อความชำระเงินใน LINE" className="badminton-payment-settings-button" onClick={() => setPaymentSettingsOpen(true)} title="ตั้งค่าข้อความชำระเงินใน LINE" type="button"><Settings size={18} /></button></div>
        {perRoundAwaitingClose ? <div className="badminton-per-round-pending"><Timer size={18} /><div><strong>กำลังคำนวณตามจำนวนรอบ</strong><span>ผู้เล่นที่กลับก่อนบันทึก Snapshot ได้ แต่ยอดจะยังไม่แสดงให้ผู้เล่นจนกว่าแอดมินจะสรุปหลังจบรอบ</span></div></div> : null}
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
          {collectionRows.map((row) => <PaymentRow
            extraLabel={formatExtraItems(row.extraCharges)}
            key={row.memberId}
            onEditBill={(billRow) => setBillDraft({ row: billRow, amount: String(billRow.billedAmount) })}
            onTogglePayment={togglePayment}
            perRoundAwaitingClose={perRoundAwaitingClose}
            row={row}
          />)}
        </div>
        {collectionSummary.finalizedCount > 0 && lineSummary.trim() ? <><textarea readOnly value={lineSummary} /><button className="badminton-primary" onClick={copySummary} type="button"><Copy size={18} /> {copied ? "คัดลอกแล้ว" : "คัดลอกสรุปส่ง LINE"}</button></> : <p className="badminton-note">กด “สรุปยอด” ของผู้เล่นก่อน จึงจะมีข้อความยอดเรียกเก็บสำหรับส่ง LINE</p>}
      </div>
      {paymentSettingsOpen ? <div className="badminton-modal-backdrop" role="presentation"><div aria-label="ตั้งค่าข้อความชำระเงินใน LINE" aria-modal="true" className="badminton-custom-charge-modal badminton-payment-settings-modal" role="dialog"><div className="badminton-modal-title"><div><p className="badminton-kicker">ตั้งค่าชำระเงิน</p><h2>ข้อความที่บอทส่ง</h2></div><button aria-label="ปิดการตั้งค่าชำระเงิน" onClick={() => setPaymentSettingsOpen(false)} type="button"><X size={19} /></button></div><label className="badminton-line-payment-summary-toggle"><span><strong>ส่งรายชื่อพร้อมยอดค่าใช้จ่าย</strong><small>{context.clubs.line_payment_include_summary !== false ? "เปิดอยู่ · ส่งรายชื่อพร้อมยอด แล้วตามด้วยการ์ดชำระเงิน" : "ปิดอยู่ · ส่งเฉพาะการ์ดชำระเงิน"}</small></span><input aria-label="ส่งรายชื่อและยอดค่าใช้จ่ายใน LINE" checked={context.clubs.line_payment_include_summary !== false} onChange={(changeEvent) => { const checked = changeEvent.target.checked; mutate(() => updateLinePaymentSummarySetting(context.club_id, checked), checked ? "เปิดส่งรายชื่อพร้อมยอดใน LINE แล้ว" : "ปิดส่งรายชื่อพร้อมยอดใน LINE แล้ว", { actionKey: `payment-summary:${context.club_id}` }); }} type="checkbox" /></label><p className="badminton-settings-help">ใช้กับคำสั่ง “ชำระเงิน” และ “แจ้งโอน” ใน LINE</p></div></div> : null}
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
    <div className="badminton-slip-review-summary"><span><small>รอตรวจ</small><strong>{orderedSlips.length} รายการ</strong></span><span><small>ยอดรวมสลิปรอตรวจ</small><strong>{baht(expectedTotal)} บาท</strong></span><span><small>อ่านยอดได้</small><strong>{readableAmountCount}/{orderedSlips.length}</strong></span></div>
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
  const storedStartTime = dashboard.event.starts_at.slice(0, 5);
  const storedEndTime = dashboard.event.ends_at.slice(0, 5);
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
  const { startTime, endTime } = sessionBoundsFromCourts(courts, storedStartTime, storedEndTime);
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
      removedAt: signup.removed_at || null,
      removedBy: signup.removed_by || null,
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
      billingFinalized: isPaymentAdminConfirmed(payment),
      billedAmount: isPaymentAdminConfirmed(payment) ? Number(payment.amount || 0) : null,
      calculatedAmount: payment?.calculated_amount === null || payment?.calculated_amount === undefined ? null : Number(payment.calculated_amount),
      paymentStatus: payment?.payment_status || (payment?.paid_at ? "paid" : "draft"),
      paidSource: payment?.paid_source || null,
      transferredAmount: payment?.transferred_amount === null || payment?.transferred_amount === undefined ? null : Number(payment.transferred_amount),
      overpaymentAmount: Number(payment?.overpayment_amount || 0),
      lockedSharedAmount: isPaymentAdminConfirmed(payment) && payment.shared_amount !== null && payment.shared_amount !== undefined ? Number(payment.shared_amount) : null,
      lockedExtraAmount: isPaymentAdminConfirmed(payment) && payment.extras_amount !== null && payment.extras_amount !== undefined ? Number(payment.extras_amount) : null,
      shuttlecockCountSnapshot: isPaymentAdminConfirmed(payment) ? payment.shuttlecock_count_snapshot : null,
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
