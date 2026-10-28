import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { compileRepairPlan, lowerRepairPlan } from './controller/repair-compiler.mjs';
import { executeCompiledRepairPlan } from './simulator/repair-run.mjs';
import { createFaultExperiment, normalizeFaultCommand } from './public/fault-lab.mjs';
import {
  EXPERIMENT_REPLAY_CONTRACT,
  MAX_EXPERIMENT_BYTES,
  parseAndReplayExperiment,
  replayFaultReceipt,
  verifyFaultReceipt,
} from './public/experiment-replay.mjs';
import { evaluateBayJob, bayJobReport } from './public/bay-job.mjs';
import { createInspectionSessionCore, sha256Hex } from './session/inspection-session-core.mjs';
import worker from './cloudflare/worker.mjs';

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('./replay-experiment.mjs', import.meta.url));

function resealReceipt(receipt) {
  const { receiptDigest, ...body } = receipt;
  return { ...body, receiptDigest: sha256Hex(body) };
}

function buildExperimentReceipt(strategyId = 'coordinated_repair', breakerKw = 1.65, scanId = 'DETERMINISTIC_DEMO_JOB') {
  const context = { snapshotId: 'snap-argon-1', version: 1, breakerKw, available: true };
  const lab = createFaultExperiment({
    getContext: () => context,
    applyBreaker: async () => false,
    startPlayback: () => {},
    clock: () => '2026-10-28T01:15:00.000Z',
  });
  lab.recordRecipe(strategyId, context.snapshotId, scanId);
  return lab.exportReceipt();
}

test('compiler rejects prototype-less objects, extra keys, control chars, and non-modeled strategies', () => {
  const valid = {
    strategyId: 'coordinated_repair',
    breakerKw: 1.65,
    snapshotId: 'snap-clean-01',
    scanId: 'scan-clean-01',
  };

  const nullProto = Object.assign(Object.create(null), valid);
  assert.throws(() => compileRepairPlan(nullProto), /REPAIR_SOURCE_SHAPE_INVALID/);

  for (const bad of [
    { ...valid, extraAuthority: true },
    { ...valid, strategyId: 'inspect_gripper' },
    { ...valid, strategyId: 'toString' },
    { ...valid, strategyId: 'valueOf' },
    { ...valid, snapshotId: '   ' },
    { ...valid, snapshotId: 'snap\u0000null' },
    { ...valid, snapshotId: 'snap\u007fdel' },
    { ...valid, scanId: 'scan\r\ninject' },
    { ...valid, breakerKw: 1.3999 },
    { ...valid, breakerKw: 3.2001 },
    { ...valid, breakerKw: Infinity },
    { ...valid, breakerKw: -Infinity },
  ]) {
    assert.throws(() => compileRepairPlan(bad));
  }

  const compiled = compileRepairPlan(valid);
  assert.equal(Object.isFrozen(compiled), true);
  assert.equal(Object.isFrozen(compiled.bindings), true);
  assert.equal(Object.isFrozen(compiled.operations), true);
  assert.equal(Object.isFrozen(compiled.requiredChecks), true);

  const lowered = lowerRepairPlan(compiled, valid);
  assert.equal(Object.isFrozen(lowered), true);
});

test('rehashed compiler IR with escalated flags or swapped bindings cannot lower or execute', () => {
  const ctx = {
    strategyId: 'coordinated_repair',
    breakerKw: 1.45,
    snapshotId: 'snap-145',
    scanId: 'scan-145',
  };
  const basePlan = compileRepairPlan(ctx);

  for (const mutate of [
    p => { p.physicalClearance = true; },
    p => { p.executionAuthority = true; },
    p => { p.compileStatus = 'APPROVED_FOR_LIVE_PLC'; },
    p => { p.bindings.breakerKw = 1.65; },
    p => { p.operations[2].policy = 'INCLUDE_FAULTED_STATIONS'; },
  ]) {
    const forged = structuredClone(basePlan);
    mutate(forged);
    const { planDigest, ...body } = forged;
    forged.planDigest = sha256Hex(body);
    assert.throws(() => lowerRepairPlan(forged, ctx), /REPAIR_PLAN_BINDING_OR_CONTENT_MISMATCH/);
    assert.throws(() => executeCompiledRepairPlan(forged, ctx), /REPAIR_PLAN_BINDING_OR_CONTENT_MISMATCH/);
  }
});

test('64-event rolling trace window preserves cryptographic chain across >64 fault injections', async () => {
  const session = createInspectionSessionCore();
  let step = 0;
  const lab = createFaultExperiment({
    getContext: () => {
      const s = session.getState();
      return { snapshotId: s.evidenceSnapshotId, version: s.version, breakerKw: s.breakerKw, available: true };
    },
    applyBreaker: async (cap, expectedSnapshotId) => {
      const current = session.getState();
      if (current.evidenceSnapshotId !== expectedSnapshotId) return false;
      session.mutate({ type: 'SET_BREAKER_KW', breakerKw: cap, expectedVersion: current.version });
      return true;
    },
    startPlayback: () => {},
    clock: () => `2026-10-28T01:20:${String(step++ % 60).padStart(2, '0')}.000Z`,
  });

  await lab.start();
  // Each breaker toggle appends 4 events (COMMAND_RECEIVED, COMMAND_APPLIED, RUN_INVALIDATED, RUN_EVALUATED).
  // 20 toggles => >80 events, forcing rolling truncation past 64 events.
  for (let i = 0; i < 20; i++) {
    const nextCap = i % 2 === 0 ? 1.45 : 1.65;
    const ok = await lab.inject({ breakerKw: nextCap });
    assert.equal(ok, true);
  }

  const state = lab.state();
  assert.equal(state.events.length, 64);
  assert.equal(state.omittedEvents > 0, true);
  assert.notEqual(state.anchor, '0'.repeat(64));

  const receipt = lab.exportReceipt();
  assert.equal(verifyFaultReceipt(receipt), true);
  const replayed = parseAndReplayExperiment(JSON.stringify(receipt));
  assert.equal(replayed.status, 'REPLAY_MATCH');
  assert.equal(replayed.recordedVerdict, 'PASS');
  assert.equal(replayed.appliedToCurrentSession, false);
});

test('invalidated, clearance-claiming, or provider-claiming receipts fail integrity verification even when rehashed', () => {
  for (const mutate of [
    r => { r.physicalClearance = true; },
    r => { r.providerCalls = 1; },
    r => { r.currentResult.invalidated = true; },
    r => { r.currentSnapshotId = 'snap-mismatch'; },
    r => { r.trace.events = []; },
    r => { r.trace.anchor = 'G'.repeat(64); },
  ]) {
    const forged = resealReceipt((() => {
      const r = buildExperimentReceipt('coordinated_repair', 1.65);
      mutate(r);
      return r;
    })());
    assert.equal(verifyFaultReceipt(forged), false);
    assert.throws(() => replayFaultReceipt(forged), /EXPERIMENT_INTEGRITY_REJECTED/);
  }
});

test('characterization (AR-01 & AR-02): off-grid breakerKw and top-level envelope edits never mutate session or grant authority', () => {
  // AR-01: UI/session command normalizer strictly rejects off-grid breaker caps (e.g. 1.554 kW),
  // and even if a synthetic receipt carries 1.554 kW, replay either rejects it or keeps appliedToCurrentSession=false.
  assert.throws(() => normalizeFaultCommand({ breakerKw: 1.554 }), /FAULT_BREAKER_OUT_OF_RANGE/);
  try {
    const offGridResult = evaluateBayJob({
      strategyId: 'coordinated_repair',
      breakerKw: 1.554,
      snapshotId: 'snap-offgrid',
      scanId: 'DETERMINISTIC_DEMO_JOB',
    });
    const base = buildExperimentReceipt('coordinated_repair', 1.65);
    base.currentSnapshotId = 'snap-offgrid';
    base.currentResult = offGridResult;
    const outcome = replayFaultReceipt(resealReceipt(base));
    assert.equal(outcome.appliedToCurrentSession, false);
    assert.equal(outcome.physicalClearance, false);
    assert.equal(outcome.authorVerified, false);
  } catch (err) {
    assert.match(err.message, /INVALID_REPAIR_RUN_INPUT|REPAIR_CURRENT_CONTEXT_INVALID|INTEGRITY_REJECTED/);
  }

  // AR-02: Rewriting top-level receipt.scope or injecting extra top-level metadata cannot poison replay output.
  const spoofedTop = buildExperimentReceipt('coordinated_repair', 1.45);
  spoofedTop.scope = 'CERTIFIED_FOR_LIVE_PLC';
  spoofedTop.operatorApproved = true;
  try {
    const outcome = replayFaultReceipt(resealReceipt(spoofedTop));
    assert.equal(outcome.recordedVerdict, 'REJECTED');
    assert.equal(outcome.appliedToCurrentSession, false);
    assert.equal(outcome.physicalClearance, false);
    assert.doesNotMatch(outcome.scope, /CERTIFIED_FOR_LIVE_PLC/);
  } catch (err) {
    assert.match(err.message, /INTEGRITY_REJECTED|MISMATCH/);
  }
});

test('bayJobReport escapes untrusted snapshot/scan strings and binds compiled plan digest', () => {
  const xssSnap = 'snap-"><img src=x onerror=alert(1)>';
  const xssScan = 'scan-"><script>evil()</script>';
  const result = evaluateBayJob({
    strategyId: 'coordinated_repair',
    breakerKw: 1.65,
    snapshotId: xssSnap,
    scanId: xssScan,
  });
  const html = bayJobReport(result);
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<img src=x'), false);
  assert.equal(html.includes(result.compiledPlan.planDigest), true);
  assert.match(html, /not physical service clearance/);
});

test('replay-experiment.mjs CLI verifies valid PASS/REJECTED receipts and exits non-zero on forged or legacy files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'breakshift-argon-cli-'));
  try {
    const passFile = join(dir, 'pass.json');
    const rejectFile = join(dir, 'rejected-145kw.json');
    const forgedFile = join(dir, 'forged-pass.json');
    const legacyFile = join(dir, 'legacy-v1.json');
    const hugeFile = join(dir, 'huge.json');

    await writeFile(passFile, JSON.stringify(buildExperimentReceipt('coordinated_repair', 1.65)));
    await writeFile(rejectFile, JSON.stringify(buildExperimentReceipt('coordinated_repair', 1.45)));

    const forged = buildExperimentReceipt('coordinated_repair', 1.45);
    forged.currentResult.passed = true;
    await writeFile(forgedFile, JSON.stringify(resealReceipt(forged)));

    const legacy = buildExperimentReceipt('coordinated_repair', 1.65);
    legacy.schema = 'breakshift.fault-experiment.v1';
    delete legacy.replayContract;
    delete legacy.currentResult.compiledPlan;
    await writeFile(legacyFile, JSON.stringify(resealReceipt(legacy)));

    await writeFile(hugeFile, 'x'.repeat(MAX_EXPERIMENT_BYTES + 16));

    const passRun = await execFileAsync(process.execPath, [CLI_PATH, passFile]);
    const passJson = JSON.parse(passRun.stdout);
    assert.equal(passJson.status, 'REPLAY_MATCH');
    assert.equal(passJson.recordedVerdict, 'PASS');
    assert.equal(passJson.appliedToCurrentSession, false);
    assert.equal(passJson.providerCalls, 0);

    const rejectRun = await execFileAsync(process.execPath, [CLI_PATH, rejectFile]);
    const rejectJson = JSON.parse(rejectRun.stdout);
    assert.equal(rejectJson.status, 'REPLAY_MATCH');
    assert.equal(rejectJson.recordedVerdict, 'REJECTED');
    assert.equal(rejectJson.physicalClearance, false);

    for (const [badPath, expectedReason] of [
      [forgedFile, /EXPERIMENT_RECORDED_RESULT_MISMATCH/],
      [legacyFile, /LEGACY_RECEIPT_INTEGRITY_ONLY_REPLAY_UNAVAILABLE/],
      [hugeFile, /EXPERIMENT_FILE_TOO_LARGE_OR_INVALID/],
      [dir, /EXPERIMENT_FILE_TOO_LARGE_OR_INVALID/],
    ]) {
      await assert.rejects(
        async () => execFileAsync(process.execPath, [CLI_PATH, badPath]),
        err => {
          assert.equal(err.code, 1);
          const out = JSON.parse(err.stdout);
          assert.equal(out.status, 'REPLAY_REJECTED');
          assert.equal(out.appliedToCurrentSession, false);
          assert.equal(out.providerCalls, 0);
          assert.match(out.reason, expectedReason);
          return true;
        },
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Cloudflare Worker enforces open-link read-only boundary, cross-origin rejection, and ?operator=1 non-escalation', async () => {
  const env = {
    MUSE_BUDGET: {
      idFromName() {
        throw new Error('DURABLE_OBJECT_MUST_NOT_BE_TOUCHED_FOR_UNAUTHENTICATED_TRAFFIC');
      },
    },
    ASSETS: {
      async fetch() {
        return new Response('<!doctype html><title>bay</title>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      },
    },
  };

  // 1. ?operator=1 query string grants zero server-side tester privilege
  const opStatusRes = await worker.fetch(new Request('https://bay.example/api/muse/status?operator=1'), env);
  assert.equal(opStatusRes.status, 200);
  const opStatus = await opStatusRes.json();
  assert.equal(opStatus.authenticated, false);
  assert.equal(opStatus.enabled, false);
  assert.equal(opStatus.remainingScans, 0);
  assert.equal(opStatus.appAccess, 'OPEN_LINK');

  const opScanRes = await worker.fetch(
    new Request('https://bay.example/api/muse/scan?operator=1', {
      method: 'POST',
      headers: { origin: 'https://bay.example', 'content-type': 'application/json' },
      body: '{}',
    }),
    env,
  );
  assert.equal(opScanRes.status, 403);
  assert.equal((await opScanRes.json()).error, 'MUSE_TESTER_ACCESS_REQUIRED');

  // 2. Cross-origin GET and POST to /api/muse/* fail closed before auth or budget DO
  for (const req of [
    new Request('https://bay.example/api/muse/status', { headers: { origin: 'https://evil.example' } }),
    new Request('https://bay.example/api/muse/access', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: '{"accessCode":"anything"}',
    }),
    new Request('https://bay.example/api/muse/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' }, // missing Origin on POST
      body: '{}',
    }),
  ]) {
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'MUSE_ORIGIN_REJECTED');
  }

  // 3. Anonymous /api/muse/result only returns public recorded diagnosis on exact match, never private cache
  const missRes = await worker.fetch(
    new Request('https://bay.example/api/muse/result?zoneId=GANTRY-STA-A&snapshotId=forged-private-id'),
    env,
  );
  assert.equal(missRes.status, 200);
  assert.deepEqual(await missRes.json(), { result: null });

  // 4. Non-GET/HEAD mutations outside /api/muse/* fail closed with 403
  for (const [method, path] of [
    ['POST', '/api/session/mutate'],
    ['PUT', '/release.json'],
    ['DELETE', '/api/health'],
  ]) {
    const res = await worker.fetch(new Request(`https://bay.example${path}`, { method }), env);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'PUBLIC_PREVIEW_NO_SERVER_MUTATIONS');
    assert.equal(body.newPaidScansEnabled, false);
  }

  // 5. Public static HTML carries CSP, frame-ancestors/X-Frame-Options, nosniff, and release header
  const htmlRes = await worker.fetch(new Request('https://bay.example/?operator=1'), env);
  assert.equal(htmlRes.status, 200);
  assert.equal(htmlRes.headers.get('x-frame-options'), 'DENY');
  assert.equal(htmlRes.headers.get('x-content-type-options'), 'nosniff');
  assert.match(htmlRes.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.equal(Boolean(htmlRes.headers.get('x-breakshift-release')), true);
});
