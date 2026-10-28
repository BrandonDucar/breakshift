import { sha256Hex } from '../session/inspection-session-core.mjs';
import { evaluateBayJob } from './bay-job.mjs';
import { EXPERIMENT_REPLAY_CONTRACT, replayFaultReceipt } from './experiment-replay.mjs';
export { verifyFaultReceipt } from './experiment-replay.mjs';

export function normalizeFaultCommand(input) {
  if (!input || Array.isArray(input) || Object.keys(input).join(',') !== 'breakerKw' || typeof input.breakerKw !== 'number' || !Number.isFinite(input.breakerKw)) throw Error('FAULT_COMMAND_NOT_SUPPORTED');
  const value = input.breakerKw;
  if (value < 1.4 || value > 3.2 || Math.abs(value * 20 - Math.round(value * 20)) > 1e-7) throw Error('FAULT_BREAKER_OUT_OF_RANGE');
  return { type: 'SET_BREAKER_KW', breakerKw: Math.round(value * 100) / 100 };
}

export function createFaultExperiment({ getContext, applyBreaker, getActiveRun = () => null, startPlayback, onChange = () => {}, clock = () => new Date().toISOString() }) {
  let latest = null, busy = false, error = '', sequence = 0, omittedEvents = 0, anchor = '0'.repeat(64);
  const events = [];
  function append(type, detail) {
    const event = { sequence: ++sequence, at: clock(), source: 'DETERMINISTIC_SIMULATION', type, detail, previousDigest: events.at(-1)?.digest || anchor };
    events.push({ ...event, digest: sha256Hex(event) });
    if (events.length > 64) { anchor = events.shift().digest; omittedEvents++; }
  }
  function current() {
    const c = getContext();
    if (!c.available || typeof c.snapshotId !== 'string' || !Number.isInteger(c.version)) throw Error('FAULT_SESSION_UNAVAILABLE');
    return c;
  }
  function observe() {
    const context = getContext();
    if (latest && !latest.invalidated && latest.snapshotId !== context.snapshotId) {
      append('RUN_INVALIDATED', { previousSnapshot: latest.snapshotId, currentSnapshot: context.snapshotId, previousVerdict: latest.passed ? 'PASS' : 'REJECTED' });
      latest = { ...latest, invalidated: true };
    }
  }
  function evaluate(context, strategyId, scanId = 'DETERMINISTIC_DEMO_JOB') {
    latest = evaluateBayJob({ strategyId, breakerKw: context.breakerKw, snapshotId: context.snapshotId, scanId });
    append('RUN_EVALUATED', { snapshotId: latest.snapshotId, strategyId, breakerKw: latest.breakerKw, peakKw: latest.repair.peakKw, packed: latest.repair.packed, challengerPacked: latest.challenger.packed, verdict: latest.passed ? 'PASS' : 'REJECTED' });
    startPlayback(latest);
  }
  async function start() {
    if (busy) return false;
    busy = true; error = ''; onChange();
    try { evaluate(current(), 'coordinated_repair'); return true; }
    catch (e) { error = e.message; append('RUN_NOT_STARTED', { reason: error }); return false; }
    finally { busy = false; onChange(); }
  }
  async function inject(input) {
    if (busy) return false;
    busy = true; error = ''; onChange();
    try {
      const command = normalizeFaultCommand(input), before = current();
      const active = getActiveRun();
      const activeCurrent = active && !active.stale && active.snapshotId === before.snapshotId;
      const strategyId = activeCurrent ? active.strategyId : latest && !latest.invalidated && latest.snapshotId === before.snapshotId ? latest.strategyId : 'coordinated_repair';
      const scanId = activeCurrent ? active.scanId || 'DETERMINISTIC_DEMO_JOB' : latest && !latest.invalidated && latest.snapshotId === before.snapshotId ? latest.compiledPlan.bindings.scanId : 'DETERMINISTIC_DEMO_JOB';
      if (!latest || latest.snapshotId !== before.snapshotId || latest.strategyId !== strategyId || latest.invalidated) {
        latest = evaluateBayJob({ strategyId, breakerKw: before.breakerKw, snapshotId: before.snapshotId, scanId });
        append('BASELINE_CAPTURED', { snapshotId: before.snapshotId, strategyId, verdict: latest.passed ? 'PASS' : 'REJECTED' });
      }
      append('COMMAND_RECEIVED', { command, expectedSnapshot: before.snapshotId, expectedVersion: before.version, playback: activeCurrent ? { elapsedMs: active.elapsed, playing: active.playing } : null });
      if (command.breakerKw === before.breakerKw) { append('COMMAND_NO_CHANGE', { breakerKw: before.breakerKw }); return true; }
      const accepted = await applyBreaker(command.breakerKw, before.snapshotId);
      observe();
      const after = current();
      if (!accepted || after.breakerKw !== command.breakerKw || after.version <= before.version || after.snapshotId === before.snapshotId) throw Error('FAULT_COMMAND_NOT_APPLIED');
      append('COMMAND_APPLIED', { previousSnapshot: before.snapshotId, currentSnapshot: after.snapshotId, breakerKw: after.breakerKw, version: after.version });
      evaluate(after, strategyId, scanId);
      return true;
    } catch (e) { error = e.message; append('COMMAND_REJECTED', { reason: error }); return false; }
    finally { busy = false; onChange(); }
  }
  function state() {
    observe();
    const context = getContext();
    return { latest: latest ? structuredClone(latest) : null, busy, error, canExport: Boolean(latest && !busy && context.available && !latest.invalidated && latest.snapshotId === context.snapshotId), events: structuredClone(events), omittedEvents, anchor };
  }
  function exportReceipt() {
    const s = state();
    if (!s.canExport) throw Error('FAULT_CURRENT_RESULT_REQUIRED');
    const body = { schema: 'breakshift.fault-experiment.v2', replayContract: EXPERIMENT_REPLAY_CONTRACT, currentSnapshotId: getContext().snapshotId, currentResult: s.latest, trace: { anchor, events: s.events, omittedEvents, head: events.at(-1)?.digest || anchor }, providerCalls: 0, physicalClearance: false, scope: 'Browser-local deterministic experiment. Hash integrity and versioned local replay do not authenticate identity, historical events or physical truth. A rejected result is retained as rejected; no equipment commands or model inference.' };
    const receipt = { ...body, receiptDigest: sha256Hex(body) };
    replayFaultReceipt(receipt);
    return receipt;
  }
  function recordRecipe(strategyId, expectedSnapshot, scanId = 'DETERMINISTIC_DEMO_JOB') {
    if (busy) throw Error('FAULT_EXPERIMENT_BUSY');
    const context = current();
    if (context.snapshotId !== expectedSnapshot) throw Error('FAULT_CURRENT_RESULT_REQUIRED');
    latest = evaluateBayJob({ strategyId, breakerKw: context.breakerKw, snapshotId: context.snapshotId, scanId });
    append('BASELINE_CAPTURED', { snapshotId: context.snapshotId, strategyId, verdict: latest.passed ? 'PASS' : 'REJECTED' });
    onChange();
  }
  function recordRejection(code) { append('COMMAND_REJECTED', { reason: /^[A-Z_]{1,64}$/.test(code) ? code : 'UNSUPPORTED_PERTURBATION' }); onChange(); }
  return { start, inject, state, exportReceipt, recordRecipe, recordRejection };
}
