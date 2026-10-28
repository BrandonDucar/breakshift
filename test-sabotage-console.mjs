import test from 'node:test';
import assert from 'node:assert/strict';
import { createInspectionSessionCore, projectSessionForSurface } from './session/inspection-session-core.mjs';
import { executeRepairRun } from './simulator/repair-run.mjs';
import { parseSabotageCommand, buildReasoningSteps } from './public/sabotage-console.mjs';

test('deterministic perturbation parser maps bounded breaker caps, recipes, compound commands, zones and views', () => {
  assert.deepEqual(
    { ok: true, kind: 'SET_BREAKER_KW', breakerKw: 1.45 },
    {
      ok: parseSabotageCommand('drop breaker to 1.45 kW').ok,
      kind: parseSabotageCommand('drop breaker to 1.45 kW').kind,
      breakerKw: parseSabotageCommand('drop breaker to 1.45 kW').breakerKw,
    },
  );
  assert.equal(parseSabotageCommand('brownout').breakerKw, 1.45);
  assert.equal(parseSabotageCommand('restore breaker').breakerKw, 1.65);

  assert.equal(parseSabotageCommand('power-only fix').strategyId, 'surge_interleave');
  assert.equal(parseSabotageCommand('delay sensor / timing fix').strategyId, 'timing_compensation');
  assert.equal(parseSabotageCommand('jam Station A').strategyId, 'station_handoff');
  assert.equal(parseSabotageCommand('run coordinated repair').strategyId, 'coordinated_repair');

  const compound = parseSabotageCommand('drop breaker to 1.45 kW and run coordinated repair');
  assert.equal(compound.ok, true);
  assert.equal(compound.kind, 'COMPOUND');
  assert.equal(compound.breakerKw, 1.45);
  assert.equal(compound.strategyId, 'coordinated_repair');

  assert.equal(parseSabotageCommand('inspect optical gate').zoneId, 'JBOX-OPT-S1');
  assert.equal(parseSabotageCommand('focus Station B').zoneId, 'GANTRY-STB-B');
  assert.equal(parseSabotageCommand('48V cabinet').zoneId, 'PANEL-BUS-48V');
  assert.equal(parseSabotageCommand('top bus').preset, 'top');
  assert.equal(parseSabotageCommand('look inside cutaway').view, 'cutaway');
});

test('parser fails closed on empty, overly long, out-of-range breaker, PLC/LOTO overrides, and unmodeled prose', () => {
  assert.equal(parseSabotageCommand('   ').code, 'COMMAND_EMPTY');
  assert.equal(parseSabotageCommand('x'.repeat(161)).code, 'COMMAND_TOO_LONG');
  assert.equal(parseSabotageCommand('set breaker to 0.8 kW').code, 'BREAKER_OUT_OF_RANGE');
  assert.equal(parseSabotageCommand('set breaker to 9.5 kW').code, 'BREAKER_OUT_OF_RANGE');
  assert.equal(parseSabotageCommand('energize live PLC and bypass LOTO').code, 'PHYSICAL_OR_PLC_BLOCKED');
  assert.equal(parseSabotageCommand('change weather to thunderstorm').code, 'UNSUPPORTED_PERTURBATION');
});

test('REASONING STEPS trace reflects real simulator state, zero model calls, and withdraws stale runs on snapshot change', () => {
  const core = createInspectionSessionCore();
  const s1 = projectSessionForSurface(core.getState(), 'laptop');

  const baselineTrace = buildReasoningSteps({ session: s1, trace: 'working' });
  assert.equal(baselineTrace.modelCalls, 0);
  assert.equal(baselineTrace.steps.length, 4);
  assert.equal(baselineTrace.verdictTone, 'green');
  assert.match(baselineTrace.steps[0].detail, new RegExp(s1.evidenceSnapshotId));

  const partialRun = executeRepairRun({
    strategyId: 'surge_interleave',
    breakerKw: s1.breakerKw,
    snapshotId: s1.evidenceSnapshotId,
    scanId: 'DETERMINISTIC_CONSOLE',
  });
  const partialTrace = buildReasoningSteps({
    session: s1,
    trace: 'working',
    activeRun: partialRun,
    lastCommand: parseSabotageCommand('power-only fix'),
  });
  assert.equal(partialTrace.hasCurrentRun, true);
  assert.equal(partialTrace.verdictTone, 'red');
  assert.match(partialTrace.steps[3].detail, /REJECTED:/);

  const passedRun = executeRepairRun({
    strategyId: 'coordinated_repair',
    breakerKw: s1.breakerKw,
    snapshotId: s1.evidenceSnapshotId,
    scanId: 'DETERMINISTIC_CONSOLE',
  });
  const passedTrace = buildReasoningSteps({
    session: s1,
    trace: 'repair',
    activeRun: passedRun,
    lastCommand: parseSabotageCommand('coordinated repair'),
  });
  assert.equal(passedTrace.hasCurrentRun, true);
  assert.equal(passedTrace.verdictTone, 'green');
  assert.match(passedTrace.steps[3].detail, /GREEN WITHIN SCOPE/);
  assert.match(passedTrace.steps[3].detail, /physical LOTO/);

  // Changing breaker ceiling invalidates prior recipe run immediately
  core.mutate({ type: 'SET_BREAKER_KW', breakerKw: 1.45, surface: 'laptop', expectedVersion: core.getState().version });
  const s2 = projectSessionForSurface(core.getState(), 'laptop');
  const staleTrace = buildReasoningSteps({
    session: s2,
    trace: 'repair',
    activeRun: passedRun,
    lastCommand: parseSabotageCommand('drop breaker to 1.45 kW'),
  });
  assert.equal(staleTrace.hasCurrentRun, false);
  assert.equal(staleTrace.verdictTone, 'red');
  assert.match(staleTrace.steps[2].detail, /Prior recipe withdrawn on snapshot change/);
});
