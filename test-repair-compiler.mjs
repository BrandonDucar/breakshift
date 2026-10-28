import test from 'node:test';
import assert from 'node:assert/strict';
import { compileRepairPlan, lowerRepairPlan } from './controller/repair-compiler.mjs';
import { executeCompiledRepairPlan, executeRepairRun } from './simulator/repair-run.mjs';
import { sha256Hex } from './session/inspection-session-core.mjs';
import { evaluateStrategy } from './session/muse-diagnosis-contract.mjs';

const source = { strategyId: 'coordinated_repair', breakerKw: 1.65, snapshotId: 'snapshot-1', scanId: 'scan-1' };

test('compiler deterministically emits a frozen simulator IR, not approval', () => {
  const plan = compileRepairPlan(source);
  assert.deepEqual(plan, compileRepairPlan({ ...source }));
  assert.equal(Object.isFrozen(plan.operations[0]), true);
  assert.equal(plan.compileStatus, 'VALID_PLAN_NOT_TESTED');
  assert.equal(plan.executionAuthority, false);
  assert.equal(plan.physicalClearance, false);
  const { planDigest, ...body } = plan;
  assert.equal(planDigest, sha256Hex(body));
  assert.deepEqual(lowerRepairPlan(plan, source), { powerMode: 'repair', timingMode: 'repair', handoff: true });
});

test('compiler rejects open-ended source, unknown instructions and physical repairs', () => {
  for (const strategyId of ['__proto__', 'constructor', 'eval(code)', 'inspect_gripper']) assert.throws(() => compileRepairPlan({ ...source, strategyId }));
  for (const input of [null, [], { ...source, code: 'fetch(secret)' }, { ...source, breakerKw: '1.65' }, { ...source, breakerKw: NaN }, { ...source, breakerKw: 3.21 }, { ...source, snapshotId: '' }, { ...source, scanId: 'x'.repeat(161) }]) assert.throws(() => compileRepairPlan(input));
});

test('changing snapshot, scan, strategy or energy limit invalidates the compiled artifact', () => {
  const plan = compileRepairPlan(source);
  for (const change of [{ snapshotId: 'snapshot-2' }, { scanId: 'scan-2' }, { strategyId: 'surge_interleave' }, { breakerKw: 1.45 }]) {
    assert.throws(() => executeCompiledRepairPlan(plan, { ...source, ...change }), /BINDING_OR_CONTENT_MISMATCH/);
  }
});

test('rehashed tampering cannot change operations, target, authority or required checks', () => {
  const mutations = [
    plan => { plan.operations[0].profile = 'working'; },
    plan => { plan.operations.push({ op: 'PLC_WRITE', value: 1 }); },
    plan => { plan.requiredChecks = []; },
    plan => { plan.executionAuthority = true; },
    plan => { plan.target = 'LIVE_EQUIPMENT'; },
    plan => { plan.compiler = 'unknown/2'; },
  ];
  for (const mutate of mutations) {
    const plan = structuredClone(compileRepairPlan(source)); mutate(plan);
    const { planDigest, ...body } = plan; plan.planDigest = sha256Hex(body);
    assert.throws(() => executeCompiledRepairPlan(plan, source), /BINDING_OR_CONTENT_MISMATCH/);
  }
});

test('compilation success does not turn an energy-infeasible repair into a pass', () => {
  const context = { ...source, breakerKw: 1.45 };
  const plan = compileRepairPlan(context);
  assert.equal(plan.compileStatus, 'VALID_PLAN_NOT_TESTED');
  const run = executeCompiledRepairPlan(plan, context);
  assert.equal(run.passed, false); assert.equal(run.repair.breakerTrip, true);
});

test('148 compiled cap/recipe cases preserve independent evaluator results', () => {
  for (let cap = 28; cap <= 64; cap++) for (const strategyId of ['surge_interleave', 'timing_compensation', 'station_handoff', 'coordinated_repair']) {
    const context = { ...source, breakerKw: cap / 20, strategyId };
    const run = executeRepairRun(context), expected = evaluateStrategy(strategyId, { breakerKw: context.breakerKw });
    assert.equal(run.passed, expected.passed);
    assert.deepEqual(run.recipe, expected.recipe);
    assert.equal(run.compiledPlan.bindings.breakerKw, context.breakerKw);
    assert.equal(Math.max(run.repair.peakKw, run.challenger.peakKw), expected.peakKw);
  }
});

test('serialized IR replays identically while absent or altered digests are rejected', () => {
  const plan = JSON.parse(JSON.stringify(compileRepairPlan(source)));
  assert.deepEqual(executeCompiledRepairPlan(plan, source), executeRepairRun(source));
  delete plan.planDigest;
  assert.throws(() => executeCompiledRepairPlan(plan, source), /BINDING_OR_CONTENT_MISMATCH/);
});

test('opaque snapshot labels remain data while control characters are rejected', () => {
  const input = { ...source, snapshotId: '<script>alert(1)</script>' };
  assert.equal(compileRepairPlan(input).bindings.snapshotId, input.snapshotId);
  assert.throws(() => compileRepairPlan({ ...source, snapshotId: 'snapshot\nforged' }));
});
