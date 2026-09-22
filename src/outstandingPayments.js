function normalizedName(group) {
  return String(group?.member?.nickname || group?.member?.display_name || "").trim();
}

export function outstandingAgeInDays(group, now = new Date()) {
  const timestamps = (group?.rows || [])
    .map((row) => row.admin_confirmed_at || row.billed_at || row.event?.event_date)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  if (!timestamps.length) return 0;
  return Math.max(0, Math.floor((now.getTime() - Math.min(...timestamps)) / 86400000));
}

export function filterAndSortOutstanding(groups, { query = "", source = "all", sort = "amount" } = {}) {
  const needle = query.trim().toLocaleLowerCase("th");
  const filtered = groups.filter((group) => {
    const member = group.member || {};
    const matchesQuery = !needle || [member.nickname, member.display_name]
      .some((value) => String(value || "").toLocaleLowerCase("th").includes(needle));
    const hasLine = Boolean(String(member.line_user_id || "").trim());
    const matchesSource = source === "all" || (source === "line" ? hasLine : !hasLine);
    return matchesQuery && matchesSource;
  });
  return [...filtered].sort((left, right) => {
    if (sort === "rounds") return right.rows.length - left.rows.length || right.total - left.total;
    if (sort === "oldest") return outstandingAgeInDays(right) - outstandingAgeInDays(left) || right.total - left.total;
    if (sort === "name") return normalizedName(left).localeCompare(normalizedName(right), "th");
    return right.total - left.total || normalizedName(left).localeCompare(normalizedName(right), "th");
  });
}

export function buildOutstandingLineMessage(groups, total) {
  const rows = groups
    .filter((group) => Number(group.total || 0) > 0)
    .map((group, index) => `${index + 1}. ${normalizedName(group) || "ไม่ระบุชื่อ"} — ${Number(group.total || 0).toLocaleString("th-TH")} บาท (${group.rows.length} รอบ)`);
  if (!rows.length) return "ยอดค้างชำระ\nไม่มีรายการค้างชำระ";
  return [
    "สรุปยอดค้างชำระทั้งหมด",
    ...rows,
    "",
    `รวม ${rows.length} คน · ${groups.reduce((sum, group) => sum + group.rows.length, 0)} รอบ · ${Number(total || 0).toLocaleString("th-TH")} บาท`,
  ].join("\n");
}
