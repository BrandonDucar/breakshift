import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {photoRepairBinding,executePhotoRepairTest,photoTestReceipt,validateTwinProposals} from './public/photo-repair-bridge.mjs';
import {validateWonder} from './cloudflare/sam-wonder.mjs';
import {lowerRepairPlan} from './controller/repair-compiler.mjs';
import {sha256Hex} from './session/inspection-session-core.mjs';
const region={label:'Fixture actuator',bbox:[100,200,200,300],certainty:'possible',observations:['TEST ADAPTER pixels'],possibleCauses:['Fixture scheduling hypothesis'],possibleFixes:['Test coordinated scheduling','Qualified gripper inspection'],checks:['Physical evidence required']};
const proposal={regionIndex:0,fixIndex:0,strategyId:'coordinated_repair',rationale:'Test scheduling resilience.',assumptions:['Reference workcell behavior, not measured photo physics.']};
const data=()=>({image:{imageDigest:'a'.repeat(64),imageDataUrl:'data:image/jpeg;base64,/9j/2Q==',sourceKind:'USER_SUPPLIED_IMAGE',width:640,height:320},result:{kind:'PHOTO_VISUAL_ASSESSMENT',imageDigest:'a'.repeat(64),model:'TEST ADAPTER / muse-wonder-1.0',mode:'TEST_ADAPTER',regions:[structuredClone(region)],twinProposals:[structuredClone(proposal)]},regionIndex:0,fixIndex:0,strategyId:'coordinated_repair',origin:'WONDER_PROPOSAL',revision:1,snapshotId:'fixture-snapshot',breakerKw:1.65});
test('selected photo, assessment, region, fix and mapping are bound to actual compiled model checks',()=>{
  const input=data(),run=executePhotoRepairTest(input);assert.equal(run.passed,true);assert.equal(run.repair.packed,8);assert.equal(run.repair.peakKw,1.554);
  assert.equal(run.compiledPlan.bindings.scanId,`photo-${run.photoBinding.bindingDigest}`);
  for(const change of [x=>x.revision++,x=>x.image.imageDataUrl=x.image.imageDataUrl.replace('2Q','3Q'),x=>x.result.regions[0].possibleFixes[0]='Another proposal',x=>x.result.regions[0].bbox[0]++,x=>x.result.mode='RECORDED_SAM_WONDER_DEMO']){const next=data();change(next);assert.notEqual(photoRepairBinding(next).bindingDigest,run.photoBinding.bindingDigest);}
});
test('unknown/physical strategies, mismatched pixels metadata, wrong fix and invalid regions cannot enter compiler',()=>{
  for(const change of [x=>x.strategyId='inspect_gripper',x=>x.image.imageDigest='b'.repeat(64),x=>x.fixIndex=1,x=>x.result.regions[0].bbox=[900,200,200,300],x=>x.origin='AUTO_EXECUTE']){const x=data();change(x);assert.throws(()=>executePhotoRepairTest(x));}
});
test('legacy clean diagnoses do not gain a modeled repair; explicit operator hypothesis stays attributed',()=>{
  const input=data();input.result.twinProposals=[];assert.throws(()=>executePhotoRepairTest(input),/MAPPING/);
  input.origin='OPERATOR_HYPOTHESIS';input.fixIndex=1;const run=executePhotoRepairTest(input);assert.equal(run.photoBinding.origin,'OPERATOR_HYPOTHESIS');assert.equal(run.photoBinding.physicalClearance,false);
});
test('tight breaker cap rejects a photo hypothesis and plan tampering cannot replace its source context',()=>{
  const input=data();input.breakerKw=1.45;const run=executePhotoRepairTest(input);assert.equal(run.passed,false);
  const current=run.compiledPlan.bindings,plan=structuredClone(run.compiledPlan);plan.operations[0].profile='working';const {planDigest,...body}=plan;plan.planDigest=sha256Hex(body);
  assert.throws(()=>lowerRepairPlan(plan,current),/MISMATCH/);assert.throws(()=>lowerRepairPlan(run.compiledPlan,{...current,scanId:'different-photo'}),/MISMATCH/);
});
test('exports retain reference-model outcomes and provenance without pixels, notes or false clearance',()=>{
  const receipt=photoTestReceipt(executePhotoRepairTest(data())),encoded=JSON.stringify(receipt);assert.equal(receipt.referenceModel.passed,true);assert.equal(receipt.physicalOutcome,'NOT_VERIFIED');assert.equal(receipt.pixelsIncluded,false);assert.equal(encoded.includes('data:image'),false);assert.equal(encoded.includes('operatorNote'),false);
});
test('Wonder optional structured candidates are strict and remain tied to a region/fix; old assessments still validate',()=>{
  const diagnosis={summary:'Fixture only',limitations:['Not a real inspection'],regions:[structuredClone(region)],repairPlan:[{step:'Check evidence',reason:'Fixture',verification:'Physical review'}],stopConditions:['Stop without physical evidence']};
  assert.deepEqual(validateWonder(diagnosis).twinProposals,[]);assert.equal(validateWonder({...diagnosis,twinProposals:[proposal]}).twinProposals[0].strategyId,'coordinated_repair');
  for(const p of [{...proposal,regionIndex:99},{...proposal,fixIndex:-1},{...proposal,strategyId:'eval'},{...proposal,code:'execute'},{...proposal,assumptions:[]}])assert.throws(()=>validateTwinProposals([p],diagnosis.regions));
  assert.throws(()=>validateTwinProposals([proposal,proposal],diagnosis.regions));
});
test('photo intake and local session entry preserve active state across rejected uploads, cancels and unhosted loads',async()=>{
  const photoSrc=await readFile(new URL('./public/photo-inspection.mjs',import.meta.url),'utf8');
  const selectBody=photoSrc.slice(photoSrc.indexOf('async function selectImage'),photoSrc.indexOf('function renderAssessment'));
  assert.ok(selectBody.indexOf('crypto.subtle.digest')>0&&selectBody.indexOf('clearClip()')>selectBody.indexOf('crypto.subtle.digest'),'selectImage must validate and hash before clearing active clip/photo state');
  assert.match(photoSrc,/q\('#photo-file'\)\.addEventListener\('change'[^\n]+finally\{event\.target\.value='';\}/);
  assert.match(photoSrc,/catch\(e\)\{if\(!controller\.signal\.aborted\)error\(e\.message\);\}/);
  const baySrc=await readFile(new URL('./public/component-bay.js',import.meta.url),'utf8');
  assert.match(baySrc,/acceptEnvelope\(body,\s*true\);\s*setConnection\(true\);/);
  assert.match(baySrc,/if \(!connected && !everConnected\) return;/);
});
