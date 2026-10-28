import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {compilePhotoScan,validatePhotoAssessment} from './photo-contract.mjs';
import {MuseBudget,compileScan} from './live-muse.mjs';
import {SCAN_CONSENT} from '../session/muse-diagnosis-contract.mjs';
import {createInspectionSessionCore} from '../session/inspection-session-core.mjs';
// Inert JPEG marker fixture for validation/unit tests only, never model evidence.
const bytes=Buffer.from([255,216,255,192,0,11,8,1,0,1,0,1,1,17,0,255,217]);
const imageDataUrl=`data:image/jpeg;base64,${bytes.toString('base64')}`;
const photo=()=>({imageDataUrl,sourceKind:'DEMO_ILLUSTRATION',note:'fixture-private-note',requestId:randomUUID(),consent:SCAN_CONSENT});
export const photoFixture=()=>({summary:'TEST ADAPTER: illustrative wrist component; no physical fault established.',limitations:['Fixture image assessment only.'],regions:[{label:'Wrist assembly',bbox:[500,200,350,400],certainty:'possible',observations:['Illustrative assembly is visible.'],possibleCauses:['A fault cannot be established from this illustration.'],possibleFixes:['Confirm the actual component condition before choosing service.'],checks:['Obtain a real component image.']}]});
function rig(){
  const saved=new Map();let generations=0,counts=0,alarm;
  const ctx={storage:{get:async k=>structuredClone(saved.get(k)),put:async(k,v)=>{saved.set(k,structuredClone(v));},setAlarm:async value=>{alarm=value;}},blockConcurrencyWhile:fn=>fn()};
  const env={LIVE_SCANS_ENABLED:'true',MUSE_SPARK_API_KEY:'fixture-key-only',TEST_TRANSPORT:async(url,options)=>{
    if(url.endsWith('/input_tokens')){counts++;return new Response(JSON.stringify({input_tokens:1200}));}
    generations++;assert.equal(saved.get('attempts').at(-1).status,'RESERVED');
    return new Response(JSON.stringify({model:'muse-spark-1.3',choices:[{finish_reason:'stop',message:{content:JSON.stringify(photoFixture())}}],usage:{prompt_tokens:1200,completion_tokens:500}}));
  }};
  return {saved,ctx,env,budget:new MuseBudget(ctx,env),generations:()=>generations,counts:()=>counts,alarm:()=>alarm};
}
const req=body=>new Request('https://budget/photo-scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
test('bounded inline JPEG is server-validated; arbitrary URLs, SVGs, dimensions and extra fields reject',()=>{
  const compiled=compilePhotoScan(photo(),'photo-contract-hash');assert.deepEqual(compiled.dimensions,{width:256,height:256});
  assert.equal(compiled.request.messages[1].content[1].type,'image_url');assert.equal(compiled.request.model,'muse-spark-1.3');
  for(const changes of [{imageDataUrl:'https://attacker.invalid/a.jpg'},{imageDataUrl:'data:image/svg+xml;base64,PHN2Zz4='},{sourceKind:'VERIFIED_REAL_HARDWARE'},{note:'x'.repeat(401)},{url:'extra'}])assert.throws(()=>compilePhotoScan({...photo(),...changes},'hash'));
  const huge=Buffer.from(bytes);huge.writeUInt16BE(2000,9);assert.throws(()=>compilePhotoScan({...photo(),imageDataUrl:`data:image/jpeg;base64,${huge.toString('base64')}`},'hash'));
});
test('regions require bounded boxes and separate observations/possible causes/fixes, without machine-safe claims',()=>{
  const good=validatePhotoAssessment(photoFixture());assert.equal(good.regions[0].physicalVerificationRequired,true);
  for(const box of [[900,100,200,100],[-1,0,50,50],[0,0,0,100],[NaN,0,20,20]]){const value=photoFixture();value.regions[0].bbox=box;assert.throws(()=>validatePhotoAssessment(value));}
  assert.throws(()=>validatePhotoAssessment({...photoFixture(),machineSafe:true}));
});
test('image token preflight precedes completion, global reserve precedes generation, and pixels/notes are never stored',async()=>{
  const r=rig(),input=photo();const response=await r.budget.fetch(req(input));assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.kind,'PHOTO_VISUAL_ASSESSMENT');assert.equal(result.sourceKind,'DEMO_ILLUSTRATION');assert.equal(result.physicalVerificationRequired,true);assert.equal(r.counts(),1);assert.equal(r.generations(),1);
  const saved=JSON.stringify(r.saved.get('attempts'));assert.equal(saved.includes(imageDataUrl),false);assert.equal(saved.includes(input.note),false);assert.ok(r.alarm()>Date.now());
});
test('same pixels/context reuse a successful image result without token count, generation or another reserve',async()=>{
  const r=rig(),input=photo();await r.budget.fetch(req(input));const response=await r.budget.fetch(req({...input,requestId:randomUUID()}));assert.equal((await response.json()).cached,true);assert.equal(r.counts(),1);assert.equal(r.generations(),1);assert.equal(r.budget.summary().remainingScans,3);
});

test('box contract is explicit and boundary boxes are never guessed or silently clamped',()=>{
  assert.match(compilePhotoScan(photo(),'hash').request.messages[0].content,/NOT \[left,top,right,bottom\]/);
  for(const bbox of [[0,0,1000,1000],[800,800,200,200],[999,999,1,1]]){
    const value=photoFixture();value.regions[0].bbox=bbox;assert.deepEqual(validatePhotoAssessment(value).regions[0].bbox,bbox);
  }
  for(const bbox of [[800,800,1000,1000],[0,0,1000.001,1000],[1000,999,1,1],[0,0,Infinity,1]]){
    const value=photoFixture();value.regions[0].bbox=bbox;const original=[...bbox];assert.throws(()=>validatePhotoAssessment(value));assert.deepEqual(value.regions[0].bbox,original);
  }
});

test('rejected geometry retains verified provider usage, original error and held reserve across restart',async()=>{
  const r=rig(),transport=r.env.TEST_TRANSPORT;
  r.env.TEST_TRANSPORT=async(url,options)=>{
    const response=await transport(url,options);if(!url.endsWith('/chat/completions'))return response;
    const value=await response.json(),bad=photoFixture();bad.regions[0].bbox=[900,900,200,200];value.choices[0].message.content=JSON.stringify(bad);value.id='fixture-photo-rejected';return Response.json(value);
  };
  const response=await r.budget.fetch(req(photo()));assert.equal(response.status,502);
  assert.equal((await response.json()).error,'MUSE_PHOTO_BOX_OUT_OF_RANGE');
  const attempt=r.saved.get('attempts')[0];assert.equal(attempt.status,'FAILED_OR_UNCERTAIN');
  assert.equal(attempt.providerStage.phase,'RESPONSE_USAGE_VERIFIED');assert.equal(attempt.providerStage.usage.promptTokens,1200);
  assert.equal(attempt.providerStage.responseId,'fixture-photo-rejected');assert.ok(attempt.providerStage.usage.estimatedCostUsd>0);
  assert.equal(JSON.stringify(attempt).includes('observations'),false);assert.equal(JSON.stringify(attempt).includes(imageDataUrl),false);
  const restarted=new MuseBudget(r.ctx,r.env);await restarted.ready;assert.equal(restarted.summary().enabled,false);assert.equal(restarted.summary().reservedUsd,.10);
  const blocked=await restarted.fetch(req(photo()));assert.equal(blocked.status,503);assert.equal(r.generations(),1);
});
test('too-expensive or failed token preflight makes no inference and does not reserve another scan',async()=>{
  const r=rig();r.env.TEST_TRANSPORT=async()=>new Response(JSON.stringify({input_tokens:1000000}));
  const response=await r.budget.fetch(req(photo()));assert.equal(response.status,400);assert.equal((await response.json()).inferenceRequested,false);assert.equal(r.generations(),0);assert.equal(r.budget.summary().remainingScans,4);
});
test('private photo diagnosis text expires while accounting remains intact',async()=>{
  const r=rig();await r.budget.fetch(req(photo()));r.budget.attempts[0].result.expiresAt=new Date(Date.now()-1).toISOString();await r.budget.alarm();
  assert.equal(r.saved.get('attempts')[0].result,undefined);assert.equal(r.saved.get('attempts')[0].photoTextExpired,true);assert.equal(r.budget.summary().remainingScans,3);assert.equal(r.budget.summary().reservedUsd,.10);
});
test('existing hosted component diagnosis remains available after this UI/image extension without paying again',async()=>{
  const r=rig(),state=createInspectionSessionCore().getState();
  await r.budget.ready;
  const input={zoneId:'GANTRY-STA-A',snapshotId:state.evidenceSnapshotId,breakerKw:1.65,requestId:randomUUID(),consent:SCAN_CONSENT};
  const legacy=compileScan(input,'live-433d7ee4a9255371');
  r.budget.attempts.push({id:randomUUID(),key:legacy.key,status:'SUCCEEDED',result:{mode:'LIVE_MUSE',zoneId:input.zoneId,evidenceSnapshotId:input.snapshotId,sourceDigest:'live-433d7ee4a9255371'}});
  const response=await r.budget.fetch(new Request('https://budget/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));
  assert.equal((await response.json()).cached,true);assert.equal(r.generations(),0);
});

test('hosted photo job returns a reference before provider completion; readback never makes another inference',async()=>{
  const r=rig(),jobs=[];r.ctx.waitUntil=work=>jobs.push(work);
  const input=photo();let release;const gate=new Promise(resolve=>release=resolve);
  const transport=r.env.TEST_TRANSPORT;r.env.TEST_TRANSPORT=async(url,options)=>{if(url.endsWith('/chat/completions'))await gate;return transport(url,options);};
  const start=()=>r.budget.fetch(new Request('https://budget/photo-start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));
  const response=await start();assert.equal(response.status,202);assert.equal((await response.json()).scanId,input.requestId);
  assert.equal((await start()).status,409);
  const get=()=>r.budget.fetch(new Request(`https://budget/photo-result?scanId=${input.requestId}`));
  assert.equal((await(await get()).json()).status,'PENDING');
  release();await Promise.all(jobs);
  const done=await(await get()).json();assert.equal(done.status,'SUCCEEDED');assert.equal(done.result.imageDigest,compilePhotoScan(input,'source').imageDigest);
  assert.equal(r.generations(),1);assert.equal((await start()).status,200);assert.equal(r.generations(),1);
});

test('interrupted image reference stays held and private audit does not contain image or assessment text',async()=>{
  const r=rig();await r.budget.ready;r.budget.attempts.push({id:'held-image',kind:'PHOTO_VISUAL_ASSESSMENT',status:'RESERVED',reservedUsd:.05});
  const status=await(await r.budget.fetch(new Request('https://budget/photo-result?scanId=held-image'))).json();
  assert.equal(status.status,'FAILED_OR_UNCERTAIN');assert.equal(r.budget.summary().enabled,false);assert.equal(r.generations(),0);
  const audit=await(await r.budget.fetch(new Request('https://budget/audit'))).text();assert.equal(audit.includes(imageDataUrl),false);assert.equal(audit.includes('possibleFixes'),false);
});

test('owner review resumes only the exact acknowledged image hold and never refunds its reserve',async()=>{
  const r=rig(),id='779ea93e-b693-46a2-9ec3-9b04ecbabb03';await r.budget.ready;
  const original={id,kind:'PHOTO_VISUAL_ASSESSMENT',status:'RESERVED',reservedUsd:.05,measuredInputTokens:869,imageDigest:'4ff059d19b08b5fd7cb3da617f46b6d7971694b2bb71ffa92475a0792008d497'};
  r.saved.set('attempts',[original]);const held=new MuseBudget(r.ctx,r.env);await held.ready;assert.equal(held.summary().enabled,false);
  r.env.REVIEWED_IMAGE_HOLD=id;const resumed=new MuseBudget(r.ctx,r.env);await resumed.ready;
  assert.equal(resumed.summary().enabled,true);assert.equal(resumed.summary().remainingScans,3);assert.equal(resumed.summary().reservedUsd,.10);assert.equal(r.generations(),0);
  for(const changes of [{id:randomUUID()},{imageDigest:'different'},{status:'FAILED_OR_UNCERTAIN'}]){
    r.saved.set('attempts',[{...original,...changes}]);const other=new MuseBudget(r.ctx,r.env);await other.ready;assert.equal(other.summary().enabled,false);
  }
});
