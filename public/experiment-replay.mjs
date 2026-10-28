import { canonicalJson, sha256Hex } from '../session/inspection-session-core.mjs';
import { REPAIR_COMPILER_VERSION, lowerRepairPlan } from '../controller/repair-compiler.mjs';
import { judgeScenario, challengerScenario } from '../simulator/scenarios.mjs';
import { evaluateBayJob } from './bay-job.mjs';

export const MAX_EXPERIMENT_BYTES = 256 * 1024;
export const EXPERIMENT_REPLAY_CONTRACT = Object.freeze({
  schema: 'breakshift.experiment-replay-contract.v1',
  compiler: REPAIR_COMPILER_VERSION,
  model: 'breakshift-workcell/1',
  scenariosDigest: sha256Hex({ judgeScenario, challengerScenario }),
  scope: 'CURRENT_VERSIONED_SIMULATOR_REPLAY_NOT_ORIGINAL_RUNTIME_ATTESTATION',
});

// Integrity alone is not semantic verification, authorship or event attestation.
export function verifyFaultReceipt(receipt) {
  try {
    const { receiptDigest, ...body } = receipt;
    if (!['breakshift.fault-experiment.v1', 'breakshift.fault-experiment.v2'].includes(body.schema) || sha256Hex(body) !== receiptDigest || body.physicalClearance !== false || body.providerCalls !== 0 || body.currentResult.invalidated === true) return false;
    if (!Array.isArray(body.trace.events) || body.trace.events.length < 1 || body.trace.events.length > 64 || !Number.isSafeInteger(body.trace.omittedEvents) || body.trace.omittedEvents < 0 || !/^[a-f0-9]{64}$/.test(body.trace.anchor)) return false;
    let prior = body.trace.anchor, sequence = body.trace.omittedEvents;
    for (const entry of body.trace.events) {
      const { digest, ...event } = entry;
      if (event.previousDigest !== prior || event.sequence !== ++sequence || sha256Hex(event) !== digest) return false;
      prior = digest;
    }
    return prior === body.trace.head && body.currentResult.snapshotId === body.currentSnapshotId;
  } catch { return false; }
}

export function replayFaultReceipt(receipt) {
  if (!verifyFaultReceipt(receipt)) throw Error('EXPERIMENT_INTEGRITY_REJECTED');
  if (receipt.schema !== 'breakshift.fault-experiment.v2') throw Error('LEGACY_RECEIPT_INTEGRITY_ONLY_REPLAY_UNAVAILABLE');
  if (canonicalJson(receipt.replayContract) !== canonicalJson(EXPERIMENT_REPLAY_CONTRACT)) throw Error('EXPERIMENT_REPLAY_CONTRACT_MISMATCH');
  const result = receipt.currentResult;
  const context = { strategyId: result.strategyId, breakerKw: result.breakerKw, snapshotId: result.snapshotId, scanId: result.compiledPlan?.bindings?.scanId };
  lowerRepairPlan(result.compiledPlan, context);
  const replay = evaluateBayJob(context);
  if (canonicalJson(replay) !== canonicalJson(result)) throw Error('EXPERIMENT_RECORDED_RESULT_MISMATCH');
  return {
    schema: 'breakshift.experiment-replay-result.v1', status: 'REPLAY_MATCH',
    recordedVerdict: replay.passed ? 'PASS' : 'REJECTED', snapshotId: replay.snapshotId,
    breakerKw: replay.breakerKw, planDigest: replay.compiledPlan.planDigest,
    evidence: 'LOCAL_DETERMINISTIC_REPLAY', integrityVerified: true,
    authorVerified: false, historicalEventsVerified: false,
    appliedToCurrentSession: false, physicalClearance: false, providerCalls: 0,
    scope: 'Recorded result matches the current versioned simulator. This does not authenticate its author, historical events or physical equipment.',
  };
}

export function parseAndReplayExperiment(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_EXPERIMENT_BYTES) throw Error('EXPERIMENT_FILE_TOO_LARGE_OR_INVALID');
  let receipt;
  try { receipt = JSON.parse(text); } catch { throw Error('EXPERIMENT_JSON_INVALID'); }
  return replayFaultReceipt(receipt);
}
