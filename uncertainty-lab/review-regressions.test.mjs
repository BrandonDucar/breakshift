import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONTEXT as C, MODEL, compileEnvelopePlan, evaluateDisturbance, evaluateEnvelope,
  challengeEnvelope, createEnvelopeReceipt, replayEnvelopeReceipt } from './repair-envelope.mjs';
const candidate = {armPowerScale:.85,beltSpeedMps:.4,surgeGapMs:200,timingCompensationMs:20};
const context = {...C,envelope:{...C.envelope,surgeJitterMs:[-.1,.2]}};

test('UR-01a: analytic bound contains the reported strictly interior overlap',()=>{
  const p=compileEnvelopePlan({...candidate,armPowerScale:.750015,surgeGapMs:133.6306667199989},context);
  const c=challengeEnvelope(p), r=evaluateDisturbance(p,{loadMultiplier:1.12,sensorDelayMs:20,jitterAMs:.19999999999999998,jitterBMs:-.09999999999999999});
  assert.equal(c.possibleOverlap,true);assert(r.peakW>2410);assert(r.peakW<=c.worstPeakW+1e-9);assert.equal(c.robustWithinDeclaredModel,false);
});
test('UR-01b: exact left-edge sweep catches one-ULP overlap and refuses replayed green',()=>{
  const p=compileEnvelopePlan({...candidate,armPowerScale:.750005,surgeGapMs:133.63244445037031},context);
  const r=evaluateEnvelope(p);assert.equal(r.verdict,'REFUTED_WITHIN_DECLARED_ENVELOPE');
  const corner=evaluateDisturbance(p,{loadMultiplier:1.12,sensorDelayMs:20,jitterAMs:.2,jitterBMs:-.1});
  assert(corner.peakW>2410);assert.equal(replayEnvelopeReceipt(JSON.stringify(createEnvelopeReceipt(p)),context).receipt.result.verdict,r.verdict);
});
test('UR-01: 4096 seeded near-boundary interiors never exceed the conservative analytic power bound',()=>{
  let seed=10282026;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<4096;i++){
    const scale=.75+.25*random(),gap=100/scale+.3+(random()-.5)*1e-10;
    const p=compileEnvelopePlan({...candidate,armPowerScale:scale,surgeGapMs:gap},context),c=challengeEnvelope(p);
    const r=evaluateDisturbance(p,{loadMultiplier:1.12,sensorDelayMs:20,jitterAMs:.2-random()*1e-12,jitterBMs:-.1+random()*1e-12});
    assert(r.peakW<=c.worstPeakW+1e-9,`bound breach at ${i}`);
  }
});
test('UR-04: null, primitive and array receipts fail with a controlled shape error',()=>{
  for(const text of ['null','true','42','"text"','[]','{}']) assert.throws(()=>replayEnvelopeReceipt(text,C),/UNCERTAINTY_SHAPE_INVALID/);
});
test('UR-05: each trace uses its actual sensor delay and includes all eight order arrivals',()=>{
  const p=compileEnvelopePlan(candidate),d=delay=>evaluateDisturbance(p,{loadMultiplier:1,sensorDelayMs:delay,jitterAMs:0,jitterBMs:0});
  assert.equal(d(40).jobMs,2350);assert.equal(d(0).jobMs,2310);assert(d(40).energyWh>d(0).energyWh);
  assert.equal(challengeEnvelope(p).jobMs,2350);assert.equal(MODEL,'breakshift-uncertainty-energy/2');
});
test('UR-05: recorded Muse proposal passes corrected default model but fails 1.45 kW',()=>{
  assert.equal(evaluateEnvelope(compileEnvelopePlan(candidate)).verdict,'SUPPORTED_WITHIN_DECLARED_ENVELOPE');
  const low={...C,breakerKw:1.45};assert.equal(evaluateEnvelope(compileEnvelopePlan(candidate,low),low).verdict,'REFUTED_WITHIN_DECLARED_ENVELOPE');
});
