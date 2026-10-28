import { createInspectionSessionCore } from '../session/inspection-session-core.mjs';
import { compileComponentPacket, buildMuseRequest, validateDiagnosis, evaluateStrategy, digest, STRATEGIES, MUSE_MODEL, RESERVE_USD, SCAN_CONSENT } from '../session/muse-diagnosis-contract.mjs';
import release from '../.cf-preview/release.json' with { type: 'json' };
import {compilePhotoScan,validatePhotoAssessment,photoTokenPreflight,MAX_PHOTO_BODY} from './photo-contract.mjs';
import {compilePerception,perceptionPreflight,runPerception,MAX_PERCEPTION_BODY,WONDER_MODEL,SAM_MODEL} from './sam-wonder.mjs';
const COMPONENT_SOURCE=release.componentSourceDigest||release.id;
const LEGACY_COMPONENT_SOURCE='live-433d7ee4a9255371';
const LEGACY_INPUT_PIN='a355ba2e5302f97eb5cec3ee007f334983353629c8c63d074142a840120faf3e';

export const GRANT_ID = 'owner-five-scans-20261027';
export const PRIOR_RESERVED_CENTS = 5;
export const MAX_CLOUD_ATTEMPTS = 4;
function allowanceExtension(value){
  if(value===undefined)return null;
  try{
    const v=typeof value==='string'?JSON.parse(value):value;
    if(!v||Object.keys(v).sort().join(',')!=='additionalReserveCents,additionalScans,id'||typeof v.id!=='string'||!/^[a-z0-9-]{8,80}$/.test(v.id)||!Number.isSafeInteger(v.additionalScans)||v.additionalScans<1||v.additionalScans>1000||v.additionalReserveCents!==v.additionalScans*5)throw Error();
    return {id:v.id,additionalScans:v.additionalScans,additionalReserveCents:v.additionalReserveCents};
  }catch{throw Error('MUSE_ALLOWANCE_CONFIG_INVALID');}
}
export const cookieName = '__Host-breakshift-tester';
export const responseJson = (value,status=200,extra={}) => new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...extra}});
const safeError = error => /^MUSE_[A-Z_0-9]+$/.test(error.message) ? error.message : 'MUSE_SCAN_UNAVAILABLE';
const hex = bytes => [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
const encode = value => new TextEncoder().encode(value);
const hash = async value => hex(await crypto.subtle.digest('SHA-256',encode(value)));
async function sign(value,key) {
  const imported=await crypto.subtle.importKey('raw',encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',imported,encode(value)));
}
export async function authenticate(request,env) {
  if(!env.TESTER_COOKIE_KEY)return false;
  const cookie=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
  if(!cookie||!/^\d{10}\.[a-f0-9]{64}$/.test(cookie))return false;
  const [expires,signature]=cookie.split('.');
  if(Number(expires)<=Date.now()/1000||Number(expires)>Date.now()/1000+8*86400)return false;
  return signature===await sign(`tester:${expires}`,env.TESTER_COOKIE_KEY);
}
export async function limitedJson(request,max=2048) {
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error('MUSE_JSON_REQUIRED');
  const reader=request.body?.getReader();if(!reader)throw new Error('MUSE_REQUEST_REJECTED');
  let total=0;const chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>max){await reader.cancel();throw new Error('MUSE_REQUEST_TOO_LARGE');}chunks.push(value);}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Error('MUSE_REQUEST_REJECTED');}
}
export async function exchangeAccess(request,env) {
  if(!env.TESTER_ACCESS_HASH||!env.TESTER_COOKIE_KEY)return responseJson({error:'MUSE_ACCESS_NOT_CONFIGURED'},503);
  const body=await limitedJson(request,256);
  if(Object.keys(body).length!==1||typeof body.accessCode!=='string'||body.accessCode.length!==64||await hash(body.accessCode)!==env.TESTER_ACCESS_HASH)return responseJson({error:'MUSE_TESTER_ACCESS_REQUIRED'},403);
  const expires=String(Math.floor(Date.now()/1000)+7*86400);
  const token=`${expires}.${await sign(`tester:${expires}`,env.TESTER_COOKIE_KEY)}`;
  return responseJson({authenticated:true},200,{'set-cookie':`${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`});
}
export async function probeTransport(key) {
  // HEAD has no model prompt, credential, or inference payload. This isolates
  // runtime/TLS issues without creating another metered completion request.
  try {
    const transport=fetch;
    const response=await transport('https://api.meta.ai/v1/chat/completions',{method:'HEAD',headers:key?{Authorization:`Bearer ${key}`}:{},redirect:'error',signal:AbortSignal.timeout(5000)});
    return {inferenceRequested:false,method:'HEAD',httpStatus:response.status,credentialType:typeof key,abortTimeout:typeof AbortSignal.timeout};
  }catch(error){return {inferenceRequested:false,method:'HEAD',errorName:error.name,errorMessage:String(error.message).slice(0,180),abortTimeout:typeof AbortSignal.timeout};}
}
export function compileScan(input,sourceDigest) {
  const allowed=['zoneId','snapshotId','breakerKw','requestId','consent'];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!allowed.includes(key))||allowed.some(key=>!Object.hasOwn(input,key)))throw new Error('MUSE_SCAN_REQUEST_REJECTED');
  if(!Number.isFinite(input.breakerKw)||input.breakerKw<1.4||input.breakerKw>3.2||Math.abs(input.breakerKw*20-Math.round(input.breakerKw*20))>1e-7||!Object.hasOwn(STRATEGIES,'coordinated_repair'))throw new Error('MUSE_INVALID_CONDITIONS');
  if(typeof input.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(input.requestId))throw new Error('MUSE_IDEMPOTENCY_REQUIRED');
  if(input.consent!==SCAN_CONSENT)throw new Error('MUSE_SCAN_CONSENT_REQUIRED');
  const session=createInspectionSessionCore({initialBreakerKw:input.breakerKw});
  const state=session.mutate({type:'SELECT_ZONE',zoneId:input.zoneId,surface:'laptop',expectedVersion:1});
  if(state.evidenceSnapshotId!==input.snapshotId)throw new Error('MUSE_STALE_COMPONENT_SNAPSHOT');
  const packet=compileComponentPacket(state,input.zoneId,sourceDigest);
  return {state,packet,key:digest(packet),request:buildMuseRequest(packet)};
}
async function complete(request,key,transport=fetch,onStage=async()=>{}) {
  const response=await transport('https://api.meta.ai/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify(request),redirect:'manual',signal:AbortSignal.timeout(45000)});
  if(response.status>=300&&response.status<400)throw new Error('MUSE_PROVIDER_REDIRECT_REJECTED');
  if(!response.ok)throw new Error(`MUSE_PROVIDER_HTTP_${response.status}`);
  const reader=response.body.getReader();let size=0;const chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw new Error('MUSE_RESPONSE_TOO_LARGE');}chunks.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  const value=JSON.parse(new TextDecoder().decode(bytes));const choice=value.choices?.[0],usage=value.usage;
  if(value.model!==MUSE_MODEL||value.choices?.length!==1||choice.finish_reason!=='stop'||choice.message?.tool_calls?.length||choice.message?.function_call)throw new Error('MUSE_PROVIDER_RESPONSE_REJECTED');
  if(!Number.isSafeInteger(usage?.prompt_tokens)||usage.prompt_tokens<0||!Number.isSafeInteger(usage?.completion_tokens)||usage.completion_tokens<0||usage.completion_tokens>request.max_tokens)throw new Error('MUSE_USAGE_UNRECONCILED');
  const estimatedCostUsd=(usage.prompt_tokens*1.25+usage.completion_tokens*4.25)/1e6;
  if(estimatedCostUsd>RESERVE_USD)throw new Error('MUSE_USAGE_EXCEEDS_RESERVE');
  const responseId=typeof value.id==='string'?value.id.slice(0,160):null;
  if(responseId?.includes(key))throw Error('MUSE_RESPONSE_REJECTED');
  const verifiedUsage={promptTokens:usage.prompt_tokens,completionTokens:usage.completion_tokens,estimatedCostUsd};
  await onStage({phase:'RESPONSE_USAGE_VERIFIED',model:value.model,responseId,usage:verifiedUsage});
  return {output:JSON.parse(choice.message.content),model:value.model,responseId,usage:verifiedUsage};
}

// Global authorization ledger: reservation is persisted before provider I/O.
// Four base hosted attempts; owner-deployed, idempotent allowance additions
// retain the original accounting and cannot be supplied by a scan request.
export class MuseBudget {
  constructor(ctx,env) {
    this.ctx=ctx;this.env=env;this.attempts=[];this.busy=false;this.photoJobs=new Map();this.queuedPhoto=null;this.allowanceExtensions=[];this.allowanceError=null;
    this.ready=ctx.blockConcurrencyWhile(async()=>{
      this.attempts=await ctx.storage.get('attempts')||[];
      for(const attempt of this.attempts)if(attempt.resultStoredSeparately){
        const cached=await ctx.storage.get(`result:${attempt.id}`);
        if(cached)attempt.result=cached;
        else if(attempt.resultExpiresAt&&Date.parse(attempt.resultExpiresAt)<=Date.now())attempt.photoTextExpired=true;
        else if(attempt.status==='SUCCEEDED'&&!attempt.photoTextExpired)this.allowanceError='MUSE_LEDGER_RECONCILIATION_REQUIRED';
      }
      // One exact owner-deployed reconciliation: the old fetch option was
      // rejected synchronously by workerd, reproduced with HEAD/no inference.
      // Never apply this to a network/provider/parse failure or a different ID.
      const prior=this.attempts.find(a=>a.id==='c457c7c1-3e08-4d01-8eee-5ae4aa559589'&&a.status==='FAILED_OR_UNCERTAIN'&&a.error==='MUSE_SCAN_UNAVAILABLE');
      if(prior&&env.PREFLIGHT_RECONCILIATION==='0c61dd02052426a2407dd2957b18c07c9ed5710b5b0f80fca277a24b2643ab71'){
        prior.status='REJECTED_BEFORE_PROVIDER';prior.releasedUsd=.05;prior.reconciliationProof=env.PREFLIGHT_RECONCILIATION;
        prior.reconciliation='workerd rejects redirect:error before outbound I/O; live HEAD reproduction retained; original receipt preserved';
        await this.persistLedger();
      }
      // The owner explicitly resumed the two unused reservations after this
      // exact image request lost its result. Its full reserve remains charged.
      const reviewed=this.attempts.find(a=>a.id==='779ea93e-b693-46a2-9ec3-9b04ecbabb03'&&a.kind==='PHOTO_VISUAL_ASSESSMENT'&&a.status==='RESERVED'&&a.measuredInputTokens===869&&a.imageDigest==='4ff059d19b08b5fd7cb3da617f46b6d7971694b2bb71ffa92475a0792008d497');
      if(reviewed&&env.REVIEWED_IMAGE_HOLD===reviewed.id){
        reviewed.status='OWNER_REVIEWED_UNCERTAIN';reviewed.reviewedAt=new Date().toISOString();
        reviewed.review='Owner accepted this unknown outcome and resumed two unused scans under the original five-scan/0.25 cap. No reserve released or automatic retry.';
        await this.persistLedger();
      }
      // Explicit owner request to fix/resume this exact rejected photo scan.
      // Keep the original error, provider evidence and entire $0.05 reserve.
      const rejected=this.attempts.find(a=>a.id==='555b4cc5-7e53-41b3-ba94-e74eb81b6d55'&&a.kind==='PHOTO_VISUAL_ASSESSMENT'&&a.pipeline==='SAM_WONDER'&&a.status==='FAILED_OR_UNCERTAIN'&&a.error==='MUSE_PHOTO_BOX_OUT_OF_RANGE'&&a.measuredInputTokens===1070&&a.imageDigest==='30f8d9df548db0469c57c1deacb033b0a81daffa6b6b4a61c8c6c2b85f461c24'&&a.providerStage?.samResponseId==='resp_6ae1294d7cec68dfa45e4adb'&&a.reservedUsd===.05);
      if(rejected&&env.REVIEWED_PHOTO_REJECTION===rejected.id){
        rejected.priorStatus=rejected.status;rejected.status='OWNER_REVIEWED_UNCERTAIN';rejected.reviewedAt=new Date().toISOString();
        rejected.review='Owner requested fixing the photo failure and resuming Primo testing. Full reserve retained; original failed request is not retried and no allowance is added.';
        await this.persistLedger();
      }
      this.allowanceExtensions=await ctx.storage.get('allowanceExtensions')||[];
      // A malformed or changed grant fails closed; never clear usage, refund an
      // unknown outcome, or re-add the same allowance on a Worker restart.
      try{
        if(!Array.isArray(this.allowanceExtensions)||this.allowanceExtensions.length>100)throw Error('MUSE_ALLOWANCE_CONFIG_INVALID');
        for(const entry of this.allowanceExtensions)allowanceExtension(entry);
        if(new Set(this.allowanceExtensions.map(x=>x.id)).size!==this.allowanceExtensions.length)throw Error('MUSE_ALLOWANCE_CONFIG_INVALID');
        const requested=allowanceExtension(env.SCAN_ALLOWANCE_EXTENSION);
        if(requested){
          const existing=this.allowanceExtensions.find(x=>x.id===requested.id);
          if(existing&&(existing.additionalScans!==requested.additionalScans||existing.additionalReserveCents!==requested.additionalReserveCents))throw Error('MUSE_ALLOWANCE_CONFIG_CONFLICT');
          if(!existing){
            const next=[...this.allowanceExtensions,requested];
            await ctx.storage.put('allowanceExtensions',next);this.allowanceExtensions=next;
          }
        }
      }catch(error){this.allowanceError=/^MUSE_ALLOWANCE_/.test(error.message)?error.message:'MUSE_LEDGER_RECONCILIATION_REQUIRED';}
    });
  }
  async persistLedger(){
    // Metadata stays small as the tester allowance grows. Each new bounded
    // result has its own storage key; legacy inline records remain readable.
    await this.ctx.storage.put('attempts',this.attempts.map(a=>{if(!a.resultStoredSeparately)return a;const {result,...metadata}=a;return metadata;}));
  }
  async expirePhotos(){
    let changed=false;const now=Date.now();
    for(const a of this.attempts)if(a.kind==='PHOTO_VISUAL_ASSESSMENT'&&!a.photoTextExpired&&Date.parse(a.result?.expiresAt||a.resultExpiresAt)<=now){if(a.resultStoredSeparately)await this.ctx.storage.put(`result:${a.id}`,null);delete a.result;a.photoTextExpired=true;changed=true;}
    if(changed)await this.persistLedger();
    const dates=this.attempts.filter(a=>a.kind==='PHOTO_VISUAL_ASSESSMENT'&&!a.photoTextExpired).map(a=>Date.parse(a.result?.expiresAt||a.resultExpiresAt)).filter(Number.isFinite);
    if(dates.length&&this.ctx.storage.setAlarm)await this.ctx.storage.setAlarm(Math.min(...dates));
  }
  async alarm(){await this.ready;await this.expirePhotos();}
  summary() {
    const charged=this.attempts.filter(a=>a.status!=='REJECTED_BEFORE_PROVIDER');
    const held=charged.some(a=>a.status!=='SUCCEEDED'&&!(a.status==='OWNER_REVIEWED_UNCERTAIN'&&(a.id==='779ea93e-b693-46a2-9ec3-9b04ecbabb03'||(a.id==='555b4cc5-7e53-41b3-ba94-e74eb81b6d55'&&a.priorStatus==='FAILED_OR_UNCERTAIN'&&a.error==='MUSE_PHOTO_BOX_OUT_OF_RANGE'))));
    const extensions=this.allowanceError?[]:this.allowanceExtensions;
    const additionalScans=extensions.reduce((sum,x)=>sum+x.additionalScans,0),additionalCents=extensions.reduce((sum,x)=>sum+x.additionalReserveCents,0);
    const remainingScans=Math.max(0,MAX_CLOUD_ATTEMPTS+additionalScans-charged.length);
    const configured=Boolean(this.env.MUSE_SPARK_API_KEY);
    const enabled=this.env.LIVE_SCANS_ENABLED==='true'&&configured&&!held&&!this.allowanceError&&remainingScans>0;
    return {model:MUSE_MODEL,photoModels:{diagnosis:WONDER_MODEL,segmentation:SAM_MODEL},mode:'LIVE_MUSE',configured,enabled,busy:this.busy,remainingScans,totalApprovedScans:5+additionalScans,budgetUsd:(25+additionalCents)/100,reservedUsd:(PRIOR_RESERVED_CENTS+5*charged.length)/100,allowanceExtensions:extensions,reconciledPreProviderAttempts:this.attempts.length-charged.length,reservePerScanUsd:.05,consent:SCAN_CONSENT,reason:this.allowanceError|| (this.env.LIVE_SCANS_ENABLED!=='true'?'MUSE_HOSTED_SCANS_DISABLED':!configured?'MUSE_CREDENTIAL_NOT_CONFIGURED':held?'MUSE_LEDGER_RECONCILIATION_REQUIRED':!remainingScans?'MUSE_SCAN_BUDGET_NOT_AVAILABLE':null)};
  }
  async fetch(request) {
    await this.ready;
    await this.expirePhotos();
    const url=new URL(request.url);
    if(request.method==='GET'&&url.pathname==='/connectivity')return responseJson(await probeTransport(this.env.MUSE_SPARK_API_KEY));
    if(request.method==='GET'&&url.pathname==='/status')return responseJson(this.summary());
    if(request.method==='GET'&&url.pathname==='/audit')return responseJson({summary:this.summary(),attempts:this.attempts.map(a=>({id:a.id,kind:a.kind,pipeline:a.pipeline,status:a.status,error:a.error,createdAt:a.createdAt,reservedUsd:a.reservedUsd,measuredInputTokens:a.measuredInputTokens,hasResult:Boolean(a.result),responseId:a.result?.responseId,imageDigest:a.imageDigest,videoDigest:a.videoDigest,providerStage:a.providerStage}))});
    if(request.method==='GET'&&url.pathname==='/photo-result'){
      const id=url.searchParams.get('scanId'),attempt=this.attempts.find(a=>a.id===id&&a.kind==='PHOTO_VISUAL_ASSESSMENT');
      if(attempt?.status==='SUCCEEDED'&&attempt.result)return responseJson({status:'SUCCEEDED',result:{...attempt.result,cached:true}});
      if(attempt&&attempt.status!=='SUCCEEDED'&&!this.busy)return responseJson({status:'FAILED_OR_UNCERTAIN',error:attempt.error||'MUSE_LEDGER_RECONCILIATION_REQUIRED',reservedUsd:.05});
      const job=this.photoJobs.get(id);
      if(job)return responseJson(job);
      return responseJson({error:'MUSE_IMAGE_JOB_NOT_AVAILABLE'},404);
    }
    if(request.method==='POST'&&['/photo-start','/perception-start'].includes(url.pathname)){
      try{
        const enhanced=url.pathname==='/perception-start';
        const input=await limitedJson(request,enhanced?MAX_PERCEPTION_BODY:MAX_PHOTO_BODY),compiled=enhanced?compilePerception(input,release.perceptionSourceDigest):compilePhotoScan(input,release.photoSourceDigest);
        const cached=this.attempts.find(a=>a.key===compiled.key&&a.status==='SUCCEEDED'&&a.result);
        if(cached)return responseJson({...cached.result,cached:true});
        const old=this.attempts.find(a=>a.id===input.requestId),job=this.photoJobs.get(input.requestId);
        if(old||job)return responseJson({error:'MUSE_ATTEMPT_ALREADY_RESERVED'},409);
        if(this.busy||this.queuedPhoto)return responseJson({error:'MUSE_SCAN_BUSY'},409);
        const status=this.summary();if(!status.enabled)return responseJson({error:status.reason},503);
        if(typeof this.ctx.waitUntil!=='function')return responseJson({error:'MUSE_IMAGE_BACKGROUND_UNAVAILABLE'},503);
        if(this.photoJobs.size>=8)this.photoJobs.delete(this.photoJobs.keys().next().value);
        this.queuedPhoto=input.requestId;this.photoJobs.set(input.requestId,{status:'PENDING',scanId:input.requestId});
        const work=(async()=>{
          try{
            const response=await this.fetch(new Request(`https://budget/${enhanced?'perception-scan':'photo-scan'}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));
            const value=await response.json();this.photoJobs.set(input.requestId,response.ok?{status:'SUCCEEDED',scanId:input.requestId}:{status:'FAILED_OR_UNCERTAIN',scanId:input.requestId,error:value.error,reservedUsd:value.reservedUsd,inferenceRequested:value.inferenceRequested});
          }catch{this.photoJobs.set(input.requestId,{status:'FAILED_OR_UNCERTAIN',scanId:input.requestId,error:'MUSE_LEDGER_RECONCILIATION_REQUIRED'});}
          finally{this.queuedPhoto=null;}
        })();
        this.ctx.waitUntil(work);
        return responseJson({status:'PENDING',scanId:input.requestId},202);
      }catch(error){return responseJson({error:safeError(error)},400);}
    }
    if(request.method==='GET'&&url.pathname==='/result') {
      const hit=this.attempts.find(a=>a.status==='SUCCEEDED'&&a.result&&a.kind!=='PHOTO_VISUAL_ASSESSMENT'&&a.result.zoneId===url.searchParams.get('zoneId')&&a.result.evidenceSnapshotId===url.searchParams.get('snapshotId')&&(a.result.sourceDigest===COMPONENT_SOURCE||(COMPONENT_SOURCE===LEGACY_INPUT_PIN&&a.result.sourceDigest===LEGACY_COMPONENT_SOURCE)));
      return responseJson({result:hit?{...hit.result,cached:true}:null});
    }
    const enhanced=url.pathname==='/perception-scan',photo=url.pathname==='/photo-scan'||enhanced;
    if(request.method!=='POST'||(!photo&&url.pathname!=='/scan'))return responseJson({error:'MUSE_ROUTE_NOT_FOUND'},404);
    try {
      const input=await limitedJson(request,enhanced?MAX_PERCEPTION_BODY:photo?MAX_PHOTO_BODY:2048);
      if(this.queuedPhoto&&this.queuedPhoto!==input.requestId)return responseJson({error:'MUSE_SCAN_BUSY'},409);
      const compiled=enhanced?compilePerception(input,release.perceptionSourceDigest):photo?compilePhotoScan(input,release.photoSourceDigest):compileScan(input,COMPONENT_SOURCE);
      const legacyKey=!photo&&COMPONENT_SOURCE===LEGACY_INPUT_PIN?compileScan(input,LEGACY_COMPONENT_SOURCE).key:null;
      const sameId=this.attempts.find(a=>a.id===input.requestId);
      if(sameId&&sameId.key!==compiled.key)return responseJson({error:'MUSE_IDEMPOTENCY_CONFLICT'},409);
      const cached=this.attempts.find(a=>(a.key===compiled.key||(legacyKey&&a.key===legacyKey))&&a.status==='SUCCEEDED'&&a.result);
      if(cached)return responseJson({...cached.result,cached:true});
      if(sameId)return responseJson({error:'MUSE_ATTEMPT_ALREADY_RESERVED'},409);
      if(this.busy)return responseJson({error:'MUSE_SCAN_BUSY'},409);
      const status=this.summary();if(!status.enabled)return responseJson({error:status.reason},503);
      this.busy=true;
      let measuredInputTokens;
      if(photo){try{measuredInputTokens=enhanced?(await perceptionPreflight(compiled,this.env.MUSE_SPARK_API_KEY,this.env.TEST_TRANSPORT||fetch)).inputTokens:await photoTokenPreflight(compiled,this.env.MUSE_SPARK_API_KEY,this.env.TEST_TRANSPORT||fetch);}catch(error){this.busy=false;return responseJson({error:safeError(error),inferenceRequested:false,reservedUsd:0},400);}}
      const attempt={id:input.requestId,key:compiled.key,kind:photo?'PHOTO_VISUAL_ASSESSMENT':'SIMULATED_COMPONENT',status:'RESERVED',reservedUsd:.05,resultStoredSeparately:true,createdAt:new Date().toISOString(),...(photo?{imageDigest:compiled.imageDigest,measuredInputTokens}:{} ),...(enhanced?{pipeline:'SAM_WONDER',videoDigest:compiled.videoDigest}:{})};
      this.attempts.push(attempt);
      // A storage write failure cannot release an in-memory reserve or start I/O.
      try {await this.persistLedger();}catch{this.busy=false;return responseJson({error:'MUSE_LEDGER_RECONCILIATION_REQUIRED'},503);}
      try {
        if(photo&&this.ctx.storage.setAlarm){const priorDates=this.attempts.filter(a=>a.kind==='PHOTO_VISUAL_ASSESSMENT'&&a.result).map(a=>Date.parse(a.result.expiresAt));await this.ctx.storage.setAlarm(Math.min(Date.now()+86400000,...priorDates));}
        const recordStage=async stage=>{attempt.providerStage={...attempt.providerStage,...stage};await this.persistLedger();};
        const started=Date.now();const answer=enhanced?await runPerception(compiled,this.env.MUSE_SPARK_API_KEY,this.env.TEST_TRANSPORT||fetch,recordStage):await complete(compiled.request,this.env.MUSE_SPARK_API_KEY,this.env.TEST_TRANSPORT||fetch,recordStage);
        const diagnosis=enhanced?{summary:answer.summary,limitations:answer.limitations,regions:answer.regions,repairPlan:answer.repairPlan,stopConditions:answer.stopConditions,twinProposals:answer.twinProposals,localization:answer.localization,planExecution:answer.planExecution,segmentation:answer.segmentation}:photo?validatePhotoAssessment(answer.output):validateDiagnosis(answer.output,compiled.packet);
        if(JSON.stringify(diagnosis).includes(this.env.MUSE_SPARK_API_KEY))throw new Error('MUSE_RESPONSE_REJECTED');
        const common={scanId:attempt.id,mode:'LIVE_MUSE',model:answer.model,responseId:answer.responseId,createdAt:new Date().toISOString(),elapsedMs:Date.now()-started,cached:false,usage:answer.usage,...diagnosis};
        const result=photo?{...common,schema:enhanced?'breakshift.sam-wonder.v1':'breakshift.photo-assessment.v1',kind:'PHOTO_VISUAL_ASSESSMENT',imageDigest:compiled.imageDigest,...(enhanced?{videoDigest:compiled.videoDigest,target:compiled.target}:{}),sourceKind:compiled.sourceKind,sourceDigest:enhanced?release.perceptionSourceDigest:release.photoSourceDigest,dimensions:compiled.dimensions,physicalVerificationRequired:true,expiresAt:new Date(Date.now()+86400000).toISOString()}:{...common,schema:'breakshift.component-diagnosis.v1',zoneId:input.zoneId,evidenceSnapshotId:input.snapshotId,sourceDigest:COMPONENT_SOURCE,packetDigest:compiled.key,stale:false,fixes:diagnosis.fixes.map(f=>({...f,affectedZoneIds:STRATEGIES[f.strategyId].zones,evaluation:evaluateStrategy(f.strategyId,compiled.state)}))};
        attempt.status='SUCCEEDED';attempt.result=result;
        if(photo)attempt.resultExpiresAt=result.expiresAt;
        try {await this.ctx.storage.put(`result:${attempt.id}`,result);await this.persistLedger();}catch{attempt.status='FAILED_OR_UNCERTAIN';delete attempt.result;throw new Error('MUSE_LEDGER_RECONCILIATION_REQUIRED');}
        if(photo)await this.expirePhotos();
        return responseJson(result);
      } catch(error) {
        attempt.status='FAILED_OR_UNCERTAIN';attempt.error=safeError(error);delete attempt.result;
        try{await this.persistLedger();}catch{/* Reserved state remains durable; no retry. */}
        return responseJson({error:attempt.error,reservedUsd:.05},502);
      } finally {this.busy=false;}
    }catch(error){return responseJson({error:safeError(error)},400);}
  }
}
