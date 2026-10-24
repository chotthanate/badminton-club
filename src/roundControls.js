export function roundDetailsPatch(event, form) {
  if (!["draft", "open"].includes(event.status)) throw new Error("รอบนี้ปิดแล้ว กรุณาโหลดข้อมูลล่าสุด");
  const venue = String(form.venue || "").trim();
  if (!venue) throw new Error("กรุณากรอกสถานที่");
  if (venue.length > 120) throw new Error("ชื่อสถานที่ต้องไม่เกิน 120 ตัวอักษร");
  // An open round can change its venue, never its date or financial settings.
  return event.status === "open" ? { venue } : { event_date: form.event_date, venue };
}

export function modifiedCourtUpdates(courts, drafts) {
  return courts.flatMap((court) => {
    const draft = drafts[court.id];
    if (!draft) return [];
    const patch = { id: court.id, court_name: String(draft.court_name || "").trim(), starts_at: String(draft.starts_at || "").slice(0, 5), ends_at: String(draft.ends_at || "").slice(0, 5) };
    return patch.court_name === court.court_name && patch.starts_at === String(court.starts_at).slice(0, 5) && patch.ends_at === String(court.ends_at).slice(0, 5) ? [] : [patch];
  });
}
