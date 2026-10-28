// Presentation is derived from the selected simulation trace, never from artwork pixels.
export const COMPONENTS = Object.freeze({
  'PANEL-BUS-48V': { number: '01', short: 'Power bus', name: 'Shared power bus', layer: 'energy', file: 'controller/power-governor.mjs', check: 'CHK-POWER-INTERLEAVE', workcell: [85, 28], cutaway: [32, 78], schematic: [50, 31], description: 'Both arms draw from the same modeled bus. Concurrent acceleration surges can exceed the breaker ceiling.', intervention: 'Stagger arm surges by 150 ms and throttle the conveyor to 0.7 m/s.' },
  'GANTRY-STA-A': { number: '02', short: 'Station A', name: 'Station A / gripper', layer: 'mechanical', file: 'controller/planner.mjs', check: null, workcell: [57, 52], cutaway: [79, 46], schematic: [78, 51], description: 'The injected gripper fault leaves Station A unavailable. A successful handoff does not repair this physical assembly.', intervention: 'Remove Station A from the active order plan; use Station B for the simulated run.' },
  'JBOX-OPT-S1': { number: '03', short: 'Optical gate', name: 'Optical gate / timing', layer: 'software', file: 'controller/kinematics-timing.mjs', check: 'CHK-TIMING-SYNC', workcell: [70, 71], cutaway: [59, 29], schematic: [50, 51], description: 'The sensor packet arrives late. Timing must use the actual throttled belt speed to predict the grasp window.', intervention: 'Compensate for measured packet lag and use the current conveyor velocity.' },
  'GANTRY-STB-B': { number: '04', short: 'Station B', name: 'Station B / handoff', layer: 'mechanical', file: 'controller/planner.mjs', check: 'CHK-STATION-HANDOFF', workcell: [88, 65], cutaway: null, schematic: [78, 73], description: 'The second arm takes the order queue when Station A degrades. Its surge must still respect the shared power budget.', intervention: 'Route the queue to Station B and arbitrate each acceleration through the energy governor.' },
});

export function componentState(zoneId, session, trace = 'working') {
  const part = COMPONENTS[zoneId];
  if (!part || !session.twins[trace]) throw new Error('UNKNOWN_COMPONENT_OR_TRACE');
  const result = session.twins[trace];
  const check = session.scopedChecks.find(item => item.checkId === part.check);
  if (zoneId === 'GANTRY-STA-A') return { color: 'red', label: 'GRIPPER FAULT / UNAVAILABLE', metric: 'Faulted', unit: 'injected state', detail: part.intervention, check };
  if (zoneId === 'PANEL-BUS-48V') {
    const failed = result.breakerTrip || result.peakKw > session.breakerKw;
    return { color: failed ? 'red' : trace === 'working' ? 'amber' : 'green', label: failed ? 'MAIN_BUS_OVERCURRENT' : 'WITHIN SIMULATED POWER CAP', metric: result.peakKw.toFixed(3), unit: 'kW peak', detail: `${Math.max(0, session.breakerKw - result.peakKw).toFixed(3)} kW headroom · ${result.socWh.toFixed(3)} Wh buffer remaining`, check };
  }
  const passed = trace !== 'working' && result.packed === result.orderCount && Boolean(check?.passed);
  return { color: passed ? 'green' : 'red', label: passed ? 'PASSED / CURRENT SIMULATION' : zoneId === 'JBOX-OPT-S1' ? 'LATE SIGNAL / TIMING MISS' : 'HANDOFF NOT COMPLETED', metric: `${result.packed}/${result.orderCount}`, unit: 'parts packed', detail: part.intervention, check };
}
