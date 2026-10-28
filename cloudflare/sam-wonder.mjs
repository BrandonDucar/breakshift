import {createHash} from 'node:crypto';
import {compilePhotoScan,validatePhotoAssessment,PHOTO_BOX_INSTRUCTIONS} from './photo-contract.mjs';
import {inspectMp4} from './bounded-mp4.mjs';
import {formats,decodeMaskToRaster} from './vendor/meta-sam-parser/dist/index.js';
import {validateTwinProposals} from '../public/photo-repair-bridge.mjs';
export const WONDER_MODEL='muse-wonder-1.0',SAM_MODEL='sam-3.1';
export const PERCEPTION_CONTRACT='breakshift.sam-wonder.v1',MAX_PERCEPTION_BODY=2800000;
const hash=value=>createHash('sha256').update(value).digest('hex');
const reject=code=>{throw Error(code);};
export function compilePerception(input,sourceDigest){
  const names=['imageDataUrl','sourceKind','note','requestId','consent','target','videoDataUrl'];
  if(!input||Object.keys(input).length!==names.length||names.some(k=>!Object.hasOwn(input,k)))reject('MUSE_PERCEPTION_INPUT_REJECTED');
  const {target,videoDataUrl,...photo}=input;
  if(typeof target!=='string'||!target.trim()||target.length>80||!/^[-\p{L}\p{N} ,()]+$/u.test(target))reject('MUSE_SEGMENT_TARGET_REJECTED');
  const base=compilePhotoScan(photo,sourceDigest);let clip=null,videoDigest=null;
  if(videoDataUrl!==null){
    if(typeof videoDataUrl!=='string'||!/^data:video\/mp4;base64,[A-Za-z0-9+/]+={0,2}$/.test(videoDataUrl))reject('MUSE_CLIP_FORMAT_REJECTED');
    const encoded=videoDataUrl.slice(22),bytes=Buffer.from(encoded,'base64');
    if(bytes.toString('base64')!==encoded)reject('MUSE_CLIP_FORMAT_REJECTED');clip=inspectMp4(bytes);videoDigest=hash(bytes);
    if(clip.width!==base.dimensions.width||clip.height!==base.dimensions.height)reject('MUSE_CLIP_POSTER_DIMENSIONS_MISMATCH');
  }
  const system=base.request.messages[0].content.replace('checks:string[]}]}','checks:string[]}],repairPlan:[{step:string,reason:string,verification:string}],stopConditions:string[],twinProposals:[{regionIndex:integer,fixIndex:integer,strategyId:string,rationale:string,assumptions:string[]}]}')+
    ' You are Muse Wonder planning a careful diagnosis, not an actuator. Add 1-3 short repairPlan steps with reason and verification; include 1-2 stopConditions. Also add twinProposals:[] or up to 4 objects {regionIndex:integer,fixIndex:integer,strategyId:string,rationale:string,assumptions:string[]}. Indices are zero-based and must refer to that exact region and possibleFixes entry. Only use surge_interleave, timing_compensation, station_handoff or coordinated_repair for an explicitly proposed controller/scheduling workaround. These test a reference workcell, not inferred physical equipment: state 1-3 short unverified assumptions. Use [] for no established defect, inspection/evidence gathering or physical component service; never translate those into a controller action. Do not invent a defect to justify repair; an intact/illustrative component may need only evidence gathering. Never instruct bypassing interlocks, live electrical work or automatic repair execution. Keep the entire reply concise and under 1200 tokens.';
  const request={...base.request,model:WONDER_MODEL,max_tokens:1200,messages:[{role:'system',content:system},{role:'user',content:[{type:'text',text:JSON.stringify({sourceKind:input.sourceKind,target,operatorNote:input.note,clipScope:clip?'Diagnosis uses the first captured frame; SAM separately tracks the short clip.':'Still image only.'})},base.request.messages[1].content[1]]}]};
  const samRequest={model:SAM_MODEL,stream:false,store:false,input:[{type:'message',role:'user',content:[{type:'input_text',text:target.trim()},clip?{type:'input_video',video_url:videoDataUrl}:{type:'input_image',image_url:input.imageDataUrl}]}],metadata:{mask_encoding:'one_bit',propagation_direction:'forward'}};
  const samReserveUsd=clip?Math.max(50,clip.frames)*.0002:.0025;
  return {...base,request,samRequest,clip,videoDigest,target:target.trim(),sourceDigest,samReserveUsd,key:hash(JSON.stringify({contract:PERCEPTION_CONTRACT,sourceDigest,imageDigest:base.imageDigest,videoDigest,sourceKind:input.sourceKind,target:target.trim(),note:input.note}))};
}
export function validateWonder(value){
  if(!value||Object.keys(value).filter(k=>k!=='twinProposals').sort().join(',')!==['summary','limitations','regions','repairPlan','stopConditions'].sort().join(','))reject('MUSE_WONDER_SCHEMA');
  const {repairPlan,stopConditions,twinProposals=[],...assessment}=value;const result=validatePhotoAssessment(assessment);
  const text=(s,max)=>{if(typeof s!=='string'||!s.trim()||s.length>max)reject('MUSE_WONDER_SCHEMA');return s.trim();};
  if(!Array.isArray(repairPlan)||repairPlan.length<1||repairPlan.length>3||!Array.isArray(stopConditions)||stopConditions.length<1||stopConditions.length>3)reject('MUSE_WONDER_SCHEMA');
  return {...result,twinProposals:validateTwinProposals(twinProposals,result.regions),repairPlan:repairPlan.map(s=>{if(!s||Object.keys(s).sort().join(',')!=='reason,step,verification')reject('MUSE_WONDER_SCHEMA');return {step:text(s.step,240),reason:text(s.reason,240),verification:text(s.verification,240)};}),stopConditions:stopConditions.map(s=>text(s,240)),planExecution:'NOT_EXECUTED_PHYSICAL_VERIFICATION_REQUIRED'};
}
// Wonder selects a validated SAM region by ID. It never supplies executable
// image coordinates; the original strict bbox validator remains unchanged.
export function wonderRegionCatalog(segmentation){
  const {width,height}=segmentation.dimensions;
  const objects=segmentation.frames.find(f=>f.frameIndex===0)?.objects||[];
  if(!objects.length)return [{regionRef:'frame',bbox:[0,0,1000,1000],scope:'WHOLE_FIRST_FRAME_NO_SAM_MATCH'}];
  return objects.slice(0,8).map((o,i)=>{
    const {left,top,right,bottom}=o.bounds;
    if(![left,top,right,bottom].every(Number.isFinite)||left<0||top<0||right<=left||bottom<=top||right>width||bottom>height)reject('MUSE_SAM_GEOMETRY_REJECTED');
    const x=Math.floor(left/width*1000),y=Math.floor(top/height*1000),r=Math.ceil(right/width*1000),b=Math.ceil(bottom/height*1000);
    return {regionRef:`sam-${i}`,objectId:o.id,bbox:[x,y,r-x,b-y],scope:'SAM_FIRST_FRAME_COMPONENT_REGION'};
  });
}
export function validateLocalizedWonder(value,catalog){
  if(!value||!Array.isArray(value.regions))reject('MUSE_WONDER_SCHEMA');
  const used=new Set(),localization=[];
  const regions=value.regions.map(region=>{
    if(!region||Object.hasOwn(region,'bbox')||typeof region.regionRef!=='string'||used.has(region.regionRef))reject('MUSE_WONDER_REGION_REFERENCE_REJECTED');
    const match=catalog.find(c=>c.regionRef===region.regionRef);if(!match)reject('MUSE_WONDER_REGION_REFERENCE_REJECTED');used.add(region.regionRef);
    const {regionRef,...rest}=region;localization.push({...match,regionIndex:localization.length});return {...rest,bbox:[...match.bbox]};
  });
  const result=validateWonder({...value,regions});
  if(catalog[0]?.scope==='WHOLE_FIRST_FRAME_NO_SAM_MATCH'&&result.twinProposals.length)reject('MUSE_WONDER_REGION_REFERENCE_REJECTED');
  return {...result,localization:{source:'VALIDATED_SAM_REGION_REFERENCES',regions:localization}};
}
export function localizedWonderRequest(compiled,catalog){
  const messages=structuredClone(compiled.request.messages);
  messages[0].content=messages[0].content.replace(PHOTO_BOX_INSTRUCTIONS,'').replace('bbox:[x,y,width,height]','regionRef:string').replace('Bounding boxes use 0-1000 normalized coordinates within the image.','')+
    ' LOCALIZATION CONTRACT: regions must use regionRef from the provided allowedRegions, never bbox/coordinates. Return each regionRef at most once; do not invent an ID. Assess only those selected regions. The frame reference means no SAM component match: state that limitation, make no localized fault claim and return twinProposals:[] for it.';
  messages[1].content[0].text=JSON.stringify({...JSON.parse(messages[1].content[0].text),allowedRegions:catalog.map(({regionRef,bbox,scope})=>({regionRef,bbox,scope}))});
  return {...compiled.request,messages};
}
async function providerJson(url,body,key,transport,max=1500000){
  const r=await transport(url,{method:'POST',headers:{Authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(60000)});
  if(!r.ok)reject(`MUSE_PROVIDER_HTTP_${r.status}`);
  const reader=r.body.getReader(),chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();reject('MUSE_RESPONSE_TOO_LARGE');}chunks.push(value);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function perceptionPreflight(compiled,key,transport=fetch){
  // Bound the eventual SAM catalog before either inference. Eight short refs
  // and numeric boxes plus 128 tokens of slack cover actual catalog variation.
  const boundedCatalog=Array.from({length:8},(_,i)=>({regionRef:`sam-${i}`,bbox:[999,999,1000,1000],scope:'SAM_FIRST_FRAME_COMPONENT_REGION'}));
  const [system,user]=localizedWonderRequest(compiled,boundedCatalog).messages;
  const input=[{role:'system',content:[{type:'input_text',text:system.content}]},{role:'user',content:user.content.map(p=>p.type==='text'?{type:'input_text',text:p.text}:{type:'input_image',image_url:p.image_url.url})}];
  const value=await providerJson('https://api.meta.ai/v1/responses/input_tokens',{model:WONDER_MODEL,input},key,transport,4096);
  const tokens=value.input_tokens,ceilingUsd=((tokens+128)*4+compiled.request.max_tokens*20)/1e6+compiled.samReserveUsd;
  if(!Number.isSafeInteger(tokens)||tokens<0||ceilingUsd>.05)reject('MUSE_PERCEPTION_EXCEEDS_RESERVATION');
  return {inputTokens:tokens,ceilingUsd};
}
export function decodeSegmentation(text,compiled){
  if(typeof text!=='string'||text.length>1000000)reject('MUSE_SAM_RESPONSE_REJECTED');
  for(const match of text.matchAll(/<\|box;([^|]*)\|>/g)){
    const fields=Object.fromEntries(match[1].split(';').map(f=>f.split('=')));
    if(Number(fields.w)!==compiled.dimensions.width||Number(fields.h)!==compiled.dimensions.height)reject('MUSE_SAM_GEOMETRY_REJECTED');
  }
  const parser=(compiled.clip?formats.segmentation.video():formats.segmentation.image()).createParser();parser.push(text);const parsed=parser.finish({status:'completed'}).result;
  if(parsed.diagnostics.some(x=>x.severity==='error')||parsed.records.some(x=>x.kind==='text'))reject('MUSE_SAM_RESPONSE_REJECTED');
  const frames=new Map();let pixels=0,bytes=0;
  for(const record of parsed.records.filter(x=>x.kind==='mask')){
    const frame=record.frame?.frameIndex??0,{mask,bounds}=record;
    if(!Number.isInteger(frame)||frame<0||frame>=(compiled.clip?.frames||1)||mask.width*mask.height>768*768||mask.width<1||mask.height<1||bounds.left<0||bounds.top<0||bounds.right>compiled.dimensions.width||bounds.bottom>compiled.dimensions.height)reject('MUSE_SAM_GEOMETRY_REJECTED');
    pixels+=mask.width*mask.height;if(pixels>8000000)reject('MUSE_SAM_GEOMETRY_TOO_LARGE');
    const raster=decodeMaskToRaster(mask),scale=Math.min(1,128/Math.max(mask.width,mask.height));
    const width=Math.max(1,Math.round(mask.width*scale)),height=Math.max(1,Math.round(mask.height*scale)),bits=Buffer.alloc(Math.ceil(width*height/8));
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(raster[Math.min(mask.height-1,Math.floor(y/scale))*mask.width+Math.min(mask.width-1,Math.floor(x/scale))]){const i=y*width+x;bits[i>>3]|=128>>(i&7);}
    const object={id:record.objectId,bounds,mask:{width,height,bitsBase64:bits.toString('base64')},...(record.confidence===undefined?{}:{confidence:record.confidence})};
    const list=frames.get(frame)||[];if(list.length>=8||list.some(x=>x.id===object.id))reject('MUSE_SAM_GEOMETRY_REJECTED');list.push(object);frames.set(frame,list);bytes+=JSON.stringify(object).length;if(bytes>85000)reject('MUSE_SAM_GEOMETRY_TOO_LARGE');
  }
  return {model:SAM_MODEL,kind:compiled.clip?'VIDEO_TRACKING':'IMAGE_SEGMENTATION',dimensions:compiled.dimensions,frameTimesMs:compiled.clip?.frameTimesMs||[0],frames:[...frames].sort((a,b)=>a[0]-b[0]).map(([frameIndex,objects])=>({frameIndex,objects})),matchedObjects:[...new Set([...frames.values()].flat().map(x=>x.id))].length,maskResolution:'SAM_BINARY_MASK_DOWNSAMPLED_TO_MAX_128PX',trackingScope:compiled.clip?'CAPTURED_CLIP_ONLY_NOT_CONTINUOUS_LIVE_VIDEO':'STILL_IMAGE_NO_TRACKING'};
}
export async function runPerception(compiled,key,transport=fetch,onStage=async()=>{}){
  await onStage({phase:'SAM_PENDING'});
  const sam=await providerJson('https://api.meta.ai/v1/responses',compiled.samRequest,key,transport);
  if(sam.model!==SAM_MODEL||sam.status!=='completed'||!Array.isArray(sam.output)||typeof sam.id!=='string'||sam.id.length>160)reject('MUSE_SAM_RESPONSE_REJECTED');
  const content=sam.output.flatMap(o=>o.type==='message'&&Array.isArray(o.content)?o.content:[]);
  if(content.some(x=>x.type!=='output_text')||sam.output.some(x=>x.type!=='message'&&x.type!=='reasoning'))reject('MUSE_SAM_RESPONSE_REJECTED');
  const text=content.map(x=>x.text).join(''),segmentation=decodeSegmentation(text,compiled);
  const billedFrames=sam.usage?.video_frames_processed;
  if(compiled.clip&&(!Number.isSafeInteger(billedFrames)||billedFrames<50||billedFrames>50))reject('MUSE_SAM_USAGE_UNRECONCILED');
  const samCost=compiled.clip?billedFrames*.0002:.0025;
  await onStage({phase:'SAM_COMPLETED_WONDER_PENDING',samResponseId:sam.id,estimatedSamCostUsd:samCost,...(compiled.clip?{billedFrames}:{})});
  const catalog=wonderRegionCatalog(segmentation);
  const response=await providerJson('https://api.meta.ai/v1/chat/completions',localizedWonderRequest(compiled,catalog),key,transport,65536);
  const choice=response.choices?.[0],usage=response.usage;
  if(response.model!==WONDER_MODEL||response.choices?.length!==1||choice.finish_reason!=='stop'||choice.message?.tool_calls?.length||choice.message?.function_call||typeof response.id!=='string'||response.id.length>160)reject('MUSE_WONDER_RESPONSE_REJECTED');
  if(!Number.isSafeInteger(usage?.prompt_tokens)||usage.prompt_tokens<0||!Number.isSafeInteger(usage?.completion_tokens)||usage.completion_tokens<0||usage.completion_tokens>compiled.request.max_tokens)reject('MUSE_USAGE_UNRECONCILED');
  const wonderCost=(usage.prompt_tokens*4+usage.completion_tokens*20)/1e6;
  if(wonderCost+samCost>.05)reject('MUSE_USAGE_EXCEEDS_RESERVE');
  if(response.id.includes(key))reject('MUSE_RESPONSE_REJECTED');
  await onStage({phase:'WONDER_RESPONSE_USAGE_VERIFIED',model:WONDER_MODEL,wonderResponseId:response.id,usage:{promptTokens:usage.prompt_tokens,completionTokens:usage.completion_tokens,estimatedWonderCostUsd:wonderCost,estimatedSamCostUsd:samCost,estimatedCostUsd:wonderCost+samCost}});
  const diagnosis=validateLocalizedWonder(JSON.parse(choice.message.content),catalog);
  return {...diagnosis,model:WONDER_MODEL,responseId:response.id,segmentation:{...segmentation,responseId:sam.id},usage:{promptTokens:usage.prompt_tokens,completionTokens:usage.completion_tokens,estimatedWonderCostUsd:wonderCost,estimatedSamCostUsd:samCost,estimatedCostUsd:wonderCost+samCost,...(compiled.clip?{billedFrames}:{})}};
}
