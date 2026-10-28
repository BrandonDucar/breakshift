import test from 'node:test';
import assert from 'node:assert/strict';
import { createFaultExperiment } from './public/fault-lab.mjs';
import { verifyFaultReceipt, replayFaultReceipt, parseAndReplayExperiment, MAX_EXPERIMENT_BYTES } from './public/experiment-replay.mjs';
import { sha256Hex } from './session/inspection-session-core.mjs';

async function sample(strategyId = 'coordinated_repair', breakerKw = 1.65) {
  const context = { snapshotId: 'fixture-snapshot', version: 1, breakerKw, available: true };
  const engine = createFaultExperiment({ getContext: () => context, applyBreaker: async () => null, startPlayback: () => {} });
  engine.recordRecipe(strategyId, context.snapshotId);
  return engine.exportReceipt();
}
const reseal = receipt => { const { receiptDigest, ...body } = receipt; return { ...body, receiptDigest: sha256Hex(body) }; };

test('saved pass and rejected experiments replay without converting a rejection to approval', async () => {
  for (const [cap, verdict] of [[1.65, 'PASS'], [1.45, 'REJECTED']]) {
    const receipt = await sample('coordinated_repair', cap);
    assert.equal(receipt.schema, 'breakshift.fault-experiment.v2');
    const result = parseAndReplayExperiment(JSON.stringify(receipt));
    assert.equal(result.recordedVerdict, verdict); assert.equal(result.status, 'REPLAY_MATCH');
    assert.equal(result.appliedToCurrentSession, false); assert.equal(result.physicalClearance, false);
    assert.equal(result.authorVerified, false); assert.equal(result.historicalEventsVerified, false); assert.equal(result.providerCalls, 0);
  }
});

test('a forged verdict with a fresh valid checksum fails semantic replay', async () => {
  const receipt = await sample('coordinated_repair', 1.45);
  receipt.currentResult.passed = true;
  const forged = reseal(receipt);
  assert.equal(verifyFaultReceipt(forged), true, 'integrity alone cannot establish a correct result');
  assert.throws(() => replayFaultReceipt(forged), /RECORDED_RESULT_MISMATCH/);
});

test('rehashed forged metrics, blockers and extra result fields fail replay', async () => {
  for (const mutate of [r => { r.currentResult.repair.peakKw = 0; }, r => { r.currentResult.challenger.packed = 8; }, r => { r.currentResult.blockers = []; }, r => { r.currentResult.safe = true; }]) {
    const receipt = await sample('surge_interleave'); mutate(receipt);
    assert.throws(() => replayFaultReceipt(reseal(receipt)), /RECORDED_RESULT_MISMATCH/);
  }
});

test('foreign model contracts, stale compiled bindings and missing plans cannot replay', async () => {
  let receipt = await sample(); receipt.replayContract = { ...receipt.replayContract, model: 'unknown/2' };
  assert.throws(() => replayFaultReceipt(reseal(receipt)), /REPLAY_CONTRACT_MISMATCH/);
  receipt = await sample(); receipt.currentResult.breakerKw = 1.45;
  assert.throws(() => replayFaultReceipt(reseal(receipt)), /BINDING_OR_CONTENT_MISMATCH/);
  receipt = await sample(); delete receipt.currentResult.compiledPlan;
  assert.throws(() => replayFaultReceipt(reseal(receipt)));
});

test('legacy receipts retain integrity-only compatibility without invented replay provenance', async () => {
  const receipt = await sample(); receipt.schema = 'breakshift.fault-experiment.v1'; delete receipt.replayContract; delete receipt.currentResult.compiledPlan;
  const legacy = reseal(receipt);
  assert.equal(verifyFaultReceipt(legacy), true);
  assert.throws(() => replayFaultReceipt(legacy), /LEGACY_RECEIPT_INTEGRITY_ONLY/);
});

test('malformed, excessive, corrupted and unsupported imports fail closed', async () => {
  for (const text of ['', '{', 'null', '[]', '{"__proto__":{"passed":true}}']) assert.throws(() => parseAndReplayExperiment(text));
  assert.throws(() => parseAndReplayExperiment(' '.repeat(MAX_EXPERIMENT_BYTES + 1)), /TOO_LARGE/);
  assert.throws(() => parseAndReplayExperiment('😀'.repeat(MAX_EXPERIMENT_BYTES / 3)), /TOO_LARGE/);
  const receipt = await sample(); receipt.trace.events[0].detail.verdict = 'FORGED';
  assert.throws(() => replayFaultReceipt(receipt), /INTEGRITY_REJECTED/);
  receipt.trace.omittedEvents = -1;
  assert.equal(verifyFaultReceipt(reseal(receipt)), false);
});

test('all 148 cap/recipe combinations survive JSON export and deterministic replay', async () => {
  for (let cap = 28; cap <= 64; cap++) for (const strategy of ['station_handoff', 'surge_interleave', 'timing_compensation', 'coordinated_repair']) {
    const receipt = await sample(strategy, cap / 20);
    assert.equal(parseAndReplayExperiment(JSON.stringify(receipt)).recordedVerdict, receipt.currentResult.passed ? 'PASS' : 'REJECTED');
  }
});

test('replay respects a recorded proposal identity instead of substituting a demo scan', () => {
  const context={snapshotId:'proposal-fixture',version:1,breakerKw:1.65,available:true};
  const engine=createFaultExperiment({getContext:()=>context,applyBreaker:async()=>null,startPlayback:()=>{}});
  engine.recordRecipe('coordinated_repair',context.snapshotId,'ORIGINAL_RECORDED_PROPOSAL');
  const receipt=engine.exportReceipt();
  assert.equal(parseAndReplayExperiment(JSON.stringify(receipt)).status,'REPLAY_MATCH');
  assert.equal(receipt.currentResult.compiledPlan.bindings.scanId,'ORIGINAL_RECORDED_PROPOSAL');
});
