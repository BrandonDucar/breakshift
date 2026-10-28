import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSabotageCommand, createSabotageConsole } from './public/sabotage-console.mjs';
import { createInspectionSessionCore, projectSessionForSurface } from './session/inspection-session-core.mjs';

test('review control: supported breaker and named recipe commands remain available', () => {
  assert.equal(parseSabotageCommand('drop breaker to 1.45 kW').breakerKw, 1.45);
  assert.equal(parseSabotageCommand('coordinated repair').strategyId, 'coordinated_repair');
});
test('CR-01: negated and partially understood commands cannot silently change state', () => {
  for (const command of ['do not drop breaker to 1.45 kW', 'drop breaker to 1.45 kW then delete all records', 'coordinated repair and jam Station A']) {
    assert.equal(parseSabotageCommand(command).ok, false, command);
  }
});
test('CR-02: an unmodeled numeric sensor delay is rejected instead of replaced with a recipe', () => {
  for (const command of ['delay sensor +45 ms', 'delay optical gate +45 ms']) assert.equal(parseSabotageCommand(command).ok, false, command);
});
test('CR-03: breaker values remain on the same 0.05 kW grid as paid component scans', () => {
  for (const command of ['set breaker to 1.455 kW', 'set breaker to 1.46 kW']) assert.equal(parseSabotageCommand(command).ok, false, command);
});

function consoleStub() {
  const elements = new Map();
  const root = {
    innerHTML: '', addEventListener() {}, querySelectorAll: () => [],
    querySelector(id) {
      if (!elements.has(id)) elements.set(id, { textContent: '', className: '', hidden: false, disabled: false, addEventListener() {}, setAttribute() {} });
      return elements.get(id);
    },
  };
  return root;
}
test('CR-04: failed mutation never reports an applied limit', async () => {
  const core = createInspectionSessionCore(), root = consoleStub();
  const controller = createSabotageConsole({ hudEl: null, consoleEl: root,
    getContext: () => ({ session: projectSessionForSurface(core.getState(), 'laptop'), available: true, trace: 'working', view: 'workcell', webglAvailable: false }),
    applyBreaker: async () => null, selectZone: async () => null, setView() {}, setCameraPreset() {}, launchRepairTwin() {},
  });
  await controller.executeCommand('drop breaker to 1.45 kW');
  assert.equal(core.getState().breakerKw, 1.65);
  assert.doesNotMatch(root.querySelector('#sabotage-status').textContent, /^Applied 1\.45/);
});
