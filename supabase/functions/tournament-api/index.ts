import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const payload = await request.json().catch(() => ({}));
  const admin = createClient(url, serviceKey);

  try {
    if (payload.action === "public_tournament") return publicTournament(admin, String(payload.publicId || ""));

    const authorization = request.headers.get("Authorization") || "";
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);

    const clubId = String(payload.clubId || "");
    if (!clubId) return json({ error: "ไม่พบสโมสร" }, 400);
    const [{ data: operator }, { data: owner }] = await Promise.all([
      userClient.rpc("is_club_operator", { target_club_id: clubId }),
      userClient.rpc("is_club_admin", { target_club_id: clubId }),
    ]);
    if (!operator) return json({ error: "ไม่มีสิทธิ์จัดการแข่งขัน" }, 403);
    const actorId = authData.user.id;

    if (payload.action === "list_tournaments") {
      const { data, error } = await admin.from("tournaments").select("*").eq("club_id", clubId).order("event_date", { ascending: false });
      if (error) throw error;
      return json({ tournaments: data, owner: Boolean(owner) });
    }
    if (payload.action === "get_tournament") return adminTournament(admin, clubId, String(payload.tournamentId || ""), Boolean(owner));
    if (payload.action === "member_options") {
      const { data, error } = await admin.from("club_members").select("id,nickname,display_name,skill_level,active").eq("club_id", clubId).eq("active", true).neq("role", "staff").order("nickname");
      if (error) throw error;
      return json({ members: (data || []).map((member) => ({ id: member.id, name: member.nickname || member.display_name, skillLevel: member.skill_level })) });
    }
    if (payload.action === "create_tournament") {
      if (!owner) return json({ error: "เฉพาะเจ้าของที่สร้างการแข่งขันได้" }, 403);
      const details = payload.details || {};
      const startsAt = new Date(details.startsAt);
      const endsAt = new Date(details.endsAt);
      if (!details.name || !details.eventDate || !details.venue || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return json({ error: "กรุณากรอกข้อมูลงานให้ครบ" }, 400);
      if (endsAt <= startsAt) return json({ error: "เวลาจบต้องอยู่หลังเวลาเริ่ม" }, 400);
      const { data: tournament, error } = await admin.from("tournaments").insert({
        club_id: clubId,
        name: String(details.name).trim(), event_date: details.eventDate, venue: String(details.venue).trim(), starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
        qualifier_minutes: Number(details.qualifierMinutes || 30), knockout_minutes: Number(details.knockoutMinutes || 45), minimum_rest_minutes: Number(details.minimumRestMinutes || 15),
        created_by: actorId,
      }).select("*").single();
      if (error) throw error;
      const levels = [...new Set((details.skillLevels || []).filter((level: string) => ["Rookie", "BG", "N", "S", "P"].includes(level)))];
      if (levels.length) await admin.from("tournament_divisions").insert(levels.map((level: string) => ({ tournament_id: tournament.id, club_id: clubId, skill_level: level })));
      const courts = (details.courts || []).map((name: string, index: number) => ({ tournament_id: tournament.id, club_id: clubId, name: String(name).trim(), sort_order: index })).filter((court: any) => court.name);
      if (courts.length) await admin.from("tournament_courts").insert(courts);
      await audit(admin, tournament.id, clubId, actorId, "สร้างการแข่งขัน", { name: tournament.name });
      return json({ tournament });
    }
    if (payload.action === "update_tournament") {
      if (!owner) return json({ error: "เฉพาะเจ้าของที่แก้การตั้งค่าหลักได้" }, 403);
      const details = payload.details || {};
      const { data: currentTournament } = await admin.from("tournaments").select("starts_at,ends_at").eq("id", payload.tournamentId).eq("club_id", clubId).maybeSingle();
      if (!currentTournament) return json({ error: "ไม่พบการแข่งขัน" }, 404);
      const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (details.name != null) changes.name = String(details.name).trim();
      if (details.eventDate != null) changes.event_date = details.eventDate;
      if (details.venue != null) changes.venue = String(details.venue).trim();
      if (details.startsAt != null) changes.starts_at = new Date(details.startsAt).toISOString();
      if (details.endsAt != null) changes.ends_at = new Date(details.endsAt).toISOString();
      const nextStart = new Date(String(changes.starts_at || currentTournament.starts_at));
      const nextEnd = new Date(String(changes.ends_at || currentTournament.ends_at));
      if (nextEnd <= nextStart) return json({ error: "เวลาจบต้องอยู่หลังเวลาเริ่ม" }, 400);
      if (details.status != null) {
        const allowedStatuses = ["draft", "published", "qualifying", "knockout", "completed", "archived", "cancelled"];
        if (!allowedStatuses.includes(details.status)) return json({ error: "สถานะการแข่งขันไม่ถูกต้อง" }, 400);
        changes.status = details.status;
        if (details.status === "completed") changes.completed_at = new Date().toISOString();
        if (details.status === "archived") changes.archived_at = new Date().toISOString();
      }
      if (details.qualifierMinutes != null) changes.qualifier_minutes = Number(details.qualifierMinutes);
      if (details.knockoutMinutes != null) changes.knockout_minutes = Number(details.knockoutMinutes);
      if (details.minimumRestMinutes != null) changes.minimum_rest_minutes = Number(details.minimumRestMinutes);
      const { error } = await admin.from("tournaments").update(changes).eq("id", payload.tournamentId).eq("club_id", clubId);
      if (error) throw error;
      await audit(admin, payload.tournamentId, clubId, actorId, "แก้การตั้งค่าการแข่งขัน", changes);
      return json({ ok: true });
    }
    if (payload.action === "add_division") {
      if (!owner) return json({ error: "เฉพาะเจ้าของที่เพิ่มระดับการแข่งขันได้" }, 403);
      const level = String(payload.skillLevel || "");
      if (!["Rookie", "BG", "N", "S", "P"].includes(level)) return json({ error: "ระดับมือไม่ถูกต้อง" }, 400);
      const { data: tournament } = await admin.from("tournaments").select("id").eq("id", payload.tournamentId).eq("club_id", clubId).maybeSingle();
      if (!tournament) return json({ error: "ไม่พบการแข่งขันในสโมสรนี้" }, 404);
      const { error } = await admin.from("tournament_divisions").insert({ tournament_id: payload.tournamentId, club_id: clubId, skill_level: level });
      if (error) throw error;
      return json({ ok: true });
    }
    if (payload.action === "add_court") {
      if (!owner) return json({ error: "เฉพาะเจ้าของที่เพิ่มสนามได้" }, 403);
      const name = String(payload.name || "").trim();
      if (!name) return json({ error: "กรุณากรอกชื่อสนาม" }, 400);
      const { data: tournament } = await admin.from("tournaments").select("id").eq("id", payload.tournamentId).eq("club_id", clubId).maybeSingle();
      if (!tournament) return json({ error: "ไม่พบการแข่งขันในสโมสรนี้" }, 404);
      const { count } = await admin.from("tournament_courts").select("id", { count: "exact", head: true }).eq("tournament_id", payload.tournamentId);
      const { error } = await admin.from("tournament_courts").insert({ tournament_id: payload.tournamentId, club_id: clubId, name, sort_order: count || 0 });
      if (error) throw error;
      await audit(admin, payload.tournamentId, clubId, actorId, "เพิ่มสนามแข่งขัน", { name });
      return json({ ok: true });
    }
    if (payload.action === "delete_court") {
      if (!owner) return json({ error: "เฉพาะเจ้าของที่ลบสนามได้" }, 403);
      const { count } = await admin.from("tournament_matches").select("id", { count: "exact", head: true }).eq("court_id", payload.courtId).neq("status", "cancelled");
      if (count) return json({ error: "สนามนี้มีคู่แข่งขันอยู่ กรุณาย้ายคู่ก่อน" }, 409);
      const { error } = await admin.from("tournament_courts").delete().eq("id", payload.courtId).eq("club_id", clubId);
      if (error) throw error;
      return json({ ok: true });
    }
    if (payload.action === "add_team") return addTeam(admin, clubId, actorId, payload);
    if (payload.action === "delete_team") {
      const { data: team } = await admin.from("tournament_teams").select("id,tournament_id").eq("id", payload.teamId).eq("club_id", clubId).maybeSingle();
      if (!team) return json({ error: "ไม่พบทีมในการแข่งขันนี้" }, 404);
      const { count } = await admin.from("tournament_matches").select("id", { count: "exact", head: true }).eq("tournament_id", team.tournament_id).or(`team1_id.eq.${payload.teamId},team2_id.eq.${payload.teamId}`).in("status", ["playing", "completed"]);
      if (count) return json({ error: "ทีมนี้เริ่มแข่งขันแล้วจึงลบไม่ได้" }, 409);
      const { error } = await admin.from("tournament_teams").delete().eq("id", payload.teamId).eq("club_id", clubId);
      if (error) throw error;
      await audit(admin, team.tournament_id, clubId, actorId, "ลบทีม", { teamId: payload.teamId });
      return json({ ok: true });
    }
    if (payload.action === "generate_qualification") {
      if (!owner) return json({ error: "เฉพาะเจ้าของที่จับสลากหรือรีเซ็ตผลได้" }, 403);
      return generateQualification(admin, clubId, actorId, payload);
    }
    if (payload.action === "generate_test_teams") {
      if (!owner) return json({ error: "เฉพาะเจ้าของที่เพิ่มผู้เล่นทดลองได้" }, 403);
      const { data, error } = await userClient.rpc("generate_tournament_test_teams", {
        target_tournament_id: payload.tournamentId,
        skill_counts: payload.skillCounts || {},
      });
      if (error) return json({ error: error.message }, 400);
      return json({ players: data });
    }
    if (payload.action === "update_match") return updateMatch(admin, clubId, actorId, payload);
    if (payload.action === "shift_court_matches") return shiftCourtMatches(userClient, clubId, payload);
    if (payload.action === "save_result") return saveResult(userClient, admin, clubId, actorId, payload);
    if (payload.action === "confirm_split") return confirmSplit(admin, clubId, actorId, payload);
    if (payload.action === "delete_tournament") {
      if (!owner) return json({ error: "เฉพาะเจ้าของที่ลบการแข่งขันได้" }, 403);
      const { count } = await admin.from("tournament_matches").select("id", { count: "exact", head: true }).eq("tournament_id", payload.tournamentId).eq("status", "completed");
      if (count) return json({ error: "การแข่งขันที่มีผลแล้วให้เก็บเข้าประวัติแทนการลบ" }, 409);
      const { error } = await admin.from("tournaments").delete().eq("id", payload.tournamentId).eq("club_id", clubId);
      if (error) throw error;
      return json({ ok: true });
    }
    return json({ error: "Invalid action" }, 400);
  } catch (error) {
    console.error("Tournament API error", error);
    return json({ error: error instanceof Error ? error.message : "Tournament request failed" }, 500);
  }
});

async function adminTournament(admin: any, clubId: string, tournamentId: string, owner: boolean) {
  const { data: tournament, error } = await admin.from("tournaments").select("*").eq("id", tournamentId).eq("club_id", clubId).maybeSingle();
  if (error || !tournament) return json({ error: "ไม่พบการแข่งขัน" }, 404);
  const [divisions, courts, teams, players, matches, games, audits] = await Promise.all([
    admin.from("tournament_divisions").select("*").eq("tournament_id", tournamentId).order("skill_level"),
    admin.from("tournament_courts").select("*").eq("tournament_id", tournamentId).order("sort_order"),
    admin.from("tournament_teams").select("*").eq("tournament_id", tournamentId).order("draw_order"),
    admin.from("tournament_team_players").select("id,team_id,club_member_id,display_name,skill_level_snapshot,player_order").eq("tournament_id", tournamentId).order("player_order"),
    admin.from("tournament_matches").select("*").eq("tournament_id", tournamentId).order("scheduled_at"),
    admin.from("tournament_games").select("*").eq("tournament_id", tournamentId).order("game_no"),
    owner ? admin.from("tournament_audit_logs").select("*").eq("tournament_id", tournamentId).order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
  ]);
  return json({ owner, tournament, divisions: divisions.data || [], courts: courts.data || [], teams: teams.data || [], players: players.data || [], matches: matches.data || [], games: games.data || [], audits: audits.data || [] });
}

async function publicTournament(admin: any, publicId: string) {
  const { data: tournament } = await admin.from("tournaments").select("id,public_id,name,event_date,venue,starts_at,ends_at,status,updated_at").eq("public_id", publicId).in("status", ["published", "qualifying", "knockout", "completed", "archived"]).maybeSingle();
  if (!tournament) return json({ error: "ไม่พบการแข่งขันที่เผยแพร่" }, 404);
  const [divisions, courts, teams, players, matches, games] = await Promise.all([
    admin.from("tournament_divisions").select("id,skill_level,status").eq("tournament_id", tournament.id),
    admin.from("tournament_courts").select("id,name,sort_order").eq("tournament_id", tournament.id).order("sort_order"),
    admin.from("tournament_teams").select("id,division_id,name,draw_order,qualification_rank,bracket,withdrawn").eq("tournament_id", tournament.id),
    admin.from("tournament_team_players").select("team_id,display_name,skill_level_snapshot,player_order").eq("tournament_id", tournament.id).order("player_order"),
    admin.from("tournament_matches").select("id,division_id,phase,round_no,position,court_id,team1_id,team2_id,winner_team_id,next_match_id,next_slot,scheduled_at,estimated_minutes,actual_started_at,actual_ended_at,status,result_type,result_reason").eq("tournament_id", tournament.id).neq("status", "cancelled").order("scheduled_at"),
    admin.from("tournament_games").select("match_id,game_no,team1_score,team2_score").eq("tournament_id", tournament.id).order("game_no"),
  ]);
  return json({ serverNow: new Date().toISOString(), tournament, divisions: divisions.data || [], courts: courts.data || [], teams: teams.data || [], players: players.data || [], matches: matches.data || [], games: games.data || [] });
}

async function addTeam(admin: any, clubId: string, actorId: string, payload: any) {
  const { data: division } = await admin.from("tournament_divisions").select("id,tournament_id,skill_level").eq("id", payload.divisionId).eq("tournament_id", payload.tournamentId).eq("club_id", clubId).maybeSingle();
  if (!division) return json({ error: "ไม่พบระดับการแข่งขันในรายการนี้" }, 404);
  if (division.skill_level !== payload.skillLevel) return json({ error: "ระดับทีมไม่ตรงกับระดับการแข่งขัน" }, 400);
  const players = Array.isArray(payload.players) ? payload.players.slice(0, 2) : [];
  if (players.length !== 2) return json({ error: "หนึ่งทีมต้องมีผู้เล่น 2 คน" }, 400);
  const resolved = [];
  for (const player of players) {
    if (player.memberId) {
      const { data: member } = await admin.from("club_members").select("id,nickname,display_name,skill_level").eq("id", player.memberId).eq("club_id", clubId).maybeSingle();
      if (!member) return json({ error: "ไม่พบสมาชิกที่เลือก" }, 400);
      resolved.push({ memberId: member.id, name: member.nickname || member.display_name, skillLevel: payload.skillLevel });
    } else {
      const name = String(player.name || "").trim();
      if (!name) return json({ error: "กรุณากรอกชื่อผู้เล่นภายนอก" }, 400);
      resolved.push({ memberId: null, name, skillLevel: payload.skillLevel });
    }
  }
  const teamName = String(payload.name || resolved.map((player) => player.name).join(" / ")).trim();
  const { data: team, error } = await admin.from("tournament_teams").insert({ tournament_id: payload.tournamentId, division_id: payload.divisionId, club_id: clubId, name: teamName }).select("*").single();
  if (error) throw error;
  const { error: playerError } = await admin.from("tournament_team_players").insert(resolved.map((player, index) => ({ tournament_id: payload.tournamentId, division_id: payload.divisionId, team_id: team.id, club_id: clubId, club_member_id: player.memberId, display_name: player.name, skill_level_snapshot: player.skillLevel, player_order: index + 1 })));
  if (playerError) {
    await admin.from("tournament_teams").delete().eq("id", team.id);
    throw playerError;
  }
  await audit(admin, payload.tournamentId, clubId, actorId, "เพิ่มทีม", { teamId: team.id, name: teamName });
  return json({ team });
}

function seededShuffle<T>(items: T[], seed: string) {
  let value = 2166136261;
  for (const char of seed) { value ^= char.charCodeAt(0); value = Math.imul(value, 16777619); }
  const random = () => { value += 0x6d2b79f5; let t = value; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) { const next = Math.floor(random() * (index + 1)); [result[index], result[next]] = [result[next], result[index]]; }
  return result;
}

async function generateQualification(admin: any, clubId: string, actorId: string, payload: any) {
  const { data: division } = await admin.from("tournament_divisions").select("*,tournaments(*)").eq("id", payload.divisionId).eq("club_id", clubId).maybeSingle();
  if (!division) return json({ error: "ไม่พบระดับการแข่งขัน" }, 404);
  const { data: teams } = await admin.from("tournament_teams").select("id").eq("division_id", division.id).eq("withdrawn", false);
  if (!teams || teams.length < 4 || teams.length % 2) return json({ error: "ต้องมีอย่างน้อย 4 ทีมและเป็นเลขคู่" }, 400);
  const { count: completed } = await admin.from("tournament_matches").select("id", { count: "exact", head: true }).eq("division_id", division.id).eq("status", "completed");
  if (completed) return json({ error: "เริ่มแข่งขันแล้วจึงสุ่มใหม่ไม่ได้" }, 409);
  const seed = String(payload.seed || crypto.randomUUID());
  const ordered = seededShuffle(teams.map((team: any) => team.id), seed);
  const rotating = [...ordered];
  const matches: any[] = [];
  for (let round = 1; round <= 3; round += 1) {
    for (let index = 0; index < rotating.length / 2; index += 1) matches.push({ round, position: index + 1, team1: rotating[index], team2: rotating[rotating.length - 1 - index] });
    rotating.splice(1, 0, rotating.pop()!);
  }
  const { data: courts } = await admin.from("tournament_courts").select("id,sort_order").eq("tournament_id", division.tournament_id).order("sort_order");
  if (!courts?.length) return json({ error: "กรุณาเพิ่มสนามก่อนจับสลาก" }, 400);
  await admin.from("tournament_matches").delete().eq("division_id", division.id).eq("phase", "qualifier");
  await Promise.all(ordered.map((teamId, index) => admin.from("tournament_teams").update({ draw_order: index + 1 }).eq("id", teamId)));
  const start = new Date(division.tournaments.starts_at).getTime();
  const duration = Number(division.tournaments.qualifier_minutes || 30);
  const rest = Number(division.tournaments.minimum_rest_minutes || 15);
  const courtReady = new Map(courts.map((court: any) => [court.id, start]));
  const teamReady = new Map<string, number>();
  const scheduled = matches.map((match) => {
    const choice = courts.map((court: any) => ({ court, at: Math.max(courtReady.get(court.id)!, teamReady.get(match.team1) || start, teamReady.get(match.team2) || start) })).sort((a: any, b: any) => a.at - b.at || a.court.sort_order - b.court.sort_order)[0];
    const end = choice.at + duration * 60000;
    courtReady.set(choice.court.id, end);
    teamReady.set(match.team1, end + rest * 60000); teamReady.set(match.team2, end + rest * 60000);
    return { tournament_id: division.tournament_id, division_id: division.id, club_id: clubId, phase: "qualifier", round_no: match.round, position: match.position, court_id: choice.court.id, team1_id: match.team1, team2_id: match.team2, scheduled_at: new Date(choice.at).toISOString(), estimated_minutes: duration };
  });
  const { error } = await admin.from("tournament_matches").insert(scheduled);
  if (error) throw error;
  await admin.from("tournament_divisions").update({ draw_seed: seed, status: "qualifying", revision: division.revision + 1 }).eq("id", division.id);
  await admin.from("tournaments").update({ status: "qualifying", updated_at: new Date().toISOString() }).eq("id", division.tournament_id).eq("status", "draft");
  await audit(admin, division.tournament_id, clubId, actorId, "จับสลากรอบคัดเลือก", { divisionId: division.id, seed });
  return json({ ok: true, seed });
}

async function updateMatch(admin: any, clubId: string, actorId: string, payload: any) {
  const { data: current } = await admin.from("tournament_matches").select("*").eq("id", payload.matchId).eq("club_id", clubId).maybeSingle();
  if (!current) return json({ error: "ไม่พบคู่แข่งขัน" }, 404);
  if (Number(payload.expectedRevision) !== Number(current.revision)) return json({ error: "ข้อมูลคู่นี้ถูกแก้จากอีกเครื่อง กรุณาโหลดล่าสุด" }, 409);
  const changes: any = { revision: current.revision + 1, updated_at: new Date().toISOString() };
  if (payload.status != null) {
    if (!["waiting", "called", "playing", "cancelled"].includes(payload.status)) return json({ error: "กรุณาจบแมตช์ด้วยการบันทึกคะแนน" }, 400);
    changes.status = payload.status;
  }
  if (payload.courtId !== undefined) changes.court_id = payload.courtId || null;
  if (payload.scheduledAt != null) {
    const value = new Date(payload.scheduledAt);
    if (Number.isNaN(value.getTime())) return json({ error: "วันหรือเวลาแข่งขันไม่ถูกต้อง" }, 400);
    changes.scheduled_at = value.toISOString();
  }
  const nextCourtId = changes.court_id !== undefined ? changes.court_id : current.court_id;
  const nextScheduledAt = changes.scheduled_at || current.scheduled_at;
  if (nextCourtId) {
    const { data: court } = await admin.from("tournament_courts").select("id").eq("id", nextCourtId).eq("tournament_id", current.tournament_id).maybeSingle();
    if (!court) return json({ error: "สนามที่เลือกไม่ได้อยู่ในการแข่งขันนี้" }, 400);
  }
  if (nextScheduledAt) {
    const [{ data: tournament }, { data: others }] = await Promise.all([
      admin.from("tournaments").select("minimum_rest_minutes").eq("id", current.tournament_id).single(),
      admin.from("tournament_matches").select("id,court_id,team1_id,team2_id,scheduled_at,estimated_minutes,status").eq("tournament_id", current.tournament_id).neq("id", current.id).neq("status", "cancelled").not("scheduled_at", "is", null),
    ]);
    const start = new Date(nextScheduledAt).getTime();
    const end = start + Number(current.estimated_minutes) * 60000;
    const restMs = Number(tournament?.minimum_rest_minutes || 0) * 60000;
    const teams = new Set([current.team1_id, current.team2_id].filter(Boolean));
    for (const other of others || []) {
      const otherStart = new Date(other.scheduled_at).getTime();
      const otherEnd = otherStart + Number(other.estimated_minutes) * 60000;
      const overlaps = start < otherEnd && otherStart < end;
      if (nextCourtId && other.court_id === nextCourtId && overlaps) return json({ error: "เวลานี้สนามมีคู่แข่งขันอื่นอยู่" }, 409);
      const sharesTeam = teams.has(other.team1_id) || teams.has(other.team2_id);
      if (sharesTeam && (start < otherEnd + restMs && otherStart < end + restMs)) return json({ error: `ทีมมีคู่แข่งซ้อนกันหรือพักไม่ครบ ${Number(tournament?.minimum_rest_minutes || 0)} นาที` }, 409);
    }
  }
  if (payload.status === "playing") changes.actual_started_at = current.actual_started_at || new Date().toISOString();
  const { error } = await admin.from("tournament_matches").update(changes).eq("id", current.id).eq("revision", current.revision);
  if (error) throw error;
  await audit(admin, current.tournament_id, clubId, actorId, "แก้สถานะหรือเวลาคู่แข่งขัน", { matchId: current.id, ...changes });
  return json({ ok: true });
}

async function shiftCourtMatches(userClient: any, clubId: string, payload: any) {
  const minutes = Number(payload.minutes);
  if (!Number.isInteger(minutes) || minutes === 0 || Math.abs(minutes) > 240) {
    return json({ error: "กรุณาระบุเวลาที่ต้องการเลื่อนระหว่าง 1–240 นาที" }, 400);
  }
  const { data, error } = await userClient.rpc("shift_tournament_court_matches", {
    target_tournament_id: payload.tournamentId,
    target_court_id: payload.courtId,
    shift_minutes: minutes,
  });
  if (error) return json({ error: error.message }, 409);
  return json({ shifted: data });
}

function validQualificationGames(games: any[]) {
  return games.length === 2 && games.every((game) => { const a = Number(game.team1Score); const b = Number(game.team2Score); return Number.isInteger(a) && Number.isInteger(b) && a !== b && Math.max(a, b) === 21 && Math.min(a, b) >= 0 && Math.min(a, b) <= 20; });
}
function validKnockoutGames(games: any[]) {
  if (games.length < 2 || games.length > 3) return false;
  let aWins = 0; let bWins = 0;
  for (let index = 0; index < games.length; index += 1) {
    const a = Number(games[index].team1Score); const b = Number(games[index].team2Score); const high = Math.max(a, b); const low = Math.min(a, b);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b || high < 21 || high > 30 || (high === 30 ? low !== 29 : high - low < 2)) return false;
    if (a > b) aWins += 1; else bWins += 1;
    if (index < games.length - 1 && Math.max(aWins, bWins) === 2) return false;
  }
  return Math.max(aWins, bWins) === 2;
}

async function saveResult(userClient: any, admin: any, clubId: string, actorId: string, payload: any) {
  const { data: match } = await admin.from("tournament_matches").select("*").eq("id", payload.matchId).eq("club_id", clubId).maybeSingle();
  if (!match || !match.team1_id || !match.team2_id) return json({ error: "คู่แข่งขันยังไม่ครบ" }, 400);
  let games = Array.isArray(payload.games) ? payload.games : [];
  let winnerId; let loserId;
  if (payload.resultType === "score") {
    const valid = match.phase === "qualifier" ? validQualificationGames(games) : validKnockoutGames(games);
    if (!valid) return json({ error: match.phase === "qualifier" ? "รอบคัดเลือกต้องครบ 2 เกม เกมละ 21 ไม่มีดิว" : "คะแนนน็อกเอาต์ต้องชนะ 2 ใน 3 และถูกต้องตามกติกาดิว" }, 400);
    const aWins = games.filter((game: any) => Number(game.team1Score) > Number(game.team2Score)).length;
    const bWins = games.length - aWins;
    if (match.phase === "qualifier" && aWins === bWins) { winnerId = null; loserId = null; }
    else { winnerId = aWins > bWins ? match.team1_id : match.team2_id; loserId = winnerId === match.team1_id ? match.team2_id : match.team1_id; }
  } else {
    winnerId = payload.winnerTeamId; loserId = winnerId === match.team1_id ? match.team2_id : match.team1_id;
    if (![match.team1_id, match.team2_id].includes(winnerId)) return json({ error: "กรุณาเลือกทีมที่ชนะ" }, 400);
    if (match.phase === "qualifier") {
      games = winnerId === match.team1_id
        ? [{ team1Score: 21, team2Score: 0 }, { team1Score: 21, team2Score: 0 }]
        : [{ team1Score: 0, team2Score: 21 }, { team1Score: 0, team2Score: 21 }];
    }
  }
  const { data, error } = await userClient.rpc("save_tournament_match_result", { target_match_id: match.id, expected_revision: Number(payload.expectedRevision), score_games: games, selected_winner_id: winnerId, selected_loser_id: loserId, selected_result_type: payload.resultType || "score", selected_reason: payload.reason || null });
  if (error) return json({ error: error.message }, error.message.includes("อีกเครื่อง") ? 409 : 400);
  return json({ match: data });
}

async function confirmSplit(admin: any, clubId: string, actorId: string, payload: any) {
  const { data: division } = await admin.from("tournament_divisions").select("*,tournaments(*)").eq("id", payload.divisionId).eq("club_id", clubId).maybeSingle();
  if (!division) return json({ error: "ไม่พบระดับการแข่งขัน" }, 404);
  const { data: qualifiers } = await admin.from("tournament_matches").select("*,tournament_games(*)").eq("division_id", division.id).eq("phase", "qualifier");
  if (!qualifiers?.length || qualifiers.some((match: any) => match.status !== "completed")) return json({ error: "ต้องแข่งรอบคัดเลือกให้ครบก่อนแบ่งสาย" }, 409);
  const { data: teams } = await admin.from("tournament_teams").select("*").eq("division_id", division.id).eq("withdrawn", false);
  const stats = new Map((teams || []).map((team: any) => [team.id, { team, wins: 0, for: 0, against: 0, opponents: new Map<string, number>() }]));
  qualifiers.forEach((match: any) => {
    const recordedGames = match.tournament_games || [];
    const effectiveGames = recordedGames.length
      ? recordedGames
      : match.winner_team_id
        ? Array.from({ length: 2 }, () => match.winner_team_id === match.team1_id
          ? { team1_score: 21, team2_score: 0 }
          : { team1_score: 0, team2_score: 21 })
        : [];
    let oneGameWins = 0;
    let twoGameWins = 0;
    effectiveGames.forEach((game: any) => {
      const one = stats.get(match.team1_id);
      const two = stats.get(match.team2_id);
      one.for += game.team1_score;
      one.against += game.team2_score;
      two.for += game.team2_score;
      two.against += game.team1_score;
      if (game.team1_score > game.team2_score) {
        one.wins += 1;
        oneGameWins += 1;
      } else {
        two.wins += 1;
        twoGameWins += 1;
      }
    });
    stats.get(match.team1_id).opponents.set(match.team2_id, oneGameWins - twoGameWins);
    stats.get(match.team2_id).opponents.set(match.team1_id, twoGameWins - oneGameWins);
  });
  const rows = [...stats.values()];
  const ranked = rows.sort((a: any, b: any) => {
    const primary = b.wins - a.wins || (b.for - b.against) - (a.for - a.against) || b.for - a.for;
    if (primary) return primary;
    const tied = rows.filter((row: any) => row.wins === a.wins && row.for - row.against === a.for - a.against && row.for === a.for);
    if (tied.length === 2) {
      const headToHead = a.opponents.get(b.team.id);
      if (headToHead) return -headToHead;
    }
    return a.team.draw_order - b.team.draw_order;
  });
  const half = ranked.length / 2;
  const upper = ranked.slice(0, half); const lower = ranked.slice(half);
  await Promise.all(ranked.map((row: any, index: number) => admin.from("tournament_teams").update({ qualification_rank: index + 1, bracket: index < half ? "upper" : "lower" }).eq("id", row.team.id)));
  await createBracket(admin, division, upper, "upper", clubId);
  await createBracket(admin, division, lower, "lower", clubId);
  await admin.from("tournament_divisions").update({ status: "knockout", revision: division.revision + 1 }).eq("id", division.id);
  await admin.from("tournaments").update({ status: "knockout", updated_at: new Date().toISOString() }).eq("id", division.tournament_id);
  await audit(admin, division.tournament_id, clubId, actorId, "ยืนยันแบ่งสายบนและสายล่าง", { divisionId: division.id });
  return json({ ok: true });
}

async function createBracket(admin: any, division: any, ranked: any[], phase: string, clubId: string) {
  const size = 2 ** Math.ceil(Math.log2(ranked.length));
  const pairs = Array.from({ length: size / 2 }, (_, index) => [index + 1, size - index]);
  const byRank = new Map(ranked.map((row: any, index: number) => [index + 1, row.team.id]));
  const { data: courts } = await admin.from("tournament_courts").select("id").eq("tournament_id", division.tournament_id).order("sort_order");
  let start = new Date(division.tournaments.starts_at).getTime() + Number(division.tournaments.qualifier_minutes) * 60000 * 3 * Math.ceil((ranked.length * 2) / Math.max(1, courts?.length || 1));
  const duration = Number(division.tournaments.knockout_minutes || 45);
  const createdRounds: any[][] = [];
  let previous: any[] = [];
  for (let round = 1, matchCount = pairs.length; matchCount >= 1; round += 1, matchCount /= 2) {
    const rows = [];
    for (let index = 0; index < matchCount; index += 1) {
      const pair = round === 1 ? pairs[index] : null;
      rows.push({ tournament_id: division.tournament_id, division_id: division.id, club_id: clubId, phase, round_no: round, position: index + 1, team1_id: pair ? byRank.get(pair[0]) || null : null, team2_id: pair ? byRank.get(pair[1]) || null : null, court_id: courts?.[index % Math.max(1, courts.length)]?.id || null, scheduled_at: new Date(start + index * duration * 60000).toISOString(), estimated_minutes: duration });
    }
    const { data: inserted, error } = await admin.from("tournament_matches").insert(rows).select("*");
    if (error) throw error;
    createdRounds.push(inserted || []);
    if (previous.length) await Promise.all(previous.map((match: any, index: number) => admin.from("tournament_matches").update({ next_match_id: inserted[Math.floor(index / 2)].id, next_slot: (index % 2) + 1 }).eq("id", match.id)));
    previous = inserted;
    start += matchCount * duration * 60000;
    if (matchCount === 1) break;
  }

  // Advance a seeded bye immediately; it is not shown as a played game.
  const { data: firstRoundWithLinks } = await admin.from("tournament_matches").select("*").eq("division_id", division.id).eq("phase", phase).eq("round_no", 1);
  for (const match of firstRoundWithLinks || []) {
    const byeWinner = match.team1_id || match.team2_id;
    if (!byeWinner || (match.team1_id && match.team2_id) || !match.next_match_id) continue;
    await admin.from("tournament_matches").update({ winner_team_id: byeWinner, result_type: "walkover", result_reason: "บาย", status: "completed", actual_ended_at: new Date().toISOString(), revision: match.revision + 1 }).eq("id", match.id);
    await admin.from("tournament_matches").update(match.next_slot === 1 ? { team1_id: byeWinner } : { team2_id: byeWinner }).eq("id", match.next_match_id);
  }

  // A third-place match receives the two semifinal losers.
  if (ranked.length >= 4 && createdRounds.length >= 2) {
    const semifinals = createdRounds[createdRounds.length - 2];
    if (semifinals?.length === 2) {
      const finalMatch = createdRounds[createdRounds.length - 1]?.[0];
      const { data: third, error: thirdError } = await admin.from("tournament_matches").insert({
        tournament_id: division.tournament_id, division_id: division.id, club_id: clubId,
        phase: `${phase}_third`, round_no: createdRounds.length, position: 1,
        court_id: courts?.[1 % Math.max(1, courts.length)]?.id || null,
        scheduled_at: new Date(new Date(finalMatch?.scheduled_at || start).getTime() + duration * 60000).toISOString(),
        estimated_minutes: duration,
      }).select("*").single();
      if (thirdError) throw thirdError;
      await Promise.all(semifinals.map((match: any, index: number) => admin.from("tournament_matches").update({ loser_next_match_id: third.id, loser_next_slot: index + 1 }).eq("id", match.id)));
    }
  }
}

async function audit(admin: any, tournamentId: string, clubId: string, actorId: string, action: string, details: unknown) {
  await admin.from("tournament_audit_logs").insert({ tournament_id: tournamentId, club_id: clubId, actor_id: actorId, action, details });
}
