import React from "react";
import { filterParticipants } from "./participantFilters.js";
export { filterParticipants } from "./participantFilters.js";

export default function ParticipantFilters({ rows, query, onQuery, filter, onFilter }) {
  return <div className="participant-filters">
    <label>ค้นหาผู้เล่นในรอบนี้<input type="search" placeholder="ชื่อเล่นหรือชื่อ LINE" value={query} onChange={(event) => onQuery(event.target.value)} /></label>
    <div role="group" aria-label="กรองสถานะผู้เล่น">
      {[["not-arrived", "ยังไม่มา"], ["present", "คนที่อยู่ในสนาม"], ["all", "ทั้งหมด"]].map(([key, label]) =>
        <button type="button" key={key} aria-pressed={filter === key} onClick={() => onFilter(key)}>{label} ({filterParticipants(rows, "", key).length})</button>)}
    </div>
  </div>;
}
