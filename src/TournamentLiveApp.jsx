import React, { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock3, MapPin, RefreshCw, Trophy } from "lucide-react";
import { loadPublicTournament } from "./tournamentRepository.js";
import { rankQualificationTeams } from "./tournamentLogic.js";

const TEXT = {
  th: {
    live: "กำลังแข่งและคู่ถัดไป",
    schedule: "ตารางทั้งหมด",
    standings: "อันดับรอบคัดเลือก",
    upper: "สายบน",
    lower: "สายล่าง",
    all: "ทุกระดับ",
    updated: "อัปเดตล่าสุด",
    waiting: "รอแข่ง",
    called: "เรียกลงสนาม",
    playing: "กำลังแข่ง",
    completed: "จบแล้ว",
    delayed: "ล่าช้า",
    noData: "ยังไม่มีข้อมูลการแข่งขัน",
    public: "ผลการแข่งขันสำหรับผู้เล่นและกองเชียร์",
    eventTime: "เวลาแข่งขัน",
  },
  en: {
    live: "Live & Up next",
    schedule: "Full schedule",
    standings: "Qualification standings",
    upper: "Upper bracket",
    lower: "Lower bracket",
    all: "All levels",
    updated: "Last updated",
    waiting: "Waiting",
    called: "Called",
    playing: "Playing",
    completed: "Finished",
    delayed: "Delayed",
    noData: "No tournament data yet",
    public: "Live results for players and spectators",
    eventTime: "Event time",
  },
};

export default function TournamentLiveApp() {
  const publicId = new URLSearchParams(window.location.search).get("id") || "";
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [language, setLanguage] = useState(
    localStorage.getItem("tournament-language") || "th",
  );
  const [tab, setTab] = useState("live");
  const [level, setLevel] = useState("all");
  const [updated, setUpdated] = useState(null);
  const t = TEXT[language];
  async function refresh() {
    try {
      setData(await loadPublicTournament(publicId));
      setUpdated(new Date());
      setError("");
    } catch (next) {
      setError(next.message);
    }
  }
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [publicId]);
  function switchLanguage() {
    const next = language === "th" ? "en" : "th";
    localStorage.setItem("tournament-language", next);
    setLanguage(next);
  }
  if (!data)
    return (
      <main className="badminton-app tournament-live-page">
        <div className="tournament-loading">
          {error || "Loading tournament..."}
        </div>
      </main>
    );
  const { tournament, divisions, courts, teams, players, matches, games } =
    data;
  const divisionsShown = divisions.filter(
    (item) => level === "all" || item.skill_level === level,
  );
  const ids = new Set(divisionsShown.map((item) => item.id));
  const filtered = matches.filter((match) => ids.has(match.division_id));
  const teamName = (id) =>
    teams.find((item) => item.id === id)?.name ||
    (language === "th" ? "รอผู้ชนะ" : "TBD");
  const courtName = (id) => courts.find((item) => item.id === id)?.name || "—";
  const gameText = (id) =>
    games
      .filter((game) => game.match_id === id)
      .sort((a, b) => a.game_no - b.game_no)
      .map((game) => `${game.team1_score}-${game.team2_score}`)
      .join(" · ");
  const liveMatches = filtered.filter((match) =>
    ["playing", "called"].includes(match.status),
  );
  const upcoming = filtered
    .filter((match) => match.status === "waiting")
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    .slice(0, Math.max(4, courts.length));
  return (
    <main className="badminton-app tournament-live-page">
      <section className="badminton-shell">
        <header className="tournament-live-header">
          <div>
            <p>{t.public}</p>
            <h1>{tournament.name}</h1>
            <span>
              <CalendarDays size={15} />
              {tournament.event_date} <MapPin size={15} />
              {tournament.venue}
            </span>
            <span>
              <Clock3 size={15} /> {t.eventTime}{" "}
              {new Date(tournament.starts_at).toLocaleTimeString(
                language === "th" ? "th-TH" : "en-GB",
                { hour: "2-digit", minute: "2-digit" },
              )}
              –
              {new Date(tournament.ends_at).toLocaleTimeString(
                language === "th" ? "th-TH" : "en-GB",
                { hour: "2-digit", minute: "2-digit" },
              )}
            </span>
          </div>
          <button onClick={switchLanguage} type="button">
            🌐 {language === "th" ? "EN" : "ไทย"}
          </button>
        </header>
        <div className="tournament-live-toolbar">
          <select
            value={level}
            onChange={(event) => setLevel(event.target.value)}
          >
            <option value="all">{t.all}</option>
            {divisions.map((division) => (
              <option key={division.id} value={division.skill_level}>
                {division.skill_level}
              </option>
            ))}
          </select>
          <span>
            <RefreshCw size={14} />
            {t.updated}{" "}
            {updated?.toLocaleTimeString(
              language === "th" ? "th-TH" : "en-GB",
              { hour: "2-digit", minute: "2-digit", second: "2-digit" },
            )}
          </span>
        </div>
        <nav className="tournament-live-tabs">
          {[
            ["live", t.live],
            ["schedule", t.schedule],
            ["standings", t.standings],
            ["upper", t.upper],
            ["lower", t.lower],
          ].map(([id, label]) => (
            <button
              className={tab === id ? "is-active" : ""}
              key={id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        {tab === "live" ? (
          <section className="tournament-public-stack">
            <h2>{t.live}</h2>
            {liveMatches.length || upcoming.length ? (
              [...liveMatches, ...upcoming].map((match) => (
                <PublicMatch
                  key={match.id}
                  match={match}
                  division={divisions.find((d) => d.id === match.division_id)}
                  teamName={teamName}
                  courtName={courtName}
                  gameText={gameText}
                  t={t}
                />
              ))
            ) : (
              <div className="badminton-card badminton-empty">{t.noData}</div>
            )}
          </section>
        ) : null}
        {tab === "schedule" ? (
          <section className="tournament-public-stack">
            {filtered
              .sort(
                (a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at),
              )
              .map((match) => (
                <PublicMatch
                  key={match.id}
                  match={match}
                  division={divisions.find((d) => d.id === match.division_id)}
                  teamName={teamName}
                  courtName={courtName}
                  gameText={gameText}
                  t={t}
                />
              ))}
          </section>
        ) : null}
        {tab === "standings"
          ? divisionsShown.map((division) => (
              <PublicStandings
                key={division.id}
                division={division}
                teams={teams}
                matches={matches}
                games={games}
              />
            ))
          : null}
        {tab === "upper" || tab === "lower"
          ? divisionsShown.map((division) => (
              <PublicBracket
                key={division.id}
                division={division}
                phase={tab}
                matches={matches}
                teamName={teamName}
              />
            ))
          : null}
      </section>
    </main>
  );
}

function PublicMatch({ match, division, teamName, courtName, gameText, t }) {
  const at = match.scheduled_at ? new Date(match.scheduled_at) : null;
  const delay =
    at && ["waiting", "called"].includes(match.status)
      ? Math.max(0, Math.floor((Date.now() - at.getTime()) / 60000))
      : 0;
  return (
    <article className={`tournament-public-match is-${match.status}`}>
      <header>
        <b>
          {division?.skill_level} · {courtName(match.court_id)}
        </b>
        <time>
          <Clock3 size={15} />
          {at?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) ||
            "—"}
        </time>
      </header>
      <div>
        <strong>{teamName(match.team1_id)}</strong>
        <em>VS</em>
        <strong>{teamName(match.team2_id)}</strong>
      </div>
      <footer>
        <span>
          {t[match.status] || match.status}
          {delay ? ` · ${t.delayed} ${delay} min` : ""}
        </span>
        <b>{gameText(match.id)}</b>
      </footer>
    </article>
  );
}

function PublicStandings({ division, teams, matches, games }) {
  const divisionTeams = teams.filter(
    (team) => team.division_id === division.id,
  );
  const completed = matches
    .filter(
      (match) =>
        match.division_id === division.id &&
        match.phase === "qualifier" &&
        match.status === "completed",
    )
    .map((match) => ({
      team1Id: match.team1_id,
      team2Id: match.team2_id,
      games: qualificationGames(games, match),
    }));
  const ranked = rankQualificationTeams(
    divisionTeams.map((team) => ({ ...team, drawOrder: team.draw_order })),
    completed,
  );
  return (
    <section className="badminton-card tournament-public-standings">
      <h2>
        <Trophy size={20} /> {division.skill_level}
      </h2>
      {ranked.map((row) => (
        <div key={row.id}>
          <b>{row.rank}</b>
          <strong>{row.name}</strong>
          <span>{row.gamesWon} W</span>
          <span>
            {row.pointDifference > 0 ? "+" : ""}
            {row.pointDifference}
          </span>
        </div>
      ))}
    </section>
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

function PublicBracket({ division, phase, matches, teamName }) {
  const rows = matches.filter(
    (m) => m.division_id === division.id && m.phase === phase,
  );
  const rounds = [...new Set(rows.map((m) => m.round_no))];
  return (
    <section className="badminton-card tournament-public-bracket">
      <h2>{division.skill_level}</h2>
      <div>
        {rounds.map((round) => (
          <section key={round}>
            <h3>Round {round}</h3>
            {rows
              .filter((m) => m.round_no === round)
              .map((m) => (
                <article key={m.id}>
                  <span
                    className={
                      m.winner_team_id === m.team1_id ? "is-winner" : ""
                    }
                  >
                    {teamName(m.team1_id)}
                  </span>
                  <span
                    className={
                      m.winner_team_id === m.team2_id ? "is-winner" : ""
                    }
                  >
                    {teamName(m.team2_id)}
                  </span>
                </article>
              ))}
          </section>
        ))}
      </div>
    </section>
  );
}
