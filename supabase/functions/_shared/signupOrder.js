export function compareSignupOrder(left, right) {
  const createdAtComparison = String(left?.created_at || "")
    .localeCompare(String(right?.created_at || ""));
  if (createdAtComparison !== 0) return createdAtComparison;

  return String(left?.id || left?.member_id || "")
    .localeCompare(String(right?.id || right?.member_id || ""));
}

export function sortBySignupOrder(rows = []) {
  return [...rows].sort(compareSignupOrder);
}
