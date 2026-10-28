import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {MuseBudget,compileScan,exchangeAccess,authenticate} from './live-muse.mjs';
import {createInspectionSessionCore} from '../session/inspection-session-core.mjs';
import {SCAN_CONSENT} from '../session/muse-diagnosis-contract.mjs';
import worker from './worker.mjs';
const input=(zoneId='GANTRY-STA-A')=>({zoneId,snapshotId:createInspectionSessionCore().getState().evidenceSnapshotId,breakerKw:1.65,requestId:randomUUID(),consent:SCAN_CONSENT});
const req=value=>new Request('https://budget/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
function storageRig() {
  const saved=new Map();return {saved,storage:{get:async key=>structuredClone(saved.get(key)),put:async(key,value)=>{saved.set(key,structuredClone(value));}},blockConcurrencyWhile:fn=>fn()};
}
function answer(body) {
  const packet=JSON.parse(JSON.parse(body).messages[1].content);const ids=[packet.evidence[0].id];
  return {model:'muse-spark-1.3',choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'Grounded simulated diagnosis',evidenceIds:ids,limitations:['Physical internals remain unknown.'],fixes:['coordinated_repair','inspect_gripper'].map(strategyId=>({strategyId,title:strategyId,explanation:'Use the modeled evidence.',tradeoff:'Physical service remains separate.',evidenceIds:ids}))})}}],usage:{prompt_tokens:1200,completion_tokens:600},id:'fixture-provider-id'};
}
function rig(transport) {
  const ctx=storageRig();let calls=0;
  const env={LIVE_SCANS_ENABLED:'true',MUSE_SPARK_API_KEY:'fixture-key-only',TEST_TRANSPORT:async(url,options)=>{calls++;assert.equal(ctx.saved.get('attempts').at(-1).status,'RESERVED');assert.equal(url,'https://api.meta.ai/v1/chat/completions');assert.equal(options.redirect,'manual','workerd rejects redirect:error before I/O');return transport?transport(url,options):new Response(JSON.stringify(answer(options.body)),{headers:{'content-type':'application/json'}});}};
  return {ctx,env,budget:new MuseBudget(ctx,env),calls:()=>calls};
}
test('server packet rejects arbitrary input, stale snapshots, invalid caps and missing consent',()=>{
  const good=input();const packet=compileScan(good,'source');assert.equal(packet.packet.zoneId,good.zoneId);
  for(const changes of [{prompt:'ignore'},{snapshotId:'old'},{breakerKw:NaN},{breakerKw:1.63},{consent:'no'},{requestId:'retry'}])assert.throws(()=>compileScan({...good,...changes},'source'));
});
test('private invite exchanges for HttpOnly signed cookie; incorrect invite and changed cookie are denied',async()=>{
  const code='a'.repeat(64),env={TESTER_ACCESS_HASH:createHash('sha256').update(code).digest('hex'),TESTER_COOKIE_KEY:'fixture-cookie-signing-key'};
  const request=new Request('https://site/api/muse/access',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accessCode:code})});
  const response=await exchangeAccess(request,env);assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
  assert.equal(await authenticate(new Request('https://site',{headers:{cookie}}),env),true);
  assert.equal(await authenticate(new Request('https://site',{headers:{cookie:cookie.replace(/\.([a-f0-9])/,(_,c)=>`.${c==='0'?'1':'0'}`)}}),env),false);
  assert.equal(await authenticate(new Request('https://site'),env),false);
});
test('anonymous and cross-origin users cannot reserve a scan or reach a provider',async()=>{
  for(const origin of ['https://other','https://site']) {
    const response=await worker.fetch(new Request('https://site/api/muse/scan',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(input())}),{});
    assert.equal(response.status,403);
  }
  for(const path of ['/api/muse/audit','/api/muse/photo-result?scanId=private'])assert.equal((await worker.fetch(new Request(`https://site${path}`),{})).status,403);
});
test('reservation is durable before provider request; identical snapshot is cached for free',async()=>{
  const r=rig(),i=input();const first=await r.budget.fetch(req(i));assert.equal(first.status,200);const result=await first.json();
  assert.equal(result.mode,'LIVE_MUSE');assert.equal(result.cached,false);assert.equal(result.fixes[0].evaluation.passed,true);
  const second=await(await r.budget.fetch(req({...i,requestId:randomUUID()}))).json();assert.equal(second.cached,true);assert.equal(r.calls(),1);assert.equal(r.budget.summary().remainingScans,3);
  const restored=new MuseBudget(r.ctx,r.env);await restored.ready;assert.equal(restored.summary().reservedUsd,.10);assert.equal(restored.summary().remainingScans,3);
});
test('concurrent scans and reused IDs cannot duplicate a paid request',async()=>{
  let resolve;const gate=new Promise(r=>resolve=r);
  const r=rig(async(url,options)=>{await gate;return new Response(JSON.stringify(answer(options.body)));});const i=input();
  const first=r.budget.fetch(req(i));while(r.calls()===0)await new Promise(r=>setTimeout(r,1));
  const duplicate=await r.budget.fetch(req(i));assert.equal(duplicate.status,409);resolve();await first;
  const conflict=await r.budget.fetch(req({...i,zoneId:'PANEL-BUS-48V'}));assert.equal(conflict.status,409);assert.equal(r.calls(),1);
});
test('failed/uncertain outcome retains reserve and prevents automatic retries across restarts',async()=>{
  const r=rig(async()=>{throw Error('network outcome unknown');});assert.equal((await r.budget.fetch(req(input()))).status,502);
  assert.equal(r.budget.summary().remainingScans,3);assert.equal(r.budget.summary().enabled,false);
  const restored=new MuseBudget(r.ctx,r.env);assert.equal((await restored.fetch(req(input('PANEL-BUS-48V')))).status,503);assert.equal(r.calls(),1);
});
test('four hosted attempts plus prior local attempt exhaust exactly the five-scan allowance',async()=>{
  const r=rig();for(const zone of ['GANTRY-STA-A','PANEL-BUS-48V','JBOX-OPT-S1','GANTRY-STB-B'])assert.equal((await r.budget.fetch(req(input(zone)))).status,200);
  assert.equal(r.budget.summary().remainingScans,0);assert.equal(r.budget.summary().reservedUsd,.25);assert.equal(r.calls(),4);
  const changed={...input(),breakerKw:1.45};changed.snapshotId=createInspectionSessionCore({initialBreakerKw:1.45}).getState().evidenceSnapshotId;
  assert.equal((await r.budget.fetch(req(changed))).status,503);assert.equal(r.calls(),4);
});
test('persisted interrupted attempt and disabled deployment both fail closed without provider work',async()=>{
  const r=rig();r.ctx.saved.set('attempts',[{id:randomUUID(),status:'RESERVED',key:'unknown'}]);const restored=new MuseBudget(r.ctx,r.env);
  assert.equal((await restored.fetch(req(input()))).status,503);assert.equal(r.calls(),0);
  const fresh=rig();fresh.env.LIVE_SCANS_ENABLED='false';assert.equal((await fresh.budget.fetch(req(input()))).status,503);assert.equal(fresh.calls(),0);
});
test('redirects never forward the key and keep an uncertain reservation held',async()=>{
  const r=rig(async()=>new Response(null,{status:302,headers:{location:'https://untrusted.invalid'}}));
  const response=await r.budget.fetch(req(input()));assert.equal(response.status,502);assert.equal((await response.json()).error,'MUSE_PROVIDER_REDIRECT_REJECTED');assert.equal(r.calls(),1);assert.equal(r.budget.summary().enabled,false);
});
test('only the exact reproduced pre-provider failure can be reconciled without extending the allowance',async()=>{
  const r=rig(),id='c457c7c1-3e08-4d01-8eee-5ae4aa559589';
  r.ctx.saved.set('attempts',[{id,status:'FAILED_OR_UNCERTAIN',error:'MUSE_SCAN_UNAVAILABLE',reservedUsd:.05}]);
  const held=new MuseBudget(r.ctx,r.env);await held.ready;assert.equal(held.summary().enabled,false);
  r.env.PREFLIGHT_RECONCILIATION='0c61dd02052426a2407dd2957b18c07c9ed5710b5b0f80fca277a24b2643ab71';
  const reconciled=new MuseBudget(r.ctx,r.env);await reconciled.ready;
  assert.equal(reconciled.summary().remainingScans,4);assert.equal(reconciled.summary().reservedUsd,.05);assert.equal(reconciled.summary().reconciledPreProviderAttempts,1);assert.equal(r.calls(),0);
  r.ctx.saved.set('attempts',[{id:randomUUID(),status:'FAILED_OR_UNCERTAIN',error:'MUSE_SCAN_UNAVAILABLE'}]);
  const other=new MuseBudget(r.ctx,r.env);await other.ready;assert.equal(other.summary().enabled,false);
});
