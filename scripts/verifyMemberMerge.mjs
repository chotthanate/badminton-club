// Isolated in-memory PostgreSQL regression tests. Never connects to production.
// PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/verifyMemberMerge.mjs
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
process.on("uncaughtException", (error) => {
  console.error(error.message, error.where || "", error.internalQuery || "");
  process.exitCode = 1;
});

if (!process.env.PGLITE_MODULE) throw new Error("Set PGLITE_MODULE to the temporary PGlite installation");
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
  create function public.gen_random_bytes(integer) returns bytea language sql volatile as $$ select decode(substr(repeat(replace(gen_random_uuid()::text, '-', ''), ($1+15)/16), 1, $1*2), 'hex') $$;
`);
for (const filename of (await readdir(`${repo}supabase/migrations`)).filter((file) => file.endsWith(".sql")).sort()) {
  const sql = (await readFile(`${repo}supabase/migrations/${filename}`, "utf8"))
    .replace("create extension if not exists pgcrypto;", "-- local engine provides UUIDs");
  try { await db.exec(sql); } catch (error) { throw new Error(`Migration ${filename}: ${error.message}`); }
}
const owner = "10000000-0000-0000-0000-000000000001";
const outsider = "10000000-0000-0000-0000-000000000002";
const club = "20000000-0000-0000-0000-000000000001";
const round = "30000000-0000-0000-0000-000000000001";
const source = "40000000-0000-0000-0000-000000000001";
const target = "40000000-0000-0000-0000-000000000002";
const value = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.value;
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
await db.exec(`
  insert into auth.users(id) values('${owner}'),('${outsider}');
  insert into public.clubs(id,name,owner_id,is_test) values('${club}','Merge regression','${owner}',true);
  insert into public.events(id,club_id,title,event_date,starts_at,ends_at,status,created_by)
    values('${round}','${club}','History','2026-10-01','21:00','00:00','closed','${owner}');
  insert into public.club_members(id,club_id,display_name,nickname,skill_level)
    values('${source}','${club}','Old player','Old name','BG'),('${target}','${club}','Main player','Main name','N');
  insert into public.signups(club_id,event_id,member_id,status,arrival_time,skill_level_snapshot)
    values('${club}','${round}','${source}','coming','21:00','BG'),('${club}','${round}','${target}','coming','21:00','N');
  insert into public.attendance(club_id,event_id,member_id,arrived,arrived_at,left_at)
    values('${club}','${round}','${source}',true,'21:00','23:00'),('${club}','${round}','${target}',true,'21:00','23:00');
  insert into public.event_queue_players(club_id,event_id,member_id,status,games_played,minutes_played)
    values('${club}','${round}','${source}','left',2,30),('${club}','${round}','${target}','left',3,40);
`);
let passed = 0;
async function check(name, run) {
  await db.exec("begin");
  try { await run(); passed += 1; console.log(`PASS ${name}`); }
  finally { await db.exec("rollback"); }
}
const merge = (rpc = "merge_club_members_with_queue", from = source, to = target) => value(`select public.${rpc}($1,$2) as value`, [from,to]);
async function rejectMerge(pattern, rpc) {
  await db.exec("savepoint rejected_merge");
  await assert.rejects(merge(rpc), pattern);
  await db.exec("rollback to rejected_merge");
  assert.equal(await value("select count(*)::int as value from public.club_members where id=any($1::uuid[])", [[source,target]]), 2);
}
async function allocation(member, time = "22:00", amount = 73.25) {
  const snapshot = await value(`insert into public.per_round_billing_snapshots(club_id,event_id,checkpoint_time,checkpoint_at,court_cost_cumulative,shuttlecock_count_cumulative,shuttle_cost_cumulative,other_cost_cumulative,shared_cost_cumulative,available_shared_cost,allocated_shared_cost,deferred_shared_cost,created_by)
    values($1,$2,$3,'2026-10-01T15:00:00Z',100,1,20,0,120,120,120,0,$4) returning id as value`, [club,round,time,owner]);
  await db.query("insert into public.per_round_snapshot_allocations(snapshot_id,club_id,event_id,member_id,round_units,allocated_shared_amount) values($1,$2,$3,$4,2,$5)", [snapshot,club,round,member,amount]);
  return snapshot;
}
async function payment(member, amount = 95, eventId = round) {
  return value("insert into public.payments(club_id,event_id,member_id,amount,billed_at,recorded_by) values($1,$2,$3,$4,now(),$5) returning id as value", [club,eventId,member,amount,owner]);
}
async function game(member, status = "completed", sequence = 1) {
  const match = await value("insert into public.queue_matches(club_id,event_id,sequence,status,queue_position) values($1,$2,$3,$4,$5) returning id as value", [club,round,sequence,status,["draft","approved"].includes(status) ? sequence : null]);
  await db.query("insert into public.queue_match_players(club_id,event_id,match_id,member_id,team,position,skill_level_snapshot) values($1,$2,$3,$4,'A',1,'BG')", [club,round,match,member]);
  return match;
}
async function tournamentPlayer(member, tournamentId = null, teamNumber = 1) {
  const tournament = tournamentId || await value("insert into public.tournaments(club_id,name,event_date,venue,starts_at,ends_at,created_by) values($1,'Test','2026-10-01','Court','2026-10-01T14:00:00Z','2026-10-01T17:00:00Z',$2) returning id as value", [club,owner]);
  const division = await value("insert into public.tournament_divisions(tournament_id,club_id,skill_level) values($1,$2,'BG') on conflict(tournament_id,skill_level) do update set skill_level='BG' returning id as value", [tournament,club]);
  const team = await value("insert into public.tournament_teams(tournament_id,division_id,club_id,name) values($1,$2,$3,$4) returning id as value", [tournament,division,club,`Team ${teamNumber}`]);
  const player = await value("insert into public.tournament_team_players(tournament_id,division_id,team_id,club_id,club_member_id,display_name,skill_level_snapshot,player_order) values($1,$2,$3,$4,$5,'Historic name','BG',1) returning id as value", [tournament,division,team,club,member]);
  return { tournament, player };
}

await check("merge preserves canonical profile, aliases and all disjoint game totals", async () => {
  await db.query("update public.club_members set line_user_id='old-line-account' where id=$1", [source]);
  await game(source); await game(target,"completed",2);
  assert.equal(await merge(),target);
  assert.equal(await value("select count(*)::int as value from public.club_members where id=$1",[source]),0);
  const member = (await db.query("select nickname,skill_level,line_user_id,aliases from public.club_members where id=$1",[target])).rows[0];
  assert.equal(member.nickname,"Main name"); assert.equal(member.skill_level,"N"); assert.equal(member.line_user_id,"old-line-account"); assert.ok(member.aliases.includes("Old name"));
  assert.deepEqual((await db.query("select games_played,minutes_played,status from public.event_queue_players where event_id=$1 and member_id=$2",[round,target])).rows[0], { games_played:5, minutes_played:70, status:"left" });
  assert.equal(await value("select count(*)::int as value from public.queue_match_players where member_id=$1",[target]),2);
  assert.equal(await value("select count(*)::int as value from public.audit_logs where details->>'source_member_id'=$1",[source]),1);
});
await check("source-only snapshot allocation is transferred exactly without lost money or FK error", async () => {
  const snapshot = await allocation(source);
  const match = await game(source);
  await db.query("insert into public.per_round_snapshot_matches(snapshot_id,event_id,match_id) values($1,$2,$3)",[snapshot,round,match]);
  const oldLink = (await db.query("select * from public.per_round_snapshot_matches where match_id=$1",[match])).rows[0];
  await merge();
  assert.deepEqual((await db.query("select member_id,round_units,allocated_shared_amount::text from public.per_round_snapshot_allocations where snapshot_id=$1",[snapshot])).rows[0], {member_id:target,round_units:2,allocated_shared_amount:"73.25"});
  assert.deepEqual((await db.query("select * from public.per_round_snapshot_matches where match_id=$1",[match])).rows[0],oldLink);
  assert.equal(await value("select member_id as value from public.queue_match_players where match_id=$1",[match]),target);
  await db.exec("savepoint locked_roster");
  await assert.rejects(db.query("update public.queue_match_players set position=2 where match_id=$1",[match]),/Snapshot/);
  await db.exec("rollback to locked_roster");
});
await check("source-only bills, extras and slip identities survive with unchanged amounts and payment IDs", async () => {
  const paymentId = await payment(source);
  await db.query("insert into public.member_extra_charges(club_id,event_id,member_id,item_name,unit_price,quantity,created_by) values($1,$2,$3,'Water',10,2,$4)",[club,round,source,owner]);
  await db.query("insert into public.payment_slips(club_id,submitted_by_member_id,beneficiary_member_ids,beneficiary_member_id,payment_ids,expected_amount,slip_hash,status) values($1,$2,array[$2]::uuid[],$2,$3,95,'unique-test-slip','pending')",[club,source,[paymentId]]);
  await merge();
  assert.equal(await value("select amount::text as value from public.payments where id=$1 and member_id=$2",[paymentId,target]),"95.00");
  assert.equal(await value("select sum(unit_price*quantity)::text as value from public.member_extra_charges where member_id=$1",[target]),"20.00");
  const slip=(await db.query("select submitted_by_member_id,beneficiary_member_id,beneficiary_member_ids,payment_ids from public.payment_slips")).rows[0];
  assert.deepEqual(slip,{submitted_by_member_id:target,beneficiary_member_id:target,beneficiary_member_ids:[target],payment_ids:[paymentId]});
  const slipId=await value("select id as value from public.payment_slips");
  await value("select public.settle_payment_slip($1,true,'slip_review') as value",[slipId]);
  assert.equal(await value("select payment_status as value from public.payments where id=$1",[paymentId]),"paid");
});
await check("multi-member slip across different rounds remains approvable after identity deduplication",async()=>{
  const secondRound=await value("insert into public.events(club_id,title,event_date,starts_at,ends_at,status,created_by) values($1,'Other history','2026-10-02','21:00','00:00','closed',$2) returning id as value",[club,owner]);
  const paymentIds=[await payment(target,100,secondRound),await payment(source,95)];
  const slipId=await value("insert into public.payment_slips(club_id,submitted_by_member_id,beneficiary_member_id,beneficiary_member_ids,payment_ids,expected_amount,slip_hash,status) values($1,$2,$2,$3,$4,195,'multi-slip','pending') returning id as value",[club,target,[target,source],paymentIds]);
  await merge();
  assert.deepEqual(await value("select beneficiary_member_ids as value from public.payment_slips where id=$1",[slipId]),[target]);
  assert.deepEqual(await value("select payment_ids as value from public.payment_slips where id=$1",[slipId]),paymentIds);
  await value("select public.settle_payment_slip($1,true,'slip_review') as value",[slipId]);
  assert.equal(await value("select sum(amount)::text as value from public.payments where member_id=$1 and payment_status='paid'",[target]),"195.00");
});
await check("tournament reference transfers without changing historical display name", async () => {
  const {player}=await tournamentPlayer(source); await merge();
  assert.deepEqual((await db.query("select club_member_id,display_name from public.tournament_team_players where id=$1",[player])).rows[0],{club_member_id:target,display_name:"Historic name"});
});
await check("different snapshots in the same round are rejected without guessing a reconciliation", async () => {
  await allocation(source,"22:00"); await allocation(target,"23:00");
  await rejectMerge(/ยอดเงินหรือ Snapshot/);
  assert.equal(await value("select count(distinct member_id)::int as value from public.per_round_snapshot_allocations"),2);
});
await check("same-round bills or bill/snapshot overlap fail atomically", async () => {
  await payment(source); await payment(target); await rejectMerge(/ยอดเงินหรือ Snapshot/);
  await db.query("delete from public.payments where member_id=$1",[source]);
  await allocation(source); await rejectMerge(/ยอดเงินหรือ Snapshot/);
});
for(const status of ["draft","approved","playing"]) await check(`${status} assignment prevents merging even when only one identity is assigned`,async()=>{
  const match=await game(source,status); await rejectMerge(/กำลังเล่นหรืออยู่ในคิว/);
  assert.equal(await value("select member_id as value from public.queue_match_players where match_id=$1",[match]),source);
});
await check("stale reserved player state is rejected even without a match row",async()=>{
  await db.query("update public.event_queue_players set status='reserved' where member_id=$1",[target]); await rejectMerge(/กำลังเล่นหรืออยู่ในคิว/);
});
await check("both old and new RPC names reject identities that appeared in one historical game",async()=>{
  const match=await game(source); await db.query("insert into public.queue_match_players(club_id,event_id,match_id,member_id,team,position,skill_level_snapshot) values($1,$2,$3,$4,'B',1,'N')",[club,round,match,target]);
  await rejectMerge(/เกมเดียวกัน/); await rejectMerge(/เกมเดียวกัน/,"merge_club_members");
});
await check("different attendance times cannot silently change billable hours",async()=>{
  await db.query("update public.attendance set arrived_at='22:00' where member_id=$1",[target]); await rejectMerge(/เวลาเข้าหรือกลับ/);
});
await check("an unused attendance row does not override the real arrival or departure",async()=>{
  await db.query("update public.attendance set arrived=false,arrived_at='23:00',left_at=null where member_id=$1",[target]);
  await merge();
  assert.deepEqual((await db.query("select arrived,arrived_at::text,left_at::text from public.attendance where member_id=$1",[target])).rows[0],{arrived:true,arrived_at:"21:00:00",left_at:"23:00:00"});
});
await check("two entries in one tournament remain unchanged until manually reviewed",async()=>{
  const {tournament}=await tournamentPlayer(source); await tournamentPlayer(target,tournament,2); await rejectMerge(/การแข่งขันเดียวกัน/);
  assert.equal(await value("select count(distinct club_member_id)::int as value from public.tournament_team_players"),2);
});
await check("different LINE identities are never silently combined",async()=>{
  await db.query("update public.club_members set line_user_id=id::text where id=any($1::uuid[])",[[source,target]]); await rejectMerge(/คนละบัญชี LINE/);
});
await check("non-admin cannot invoke either merge RPC, and anonymous access stays revoked",async()=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[outsider]);
  await rejectMerge(/แอดมิน/,"merge_club_members"); await rejectMerge(/แอดมิน/,"merge_club_members_with_queue");
  for(const rpc of ["merge_club_members","merge_club_members_with_queue"]) assert.equal(await value("select has_function_privilege('anon',$1,'execute') as value",[`public.${rpc}(uuid,uuid)`]),false);
});
await check("staff or owner identities are rejected even by club admin",async()=>{
  await db.query("update public.club_members set role='staff' where id=$1",[source]); await rejectMerge(/เจ้าของหรือสตาฟ/);
});
await check("late audit failure restores source identity, snapshot links, allocations and game roster atomically",async()=>{
  const snapshot=await allocation(source); const match=await game(source);
  await db.query("insert into public.per_round_snapshot_matches(snapshot_id,event_id,match_id) values($1,$2,$3)",[snapshot,round,match]);
  const oldLink=(await db.query("select * from public.per_round_snapshot_matches where match_id=$1",[match])).rows[0];
  const oldPlayer=(await db.query("select * from public.queue_match_players where match_id=$1",[match])).rows[0];
  await db.exec(`create function public.fail_test_merge_audit() returns trigger language plpgsql as $$ begin
    if new.action='รวมรายชื่อสมาชิกและประวัติ' then raise exception 'simulated audit failure'; end if; return new; end; $$;
    create trigger fail_test_merge_audit before insert on public.audit_logs for each row execute function public.fail_test_merge_audit();`);
  await rejectMerge(/simulated audit failure/);
  assert.deepEqual((await db.query("select * from public.per_round_snapshot_matches where match_id=$1",[match])).rows[0],oldLink);
  assert.deepEqual((await db.query("select * from public.queue_match_players where match_id=$1",[match])).rows[0],oldPlayer);
  assert.equal(await value("select member_id as value from public.per_round_snapshot_allocations where snapshot_id=$1",[snapshot]),source);
});
await check("cross-club and identical-source merges fail without deleting either member",async()=>{
  const otherClub=await value("insert into public.clubs(name,owner_id) values('Other club',$1) returning id as value",[owner]);
  const otherMember=await value("insert into public.club_members(club_id,display_name) values($1,'Other person') returning id as value",[otherClub]);
  for(const [from,to,pattern] of [[source,otherMember,/กลุ่มเดียวกัน/],[source,source,/คนละรายการ/]]){
    await db.exec("savepoint wrong_target"); await assert.rejects(merge("merge_club_members_with_queue",from,to),pattern); await db.exec("rollback to wrong_target");
  }
  assert.equal(await value("select count(*)::int as value from public.club_members where id=any($1::uuid[])",[[source,target,otherMember]]),3);
});
console.log(`PASS ${passed} isolated member-merge regression cases`);
await db.close();
