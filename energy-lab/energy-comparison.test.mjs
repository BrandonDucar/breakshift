import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONTEXT as C } from '../uncertainty-lab/repair-envelope.mjs';
import { sha256Hex } from '../session/inspection-session-core.mjs';
import { createEnergyComparison, replayEnergyComparison } from './energy-comparison.mjs';
const patch={armPowerScale:.85,beltSpeedMps:.4,surgeGapMs:200,timingCompensationMs:20};
const nominal={loadMultiplier:1,sensorDelayMs:0,jitterAMs:0,jitterBMs:0};
const stress={loadMultiplier:1.12,sensorDelayMs:40,jitterAMs:15,jitterBMs:-15};
test('lower peak power does not masquerade as lower batch energy',()=>{
  const r=createEnergyComparison(patch,C,nominal);
  assert.equal(r.reference.trace.passed,true);assert.equal(r.proposed.trace.passed,true);
  assert(r.difference.peakReductionW>226);assert(r.difference.batchEnergyChangeWh>0);
  assert.equal(r.difference.windowChangeMs,750);assert(r.difference.whPerSuccessfulModeledPartChange>0);
  assert.equal(r.limits.tariffOrMoneySavingsClaim,false);assert.equal(r.limits.physicalEnergyMeasured,false);
});
test('failed output has no invented Wh per good part or throughput',()=>{
  const r=createEnergyComparison(patch,C,stress);assert.equal(r.reference.trace.passed,false);assert.equal(r.reference.metrics.modeledPacked,0);
  assert.equal(r.reference.metrics.whPerSuccessfulModeledPart,null);assert.equal(r.reference.metrics.batchEquivalentPartsPerMinute,null);
  assert.equal(r.difference.successfulOutputComparable,false);assert.equal(r.difference.whPerSuccessfulModeledPartChange,null);
  assert.equal(r.proposed.trace.passed,true);assert.equal(r.proposed.metrics.windowMs,2350);
});
test('integrated Wh agrees with event segments and batch-rate denominator uses the same full horizon',()=>{
  const r=createEnergyComparison(patch,C,stress);
  for(const v of [r.reference,r.proposed]){
    const wh=v.trace.segments.reduce((sum,s)=>sum+s.watts*(s.toMs-s.fromMs)/3600000,0);assert.equal(v.metrics.energyWh,wh);
    assert.equal(v.metrics.windowMs,v.trace.jobMs);
    if(v.trace.passed)assert.equal(v.metrics.batchEquivalentPartsPerMinute,v.trace.packed/v.trace.jobMs*60000);
  }
});
test('replay is non-mutating, context-bound, and rejects a freshly rehashed savings claim',()=>{
  const r=createEnergyComparison(patch,C,nominal),before=structuredClone(r);
  assert.deepEqual(replayEnergyComparison(JSON.stringify(r),C).receipt,r);assert.deepEqual(r,before);
  const bad=structuredClone(r);bad.difference.batchEnergyChangeWh=-.1;const {receiptDigest,...body}=bad;bad.receiptDigest=sha256Hex(body);
  assert.throws(()=>replayEnergyComparison(JSON.stringify(bad),C),/ENERGY_REPLAY_MISMATCH/);
  assert.throws(()=>replayEnergyComparison(JSON.stringify(r),{...C,breakerKw:1.45}),/ENERGY_CONTEXT_MISMATCH/);
});
test('infeasible caps, malformed receipts and out-of-envelope disturbances stay rejected',()=>{
  const low={...C,breakerKw:1.45},r=createEnergyComparison(patch,low,stress);assert.equal(r.proposed.trace.passed,false);
  assert.equal(r.proposed.metrics.whPerSuccessfulModeledPart,null);
  for(const t of ['null','[]','bad'])assert.throws(()=>replayEnergyComparison(t,C));
  assert.throws(()=>replayEnergyComparison('x'.repeat(65537),C));assert.throws(()=>createEnergyComparison(patch,C,{...stress,loadMultiplier:5}));
});
