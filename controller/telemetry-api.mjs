const keys = new Set(['timestampMs', 'beltSpeedMps', 'station', 'sensorLagMs']);
export function parseSensorPacket(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('MALFORMED_SENSOR_PACKET');
  for (const key of Object.keys(value)) if (!keys.has(key)) throw Error('UNEXPECTED_SENSOR_FIELD');
  const { timestampMs, beltSpeedMps, station, sensorLagMs } = value;
  if (!Number.isFinite(timestampMs) || timestampMs < 0 || !Number.isFinite(beltSpeedMps) || beltSpeedMps <= 0 || !Number.isFinite(sensorLagMs) || sensorLagMs < 0) throw Error('INVALID_SENSOR_VALUES');
  if (!['A', 'B'].includes(station)) throw Error('INVALID_SENSOR_STATION');
  return { timestampMs, beltSpeedMps, station, sensorLagMs };
}
