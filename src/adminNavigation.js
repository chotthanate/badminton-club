export const ADMIN_NAVIGATION = [
  { id: "round", label: "รอบ" },
  { id: "players", label: "ผู้เล่น" },
  { id: "queue", label: "คิว" },
  { id: "costs", label: "ค่าใช้จ่าย" },
  { id: "payments", label: "ชำระเงิน" },
  { id: "settings", label: "ตั้งค่า" },
];

export function adminNavigationTabs(isStaff, hasEvent) {
  return ADMIN_NAVIGATION
    .filter(({ id }) => !isStaff || ["round", "players", "queue", "settings"].includes(id))
    .map((tab) => ({ ...tab, disabled: !hasEvent && !["round", "settings"].includes(tab.id) }));
}
