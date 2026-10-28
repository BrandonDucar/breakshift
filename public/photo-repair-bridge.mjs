import {sha256Hex} from '../session/inspection-session-core.mjs';
import {executeRepairRun} from '../simulator/repair-run.mjs';
export const PHOTO_RECIPES=Object.freeze({surge_interleave:'Stagger surges / throttle belt',timing_compensation:'Compensate sensor timing',station_handoff:'Route to backup station',coordinated_repair:'Coordinate power, timing and handoff'});
export function validateTwinProposals(proposals,regions){
  if(!Array.isArray(proposals)||proposals.length>4)throw Error('PHOTO_TWIN_PROPOSALS_INVALID');
  const seen=new Set();
  return proposals.map(p=>{
    if(!p||Object.keys(p).sort().join(',')!=='assumptions,fixIndex,rationale,regionIndex,strategyId'||!Number.isInteger(p.regionIndex)||!Number.isInteger(p.fixIndex)||!regions[p.regionIndex]?.possibleFixes[p.fixIndex]||!Object.hasOwn(PHOTO_RECIPES,p.strategyId)||seen.has(`${p.regionIndex}:${p.fixIndex}`))throw Error('PHOTO_TWIN_PROPOSALS_INVALID');
    const text=x=>typeof x==='string'&&x.trim()&&x.length<=240;
    if(!text(p.rationale)||!Array.isArray(p.assumptions)||!p.assumptions.length||p.assumptions.length>3||!p.assumptions.every(text))throw Error('PHOTO_TWIN_PROPOSALS_INVALID');
    seen.add(`${p.regionIndex}:${p.fixIndex}`);return {...p,assumptions:[...p.assumptions]};
  });
}
export function photoRepairBinding({image,result,regionIndex,fixIndex,strategyId,origin,revision}){
  const region=result?.regions?.[regionIndex],fix=region?.possibleFixes?.[fixIndex];
  if(!image||result?.kind!=='PHOTO_VISUAL_ASSESSMENT'||result.imageDigest!==image.imageDigest||!/^[a-f0-9]{64}$/.test(image.imageDigest)||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image.imageDataUrl)||image.imageDataUrl.length>700000||!Number.isInteger(regionIndex)||!Number.isInteger(fixIndex)||!fix||!Object.hasOwn(PHOTO_RECIPES,strategyId)||!Number.isSafeInteger(revision)||revision<0)throw Error('PHOTO_TWIN_CONTEXT_INVALID');
  if(origin==='WONDER_PROPOSAL'){
    const proposal=validateTwinProposals(result.twinProposals||[],result.regions).find(p=>p.regionIndex===regionIndex&&p.fixIndex===fixIndex);
    if(proposal?.strategyId!==strategyId)throw Error('PHOTO_TWIN_MAPPING_MISMATCH');
  }else if(origin!=='OPERATOR_HYPOTHESIS')throw Error('PHOTO_TWIN_MAPPING_REQUIRED');
  const [x,y,w,h]=region.bbox||[];
  if(!['USER_SUPPLIED_IMAGE','CAMERA_FRAME','DEMO_ILLUSTRATION'].includes(image.sourceKind)||![image.width,image.height].every(n=>Number.isInteger(n)&&n>=32&&n<=768)||typeof result.model!=='string'||result.model.length>160||typeof fix!=='string'||fix.length>240)throw Error('PHOTO_TWIN_CONTEXT_INVALID');
  if(![x,y,w,h].every(Number.isFinite)||x<0||y<0||w<1||h<1||x+w>1000||y+h>1000)throw Error('PHOTO_TWIN_REGION_INVALID');
  const body={schema:'breakshift.photo-repair-binding.v1',imageDigest:image.imageDigest,mediaEncodingDigest:sha256Hex(image.imageDataUrl),assessmentDigest:sha256Hex(result),sourceKind:image.sourceKind,model:result.model,mode:result.mode||'LIVE_IMAGE_ASSESSMENT',revision,regionIndex,regionLabel:region.label,bbox:[...region.bbox],fixIndex,proposedFix:fix,strategyId,origin,physicalClearance:false,scope:'REFERENCE_WORKCELL_HYPOTHESIS_NOT_PHOTO_REPAIR_PROOF'};
  return {...body,bindingDigest:sha256Hex(body)};
}
export function executePhotoRepairTest(input){
  const binding=photoRepairBinding(input);
  const run=executeRepairRun({strategyId:binding.strategyId,breakerKw:input.breakerKw,snapshotId:input.snapshotId,scanId:`photo-${binding.bindingDigest}`});
  return {...run,photoBinding:binding};
}
export function photoTestReceipt(run){
  if(!run.photoBinding)throw Error('PHOTO_TWIN_RECEIPT_REQUIRED');
  return {schema:'breakshift.photo-repair-test.v1',photo:run.photoBinding,compiledPlan:run.compiledPlan,referenceModel:{label:run.energyModelLabel,snapshotId:run.snapshotId,breakerKw:run.breakerKw,passed:run.passed,judgePacked:run.repair.packed,challengerPacked:run.challenger.packed,peakKw:run.repair.peakKw},physicalOutcome:'NOT_VERIFIED',pixelsIncluded:false};
}
