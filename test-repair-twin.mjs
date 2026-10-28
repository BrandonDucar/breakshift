import test from 'node:test';
import assert from 'node:assert/strict';
import { executeRepairRun, repairFrameAt } from './simulator/repair-run.mjs';
import { evaluateStrategy } from './session/muse-diagnosis-contract.mjs';
const input = { breakerKw: 1.65, snapshotId: 'test-snapshot', scanId: 'test-scan' };

test('each executable strategy agrees with the existing judge/challenger evaluator at three caps', () => {
  for (const breakerKw of [1.45, 1.65, 3.2]) for (const strategyId of ['surge_interleave', 'timing_compensation', 'station_handoff', 'coordinated_repair']) {
    const run = executeRepairRun({ ...input, breakerKw, strategyId });
    const expected = evaluateStrategy(strategyId, { breakerKw });
    assert.equal(run.passed, expected.passed);
    assert.equal(Math.max(run.repair.peakKw, run.challenger.peakKw), expected.peakKw);
    assert.equal(Math.min(run.repair.packed, run.challenger.packed), expected.packed);
    assert.deepEqual(run.recipe, expected.recipe);
  }
});
test('partial fixes fail for concrete different reasons; coordinated fix completes all eight checks', () => {
  const power = executeRepairRun({ ...input, strategyId: 'surge_interleave' });
  const handoff = executeRepairRun({ ...input, strategyId: 'station_handoff' });
  const full = executeRepairRun({ ...input, strategyId: 'coordinated_repair' });
  assert.equal(power.repair.breakerTrip, false); assert.equal(power.repair.packed, 0);
  assert.match(repairFrameAt(power, 2000).failures.join(' '), /Timing.*Station A/);
  assert.equal(handoff.repair.breakerTrip, true); assert.equal(handoff.repair.peakKw, 2.9);
  assert.equal(full.passed, true); assert.equal(full.repair.packed, 8);
  assert.equal(full.repair.peakKw, 1.554); assert.equal(full.challenger.telemetryErrors.length, 2);
});
test('playback reveals only recorded samples then order checks, without future green counts', () => {
  const run = executeRepairRun({ ...input, strategyId: 'coordinated_repair' });
  assert.equal(repairFrameAt(run, -10).time, 0);
  assert.deepEqual(repairFrameAt(run, 300).armSurges, ['A']);
  assert.deepEqual(repairFrameAt(run, 450).armSurges, ['B']);
  assert.equal(repairFrameAt(run, 1190).checked, 0);
  assert.equal(repairFrameAt(run, 1300).packed, 1);
  assert.equal(repairFrameAt(run, 2000).packed, 8);
  assert.equal(repairFrameAt(run, 9999).phase, 'COMPLETE');
  assert.equal(repairFrameAt(run, 300).sample.kw, run.repair.waveform[30].kw);
  assert.equal(run.working.parts.every(part => part.station === 'B'), true, 'baseline handoff is already present and must not be fabricated as a new change');
});
test('tighter power constraints revoke the coordinated pass', () => {
  const run = executeRepairRun({ ...input, breakerKw: 1.45, strategyId: 'coordinated_repair' });
  assert.equal(run.passed, false); assert.equal(run.repair.packed, 0);
});
test('physical repairs, arbitrary strategy IDs and invalid caps cannot execute', () => {
  for (const strategyId of ['inspect_gripper', '__proto__', 'arbitrary_code']) assert.throws(() => executeRepairRun({ ...input, strategyId }));
  for (const breakerKw of [NaN, -1, 4]) assert.throws(() => executeRepairRun({ ...input, strategyId: 'coordinated_repair', breakerKw }));
});
