import React from "react";
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  FlaskConical,
  History,
  ListOrdered,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Trophy,
  UserPlus,
  Users,
  WalletCards,
} from "lucide-react";

export default function AdminSettingsPanel({
  clubName,
  isStaff,
  isTestMode,
  busy,
  refreshing,
  eventStatus,
  hasEvent,
  onRefresh,
  onHistory,
  onPassword,
  onStaffAccess,
  onToggleTestMode,
  onSignOut,
  onTournamentNavigate,
  onAddTestPlayers,
  onCopyTestLink,
  onResetTest,
}) {
  return (
    <section aria-label="ตั้งค่าระบบ" className="badminton-admin-settings">
      <header className="badminton-settings-intro">
        <div><h2>ตั้งค่า</h2><p>{clubName} · {isStaff ? "สตาฟ" : "แอดมิน"}</p></div>
      </header>

      <SettingsGroup title="ทั่วไป">
        <SettingsRow
          busy={refreshing}
          description="โหลดข้อมูลล่าสุด โดยไม่ล้างร่างที่กำลังแก้"
          disabled={busy || refreshing}
          icon={RefreshCw}
          label={refreshing ? "กำลังโหลดข้อมูล…" : "โหลดข้อมูลล่าสุด"}
          onClick={onRefresh}
        />
        {!isStaff && hasEvent ? <SettingsRow
          description="ดูรายการบันทึกและการแก้ไขของรอบนี้"
          disabled={busy}
          icon={History}
          label="ประวัติการทำรายการ"
          onClick={onHistory}
        /> : null}
        <SettingsRow
          description="เปิดระบบจัดทีมและการแข่งขัน"
          disabled={busy}
          href={`${import.meta.env.BASE_URL}?app=tournament`}
          icon={Trophy}
          label="จัดการแข่งขัน"
          onClick={onTournamentNavigate}
        />
      </SettingsGroup>

      {!isStaff ? <SettingsGroup title="บัญชีและสิทธิ์">
        <SettingsRow
          description="เปลี่ยนรหัสสำหรับเข้าใช้งานหลังบ้าน"
          disabled={busy}
          icon={ShieldCheck}
          label="เปลี่ยนรหัสเข้าเว็บ"
          onClick={onPassword}
        />
        {!isTestMode ? <SettingsRow
          description="ตั้งรหัสหรือปิดสิทธิ์เข้าใช้งานของสตาฟ"
          disabled={busy}
          icon={Users}
          label="ตั้งค่ารหัสสตาฟ"
          onClick={onStaffAccess}
        /> : null}
      </SettingsGroup> : null}

      {!isStaff ? <SettingsGroup className={isTestMode ? "is-test-group" : ""} title="โหมดทดลอง">
        <SettingsRow
          className={isTestMode ? "is-test-mode" : ""}
          description={isTestMode ? "ออกจากข้อมูลทดลอง กลับไปจัดการรอบจริง" : "ลองจัดคิวได้ทันที ข้อมูลแยกจากรอบจริงและไม่ส่งเข้า LINE"}
          disabled={busy}
          icon={isTestMode ? ArrowLeft : FlaskConical}
          label={isTestMode ? "กลับข้อมูลจริง" : "เข้าโหมดทดลอง"}
          onClick={onToggleTestMode}
        />
        {isTestMode ? <>
          <SettingsRow
            description="เตรียมรอบและเช็กชื่อให้พร้อมทดลองเข้าคิว"
            disabled={busy}
            icon={UserPlus}
            label="เพิ่มผู้เล่นสุ่ม 23–40 คน"
            onClick={onAddTestPlayers}
          />
          <SettingsRow
            description={eventStatus === "open" ? "คัดลอกลิงก์สำหรับลองลงชื่อรอบนี้" : "เปิดรอบทดลองก่อนคัดลอกลิงก์ลงชื่อ"}
            disabled={busy || eventStatus !== "open"}
            icon={Copy}
            label="ลิงก์ลงชื่อทดลอง"
            onClick={() => onCopyTestLink("signup")}
          />
          <SettingsRow
            description="คัดลอกลิงก์สำหรับลองหน้าชำระเงิน"
            disabled={busy}
            icon={WalletCards}
            label="ลิงก์ชำระเงินทดลอง"
            onClick={() => onCopyTestLink("payment")}
          />
          <SettingsRow
            description={hasEvent ? "คัดลอกลิงก์สนามและคิวทดลองล่าสุด" : "เตรียมรอบทดลองก่อนคัดลอกลิงก์คิว"}
            disabled={busy || !hasEvent}
            icon={ListOrdered}
            label="ลิงก์สนามและคิวทดลอง"
            onClick={() => onCopyTestLink("live")}
          />
          <SettingsRow
            className="is-danger"
            description="ล้างรอบ ผู้เล่น และค่าใช้จ่ายทดลองทั้งหมด ไม่แตะข้อมูลจริง"
            disabled={busy}
            icon={Trash2}
            label="รีเซ็ตข้อมูลทดลอง"
            onClick={onResetTest}
          />
        </> : null}
      </SettingsGroup> : null}

      <SettingsGroup className="is-danger-group" title="ออกจากบัญชี">
        <SettingsRow
          className="is-danger"
          description="ออกจากระบบบนอุปกรณ์นี้"
          disabled={busy}
          icon={LogOut}
          label="ออกจากระบบ"
          onClick={onSignOut}
        />
      </SettingsGroup>
    </section>
  );
}

function SettingsGroup({ title, className = "", children }) {
  return (
    <section aria-label={title} className={`badminton-settings-group ${className}`}>
      <h3 className="badminton-settings-group-title">{title}</h3>
      <div className="badminton-settings-rows">{children}</div>
    </section>
  );
}

function SettingsRow({ label, description, icon: Icon, onClick, href, disabled, busy, className = "" }) {
  const content = <>
    <span aria-hidden="true" className="badminton-settings-row-icon"><Icon className={busy ? "is-spinning" : undefined} size={20} /></span>
    <span className="badminton-settings-row-copy">
      <strong className="badminton-settings-row-label">{label}</strong>
      <small className="badminton-settings-row-description">{description}</small>
    </span>
    <ChevronRight aria-hidden="true" className="badminton-settings-row-trailing" size={18} />
  </>;
  const rowClassName = `badminton-settings-row ${className}`;
  if (href) return <a aria-disabled={disabled || undefined} className={rowClassName} href={href} onClick={disabled ? (event) => event.preventDefault() : onClick} tabIndex={disabled ? -1 : undefined}>{content}</a>;
  return <button aria-busy={busy || undefined} className={rowClassName} disabled={disabled} onClick={onClick} type="button">{content}</button>;
}
