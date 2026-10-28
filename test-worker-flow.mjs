import test from 'node:test';
import assert from 'node:assert/strict';
import { workerIntakeReceipt } from './public/worker-intake.mjs';
import { playbackRate, playbackOptions, PLAYBACK_RATES } from './public/playback-speed.mjs';
const image = { imageDigest: 'a'.repeat(64), width: 768, height: 384, sourceKind: 'USER_SUPPLIED_IMAGE', imageDataUrl: 'private-pixels-not-in-receipt' };

test('worker photo acceptance survives analysis rejection without claiming server upload or physical verification', () => {
  const record = workerIntakeReceipt({ image, attempt: { status: 'ASSESSMENT_REJECTED', scanId: 'fixture-id', errorCode: 'MUSE_PHOTO_BOX_OUT_OF_RANGE' } });
  assert.equal(record.capture, 'ACCEPTED_IN_BROWSER');
  assert.equal(record.analysis, 'ASSESSMENT_REJECTED');
  assert.equal(record.physicalOutcome, 'NOT_VERIFIED');
  assert.equal(record.image.sha256, image.imageDigest);
  assert.equal(JSON.stringify(record).includes(image.imageDataUrl), false);
  assert.equal(record.model, null);
});
test('pending, unrelated result, recorded demo and no-photo remain distinct', () => {
  assert.equal(workerIntakeReceipt({ image }).analysis, 'NOT_REQUESTED');
  assert.equal(workerIntakeReceipt({ image, attempt: { status: 'PENDING' } }).analysis, 'PENDING');
  const unrelated = { imageDigest: 'different', mode: 'LIVE_MUSE', model: 'muse-wonder-1.0' };
  assert.equal(workerIntakeReceipt({ image, result: unrelated }).analysis, 'NOT_REQUESTED');
  const replay = workerIntakeReceipt({ image, result: { ...unrelated, imageDigest: image.imageDigest, mode: 'RECORDED_SAM_WONDER_DEMO' }, hasClip: true });
  assert.equal(replay.analysis, 'RECORDED_DEMO_RESULT');
  assert.equal(replay.mediaKind, 'SHORT_CLIP');
  assert.equal(workerIntakeReceipt({ image: null }).capture, 'NOT_CAPTURED');
});
test('playback rate is finite and allowlisted; no arbitrary machine-speed input', () => {
  for (const value of PLAYBACK_RATES) assert.equal(playbackRate(String(value)), value);
  for (const bad of [-1, 0, 10, Infinity, NaN, '', 'fast', '2<script>']) assert.throws(() => playbackRate(bad));
  assert.match(playbackOptions(0.5), /value="0.5" selected/);
});
