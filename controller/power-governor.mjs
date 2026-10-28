export const beltWatts = (speedMps) => 50 + 50 * speedMps ** 2;
export const ARM_IDLE_WATTS = 80;
export const ARM_SURGE_WATTS = 1400;

export function scheduleSurges({ requestedAtMs, breakerKw, mode = 'repair' }) {
  if (mode === 'working') return requestedAtMs.map((atMs, index) => ({ arm: index ? 'B' : 'A', atMs, beltSpeedMps: 1 }));
  // At 0.7m/s one arm's 1.4kW surge + idle peer + belt remains below 1.65kW.
  return requestedAtMs.map((atMs, index) => ({ arm: index ? 'B' : 'A', atMs: atMs + index * 150, beltSpeedMps: 0.7, breakerKw }));
}

export function wattsAt({ timeMs, schedule }) {
  // A gripper fault prevents a successful pick; it does not make its motor's
  // attempted acceleration free. Keep that failed surge in the physical model.
  const active = schedule.filter((event) => Math.abs(timeMs - event.atMs) < 50);
  const speed = active[0]?.beltSpeedMps ?? 0.7;
  return beltWatts(speed) + 2 * ARM_IDLE_WATTS + active.length * (ARM_SURGE_WATTS - ARM_IDLE_WATTS);
}
