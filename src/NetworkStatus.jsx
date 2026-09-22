import React, { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export default function NetworkStatus({ lastSyncedAt, online }) {
  if (online) return lastSyncedAt ? <div className="badminton-sync-status">ซิงก์ล่าสุด {new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(lastSyncedAt)}</div> : null;
  return <div className="badminton-offline-banner" role="alert"><WifiOff size={17} /><span><strong>ออฟไลน์</strong> ข้อมูลที่กรอกยังอยู่ แต่ระบบจะไม่บันทึกจนกว่าจะเชื่อมต่ออินเทอร์เน็ต</span></div>;
}
