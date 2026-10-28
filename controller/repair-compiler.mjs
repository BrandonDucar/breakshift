import { sha256Hex, canonicalJson } from '../session/inspection-session-core.mjs';

export const REPAIR_COMPILER_VERSION = 'breakshift-repair-compiler/1';
const recipes = Object.freeze({
  surge_interleave: ['repair', 'working', false],
  timing_compensation: ['working', 'repair', false],
  station_handoff: ['working', 'working', true],
  coordinated_repair: ['repair', 'repair', true],
});
const identifier = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 160 && !/[\x00-\x1f\x7f]/.test(value);
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

// Compile the bounded repair language, never JavaScript or equipment commands.
export function compileRepairPlan(input) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).sort().join(',') !== 'breakerKw,scanId,snapshotId,strategyId') throw Error('REPAIR_SOURCE_SHAPE_INVALID');
  const { strategyId, breakerKw, snapshotId, scanId } = input;
  if (strategyId === 'inspect_gripper') throw Error('PHYSICAL_REPAIR_NOT_MODELED');
  if (!Object.hasOwn(recipes, strategyId)) throw Error('UNKNOWN_REPAIR_STRATEGY');
  if (!identifier(snapshotId) || !identifier(scanId) || !Number.isFinite(breakerKw) || breakerKw < 1.4 || breakerKw > 3.2) throw Error('INVALID_REPAIR_RUN_INPUT');
  const [power, timing, handoff] = recipes[strategyId];
  const body = {
    schema: 'breakshift.repair-plan-ir.v1', compiler: REPAIR_COMPILER_VERSION,
    target: 'DETERMINISTIC_SIMULATOR_ONLY', bindings: { strategyId, breakerKw, snapshotId, scanId },
    operations: [
      { op: 'POWER_PROFILE', profile: power },
      { op: 'TIMING_SOURCE', source: timing === 'repair' ? 'MEASURED_BELT_SPEED' : 'NOMINAL_BELT_SPEED' },
      { op: 'STATION_POLICY', policy: handoff ? 'FILTER_FAULTED_STATIONS' : 'INCLUDE_FAULTED_STATIONS' },
    ],
    requiredChecks: ['JUDGE_POWER_AND_ORDERS', 'CHALLENGER_POWER_AND_ORDERS', 'ENERGY_BUFFER_POSITIVE'],
    compileStatus: 'VALID_PLAN_NOT_TESTED', physicalClearance: false, executionAuthority: false,
  };
  return freeze({ ...body, planDigest: sha256Hex(body) });
}

export function lowerRepairPlan(plan, current) {
  let expected;
  try { expected = compileRepairPlan(current); } catch { throw Error('REPAIR_CURRENT_CONTEXT_INVALID'); }
  // Recompile instead of trusting a caller-rehashed artifact or its claimed checks.
  if (canonicalJson(plan) !== canonicalJson(expected)) throw Error('REPAIR_PLAN_BINDING_OR_CONTENT_MISMATCH');
  const [power, timing, stations] = expected.operations;
  return Object.freeze({ powerMode: power.profile, timingMode: timing.source === 'MEASURED_BELT_SPEED' ? 'repair' : 'working', handoff: stations.policy === 'FILTER_FAULTED_STATIONS' });
}
