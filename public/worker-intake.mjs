export function workerIntakeReceipt({ image, result, attempt = { status: 'NOT_REQUESTED' }, hasClip = false }) {
  const accepted = Boolean(image?.imageDigest);
  const matched = accepted && result?.imageDigest === image.imageDigest;
  const recorded = matched && result.mode === 'RECORDED_SAM_WONDER_DEMO';
  const status = matched ? recorded ? 'RECORDED_DEMO_RESULT' : 'ASSESSMENT_RECEIVED' : attempt.status;
  return {
    schema: 'breakshift.worker-intake-receipt.v1',
    capture: accepted ? 'ACCEPTED_IN_BROWSER' : 'NOT_CAPTURED',
    image: accepted ? { sha256: image.imageDigest, width: image.width, height: image.height, sourceKind: image.sourceKind } : null,
    mediaKind: accepted ? hasClip ? 'SHORT_CLIP' : 'STILL_PHOTO' : null,
    analysis: status,
    ...(attempt.scanId ? { scanId: attempt.scanId } : {}),
    ...(attempt.errorCode ? { errorCode: attempt.errorCode } : {}),
    model: matched ? result.model : null,
    physicalOutcome: 'NOT_VERIFIED',
    scope: 'Local browser intake receipt. Accepting a photo is separate from transmitting it, model analysis, and physical repair verification. No original pixels or operator note included.',
  };
}
