import { supabase } from "./supabase.js";

const endpoint = () =>
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tournament-api`;

async function request(action, payload = {}, { publicRequest = false } = {}) {
  const headers = {
    "Content-Type": "application/json",
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
  if (!publicRequest) {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) throw new Error("กรุณาเข้าสู่ระบบใหม่");
    headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  const response = await fetch(endpoint(), {
    method: "POST",
    headers,
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error)
    throw new Error(data.error || "เชื่อมต่อระบบการแข่งขันไม่สำเร็จ");
  return data;
}

export const listTournaments = (clubId) =>
  request("list_tournaments", { clubId });
export const loadTournament = (clubId, tournamentId) =>
  request("get_tournament", { clubId, tournamentId });
export const loadTournamentMemberOptions = (clubId) =>
  request("member_options", { clubId });
export const createTournament = (clubId, details) =>
  request("create_tournament", { clubId, details });
export const updateTournament = (clubId, tournamentId, details) =>
  request("update_tournament", { clubId, tournamentId, details });
export const deleteTournament = (clubId, tournamentId) =>
  request("delete_tournament", { clubId, tournamentId });
export const addTournamentDivision = (clubId, tournamentId, skillLevel) =>
  request("add_division", { clubId, tournamentId, skillLevel });
export const addTournamentCourt = (clubId, tournamentId, name) =>
  request("add_court", { clubId, tournamentId, name });
export const deleteTournamentCourt = (clubId, tournamentId, courtId) =>
  request("delete_court", { clubId, tournamentId, courtId });
export const addTournamentTeam = (clubId, payload) =>
  request("add_team", { clubId, ...payload });
export const deleteTournamentTeam = (clubId, payload) =>
  request("delete_team", { clubId, ...payload });
export const generateTournamentQualification = (clubId, payload) =>
  request("generate_qualification", { clubId, ...payload });
export const generateTournamentTestTeams = (clubId, payload) =>
  request("generate_test_teams", { clubId, ...payload });
export const updateTournamentMatch = (clubId, payload) =>
  request("update_match", { clubId, ...payload });
export const shiftTournamentCourtMatches = (clubId, payload) =>
  request("shift_court_matches", { clubId, ...payload });
export const saveTournamentResult = (clubId, payload) =>
  request("save_result", { clubId, ...payload });
export const confirmTournamentSplit = (clubId, payload) =>
  request("confirm_split", { clubId, ...payload });
export const loadPublicTournament = (publicId) =>
  request("public_tournament", { publicId }, { publicRequest: true });

export function buildTournamentPublicUrl(publicId) {
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`;
  return `${base}?app=tournament-live&id=${encodeURIComponent(publicId)}`;
}
