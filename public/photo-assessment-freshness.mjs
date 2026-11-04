const LIVE_MODES = new Set(['LIVE_MUSE', 'LIVE_IMAGE_ASSESSMENT']);

export function photoAssessmentExpired(result, now = Date.now()) {
  if (result?.mode === 'RECORDED_SAM_WONDER_DEMO') return false;
  const expiresAt = result?.expiresAt;
  // Legacy non-live fixtures have no retention deadline; live results must have one.
  if (expiresAt === undefined && !LIVE_MODES.has(result?.mode)) return false;
  if (!Number.isFinite(now) || typeof expiresAt !== 'string' || !expiresAt.trim() || expiresAt.length > 64) return true;
  const deadline = Date.parse(expiresAt);
  return !Number.isFinite(deadline) || deadline <= now;
}

export function assertPhotoAssessmentFresh(result, now = Date.now()) {
  if (photoAssessmentExpired(result, now)) throw Error('PHOTO_ASSESSMENT_EXPIRED');
  return result;
}
