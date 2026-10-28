export function predictGrasp({ sensorAtMs, beltSpeedMps, sensorLagMs, distanceM = 0.7, mode = 'repair' }) {
  if (!Number.isFinite(sensorAtMs) || !Number.isFinite(beltSpeedMps) || !Number.isFinite(sensorLagMs)) throw Error('INVALID_TIMING_INPUT');
  if (beltSpeedMps <= 0 || sensorLagMs < 0) throw Error('INVALID_TIMING_RANGE');
  // The working fault incorrectly assumes the nominal 1m/s belt after throttling.
  const effectiveSpeed = mode === 'working' ? 1 : beltSpeedMps;
  return sensorAtMs + sensorLagMs + (distanceM / effectiveSpeed) * 1000;
}

export function withinGraspWindow({ predictedAtMs, actualAtMs, windowMs = 22 }) {
  return Math.abs(predictedAtMs - actualAtMs) <= windowMs;
}
