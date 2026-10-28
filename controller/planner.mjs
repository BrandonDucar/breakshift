export function planOrders({ count, stationAFault, stations = ['A', 'B'] }) {
  if (!Number.isInteger(count) || count < 1 || !Array.isArray(stations)) throw Error('INVALID_PLAN_REQUEST');
  const eligible = stationAFault ? stations.filter((station) => station !== 'A') : stations;
  if (!eligible.length) throw Error('NO_HEALTHY_STATION');
  return Array.from({ length: count }, (_, index) => ({ order: index + 1, station: eligible[index % eligible.length] }));
}
