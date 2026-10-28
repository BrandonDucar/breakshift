import test from 'node:test';
import assert from 'node:assert/strict';
import {MuseBudget} from './live-muse.mjs';
const extension=n=>({id:'primo-photos-clips-20261027-01',additionalScans:n,additionalReserveCents:n*5});
function rig(){
  const historical=[{id:'old-text',status:'SUCCEEDED'},{id:'old-image',status:'SUCCEEDED'},{id:'old-combined',status:'SUCCEEDED'},{id:'779ea93e-b693-46a2-9ec3-9b04ecbabb03',status:'OWNER_REVIEWED_UNCERTAIN'},{id:'pre-provider',status:'REJECTED_BEFORE_PROVIDER'}];
  const saved=new Map([['attempts',historical]]);const ctx={storage:{get:async k=>structuredClone(saved.get(k)),put:async(k,v)=>saved.set(k,structuredClone(v))},blockConcurrencyWhile:f=>f()};
  const env={LIVE_SCANS_ENABLED:'true',MUSE_SPARK_API_KEY:'fixture-key-no-provider'};return {ctx,env,saved,historical};
}
test('20, 40 or 100 additional shared scans retain every historic charge and exact dollar ceiling',async()=>{
  for(const n of [20,40,100]){
    const r=rig();r.env.SCAN_ALLOWANCE_EXTENSION=extension(n);const b=new MuseBudget(r.ctx,r.env);await b.ready;const s=b.summary();
    assert.equal(s.enabled,true);assert.equal(s.remainingScans,n);assert.equal(s.totalApprovedScans,5+n);assert.equal(s.reservedUsd,.25);assert.equal(s.budgetUsd,.25+n*.05);
    assert.deepEqual(r.saved.get('attempts'),r.historical);
    for(let i=0;i<n;i++)b.attempts.push({id:`new${i}`,status:'SUCCEEDED'});
    assert.equal(b.summary().remainingScans,0);assert.equal(b.summary().enabled,false);assert.equal(b.summary().reservedUsd,s.budgetUsd);
  }
});
test('restarts or redeployment cannot duplicate a grant; changing an existing grant ID fails closed',async()=>{
  const r=rig();r.env.SCAN_ALLOWANCE_EXTENSION=extension(20);
  for(let i=0;i<3;i++){const b=new MuseBudget(r.ctx,r.env);await b.ready;assert.equal(b.summary().remainingScans,20);assert.equal(r.saved.get('allowanceExtensions').length,1);}
  r.env.SCAN_ALLOWANCE_EXTENSION=extension(40);const changed=new MuseBudget(r.ctx,r.env);await changed.ready;assert.equal(changed.summary().enabled,false);assert.equal(changed.summary().reason,'MUSE_ALLOWANCE_CONFIG_CONFLICT');assert.equal(r.saved.get('allowanceExtensions')[0].additionalScans,20);
});
test('no configuration means no increase; malformed dollar/count config never enables paid requests',async()=>{
  const r=rig();const original=new MuseBudget(r.ctx,r.env);await original.ready;assert.equal(original.summary().remainingScans,0);assert.equal(original.summary().budgetUsd,.25);
  for(const value of ['not json',{...extension(20),additionalReserveCents:5},{...extension(20),extra:true},extension(-1)]){r.env.SCAN_ALLOWANCE_EXTENSION=value;const b=new MuseBudget(r.ctx,r.env);await b.ready;assert.equal(b.summary().enabled,false);assert.equal(b.summary().reason,'MUSE_ALLOWANCE_CONFIG_INVALID');}
  assert.equal(r.saved.has('allowanceExtensions'),false);
});
test('an allowance increase does not remove uncertainty holds or a disabled live-scan switch',async()=>{
  const r=rig();r.env.SCAN_ALLOWANCE_EXTENSION=extension(20);r.saved.get('attempts').push({id:'new-unknown',status:'FAILED_OR_UNCERTAIN'});
  const b=new MuseBudget(r.ctx,r.env);await b.ready;assert.equal(b.summary().enabled,false);assert.equal(b.summary().reason,'MUSE_LEDGER_RECONCILIATION_REQUIRED');assert.equal(b.summary().remainingScans,19);
  r.saved.set('attempts',r.historical.slice(0,5));r.env.LIVE_SCANS_ENABLED='false';const disabled=new MuseBudget(r.ctx,r.env);await disabled.ready;assert.equal(disabled.summary().enabled,false);
});
test('allowance registration must persist before it can enable another paid scan',async()=>{
  const r=rig();r.env.SCAN_ALLOWANCE_EXTENSION=extension(20);r.ctx.storage.put=async()=>{throw Error('storage unavailable');};
  const b=new MuseBudget(r.ctx,r.env);await b.ready;assert.equal(b.summary().enabled,false);assert.equal(b.summary().reason,'MUSE_LEDGER_RECONCILIATION_REQUIRED');assert.equal(b.summary().remainingScans,0);
});

test('forty large private results remain individually bounded and readable after restart',async()=>{
  const r=rig();r.env.SCAN_ALLOWANCE_EXTENSION=extension(40);
  const put=r.ctx.storage.put;r.ctx.storage.put=async(k,v)=>{assert.ok(Buffer.byteLength(JSON.stringify(v))<131072,'No aggregate result blob may exceed a single-record ceiling');await put(k,v);};
  const b=new MuseBudget(r.ctx,r.env);await b.ready;
  for(let i=0;i<40;i++){
    const id=`cache${i}`,result={id,privateAssessment:'x'.repeat(80000),expiresAt:new Date(Date.now()+86400000).toISOString()};
    b.attempts.push({id,status:'SUCCEEDED',kind:'PHOTO_VISUAL_ASSESSMENT',resultStoredSeparately:true,resultExpiresAt:result.expiresAt,result});
    await r.ctx.storage.put(`result:${id}`,result);await b.persistLedger();
  }
  assert.equal(b.summary().reservedUsd,2.25);assert.equal(b.summary().remainingScans,0);
  assert.equal(r.saved.get('attempts').some(a=>a.resultStoredSeparately&&a.result),false);
  const restored=new MuseBudget(r.ctx,r.env);await restored.ready;assert.equal(restored.attempts.find(a=>a.id==='cache39').result.privateAssessment.length,80000);assert.equal(restored.summary().remainingScans,0);
  for(const a of restored.attempts.filter(a=>a.resultStoredSeparately))a.result.expiresAt=new Date(Date.now()-1).toISOString();
  await restored.expirePhotos();assert.equal(r.saved.get('result:cache39'),null);assert.equal(restored.summary().remainingScans,0);assert.equal(restored.summary().reservedUsd,2.25);
});

test('missing unexpired result is held, while intentionally expired cache never refunds usage',async()=>{
  const r=rig();r.env.SCAN_ALLOWANCE_EXTENSION=extension(40);
  r.saved.get('attempts').push({id:'missing',kind:'PHOTO_VISUAL_ASSESSMENT',status:'SUCCEEDED',resultStoredSeparately:true,resultExpiresAt:new Date(Date.now()+60000).toISOString()});
  const held=new MuseBudget(r.ctx,r.env);await held.ready;assert.equal(held.summary().enabled,false);assert.equal(held.summary().reason,'MUSE_LEDGER_RECONCILIATION_REQUIRED');
  r.saved.get('attempts').at(-1).resultExpiresAt=new Date(Date.now()-1).toISOString();const expired=new MuseBudget(r.ctx,r.env);await expired.ready;assert.equal(expired.summary().enabled,true);assert.equal(expired.summary().remainingScans,39);assert.equal(expired.summary().reservedUsd,.30);
});

test('a held result whose response was lost still expires without restarting the object',async()=>{
  const r=rig(),b=new MuseBudget(r.ctx,r.env);await b.ready;
  const id='lost-result',expiresAt=new Date(Date.now()-1).toISOString();
  b.attempts.push({id,status:'FAILED_OR_UNCERTAIN',kind:'PHOTO_VISUAL_ASSESSMENT',resultStoredSeparately:true,resultExpiresAt:expiresAt});
  await r.ctx.storage.put(`result:${id}`,{expiresAt,privateAssessment:'must expire'});
  await b.expirePhotos();assert.equal(r.saved.get(`result:${id}`),null);assert.equal(b.summary().reservedUsd,.30);assert.equal(b.summary().enabled,false);
});
