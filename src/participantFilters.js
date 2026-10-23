import { normalizeMemberSearch } from "./memberSearch.js";

export function filterParticipants(rows, query, filter = "all") {
  const search = normalizeMemberSearch(query);
  return rows.filter(({ member, attendance }) => {
    const arrived = Boolean(attendance?.checkedIn ?? attendance?.arrived);
    const left = Boolean(attendance?.leftAt || attendance?.left_at);
    if (filter === "not-arrived" && arrived) return false;
    if (filter === "present" && (!arrived || left)) return false;
    return !search || [member.nickname, member.display_name, ...(member.aliases || [])]
      .some((name) => normalizeMemberSearch(name).includes(search));
  });
}
