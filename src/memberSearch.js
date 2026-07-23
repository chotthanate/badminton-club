export function normalizeMemberSearch(value) {
  return String(value || "").toLocaleLowerCase("th").replace(/[\s._\-®©™]+/g, "");
}

export function rankMemberSuggestions(members, query) {
  const normalizedQuery = normalizeMemberSearch(query);
  return members
    .map((member) => {
      const fields = [member.nickname, member.display_name]
        .map(normalizeMemberSearch)
        .filter(Boolean);
      const score = normalizedQuery
        ? Math.min(...fields.map((field) => memberSearchScore(field, normalizedQuery)))
        : 0;
      return { member, score };
    })
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score || memberLabel(a.member).localeCompare(memberLabel(b.member), "th"))
    .map((entry) => entry.member);
}

function memberSearchScore(value, query) {
  if (value === query) return 0;
  if (value.startsWith(query)) return 1;
  if (value.includes(query) || query.includes(value)) return 2;
  const distance = editDistance(value, query);
  const allowedDistance = Math.max(query.length >= 4 ? 2 : 1, Math.floor(Math.max(value.length, query.length) * 0.34));
  return distance <= allowedDistance ? 3 + distance : Number.POSITIVE_INFINITY;
}

function editDistance(leftValue, rightValue) {
  const left = [...leftValue];
  const right = [...rightValue];
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const previous = row[rightIndex];
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = previous;
    }
  }
  return row[right.length];
}

function memberLabel(member) {
  return member?.nickname?.trim() || member?.display_name?.trim() || "";
}
