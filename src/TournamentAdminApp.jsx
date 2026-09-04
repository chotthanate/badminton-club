import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ClipboardCopy,
  Clock3,
  History,
  LogOut,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  Swords,
  Trash2,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { supabase } from "./supabase.js";
import { getAdminContexts } from "./clubRepository.js";
import {
  rankQualificationTeams,
  TOURNAMENT_SKILL_LEVELS,
} from "./tournamentLogic.js";
import {
  addTournamentCourt,
  addTournamentDivision,
  addTournamentTeam,
  buildTournamentPublicUrl,
  confirmTournamentSplit,
  createTournament,
  deleteTournament,
  deleteTournamentCourt,
  deleteTournamentTeam,
  generateTournamentQualification,
  listTournaments,
  loadTournament,
  loadTournamentMemberOptions,
  saveTournamentResult,
  shiftTournamentCourtMatches,
  updateTournament,
  updateTournamentMatch,
} from "./tournamentRepository.js";

const TABS = [
  ["overview", "ภาพรวม", Settings],
  ["teams", "ทีม", Users],
  ["matches", "ตาราง/คะแนน", Swords],
  ["brackets", "สายแข่งขัน", Trophy],
  ["history", "ประวัติ", History],
];

function nowLocalInput(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    /* Safari fallback. */
  }
  const area = document.createElement("textarea");
  area.value = value;
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

export default function TournamentAdminApp({ session }) {
  const [contexts, setContexts] = useState([]);
  const [context, setContext] = useState(null);
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [data, setData] = useState(null);
  const [members, setMembers] = useState([]);
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  async function refresh({ tournamentId = selectedId, club = context } = {}) {
    setLoading(true);
    setError("");
    try {
      let nextContexts = contexts;
      let nextContext = club;
      if (!nextContext) {
        nextContexts = await getAdminContexts(session.user.id);
        nextContext =
          nextContexts.find((entry) => !entry.clubs.is_test) ||
          nextContexts[0] ||
          null;
        setContexts(nextContexts);
        setContext(nextContext);
      }
      if (!nextContext) throw new Error("ไม่พบสโมสรที่มีสิทธิ์จัดการแข่งขัน");
      const result = await listTournaments(nextContext.club_id);
      setItems(result.tournaments || []);
      const targetId = result.tournaments?.some(
        (item) => item.id === tournamentId,
      )
        ? tournamentId
        : result.tournaments?.[0]?.id || "";
      setSelectedId(targetId);
      if (targetId) {
        const [detail, options] = await Promise.all([
          loadTournament(nextContext.club_id, targetId),
          loadTournamentMemberOptions(nextContext.club_id),
        ]);
        setData(detail);
        setMembers(options.members || []);
      } else setData(null);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [session.user.id]);

  async function mutate(action, success, options = {}) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      setNotice(success);
      await refresh({ tournamentId: options.tournamentId || selectedId });
      return result;
    } catch (nextError) {
      setError(nextError.message);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function switchClub(clubId) {
    const next = contexts.find((entry) => entry.club_id === clubId);
    setContext(next);
    setSelectedId("");
    setData(null);
    await refresh({ club: next, tournamentId: "" });
  }

  if (loading && !context)
    return (
      <main className="badminton-app tournament-admin-page">
        <div className="tournament-loading">กำลังโหลดระบบการแข่งขัน...</div>
      </main>
    );

  return (
    <main className="badminton-app tournament-admin-page">
      <section className="badminton-shell">
        <header className="badminton-header tournament-admin-header">
          <div>
            <p className="badminton-kicker">หลังบ้านการแข่งขัน</p>
            <h1>จัดการแข่งขัน</h1>
            <p>{context?.clubs.name}</p>
          </div>
          <div className="badminton-header-actions">
            <a className="badminton-secondary" href={import.meta.env.BASE_URL}>
              <ArrowLeft size={17} /> จัดการรอบแบด
            </a>
            <button
              className="badminton-icon-button"
              onClick={() => refresh()}
              title="โหลดล่าสุด"
              type="button"
            >
              <RefreshCw size={18} />
            </button>
            <button
              aria-label="ออกจากระบบ"
              className="badminton-secondary"
              onClick={() => supabase.auth.signOut()}
              type="button"
            >
              <LogOut size={17} /> <span>ออกจากระบบ</span>
            </button>
          </div>
        </header>
        {contexts.length > 1 ? (
          <select
            className="tournament-club-switch"
            onChange={(event) => switchClub(event.target.value)}
            value={context?.club_id || ""}
          >
            {contexts.map((entry) => (
              <option key={entry.club_id} value={entry.club_id}>
                {entry.clubs.name}
                {entry.clubs.is_test ? " · ทดลอง" : ""}
              </option>
            ))}
          </select>
        ) : null}
        {notice ? (
          <div className="badminton-alert is-success">
            <span>{notice}</span>
            <button onClick={() => setNotice("")} type="button">
              <X size={17} />
            </button>
          </div>
        ) : null}
        {error ? (
          <div className="badminton-alert is-error">
            <span>{error}</span>
            <button onClick={() => setError("")} type="button">
              <X size={17} />
            </button>
          </div>
        ) : null}
        <section className="tournament-listbar">
          <label>
            รายการแข่งขัน
            <select
              onChange={(event) => {
                setSelectedId(event.target.value);
                refresh({ tournamentId: event.target.value });
              }}
              value={selectedId}
            >
              <option value="">ยังไม่มีรายการ</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.event_date}
                </option>
              ))}
            </select>
          </label>
          {data?.owner ? (
            <button
              className="badminton-primary"
              onClick={() => setShowCreate(true)}
              type="button"
            >
              <Plus size={17} /> สร้างการแข่งขัน
            </button>
          ) : null}
        </section>
        {!data ? (
          <section className="badminton-card badminton-empty">
            <Trophy size={38} />
            <h2>ยังไม่มีการแข่งขัน</h2>
            <p>สร้างรายการแรก แล้วเพิ่มระดับ สนาม และทีมที่สมัครมา</p>
            {context?.role === "admin" ? (
              <button
                className="badminton-primary"
                onClick={() => setShowCreate(true)}
                type="button"
              >
                <Plus size={17} /> สร้างการแข่งขัน
              </button>
            ) : null}
          </section>
        ) : (
          <>
            <TournamentHero data={data} mutate={mutate} />
            <nav
              className="badminton-tabs tournament-tabs"
              aria-label="เมนูการแข่งขัน"
            >
              {TABS.filter(([id]) => id !== "history" || data.owner).map(
                ([id, label, Icon]) => (
                  <button
                    className={tab === id ? "is-active" : ""}
                    key={id}
                    onClick={() => setTab(id)}
                    type="button"
                  >
                    <Icon size={18} />
                    <span>{label}</span>
                  </button>
                ),
              )}
            </nav>
            {tab === "overview" ? (
              <TournamentOverview data={data} mutate={mutate} />
            ) : null}
            {tab === "teams" ? (
              <TournamentTeams data={data} members={members} mutate={mutate} />
            ) : null}
            {tab === "matches" ? (
              <TournamentMatches data={data} mutate={mutate} />
            ) : null}
            {tab === "brackets" ? (
              <TournamentBrackets data={data} mutate={mutate} />
            ) : null}
            {tab === "history" ? (
              <TournamentHistory audits={data.audits || []} />
            ) : null}
          </>
        )}
        {showCreate ? (
          <CreateTournamentModal
            clubId={context.club_id}
            onClose={() => setShowCreate(false)}
            onCreated={async (details) => {
              const result = await mutate(
                () => createTournament(context.club_id, details),
                "สร้างการแข่งขันแล้ว",
                { tournamentId: "" },
              );
              if (result?.tournament) {
                setSelectedId(result.tournament.id);
                setShowCreate(false);
                await refresh({ tournamentId: result.tournament.id });
              }
            }}
            saving={saving}
          />
        ) : null}
        {saving ? <div className="badminton-saving">กำลังบันทึก...</div> : null}
      </section>
    </main>
  );
}

function TournamentHero({ data, mutate }) {
  const { tournament } = data;
  return (
    <section className="badminton-card tournament-hero">
      <div>
        <p className="badminton-kicker">{tournament.status}</p>
        <h2>{tournament.name}</h2>
        <p>
          <CalendarDays size={16} /> {tournament.event_date}{" "}
          <MapPin size={16} /> {tournament.venue}
        </p>
      </div>
      <div className="tournament-hero-actions">
        <button
          className="badminton-secondary"
          onClick={async () => {
            await copyText(buildTournamentPublicUrl(tournament.public_id));
            window.alert("คัดลอกลิงก์ผู้ชมแล้ว");
          }}
          type="button"
        >
          <ClipboardCopy size={17} /> ลิงก์ผู้ชม
        </button>
        {data.owner ? (
          <button
            className="badminton-secondary is-danger"
            onClick={() => {
              if (window.confirm("ลบรายการร่างนี้ใช่ไหม?"))
                mutate(
                  () => deleteTournament(tournament.club_id, tournament.id),
                  "ลบรายการแล้ว",
                  { tournamentId: "" },
                );
            }}
            type="button"
          >
            <Trash2 size={17} />
          </button>
        ) : null}
      </div>
    </section>
  );
}

function CreateTournamentModal({ clubId, onClose, onCreated, saving }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    name: "Headshot Badminton Tournament",
    eventDate: today,
    venue: "คอร์ทแบดเขาน้อย",
    startsAt: `${today}T09:00`,
    qualifierMinutes: 30,
    knockoutMinutes: 45,
    minimumRestMinutes: 15,
    skillLevels: ["Rookie", "BG", "N", "S", "P"],
    courts: ["คอร์ท 1", "คอร์ท 2"],
  });
  return (
    <div className="badminton-modal-backdrop">
      <form
        className="badminton-custom-charge-modal tournament-create-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onCreated({
            ...form,
            startsAt: new Date(form.startsAt).toISOString(),
          });
        }}
      >
        <div className="badminton-modal-title">
          <div>
            <p className="badminton-kicker">รายการใหม่</p>
            <h2>สร้างการแข่งขัน</h2>
          </div>
          <button onClick={onClose} type="button">
            <X />
          </button>
        </div>
        <label>
          ชื่องาน
          <input
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </label>
        <div className="tournament-form-grid">
          <label>
            วันที่
            <input
              required
              type="date"
              value={form.eventDate}
              onChange={(event) =>
                setForm({
                  ...form,
                  eventDate: event.target.value,
                  startsAt: `${event.target.value}T09:00`,
                })
              }
            />
          </label>
          <label>
            เวลาเริ่ม
            <input
              required
              type="datetime-local"
              value={form.startsAt}
              onChange={(event) =>
                setForm({ ...form, startsAt: event.target.value })
              }
            />
          </label>
        </div>
        <label>
          สถานที่
          <input
            required
            value={form.venue}
            onChange={(event) =>
              setForm({ ...form, venue: event.target.value })
            }
          />
        </label>
        <fieldset>
          <legend>ระดับที่เปิดแข่ง</legend>
          <div className="tournament-check-grid">
            {TOURNAMENT_SKILL_LEVELS.map((level) => (
              <label key={level}>
                <input
                  checked={form.skillLevels.includes(level)}
                  onChange={() =>
                    setForm({
                      ...form,
                      skillLevels: form.skillLevels.includes(level)
                        ? form.skillLevels.filter((item) => item !== level)
                        : [...form.skillLevels, level],
                    })
                  }
                  type="checkbox"
                />{" "}
                {level}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="tournament-form-grid">
          <label>
            คัดเลือก/คู่ (นาที)
            <input
              min="10"
              type="number"
              value={form.qualifierMinutes}
              onChange={(event) =>
                setForm({ ...form, qualifierMinutes: event.target.value })
              }
            />
          </label>
          <label>
            น็อกเอาต์/คู่ (นาที)
            <input
              min="10"
              type="number"
              value={form.knockoutMinutes}
              onChange={(event) =>
                setForm({ ...form, knockoutMinutes: event.target.value })
              }
            />
          </label>
          <label>
            พักขั้นต่ำ (นาที)
            <input
              min="0"
              type="number"
              value={form.minimumRestMinutes}
              onChange={(event) =>
                setForm({ ...form, minimumRestMinutes: event.target.value })
              }
            />
          </label>
        </div>
        <label>
          สนาม (คั่นด้วยจุลภาค)
          <input
            value={form.courts.join(", ")}
            onChange={(event) =>
              setForm({
                ...form,
                courts: event.target.value
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
        <button
          className="badminton-primary"
          disabled={saving || !form.skillLevels.length}
          type="submit"
        >
          <Save size={17} /> สร้างการแข่งขัน
        </button>
      </form>
    </div>
  );
}

function TournamentOverview({ data, mutate }) {
  const [courtName, setCourtName] = useState("");
  const missingLevels = TOURNAMENT_SKILL_LEVELS.filter(
    (level) =>
      !data.divisions.some((division) => division.skill_level === level),
  );
  return (
    <section className="tournament-admin-grid">
      {data.owner ? <TournamentSettings data={data} mutate={mutate} /> : null}
      <article className="badminton-card">
        <h2>ระดับการแข่งขัน</h2>
        <div className="tournament-chip-list">
          {data.divisions.map((division) => (
            <span key={division.id}>
              {division.skill_level}
              <small>{division.status}</small>
            </span>
          ))}
        </div>
        {data.owner && missingLevels.length ? (
          <div className="tournament-inline-form">
            <select id="new-division">
              <option value="">เพิ่มระดับ...</option>
              {missingLevels.map((level) => (
                <option key={level}>{level}</option>
              ))}
            </select>
            <button
              onClick={() => {
                const select = document.getElementById("new-division");
                if (select.value)
                  mutate(
                    () =>
                      addTournamentDivision(
                        data.tournament.club_id,
                        data.tournament.id,
                        select.value,
                      ),
                    "เพิ่มระดับแล้ว",
                  );
              }}
              type="button"
            >
              <Plus />
            </button>
          </div>
        ) : null}
      </article>
      <article className="badminton-card">
        <h2>สนาม</h2>
        <div className="tournament-court-list">
          {data.courts.map((court) => (
            <span key={court.id}>
              {court.name}
              {data.owner ? <button
                onClick={() =>
                  mutate(
                    () =>
                      deleteTournamentCourt(
                        data.tournament.club_id,
                        data.tournament.id,
                        court.id,
                      ),
                    "ลบสนามแล้ว",
                  )
                }
                type="button"
              >
                <Trash2 size={15} />
              </button> : null}
            </span>
          ))}
        </div>
        {data.owner ? <form
          className="tournament-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            mutate(
              () =>
                addTournamentCourt(
                  data.tournament.club_id,
                  data.tournament.id,
                  courtName,
                ),
              "เพิ่มสนามแล้ว",
            );
            setCourtName("");
          }}
        >
          <input
            placeholder="ชื่อสนาม"
            required
            value={courtName}
            onChange={(event) => setCourtName(event.target.value)}
          />
          <button type="submit">
            <Plus />
          </button>
        </form> : null}
      </article>
      <article className="badminton-card tournament-rules">
        <h2>กติกาที่ใช้</h2>
        <p>คัดเลือก: ทุกทีม 3 แมตช์ · แมตช์ละ 2 เกม 21 แต้ม · ไม่มีดิว</p>
        <p>น็อกเอาต์: ชนะ 2 ใน 3 · ดิวถึง 30 แต้ม · แบ่งสายบน/สายล่าง</p>
        <p>เวลาพักขั้นต่ำ {data.tournament.minimum_rest_minutes} นาที</p>
        {data.owner ? (
          <div className="tournament-status-actions">
            {data.tournament.status === "draft" ? (
              <button
                onClick={() =>
                  mutate(
                    () =>
                      updateTournament(
                        data.tournament.club_id,
                        data.tournament.id,
                        { status: "published" },
                      ),
                    "เผยแพร่หน้าผู้ชมแล้ว",
                  )
                }
                type="button"
              >
                เผยแพร่หน้าผู้ชม
              </button>
            ) : null}
            {!["draft", "completed", "archived"].includes(
              data.tournament.status,
            ) ? (
              <button
                onClick={() => {
                  if (window.confirm("ยืนยันจบการแข่งขันรายการนี้?"))
                    mutate(
                      () =>
                        updateTournament(
                          data.tournament.club_id,
                          data.tournament.id,
                          { status: "completed" },
                        ),
                      "จบการแข่งขันแล้ว",
                    );
                }}
                type="button"
              >
                จบการแข่งขัน
              </button>
            ) : null}
            {data.tournament.status === "completed" ? (
              <button
                onClick={() => {
                  if (window.confirm("เก็บการแข่งขันนี้เข้าประวัติใช่ไหม?"))
                    mutate(
                      () =>
                        updateTournament(
                          data.tournament.club_id,
                          data.tournament.id,
                          { status: "archived" },
                        ),
                      "เก็บเข้าประวัติแล้ว",
                    );
                }}
                type="button"
              >
                เก็บเข้าประวัติ
              </button>
            ) : null}
          </div>
        ) : null}
      </article>
    </section>
  );
}

function TournamentSettings({ data, mutate }) {
  const tournament = data.tournament;
  const [form, setForm] = useState({
    name: tournament.name,
    eventDate: tournament.event_date,
    venue: tournament.venue,
    startsAt: nowLocalInput(new Date(tournament.starts_at)),
    qualifierMinutes: tournament.qualifier_minutes,
    knockoutMinutes: tournament.knockout_minutes,
    minimumRestMinutes: tournament.minimum_rest_minutes,
  });
  return (
    <article className="badminton-card tournament-settings-card">
      <h2>ตั้งค่างาน</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          mutate(
            () =>
              updateTournament(tournament.club_id, tournament.id, {
                ...form,
                startsAt: new Date(form.startsAt).toISOString(),
              }),
            "บันทึกตั้งค่างานแล้ว",
          );
        }}
      >
        <label>
          ชื่องาน
          <input
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </label>
        <div className="tournament-form-grid">
          <label>
            วันที่
            <input
              required
              type="date"
              value={form.eventDate}
              onChange={(event) =>
                setForm({ ...form, eventDate: event.target.value })
              }
            />
          </label>
          <label>
            เวลาเริ่ม
            <input
              required
              type="datetime-local"
              value={form.startsAt}
              onChange={(event) =>
                setForm({ ...form, startsAt: event.target.value })
              }
            />
          </label>
        </div>
        <label>
          สถานที่
          <input
            required
            value={form.venue}
            onChange={(event) =>
              setForm({ ...form, venue: event.target.value })
            }
          />
        </label>
        <div className="tournament-form-grid tournament-duration-grid">
          <label>
            คัดเลือก (นาที)
            <input
              min="10"
              type="number"
              value={form.qualifierMinutes}
              onChange={(event) =>
                setForm({ ...form, qualifierMinutes: event.target.value })
              }
            />
          </label>
          <label>
            น็อกเอาต์ (นาที)
            <input
              min="10"
              type="number"
              value={form.knockoutMinutes}
              onChange={(event) =>
                setForm({ ...form, knockoutMinutes: event.target.value })
              }
            />
          </label>
          <label>
            พักขั้นต่ำ (นาที)
            <input
              min="0"
              type="number"
              value={form.minimumRestMinutes}
              onChange={(event) =>
                setForm({ ...form, minimumRestMinutes: event.target.value })
              }
            />
          </label>
        </div>
        <button className="badminton-primary" type="submit">
          <Save size={17} /> บันทึกตั้งค่างาน
        </button>
      </form>
    </article>
  );
}

function TournamentTeams({ data, members, mutate }) {
  const [divisionId, setDivisionId] = useState(data.divisions[0]?.id || "");
  const [teamName, setTeamName] = useState("");
  const [players, setPlayers] = useState([
    { memberId: "", name: "" },
    { memberId: "", name: "" },
  ]);
  const division = data.divisions.find((item) => item.id === divisionId);
  const teams = data.teams.filter((team) => team.division_id === divisionId);
  const playerByTeam = (teamId) =>
    data.players
      .filter((player) => player.team_id === teamId)
      .sort((a, b) => a.player_order - b.player_order);
  function updatePlayer(index, value) {
    const next = [...players];
    next[index] = value;
    setPlayers(next);
  }
  return (
    <section className="tournament-admin-grid">
      <article className="badminton-card tournament-team-form">
        <h2>เพิ่มทีมที่สมัครมา</h2>
        <label>
          ระดับ
          <select
            value={divisionId}
            onChange={(event) => setDivisionId(event.target.value)}
          >
            {data.divisions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.skill_level}
              </option>
            ))}
          </select>
        </label>
        <label>
          ชื่อทีม (ไม่กรอกจะใช้ชื่อผู้เล่น)
          <input
            value={teamName}
            onChange={(event) => setTeamName(event.target.value)}
          />
        </label>
        {players.map((player, index) => (
          <div className="tournament-player-source" key={index}>
            <strong>ผู้เล่น {index + 1}</strong>
            <select
              onChange={(event) =>
                updatePlayer(
                  index,
                  event.target.value
                    ? { memberId: event.target.value, name: "" }
                    : { memberId: "", name: player.name },
                )
              }
              value={player.memberId}
            >
              <option value="">ผู้เล่นภายนอก</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                  {member.skillLevel ? ` (${member.skillLevel})` : ""}
                </option>
              ))}
            </select>
            {!player.memberId ? (
              <input
                placeholder="ชื่อที่ใช้แข่งขัน"
                required
                value={player.name}
                onChange={(event) =>
                  updatePlayer(index, {
                    memberId: "",
                    name: event.target.value,
                  })
                }
              />
            ) : null}
          </div>
        ))}
        <button
          className="badminton-primary"
          disabled={!division}
          onClick={async () => {
            const result = await mutate(
              () =>
                addTournamentTeam(data.tournament.club_id, {
                  tournamentId: data.tournament.id,
                  divisionId,
                  skillLevel: division.skill_level,
                  name: teamName,
                  players,
                }),
              "เพิ่มทีมแล้ว",
            );
            if (result) {
              setTeamName("");
              setPlayers([
                { memberId: "", name: "" },
                { memberId: "", name: "" },
              ]);
            }
          }}
          type="button"
        >
          <Plus /> เพิ่มทีม
        </button>
      </article>
      <article className="badminton-card tournament-team-list">
        <div className="tournament-section-heading">
          <h2>ทีมระดับ {division?.skill_level || "—"}</h2>
          <span>{teams.length} ทีม</span>
        </div>
        {teams.map((team) => (
          <div className="tournament-team-row" key={team.id}>
            <div>
              <strong>
                {team.draw_order ? `${team.draw_order}. ` : ""}
                {team.name}
              </strong>
              <span>
                {playerByTeam(team.id)
                  .map((player) => player.display_name)
                  .join(" · ")}
              </span>
            </div>
            <button
              onClick={() => {
                if (window.confirm(`ลบทีม ${team.name}?`))
                  mutate(
                    () =>
                      deleteTournamentTeam(data.tournament.club_id, {
                        tournamentId: data.tournament.id,
                        teamId: team.id,
                      }),
                    "ลบทีมแล้ว",
                  );
              }}
              type="button"
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))}
        {data.owner && teams.length >= 4 ? (
          <button
            className="badminton-primary"
            onClick={() => {
              if (window.confirm("สุ่มคู่แข่งและสร้างตารางรอบคัดเลือก?"))
                mutate(
                  () =>
                    generateTournamentQualification(data.tournament.club_id, {
                      tournamentId: data.tournament.id,
                      divisionId,
                      seed: crypto.randomUUID(),
                    }),
                  "จับสลากและสร้างตารางแล้ว",
                );
            }}
            type="button"
          >
            <Swords size={17} /> สุ่มคู่และสร้างตาราง
          </button>
        ) : null}
      </article>
    </section>
  );
}

function TournamentMatches({ data, mutate }) {
  const [level, setLevel] = useState(data.divisions[0]?.skill_level || "all");
  const [shift, setShift] = useState({
    courtId: data.courts[0]?.id || "",
    minutes: 15,
  });
  const divisionIds = new Set(
    data.divisions
      .filter((item) => level === "all" || item.skill_level === level)
      .map((item) => item.id),
  );
  const matches = data.matches.filter((match) =>
    divisionIds.has(match.division_id),
  );
  return (
    <section className="tournament-matches">
      <div className="tournament-filter">
        <label>
          ระดับ
          <select
            value={level}
            onChange={(event) => setLevel(event.target.value)}
          >
            <option value="all">ทั้งหมด</option>
            {data.divisions.map((division) => (
              <option key={division.id}>{division.skill_level}</option>
            ))}
          </select>
        </label>
      </div>
      {data.courts.length ? (
        <div className="badminton-card tournament-shift-tools">
          <strong>เลื่อนคู่ที่ยังไม่เริ่มของสนาม</strong>
          <select
            value={shift.courtId}
            onChange={(event) =>
              setShift({ ...shift, courtId: event.target.value })
            }
          >
            {data.courts.map((court) => (
              <option key={court.id} value={court.id}>
                {court.name}
              </option>
            ))}
          </select>
          <input
            aria-label="จำนวนนาทีที่ต้องการเลื่อน"
            inputMode="numeric"
            max="240"
            min="-240"
            step="5"
            type="number"
            value={shift.minutes}
            onChange={(event) =>
              setShift({ ...shift, minutes: event.target.value })
            }
          />
          <button
            className="badminton-secondary"
            onClick={() => {
              const minutes = Number(shift.minutes);
              if (
                !minutes ||
                !window.confirm(`เลื่อนคู่ที่ยังไม่เริ่ม ${minutes} นาที?`)
              )
                return;
              mutate(
                () =>
                  shiftTournamentCourtMatches(data.tournament.club_id, {
                    tournamentId: data.tournament.id,
                    courtId: shift.courtId,
                    minutes,
                  }),
                "เลื่อนเวลาคู่ที่ยังไม่เริ่มแล้ว",
              );
            }}
            type="button"
          >
            <Clock3 size={16} /> เลื่อนเวลา
          </button>
        </div>
      ) : null}
      {matches.length ? (
        matches.map((match) => (
          <MatchCard data={data} key={match.id} match={match} mutate={mutate} />
        ))
      ) : (
        <section className="badminton-card badminton-empty">
          <h2>ยังไม่มีตารางแข่งขัน</h2>
          <p>เพิ่มทีมและกด “สุ่มคู่และสร้างตาราง” ก่อน</p>
        </section>
      )}
    </section>
  );
}

function MatchCard({ data, match, mutate }) {
  const team = (id) => data.teams.find((item) => item.id === id);
  const division = data.divisions.find((item) => item.id === match.division_id);
  const court = data.courts.find((item) => item.id === match.court_id);
  const savedGames = data.games
    .filter((game) => game.match_id === match.id)
    .sort((a, b) => a.game_no - b.game_no)
    .map((game) => ({
      team1Score: game.team1_score,
      team2Score: game.team2_score,
    }));
  const expected = match.phase === "qualifier" ? 2 : 3;
  const [games, setGames] = useState(
    savedGames.length
      ? savedGames
      : Array.from({ length: expected }, () => ({
          team1Score: "",
          team2Score: "",
        })),
  );
  const [resultType, setResultType] = useState("score");
  const [winner, setWinner] = useState(
    match.winner_team_id || match.team1_id || "",
  );
  const scheduled = match.scheduled_at ? new Date(match.scheduled_at) : null;
  const [schedule, setSchedule] = useState({
    courtId: match.court_id || "",
    scheduledAt: nowLocalInput(
      scheduled || new Date(data.tournament.starts_at),
    ),
  });
  async function save() {
    const filtered = games.filter(
      (game) => game.team1Score !== "" && game.team2Score !== "",
    );
    await mutate(
      () =>
        saveTournamentResult(data.tournament.club_id, {
          matchId: match.id,
          expectedRevision: match.revision,
          games: filtered,
          resultType,
          winnerTeamId: winner,
        }),
      "บันทึกผลและอัปเดตสายแข่งขันแล้ว",
    );
  }
  return (
    <article className={`badminton-card tournament-match is-${match.status}`}>
      <header>
        <div>
          <span>
            {division?.skill_level} · {phaseLabel(match.phase)} รอบ{" "}
            {match.round_no}
          </span>
          <strong>{court?.name || "ยังไม่กำหนดสนาม"}</strong>
        </div>
        <time>
          {scheduled
            ? scheduled.toLocaleString("th-TH", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "ยังไม่กำหนดเวลา"}
        </time>
      </header>
      <div className="tournament-versus">
        <strong>{team(match.team1_id)?.name || `ผู้ชนะคู่ก่อนหน้า`}</strong>
        <b>VS</b>
        <strong>{team(match.team2_id)?.name || `ผู้ชนะคู่ก่อนหน้า`}</strong>
      </div>
      <div className="tournament-match-controls">
        <div className="tournament-schedule-editor">
          <label>
            สนาม
            <select
              value={schedule.courtId}
              onChange={(event) =>
                setSchedule({ ...schedule, courtId: event.target.value })
              }
            >
              <option value="">ยังไม่กำหนด</option>
              {data.courts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            เวลานัด
            <input
              type="datetime-local"
              value={schedule.scheduledAt}
              onChange={(event) =>
                setSchedule({ ...schedule, scheduledAt: event.target.value })
              }
            />
          </label>
          <button
            className="badminton-secondary"
            onClick={() =>
              mutate(
                () =>
                  updateTournamentMatch(data.tournament.club_id, {
                    matchId: match.id,
                    expectedRevision: match.revision,
                    courtId: schedule.courtId,
                    scheduledAt: new Date(schedule.scheduledAt).toISOString(),
                  }),
                "บันทึกสนามและเวลาแล้ว",
              )
            }
            type="button"
          >
            <Save size={16} /> บันทึกเวลา
          </button>
        </div>
        <select
          disabled={match.status === "completed"}
          value={match.status}
          onChange={(event) =>
            mutate(
              () =>
                updateTournamentMatch(data.tournament.club_id, {
                  matchId: match.id,
                  expectedRevision: match.revision,
                  status: event.target.value,
                }),
              "อัปเดตสถานะแล้ว",
            )
          }
        >
          <option value="waiting">รอแข่ง</option>
          <option value="called">เรียกลงสนาม</option>
          <option value="playing">กำลังแข่ง</option>
          <option disabled value="completed">
            จบแล้ว
          </option>
          <option value="cancelled">ยกเลิก</option>
        </select>
        {match.team1_id && match.team2_id ? (
          <>
            <select
              value={resultType}
              onChange={(event) => setResultType(event.target.value)}
            >
              <option value="score">ลงคะแนน</option>
              <option value="walkover">ชนะผ่าน</option>
              <option value="withdrawal">ถอนตัว</option>
            </select>
            {resultType === "score" ? (
              <div className="tournament-score-grid">
                {games.map((game, index) => (
                  <label key={index}>
                    <span>เกม {index + 1}</span>
                    <input
                      inputMode="numeric"
                      min="0"
                      max="30"
                      value={game.team1Score}
                      onChange={(event) => {
                        const next = [...games];
                        next[index] = {
                          ...game,
                          team1Score: event.target.value,
                        };
                        setGames(next);
                      }}
                    />
                    <i>–</i>
                    <input
                      inputMode="numeric"
                      min="0"
                      max="30"
                      value={game.team2Score}
                      onChange={(event) => {
                        const next = [...games];
                        next[index] = {
                          ...game,
                          team2Score: event.target.value,
                        };
                        setGames(next);
                      }}
                    />
                  </label>
                ))}
              </div>
            ) : (
              <label>
                ทีมที่ชนะ
                <select
                  value={winner}
                  onChange={(event) => setWinner(event.target.value)}
                >
                  <option value={match.team1_id}>
                    {team(match.team1_id)?.name}
                  </option>
                  <option value={match.team2_id}>
                    {team(match.team2_id)?.name}
                  </option>
                </select>
              </label>
            )}
            <button className="badminton-primary" onClick={save} type="button">
              <Check /> จบแมตช์
            </button>
          </>
        ) : (
          <p>รอทีมจากคู่ก่อนหน้า</p>
        )}
      </div>
    </article>
  );
}

function TournamentBrackets({ data, mutate }) {
  const qualifierDivisions = data.divisions.filter(
    (division) =>
      division.status === "qualifying" &&
      data.matches
        .filter(
          (match) =>
            match.division_id === division.id && match.phase === "qualifier",
        )
        .every((match) => match.status === "completed"),
  );
  return (
    <section>
      {qualifierDivisions.map((division) => (
        <Standings
          key={division.id}
          data={data}
          division={division}
          mutate={mutate}
        />
      ))}
      {["upper", "lower"].map((phase) => (
        <div className="badminton-card tournament-bracket" key={phase}>
          <h2>{phase === "upper" ? "สายบน" : "สายล่าง"}</h2>
          <BracketRounds
            data={data}
            matches={data.matches.filter((match) => match.phase === phase)}
          />
        </div>
      ))}
    </section>
  );
}

function Standings({ data, division, mutate }) {
  const teams = data.teams.filter((team) => team.division_id === division.id);
  const matches = data.matches
    .filter(
      (match) =>
        match.division_id === division.id &&
        match.phase === "qualifier" &&
        match.status === "completed",
    )
    .map((match) => ({
      team1Id: match.team1_id,
      team2Id: match.team2_id,
      games: qualificationGames(data.games, match),
    }));
  const ranked = rankQualificationTeams(
    teams.map((team) => ({ ...team, drawOrder: team.draw_order })),
    matches,
  );
  return (
    <article className="badminton-card tournament-standings">
      <div className="tournament-section-heading">
        <h2>อันดับรอบคัดเลือก · {division.skill_level}</h2>
        <button
          className="badminton-primary"
          onClick={() => {
            if (window.confirm("ยืนยันแบ่งครึ่งสายบนและสายล่าง?"))
              mutate(
                () =>
                  confirmTournamentSplit(data.tournament.club_id, {
                    tournamentId: data.tournament.id,
                    divisionId: division.id,
                  }),
                "สร้างสายบนและสายล่างแล้ว",
              );
          }}
          type="button"
        >
          ยืนยันแบ่งสาย
        </button>
      </div>
      {ranked.map((row) => (
        <div key={row.id}>
          <b>{row.rank}</b>
          <strong>{row.name}</strong>
          <span>ชนะ {row.gamesWon} เกม</span>
          <span>
            {row.pointDifference > 0 ? "+" : ""}
            {row.pointDifference}
          </span>
          <span>{row.pointsFor} แต้ม</span>
        </div>
      ))}
    </article>
  );
}

function qualificationGames(games, match) {
  const recorded = games
    .filter((game) => game.match_id === match.id)
    .map((game) => ({
      team1Score: game.team1_score,
      team2Score: game.team2_score,
    }));
  if (recorded.length || !match.winner_team_id) return recorded;
  return Array.from({ length: 2 }, () =>
    match.winner_team_id === match.team1_id
      ? { team1Score: 21, team2Score: 0 }
      : { team1Score: 0, team2Score: 21 },
  );
}

function BracketRounds({ data, matches }) {
  const rounds = [...new Set(matches.map((match) => match.round_no))];
  const team = (id) =>
    data.teams.find((item) => item.id === id)?.name || "รอผู้ชนะ";
  if (!matches.length) return <p>ยังไม่ได้สร้างสายนี้</p>;
  return (
    <div className="tournament-bracket-scroll">
      {rounds.map((round) => (
        <div className="tournament-bracket-round" key={round}>
          <h3>{round === rounds.length ? "รอบชิง" : `รอบ ${round}`}</h3>
          {matches
            .filter((match) => match.round_no === round)
            .map((match) => (
              <article key={match.id}>
                <span
                  className={
                    match.winner_team_id === match.team1_id ? "is-winner" : ""
                  }
                >
                  {team(match.team1_id)}
                </span>
                <span
                  className={
                    match.winner_team_id === match.team2_id ? "is-winner" : ""
                  }
                >
                  {team(match.team2_id)}
                </span>
              </article>
            ))}
        </div>
      ))}
    </div>
  );
}

function TournamentHistory({ audits }) {
  return (
    <section className="badminton-card tournament-history">
      <h2>ประวัติการแก้ไข</h2>
      {audits.map((audit) => (
        <div key={audit.id}>
          <span>{audit.action}</span>
          <time>{new Date(audit.created_at).toLocaleString("th-TH")}</time>
        </div>
      ))}
    </section>
  );
}
function phaseLabel(phase) {
  return phase === "qualifier"
    ? "คัดเลือก"
    : phase.includes("third")
      ? "ชิงอันดับ 3"
      : phase === "upper"
        ? "สายบน"
        : "สายล่าง";
}
