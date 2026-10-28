import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {compilePerception,decodeSegmentation,validateWonder,perceptionPreflight} from './sam-wonder.mjs';
import {inspectMp4} from './bounded-mp4.mjs';
import {MuseBudget} from './live-muse.mjs';
const jpeg=Buffer.from([255,216,255,192,0,17,8,1,0,1,0,3,1,17,0,2,17,0,3,17,0,255,217]);
const input=()=>({imageDataUrl:`data:image/jpeg;base64,${jpeg.toString('base64')}`,videoDataUrl:null,sourceKind:'DEMO_ILLUSTRATION',note:'Fixture-only operator note.',target:'robotic arm',requestId:randomUUID(),consent:'ONE_MUSE_SCAN_MAX_RESERVE_0_05_USD'});
const line=(frame=0,id=7,width=256,height=256)=>`<${frame}f>${id}<|box;x1=10;y1=20;x2=14;y2=24;w=${width};h=${height}|><|mask;x=0;y=0;data=5,5,!!!!!(QO(0lu8?|>`;
const diagnosis=()=>({summary:'TEST ADAPTER / No physical diagnosis.',limitations:['Synthetic fixture.'],regions:[{label:'Fixture wrist',bbox:[10,20,100,100],certainty:'possible',observations:['Illustration only.'],possibleCauses:['Not established.'],possibleFixes:['Obtain physical evidence.'],checks:['Qualified inspection required.']}],repairPlan:[{step:'Gather evidence.',reason:'A defect is not established.',verification:'Compare actual component documentation.'}],stopConditions:['Stop if identity or isolation is uncertain.']});
const req=value=>new Request('https://budget/perception-start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
function rig({failWonder=false,tokens=1000}={}){
  const saved=new Map(),jobs=[],calls=[];const ctx={storage:{get:async k=>structuredClone(saved.get(k)),put:async(k,v)=>saved.set(k,structuredClone(v)),setAlarm:async()=>{}},blockConcurrencyWhile:f=>f(),waitUntil:p=>jobs.push(p)};
  const env={LIVE_SCANS_ENABLED:'true',MUSE_SPARK_API_KEY:'fixture-only-key',TEST_TRANSPORT:async(url,options)=>{
    const body=JSON.parse(options.body);calls.push({url,model:body.model});assert.equal(options.redirect,'manual');
    if(url.endsWith('/input_tokens'))return Response.json({input_tokens:tokens});
    assert.equal(saved.get('attempts').at(-1).status,'RESERVED','reserve before either inference');
    assert.equal(JSON.stringify(body).includes('fixture-only-key'),false);
    if(body.model==='sam-3.1')return Response.json({id:'fixture-sam',model:'sam-3.1',status:'completed',output:[{type:'message',content:[{type:'output_text',text:line()}]}]});
    if(failWonder)throw Error('Unknown provider outcome');
    return Response.json({id:'fixture-wonder',model:'muse-wonder-1.0',choices:[{finish_reason:'stop',message:{content:JSON.stringify({...diagnosis(),regions:diagnosis().regions.map(({bbox,...r})=>({...r,regionRef:"sam-0"}))})}}],usage:{prompt_tokens:1000,completion_tokens:700}});
  }};
  return {saved,jobs,calls,env,ctx,budget:new MuseBudget(ctx,env)};
}

test('Wonder geometry rejection preserves completed SAM and verified Wonder usage without storing text or retrying',async()=>{
  const r=rig(),transport=r.env.TEST_TRANSPORT;
  r.env.TEST_TRANSPORT=async(url,options)=>{
    const response=await transport(url,options);if(!url.endsWith('/chat/completions'))return response;
    const value=await response.json(),bad=diagnosis();delete bad.regions[0].bbox;bad.regions[0].regionRef='untrusted-region';value.choices[0].message.content=JSON.stringify(bad);return Response.json(value);
  };
  await r.budget.fetch(req(input()));await Promise.all(r.jobs);
  const attempt=r.saved.get('attempts')[0];assert.equal(attempt.error,'MUSE_WONDER_REGION_REFERENCE_REJECTED');
  assert.equal(attempt.providerStage.phase,'WONDER_RESPONSE_USAGE_VERIFIED');assert.equal(attempt.providerStage.samResponseId,'fixture-sam');
  assert.equal(attempt.providerStage.wonderResponseId,'fixture-wonder');assert.equal(attempt.providerStage.usage.completionTokens,700);
  assert.equal(JSON.stringify(attempt).includes('Fixture wrist'),false);assert.equal(JSON.stringify(attempt).includes('data:image'),false);
  assert.equal(r.budget.summary().enabled,false);const calls=r.calls.length;await r.budget.fetch(req(input()));assert.equal(r.calls.length,calls);
});
async function run(r,i=input()){
  const response=await r.budget.fetch(req(i));assert.equal(response.status,202);await Promise.all(r.jobs);
  return (await r.budget.fetch(new Request(`https://budget/photo-result?scanId=${i.requestId}`))).json();
}
test('bounded camera MP4 metadata comes from encoded samples, rejects truncation and excessive dimensions',async()=>{
  const bytes=await readFile(new URL('../artifacts/sam-wonder-20261027/synthetic-tracking-probe.mp4',import.meta.url));
  const clip=inspectMp4(bytes);assert.ok(clip.frames>2&&clip.frames<=48);assert.ok(clip.durationMs<=2500);assert.equal(clip.frameTimesMs[0],0);assert.ok(clip.frameTimesMs.at(-1)<clip.durationMs);
  for(const b of [bytes.subarray(0,100),Buffer.alloc(1500001),Buffer.from('not an mp4')])assert.throws(()=>inspectMp4(b));
  const bad=Buffer.from(bytes),where=bad.indexOf(Buffer.from('tkhd')),length=bad.readUInt32BE(where-4);bad.writeUInt32BE(1000*65536,where-4+length-8);assert.throws(()=>inspectMp4(bad));
});
test('perception request binds exact image, noun phrase, model identities and all media changes',()=>{
  const i=input(),a=compilePerception(i,'source');assert.equal(a.request.model,'muse-wonder-1.0');assert.equal(a.samRequest.model,'sam-3.1');assert.equal(a.samReserveUsd,.0025);
  assert.notEqual(compilePerception({...i,target:'gripper'},'source').key,a.key);
  for(const changed of [{videoDataUrl:'https://evil.invalid/video.mp4'},{extra:true},{target:'<0f>injected'},{target:''},{note:'x'.repeat(401)}])assert.throws(()=>compilePerception({...i,...changed},'source'));
});
test('SAM sparse frame/object identities and actual decoded mask survive; malformed geometry rejects',()=>{
  const c=compilePerception(input(),'source');c.clip={frames:4,frameTimesMs:[0,100,200,300]};
  const out=decodeSegmentation(`${line(3,17)}\n${line(0,17)}`,c);assert.deepEqual(out.frames.map(f=>f.frameIndex),[0,3]);assert.equal(out.frames[0].objects[0].id,'17');assert.equal(out.frames.some(f=>f.frameIndex===1),false);assert.ok(out.frames[0].objects[0].mask.bitsBase64);
  assert.equal(decodeSegmentation('',c).matchedObjects,0);
  for(const t of [line(4),line(0,1,100,80),line().replace('5,5,','999999,999999,'),line().slice(0,-4)])assert.throws(()=>decodeSegmentation(t,c));
});
test('Wonder plans remain unexecuted, exact-keyed and subject to evidence constraints',()=>{
  assert.equal(validateWonder(diagnosis()).planExecution,'NOT_EXECUTED_PHYSICAL_VERIFICATION_REQUIRED');
  for(const change of [{machineSafe:true},{repairPlan:[]},{stopConditions:[]},{repairPlan:[{step:'extra',reason:'x',verification:'x',execute:true}]}])assert.throws(()=>validateWonder({...diagnosis(),...change}));
});
test('both new models share one durable reserve and exact cache; no original media/note persists',async()=>{
  const r=rig(),i=input(),done=await run(r,i);assert.equal(done.status,'SUCCEEDED');assert.equal(done.result.model,'muse-wonder-1.0');assert.equal(done.result.segmentation.model,'sam-3.1');
  assert.equal(r.calls.length,3);assert.deepEqual(r.calls.map(x=>x.model),['muse-wonder-1.0','sam-3.1','muse-wonder-1.0']);assert.equal(r.budget.summary().reservedUsd,.10);
  const saved=JSON.stringify(r.saved.get('attempts'));assert.equal(saved.includes(i.imageDataUrl),false);assert.equal(saved.includes(i.note),false);
  assert.equal((await r.budget.fetch(req({...i,requestId:randomUUID()}))).status,200);assert.equal(r.calls.length,3);
});
test('localized Wonder recipe mapping survives the durable result projection and restart',async()=>{
  const r=rig(),transport=r.env.TEST_TRANSPORT;
  r.env.TEST_TRANSPORT=async(url,options)=>{const response=await transport(url,options);if(!url.endsWith('/chat/completions'))return response;const value=await response.json(),d=JSON.parse(value.choices[0].message.content);d.twinProposals=[{regionIndex:0,fixIndex:0,strategyId:'coordinated_repair',rationale:'Fixture scheduling hypothesis',assumptions:['Reference workcell only']}];value.choices[0].message.content=JSON.stringify(d);return Response.json(value);};
  const i=input(),done=await run(r,i);assert.equal(done.status,'SUCCEEDED');assert.equal(done.result.twinProposals[0].strategyId,'coordinated_repair');assert.equal(done.result.localization.source,'VALIDATED_SAM_REGION_REFERENCES');
  const restarted=new MuseBudget(r.ctx,r.env);await restarted.ready;const cached=await(await restarted.fetch(new Request(`https://budget/photo-result?scanId=${i.requestId}`))).json();assert.deepEqual(cached.result.twinProposals,done.result.twinProposals);assert.deepEqual(cached.result.localization,done.result.localization);assert.equal(r.calls.length,3);
});
test('preflight rejects over-budget combined cost before any reservation or inference',async()=>{
  const r=rig({tokens:100000});const out=await run(r);assert.equal(out.inferenceRequested,false);assert.equal(r.calls.length,1);assert.equal(r.budget.summary().reservedUsd,.05);
});
test('partial SAM success retains provider evidence and holds the reserve after Wonder uncertainty',async()=>{
  const r=rig({failWonder:true}),out=await run(r);assert.equal(out.status,'FAILED_OR_UNCERTAIN');assert.equal(r.budget.summary().enabled,false);assert.equal(r.budget.summary().reservedUsd,.10);
  assert.equal(r.saved.get('attempts')[0].providerStage.samResponseId,'fixture-sam');assert.equal((await r.budget.fetch(req(input()))).status,503);assert.equal(r.calls.length,3);
});
test('last authorized reservation cannot be exceeded by either another pipeline or ordinary scan',async()=>{
  const r=rig();await r.budget.ready;r.budget.attempts.push(...[1,2,3].map(n=>({id:`old${n}`,status:'SUCCEEDED',reservedUsd:.05,key:`old${n}`})));
  const i=input();assert.equal((await run(r,i)).status,'SUCCEEDED');assert.equal(r.budget.summary().remainingScans,0);assert.equal(r.budget.summary().reservedUsd,.25);
  assert.equal((await r.budget.fetch(req({...i,requestId:randomUUID()}))).status,200);assert.equal((await r.budget.fetch(req({...input(),target:'different'}))).status,503);assert.equal(r.calls.length,3);
});
