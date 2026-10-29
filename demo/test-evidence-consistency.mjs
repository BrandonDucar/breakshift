import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyDemoEvidence,pinDemoInput} from './evidence-consistency.mjs';
import {createUncertaintySession} from '../public/uncertainty-session.mjs';
import {DEFAULT_CONTEXT,BASELINE} from '../uncertainty-lab/repair-envelope.mjs';
import patch from '../public/verified-uncertainty-patch.json' with {type:'json'};
import {createEnergyComparison} from '../energy-lab/energy-comparison.mjs';
import {sha256Hex,canonicalJson} from '../session/inspection-session-core.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const input={loadMultiplier:1,sensorDelayMs:0,jitterAMs:0,jitterBMs:0};
function fixture(){
  const story={mode:'LOCAL_OFFLINE_RECORDED_MODEL_REPLAY',shots:[{id:'proof',start:0,end:10}]};
  const tapText='TAP version 13\n1..3\nok 1 - a\nok 2 - b\nok 3 - c\n# tests 3\n# suites 0\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 12\n';
  const capture={schema:'breakshift.demo-capture.v1',incrementalSpendUsd:0,productionChanged:false,teachingRuntimeContacted:false,passed:true,recording:true,mode:story.mode,providerCalls:0,errors:[],blockedRequests:[],checks:[{id:'proof',passed:true,startSeconds:0,actionsCompleteSeconds:1}],testOutputSha256:hash(tapText),testSummary:[]};
  const session=createUncertaintySession({getContext:()=>DEFAULT_CONTEXT,recordedPatch:patch});session.setSelection('muse');
  const f={story,capture,tapText,experimentText:JSON.stringify(session.run()),energyText:JSON.stringify(createEnergyComparison(patch.candidate,DEFAULT_CONTEXT,input))};
  bindTap(f);f.bindings={captureSha256:hash(canonicalJson(capture)),tapSha256:hash(f.tapText),experimentSha256:hash(f.experimentText),energySha256:hash(f.energyText)};return f;
}
function bindTap(f){f.capture.testOutputSha256=hash(f.tapText);f.capture.testSummary=f.tapText.split('\n').filter(s=>/^# (tests|pass|fail|duration_ms) /.test(s));}
function changeExperiment(f,fn){const r=JSON.parse(f.experimentText);fn(r);const {receiptDigest,...body}=r;r.receiptDigest=sha256Hex(body);f.experimentText=JSON.stringify(r);}
test('bound complete capture and recomputed sidecars pass without source authentication',()=>{
  const f=fixture(),before=JSON.stringify(f),r=verifyDemoEvidence(f);
  assert.equal(r.passed,3);assert.equal(r.energyReplay,'RECOMPUTED_MATCH');assert.equal(r.sourceAuthenticated,false);assert.equal(JSON.stringify(f),before);
});
test('a changed TAP byte cannot be sealed against the original capture',()=>{const f=fixture();f.tapText+='extra';assert.throws(()=>verifyDemoEvidence(f),/DEMO_TEST_OUTPUT_BINDING/);});
for(const [name,from,to] of [['failed','pass 3','pass 2'],['failed-counter','fail 0','fail 1'],['skipped','skipped 0','skipped 1'],['cancelled','cancelled 0','cancelled 1'],['todo','todo 0','todo 1']]){
  test(`a rehashed ${name} test-run summary is rejected`,()=>{const f=fixture();f.tapText=f.tapText.replace(from,to);bindTap(f);assert.throws(()=>verifyDemoEvidence(f));});
}
test('duplicate or missing test counters fail closed',()=>{for(const mutate of [s=>s+'# pass 3\n',s=>s.replace('# fail 0\n','')]){const f=fixture();f.tapText=mutate(f.tapText);bindTap(f);assert.throws(()=>verifyDemoEvidence(f),/DEMO_TAP_SUMMARY/);}});
test('checkpoint failures or reordered identities cannot hide under passed:true',()=>{for(const mutate of [f=>f.capture.checks[0].passed=false,f=>f.capture.checks[0].id='other']){const f=fixture();mutate(f);assert.throws(()=>verifyDemoEvidence(f),/DEMO_CHECKPOINT/);}});
test('captured errors, blocked requests or provider activity reject the offline claim',()=>{for(const mutate of [f=>f.capture.errors.push('error'),f=>f.capture.blockedRequests.push('request'),f=>f.capture.providerCalls=1]){const f=fixture();mutate(f);assert.throws(()=>verifyDemoEvidence(f),/DEMO_CAPTURE/);}});
test('rehashed physical clearance and forged experiment verdicts are rejected',()=>{for(const fn of [r=>r.physicalClearance=true,r=>r.experiment.result.verdict='PHYSICAL_REPAIR_VERIFIED']){const f=fixture();changeExperiment(f,fn);assert.throws(()=>verifyDemoEvidence(f));}});
test('a different source selection cannot replace the captured recorded patch',()=>{const f=fixture();changeExperiment(f,r=>r.source.selection='reference');assert.throws(()=>verifyDemoEvidence(f),/DEMO_EXPERIMENT_SELECTION/);});
test('a self-consistent experiment with changed numerical bounds is rejected',()=>{const f=fixture();const ctx={...DEFAULT_CONTEXT,breakerKw:1.45};const s=createUncertaintySession({getContext:()=>ctx,recordedPatch:patch});s.setSelection('muse');f.experimentText=JSON.stringify(s.run());assert.throws(()=>verifyDemoEvidence(f),/DEMO_EXPERIMENT_BREAKER/);});
test('rehashed energy savings or physical-clearance claims cannot pass recomputation',()=>{for(const fn of [r=>r.difference.batchEnergyChangeWh=-10,r=>r.physicalClearance=true]){const f=fixture(),r=JSON.parse(f.energyText);fn(r);const {receiptDigest,...body}=r;r.receiptDigest=sha256Hex(body);f.energyText=JSON.stringify(r);assert.throws(()=>verifyDemoEvidence(f),/ENERGY_REPLAY_MISMATCH/);}});
test('even valid energy replay must use the recorded proposal and expected context',()=>{for(const r of [createEnergyComparison(BASELINE,DEFAULT_CONTEXT,input),createEnergyComparison(patch.candidate,{...DEFAULT_CONTEXT,snapshotId:'other-snapshot'},input)]){const f=fixture();f.energyText=JSON.stringify(r);assert.throws(()=>verifyDemoEvidence(f),/DEMO_ENERGY_CANDIDATE|ENERGY_CONTEXT_MISMATCH/);}});

test('summary-only, bailout, nested failure, skip, and false TAP plans are rejected',()=>{
  for(const mutate of [s=>s.replace(/^ok .*\n/gm,''),s=>s+'Bail out!\n',s=>s+'  not ok 1 - nested\n',s=>s.replace('ok 1 - a','ok 1 - a # SKIP'),s=>s.replace('1..3','1..2'),s=>s.replace('ok 2 - b','ok 1 - b')]) {
    const f=fixture();f.tapText=mutate(f.tapText);bindTap(f);assert.throws(()=>verifyDemoEvidence(f),/DEMO_TAP/);
  }
});
test('a valid sidecar from a different snapshot or disturbance is not this recording',()=>{
  const f=fixture(),s=createUncertaintySession({getContext:()=>({...DEFAULT_CONTEXT,snapshotId:'unrelated'}),recordedPatch:patch});s.setSelection('muse');f.experimentText=JSON.stringify(s.run());assert.throws(()=>verifyDemoEvidence(f),/DEMO_EVIDENCE_BINDING_experiment/);
  const g=fixture();g.energyText=JSON.stringify(createEnergyComparison(patch.candidate,DEFAULT_CONTEXT,{...input,loadMultiplier:1.12}));assert.throws(()=>verifyDemoEvidence(g),/DEMO_ENERGY_NOMINAL_INPUT/);
});
test('contradictory capture boundaries and impossible shot timing fail closed',()=>{
  for(const mutate of [c=>c.incrementalSpendUsd=150.01,c=>c.teachingRuntimeContacted=true,c=>c.productionChanged=true,c=>c.physicalClearance=true,c=>c.schema='other',c=>c.checks[0].startSeconds=-1,c=>c.checks[0].actionsCompleteSeconds=11,c=>c.checks[0].actionsCompleteSeconds=-1]) {
    const f=fixture();mutate(f.capture);assert.throws(()=>verifyDemoEvidence(f),/DEMO_CAPTURE|DEMO_CHECKPOINT/);
  }
});
test('sealing may not replace a validated input with later bytes',()=>{
  const pins=new Map();
  const first=Buffer.from('validated passing TAP'),same=Buffer.from(first);
  assert.equal(pinDemoInput(pins,'tap',first),first);
  assert.equal(pinDemoInput(pins,'tap',same),same);
  assert.throws(()=>pinDemoInput(pins,'tap',Buffer.from('replacement failing TAP')),/DEMO_INPUT_CHANGED_DURING_VERIFICATION/);
});
