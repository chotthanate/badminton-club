import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source=readFileSync(new URL('../src/clubRepository.js',import.meta.url),'utf8');
function operation(name,response={data:null,error:null}) {
  const calls=[];
  const body=source.match(new RegExp(`export async function ${name}\\([\\s\\S]*?\\n\\}`))?.[0];
  assert.ok(body,name);
  const fn=new Function('client','throwIfError',`${body.replace('export ','')}\nreturn ${name};`)(
    ()=>({rpc:async(...args)=>{calls.push(args);return response;},from:()=>{throw new Error('Direct table mutation forbidden');}}),
    error=>{if(error)throw error;});
  return {fn,calls};
}
test('court extension sends a scoped delta instead of replacing a stale cached end',async()=>{
  const {fn,calls}=operation('extendCourtBooking',{data:{id:'court',ends_at:'00:30:00'},error:null});
  assert.equal((await fn({eventId:'event',courtId:'court'})).ends_at,'00:30:00');
  assert.deepEqual(calls,[['extend_court_booking',{target_event_id:'event',target_court_id:'court',additional_minutes:30}]]);
});
test('owner arrival correction delegates one atomic signup/attendance server operation',async()=>{
  const {fn,calls}=operation('updateSignupArrival');
  await fn({eventId:'event',memberId:'person',arrivalTime:'00:10'});
  assert.deepEqual(calls,[['operator_update_signup_arrival',{target_event_id:'event',target_member_id:'person',next_arrival:'00:10'}]]);
});
test('both participant removal roles use the history-preserving operation, restoration is explicit',async()=>{
  for(const name of ['removeParticipant','removeOperatorParticipant','restoreParticipant']) {
    const {fn,calls}=operation(name); await fn({eventId:'event',memberId:'person'});
    assert.deepEqual(calls,[[name==='restoreParticipant'?'restore_event_participant':'operator_remove_event_participant',{target_event_id:'event',target_member_id:'person'}]]);
  }
});
test('live operations preserve useful permission/conflict errors for the visible UI',async()=>{
  const error=new Error('Another operator is saving');
  for(const name of ['extendCourtBooking','updateSignupArrival','removeParticipant','restoreParticipant']) {
    const {fn}=operation(name,{data:null,error});
    await assert.rejects(fn({eventId:'event',memberId:'person',courtId:'court'}),actual=>actual===error);
  }
});
