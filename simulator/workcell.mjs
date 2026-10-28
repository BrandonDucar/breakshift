import { predictGrasp, withinGraspWindow } from '../controller/kinematics-timing.mjs';
import { planOrders } from '../controller/planner.mjs';
import { scheduleSurges, wattsAt } from '../controller/power-governor.mjs';
import { parseSensorPacket } from '../controller/telemetry-api.mjs';

export function simulate(scenario, mode = 'repair', recipe = {}) {
  const powerMode = recipe.powerMode ?? mode;
  const timingMode = recipe.timingMode ?? mode;
  const handoff = recipe.handoff ?? true;
  const plan = planOrders({ count: scenario.orderCount, stationAFault: handoff && scenario.stationAFault });
  const schedule = scheduleSurges({ requestedAtMs: [300, 300], breakerKw: scenario.breakerKw, mode: powerMode });
  const telemetryErrors = [];
  for (const packet of scenario.malformedPackets || []) try { parseSensorPacket(packet); } catch (error) { telemetryErrors.push(error.message); }
  const waveform = [];
  let breakerTrip = false;
  let socWh = 2.4;
  for (let timeMs = 0; timeMs <= 1200; timeMs += 10) {
    const watts = wattsAt({ timeMs, schedule });
    const capKw = scenario.cloudDips.find((dip) => timeMs >= dip.fromMs && timeMs <= dip.toMs)?.capKw ?? scenario.breakerKw;
    if (watts > capKw * 1000) breakerTrip = true;
    socWh = Math.max(0, socWh - Math.max(0, watts - capKw * 1000) * (10 / 3600000));
    waveform.push({ timeMs, kw: +(watts / 1000).toFixed(3), capKw, tripped: breakerTrip });
  }
  const beltSpeedMps = powerMode === 'working' ? 1 : 0.7;
  const parts = plan.map((item, index) => {
    const sensorAtMs = index * 80;
    const actualAtMs = sensorAtMs + scenario.sensorLagMs + (700 / beltSpeedMps);
    const predictedAtMs = predictGrasp({ sensorAtMs, beltSpeedMps, sensorLagMs: scenario.sensorLagMs, mode: timingMode });
    const stationHealthy = !(scenario.stationAFault && item.station === 'A');
    return { ...item, packed: !breakerTrip && stationHealthy && withinGraspWindow({ predictedAtMs, actualAtMs }) };
  });
  const packed = parts.filter((part) => part.packed).length;
  return { label: mode, simulated: true, breakerTrip, peakKw: Math.max(...waveform.map((point) => point.kw)), socWh: +socWh.toFixed(4), packed, orderCount: scenario.orderCount, throughputPerMin: +(packed / 1.2 * 60).toFixed(1), whPerPart: packed ? +((waveform.reduce((sum, point) => sum + point.kw * 1000, 0) * 10 / 3600000) / packed).toFixed(3) : null, telemetryErrors, waveform, parts };
}
