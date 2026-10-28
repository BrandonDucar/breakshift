import test from 'node:test';import assert from 'node:assert/strict';
import {MuseBudget} from './live-muse.mjs';
import {wonderRegionCatalog,validateLocalizedWonder,localizedWonderRequest,compilePerception} from './sam-wonder.mjs';
const failed=()=>({id:'555b4cc5-7e53-41b3-ba94-e74eb81b6d55',kind:'PHOTO_VISUAL_ASSESSMENT',pipeline:'SAM_WONDER',status:'FAILED_OR_UNCERTAIN',error:'MUSE_PHOTO_BOX_OUT_OF_RANGE',measuredInputTokens:1070,imageDigest:'30f8d9df548db0469c57c1deacb033b0a81daffa6b6b4a61c8c6c2b85f461c24',providerStage:{phase:'SAM_COMPLETED_WONDER_PENDING',samResponseId:'resp_6ae1294d7cec68dfa45e4adb',estimatedSamCostUsd:.0025},reservedUsd:.05});
async function boot(attempts,approval){const saved=new Map([['attempts',structuredClone(attempts)]]);const ctx={storage:{get:async k=>structuredClone(saved.get(k)),put:async(k,v)=>saved.set(k,structuredClone(v))},blockConcurrencyWhile:f=>f()};const env={LIVE_SCANS_ENABLED:'true',MUSE_SPARK_API_KEY:'fixture-key',REVIEWED_PHOTO_REJECTION:approval};const b=new MuseBudget(ctx,env);await b.ready;return {b,saved,ctx,env};}
test('exact owner-reviewed photo failure resumes unused allowance while retaining error, cost and evidence across restart',async()=>{
 const row=failed(),{b,saved,ctx,env}=await boot([row],row.id);assert.equal(b.summary().enabled,true);assert.equal(b.summary().remainingScans,3);assert.equal(b.summary().reservedUsd,.10);
 const retained=saved.get('attempts')[0];assert.equal(retained.status,'OWNER_REVIEWED_UNCERTAIN');assert.equal(retained.priorStatus,'FAILED_OR_UNCERTAIN');for(const key of ['error','imageDigest','reservedUsd','providerStage'])assert.deepEqual(retained[key],row[key]);
 const restarted=new MuseBudget(ctx,env);await restarted.ready;assert.equal(restarted.summary().enabled,true);assert.equal(restarted.summary().reservedUsd,.10);assert.equal(restarted.attempts.length,1);
});
test('missing/wrong approval or a different error/media/provider record cannot release any hold',async()=>{
 for(const approval of [undefined,'other'])assert.equal((await boot([failed()],approval)).b.summary().enabled,false);
 for(const change of [r=>r.id='other',r=>r.error='MUSE_SCAN_UNAVAILABLE',r=>r.imageDigest='a'.repeat(64),r=>r.measuredInputTokens=0,r=>r.providerStage.samResponseId='another',r=>r.reservedUsd=0]){const r=failed();change(r);const {b}=await boot([r],failed().id);assert.equal(b.summary().enabled,false);assert.equal(b.attempts[0].status,'FAILED_OR_UNCERTAIN');}
 const {b}=await boot([failed(),{id:'another-unknown',status:'RESERVED',reservedUsd:.05}],failed().id);assert.equal(b.summary().enabled,false);assert.equal(b.attempts[1].status,'RESERVED');
});
const segmentation={dimensions:{width:768,height:384},frames:[{frameIndex:0,objects:[{id:'actual-sam-id',bounds:{left:400,top:10,right:768,bottom:384}}]}]};
const diagnosis=()=>({summary:'Fixture',limitations:['Not physical proof'],regions:[{regionRef:'sam-0',label:'SAM component',certainty:'possible',observations:['Visible area'],possibleCauses:['Unknown'],possibleFixes:['Test scheduling'],checks:['Physical checks needed']}],repairPlan:[{step:'Check',reason:'Hypothesis',verification:'Reference model'}],stopConditions:['No energization'],twinProposals:[{regionIndex:0,fixIndex:0,strategyId:'coordinated_repair',rationale:'Reference only',assumptions:['Model applies']} ]});
test('model references validated SAM geometry rather than inventing boxes; near-edge boxes remain in bounds',()=>{
 const catalog=wonderRegionCatalog(segmentation),out=validateLocalizedWonder(diagnosis(),catalog);assert.deepEqual(out.regions[0].bbox,[520,26,480,974]);assert.equal(out.localization.source,'VALIDATED_SAM_REGION_REFERENCES');assert.equal(out.twinProposals[0].strategyId,'coordinated_repair');
 for(const change of [r=>r.regions[0].regionRef='unknown',r=>r.regions[0].bbox=[0,0,9999,9999],r=>r.regions.push({...r.regions[0]})]){const d=diagnosis();change(d);assert.throws(()=>validateLocalizedWonder(d,catalog),/REFERENCE_REJECTED/);}
 const bad=structuredClone(segmentation);bad.frames[0].objects[0].bounds.right=Infinity;assert.throws(()=>wonderRegionCatalog(bad),/GEOMETRY/);
});
test('no SAM match is explicitly whole-frame and cannot gain localized executable candidates',()=>{
 const catalog=wonderRegionCatalog({...segmentation,frames:[]}),d=diagnosis();d.regions[0].regionRef='frame';assert.throws(()=>validateLocalizedWonder(d,catalog));d.twinProposals=[];const out=validateLocalizedWonder(d,catalog);assert.deepEqual(out.regions[0].bbox,[0,0,1000,1000]);assert.equal(out.localization.regions[0].scope,'WHOLE_FIRST_FRAME_NO_SAM_MATCH');
});
