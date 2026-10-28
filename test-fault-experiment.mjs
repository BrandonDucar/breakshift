import test from 'node:test';
import assert from 'node:assert/strict';
import { createInspectionSessionCore } from './session/inspection-session-core.mjs';
import { createFaultExperiment, normalizeFaultCommand, verifyFaultReceipt } from './public/fault-lab.mjs';
import { executeRepairRun } from './simulator/repair-run.mjs';

function rig() {
  const core = createInspectionSessionCore(); let available = true, active = null;
  const reads = [], context = () => ({ snapshotId: core.getState().evidenceSnapshotId, version: core.getState().version, breakerKw: core.getState().breakerKw, available });
  const apply = async (breakerKw, expectedSnapshot) => {
    if (core.getState().evidenceSnapshotId !== expectedSnapshot) return null;
    return core.mutate({ type: 'SET_BREAKER_KW', breakerKw, expectedVersion: core.getState().version });
  };
  const options = { getContext: context, applyBreaker: apply, getActiveRun: () => active, startPlayback: r => { reads.push(r); active = { snapshotId: r.snapshotId, strategyId: r.strategyId, elapsed: 320, playing: true, stale: false }; }, clock: () => '2026-10-28T00:00:00.000Z' };
  return { core, reads, options, offline: () => { available = false; }, setActive: value => { active = value; } };
}
test('typed breaker command rejects extra fields, unmodeled actuators and off-grid values', () => {
  assert.deepEqual(normalizeFaultCommand({ breakerKw: 1.45 }), { type: 'SET_BREAKER_KW', breakerKw: 1.45 });
  for (const value of [null, [], { breakerKw: '1.45' }, { breakerKw: 1.46 }, { breakerKw: NaN }, { breakerKw: 1.65, actuator: true }, { delayMs: 45 }]) assert.throws(() => normalizeFaultCommand(value));
});
test('mid-playback limit change invalidates prior pass and exports the actual rejected result', async () => {
  const r = rig(), engine = createFaultExperiment(r.options);
  await engine.start(); const original = engine.exportReceipt(); assert.equal(original.currentResult.passed, true);
  await engine.inject({ breakerKw: 1.45 });
  const receipt = engine.exportReceipt(); assert.equal(receipt.currentResult.passed, false); assert.notEqual(receipt.currentSnapshotId, original.currentSnapshotId);
  assert.equal(receipt.trace.events.find(e => e.type === 'COMMAND_RECEIVED').detail.playback.playing, true);
  assert.ok(receipt.trace.events.some(e => e.type === 'RUN_INVALIDATED' && e.detail.previousSnapshot === original.currentSnapshotId));
  assert.equal(receipt.providerCalls, 0); assert.equal(receipt.physicalClearance, false); assert.equal(verifyFaultReceipt(receipt), true);
  await engine.inject({ breakerKw: 1.65 }); assert.equal(engine.exportReceipt().currentResult.passed, true);
});
test('changing evidence outside the console disables current export but preserves old evidence', async () => {
  const r = rig(), engine = createFaultExperiment(r.options); await engine.start();
  r.core.mutate({ type: 'SET_BREAKER_KW', breakerKw: 1.45, expectedVersion: r.core.getState().version });
  assert.equal(engine.state().canExport, false); assert.equal(engine.state().latest.invalidated, true);
  assert.throws(() => engine.exportReceipt(), /CURRENT_RESULT_REQUIRED/);
});
test('failed mutation does not become applied or recomputed and leaves the truthful current result', async () => {
  const r = rig(), engine = createFaultExperiment({ ...r.options, applyBreaker: async () => null });
  await engine.start(); assert.equal(await engine.inject({ breakerKw: 1.45 }), false);
  const receipt = engine.exportReceipt(); assert.equal(receipt.currentResult.breakerKw, 1.65);
  assert.equal(receipt.trace.events.filter(e => e.type === 'COMMAND_APPLIED').length, 0);
  assert.equal(receipt.trace.events.at(-1).type, 'COMMAND_REJECTED');
});
test('an active partial recipe is not silently swapped for coordinated repair', async () => {
  const r = rig(), context = r.options.getContext();
  r.setActive({ snapshotId: context.snapshotId, strategyId: 'surge_interleave', elapsed: 100, playing: true, stale: false });
  const engine = createFaultExperiment(r.options); await engine.inject({ breakerKw: 1.45 });
  assert.equal(engine.exportReceipt().currentResult.strategyId, 'surge_interleave');
});
test('concurrent injections cannot apply a second mutation behind a pending command', async () => {
  const r = rig(); let release, calls = 0; const gate = new Promise(resolve => { release = resolve; });
  const engine = createFaultExperiment({ ...r.options, applyBreaker: async (...args) => { calls++; await gate; return r.options.applyBreaker(...args); } });
  await engine.start(); const first = engine.inject({ breakerKw: 1.45 });
  assert.equal(await engine.inject({ breakerKw: 1.4 }), false); assert.equal(engine.state().canExport, false);
  release(); assert.equal(await first, true); assert.equal(calls, 1);
});
test('offline and no-change cases do not claim changed conditions', async () => {
  const r = rig(), engine = createFaultExperiment(r.options); await engine.start();
  await engine.inject({ breakerKw: 1.65 }); assert.equal(engine.state().events.at(-1).type, 'COMMAND_NO_CHANGE');
  r.offline(); assert.equal(await engine.inject({ breakerKw: 1.45 }), false); assert.equal(engine.state().canExport, false);
});
test('bounded trace reports omitted events and detects post-export corruption', async () => {
  const r = rig(), engine = createFaultExperiment(r.options); await engine.start();
  for (let i = 0; i < 35; i++) await engine.inject({ breakerKw: i % 2 ? 1.65 : 1.45 });
  const receipt = engine.exportReceipt(); assert.equal(receipt.trace.events.length, 64); assert.ok(receipt.trace.omittedEvents > 0); assert.equal(verifyFaultReceipt(receipt), true);
  receipt.currentResult.passed = !receipt.currentResult.passed; assert.equal(verifyFaultReceipt(receipt), false);
});
test('148 cap/recipe combinations obey the computed completion, breaker and buffer contract', () => {
  let checked = 0;
  for (const strategyId of ['station_handoff','surge_interleave','timing_compensation','coordinated_repair']) for (let tick = 28; tick <= 64; tick++) {
    const cap = tick / 20, run = executeRepairRun({ strategyId, breakerKw: cap, snapshotId: 'fixture', scanId: 'fixture' });
    assert.equal(run.passed, [run.repair, run.challenger].every(r => !r.breakerTrip && r.peakKw <= cap && r.packed === r.orderCount && r.socWh > 0)); checked++;
  }
  assert.equal(checked, 148);
});

test('proposal identity survives recipe recording, fault injection and replay lowering', async () => {
  const r=rig(),engine=createFaultExperiment(r.options),scanId='recorded-provider-scan-1';
  engine.recordRecipe('surge_interleave',r.options.getContext().snapshotId,scanId);
  const first=engine.exportReceipt();assert.equal(first.currentResult.compiledPlan.bindings.scanId,scanId);
  r.setActive({snapshotId:first.currentSnapshotId,strategyId:'surge_interleave',scanId,elapsed:320,playing:true,stale:false});
  await engine.inject({breakerKw:1.45});
  assert.equal(engine.exportReceipt().currentResult.compiledPlan.bindings.scanId,scanId);
});
