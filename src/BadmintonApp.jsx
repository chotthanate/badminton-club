import React, { useMemo, useState } from "react";
import {
  BadgeCheck,
  CalendarDays,
  Check,
  Clock,
  Copy,
  Lock,
  LogOut,
  Plus,
  ReceiptText,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";
import { usePersistentState } from "./storage.js";
import {
  STATUS_LABELS,
  WEIGHT_PRESETS,
  baht,
  buildLineSummary,
  calculateSettlement,
  createInitialEvent,
  formatThaiDate,
  memberName,
  weightFromTimes,
} from "./badmintonLogic.js";

const STORAGE_KEY = "badminton.club.v1";

export default function BadmintonApp() {
  const [event, setEvent] = usePersistentState(STORAGE_KEY, createInitialEvent());
  const [viewerId, setViewerId] = useState(event.members[0]?.id || "");
  const [copied, setCopied] = useState(false);
  const viewer = event.members.find((member) => member.id === viewerId) || event.members[0];
  const isAdmin = viewer?.role === "admin";
  const settlement = useMemo(() => calculateSettlement(event), [event]);
  const currentSignup = event.signups.find((signup) => signup.memberId === viewer?.id);
  const currentAttendance = event.attendance.find((row) => row.memberId === viewer?.id);
  const lineSummary = useMemo(() => buildLineSummary(event), [event]);

  function updateEvent(updater) {
    setEvent((current) => ({
      ...updater(current),
      actions: current.actions,
    }));
  }

  function recordAction(action) {
    setEvent((current) => ({
      ...current,
      actions: [
        {
          id: `a-${Date.now()}`,
          actorId: viewer?.id,
          actorName: viewer?.name,
          at: new Date().toLocaleString("th-TH"),
          action,
        },
        ...current.actions,
      ].slice(0, 20),
    }));
  }

  function setSignup(status) {
    if (!viewer) return;
    setEvent((current) => {
      const nextSignups = upsertByMember(current.signups, viewer.id, {
        memberId: viewer.id,
        status,
        note: "",
      });
      const shouldAddAttendance = status === "coming" || status === "maybe";
      const nextAttendance = shouldAddAttendance
        ? upsertAttendance(current.attendance, {
            memberId: viewer.id,
            name: viewer.name,
            arrived: status === "coming",
            weight: 1,
            arrivedAt: status === "coming" ? current.startTime : "",
            leftAt: "",
            note: "",
            paid: false,
          })
        : current.attendance.map((row) =>
            row.memberId === viewer.id ? { ...row, arrived: false } : row,
          );
      return {
        ...current,
        signups: nextSignups,
        attendance: nextAttendance,
        actions: [
          {
            id: `a-${Date.now()}`,
            actorId: viewer.id,
            actorName: viewer.name,
            at: new Date().toLocaleString("th-TH"),
            action: `กด${STATUS_LABELS[status]}`,
          },
          ...current.actions,
        ].slice(0, 20),
      };
    });
  }

  function markLeftNow() {
    if (!viewer) return;
    const now = new Date();
    const leftAt = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    setEvent((current) => ({
      ...current,
      attendance: upsertAttendance(current.attendance, {
        memberId: viewer.id,
        name: viewer.name,
        arrived: true,
        arrivedAt: currentAttendance?.arrivedAt || current.startTime,
        leftAt,
        weight: weightFromTimes(current.startTime, current.endTime, leftAt),
        note: "กดกลับแล้วจาก LINE",
        paid: currentAttendance?.paid || false,
      }),
      actions: [
        {
          id: `a-${Date.now()}`,
          actorId: viewer.id,
          actorName: viewer.name,
          at: new Date().toLocaleString("th-TH"),
          action: `กดกลับแล้ว ${leftAt}`,
        },
        ...current.actions,
      ].slice(0, 20),
    }));
  }

  function updateAttendance(memberId, patch) {
    if (!isAdmin) return;
    const member = event.members.find((item) => item.id === memberId);
    if (!member) return;
    setEvent((current) => ({
      ...current,
      attendance: upsertAttendance(current.attendance, {
        memberId,
        name: member.name,
        arrived: true,
        weight: 1,
        arrivedAt: current.startTime,
        leftAt: "",
        note: "",
        paid: false,
        ...current.attendance.find((row) => row.memberId === memberId),
        ...patch,
      }),
      actions: [
        {
          id: `a-${Date.now()}`,
          actorId: viewer.id,
          actorName: viewer.name,
          at: new Date().toLocaleString("th-TH"),
          action: `แอดมินแก้ข้อมูล ${member.name}`,
        },
        ...current.actions,
      ].slice(0, 20),
    }));
  }

  function setLeftAt(memberId, leftAt) {
    updateAttendance(memberId, {
      leftAt,
      weight: leftAt ? weightFromTimes(event.startTime, event.endTime, leftAt) : 1,
    });
  }

  function addWalkIn() {
    if (!isAdmin) return;
    const name = window.prompt("ชื่อคนที่เพิ่มหน้างาน");
    if (!name?.trim()) return;
    const id = `m-${Date.now()}`;
    setEvent((current) => ({
      ...current,
      members: [...current.members, { id, name: name.trim(), role: "member", lineUserId: "", active: true }],
      signups: [...current.signups, { memberId: id, status: "coming", note: "เพิ่มโดยแอดมิน" }],
      attendance: [
        ...current.attendance,
        { memberId: id, name: name.trim(), arrived: true, weight: 1, arrivedAt: current.startTime, leftAt: "", note: "เพิ่มหน้างาน", paid: false },
      ],
      actions: [
        {
          id: `a-${Date.now()}`,
          actorId: viewer.id,
          actorName: viewer.name,
          at: new Date().toLocaleString("th-TH"),
          action: `เพิ่มคนหน้างาน ${name.trim()}`,
        },
        ...current.actions,
      ].slice(0, 20),
    }));
  }

  function updateCost(costId, patch) {
    if (!isAdmin) return;
    updateEvent((current) => ({
      ...current,
      costs: current.costs.map((cost) => (cost.id === costId ? { ...cost, ...patch } : cost)),
    }));
    recordAction("แอดมินแก้ค่าใช้จ่าย");
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(lineSummary);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="badminton-app">
      <section className="badminton-shell">
        <header className="badminton-header">
          <div>
            <p className="badminton-kicker">LINE group companion</p>
            <h1>จัดการกลุ่มแบด</h1>
            <p>สมาชิกกดลงชื่อใน LINE ส่วนแอดมินคุมเวลา เปอร์เซ็นต์ และยอดจ่ายจริง</p>
          </div>
          <div className="badminton-viewer">
            <label htmlFor="viewer">ดูในฐานะ</label>
            <select id="viewer" value={viewer?.id || ""} onChange={(event) => setViewerId(event.target.value)}>
              {event.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} {member.role === "admin" ? "(admin)" : ""}
                </option>
              ))}
            </select>
          </div>
        </header>

        <section className="badminton-event">
          <div className="badminton-event-title">
            <CalendarDays size={22} />
            <div>
              <h2>{event.title}</h2>
              <p>{formatThaiDate(event.date)} เวลา {event.startTime}-{event.endTime}</p>
            </div>
          </div>
          <div className="badminton-status">
            <span>{event.status === "closed" ? "ปิดรอบแล้ว" : "เปิดลงชื่อ"}</span>
            <strong>{event.signups.filter((signup) => signup.status === "coming").length} คนมา</strong>
          </div>
        </section>

        <div className="badminton-grid">
          <MemberPanel
            attendance={currentAttendance}
            onLeftNow={markLeftNow}
            onSignup={setSignup}
            signup={currentSignup}
            viewer={viewer}
          />

          {isAdmin ? (
            <AdminPanel
              event={event}
              onAddWalkIn={addWalkIn}
              onSetLeftAt={setLeftAt}
              onUpdateAttendance={updateAttendance}
              onUpdateCost={updateCost}
              settlement={settlement}
            />
          ) : (
            <LockedPanel />
          )}
        </div>

        {isAdmin ? (
          <SettlementPanel
            copied={copied}
            event={event}
            lineSummary={lineSummary}
            onCopySummary={copySummary}
            onUpdateAttendance={updateAttendance}
            settlement={settlement}
          />
        ) : (
          <MemberStatusPanel attendance={currentAttendance} signup={currentSignup} />
        )}

        <AuditPanel actions={event.actions} />
      </section>
    </main>
  );
}

function MemberPanel({ attendance, onLeftNow, onSignup, signup, viewer }) {
  return (
    <section className="badminton-card">
      <div className="badminton-card-title">
        <UserCheck size={20} />
        <div>
          <h2>สมาชิก</h2>
          <p>{viewer?.name || "ยังไม่พบผู้ใช้"}</p>
        </div>
      </div>
      <div className="badminton-segments">
        {["coming", "maybe", "not_coming"].map((status) => (
          <button
            className={signup?.status === status ? "is-active" : ""}
            key={status}
            onClick={() => onSignup(status)}
            type="button"
          >
            {STATUS_LABELS[status]}
          </button>
        ))}
      </div>
      <button className="badminton-primary" onClick={onLeftNow} type="button">
        <LogOut size={18} /> กลับแล้ว
      </button>
      <p className="badminton-note">
        ปุ่มนี้แทน LINE postback: สมาชิกแก้ได้เฉพาะสถานะและเวลาออกของตัวเอง
        {attendance?.leftAt ? ` ล่าสุดกลับ ${attendance.leftAt}` : ""}
      </p>
    </section>
  );
}

function AdminPanel({ event, onAddWalkIn, onSetLeftAt, onUpdateAttendance, onUpdateCost, settlement }) {
  const leftTimeOptions = useMemo(() => buildTimeOptions(event.startTime, event.endTime), [event.startTime, event.endTime]);

  return (
    <section className="badminton-card badminton-admin">
      <div className="badminton-card-title">
        <ShieldCheck size={20} />
        <div>
          <h2>แอดมินคุมรอบ</h2>
          <p>แก้คนมา เล่นกี่ชั่วโมง เปอร์เซ็นต์ และค่าใช้จ่าย</p>
        </div>
      </div>

      <div className="badminton-costs">
        {event.costs.map((cost) => (
          <label key={cost.id}>
            <span>{cost.label}</span>
            <input
              inputMode="decimal"
              type="number"
              value={cost.amount}
              onInput={(event) => onUpdateCost(cost.id, { amount: Number(event.currentTarget.value) })}
            />
          </label>
        ))}
      </div>

      <div className="badminton-admin-head">
        <strong>เช็กชื่อจริง</strong>
        <button onClick={onAddWalkIn} type="button">
          <Plus size={16} /> เพิ่มคน
        </button>
      </div>

      <div className="badminton-attendance-list">
        {event.members.map((member) => {
          const row = event.attendance.find((item) => item.memberId === member.id);
          const signup = event.signups.find((item) => item.memberId === member.id);
          return (
            <article className="badminton-attendance-row" key={member.id}>
              <div>
                <strong>{member.name}</strong>
                <span>{STATUS_LABELS[signup?.status] || "ยังไม่ลงชื่อ"}</span>
              </div>
              <label className="badminton-switch">
                <input
                  checked={Boolean(row?.arrived)}
                  type="checkbox"
                  onChange={(event) => onUpdateAttendance(member.id, { arrived: event.target.checked })}
                />
                มา
              </label>
              <select
                value={row?.weight ?? 1}
                onChange={(event) => onUpdateAttendance(member.id, { weight: Number(event.target.value) })}
              >
                {WEIGHT_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>{preset.label}</option>
                ))}
              </select>
              <select
                aria-label={`เวลาออก ${member.name}`}
                value={row?.leftAt || ""}
                onChange={(event) => onSetLeftAt(member.id, event.target.value)}
              >
                <option value="">ยังไม่กลับ</option>
                {leftTimeOptions.map((time) => (
                  <option key={time} value={time}>{time}</option>
                ))}
              </select>
            </article>
          );
        })}
      </div>

      <div className="badminton-total">
        <span>รวมค่าใช้จ่าย</span>
        <strong>{baht(settlement.totalCost)} บาท</strong>
      </div>
    </section>
  );
}

function SettlementPanel({ copied, lineSummary, onCopySummary, onUpdateAttendance, settlement }) {
  return (
    <section className="badminton-card">
      <div className="badminton-card-title">
        <ReceiptText size={20} />
        <div>
          <h2>ยอดที่ต้องจ่าย</h2>
          <p>{baht(settlement.totalCost)} บาท / {settlement.totalUnits.toFixed(2)} หน่วย</p>
        </div>
      </div>

      <div className="badminton-pay-list">
        {settlement.rows.map((row) => (
          <article className="badminton-pay-row" key={row.memberId}>
            <div>
              <strong>{row.name}</strong>
              <span>{Math.round(Number(row.weight || 0) * 100)}%</span>
            </div>
            <strong>{baht(row.roundedDue)} บาท</strong>
            <button
              className={row.paid ? "is-paid" : ""}
              onClick={() => onUpdateAttendance(row.memberId, { paid: !row.paid })}
              type="button"
            >
              <Check size={16} /> {row.paid ? "จ่ายแล้ว" : "รับเงิน"}
            </button>
          </article>
        ))}
      </div>

      <textarea readOnly value={lineSummary} />
      <button className="badminton-primary" onClick={onCopySummary} type="button">
        <Copy size={18} /> {copied ? "คัดลอกแล้ว" : "คัดลอกสรุปส่ง LINE"}
      </button>
    </section>
  );
}

function LockedPanel() {
  return (
    <section className="badminton-card badminton-locked">
      <Lock size={30} />
      <h2>ส่วนแอดมินถูกล็อก</h2>
      <p>สมาชิกทั่วไปไม่เห็นปุ่มคิดเงิน ปรับเปอร์เซ็นต์ เพิ่มลดคน หรือยอดรวมระหว่างจัดรอบ</p>
    </section>
  );
}

function MemberStatusPanel({ attendance, signup }) {
  return (
    <section className="badminton-card">
      <div className="badminton-card-title">
        <Clock size={20} />
        <div>
          <h2>สถานะของฉัน</h2>
          <p>ข้อมูลที่สมาชิกทั่วไปเห็น</p>
        </div>
      </div>
      <div className="badminton-member-status">
        <span>ลงชื่อ</span>
        <strong>{STATUS_LABELS[signup?.status] || "ยังไม่ลงชื่อ"}</strong>
        <span>กลับแล้ว</span>
        <strong>{attendance?.leftAt || "-"}</strong>
      </div>
    </section>
  );
}

function AuditPanel({ actions }) {
  return (
    <section className="badminton-card badminton-audit">
      <div className="badminton-card-title">
        <BadgeCheck size={20} />
        <div>
          <h2>Audit log</h2>
          <p>บันทึกว่าใครกดหรือแก้อะไร</p>
        </div>
      </div>
      {actions.length ? (
        <div className="badminton-audit-list">
          {actions.map((action) => (
            <p key={action.id}>
              <strong>{action.actorName}</strong> {action.action} <span>{action.at}</span>
            </p>
          ))}
        </div>
      ) : (
        <p className="badminton-note">ยังไม่มีรายการ</p>
      )}
    </section>
  );
}

function upsertByMember(rows, memberId, nextRow) {
  const exists = rows.some((row) => row.memberId === memberId);
  return exists
    ? rows.map((row) => (row.memberId === memberId ? { ...row, ...nextRow } : row))
    : [...rows, nextRow];
}

function upsertAttendance(rows, nextRow) {
  return upsertByMember(rows, nextRow.memberId, nextRow);
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
    const hour = Math.floor(normalized / 60);
    const minute = normalized % 60;
    options.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    cursor += 30;
  }

  return options;
}
