import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonicalJson} from '../session/inspection-session-core.mjs';
import {DEFAULT_CONTEXT} from '../uncertainty-lab/repair-envelope.mjs';
import {createUncertaintySession} from '../public/uncertainty-session.mjs';
import recordedPatch from '../public/verified-uncertainty-patch.json' with {type:'json'};
import {replayEnergyComparison} from '../energy-lab/energy-comparison.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
export function pinDemoInput(pins,path,bytes) {
  const digest=hash(bytes);
  if(pins.has(path))assert.equal(digest,pins.get(path),'DEMO_INPUT_CHANGED_DURING_VERIFICATION');
  else pins.set(path,digest);
  return bytes;
}
export function verifyDemoEvidence({capture,story,tapText,experimentText,energyText,bindings}) {
  assert.equal(capture?.schema,'breakshift.demo-capture.v1','DEMO_CAPTURE_SCHEMA');
  assert.ok(capture?.passed === true && capture.recording === true, 'DEMO_CAPTURE_FAILED');
  assert.equal(capture.mode,story.mode,'DEMO_CAPTURE_MODE');
  assert.equal(capture.providerCalls,0,'DEMO_CAPTURE_PROVIDER_CALLS');
  assert.equal(capture.incrementalSpendUsd,0,'DEMO_CAPTURE_SPEND');
  assert.equal(capture.productionChanged,false,'DEMO_CAPTURE_PRODUCTION');
  assert.equal(capture.teachingRuntimeContacted,false,'DEMO_CAPTURE_TEACHING');
  for(const field of ['physicalClearance','executionAuthority','authorityGranted','paidAllowanceModified']) {
    if(field in capture)assert.equal(capture[field],false,'DEMO_CAPTURE_AUTHORITY');
  }
  assert.deepEqual(capture.errors,[],'DEMO_CAPTURE_ERRORS');
  assert.deepEqual(capture.blockedRequests,[],'DEMO_CAPTURE_REQUESTS');
  assert.ok(Array.isArray(capture.checks) && capture.checks.every(c=>c.passed===true),'DEMO_CHECKPOINT_FAILED');
  assert.deepEqual(capture.checks.map(c=>c.id),story.shots.map(s=>s.id),'DEMO_CHECKPOINT_BINDING');
  for(let i=0;i<story.shots.length;i++) {
    const c=capture.checks[i],s=story.shots[i];
    assert.ok(Number.isFinite(c.startSeconds)&&Number.isFinite(c.actionsCompleteSeconds)&&
      c.startSeconds>=s.start-.05&&c.startSeconds<s.end&&
      c.actionsCompleteSeconds>=c.startSeconds&&c.actionsCompleteSeconds<s.end,'DEMO_CHECKPOINT_TIMING');
  }
  assert.ok(typeof tapText==='string' && Buffer.byteLength(tapText)<=4000000,'DEMO_TAP_SIZE');
  assert.equal(hash(tapText),capture.testOutputSha256,'DEMO_TEST_OUTPUT_BINDING');
  assert.match(tapText,/^TAP version 13\r?\n/,'DEMO_TAP_FORMAT');
  // Only the flat Node test output emitted by this demo is supported.
  const count = name => {
    const rows=[...tapText.matchAll(new RegExp('^# '+name+' (\\d+)\\r?$','gm'))];
    assert.equal(rows.length,1,'DEMO_TAP_SUMMARY_'+name);
    const value=Number(rows[0][1]);assert.ok(Number.isSafeInteger(value));return value;
  };
  const tests=count('tests'),passed=count('pass');
  assert.ok(tests>0 && passed===tests,'DEMO_TAP_NOT_ALL_PASSED');
  for(const name of ['fail','cancelled','skipped','todo'])assert.equal(count(name),0,'DEMO_TAP_'+name);
  assert.equal(count('suites'),0,'DEMO_TAP_NESTED_UNSUPPORTED');
  assert.doesNotMatch(tapText,/^\s*(?:not ok\b|Bail out!)/im,'DEMO_TAP_FAILURE');
  assert.doesNotMatch(tapText,/^\s+ok\b/m,'DEMO_TAP_NESTED_UNSUPPORTED');
  const plans=[...tapText.matchAll(/^1\.\.(\d+)\r?$/gm)];
  assert.equal(plans.length,1,'DEMO_TAP_PLAN');
  assert.equal(Number(plans[0][1]),tests,'DEMO_TAP_PLAN_COUNT');
  const rows=[...tapText.matchAll(/^ok (\d+)(?: - [^\r\n]*)?\r?$/gm)];
  assert.equal(rows.length,tests,'DEMO_TAP_RESULT_COUNT');
  rows.forEach((row,i)=>{assert.equal(Number(row[1]),i+1,'DEMO_TAP_RESULT_ORDER');assert.doesNotMatch(row[0],/#\s*(?:SKIP|TODO)\b/i,'DEMO_TAP_DIRECTIVE');});
  assert.deepEqual(tapText.split('\n').filter(s=>/^# (tests|pass|fail|duration_ms) /.test(s)),capture.testSummary,'DEMO_TEST_SUMMARY_BINDING');
  assert.ok(typeof experimentText==='string' && Buffer.byteLength(experimentText)<=49152,'DEMO_EXPERIMENT_SIZE');
  const saved=JSON.parse(experimentText),context=saved?.experiment?.plan?.assumptions;
  assert.ok(context && typeof context.snapshotId==='string','DEMO_EXPERIMENT_CONTEXT');
  assert.equal(context.breakerKw,DEFAULT_CONTEXT.breakerKw,'DEMO_EXPERIMENT_BREAKER');
  assert.equal(canonicalJson(context.envelope),canonicalJson(DEFAULT_CONTEXT.envelope),'DEMO_EXPERIMENT_ENVELOPE');
  assert.equal(saved.source?.selection,'muse','DEMO_EXPERIMENT_SELECTION');
  // The captured workcell uses its own snapshot ID; numerical bounds are fixed above.
  const session=createUncertaintySession({getContext:()=>({snapshotId:context.snapshotId,breakerKw:context.breakerKw}),recordedPatch});
  const replay=session.reviewReceipt(experimentText);
  assert.equal(replay.verdict,'SUPPORTED_WITHIN_DECLARED_ENVELOPE','DEMO_EXPERIMENT_VERDICT');
  const energy=replayEnergyComparison(energyText,DEFAULT_CONTEXT);
  assert.equal(canonicalJson(energy.receipt.input),canonicalJson({loadMultiplier:1,sensorDelayMs:0,jitterAMs:0,jitterBMs:0}),'DEMO_ENERGY_NOMINAL_INPUT');
  assert.equal(canonicalJson(energy.receipt.proposed.plan.candidate),canonicalJson(recordedPatch.candidate),'DEMO_ENERGY_CANDIDATE');
  // Trusted local review pins bind this recording, not a provider or physical event.
  assert.ok(bindings,'DEMO_EVIDENCE_BINDINGS_REQUIRED');
  for(const [key,value] of Object.entries({capture:canonicalJson(capture),tap:tapText,experiment:experimentText,energy:energyText})) {
    assert.equal(hash(value),bindings[key+'Sha256'],'DEMO_EVIDENCE_BINDING_'+key);
  }
  return {schema:'breakshift.demo-evidence-consistency.v1',captureTestOutputBound:true,tests,passed,
    checkpoints:capture.checks.length,uncertaintyReplay:replay.verdict,energyReplay:'RECOMPUTED_MATCH',
    sourceAuthenticated:false,physicalClearance:false,executionAuthority:false};
}
