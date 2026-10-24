// Queue rows may briefly lag attendance on an older client. Never turn a
// departed/withdrawn/unchecked participant back into a waiting candidate.
// Playing rows and match snapshots are retained so the current game is visible.
export function queueAttendanceStatus(queuePlayer, signup, attendance) {
  const status = queuePlayer.status;
  if (!["waiting", "reserved", "proposed"].includes(status)) return status;
  const present = signup?.status === "coming" && !signup.removed_at
    && attendance?.arrived === true && !attendance.left_at && !attendance.removed_at;
  return present ? status : "left";
}
