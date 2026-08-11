export function selectStaffWorkspace(contexts = [], dashboardsByClubId = {}, requestedClubId = null) {
  const staffContexts = contexts.filter((context) => context.role === "staff");
  if (!staffContexts.length) return null;

  if (requestedClubId) {
    const requested = staffContexts.find((context) => context.club_id === requestedClubId);
    if (requested) {
      return {
        context: requested,
        dashboard: dashboardsByClubId[requested.club_id] || { event: null },
      };
    }
  }

  const ordered = [...staffContexts].sort((left, right) => {
    const testDifference = Number(Boolean(left.clubs?.is_test)) - Number(Boolean(right.clubs?.is_test));
    if (testDifference) return testDifference;
    return String(left.clubs?.name || "").localeCompare(String(right.clubs?.name || ""), "th");
  });
  const context = ordered.find((entry) => dashboardsByClubId[entry.club_id]?.event) || ordered[0];
  return {
    context,
    dashboard: dashboardsByClubId[context.club_id] || { event: null },
  };
}
