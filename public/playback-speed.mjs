export const PLAYBACK_RATES = Object.freeze([0.25, 1 / 3, 0.5, 1, 2]);

export function playbackRate(value) {
  const rate = Number(value);
  if (!PLAYBACK_RATES.includes(rate)) throw Error('PLAYBACK_RATE_NOT_ALLOWED');
  return rate;
}

export function playbackOptions(selected = 1) {
  return PLAYBACK_RATES.map(rate => `<option value="${rate}"${rate === selected ? ' selected' : ''}>${rate === 1 / 3 ? '1/3' : rate}x</option>`).join('');
}
