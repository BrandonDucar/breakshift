import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBayJob, bayJobReport, scanAvailability, scanFailure, createBayJob } from './public/bay-job.mjs';

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

test('guided job restores baseline 1.65 kW after mid-job perturbation without redundant prepare calls', async () => {
  const elements = new Map();
  const root = {
    innerHTML: '',
    querySelector(id) {
      if (!elements.has(id)) {
        const handlers = new Map();
        elements.set(id, {
          textContent: '', innerHTML: '', hidden: false, disabled: false,
          addEventListener(type, fn) { handlers.set(type, fn); },
          async click() { if (!this.disabled) await handlers.get('click')?.(); },
        });
      }
      return elements.get(id);
    },
  };
  let breakerKw = 1.65, snapSeq = 1;
  const prepareCaps = [];
  const results = [];
  const job = createBayJob(root, {
    getContext: () => ({ snapshotId: `snap-${breakerKw}-${snapSeq}`, breakerKw, available: true }),
    prepare: async cap => { prepareCaps.push(cap); if (cap !== undefined) { breakerKw = cap; snapSeq++; } },
    openRecordedDemo() {},
    onResult: r => results.push(r),
  });

  // Stage 1: already at 1.65 kW -> no redundant cap mutation
  await root.querySelector('#job-next').click();
  assert.deepEqual(prepareCaps, [undefined]);
  assert.equal(results.at(-1).strategyId, 'station_handoff');

  // External mid-job perturbation to 1.45 kW locks stale export
  breakerKw = 1.45; snapSeq++; job.sync();
  assert.equal(root.querySelector('#job-download').disabled, true);

  // Stage 2 restores 1.65 kW; Stage 3 runs coordinated_repair at 1.65 kW without redundant mutation and passes
  await root.querySelector('#job-next').click();
  await root.querySelector('#job-next').click();
  assert.deepEqual(prepareCaps, [undefined, 1.65, undefined]);
  assert.equal(results.at(-1).strategyId, 'coordinated_repair');
  assert.equal(results.at(-1).breakerKw, 1.65);
  assert.equal(results.at(-1).passed, true);

  // Stage 4 stresses 1.45 kW (rejected); Stage 5 restores 1.65 kW (passed)
  await root.querySelector('#job-next').click();
  assert.equal(results.at(-1).breakerKw, 1.45);
  assert.equal(results.at(-1).passed, false);
  await root.querySelector('#job-next').click();
  assert.equal(results.at(-1).breakerKw, 1.65);
  assert.equal(results.at(-1).passed, true);
  assert.deepEqual(prepareCaps, [undefined, 1.65, undefined, 1.45, 1.65]);
});
