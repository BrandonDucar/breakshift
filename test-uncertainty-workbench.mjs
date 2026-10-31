import test from 'node:test';
import assert from 'node:assert/strict';
import projection from './public/verified-uncertainty-patch.json' with {type:'json'};
import { createUncertaintySession,validateRecordedPatch } from './public/uncertainty-session.mjs';
import { sha256Hex } from './session/inspection-session-core.mjs';
const rig=()=>{let current={snapshotId:'snap-ui-1',breakerKw:1.65,available:true};const s=createUncertaintySession({recordedPatch:projection,getContext:()=>current});return {s,update:v=>{current={...current,...v};}};};
test('workbench needs a deliberate check and clearly separates reference and recorded model',()=>{
  const {s}=rig();assert.equal(s.state().canExport,false);assert.throws(()=>s.exportReceipt());
  assert.equal(s.run().experiment.result.nominal.passed,true);assert.equal(s.state().latest.experiment.result.verdict,'REFUTED_WITHIN_DECLARED_ENVELOPE');
  s.setSelection('muse');assert.equal(s.state().canExport,false);const r=s.run();assert.equal(r.source.model,'muse-spark-1.3');assert.equal(r.experiment.result.verdict,'SUPPORTED_WITHIN_DECLARED_ENVELOPE');
});
test('selection, snapshot, cap and bounds invalidate the old result even if restored',()=>{
  for(const change of ['selection','snapshot','cap','bounds']){
    const {s,update}=rig();s.setSelection('muse');s.run();
    if(change==='selection')s.setSelection('reference');if(change==='snapshot')update({snapshotId:'snap-2'});if(change==='cap')update({breakerKw:1.45});if(change==='bounds')s.setBounds({loadMax:1.3,delayMaxMs:40,jitterMs:15});
    s.sync();assert.equal(s.state().stale,true);assert.throws(()=>s.exportReceipt());
    update({snapshotId:'snap-ui-1',breakerKw:1.65});assert.throws(()=>s.exportReceipt());
  }
});
test('tight current cap and broad timing interval lead to a finite rejected result',()=>{
  const {s,update}=rig();s.setSelection('muse');update({breakerKw:1.4});assert.equal(s.run().experiment.result.verdict,'REFUTED_WITHIN_DECLARED_ENVELOPE');
  update({breakerKw:1.65});s.setBounds({loadMax:1.12,delayMaxMs:100,jitterMs:15});assert.equal(s.run().experiment.result.challenger.reasons.includes('GRASP_TIMING_MISS'),true);
});
test('download and replay recompute without changing current workbench state',()=>{
  const {s}=rig();s.setSelection('muse');s.run();const bytes=JSON.stringify(s.exportReceipt()),before=s.state();
  const reviewed=s.reviewReceipt(bytes);assert.equal(reviewed.sourceAuthenticated,false);assert.equal(reviewed.currentStateChanged,false);assert.deepEqual(s.state(),before);
});
test('rehashed forged outcome and provider attribution are rejected',()=>{
  const {s}=rig();const r=s.run();for(const mutate of [r=>{r.experiment.result.verdict='SUPPORTED_WITHIN_DECLARED_ENVELOPE';},r=>{r.source.model='muse-spark-1.3';},r=>{r.physicalClearance=true;},r=>{r.experiment.plan.candidate.armPowerScale=.85;}]){
    const bad=structuredClone(r);mutate(bad);const {receiptDigest,...body}=bad;bad.receiptDigest=sha256Hex(body);assert.throws(()=>s.reviewReceipt(JSON.stringify(bad)));
  }
});
test('old-context import, oversized files and unavailable context cannot yield a green',()=>{
  const {s,update}=rig();s.run();const bytes=JSON.stringify(s.exportReceipt());update({snapshotId:'snap-new'});assert.throws(()=>s.reviewReceipt(bytes));assert.throws(()=>s.reviewReceipt('x'.repeat(49153)));update({available:false});assert.throws(()=>s.run());
});
test('projection only admits the exact recorded plan and never authority',()=>{
  assert.deepEqual(validateRecordedPatch(projection),projection);for(const delta of [{executionAuthority:true},{model:'unknown'},{sourceArtifactSha256:'x'},{candidate:{...projection.candidate,armPowerScale:.8}}])assert.throws(()=>validateRecordedPatch({...projection,...delta}));
});
test('worst trace matches analytic peak and invalid controls do not erase last result',()=>{
  const {s}=rig();s.setSelection('muse');s.run();assert.equal(s.worstTrace().peakW,s.state().latest.experiment.result.challenger.worstPeakW);
  const before=s.state();assert.throws(()=>s.setBounds({loadMax:NaN,delayMaxMs:40,jitterMs:15}));assert.deepEqual(s.state(),before);
});

test('existing manufacturer references cannot inherit a simulator green or run an unqualified adapter',()=>{
  const {s}=rig();s.setSelection('muse');s.run();
  for(const profile of s.state().profiles.filter(p=>p.qualification!=='SIMULATOR_FIXTURE_ONLY')){
    s.setAsset(profile.assetId);assert.equal(s.state().canRun,false);assert.equal(s.state().canExport,false);assert.throws(()=>s.run(),/ROBOT_ADAPTER_UNQUALIFIED/);
  }
  s.setAsset('breakshift-reference-cell');assert.throws(()=>s.exportReceipt());assert.equal(s.run().experiment.result.verdict,'SUPPORTED_WITHIN_DECLARED_ENVELOPE');
});
test('receipt review has controlled errors for primitive inputs and never mutates state',()=>{
  const {s}=rig();const before=s.state();
  for(const text of ['null','42','[]','{}'])assert.throws(()=>s.reviewReceipt(text),/UNCERTAINTY_PUBLIC_SOURCE_INVALID/);
  assert.deepEqual(s.state(),before);
});

test('saved receipts cannot qualify another robot or restore stale export authority',()=>{
  const {s}=rig();s.setSelection('muse');s.run();const saved=JSON.stringify(s.exportReceipt());
  for(const profile of s.state().profiles.filter(p=>p.qualification!=='SIMULATOR_FIXTURE_ONLY')){
    s.setAsset(profile.assetId);const before=s.state();
    assert.throws(()=>s.reviewReceipt(saved),/ROBOT_ADAPTER_UNQUALIFIED/);
    assert.deepEqual(s.state(),before);assert.equal(s.state().canExport,false);
  }
  s.setAsset('breakshift-reference-cell');const before=s.state();
  assert.equal(s.reviewReceipt(saved).currentStateChanged,false);assert.deepEqual(s.state(),before);
  assert.equal(s.state().stale,true);assert.throws(()=>s.exportReceipt(),/UNCERTAINTY_STALE_EXPORT_BLOCKED/);
});

test('AR-UI-01: plotted energy horizon follows maximum delay even when timing error peaks at zero',()=>{
  const {s}=rig();s.setSelection('muse');
  for(const delayMaxMs of [0,5,20,35,40]){
    s.setBounds({loadMax:1.12,delayMaxMs,jitterMs:15});const receipt=s.run(),trace=s.worstTrace();
    assert.equal(trace.input.sensorDelayMs,delayMaxMs);assert.equal(trace.jobMs,receipt.experiment.result.challenger.jobMs);
    assert.equal(trace.segments.at(-1).toMs,trace.jobMs);assert.equal(trace.peakW,receipt.experiment.result.challenger.worstPeakW);
  }
});
