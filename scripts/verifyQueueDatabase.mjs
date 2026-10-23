// Run with PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js
// node scripts/verifyQueueDatabase.mjs. The engine is installed outside the repo.
// Everything runs in an isolated in-memory Postgres database, never production.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { proposeFallbackQueueMatch, proposeQueueMatch } from "../src/queueLogic.js";

process.on("uncaughtException", (error) => {
  console.error(error.message, error.where || "", error.internalQuery || "");
  process.exitCode = 1;
});

if (!process.env.PGLITE_MODULE) throw new Error("Set PGLITE_MODULE to a temporary installation of @electric-sql/pglite");
const { PGlite } = await import(process.env.PGLITE_MODULE);
const db = new PGlite();
const repo = fileURLToPath(new URL("../", import.meta.url));
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema storage;
  create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select coalesce(current_setting('request.jwt.claim.role', true), 'authenticated') $$;
  create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id uuid primary key, bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
  -- Unrelated tournament defaults need pgcrypto's signature; the tests never
  -- exercise cryptography. Core UUID bytes suffice for this local-only stub.
  create function public.gen_random_bytes(integer) returns bytea language sql volatile as $$ select decode(substr(repeat(replace(gen_random_uuid()::text, '-', ''), ($1+15)/16), 1, $1*2), 'hex') $$;
`);
for (const filename of (await readdir(`${repo}supabase/migrations`)).filter((file) => file.endsWith(".sql")).sort()) {
  const sql = (await readFile(`${repo}supabase/migrations/${filename}`, "utf8"))
    .replace("create extension if not exists pgcrypto;", "-- gen_random_uuid is built into this PostgreSQL engine");
  try { await db.exec(sql); } catch (error) { throw new Error(`Migration ${filename}: ${error.message} (position ${error.position || error.internalPosition || "unknown"})`); }
}

const owner = "10000000-0000-0000-0000-000000000001";
const club = "20000000-0000-0000-0000-000000000001";
const event = "30000000-0000-0000-0000-000000000001";
const closedEvent = "30000000-0000-0000-0000-000000000002";
const ids = Array.from({ length: 32 }, (_, i) => `40000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`);
const literalIds = (values) => `array[${values.map((id) => `'${id}'`).join(",")}]::uuid[]`;
const value = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.value;
await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
await db.exec(`
  insert into auth.users(id) values('${owner}');
  insert into public.clubs(id, name, owner_id, is_test) values('${club}', 'Database Test', '${owner}', true);
  insert into public.events(id, club_id, title, event_date, starts_at, ends_at, status, created_by)
    values('${event}', '${club}', 'Open', (now() at time zone 'Asia/Bangkok')::date, '18:00', '23:59', 'open', '${owner}'),
      ('${closedEvent}', '${club}', 'History', '2026-10-23', '18:00', '23:59', 'closed', '${owner}');
`);
for (const [index, id] of ids.entries()) {
  await db.query("insert into public.club_members(id,club_id,display_name,nickname,skill_level) values($1,$2,$3,$3,'BG')", [id, club, `Player ${index + 1}`]);
  await db.query("insert into public.signups(club_id,event_id,member_id,status,skill_level_snapshot,arrival_time) values($1,$2,$3,'coming','BG','18:00'),($1,$4,$3,'coming','BG','18:00')", [club, event, id, closedEvent]);
  await db.query("insert into public.attendance(club_id,event_id,member_id,arrived,arrived_at) values($1,$2,$3,true,'18:00')", [club, event, id]);
  await db.query("update public.event_queue_players set queued_at = '2026-10-24T11:00:00Z'::timestamptz + $1 * interval '1 minute' where event_id=$2 and member_id=$3", [index, event, id]);
}
let passed = 0;
async function check(name, fn) {
  await db.exec("begin");
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  finally { await db.exec("rollback"); }
}
const createManual = (players) => value(`select public.create_manual_queue_with_players('${event}',${literalIds(players)},${literalIds(players.slice(0, 2))}) as value`);
const revision = (match) => value("select revision as value from public.queue_matches where id=$1", [match]);
const slots = (players) => players.map((member_id, i) => ({ member_id, team: i < 2 ? "A" : "B", position: i % 2 + 1 }));
const save = (match, players, version, approve = false) => value("select public.save_queue_lineup($1,$2::jsonb,$3,$4) as value", [match, JSON.stringify(slots(players)), version, approve]);
async function makePlaying(match, players) {
  const court = await value("insert into public.event_courts(club_id,event_id,court_name,starts_at,ends_at,position) values($1,$2,'Court 1','00:00','23:59',0) returning id as value", [club,event]);
  await db.query("update public.queue_matches set status='playing',court_id=$1,queue_position=null,started_at=now()-interval '15 minutes' where id=$2", [court,match]);
  await db.query("update public.event_queue_players set status='playing' where event_id=$1 and member_id=any($2::uuid[])", [event,players]);
}

await check("manual queue creates exactly four players and allows mixed skills", async () => {
  await db.query("update public.signups set skill_level_snapshot='P' where event_id=$1 and member_id=$2", [event, ids[0]]);
  const match = await createManual(ids.slice(0, 4));
  assert.equal(await value("select count(*)::int as value from public.queue_match_players where match_id=$1", [match]), 4);
  assert.ok(Number(await revision(match)) > 1);
});
await check("more than four queues can be created and batch-approved atomically", async () => {
  const drafts = [];
  for (let i = 0; i < 24; i += 4) { const match = await createManual(ids.slice(i, i + 4)); drafts.push({ match_id: match, revision: await revision(match) }); }
  assert.equal(await value("select public.approve_queue_drafts($1::jsonb) as value", [JSON.stringify(drafts)]), 6);
  assert.equal(await value("select count(*)::int as value from public.queue_matches where status='approved'"), 6);
});
await check("a stale edit is rejected without overwriting a newer lineup", async () => {
  const match = await createManual(ids.slice(0, 4)); const oldVersion = await revision(match);
  await save(match, ids.slice(4, 8), oldVersion);
  await db.exec("savepoint stale");
  await assert.rejects(save(match, ids.slice(8, 12), oldVersion), /เครื่องอื่น/);
  await db.exec("rollback to stale");
  assert.deepEqual((await db.query("select member_id from public.queue_match_players where match_id=$1 order by member_id", [match])).rows.map((r) => r.member_id), ids.slice(4, 8));
});
await check("batch approval rolls back all approvals when one revision is stale", async () => {
  const a = await createManual(ids.slice(0, 4)); const b = await createManual(ids.slice(4, 8));
  const request = [{ match_id: a, revision: await revision(a) }, { match_id: b, revision: 0 }];
  await db.exec("savepoint bad_batch");
  await assert.rejects(value("select public.approve_queue_drafts($1::jsonb) as value", [JSON.stringify(request)]), /เครื่องอื่น/);
  await db.exec("rollback to bad_batch");
  assert.equal(await value("select count(*)::int as value from public.queue_matches where status='approved'"), 0);
});
await check("automatic queue always starts with oldest eligible players", async () => {
  assert.deepEqual(await value("select public.next_automatic_queue_members($1) as value", [event]), ids.slice(0, 4));
  await value(`select public.create_queue_draft('${event}', ${literalIds(ids.slice(0, 4))}, ${literalIds(ids.slice(0, 2))}) as value`);
  assert.deepEqual(await value("select public.next_automatic_queue_members($1) as value", [event]), ids.slice(4, 8));
});
await check("automatic fallback includes oldest anchor and expands only upwards", async () => {
  await db.query("update public.signups set skill_level_snapshot='Rookie-' where event_id=$1", [event]);
  for (const [i, level] of [[0,"N"],[1,"BG"],[2,"S"],[3,"P"],[4,"P"]]) await db.query("update public.signups set skill_level_snapshot=$1 where event_id=$2 and member_id=$3", [level, event, ids[i]]);
  assert.deepEqual(await value("select public.next_automatic_queue_members($1) as value", [event]), ids.slice(0, 4));
  const match = await value(`select public.create_fallback_queue_draft('${event}', ${literalIds(ids.slice(0,4))}, ${literalIds(ids.slice(0,2))}) as value`);
  assert.equal(await value("select manual_override as value from public.queue_matches where id=$1", [match]), true);
});
await check("automatic queue does not skip an unfillable oldest player", async () => {
  await db.query("update public.signups set skill_level_snapshot='Rookie-' where event_id=$1", [event]);
  await db.query("update public.signups set skill_level_snapshot='P' where event_id=$1 and member_id=$2", [event, ids[0]]);
  assert.deepEqual(await value("select public.next_automatic_queue_members($1) as value", [event]), []);
});
await check("automatic SQL and browser planners agree across 120 randomized skill/wait scenarios", async () => {
  let seed = 20261024;
  const random = (max) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let iteration = 0; iteration < 120; iteration++) {
    const players = ids.map((memberId) => ({ memberId, skillLevel: ["Rookie-","Rookie","BG","N","S","P"][random(6)],
      status: "waiting", gamesPlayed: random(8), minutesPlayed: random(100), queuedAt: new Date(Date.UTC(2026,9,24,11,random(10))).toISOString(), skipUntilSequence: random(4) === 0 ? 2 : 0 }));
    await db.query(`update public.signups s set skill_level_snapshot=p."skillLevel" from jsonb_to_recordset($1::jsonb) p("memberId" uuid,"skillLevel" text) where s.member_id=p."memberId" and s.event_id=$2`, [JSON.stringify(players), event]);
    await db.query(`update public.event_queue_players q set queued_at=p."queuedAt",games_played=p."gamesPlayed",minutes_played=p."minutesPlayed",skip_until_sequence=p."skipUntilSequence" from jsonb_to_recordset($1::jsonb) p("memberId" uuid,"queuedAt" timestamptz,"gamesPlayed" integer,"minutesPlayed" integer,"skipUntilSequence" integer) where q.member_id=p."memberId" and q.event_id=$2`, [JSON.stringify(players), event]);
    const proposal = proposeQueueMatch(players, [], 1) || proposeFallbackQueueMatch(players, [], 1);
    assert.deepEqual(await value("select public.next_automatic_queue_members($1) as value", [event]), proposal?.lineup.map((p) => p.memberId) || [], `scenario ${iteration}`);
  }
});
await check("manual duplicate reservation rejects whole creation without empty draft", async () => {
  await createManual(ids.slice(0,4)); await db.exec("savepoint duplicate");
  await assert.rejects(createManual([ids[0], ...ids.slice(4,7)]), /คิวล่วงหน้า/);
  await db.exec("rollback to duplicate");
  assert.equal(await value("select count(*)::int as value from public.queue_matches"), 1);
});
await check("returning a playing match still works with six future queues", async () => {
  const match = await createManual(ids.slice(0,4)); await makePlaying(match, ids.slice(0,4));
  for (let i=4;i<28;i+=4) await createManual(ids.slice(i,i+4));
  await value("select public.return_playing_queue_to_head($1) as value", [match]);
  assert.equal(await value("select count(*)::int as value from public.queue_matches where status in ('draft','approved')"), 7);
  assert.equal(await value("select queue_position as value from public.queue_matches where id=$1", [match]), 1);
});
await check("closing a round still finishes playing games and cancels drafts atomically", async () => {
  const match = await createManual(ids.slice(0,4)); await makePlaying(match, ids.slice(0,4)); await createManual(ids.slice(4,8));
  await db.query("update public.events set status='closed' where id=$1", [event]);
  assert.equal(await value("select status as value from public.queue_matches where id=$1", [match]), 'completed');
  assert.equal(await value("select count(*)::int as value from public.queue_matches where status in ('draft','approved','playing')"), 0);
});
await check("profile updates persist master and active signup while history stays unchanged", async () => {
  const match = await createManual(ids.slice(0,4));
  await value("select public.approve_queue_draft($1) as value", [match]);
  await value("select public.operator_update_member_profile($1,$2::jsonb) as value", [ids[0], JSON.stringify({ nickname:"New Name", skill_level:"N", playable_skill_levels:["BG","N","S"] })]);
  assert.equal(await value("select skill_level as value from public.club_members where id=$1", [ids[0]]), "N");
  assert.equal(await value("select nickname as value from public.club_members where id=$1", [ids[0]]), "New Name");
  assert.equal(await value("select skill_level_snapshot as value from public.signups where event_id=$1 and member_id=$2", [event,ids[0]]), "N");
  assert.equal(await value("select skill_level_snapshot as value from public.signups where event_id=$1 and member_id=$2", [closedEvent,ids[0]]), "BG");
  assert.equal(await value("select skill_level_snapshot as value from public.queue_match_players where match_id=$1 and member_id=$2", [match,ids[0]]), "BG");
  const draft = await createManual(ids.slice(4,8)); const priorRevision = await revision(draft);
  await value("select public.operator_update_member_profile($1,$2::jsonb) as value", [ids[4], JSON.stringify({skill_level:"N"})]);
  assert.equal(await value("select skill_level_snapshot as value from public.queue_match_players where match_id=$1 and member_id=$2", [draft,ids[4]]), "N");
  assert.ok(Number(await revision(draft)) > Number(priorRevision));
});
await check("an already approved automatic queue starts after a permanent skill correction", async () => {
  const match = await value(`select public.create_queue_draft('${event}', ${literalIds(ids.slice(0,4))}, ${literalIds(ids.slice(0,2))}) as value`);
  await value("select public.approve_queue_draft($1) as value", [match]);
  await value("select public.operator_update_member_profile($1,$2::jsonb) as value", [ids[0],JSON.stringify({skill_level:'P'})]);
  const court = await value("insert into public.event_courts(club_id,event_id,court_name,starts_at,ends_at,position) values($1,$2,'Court 1','00:00','23:59',0) returning id as value", [club,event]);
  assert.equal(await value("select public.start_next_queue_on_court($1,$2) as value", [event,court]),match);
  assert.equal(await value("select skill_level_snapshot as value from public.queue_match_players where match_id=$1 and member_id=$2", [match,ids[0]]),'BG');
});
await check("atomic finish preserves bills confirmed after stale client calculation and hides exempt bills", async () => {
  await db.query(`insert into public.payments(club_id,event_id,member_id,amount,paid_at,admin_confirmed_at,payment_status,paid_source,transferred_amount,recorded_by)
    values($1,$2,$3,111,now(),now(),'paid','slip_auto',120,$5),($1,$2,$4,222,null,now(),'awaiting',null,null,$5)`, [club,event,ids[0],ids[1],owner]);
  await db.query("update public.club_members set payment_exempt=true where id=$1",[ids[2]]);
  await db.query("update public.attendance set arrived=false where event_id=$1 and member_id=$2",[event,ids[4]]);
  const rows=ids.slice(0,5).map((member_id,i)=>({member_id,amount:10*(i+1),shared_amount:8*(i+1),extras_amount:2*(i+1)}));
  const result=await value("select public.finish_event($1,$2::jsonb,5) as value",[event,JSON.stringify(rows)]);
  assert.equal(result.saved_count,2);
  const bills=(await db.query("select member_id,amount,paid_at,admin_confirmed_at,payment_status,paid_source,transferred_amount from public.payments where event_id=$1 order by member_id",[event])).rows;
  assert.equal(Number(bills[0].amount),111); assert.equal(Number(bills[0].transferred_amount),120); assert.ok(bills[0].paid_at);
  assert.equal(Number(bills[1].amount),222); assert.ok(bills[1].admin_confirmed_at); assert.equal(bills[1].payment_status,'awaiting');
  assert.equal(Number(bills[2].amount),30); assert.equal(bills[2].paid_source,'exempt'); assert.equal(bills[2].payment_status,'paid'); assert.ok(bills[2].admin_confirmed_at);
  assert.equal(Number(bills[3].amount),40); assert.equal(bills[3].admin_confirmed_at,null); assert.equal(bills[3].payment_status,'draft');
  assert.equal(bills.length,4); assert.equal(await value("select status as value from public.events where id=$1",[event]),'closed');
  assert.equal((await value("select public.finish_event($1,$2::jsonb,5) as value",[event,JSON.stringify(rows)])).already_closed,true);
});
await check("atomic finish rolls every bill back when the final close is rejected", async () => {
  await db.exec(`create function pg_temp.reject_close() returns trigger language plpgsql as $$ begin if new.status='closed' then raise exception 'test close rejected'; end if; return new; end; $$;
    create trigger test_reject_close before update of status on public.events for each row execute function pg_temp.reject_close();`);
  await db.exec("savepoint rejected_close");
  await assert.rejects(value("select public.finish_event($1,$2::jsonb,1) as value",[event,JSON.stringify([{member_id:ids[0],amount:50,shared_amount:40,extras_amount:10}])]),/test close rejected/);
  await db.exec("rollback to rejected_close");
  assert.equal(await value("select count(*)::int as value from public.payments where event_id=$1",[event]),0);
  assert.equal(await value("select status as value from public.events where id=$1",[event]),'open');
});
await check("per-round close refuses a game that started after the frontend loaded", async () => {
  await db.query("update public.events set billing_model='per_round' where id=$1",[event]);
  const match=await createManual(ids.slice(0,4)); await makePlaying(match,ids.slice(0,4));
  await db.exec("savepoint active_game");
  await assert.rejects(value("select public.finish_event($1,$2::jsonb,1) as value",[event,JSON.stringify([{member_id:ids[0],amount:50,shared_amount:40,extras_amount:10}])]),/กำลังเล่น/);
  await db.exec("rollback to active_game");
  assert.equal(await value("select count(*)::int as value from public.payments where event_id=$1",[event]),0);
});
await check("non-key locks preserve FK compatibility and profile locks parents before child revisions", async () => {
  // PGlite has a single session: these assertions guard the reviewed lock graph,
  // not a claim that this harness reproduces PostgreSQL multi-session waits.
  const source = (signature) => value("select pg_get_functiondef($1::regprocedure) as value", [signature]);
  const profile = await source("public.operator_update_member_profile(uuid,jsonb)");
  assert.match(profile, /club_members where id = target_member_id for no key update/);
  assert.ok(profile.indexOf("pg_advisory_xact_lock") < profile.indexOf("update public.signups s set"));
  assert.match(profile, /order by e.id/);
  assert.ok(profile.indexOf("order by m.id for update of m") < profile.indexOf("update public.queue_match_players p set"));
  assert.match(profile, /where p.match_id = any\(draft_ids\)/);
  const finish = await source("public.finish_event(uuid,jsonb,integer)");
  assert.match(finish, /events where id = target_event_id for no key update/);
  const departure = await source("public.snapshot_per_round_departure(uuid,uuid,time,integer)");
  assert.match(departure, /where id = target_event_id\s+for no key update/);
  assert.doesNotMatch(await source("public.sync_attendance_queue_player()"), /pg_advisory_xact_lock/);
});
await check("departure snapshot still bills and removes a future queue slot after lock upgrade", async () => {
  await db.query("update public.events set billing_model='per_round' where id=$1", [event]);
  const match = await createManual(ids.slice(0,4));
  const result = await value("select public.snapshot_per_round_departure($1,$2,'20:00'::time,2) as value", [event,ids[0]]);
  assert.ok(result.snapshotId);
  assert.equal(result.shuttlecockCount,2);
  assert.equal(await value("select count(*)::int as value from public.queue_match_players where match_id=$1", [match]),3);
  assert.equal(await value("select left_at::text as value from public.attendance where event_id=$1 and member_id=$2", [event,ids[0]]),'20:00:00');
  assert.ok(await value("select billed_at as value from public.payments where event_id=$1 and member_id=$2", [event,ids[0]]));
});
await check("coherent queue and finance reads include dependent data", async () => {
  const state = await value("select public.load_queue_state($1) as value", [event]);
  for (const key of ["members","courts","signups","attendance","queuePlayers","queueMatches","queueMatchPlayers"]) assert.ok(Array.isArray(state[key]), key);
  assert.equal(state.signups.length, 32); assert.equal(state.event.id,event);
  assert.ok(Array.isArray((await value("select public.load_finance_state($1,$2) as value", [club,event])).paymentSlips));
  assert.equal((await value("select public.load_event_control_state($1,$2) as value", [club,event])).event.id,event);
});
await check("unauthorized clients cannot read or mutate another club", async () => {
  await db.query("select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-999999999999', true)");
  await db.exec("savepoint denied"); await assert.rejects(value("select public.load_queue_state($1) as value", [event]), /สิทธิ์/); await db.exec("rollback to denied");
  await assert.rejects(createManual(ids.slice(0,4)), /สิทธิ์/);
});
await check("staff live state does not expose billing fields or LINE identifiers", async () => {
  const staff = '10000000-0000-0000-0000-000000000002';
  await db.query("insert into auth.users(id) values($1)", [staff]);
  await db.query("insert into public.club_members(club_id,profile_id,display_name,role) values($1,$2,'Staff','staff')", [club,staff]);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [staff]);
  const state = await value("select public.load_queue_state($1) as value", [event]);
  assert.equal('court_hourly_rate' in state.event,false);
  assert.equal(state.members.some((m) => 'payment_exempt' in m || 'line_user_id' in m || m.role !== 'member'),false);
  await db.exec("savepoint staff_finance");
  await assert.rejects(value("select public.load_finance_state($1,$2) as value", [club,event]), /สิทธิ์/);
  await db.exec("rollback to staff_finance");
  await value("select public.operator_update_member_profile($1,$2::jsonb) as value", [ids[0],JSON.stringify({nickname:'Staff edit',skill_level:'N'})]);
  assert.equal(await value("select skill_level as value from public.club_members where id=$1", [ids[0]]),'N');
});
await check("public/anon cannot call new privileged RPCs", async () => {
  for (const signature of ["load_queue_state(uuid)","save_queue_lineup(uuid,jsonb,bigint,boolean)","approve_queue_drafts(jsonb)","operator_update_member_profile(uuid,jsonb)","create_manual_queue_with_players(uuid,uuid[],uuid[])","finish_event(uuid,jsonb,integer)"]) {
    assert.equal(await value("select has_function_privilege('anon',$1,'execute') as value", [`public.${signature}`]), false);
    assert.equal(await value("select has_function_privilege('authenticated',$1,'execute') as value", [`public.${signature}`]), true);
  }
});
console.log(`Database behavioral checks: ${passed} passed`);
await db.close();
