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
const safetyMigrations = [];
for (const filename of (await readdir(`${repo}supabase/migrations`)).filter((file) => file.endsWith(".sql")).sort()) {
  const sql = (await readFile(`${repo}supabase/migrations/${filename}`, "utf8"))
    .replace("create extension if not exists pgcrypto;", "-- gen_random_uuid is built into this PostgreSQL engine");
  // Apply the current safety migration to populated fixtures, not just an empty
  // schema, and prove that every existing row survives byte-for-byte below.
  if (filename >= "20261024102852_zero_billing_and_safe_member_archive.sql") { safetyMigrations.push(sql); continue; }
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
assert.ok(safetyMigrations.length, "the zero billing/archive safety migration is present");
const historicalBill = await value("insert into public.payments(club_id,event_id,member_id,amount,recorded_by,paid_at,payment_status,shared_amount,extras_amount) values($1,$2,$3,77,$4,now(),'paid',67,10) returning id as value",[club,closedEvent,ids[0],owner]);
const protectedTables = ['clubs','events','club_members','signups','attendance','event_queue_players','queue_matches','queue_match_players','payments'];
const beforeMigration = [];
for(const table of protectedTables) beforeMigration.push(await value(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) as value from public.${table} t`));
for (const migration of safetyMigrations) await db.exec(migration);
for(const [index,table] of protectedTables.entries()) {
  const after = await value(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) as value from public.${table} t`);
  // New nullable metadata columns are allowed; all previously stored fields,
  // row identities and counts must remain unchanged by every migration.
  assert.equal(after.length,beforeMigration[index].length,`${table} row count unchanged`);
  for(const [rowIndex,before] of beforeMigration[index].entries()) {
    for(const [key,field] of Object.entries(before)) assert.deepEqual(after[rowIndex][key],field,`${table}.${key} unchanged`);
  }
}
await db.query("delete from public.payments where id=$1",[historicalBill]);
console.log("PASS safety migration preserves every populated fixture row and paid bill exactly");
let passed = 1;
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
await check("test preparation preserves open queues and booking times without resetting history", async () => {
  const match = await createManual(ids.slice(0,4));
  const before = await value("select to_jsonb(e) as value from public.events e where id=$1",[event]);
  assert.equal(await value("select public.prepare_test_round($1) as value",[club]),event);
  assert.equal(await value("select public.prepare_test_round($1) as value",[club]),event);
  const after = await value("select to_jsonb(e) as value from public.events e where id=$1",[event]);
  assert.equal(after.event_date,before.event_date); assert.equal(after.starts_at,before.starts_at); assert.equal(after.ends_at,before.ends_at);
  assert.equal(await value("select status as value from public.queue_matches where id=$1",[match]),'draft');
  assert.equal(await value("select count(*)::int as value from public.event_courts where event_id=$1",[event]),2);
  assert.equal(await value("select count(*)::int as value from public.queue_match_players where match_id=$1",[match]),4);
  assert.equal(await value("select status as value from public.events where id=$1",[closedEvent]),'closed');
});
await check("test preparation opens a draft and creates a new round only after the previous one closes", async () => {
  await db.query("update public.events set status='draft' where id=$1",[event]);
  assert.equal(await value("select public.prepare_test_round($1) as value",[club]),event);
  assert.equal(await value("select status as value from public.events where id=$1",[event]),'open');
  await db.query("update public.events set status='closed' where id=$1",[event]);
  const next = await value("select public.prepare_test_round($1) as value",[club]);
  assert.notEqual(next,event); assert.notEqual(next,closedEvent);
  assert.equal(await value("select status as value from public.events where id=$1",[next]),'open');
  assert.equal(await value("select count(*)::int as value from public.event_courts where event_id=$1",[next]),2);
  assert.equal(await value("select count(*)::int as value from public.events where club_id=$1",[club]),3);
});
await check("random sample creation commits complete profiles, signups and check-ins atomically", async () => {
  const profiles=Array.from({length:40},()=>({skill_level:'BG',playable_skill_levels:['Rookie','BG','N']}));
  assert.equal(await value("select public.add_random_test_players($1,$2,$3::jsonb) as value",[club,event,JSON.stringify(profiles)]),40);
  assert.equal(await value("select count(*)::int as value from public.signups where event_id=$1",[event]),72);
  assert.equal(await value("select count(*)::int as value from public.attendance where event_id=$1 and arrived and left_at is null",[event]),72);
  assert.equal(await value("select count(*)::int as value from public.event_queue_players where event_id=$1 and status='waiting'",[event]),72);
  const memberCount=await value("select count(*)::int as value from public.club_members where club_id=$1",[club]);
  await db.exec("savepoint invalid_random");
  await assert.rejects(value("select public.add_random_test_players($1,$2,$3::jsonb) as value",[club,event,JSON.stringify([profiles[0],{skill_level:'bogus',playable_skill_levels:[]}])]),/ระดับมือ/);
  await db.exec("rollback to invalid_random");
  assert.equal(await value("select count(*)::int as value from public.club_members where club_id=$1",[club]),memberCount);
});
await check("manual save approves in one transaction and approval failure leaves no queue", async () => {
  const match=await value(`select public.create_manual_queue('${event}',${literalIds(ids.slice(0,4))},${literalIds(ids.slice(0,2))}) as value`);
  assert.equal(await value("select status as value from public.queue_matches where id=$1",[match]),'approved');
  assert.equal(await value("select count(*)::int as value from public.event_queue_players where event_id=$1 and status='reserved'",[event]),4);
  await db.exec(`create function pg_temp.reject_approve() returns trigger language plpgsql as $$ begin if new.status='approved' then raise exception 'test approve rejected'; end if; return new; end; $$;
    create trigger test_reject_approve before update of status on public.queue_matches for each row execute function pg_temp.reject_approve();`);
  await db.exec("savepoint rejected_manual");
  await assert.rejects(value(`select public.create_manual_queue('${event}',${literalIds(ids.slice(4,8))},${literalIds(ids.slice(4,6))}) as value`),/test approve rejected/);
  await db.exec("rollback to rejected_manual");
  assert.equal(await value("select count(*)::int as value from public.queue_matches where event_id=$1",[event]),1);
});
await check("automatic single and full-batch creation return ready queues without changing FIFO or active games", async () => {
  const active=await createManual(ids.slice(28,32)); await makePlaying(active,ids.slice(28,32));
  const first=await value(`select public.create_automatic_queue('${event}',${literalIds(ids.slice(0,4))},${literalIds(ids.slice(0,2))}) as value`);
  assert.equal(await value("select status as value from public.queue_matches where id=$1",[first]),'approved');
  const lineups=[4,8,12,16,20,24].map((i)=>({member_ids:ids.slice(i,i+4),team_a_member_ids:ids.slice(i,i+2),fallback:false}));
  const generated=await value("select public.create_automatic_queues($1,$2::jsonb) as value",[event,JSON.stringify(lineups)]);
  assert.equal(generated.length,6);
  assert.equal(await value("select count(*)::int as value from public.queue_matches where event_id=$1 and status='approved'",[event]),7);
  assert.equal(await value("select count(*)::int as value from public.queue_matches where event_id=$1 and status='draft'",[event]),0);
  assert.equal(await value("select status as value from public.queue_matches where id=$1",[active]),'playing');
  assert.equal(await value("select count(*)::int as value from public.event_queue_players where event_id=$1 and status='playing'",[event]),4);
});
await check("automatic batch approval failure rolls back every newly created queue and reservation", async () => {
  await db.exec(`create function pg_temp.reject_second_auto() returns trigger language plpgsql as $$ begin if new.status='approved' and new.sequence=2 then raise exception 'test second approval rejected'; end if; return new; end; $$;
    create trigger test_reject_second_auto before update of status on public.queue_matches for each row execute function pg_temp.reject_second_auto();`);
  const lineups=[0,4].map((i)=>({member_ids:ids.slice(i,i+4),team_a_member_ids:ids.slice(i,i+2),fallback:false}));
  await db.exec("savepoint rejected_auto_batch");
  await assert.rejects(value("select public.create_automatic_queues($1,$2::jsonb) as value",[event,JSON.stringify(lineups)]),/test second approval rejected/);
  await db.exec("rollback to rejected_auto_batch");
  assert.equal(await value("select count(*)::int as value from public.queue_matches where event_id=$1",[event]),0);
  assert.equal(await value("select count(*)::int as value from public.event_queue_players where event_id=$1 and status='reserved'",[event]),0);
});
await check("automatic batch rejects repeated players without leaving partial queues", async () => {
  const lineup={member_ids:ids.slice(0,4),team_a_member_ids:ids.slice(0,2),fallback:false};
  await db.exec("savepoint duplicate_auto_batch");
  await assert.rejects(value("select public.create_automatic_queues($1,$2::jsonb) as value",[event,JSON.stringify([lineup,lineup])]),/เปลี่ยนแล้ว/);
  await db.exec("rollback to duplicate_auto_batch");
  assert.equal(await value("select count(*)::int as value from public.queue_matches where event_id=$1",[event]),0);
});
await check("automatic higher-level fallback is approved immediately while keeping the oldest player", async () => {
  await db.query("update public.signups set skill_level_snapshot='Rookie-' where event_id=$1",[event]);
  for(const [i,level] of [[0,'N'],[1,'BG'],[2,'S'],[3,'P']]) await db.query("update public.signups set skill_level_snapshot=$1 where event_id=$2 and member_id=$3",[level,event,ids[i]]);
  const match=await value(`select public.create_automatic_queue('${event}',${literalIds(ids.slice(0,4))},${literalIds(ids.slice(0,2))}) as value`);
  assert.equal(await value("select status as value from public.queue_matches where id=$1",[match]),'approved');
  assert.equal(await value("select manual_override as value from public.queue_matches where id=$1",[match]),true);
  assert.equal(await value("select count(*)::int as value from public.queue_match_players where match_id=$1 and member_id=$2",[match,ids[0]]),1);
});
await check("bulk cancellation preserves playing games and releases only selected upcoming queues", async () => {
  const a=await createManual(ids.slice(0,4)); const b=await createManual(ids.slice(4,8)); const c=await createManual(ids.slice(8,12));
  const unselected=await createManual(ids.slice(12,16));
  await value("select public.approve_queue_draft($1) as value",[a]); await makePlaying(a,ids.slice(0,4));
  await value("select public.approve_queue_draft($1) as value",[b]);
  const request=[{match_id:b,revision:await revision(b)},{match_id:c,revision:await revision(c)}];
  assert.equal(await value("select public.cancel_upcoming_queues($1,$2::jsonb) as value",[event,JSON.stringify(request)]),2);
  assert.equal(await value("select status as value from public.queue_matches where id=$1",[a]),'playing');
  assert.equal(await value("select queue_position as value from public.queue_matches where id=$1",[unselected]),1);
  assert.equal(await value("select status as value from public.queue_matches where id=$1",[unselected]),'draft');
  assert.equal(await value("select count(*)::int as value from public.queue_matches where status='cancelled'",[]),2);
  assert.equal(await value("select count(*)::int as value from public.event_queue_players where event_id=$1 and member_id=any($2::uuid[]) and status='waiting'",[event,ids.slice(4,12)]),8);
});
await check("bulk cancellation rejects stale revisions or playing entries and rolls back all", async () => {
  const a=await createManual(ids.slice(0,4)); const b=await createManual(ids.slice(4,8));
  const request=[{match_id:a,revision:await revision(a)},{match_id:b,revision:0}];
  await db.exec("savepoint stale_cancel");
  await assert.rejects(value("select public.cancel_upcoming_queues($1,$2::jsonb) as value",[event,JSON.stringify(request)]),/เครื่องอื่น/);
  await db.exec("rollback to stale_cancel");
  assert.equal(await value("select count(*)::int as value from public.queue_matches where status='draft'"),2);
  await makePlaying(b,ids.slice(4,8)); request[1].revision=await revision(b);
  await db.exec("savepoint playing_cancel");
  await assert.rejects(value("select public.cancel_upcoming_queues($1,$2::jsonb) as value",[event,JSON.stringify(request)]),/เครื่องอื่น/);
  await db.exec("rollback to playing_cancel");
  assert.equal(await value("select status as value from public.queue_matches where id=$1",[a]),'draft');
  assert.equal(await value("select status as value from public.queue_matches where id=$1",[b]),'playing');
});
await check("test games start before booking or on old dates and finish at actual time", async () => {
  await db.query("update public.events set event_date=(now() at time zone 'Asia/Bangkok')::date+10 where id=$1",[event]);
  const court=await value("insert into public.event_courts(club_id,event_id,court_name,starts_at,ends_at) values($1,$2,'Future court','21:00','22:00') returning id as value",[club,event]);
  const match=await value(`select public.create_manual_queue('${event}',${literalIds(ids.slice(0,4))},${literalIds(ids.slice(0,2))}) as value`);
  assert.equal(await value("select public.start_next_queue_on_court($1,$2) as value",[event,court]),match);
  await db.query("update public.events set event_date='2000-01-01' where id=$1",[event]);
  await db.query("update public.queue_matches set started_at=now()-interval '15 minutes' where id=$1",[match]);
  assert.equal(await value("select public.finish_queue_match($1) as value",[match]),15);
  assert.equal(await value("select ended_at=now() as value from public.queue_matches where id=$1",[match]),true);
  const next=await value(`select public.create_manual_queue('${event}',${literalIds(ids.slice(4,8))},${literalIds(ids.slice(4,6))}) as value`);
  assert.equal(await value("select public.start_next_queue_on_court($1,$2) as value",[event,court]),next);
});
await check("test mode never auto-finishes a still playing member because an old booking expired", async () => {
  await db.query("update public.events set event_date='2000-01-01' where id=$1",[event]);
  const courts=(await db.query("insert into public.event_courts(club_id,event_id,court_name,starts_at,ends_at) values($1,$2,'Old 1','21:00','22:00'),($1,$2,'Old 2','21:00','22:00') returning id",[club,event])).rows;
  const match=await value(`select public.create_manual_queue('${event}',${literalIds(ids.slice(0,4))},${literalIds(ids.slice(0,2))}) as value`);
  await value("select public.start_next_queue_on_court($1,$2) as value",[event,courts[0].id]);
  await value(`select public.create_manual_queue('${event}',${literalIds(ids.slice(0,4))},${literalIds(ids.slice(0,2))}) as value`);
  await db.exec("savepoint still_playing");
  await assert.rejects(value("select public.start_next_queue_on_court($1,$2) as value",[event,courts[1].id]),/ยังเล่นอยู่/);
  await db.exec("rollback to still_playing");
  assert.equal(await value("select status as value from public.queue_matches where id=$1",[match]),'playing');
});
await check("real clubs cannot use sandbox RPCs or bypass future and expired court times", async () => {
  await db.query("update public.clubs set is_test=false where id=$1",[club]);
  for(const sql of ["select public.prepare_test_round($1) as value","select public.add_random_test_players($1,'"+event+"','[]'::jsonb) as value"]){
    await db.exec("savepoint real_denied"); await assert.rejects(value(sql,[club]),/โหมดทดลอง/); await db.exec("rollback to real_denied");
  }
  const court=await value("insert into public.event_courts(club_id,event_id,court_name,starts_at,ends_at) values($1,$2,'Real court','21:00','22:00') returning id as value",[club,event]);
  await value(`select public.create_manual_queue('${event}',${literalIds(ids.slice(0,4))},${literalIds(ids.slice(0,2))}) as value`);
  for(const [date,error] of [["2099-01-01",/ยังไม่ถึงเวลา/],["2000-01-01",/หมดเวลา/]]){
    await db.query("update public.events set event_date=$1 where id=$2",[date,event]);
    await db.exec("savepoint clock_denied"); await assert.rejects(value("select public.start_next_queue_on_court($1,$2) as value",[event,court]),error); await db.exec("rollback to clock_denied");
  }
});
await check("sandbox and bulk-action RPC grants exclude anonymous callers", async () => {
  for(const signature of ['prepare_test_round(uuid)','add_random_test_players(uuid,uuid,jsonb)','create_manual_queue(uuid,uuid[],uuid[])','create_automatic_queue(uuid,uuid[],uuid[])','create_automatic_queues(uuid,jsonb)','cancel_upcoming_queues(uuid,jsonb)']){
    assert.equal(await value("select has_function_privilege('anon',$1,'execute') as value",[`public.${signature}`]),false);
    assert.equal(await value("select has_function_privilege('authenticated',$1,'execute') as value",[`public.${signature}`]),true);
  }
});
const createApproved = (players) => value(`select public.create_manual_queue('${event}',${literalIds(players)},${literalIds(players.slice(0,2))}) as value`);
const moveQueue = (match, direction) => value("select public.move_upcoming_queue($1,$2) as value",[match,direction]);
const upcomingOrder = () => db.query("select id,queue_position,status,revision from public.queue_matches where event_id=$1 and status in ('draft','approved') order by queue_position",[event]).then((result)=>result.rows);
await check("reorder swaps two ready queues up and down without changing either lineup", async () => {
  const a=await createApproved(ids.slice(0,4)); const b=await createApproved(ids.slice(4,8));
  const rosterBefore=(await db.query("select match_id,member_id,team,position,skill_level_snapshot from public.queue_match_players where event_id=$1 order by match_id,team,position",[event])).rows;
  await moveQueue(b,-1);
  assert.deepEqual((await upcomingOrder()).map((row)=>row.id),[b,a]);
  await moveQueue(b,1);
  assert.deepEqual((await upcomingOrder()).map((row)=>row.id),[a,b]);
  assert.deepEqual((await upcomingOrder()).map((row)=>row.queue_position),[1,2]);
  assert.deepEqual((await db.query("select match_id,member_id,team,position,skill_level_snapshot from public.queue_match_players where event_id=$1 order by match_id,team,position",[event])).rows,rosterBefore);
  assert.equal(await value("select count(*)::int as value from public.event_queue_players where event_id=$1 and status='reserved'",[event]),8);
  assert.equal(await value("select count(*)::int as value from public.audit_logs where event_id=$1 and action='เลื่อนลำดับคิว'",[event]),2);
});
await check("reorder moves the middle of three ready queues one place and never touches a playing court", async () => {
  const playing=await createApproved(ids.slice(12,16)); await makePlaying(playing,ids.slice(12,16));
  const a=await createApproved(ids.slice(0,4)); const b=await createApproved(ids.slice(4,8)); const c=await createApproved(ids.slice(8,12));
  const activeBefore=await value("select to_jsonb(m) as value from public.queue_matches m where id=$1",[playing]);
  const activePlayersBefore=(await db.query("select * from public.event_queue_players where event_id=$1 and member_id=any($2::uuid[]) order by member_id",[event,ids.slice(12,16)])).rows;
  await moveQueue(b,-1); assert.deepEqual((await upcomingOrder()).map((row)=>row.id),[b,a,c]);
  await moveQueue(b,1); assert.deepEqual((await upcomingOrder()).map((row)=>row.id),[a,b,c]);
  await moveQueue(b,1); assert.deepEqual((await upcomingOrder()).map((row)=>row.id),[a,c,b]);
  await moveQueue(c,-1); assert.deepEqual((await upcomingOrder()).map((row)=>row.id),[c,a,b]);
  assert.deepEqual((await upcomingOrder()).map((row)=>row.queue_position),[1,2,3]);
  assert.deepEqual(await value("select to_jsonb(m) as value from public.queue_matches m where id=$1",[playing]),activeBefore);
  assert.deepEqual((await db.query("select * from public.event_queue_players where event_id=$1 and member_id=any($2::uuid[]) order by member_id",[event,ids.slice(12,16)])).rows,activePlayersBefore);
});
await check("reorder at first-up or last-down boundaries is an unchanged no-op", async () => {
  const a=await createApproved(ids.slice(0,4)); const b=await createApproved(ids.slice(4,8));
  const before=await upcomingOrder();
  await moveQueue(a,-1); await moveQueue(b,1);
  assert.deepEqual(await upcomingOrder(),before);
  assert.equal(await value("select count(*)::int as value from public.audit_logs where event_id=$1 and action='เลื่อนลำดับคิว'",[event]),0);
});
await check("a legacy draft between ready queues blocks crossing it; direct RPC stays unchanged", async () => {
  const a=await createApproved(ids.slice(0,4)); const draft=await createManual(ids.slice(4,8)); const b=await createApproved(ids.slice(8,12));
  const before=await upcomingOrder();
  await moveQueue(a,1); await moveQueue(b,-1);
  assert.deepEqual(await upcomingOrder(),before);
  await db.exec("savepoint move_draft"); await assert.rejects(moveQueue(draft,-1),/อนุมัติแล้ว/); await db.exec("rollback to move_draft");
  assert.deepEqual(await upcomingOrder(),before);
  assert.equal(await value("select count(*)::int as value from public.audit_logs where event_id=$1 and action='เลื่อนลำดับคิว'",[event]),0);
});
await check("reorder rejects playing targets, invalid direction and closed rounds without mutation", async () => {
  const playing=await createApproved(ids.slice(12,16)); await makePlaying(playing,ids.slice(12,16));
  const a=await createApproved(ids.slice(0,4)); const b=await createApproved(ids.slice(4,8));
  const before=await upcomingOrder();
  await db.exec("savepoint move_playing"); await assert.rejects(moveQueue(playing,-1),/อนุมัติแล้ว/); await db.exec("rollback to move_playing");
  await db.exec("savepoint invalid_direction"); await assert.rejects(moveQueue(a,0),/ทิศทาง/); await db.exec("rollback to invalid_direction");
  assert.deepEqual(await upcomingOrder(),before);
  await db.query("update public.events set status='closed' where id=$1",[event]);
  const closedBefore=(await db.query("select * from public.queue_matches where event_id=$1 order by id",[event])).rows;
  await db.exec("savepoint move_closed"); await assert.rejects(moveQueue(b,-1),/ปิดแล้ว/); await db.exec("rollback to move_closed");
  assert.deepEqual((await db.query("select * from public.queue_matches where event_id=$1 order by id",[event])).rows,closedBefore);
});
await check("reorder permits authorized staff but rejects outsiders and anonymous RPC access", async () => {
  const a=await createApproved(ids.slice(0,4)); const b=await createApproved(ids.slice(4,8));
  const before=await upcomingOrder();
  await db.query("select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-999999999999',true)");
  await db.exec("savepoint move_outsider"); await assert.rejects(moveQueue(b,-1),/สิทธิ์/); await db.exec("rollback to move_outsider");
  assert.deepEqual(await upcomingOrder(),before);
  const staff='10000000-0000-0000-0000-000000000003';
  await db.query("insert into auth.users(id) values($1)",[staff]);
  await db.query("insert into public.club_members(club_id,profile_id,display_name,role) values($1,$2,'Reorder test staff','staff')",[club,staff]);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[staff]);
  await moveQueue(b,-1); assert.deepEqual((await upcomingOrder()).map((row)=>row.id),[b,a]);
  assert.equal(await value("select has_function_privilege('anon','public.move_upcoming_queue(uuid,integer)','execute') as value"),false);
  assert.equal(await value("select has_function_privilege('authenticated','public.queue_move_legacy(uuid,integer)','execute') as value"),false);
});
await check("reorder audit failure rolls both swapped positions and revisions back", async () => {
  const a=await createApproved(ids.slice(0,4)); const b=await createApproved(ids.slice(4,8));
  const before=await upcomingOrder();
  await db.exec(`create function pg_temp.reject_reorder_audit() returns trigger language plpgsql as $$ begin if new.action='เลื่อนลำดับคิว' then raise exception 'test reorder audit rejected'; end if; return new; end; $$;
    create trigger test_reject_reorder_audit before insert on public.audit_logs for each row execute function pg_temp.reject_reorder_audit();`);
  await db.exec("savepoint reorder_audit"); await assert.rejects(moveQueue(b,-1),/test reorder audit rejected/); await db.exec("rollback to reorder_audit");
  assert.deepEqual(await upcomingOrder(),before);
});
await check("billing percentage accepts zero and previous values, rejects invalid values, and keeps the default", async () => {
  assert.equal(await value("select billing_percentage as value from public.attendance where event_id=$1 and member_id=$2",[event,ids[0]]),100);
  for (const percent of [0,25,50,75,100]) {
    await db.query("update public.attendance set billing_percentage=$1 where event_id=$2 and member_id=$3",[percent,event,ids[0]]);
    assert.equal(await value("select billing_percentage as value from public.attendance where event_id=$1 and member_id=$2",[event,ids[0]]),percent);
  }
  for (const percent of [-1,1,101]) {
    await db.exec("savepoint bad_percentage");
    await assert.rejects(db.query("update public.attendance set billing_percentage=$1 where event_id=$2 and member_id=$3",[percent,event,ids[0]]),/attendance_billing_percentage_check/);
    await db.exec("rollback to bad_percentage");
  }
});
await check("zero percentage invalidates unpaid confirmed bills but never rewrites paid history", async () => {
  for (const [index,paid] of [[0,false],[1,true]]) {
    await db.query("insert into public.payments(club_id,event_id,member_id,amount,recorded_by,admin_confirmed_at,paid_at,payment_status) values($1,$2,$3,95,$4,now(),case when $5 then now() end,case when $5 then 'paid' else 'awaiting' end)",[club,event,ids[index],owner,paid]);
    await db.query("update public.attendance set billing_percentage=0 where event_id=$1 and member_id=$2",[event,ids[index]]);
    const result=(await db.query("select amount,admin_confirmed_at,paid_at,payment_status from public.payments where event_id=$1 and member_id=$2",[event,ids[index]])).rows[0];
    assert.equal(Number(result.amount),paid?95:0); assert.equal(result.payment_status,paid?'paid':'draft');
    assert.equal(Boolean(result.admin_confirmed_at),paid); assert.equal(Boolean(result.paid_at),paid);
  }
});
await check("finish RPC persists zero shared costs and full personal extras without auto-marking paid", async () => {
  await db.query("update public.attendance set billing_percentage=0 where event_id=$1 and member_id=any($2::uuid[])",[event,ids.slice(0,2)]);
  await value("select public.finish_event($1,$2::jsonb,0) as value",[event,JSON.stringify([
    {member_id:ids[0],amount:15,shared_amount:0,extras_amount:15},
    {member_id:ids[1],amount:0,shared_amount:0,extras_amount:0},
  ])]);
  const rows=(await db.query("select member_id,amount,shared_amount,extras_amount,paid_at from public.payments where event_id=$1 order by member_id",[event])).rows;
  assert.deepEqual(rows.map((row)=>[row.member_id,Number(row.amount),Number(row.shared_amount),Number(row.extras_amount),row.paid_at]),[[ids[0],15,0,15,null],[ids[1],0,0,0,null]]);
});
const archive = (memberId) => value("select public.archive_club_member($1) as value",[memberId]);
async function removeLiveReferences(memberId) {
  await db.query("delete from public.attendance where event_id=$1 and member_id=$2",[event,memberId]);
  await db.query("delete from public.signups where event_id=$1 and member_id=$2",[event,memberId]);
  await db.query("delete from public.event_queue_players where event_id=$1 and member_id=$2",[event,memberId]);
}
await check("archive preserves closed-round signups, payments, extras and match rosters", async () => {
  await removeLiveReferences(ids[0]);
  await db.query("insert into public.payments(club_id,event_id,member_id,amount,recorded_by) values($1,$2,$3,95,$4)",[club,closedEvent,ids[0],owner]);
  await db.query("insert into public.member_extra_charges(club_id,event_id,member_id,item_name,unit_price,created_by) values($1,$2,$3,'Water',15,$4)",[club,closedEvent,ids[0],owner]);
  const match=await value("insert into public.queue_matches(club_id,event_id,sequence,status) values($1,$2,1,'completed') returning id as value",[club,closedEvent]);
  await db.query("insert into public.queue_match_players(club_id,event_id,match_id,member_id,team,position,skill_level_snapshot) values($1,$2,$3,$4,'A',1,'BG')",[club,closedEvent,match,ids[0]]);
  const before=[];
  for(const table of ['signups','payments','member_extra_charges','queue_match_players']) before.push(await value(`select jsonb_agg(to_jsonb(t) order by id) as value from public.${table} t where member_id=$1`,[ids[0]]));
  assert.equal(await archive(ids[0]),ids[0]); assert.equal(await archive(ids[0]),ids[0]);
  assert.equal(await value("select active as value from public.club_members where id=$1",[ids[0]]),false);
  for(const [index,table] of ['signups','payments','member_extra_charges','queue_match_players'].entries()) assert.deepEqual(await value(`select jsonb_agg(to_jsonb(t) order by id) as value from public.${table} t where member_id=$1`,[ids[0]]),before[index]);
  assert.equal(await value("select count(*)::int as value from public.audit_logs where details->>'member_id'=$1 and details->>'archived'='true'",[ids[0]]),1);
});
await check("archive blocks open and draft participants without changing live queues or members", async () => {
  const match=await createApproved(ids.slice(0,4));
  const before=await value("select to_jsonb(m) as value from public.queue_matches m where id=$1",[match]);
  for(const status of ['open','draft']) {
    await db.query("update public.events set status=$1 where id=$2",[status,event]);
    await db.exec("savepoint live_archive"); await assert.rejects(archive(ids[0]),/ยังลบไม่ได้/); await db.exec("rollback to live_archive");
    assert.equal(await value("select active as value from public.club_members where id=$1",[ids[0]]),true);
    assert.deepEqual(await value("select to_jsonb(m) as value from public.queue_matches m where id=$1",[match]),before);
  }
});
await check("archive blocks orphan active queues even when no unfinished-round signup remains", async () => {
  await removeLiveReferences(ids[0]);
  for(const status of ['draft','approved','playing']) {
    await db.exec("savepoint orphan_queue");
    const match=await value("insert into public.queue_matches(club_id,event_id,sequence,status,queue_position) values($1,$2,1,$3,case when $3 in ('draft','approved') then 1 end) returning id as value",[club,closedEvent,status]);
    await db.query("insert into public.queue_match_players(club_id,event_id,match_id,member_id,team,position,skill_level_snapshot) values($1,$2,$3,$4,'A',1,'BG')",[club,closedEvent,match,ids[0]]);
    await db.exec("savepoint blocked_orphan"); await assert.rejects(archive(ids[0]),/ยังลบไม่ได้/); await db.exec("rollback to blocked_orphan");
    await db.exec("rollback to orphan_queue");
  }
});
await check("archive rejects missing members, staff, outsiders and non-member accounts", async () => {
  const staff='10000000-0000-0000-0000-000000000004';
  await db.query("insert into auth.users(id) values($1)",[staff]);
  const staffMember=await value("insert into public.club_members(club_id,profile_id,display_name,role) values($1,$2,'Archive staff','staff') returning id as value",[club,staff]);
  await db.exec("savepoint staff_target"); await assert.rejects(archive(staffMember),/เจ้าของหรือสตาฟ/); await db.exec("rollback to staff_target");
  await db.exec("savepoint missing_archive"); await assert.rejects(archive('40000000-0000-0000-0000-999999999999'),/ไม่พบรายชื่อ/); await db.exec("rollback to missing_archive");
  for(const caller of [staff,'10000000-0000-0000-0000-999999999999']) {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[caller]);
    await db.exec("savepoint denied_archive"); await assert.rejects(archive(ids[0]),/เฉพาะแอดมิน/); await db.exec("rollback to denied_archive");
  }
  assert.equal(await value("select has_function_privilege('anon','public.archive_club_member(uuid)','execute') as value"),false);
  assert.equal(await value("select has_function_privilege('authenticated','public.archive_club_member(uuid)','execute') as value"),true);
});
await check("archive and its audit are atomic when a late audit insert fails", async () => {
  await removeLiveReferences(ids[0]);
  await db.exec(`create function pg_temp.reject_archive_audit() returns trigger language plpgsql as $$ begin if new.action='ลบผู้เล่นออกจากรายชื่อเดิม' then raise exception 'test archive audit rejected'; end if; return new; end; $$;
    create trigger test_reject_archive_audit before insert on public.audit_logs for each row execute function pg_temp.reject_archive_audit();`);
  await db.exec("savepoint archive_audit"); await assert.rejects(archive(ids[0]),/test archive audit rejected/); await db.exec("rollback to archive_audit");
  assert.equal(await value("select active as value from public.club_members where id=$1",[ids[0]]),true);
});
await check("real open rounds and populated drafts cannot be deleted by cached direct clients", async () => {
  await db.query("update public.clubs set is_test=false where id=$1",[club]);
  const baseline=await value("select count(*)::int as value from public.signups where event_id=$1",[event]);
  for(const status of ['open','draft']) {
    await db.query("update public.events set status=$1 where id=$2",[status,event]);
    await db.exec("savepoint event_delete");
    await assert.rejects(db.query("delete from public.events where id=$1",[event]),status==='open'?/รอบจริงที่เปิดอยู่/:/มีผู้เล่นหรือข้อมูล/);
    await db.exec("rollback to event_delete");
    assert.equal(await value("select count(*)::int as value from public.signups where event_id=$1",[event]),baseline);
  }
});
await check("a real empty draft remains deletable, while test reset can delete its own live round", async () => {
  await db.query("update public.clubs set is_test=false where id=$1",[club]);
  await db.query("update public.events set status='closed' where id=$1",[event]);
  const draft=await value("insert into public.events(club_id,title,event_date,starts_at,ends_at,status,created_by) values($1,'Empty draft','2026-10-25','18:00','22:00','draft',$2) returning id as value",[club,owner]);
  await db.query("delete from public.events where id=$1",[draft]);
  assert.equal(await value("select count(*)::int as value from public.events where id=$1",[draft]),0);
  await db.query("update public.clubs set is_test=true where id=$1",[club]);
  await db.query("update public.events set status='open' where id=$1",[event]);
  await db.query("delete from public.events where id=$1",[event]);
  assert.equal(await value("select count(*)::int as value from public.events where id=$1",[event]),0);
  assert.equal(await value("select count(*)::int as value from public.events where id=$1",[closedEvent]),1);
});
await check("real drafts with only financial or queue data are protected even without signups", async () => {
  await db.query("update public.clubs set is_test=false where id=$1",[club]);
  await db.query("update public.events set status='closed' where id=$1",[event]);
  for(const kind of ['payment','extra','queue','attendance','queuePlayer','expense','checkpoint','snapshot']) {
    await db.exec("savepoint populated_draft");
    const draft=await value("insert into public.events(club_id,title,event_date,starts_at,ends_at,status,created_by) values($1,'Populated draft','2026-10-25','18:00','22:00','draft',$2) returning id as value",[club,owner]);
    if(kind==='payment') await db.query("insert into public.payments(club_id,event_id,member_id,amount,recorded_by) values($1,$2,$3,0,$4)",[club,draft,ids[0],owner]);
    if(kind==='extra') await db.query("insert into public.member_extra_charges(club_id,event_id,member_id,item_name,unit_price,created_by) values($1,$2,$3,'Water',10,$4)",[club,draft,ids[0],owner]);
    if(kind==='queue') await db.query("insert into public.queue_matches(club_id,event_id,sequence,status,queue_position) values($1,$2,1,'draft',1)",[club,draft]);
    if(kind==='attendance') await db.query("insert into public.attendance(club_id,event_id,member_id) values($1,$2,$3)",[club,draft,ids[0]]);
    if(kind==='queuePlayer') await db.query("insert into public.event_queue_players(club_id,event_id,member_id,status) values($1,$2,$3,'waiting')",[club,draft,ids[0]]);
    if(kind==='expense') await db.query("insert into public.expenses(club_id,event_id,category,label,amount,created_by) values($1,$2,'other','Fee',10,$3)",[club,draft,owner]);
    if(kind==='checkpoint') await db.query("insert into public.shuttlecock_checkpoints(club_id,event_id,checkpoint_time,cumulative_count,created_by) values($1,$2,'19:00',1,$3)",[club,draft,owner]);
    if(kind==='snapshot') await db.query("insert into public.per_round_billing_snapshots(club_id,event_id,checkpoint_time,checkpoint_at,court_cost_cumulative,shuttlecock_count_cumulative,shuttle_cost_cumulative,other_cost_cumulative,shared_cost_cumulative,available_shared_cost,allocated_shared_cost,deferred_shared_cost,created_by) values($1,$2,'19:00',now(),0,0,0,0,0,0,0,0,$3)",[club,draft,owner]);
    await db.exec("savepoint draft_delete"); await assert.rejects(db.query("delete from public.events where id=$1",[draft]),/มีผู้เล่นหรือข้อมูล/); await db.exec("rollback to draft_delete");
    assert.equal(await value("select count(*)::int as value from public.events where id=$1",[draft]),1);
    await db.exec("rollback to populated_draft");
  }
});
const changeVenue = (venue, targetEvent = event, targetClub = club) => value("select public.update_event_venue($1,$2,$3) as value",[targetClub,targetEvent,venue]);
await check("open venue change preserves same event, playing/upcoming queues, attendance and paid bills", async () => {
  const playing=await createManual(ids.slice(0,4)); await makePlaying(playing,ids.slice(0,4)); await createApproved(ids.slice(4,8));
  await db.query("insert into public.payments(club_id,event_id,member_id,amount,recorded_by,admin_confirmed_at,paid_at,payment_status) values($1,$2,$3,95,$4,now(),now(),'paid')",[club,event,ids[0],owner]);
  const eventBefore=await value("select to_jsonb(e)-'venue'-'updated_at' as value from public.events e where id=$1",[event]);
  const tables=['signups','attendance','queue_matches','queue_match_players','event_queue_players','payments','event_courts'];
  const before=[]; for(const table of tables) before.push(await value(`select jsonb_agg(to_jsonb(t) order by id) as value from public.${table} t where event_id=$1`,[event]));
  const updated=await changeVenue('  New venue  '); assert.equal(updated.id,event); assert.equal(updated.status,'open'); assert.equal(updated.venue,'New venue');
  assert.deepEqual(await value("select to_jsonb(e)-'venue'-'updated_at' as value from public.events e where id=$1",[event]),eventBefore);
  for(const [index,table] of tables.entries()) assert.deepEqual(await value(`select jsonb_agg(to_jsonb(t) order by id) as value from public.${table} t where event_id=$1`,[event]),before[index]);
  assert.equal(await value("select count(*)::int as value from public.club_venues where club_id=$1 and name='New venue'",[club]),1);
  await changeVenue('New venue');
  assert.equal(await value("select count(*)::int as value from public.audit_logs where event_id=$1 and action='แก้ไขสถานที่ของรอบเดิม'",[event]),1);
});
await check("venue edit rejects closed rounds, invalid names, wrong club and staff", async () => {
  for(const name of ['', ' '.repeat(4), 'x'.repeat(121)]) {
    await db.exec("savepoint bad_venue"); await assert.rejects(changeVenue(name),/สถานที่/); await db.exec("rollback to bad_venue");
  }
  await db.exec("savepoint closed_venue"); await assert.rejects(changeVenue('New venue',closedEvent),/ยังไม่จบ/); await db.exec("rollback to closed_venue");
  const otherClub=await value("insert into public.clubs(name,owner_id,is_test) values('Other isolated fixture club',$1,false) returning id as value",[owner]);
  await db.exec("savepoint cross_venue"); await assert.rejects(changeVenue('New venue',event,otherClub),/ไม่พบรอบในกลุ่ม/); await db.exec("rollback to cross_venue");
  const staff='10000000-0000-0000-0000-000000000005'; await db.query("insert into auth.users(id) values($1)",[staff]);
  await db.query("insert into public.club_members(club_id,profile_id,display_name,role) values($1,$2,'Venue staff','staff')",[club,staff]);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[staff]);
  await db.exec("savepoint staff_venue"); await assert.rejects(changeVenue('New venue'),/เฉพาะแอดมิน/); await db.exec("rollback to staff_venue");
  assert.equal(await value("select has_function_privilege('anon','public.update_event_venue(uuid,uuid,text)','execute') as value"),false);
});
await check("venue, saved venue and audit roll back together after late failure", async () => {
  const before=await value("select to_jsonb(e) as value from public.events e where id=$1",[event]);
  await db.exec(`create function pg_temp.reject_venue_audit() returns trigger language plpgsql as $$ begin if new.action='แก้ไขสถานที่ของรอบเดิม' then raise exception 'test venue audit rejected'; end if; return new; end; $$;
    create trigger test_reject_venue_audit before insert on public.audit_logs for each row execute function pg_temp.reject_venue_audit();`);
  await db.exec("savepoint venue_audit"); await assert.rejects(changeVenue('Venue rollback'),/test venue audit rejected/); await db.exec("rollback to venue_audit");
  assert.deepEqual(await value("select to_jsonb(e) as value from public.events e where id=$1",[event]),before);
  assert.equal(await value("select count(*)::int as value from public.club_venues where club_id=$1 and name='Venue rollback'",[club]),0);
});
const withdraw = (memberId=ids[0],eventId=event) => value("select public.operator_remove_event_participant($1,$2) as value",[eventId,memberId]);
const extendCourt = (courtId,minutes=30,eventId=event) => value("select public.extend_court_booking($1,$2,$3) as value",[eventId,courtId,minutes]);
const courtUpsert = (courtId,start,end,eventId=event) => value("select public.operator_upsert_event_court($1,$2,'Night court',$3::time,$4::time) as value",[eventId,courtId,start,end]);
const tableRows = async (table,eventId=event) => value(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) as value from public.${table} t where event_id=$1`,[eventId]);
async function seedPreservedSnapshot(eventId,matchId) {
  const snapshot=await value("insert into public.per_round_billing_snapshots(club_id,event_id,checkpoint_time,checkpoint_at,court_cost_cumulative,shuttlecock_count_cumulative,shuttle_cost_cumulative,other_cost_cumulative,shared_cost_cumulative,available_shared_cost,allocated_shared_cost,deferred_shared_cost,included_match_count,included_player_rounds,created_by) values($1,$2,'23:00',now(),100,1,20,0,120,120,67,53,1,4,$3) returning id as value",[club,eventId,owner]);
  await db.query("insert into public.per_round_snapshot_allocations(snapshot_id,club_id,event_id,member_id,round_units,allocated_shared_amount) values($1,$2,$3,$4,1,67)",[snapshot,club,eventId,ids[0]]);
  await db.query("insert into public.per_round_snapshot_matches(snapshot_id,event_id,match_id) values($1,$2,$3)",[snapshot,eventId,matchId]);
}
const snapshotRows = eventId => value("select jsonb_build_object('snapshots',(select jsonb_agg(to_jsonb(s) order by id) from public.per_round_billing_snapshots s where event_id=$1),'links',(select jsonb_agg(to_jsonb(l) order by match_id) from public.per_round_snapshot_matches l where event_id=$1),'allocations',(select jsonb_agg(to_jsonb(a) order by member_id) from public.per_round_snapshot_allocations a where event_id=$1)) as value",[eventId]);
await check("departed players cannot be revived by legacy waiting or reserved writes", async()=>{
  await db.query("update public.attendance set left_at='21:00' where event_id=$1 and member_id=$2",[event,ids[0]]);
  for(const status of ['waiting','reserved']) {
    await db.query("update public.event_queue_players set status=$1 where event_id=$2 and member_id=$3",[status,event,ids[0]]);
    assert.equal(await value("select status as value from public.event_queue_players where event_id=$1 and member_id=$2",[event,ids[0]]),'left');
  }
  await db.query("update public.attendance set left_at=null where event_id=$1 and member_id=$2",[event,ids[0]]);
  assert.equal(await value("select status as value from public.event_queue_players where event_id=$1 and member_id=$2",[event,ids[0]]),'waiting');
});
await check("finishing a stale playing row with a recorded departure keeps left and counts its historical game", async()=>{
  const match=await createManual(ids.slice(0,4)); await makePlaying(match,ids.slice(0,4));
  await db.query("update public.attendance set left_at='21:00' where event_id=$1 and member_id=$2",[event,ids[0]]);
  // Exercise the real-club legacy implementation as well as the test wrapper.
  await value("select public.queue_finish_legacy($1) as value",[match]);
  const player=(await db.query("select status,games_played from public.event_queue_players where event_id=$1 and member_id=$2",[event,ids[0]])).rows[0];
  assert.equal(player.status,'left'); assert.equal(player.games_played,1);
  assert.equal(await value("select status as value from public.queue_matches where id=$1",[match]),'completed');
});
await check("withdrawal after playing preserves completed game, attendance, extras and paid/confirmed money exactly", async()=>{
  const completed=await createManual(ids.slice(0,4)); await makePlaying(completed,ids.slice(0,4)); await value("select public.finish_queue_match($1) as value",[completed]);
  await seedPreservedSnapshot(event,completed); const snapshotsBefore=await snapshotRows(event);
  const upcoming=await createApproved(ids.slice(0,4));
  await db.query("insert into public.payments(club_id,event_id,member_id,amount,recorded_by,admin_confirmed_at,paid_at,payment_status) values($1,$2,$3,95,$4,now(),now(),'paid')",[club,event,ids[0],owner]);
  await db.query("insert into public.member_extra_charges(club_id,event_id,member_id,item_name,unit_price,created_by) values($1,$2,$3,'Water',10,$4)",[club,event,ids[0],owner]);
  const before={}; for(const table of ['attendance','payments','member_extra_charges','queue_match_players']) before[table]=await tableRows(table);
  const matchBefore=await value("select to_jsonb(m) as value from public.queue_matches m where id=$1",[completed]);
  await withdraw();
  assert.deepEqual(await snapshotRows(event),snapshotsBefore);
  for(const table of Object.keys(before)) assert.deepEqual(await tableRows(table),before[table],table);
  assert.deepEqual(await value("select to_jsonb(m) as value from public.queue_matches m where id=$1",[completed]),matchBefore);
  assert.equal(await value("select status as value from public.queue_matches where id=$1",[upcoming]),'cancelled');
  assert.equal(await value("select status as value from public.event_queue_players where event_id=$1 and member_id=$2",[event,ids[0]]),'left');
  const signup=(await db.query("select status,removed_at,removed_by from public.signups where event_id=$1 and member_id=$2",[event,ids[0]])).rows[0];
  assert.equal(signup.status,'coming'); assert.ok(signup.removed_at); assert.equal(signup.removed_by,owner);
  assert.equal(await value("select count(*)::int as value from public.event_queue_players where event_id=$1 and member_id=any($2::uuid[]) and status='waiting'",[event,ids.slice(1,4)]),3);
  assert.ok(!(await value("select public.next_automatic_queue_members($1) as value",[event])).includes(ids[0]));
  await withdraw(); assert.equal(await value("select count(*)::int as value from public.audit_logs where event_id=$1 and action='นำผู้เล่นออกจากรายชื่อรอบโดยเก็บประวัติและยอดเงิน'",[event]),1);
});
await check("playing withdrawal and late audit failure leave all participants and queues unchanged", async()=>{
  const match=await createManual(ids.slice(0,4)); await makePlaying(match,ids.slice(0,4));
  const before=await tableRows('signups'); await db.exec('savepoint playing_withdraw');
  await assert.rejects(withdraw(),/จบเกมก่อน/); await db.exec('rollback to playing_withdraw'); assert.deepEqual(await tableRows('signups'),before);
  await value("select public.finish_queue_match($1) as value",[match]); await createApproved(ids.slice(0,4));
  const signupBeforeAudit=await tableRows('signups'); const queueBefore=await tableRows('queue_matches'); const playersBefore=await tableRows('event_queue_players');
  await db.exec(`create function pg_temp.reject_withdraw_audit() returns trigger language plpgsql as $$ begin if new.action='นำผู้เล่นออกจากรายชื่อรอบโดยเก็บประวัติและยอดเงิน' then raise exception 'withdraw audit rejected'; end if; return new; end; $$;
    create trigger test_reject_withdraw before insert on public.audit_logs for each row execute function pg_temp.reject_withdraw_audit();`);
  await db.exec('savepoint withdraw_audit'); await assert.rejects(withdraw(),/withdraw audit rejected/); await db.exec('rollback to withdraw_audit');
  assert.deepEqual(await tableRows('signups'),signupBeforeAudit); assert.deepEqual(await tableRows('queue_matches'),queueBefore); assert.deepEqual(await tableRows('event_queue_players'),playersBefore);
});
await check("explicit restore reuses the same signup and never erases departure or bills", async()=>{
  await db.query("update public.attendance set left_at='00:15' where event_id=$1 and member_id=$2",[event,ids[0]]);
  const attendanceBefore=await tableRows('attendance'); const signupId=await value("select id as value from public.signups where event_id=$1 and member_id=$2",[event,ids[0]]);
  await withdraw(); await value("select public.operator_add_event_participant($1,$2,null,null) as value",[event,ids[0]]);
  assert.equal(await value("select id as value from public.signups where event_id=$1 and member_id=$2",[event,ids[0]]),signupId);
  assert.equal(await value("select removed_at as value from public.signups where id=$1",[signupId]),null);
  assert.deepEqual(await tableRows('attendance'),attendanceBefore);
  assert.equal(await value("select status as value from public.event_queue_players where event_id=$1 and member_id=$2",[event,ids[0]]),'left');
});
await check("overnight extension is additive from latest end, retains playing court and never rewrites arrivals", async()=>{
  const court=await courtUpsert(null,'21:00','00:00');
  const match=await createApproved(ids.slice(0,4));
  await db.query("update public.queue_matches set status='playing',court_id=$1,queue_position=null,started_at=now()-interval '15 minutes' where id=$2",[court,match]);
  await db.query("update public.event_queue_players set status='playing' where event_id=$1 and member_id=any($2::uuid[])",[event,ids.slice(0,4)]);
  const before={}; for(const table of ['signups','attendance','queue_matches','queue_match_players','event_queue_players']) before[table]=await tableRows(table);
  assert.equal((await extendCourt(court)).ends_at,'00:30:00'); assert.equal((await extendCourt(court)).ends_at,'01:00:00');
  assert.equal(await value("select ends_at::text as value from public.events where id=$1",[event]),'01:00:00');
  assert.equal(await value("select status as value from public.events where id=$1",[event]),'open');
  for(const table of Object.keys(before)) assert.deepEqual(await tableRows(table),before[table],table);
  for(const [start,end] of [['20:00','01:30'],['21:00','00:30']]) {
    await db.exec('savepoint unsafe_court'); await assert.rejects(courtUpsert(court,start,end),/คอร์ทกำลังเล่นอยู่/); await db.exec('rollback to unsafe_court');
  }
});
await check("closed expired court correction preserves paid, confirmed and pending-slip bills without reopening", async()=>{
  const court=await courtUpsert(null,'21:00','00:00',closedEvent);
  const completed=await value("insert into public.queue_matches(club_id,event_id,court_id,sequence,status,started_at,ended_at) values($1,$2,$3,1,'completed',now()-interval '2 hours',now()-interval '1 hour') returning id as value",[club,closedEvent,court]);
  await seedPreservedSnapshot(closedEvent,completed); const snapshotsBefore=await snapshotRows(closedEvent);
  for(const [i,status] of ['paid','awaiting','review'].entries()) await db.query("insert into public.payments(club_id,event_id,member_id,amount,recorded_by,admin_confirmed_at,paid_at,payment_status) values($1,$2,$3,$4,$5,now(),case when $6='paid' then now() else null end,$6)",[club,closedEvent,ids[i],95+i,owner,status]);
  const paymentId=await value("select id as value from public.payments where event_id=$1 and member_id=$2",[closedEvent,ids[2]]);
  await db.query("insert into public.payment_slips(club_id,submitted_by_member_id,beneficiary_member_id,beneficiary_member_ids,payment_ids,expected_amount,status,slip_hash,storage_path) values($1,$2,$2,array[$2]::uuid[],$3::uuid[],97,'pending','local-court-fixture','local-fixture.png')",[club,ids[2],[paymentId]]);
  const before=await tableRows('payments',closedEvent); const slipBefore=await value("select jsonb_agg(to_jsonb(s) order by id) as value from public.payment_slips s");
  assert.equal((await extendCourt(court,30,closedEvent)).ends_at,'00:30:00');
  assert.equal(await value("select status as value from public.events where id=$1",[closedEvent]),'closed');
  assert.deepEqual(await tableRows('payments',closedEvent),before);
  assert.deepEqual(await snapshotRows(closedEvent),snapshotsBefore);
  assert.deepEqual(await value("select jsonb_agg(to_jsonb(s) order by id) as value from public.payment_slips s"),slipBefore);
});
await check("court extension validation, wrong event and audit failure roll back the whole booking", async()=>{
  const court=await courtUpsert(null,'21:00','00:00'); const before=await tableRows('event_courts');
  for(const minutes of [0,-30,181,null]) {
    await db.exec('savepoint bad_extension'); await assert.rejects(extendCourt(court,minutes),/1–180/); await db.exec('rollback to bad_extension');
  }
  await db.exec('savepoint wrong_extension'); await assert.rejects(extendCourt(court,30,closedEvent),/ไม่พบคอร์ท/); await db.exec('rollback to wrong_extension');
  await db.exec(`create function pg_temp.reject_court_audit() returns trigger language plpgsql as $$ begin if new.action='แก้เวลาคอร์ทในรอบเดิม' then raise exception 'court audit rejected'; end if; return new; end; $$;
    create trigger test_reject_court before insert on public.audit_logs for each row execute function pg_temp.reject_court_audit();`);
  const eventBefore=await value("select to_jsonb(e) as value from public.events e where id=$1",[event]);
  await db.exec('savepoint court_audit'); await assert.rejects(extendCourt(court),/court audit rejected/); await db.exec('rollback to court_audit');
  assert.deepEqual(await tableRows('event_courts'),before); assert.deepEqual(await value("select to_jsonb(e) as value from public.events e where id=$1",[event]),eventBefore);
});
await check("staff can correct latest closed booking and time but cannot read financial settings", async()=>{
  await db.query("update public.events set status='closed' where id=$1",[event]);
  const court=await courtUpsert(null,'21:00','00:00');
  const staff='10000000-0000-0000-0000-000000000006'; await db.query('insert into auth.users(id) values($1)',[staff]);
  await db.query("insert into public.club_members(club_id,profile_id,display_name,role) values($1,$2,'Live operations staff','staff')",[club,staff]);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[staff]);
  assert.equal((await extendCourt(court)).ends_at,'00:30:00');
  await value("select public.operator_update_signup_arrival($1,$2,'00:10'::time) as value",[event,ids[0]]);
  assert.equal(await value("select arrived_at::text as value from public.attendance where event_id=$1 and member_id=$2",[event,ids[0]]),'00:10:00');
  const snapshot=await value("select public.load_staff_dashboard($1) as value",[club]);
  assert.equal(snapshot.event.id,event); assert.equal(snapshot.event.status,'closed'); assert.equal(snapshot.event.court_hourly_rate,undefined); assert.equal(snapshot.payments,undefined);
  assert.ok(snapshot.signups.every(s=>'removed_at' in s));
  for(const rpc of ['extend_court_booking(uuid,uuid,integer)','restore_event_participant(uuid,uuid)','operator_add_event_participant_legacy(uuid,uuid,text,text)']) assert.equal(await value(`select has_function_privilege('anon','public.${rpc}','execute') as value`),false);
  assert.equal(await value("select has_function_privilege('authenticated','public.operator_add_event_participant_legacy(uuid,uuid,text,text)','execute') as value"),false);
});
await check("arrival correction is one transaction even when attendance rejects after signup update", async()=>{
  const before=await tableRows('signups');
  await db.exec(`create function pg_temp.reject_arrival() returns trigger language plpgsql as $$ begin raise exception 'arrival rejected'; end; $$;
    create trigger test_reject_arrival before update of arrived_at on public.attendance for each row execute function pg_temp.reject_arrival();`);
  await db.exec('savepoint arrival_atomic'); await assert.rejects(value("select public.operator_update_signup_arrival($1,$2,'00:10'::time) as value",[event,ids[0]]),/arrival rejected/); await db.exec('rollback to arrival_atomic');
  assert.deepEqual(await tableRows('signups'),before);
});
await check("late signup writes cannot erase withdrawal, while permanent skills and explicit closed undo remain safe", async()=>{
  await withdraw(); const removed=await value("select to_jsonb(s) as value from public.signups s where event_id=$1 and member_id=$2",[event,ids[0]]);
  for(const sql of [
    "delete from public.signups where event_id=$1 and member_id=$2",
    "update public.signups set arrival_time='00:20' where event_id=$1 and member_id=$2",
    "update public.signups set removed_at=null,removed_by=null where event_id=$1 and member_id=$2",
  ]) {
    await db.exec('savepoint stale_signup'); await assert.rejects(db.query(sql,[event,ids[0]]),/เพิ่มกลับ|นำออก|เพิ่มผู้เล่นกลับ/); await db.exec('rollback to stale_signup');
    assert.deepEqual(await value("select to_jsonb(s) as value from public.signups s where event_id=$1 and member_id=$2",[event,ids[0]]),removed);
  }
  await value("select public.operator_update_member_profile($1,'{\"skill_level\":\"N\"}'::jsonb) as value",[ids[0]]);
  assert.equal(await value('select skill_level as value from public.club_members where id=$1',[ids[0]]),'N');
  assert.deepEqual(await value("select to_jsonb(s) as value from public.signups s where event_id=$1 and member_id=$2",[event,ids[0]]),removed);
  await db.query("update public.events set status='closed' where id=$1",[event]);
  const attendanceBefore=await tableRows('attendance');
  await value("select public.restore_event_participant($1,$2) as value",[event,ids[0]]);
  assert.equal(await value("select removed_at as value from public.signups where event_id=$1 and member_id=$2",[event,ids[0]]),null);
  assert.deepEqual(await tableRows('attendance'),attendanceBefore);
  assert.equal(await value("select status as value from public.events where id=$1",[event]),'closed');
  assert.equal(await value("select status as value from public.event_queue_players where event_id=$1 and member_id=$2",[event,ids[0]]),'left');
});
await check("staff may not correct older history or any closed round while a round is open", async()=>{
  const oldCourt=await courtUpsert(null,'21:00','00:00',closedEvent);
  const staff='10000000-0000-0000-0000-000000000007'; await db.query('insert into auth.users(id) values($1)',[staff]);
  await db.query("insert into public.club_members(club_id,profile_id,display_name,role) values($1,$2,'Scoped staff','staff')",[club,staff]);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[staff]);
  for(const closedOpenStatus of ['open','closed']) {
    await db.query("update public.events set status=$1 where id=$2",[closedOpenStatus,event]);
    const calls=[()=>extendCourt(oldCourt,30,closedEvent),
      ()=>value("select public.operator_update_signup_arrival($1,$2,'22:00'::time) as value",[closedEvent,ids[0]]),
      ()=>value("select public.operator_update_attendance($1,$2,true,'21:00'::time,'22:00'::time) as value",[closedEvent,ids[0]])];
    for(const call of calls) {await db.exec('savepoint old_staff'); await assert.rejects(call(),/ไม่มีสิทธิ์/); await db.exec('rollback to old_staff');}
  }
  await db.query("select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000099',true)");
  await db.exec('savepoint outsider_extend'); await assert.rejects(extendCourt(oldCourt,30,closedEvent),/ไม่มีสิทธิ์/); await db.exec('rollback to outsider_extend');
});
await check("mixed evening and midnight-only courts retain evening event anchor after extension", async()=>{
  await courtUpsert(null,'21:00','01:00');
  const midnight=await value("select public.operator_upsert_event_court($1,null,'Midnight court','00:00'::time,'00:30'::time) as value",[event]);
  await value("select public.operator_upsert_event_court($1,null,'Late court','22:00'::time,'00:00'::time) as value",[event]);
  assert.equal(await value("select starts_at::text as value from public.events where id=$1",[event]),'21:00:00');
  assert.equal((await extendCourt(midnight)).ends_at,'01:00:00');
  assert.equal(await value("select starts_at::text as value from public.events where id=$1",[event]),'21:00:00');
  assert.equal(await value("select event_date::text as value from public.events where id=$1",[event]),await value("select (now() at time zone 'Asia/Bangkok')::date::text as value"));
});
await check("a booking cannot wrap through a full extra day", async()=>{
  const court=await courtUpsert(null,'21:00','20:45');
  await db.exec('savepoint full_day'); await assert.rejects(extendCourt(court),/น้อยกว่า 24/); await db.exec('rollback to full_day');
  assert.equal(await value("select ends_at::text as value from public.event_courts where id=$1",[court]),'20:45:00');
});
console.log(`Database behavioral checks: ${passed} passed`);
await db.close();
