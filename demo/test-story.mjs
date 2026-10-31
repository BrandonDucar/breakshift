import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileEnvelopePlan, evaluateEnvelope, DEFAULT_CONTEXT, BASELINE } from '../uncertainty-lab/repair-envelope.mjs';
import { createEnergyComparison } from '../energy-lab/energy-comparison.mjs';
import { assertSubmissionSnapshot, assertNoPublicVideoLink } from './submission-contract.mjs';

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

test('dated submission snapshot binds the approved video without promoting open gates',async()=>{
  const packet=JSON.parse(await readFile(new URL('./submission-readiness-20261031.json',import.meta.url)));
  const binding=JSON.parse(await readFile(new URL('./retained-evidence-binding.json',import.meta.url)));
  assertSubmissionSnapshot(packet,binding,story);
});

test('current submission documents preserve the private unlisted-link boundary',async()=>{
  const paths=['../README.md','../SUBMISSION_DRAFT.md','./README.md','./ACCEPTANCE_20261030.md','./submission-readiness-20261031.json'];
  for(const path of paths){
    const text=await readFile(new URL(path,import.meta.url),'utf8');
    assert.match(text,/private/i,path);
    assertNoPublicVideoLink(text);
  }
  const draft=await readFile(new URL('../SUBMISSION_DRAFT.md',import.meta.url),'utf8');
  assert.doesNotMatch(draft,/not uploaded or verified yet|owner review and hosted video link pending/);
  assert.match(draft,/Remaining Owner Gates/);
});

test('dated snapshot rejects omitted gates and unsupported approval or visibility changes',async()=>{
  const packet=JSON.parse(await readFile(new URL('./submission-readiness-20261031.json',import.meta.url)));
  const binding=JSON.parse(await readFile(new URL('./retained-evidence-binding.json',import.meta.url)));
  const mutations=[
    p=>{p.authority={};},
    p=>{delete p.authority.physicalRepairClearance;},
    p=>{p.authority.submissionApprovedByThisSnapshot=true;},
    p=>{p.remainingGates=p.remainingGates.slice(0,1);},
    p=>{p.demo.visibility='PUBLIC';},
    p=>{p.demo.linkDisclosure='PUBLIC';},
    p=>{p.organizerOverview.submissionFormVerified=true;},
    p=>{delete p.organizerOverview.fullAcceptedRulesVerified;},
    p=>{p.demo.sha256='0'.repeat(64);},
  ];
  for(const mutate of mutations){
    const changed=structuredClone(packet);mutate(changed);
    assert.throws(()=>assertSubmissionSnapshot(changed,binding,story));
  }
});

test('public-video check rejects alternate hosts and embed, shorts, live and short-link routes',()=>{
  for(const link of ['https://youtu.be/example','https://www.youtube.com/watch?v=example',
    'https://youtube.com/embed/example','https://m.youtube.com/shorts/example',
    'https://www.youtube-nocookie.com/embed/example','//www.youtube.com/live/example'])
    assert.throws(()=>assertNoPublicVideoLink(link));
  assertNoPublicVideoLink('Unlisted link remains in the private owner handoff.');
});

test('public-video check rejects percent-encoded hosts and nested encoding',()=>{
  for(const link of ['https://youtu%2ebe/example','https://www.you%74ube.com/watch?v=example',
    'https%3A%2F%2Fyoutu.be%2Fexample','https://youtu%252ebe/example',
    'https://youtube%2Dnocookie%2Ecom/embed/example'])assert.throws(()=>assertNoPublicVideoLink(link));
});

test('malformed escapes do not prevent inspection of a later encoded video host',()=>{
  assert.throws(()=>assertNoPublicVideoLink('Malformed %ZZ then https://youtu%2ebe/example'));
  assert.throws(()=>assertNoPublicVideoLink('%E0%A4%A https://you%74ube.com/embed/example'));
  assertNoPublicVideoLink('The draft is 100% complete; this %ZZ is not a video link.');
});

test('excessively nested percent encoding fails closed',()=>{
  let encoded='https://youtu.be/example';
  for(let i=0;i<12;i++)encoded=encodeURIComponent(encoded);
  assert.throws(()=>assertNoPublicVideoLink(encoded),/PUBLIC_LINK_ENCODING_DEPTH_LIMIT/);
});
