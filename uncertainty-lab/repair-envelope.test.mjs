import test from 'node:test';
import assert from 'node:assert/strict';
import { BASELINE, DEFAULT_CONTEXT as C, compileEnvelopePlan, validatePlan, evaluateDisturbance, evaluateEnvelope, challengeEnvelope, createEnvelopeReceipt, replayEnvelopeReceipt } from './repair-envelope.mjs';

const robust = { ...BASELINE, armPowerScale: 0.85, surgeGapMs: 160, timingCompensationMs: 20 };
test('nominal pass is not a robust pass; retain exact falsifying trace', () => {
  const result = evaluateEnvelope(compileEnvelopePlan(BASELINE));
  assert.equal(result.nominal.passed, true); assert.equal(result.verdict, 'REFUTED_WITHIN_DECLARED_ENVELOPE');
  assert.equal(result.challenger.robustWithinDeclaredModel, false); assert(result.firstCounterexample);
});
test('bounded patch survives both corner traces and analytic challenger', () => {
  const result = evaluateEnvelope(compileEnvelopePlan(robust));
  assert.equal(result.verdict, 'SUPPORTED_WITHIN_DECLARED_ENVELOPE'); assert.equal(result.caseCount, 16);
  assert(result.challenger.worstMarginW > 150); assert.equal(result.nominal.packed, 8);
});
test('combined high load and late sensing breaks baseline in two ways', () => {
  const run = evaluateDisturbance(compileEnvelopePlan(BASELINE), { loadMultiplier: 1.12, sensorDelayMs: 40, jitterAMs: 15, jitterBMs: -15 });
  assert.deepEqual(run.failures, ['MODELED_POWER_CAP_EXCEEDED', 'GRASP_TIMING_MISS']);
});
test('power-only repair still fails timing; timing-only repair still fails power', () => {
  for (const candidate of [{ ...BASELINE, armPowerScale: 0.85 }, { ...BASELINE, timingCompensationMs: 20 }])
    assert.equal(evaluateEnvelope(compileEnvelopePlan(candidate)).verdict, 'REFUTED_WITHIN_DECLARED_ENVELOPE');
});
test('fractional short overlap is caught at exact event edges, not 10 ms samples', () => {
  const c = { ...robust, surgeGapMs: 100 / 0.85 + 30 - 0.001 };
  const run = evaluateEnvelope(compileEnvelopePlan(c));
  assert.equal(run.challenger.possibleOverlap, true); assert(run.challenger.worstPeakW > 2600);
  assert.equal(run.verdict, 'REFUTED_WITHIN_DECLARED_ENVELOPE');
});
test('numerically touching intervals conservatively refuse a fragile green', () => {
  const plan = compileEnvelopePlan({ ...robust, surgeGapMs: 100 / 0.85 + 30 });
  assert.equal(challengeEnvelope(plan).possibleOverlap, true);
  assert.equal(evaluateEnvelope(plan).verdict, 'REFUTED_WITHIN_DECLARED_ENVELOPE');
});
test('load reduction lengthens actuation and cannot erase modeled work', () => {
  const a = evaluateEnvelope(compileEnvelopePlan({ ...robust, armPowerScale: 1 })).nominal;
  const b = evaluateEnvelope(compileEnvelopePlan(robust)).nominal;
  const surgeWidth = run => run.segments.filter(s => s.watts > 1000).reduce((n,s) => n + s.toMs - s.fromMs,0);
  assert(surgeWidth(b) > surgeWidth(a)); assert(b.jobMs >= a.jobMs); assert(b.energyWh > 0); assert(b.energyWh < 2.4);
});
test('impossible power cap and impossible delay interval stay refuted', () => {
  for (const context of [{ ...C, breakerKw: 0.5 }, { ...C, envelope: { ...C.envelope, sensorDelayMs: [0, 100] } }])
    assert.equal(evaluateEnvelope(compileEnvelopePlan(robust, context)).verdict, 'REFUTED_WITHIN_DECLARED_ENVELOPE');
});
test('compiler rejects malformed and open-ended inputs', () => {
  for (const candidate of [null, [], { ...robust, code: 'fetch()' }, { ...robust, armPowerScale: NaN }, { ...robust, beltSpeedMps: 0 }, { ...robust, timingCompensationMs: Infinity }]) assert.throws(() => compileEnvelopePlan(candidate));
  for (const context of [{ ...C, snapshotId: '../x' }, { ...C, envelope: { ...C.envelope, loadMultiplier: [1.2, 1] } }, { ...C, breakerKw: '1.65' }]) assert.throws(() => compileEnvelopePlan(robust, context));
});
test('compiled plans freeze nested assumptions and reject changed context', () => {
  const plan = compileEnvelopePlan(robust);
  assert(Object.isFrozen(plan.assumptions.envelope.loadMultiplier));
  for (const current of [{ ...C, snapshotId: 'new' }, { ...C, breakerKw: 1.45 }, { ...C, envelope: { ...C.envelope, loadMultiplier: [1, 1.2] } }]) assert.throws(() => validatePlan(plan, current));
});
test('rehashing a claimed result or changing clearance cannot pass replay', () => {
  const receipt = createEnvelopeReceipt(compileEnvelopePlan(BASELINE));
  const good = JSON.stringify(receipt); assert.equal(replayEnvelopeReceipt(good, C).sourceAuthenticated, false);
  assert.throws(() => replayEnvelopeReceipt(good));
  for (const mutate of [r => { r.result.verdict = 'SUPPORTED_WITHIN_DECLARED_ENVELOPE'; }, r => { r.physicalClearance = true; }, r => { r.plan.model = 'other'; }, r => { r.extra = true; }]) {
    const bad = structuredClone(receipt); mutate(bad); assert.throws(() => replayEnvelopeReceipt(JSON.stringify(bad), C));
  }
  assert.throws(() => replayEnvelopeReceipt('x'.repeat(32769), C));
});
test('analytic extrema agree with 1125 interior and corner disturbances', () => {
  const plan = compileEnvelopePlan(robust), bound = challengeEnvelope(plan); let count = 0;
  for (const loadMultiplier of [1, 1.03, 1.06, 1.09, 1.12]) for (const sensorDelayMs of [0,5,10,15,20,25,30,35,40])
    for (const jitterAMs of [-15,-7.5,0,7.5,15]) for (const jitterBMs of [-15,-7.5,0,7.5,15]) {
      const run = evaluateDisturbance(plan, { loadMultiplier, sensorDelayMs, jitterAMs, jitterBMs });
      assert.equal(run.passed, true); assert(run.peakW <= bound.worstPeakW + 1e-8); count++;
    }
  assert.equal(count, 1125);
});
test('samples outside declared envelope are rejected instead of extrapolated', () => {
  assert.throws(() => evaluateDisturbance(compileEnvelopePlan(robust), { loadMultiplier: 1.121, sensorDelayMs: 40, jitterAMs: 0, jitterBMs: 0 }));
});
