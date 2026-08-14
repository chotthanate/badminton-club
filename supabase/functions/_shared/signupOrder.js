export function compareSignupOrder(left, right) {
  const leftExplicitOrder = Number(left?.signupOrder);
  const rightExplicitOrder = Number(right?.signupOrder);
  if (Number.isFinite(leftExplicitOrder) && Number.isFinite(rightExplicitOrder)) {
    return leftExplicitOrder - rightExplicitOrder;
  }

  const leftCreatedAt = Date.parse(left?.created_at || left?.createdAt || "");
  const rightCreatedAt = Date.parse(right?.created_at || right?.createdAt || "");
  if (Number.isFinite(leftCreatedAt) && Number.isFinite(rightCreatedAt) && leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt;
  }

  return String(left?.id || left?.member_id || "")
    .localeCompare(String(right?.id || right?.member_id || ""));
}

export function sortBySignupOrder(rows = []) {
  return [...rows].sort(compareSignupOrder);
}
