import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBayJob, bayJobReport, scanAvailability, scanFailure } from './public/bay-job.mjs';

test('demo job rejects partial repairs, passes coordinated repair, and rejects a tighter breaker', () => {
  const run = (strategyId, breakerKw = 1.65) => evaluateBayJob({ strategyId, breakerKw, snapshotId: 'fixture-snapshot' });
  assert.equal(run('station_handoff').passed, false);
  const partial = run('surge_interleave');
  assert.equal(partial.passed, false);
  assert.ok(partial.blockers.length);
  const complete = run('coordinated_repair');
  assert.equal(complete.passed, true);
  assert.equal(complete.repair.packed, 8);
  assert.equal(complete.challenger.packed, 8);
  assert.equal(complete.modelCalls, 0);
  assert.equal(run('coordinated_repair', 1.45).passed, false);
});
test('service report preserves rejected results, scope and escaped input', () => {
  const result = evaluateBayJob({ strategyId: 'coordinated_repair', breakerKw: 1.45, snapshotId: '<script>alert(1)</script>' });
  const html = bayJobReport(result);
  assert.match(html, /REJECTED BY MODELED CHECKS/);
  assert.match(html, /Station A remains faulted/);
  assert.match(html, /Unsigned local report/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.throws(() => bayJobReport({}), /RESULT_REQUIRED/);
});
test('paused scans never advertise availability or recommend retrying', () => {
  const message = scanAvailability({ authenticated: true, enabled: false, remainingScans: 37, reason: 'MUSE_LEDGER_RECONCILIATION_REQUIRED' });
  assert.match(message, /paused/);
  assert.match(message, /No new scan will be sent/);
  assert.doesNotMatch(message, /Live analysis available/);
  assert.match(scanAvailability({ enabled: false, reason: 'MUSE_SCAN_BUDGET_NOT_AVAILABLE' }), /exhausted/);
  assert.match(scanAvailability({ authenticated: false }), /Open access/);
  assert.match(scanAvailability({ authenticated: false }), /Live model analysis is restricted/);
  assert.match(scanFailure(Error('MUSE_PHOTO_BOX_OUT_OF_RANGE')), /invalid image coordinates/);
  assert.match(scanFailure(Error('MUSE_LEDGER_RECONCILIATION_REQUIRED')), /No new scan was sent/);
  assert.match(scanAvailability({ reason: 'LOCAL_PREVIEW_NO_PROVIDER' }), /Local review build/);
});

test('every rejected supported demo combination explains its terminal outcome', () => {
  let rejected=0;
  for(const strategyId of ['station_handoff','surge_interleave','timing_compensation','coordinated_repair']){
    for(const breakerKw of [1.4,1.45,1.65,2,2.5,3.2]){
      const result=evaluateBayJob({strategyId,breakerKw,snapshotId:'acceptance-fixture'});
      if(result.passed)continue;
      rejected++;assert.ok(result.blockers.length>0);
      assert.ok(result.blockers.every(reason=>typeof reason==='string'&&reason.trim()));
      assert.match(bayJobReport(result),/<h2>Decision<\/h2><p>[^<]+<\/p>/);
    }
  }
  assert.ok(rejected>0);
});
