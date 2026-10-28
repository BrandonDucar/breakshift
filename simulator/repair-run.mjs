// Browser/Node adapter: execute an allowed controller recipe, then expose the
// existing model's power samples and batch checks for truthful slowed playback.
import { simulate } from './workcell.mjs';
import { judgeScenario, challengerScenario } from './scenarios.mjs';
import { scheduleSurges } from '../controller/power-governor.mjs';
import { compileRepairPlan, lowerRepairPlan } from '../controller/repair-compiler.mjs';
const passed = (run, cap) => !run.breakerTrip && run.peakKw <= cap && run.packed === run.orderCount && run.socWh > 0;

export function executeRepairRun({ strategyId, breakerKw, snapshotId, scanId }) {
  const context = { strategyId, breakerKw, snapshotId, scanId };
  return executeCompiledRepairPlan(compileRepairPlan(context), context);
}

export function executeCompiledRepairPlan(compiledPlan, context) {
  const recipe = lowerRepairPlan(compiledPlan, context);
  const { strategyId, breakerKw, snapshotId, scanId } = context;
  const scenario = { ...judgeScenario, breakerKw, cloudDips: [{ fromMs: 300, toMs: 520, capKw: breakerKw }] };
  const challenge = { ...challengerScenario, breakerKw, cloudDips: [{ fromMs: 250, toMs: 610, capKw: breakerKw }] };
  const working = simulate(scenario, 'working');
  const repair = simulate(scenario, 'candidate', recipe);
  const challenger = simulate(challenge, 'candidate', recipe);
  const changes = [
    { path: 'controller/power-governor.mjs', label: 'Surge separation', before: '0 ms', after: recipe.powerMode === 'repair' ? '150 ms' : '0 ms' },
    { path: 'controller/power-governor.mjs', label: 'Belt speed', before: '1.0 m/s', after: recipe.powerMode === 'repair' ? '0.7 m/s' : '1.0 m/s' },
    { path: 'controller/kinematics-timing.mjs', label: 'Timing speed source', before: 'Nominal speed', after: recipe.timingMode === 'repair' ? 'Measured belt speed' : 'Nominal speed' },
    // The original working baseline already attempts Station B. Keep that fact
    // visible rather than claiming handoff is a new change in every comparison.
    { path: 'controller/planner.mjs', label: 'Eligible stations', before: 'B (fault filtered)', after: recipe.handoff ? 'B (fault filtered)' : 'A + B (A fault ignored)' },
  ];
  return {
    schema: 'breakshift.repair-twin-run.v1', energyModelLabel: 'SIMULATED_WORKCELL_ENERGY_MODEL',
    scanId, snapshotId, strategyId, breakerKw, compiledPlan, recipe, working, repair, challenger,
    passed: passed(repair, breakerKw) && passed(challenger, breakerKw),
    schedule: scheduleSurges({ requestedAtMs: [300, 300], breakerKw, mode: recipe.powerMode }),
    changes, powerWindowMs: 1200, playbackDurationMs: 1200 + scenario.orderCount * 100,
    scope: 'Computed 10 ms power trace followed by batch order-check reveal. Arm/conveyor drawing is illustrative, not a kinematic measurement. Existing model throughput and Wh/part use its 1.2 s window.',
  };
}

export function repairFrameAt(run, playbackMs) {
  const time = Math.max(0, Math.min(run.playbackDurationMs, Number(playbackMs) || 0));
  const sampleIndex = Math.min(run.repair.waveform.length - 1, Math.floor(time / 10));
  const sample = run.repair.waveform[sampleIndex];
  const checked = Math.min(run.repair.parts.length, Math.max(0, Math.floor((time - run.powerWindowMs) / 100)));
  const parts = run.repair.parts.slice(0, checked);
  const failures = [];
  if (run.repair.breakerTrip) failures.push('MAIN_BUS_OVERCURRENT: simultaneous surges exceed the cap.');
  if (run.recipe.timingMode === 'working' && run.recipe.powerMode === 'repair') failures.push('Timing still assumes 1.0 m/s after the belt slows to 0.7 m/s.');
  if (!run.recipe.handoff) failures.push('Station A is still in the order plan with an injected gripper fault.');
  return {
    time, sample, checked, packed: parts.filter(part => part.packed).length, parts,
    phase: time < run.powerWindowMs ? 'POWER_TRACE' : time < run.playbackDurationMs ? 'ORDER_CHECKS' : 'COMPLETE',
    armSurges: run.schedule.filter(event => time <= run.powerWindowMs && Math.abs(time - event.atMs) < 50).map(event => event.arm),
    failures,
  };
}
