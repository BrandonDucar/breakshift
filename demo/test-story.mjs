import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileEnvelopePlan, evaluateEnvelope, DEFAULT_CONTEXT, BASELINE } from '../uncertainty-lab/repair-envelope.mjs';
import { createEnergyComparison } from '../energy-lab/energy-comparison.mjs';

const story=JSON.parse(await readFile(new URL('./story.json',import.meta.url)));
const source=JSON.parse(await readFile(new URL('../public/verified-uncertainty-patch.json',import.meta.url)));
test('demo timeline is contiguous and leaves ten seconds under the submission ceiling',()=>{
  assert.equal(story.shots[0].start,0);assert.equal(story.durationSeconds,170);
  assert.equal(story.shots.at(-1).end,170);
  assert.equal(new Set(story.shots.map(s=>s.id)).size,story.shots.length);
  story.shots.forEach((shot,i)=>{
    assert.ok(shot.end>shot.start);if(i)assert.equal(shot.start,story.shots[i-1].end);
    assert.ok(shot.narration.split(/\s+/).length/(shot.end-shot.start)<3.1,'Narration must fit a bounded speaking rate');
  });
});
test('recorded proposal and baseline claims match the current evaluator',()=>{
  const baseline=evaluateEnvelope(compileEnvelopePlan(BASELINE,DEFAULT_CONTEXT),DEFAULT_CONTEXT);
  const patch=evaluateEnvelope(compileEnvelopePlan(source.candidate,DEFAULT_CONTEXT),DEFAULT_CONTEXT);
  assert.equal(baseline.challenger.worstPeakW.toFixed(1),'1722.5');
  assert.equal(baseline.passedCases,4);
  assert.equal(patch.challenger.worstPeakW.toFixed(1),'1470.8');
  assert.equal(patch.passedCases,16);assert.equal(patch.challenger.jobMs,2350);
});
test('energy story preserves the lower-peak higher-energy tradeoff',()=>{
  const result=createEnergyComparison(source.candidate,DEFAULT_CONTEXT,{loadMultiplier:1,sensorDelayMs:0,jitterAMs:0,jitterBMs:0});
  assert.equal(result.difference.peakReductionW.toFixed(1),'226.5');
  assert.equal(result.difference.windowChangeMs,750);
  assert.ok(result.difference.batchEnergyChangeWh>0);
  assert.equal(result.limits.physicalEnergyMeasured,false);
});
test('demo tooling retains explicit recorded-model and physical-clearance disclosures',async()=>{
  assert.equal(story.mode,'LOCAL_OFFLINE_RECORDED_MODEL_REPLAY');
  assert.match(story.shots.find(s=>s.id==='perception').narration,/not new live calls/);
  assert.match(story.shots.find(s=>s.id==='proof').narration,/never physical machine clearance/);
  const source=await readFile(new URL('./capture.mjs',import.meta.url),'utf8');
  assert.match(source,/url.origin!==base/);assert.match(source,/GET','HEAD/);
});
