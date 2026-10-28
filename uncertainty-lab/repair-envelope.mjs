import { canonicalJson, sha256Hex } from '../session/inspection-session-core.mjs';
import { beltWatts, ARM_IDLE_WATTS, ARM_SURGE_WATTS } from '../controller/power-governor.mjs';

export const MODEL = 'breakshift-uncertainty-energy/2';
export const LIMITS = Object.freeze({ graspWindowMs: 22, jobDeadlineMs: 2400, orders: 8, orderSpacingMs: 80, startMs: 300, baseSurgeMs: 100 });
export const BASELINE = Object.freeze({ beltSpeedMps: 0.7, armPowerScale: 1, surgeGapMs: 150, timingCompensationMs: 0 });
export const DEFAULT_CONTEXT = Object.freeze({ snapshotId: 'uncertainty-reference-1', breakerKw: 1.65,
  envelope: Object.freeze({ loadMultiplier: Object.freeze([1, 1.12]), sensorDelayMs: Object.freeze([0, 40]), surgeJitterMs: Object.freeze([-15, 15]) }) });
const requireThat = (value, code) => { if (!value) throw Error(code); };
function exact(value, keys) {
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).sort().join(',') === [...keys].sort().join(','), 'UNCERTAINTY_SHAPE_INVALID');
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) requireThat(!descriptor.get && !descriptor.set, 'UNCERTAINTY_ACCESSOR_FORBIDDEN');
}
function number(value, low, high) { requireThat(Number.isFinite(value) && value >= low && value <= high, 'UNCERTAINTY_RANGE_INVALID'); }
function range(pair, low, high) { requireThat(Array.isArray(pair) && pair.length === 2 && Object.keys(pair).length === 2, 'UNCERTAINTY_RANGE_INVALID'); pair.forEach(x => number(x, low, high)); requireThat(pair[0] <= pair[1], 'UNCERTAINTY_RANGE_INVALID'); }
function frozen(value) { if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); } return value; }
export function validateContext(context) {
  exact(context, ['snapshotId', 'breakerKw', 'envelope']);
  requireThat(typeof context.snapshotId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(context.snapshotId), 'UNCERTAINTY_SNAPSHOT_INVALID');
  number(context.breakerKw, 0.1, 3.2);
  exact(context.envelope, ['loadMultiplier', 'sensorDelayMs', 'surgeJitterMs']);
  range(context.envelope.loadMultiplier, 1, 1.3); range(context.envelope.sensorDelayMs, 0, 100); range(context.envelope.surgeJitterMs, -40, 40);
}
export function compileEnvelopePlan(candidate, context = DEFAULT_CONTEXT) {
  validateContext(context); exact(candidate, Object.keys(BASELINE));
  number(candidate.beltSpeedMps, 0.4, 1); number(candidate.armPowerScale, 0.75, 1);
  number(candidate.surgeGapMs, 100, 400); number(candidate.timingCompensationMs, 0, 100);
  const body = { schema: 'breakshift.uncertain-repair-ir.v1', model: MODEL, units: { power: 'W', time: 'ms', energy: 'Wh', speed: 'm/s' },
    assumptions: structuredClone(context), candidate: structuredClone(candidate), limits: LIMITS,
    target: 'DETERMINISTIC_REFERENCE_MODEL_ONLY', physicalClearance: false, executionAuthority: false, compileStatus: 'VALID_PLAN_NOT_TESTED' };
  return frozen({ ...body, planDigest: sha256Hex(body) });
}
export function validatePlan(plan, current) {
  const expected = compileEnvelopePlan(plan?.candidate, current);
  requireThat(canonicalJson(plan) === canonicalJson(expected), 'UNCERTAINTY_PLAN_BINDING_MISMATCH');
  return expected;
}
function disturbance(value, envelope) {
  exact(value, ['loadMultiplier', 'sensorDelayMs', 'jitterAMs', 'jitterBMs']);
  for (const [field, pair] of [['loadMultiplier', envelope.loadMultiplier], ['sensorDelayMs', envelope.sensorDelayMs], ['jitterAMs', envelope.surgeJitterMs], ['jitterBMs', envelope.surgeJitterMs]]) number(value[field], ...pair);
}

// The reference energy model assumes reduced drive power lengthens the surge
// reciprocally. It is a declared teaching model, not an identified motor curve.
export function evaluateDisturbance(plan, input, current = plan.assumptions) {
  validatePlan(plan, current); disturbance(input, current.envelope);
  const p = plan.candidate, duration = LIMITS.baseSurgeMs / p.armPowerScale;
  const starts = [LIMITS.startMs + input.jitterAMs, LIMITS.startMs + p.surgeGapMs + input.jitterBMs];
  const ends = starts.map(x => x + duration);
  const jobMs = Math.max(700 / p.beltSpeedMps + p.surgeGapMs + duration,
    (LIMITS.orders - 1) * LIMITS.orderSpacingMs + 700 / p.beltSpeedMps) + input.sensorDelayMs;
  const horizon = Math.max(jobMs, ...ends);
  const edges = [...new Set([0, horizon, ...starts, ...ends])].sort((a, b) => a - b);
  let peakW = 0, energyWh = 0, firstBreachMs = null;
  const segments = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const at = edges[i], until = edges[i + 1];
    // Every interval is half-open and constant between these exact event edges.
    // A midpoint can round to the right edge and hide a one-ULP overlap.
    const active = starts.filter((start, arm) => at >= start && at < ends[arm]).length;
    const watts = beltWatts(p.beltSpeedMps) + (2 - active) * ARM_IDLE_WATTS + active * ARM_SURGE_WATTS * p.armPowerScale * input.loadMultiplier;
    peakW = Math.max(peakW, watts); energyWh += watts * (until - at) / 3600000;
    if (watts > current.breakerKw * 1000 + 1e-9 && firstBreachMs === null) firstBreachMs = at;
    segments.push({ fromMs: at, toMs: until, watts });
  }
  const timingErrorMs = Math.abs(p.timingCompensationMs - input.sensorDelayMs);
  const failures = [];
  if (firstBreachMs !== null) failures.push('MODELED_POWER_CAP_EXCEEDED');
  if (timingErrorMs > LIMITS.graspWindowMs) failures.push('GRASP_TIMING_MISS');
  if (jobMs > LIMITS.jobDeadlineMs) failures.push('JOB_DEADLINE_MISSED');
  return { input: structuredClone(input), passed: failures.length === 0, failures, peakW, marginW: current.breakerKw * 1000 - peakW,
    energyWh, jobMs, timingErrorMs, firstBreachMs, packed: failures.length ? 0 : LIMITS.orders, segments };
}

// Deliberately separate closed-form challenger, not a second call to the trace
// evaluator. The extrema are complete only for this bounded piecewise model.
export function challengeEnvelope(plan, current = plan.assumptions) {
  validatePlan(plan, current);
  const c = plan.candidate, e = current.envelope;
  const duration = 100 / c.armPowerScale;
  const maxEndA = (LIMITS.startMs + e.surgeJitterMs[1]) + duration;
  const minStartB = (LIMITS.startMs + c.surgeGapMs) + e.surgeJitterMs[0];
  const roundingGuardMs = 2 * Number.EPSILON * Math.max(1, Math.abs(maxEndA), Math.abs(minStartB));
  // Match the trace's absolute coordinate arithmetic and conservatively hold
  // near-touching intervals instead of claiming a numerically fragile pass.
  const possibleOverlap = minStartB <= maxEndA + roundingGuardMs;
  const simultaneous = possibleOverlap ? 2 : 1;
  const worstPeakW = 50 + 50 * c.beltSpeedMps ** 2 + (2 - simultaneous) * 80 + simultaneous * 1400 * c.armPowerScale * e.loadMultiplier[1];
  const worstTimingErrorMs = Math.max(Math.abs(c.timingCompensationMs - e.sensorDelayMs[0]), Math.abs(c.timingCompensationMs - e.sensorDelayMs[1]));
  const jobMs = Math.max(700 / c.beltSpeedMps + c.surgeGapMs + duration,
    (LIMITS.orders - 1) * LIMITS.orderSpacingMs + 700 / c.beltSpeedMps) + e.sensorDelayMs[1];
  const reasons = [];
  if (worstPeakW > current.breakerKw * 1000 + 1e-9) reasons.push('MODELED_POWER_CAP_EXCEEDED');
  if (worstTimingErrorMs > 22) reasons.push('GRASP_TIMING_MISS');
  if (jobMs > 2400) reasons.push('JOB_DEADLINE_MISSED');
  return { method: 'ANALYTIC_INTERVAL_EXTREMA', robustWithinDeclaredModel: !reasons.length, worstPeakW,
    worstTimingErrorMs, worstMarginW: current.breakerKw * 1000 - worstPeakW, possibleOverlap, roundingGuardMs, jobMs, reasons,
    scope: 'DECLARED_REFERENCE_MODEL_ONLY_NOT_PHYSICAL_SAFETY' };
}
export function evaluateEnvelope(plan, current = plan.assumptions) {
  validatePlan(plan, current);
  const e = current.envelope, cases = [];
  for (const loadMultiplier of [...new Set(e.loadMultiplier)]) for (const sensorDelayMs of [...new Set(e.sensorDelayMs)])
    for (const jitterAMs of [...new Set(e.surgeJitterMs)]) for (const jitterBMs of [...new Set(e.surgeJitterMs)])
      cases.push(evaluateDisturbance(plan, { loadMultiplier, sensorDelayMs, jitterAMs, jitterBMs }, current));
  const challenger = challengeEnvelope(plan, current);
  const nominal = evaluateDisturbance(plan, { loadMultiplier: e.loadMultiplier[0], sensorDelayMs: e.sensorDelayMs[0], jitterAMs: e.surgeJitterMs[0], jitterBMs: e.surgeJitterMs[0] }, current);
  return { nominal, caseCount: cases.length, passedCases: cases.filter(c => c.passed).length,
    firstCounterexample: cases.find(c => !c.passed) ?? null, challenger,
    verdict: cases.every(c => c.passed) && challenger.robustWithinDeclaredModel ? 'SUPPORTED_WITHIN_DECLARED_ENVELOPE' : 'REFUTED_WITHIN_DECLARED_ENVELOPE' };
}
export function createEnvelopeReceipt(plan, current = plan.assumptions) {
  const body = { schema: 'breakshift.uncertainty-experiment.v1', plan, result: evaluateEnvelope(plan, current),
    model: MODEL, physicalClearance: false, executionAuthority: false, synthetic: true };
  return { ...body, receiptDigest: sha256Hex(body) };
}
export function replayEnvelopeReceipt(text, current) {
  requireThat(typeof text === 'string' && new TextEncoder().encode(text).length <= 32768, 'UNCERTAINTY_RECEIPT_TOO_LARGE');
  validateContext(current);
  let value;
  try { value = JSON.parse(text); } catch { throw Error('UNCERTAINTY_RECEIPT_INVALID'); }
  exact(value, ['schema','plan','result','model','physicalClearance','executionAuthority','synthetic','receiptDigest']);
  const expected = createEnvelopeReceipt(value.plan, current);
  requireThat(canonicalJson(value) === canonicalJson(expected), 'UNCERTAINTY_RECEIPT_REPLAY_MISMATCH');
  return { receipt: expected, sourceAuthenticated: false, scope: 'LOCAL_RECOMPUTATION_NOT_SIGNED_ATTESTATION' };
}
