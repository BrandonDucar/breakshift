import test from 'node:test';
import assert from 'node:assert/strict';
import {photoAssessmentExpired, assertPhotoAssessmentFresh} from './public/photo-assessment-freshness.mjs';
import {photoRepairBinding, executePhotoRepairTest, photoTestReceipt} from './public/photo-repair-bridge.mjs';

const NOW = Date.parse('2026-11-02T12:00:00.000Z');
const PAST = '2000-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';
const expiredError = {message: 'PHOTO_ASSESSMENT_EXPIRED'};

function fixture(mode = 'LIVE_MUSE', expiresAt = FUTURE) {
  return {
    image: {imageDigest: 'a'.repeat(64), imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==', sourceKind: 'USER_SUPPLIED_IMAGE', width: 640, height: 320},
    result: {
      kind: 'PHOTO_VISUAL_ASSESSMENT', imageDigest: 'a'.repeat(64), model: 'muse-wonder-1.0', mode, expiresAt,
      regions: [{label: 'Fixture component', bbox: [10, 20, 100, 100], possibleFixes: ['Test a reference controller hypothesis.']}],
      twinProposals: [{regionIndex: 0, fixIndex: 0, strategyId: 'coordinated_repair', rationale: 'Fixture mapping only.', assumptions: ['Reference workcell behavior is assumed.']}],
    },
    regionIndex: 0, fixIndex: 0, strategyId: 'coordinated_repair', origin: 'WONDER_PROPOSAL', revision: 1,
    snapshotId: 'freshness-fixture', breakerKw: 1.65,
  };
}

test('both known live modes accept a future expiry without mutating the assessment', () => {
  for (const mode of ['LIVE_MUSE', 'LIVE_IMAGE_ASSESSMENT']) {
    const result = Object.freeze({mode, expiresAt: FUTURE});
    assert.equal(photoAssessmentExpired(result, NOW), false);
    assert.equal(assertPhotoAssessmentFresh(result, NOW), result);
  }
});

test('expiry is inclusive at the exact deadline, not one millisecond before', () => {
  const result = {mode: 'LIVE_MUSE', expiresAt: new Date(NOW).toISOString()};
  assert.equal(photoAssessmentExpired(result, NOW - 1), false);
  assert.equal(photoAssessmentExpired(result, NOW), true);
  assert.equal(photoAssessmentExpired(result, NOW + 1), true);
  assert.throws(() => assertPhotoAssessmentFresh(result, NOW), expiredError);
});

test('known live modes fail closed on missing or invalid expiry values', () => {
  for (const mode of ['LIVE_MUSE', 'LIVE_IMAGE_ASSESSMENT']) {
    for (const expiresAt of [undefined, null, '', ' ', 'not a date', 0, Infinity, [], {}, 'x'.repeat(65)]) {
      const result = {mode, expiresAt};
      assert.equal(photoAssessmentExpired(result, NOW), true);
      assert.throws(() => assertPhotoAssessmentFresh(result, NOW), expiredError);
    }
  }
});

test('live freshness fails closed on an invalid clock', () => {
  for (const now of [NaN, Infinity, -Infinity, '2026-11-02', null]) {
    assert.equal(photoAssessmentExpired({mode: 'LIVE_MUSE', expiresAt: FUTURE}, now), true);
  }
});

test('explicit recorded photo replay is exempt even with an old or invalid deadline', () => {
  for (const expiresAt of [undefined, PAST, 'invalid', null]) {
    const result = {mode: 'RECORDED_SAM_WONDER_DEMO', expiresAt};
    assert.equal(photoAssessmentExpired(result, NOW), false);
    assert.equal(assertPhotoAssessmentFresh(result, NOW), result);
  }
});

test('non-live missing-expiry fixtures and absent results remain compatible', () => {
  for (const result of [null, undefined, {}, {mode: 'TEST_ADAPTER'}, {mode: 'FIXTURE'}]) {
    assert.equal(photoAssessmentExpired(result, NOW), false);
    assert.equal(assertPhotoAssessmentFresh(result, NOW), result);
  }
});

test('a supplied deadline is enforced for non-live fixtures too', () => {
  assert.equal(photoAssessmentExpired({mode: 'TEST_ADAPTER', expiresAt: PAST}, NOW), true);
  assert.equal(photoAssessmentExpired({mode: 'TEST_ADAPTER', expiresAt: 'invalid'}, NOW), true);
  assert.equal(photoAssessmentExpired({mode: 'TEST_ADAPTER', expiresAt: FUTURE}, NOW), false);
});

test('cached flags and recorded-like labels do not exempt expired live assessments', () => {
  for (const mode of ['LIVE_MUSE', 'LIVE_IMAGE_ASSESSMENT', 'RECORDED_SAM_WONDER_DEMO_OTHER']) {
    assert.equal(photoAssessmentExpired({mode, expiresAt: PAST, cached: true, sourceKind: 'DEMO_ILLUSTRATION'}, NOW), true);
  }
});

test('binding rejects expired assessments for Wonder and operator mappings in both live modes', () => {
  for (const mode of ['LIVE_MUSE', 'LIVE_IMAGE_ASSESSMENT']) {
    for (const origin of ['WONDER_PROPOSAL', 'OPERATOR_HYPOTHESIS']) {
      const input = fixture(mode, PAST);
      input.origin = origin;
      assert.throws(() => photoRepairBinding(input), expiredError);
      assert.throws(() => executePhotoRepairTest(input), expiredError);
    }
  }
});

test('binding rejects missing and malformed live deadlines', () => {
  for (const mode of ['LIVE_MUSE', 'LIVE_IMAGE_ASSESSMENT']) {
    for (const expiresAt of [undefined, 'invalid', null]) {
      const input = fixture(mode);
      input.result.expiresAt = expiresAt;
      assert.throws(() => photoRepairBinding(input), expiredError);
    }
  }
});

test('fresh live and legacy fixture bindings preserve no-physical-authority scope', () => {
  for (const mode of ['LIVE_MUSE', 'LIVE_IMAGE_ASSESSMENT', 'TEST_ADAPTER', undefined]) {
    const input = fixture(mode);
    if (mode === 'TEST_ADAPTER' || mode === undefined) {
      delete input.result.expiresAt;
      input.result.mode = mode;
    }
    const binding = photoRepairBinding(input);
    assert.equal(binding.physicalClearance, false);
    assert.equal(binding.scope, 'REFERENCE_WORKCELL_HYPOTHESIS_NOT_PHOTO_REPAIR_PROOF');
  }
});

test('recorded replay can still execute a reference test without gaining physical clearance', () => {
  const input = fixture('RECORDED_SAM_WONDER_DEMO', PAST);
  const run = executePhotoRepairTest(input);
  const receipt = photoTestReceipt(run);
  assert.equal(run.photoBinding.mode, 'RECORDED_SAM_WONDER_DEMO');
  assert.equal(run.photoBinding.physicalClearance, false);
  assert.equal(receipt.physicalOutcome, 'NOT_VERIFIED');
  assert.equal(run.compiledPlan.executionAuthority, false);
});
