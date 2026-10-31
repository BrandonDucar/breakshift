import {captureInspectionClip} from './camera-clip.mjs';
import {createSamOverlay} from './sam-overlay.mjs';
import {BAY_ART,referencePlate,bindReferenceFallback} from './visual-assets.mjs';
import {scanAvailability,scanFailure} from './bay-job.mjs';
import {playbackRate,playbackOptions} from './playback-speed.mjs';
import {workerIntakeReceipt} from './worker-intake.mjs';
import {PHOTO_RECIPES,validateTwinProposals} from './photo-repair-bridge.mjs';
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const hex=bytes=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
export function createPhotoInspector(root,{getStatus,refreshStatus,onTestRecipeInTwin,onTestPhotoFixInTwin,onPhotoContextChanged}){
  let image=null,result=null,stream=null,busy=false,selection=0,fixIndex=0,revision=0,active=false,cameraEpoch=0;
  const cache=new Map();const q=selector=>root.querySelector(selector);
  let recipeOverride='',assumptionsAck=false,inspectionStill=false,photoEpoch=0;
  function invalidatePhoto(){photoEpoch++;onPhotoContextChanged?.();}
  root.innerHTML=`<div class="photo-intro"><div><p class="eyebrow">PHOTO / CAMERA INSPECTION</p><h2>Put the component in view.</h2><p>No hardware? Start with the demo image. Then try your own photo.</p></div><p class="scope-note">Muse marks visible areas and suggests checks or possible fixes. Internal faults and repair success need separate evidence.</p></div>
    <div class="photo-tools"><label class="photo-upload">Upload photo<input id="photo-file" type="file" accept="image/jpeg,image/png,image/webp"></label><button type="button" id="photo-camera">Use camera</button><button type="button" id="photo-demo">Try demo image ↗</button><button type="button" id="photo-demo-track">Try tracking demo ↗</button><button type="button" id="photo-clear" disabled>Clear image</button></div>
    <p id="photo-error" class="error-banner" role="alert" hidden></p><div id="photo-camera-panel" hidden><video id="photo-video" autoplay muted playsinline></video><div class="photo-tools"><button type="button" id="photo-capture">Take photo</button><button type="button" id="photo-record">Record short tracking clip</button><button type="button" id="photo-cancel-camera">Cancel camera</button></div><p class="scope-note">Capture about 2 seconds. Review locally, then Analyze to send this clip to SAM. Tracking applies to the captured clip; camera preview is not a continuous cloud stream.</p></div>
    <div class="photo-grid"><div><div id="photo-image-wrap" class="photo-image-wrap"><div id="photo-empty"><span class="eyebrow">YOUR COMPONENT GOES HERE</span><h3>Upload. Look closer.<br>Ask Muse.</h3><p>JPEG, PNG or WebP · up to 8 MB before resizing</p></div><img id="photo-image" alt="Selected component image" hidden><video id="photo-clip" controls playsinline muted hidden></video><canvas id="sam-mask-overlay" aria-label="SAM component geometry; not a fault or safety verdict" hidden></canvas><div id="photo-pins"></div><div id="photo-overlay-note" hidden></div></div><div class="photo-source-row"><span id="photo-source">NO IMAGE SELECTED</span><span id="photo-dimensions"></span></div><label class="photo-question">Component to outline<input id="photo-target" maxlength="80" value="robotic arm" placeholder="Example: gripper, motor, connector"></label><label class="photo-question">What should Muse look at?<textarea id="photo-note" maxlength="400" rows="2" placeholder="Optional: what seems wrong, or which part to inspect"></textarea></label><button type="button" class="primary" id="photo-analyze" disabled>Outline with SAM + diagnose with Wonder ↗</button><p class="scope-note">Analyze sends this image or captured clip, your component name and note to Meta. SAM outlines/tracks; Wonder diagnoses the first image and proposes a repair plan. Original pixels are not stored by this bay; private assessment/geometry expire after 24 hours. A fresh combined scan reserves at most $0.05 from the shared allowance.</p><p id="photo-status" class="scope-note" role="status">Choose an image to begin.</p></div><aside id="photo-findings" class="photo-findings"><p class="eyebrow">SAM 3.1 / MUSE WONDER</p><h3>Evidence before answers.</h3><p>Component outlines, observations and proposed repair steps appear here. Physical condition and repair success need separate verification.</p></aside></div>`;
  const clipPlayer=q('#photo-clip'),samOverlay=createSamOverlay(q('#sam-mask-overlay'),clipPlayer);let clip=null,clipUrl=null,captureAbort=null;
  let attempt={status:'NOT_REQUESTED'};
  const speed=document.createElement('label');speed.className='clip-playback-speed';speed.hidden=true;speed.innerHTML=`Playback speed <select id="photo-playback-speed" aria-label="Clip playback speed">${playbackOptions()}</select>`;q('#photo-image-wrap').after(speed);
  q('#photo-playback-speed').addEventListener('change',event=>{const rate=playbackRate(event.target.value);clipPlayer.defaultPlaybackRate=rate;clipPlayer.playbackRate=rate;});
  const frameButton=document.createElement('button');frameButton.type='button';frameButton.id='photo-first-frame';frameButton.hidden=true;frameButton.textContent='Inspect analyzed first frame / select fix';speed.after(frameButton);
  const photoTestControls=document.createElement('div');photoTestControls.id='photo-repair-controls';photoTestControls.className='photo-repair-controls';photoTestControls.hidden=true;frameButton.after(photoTestControls);
  frameButton.addEventListener('click',()=>{inspectionStill=!inspectionStill;if(inspectionStill){clipPlayer.pause();samOverlay.clear();q('#photo-image').src=image.imageDataUrl;}else if(result?.segmentation)samOverlay.setResult(result.segmentation);renderAssessment();});
  const intake=document.createElement('div');intake.className='worker-intake';intake.innerHTML='<dl id="worker-intake-stages" aria-label="Worker intake stages" aria-live="polite"></dl><button id="worker-intake-download" type="button" disabled>Save intake receipt</button>';q('.photo-source-row').after(intake);
  const receipt=()=>workerIntakeReceipt({image,result,attempt,hasClip:Boolean(clip)});
  q('#worker-intake-download').addEventListener('click',()=>{if(!image)return;const url=URL.createObjectURL(new Blob([JSON.stringify(receipt(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='breakshift-worker-intake.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  q('#photo-empty').innerHTML=referencePlate('cutaway','Bring your component into the bay.');
  q('#photo-empty figcaption small').textContent='Illustrative reference only · upload a photo, use the camera or try the recorded demo.';
  bindReferenceFallback(q('#photo-empty'));
  const waiting=()=>'<p class="eyebrow">SAM 3.1 / MUSE WONDER</p><h3>From component to repair plan.</h3><ol class="photo-waiting"><li><strong>Bring the evidence.</strong>Upload a photo or capture a short camera clip.</li><li><strong>Outline the component.</strong>SAM marks its visible shape and tracks captured frames.</li><li><strong>Inspect the possibilities.</strong>Wonder proposes causes, checks and repair steps. Physical verification remains separate.</li></ol>';
  q('#photo-findings').innerHTML=waiting();
  const fallback=document.createElement('button');fallback.type='button';fallback.id='photo-recorded-fallback';fallback.textContent='Open recorded inspection';fallback.hidden=true;
  q('#photo-status').after(fallback);
  const jobLink=document.createElement('a');jobLink.href='#bay-job';jobLink.className='photo-job-link';jobLink.textContent='Return to demo repair job';q('.photo-tools').append(jobLink);
  function clearClip(){captureAbort?.abort();captureAbort=null;clipPlayer.pause();clipPlayer.removeAttribute('src');clipPlayer.hidden=true;if(clipUrl)URL.revokeObjectURL(clipUrl);clipUrl=null;clip=null;samOverlay.clear();}
  function error(message=''){q('#photo-error').hidden=!message;q('#photo-error').textContent=message;}
  function stopCamera(){cameraEpoch++;if(stream)for(const track of stream.getTracks())track.stop();stream=null;q('#photo-video').srcObject=null;q('#photo-camera-panel').hidden=true;update();}
  function update(){
    const record=receipt();
    const analysisLabel={NOT_REQUESTED:'Not requested',PENDING:'In progress',ASSESSMENT_REJECTED:'Rejected assessment',FAILED_OR_UNCERTAIN:'Outcome needs review',ASSESSMENT_RECEIVED:'Assessment received',RECORDED_DEMO_RESULT:'Recorded demo only'}[record.analysis]||'Not requested';
    q('#worker-intake-stages').innerHTML=`<div><dt>PHOTO INTAKE</dt><dd>${image?'Accepted on this device':'No photo yet'}</dd></div><div><dt>MODEL ANALYSIS</dt><dd>${analysisLabel}</dd></div><div><dt>PHYSICAL OUTCOME</dt><dd>Not verified</dd></div>`;
    q('#worker-intake-download').disabled=!image||busy;
    speed.hidden=!clip;q('#photo-playback-speed').disabled=busy||!clip;
    const status=getStatus();q('#photo-analyze').disabled=busy||!image||Boolean(stream)||(!result&&(!status?.authenticated||!status.enabled));
    q('#photo-analyze').textContent=busy?'SAM + Wonder are inspecting…':result?'Review image assessment ↗':'Outline with SAM + diagnose with Wonder ↗';
    q('#photo-clear').disabled=busy||!image;q('#photo-file').disabled=busy;q('#photo-demo').disabled=busy;q('#photo-camera').disabled=busy;
    q('#photo-note').disabled=busy;q('#photo-target').disabled=busy;q('#photo-demo-track').disabled=busy;q('#photo-record').disabled=busy;
    const allowanceLabel=getStatus()?.authenticated===false?'live model analysis restricted':`${getStatus()?.remainingScans??'—'} shared scans remaining`;
    q('#photo-status').textContent=busy?'Muse is inspecting this image. Checking for the result; no automatic scan retries.':result?`${result.model} · ${result.mode==='TEST_ADAPTER'?'TEST ADAPTER / NO PROVIDER CALL':result.mode==='RECORDED_SAM_WONDER_DEMO'?'VERIFIED DEMO REPLAY / NO NEW MODEL CALL':result.cached?'cached image assessment':'LIVE IMAGE ASSESSMENT'} · ${allowanceLabel}`:!getStatus()?.authenticated?'Open access. Live model analysis is restricted.':getStatus()?.reason==='MUSE_LEDGER_RECONCILIATION_REQUIRED'?'Live analysis is paused: an earlier request has an uncertain outcome. Upload, camera and demo preview remain available.':getStatus()?.reason==='MUSE_SCAN_BUDGET_NOT_AVAILABLE'?'The current scan allowance is used. Preview, capture and verified demo playback remain available.':image?`${getStatus()?.remainingScans??0} shared scans remaining · review the image before sending.`:'Choose an image to begin.';
    if(!busy&&!result&&!status?.enabled)q('#photo-status').textContent=scanAvailability(status);
    fallback.hidden=busy||Boolean(result)||Boolean(status?.enabled);
  }
  function clearResult(){invalidatePhoto();result=null;attempt={status:'NOT_REQUESTED'};selection=0;fixIndex=0;recipeOverride='';assumptionsAck=false;inspectionStill=false;frameButton.hidden=true;photoTestControls.hidden=true;photoTestControls.textContent='';samOverlay.clear();q('#photo-pins').textContent='';q('#photo-overlay-note').hidden=true;q('#photo-findings').innerHTML=waiting();update();}
  async function selectImage(blob,sourceKind,isCurrent=()=>true){
    if(!blob||blob.size>8*1024*1024||!['image/jpeg','image/png','image/webp'].includes(blob.type))throw Error('Choose a JPEG, PNG or WebP image under 8 MB.');
    const current=++revision,priorNote=q('#photo-note').value;
    let bitmap;
    try{bitmap=await createImageBitmap(blob,{imageOrientation:'from-image'});}
    catch{throw Error('This image file could not be decoded. Choose a valid JPEG, PNG or WebP image.');}
    try{
      if(bitmap.width*bitmap.height>20000000)throw Error('This image is too large to preview. Choose a smaller image.');
      const scale=Math.min(1,768/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
      canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
      if(Math.min(canvas.width,canvas.height)<32)throw Error('Choose a clearer image with both dimensions at least 32 pixels.');
      canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
      const dataUrl=canvas.toDataURL('image/jpeg',.82);const bytes=Uint8Array.from(atob(dataUrl.split(',')[1]),c=>c.charCodeAt(0));
      if(bytes.length>500000)throw Error('The resized image is still too large. Choose a tighter crop.');
      const imageDigest=hex(await crypto.subtle.digest('SHA-256',bytes));if(current!==revision||!isCurrent())return false;
      const clearDemoNote=image?.sourceKind==='DEMO_ILLUSTRATION'&&sourceKind!=='DEMO_ILLUSTRATION'&&q('#photo-note').value===priorNote;
      error();clearResult();clearClip();
      q('#photo-image-wrap').classList.remove('recorded-media');
      if(clearDemoNote)q('#photo-note').value='';
      image={imageDataUrl:dataUrl,imageDigest,sourceKind,width:canvas.width,height:canvas.height};
      q('#photo-image').src=dataUrl;q('#photo-image').hidden=false;q('#photo-empty').hidden=true;
      q('#photo-image-wrap').style.aspectRatio=`${canvas.width}/${canvas.height}`;
      q('#photo-source').textContent=sourceKind==='DEMO_ILLUSTRATION'?'DEMO ILLUSTRATION / NOT A REAL INSPECTION':sourceKind==='CAMERA_FRAME'?'CAMERA FRAME / USER-SUPPLIED EVIDENCE':'UPLOADED IMAGE / PROVENANCE UNVERIFIED';
      q('#photo-dimensions').textContent=`${canvas.width} × ${canvas.height} · metadata removed`;
      if(sourceKind==='DEMO_ILLUSTRATION')q('#photo-note').value='Demo cutaway illustration: inspect the wrist and gripper; report only what is visible. Exposed internals are intentional.';
      update();return true;
    }finally{bitmap.close();}
  }
  function renderAssessment(){
    const region=result.regions[selection];const chosen=region.possibleFixes[fixIndex]||region.possibleFixes[0];
    const proposal=validateTwinProposals(result.twinProposals||[],result.regions).find(p=>p.regionIndex===selection&&p.fixIndex===fixIndex);
    const mapped=recipeOverride||proposal?.strategyId||'';
    const origin=recipeOverride?'OPERATOR_HYPOTHESIS':'WONDER_PROPOSAL';
    q('#photo-pins').innerHTML=result.regions.map((r,index)=>`<button type="button" class="photo-region ${index===selection?'selected':''}" data-photo-region="${index}" style="left:${r.bbox[0]/10}%;top:${r.bbox[1]/10}%;width:${r.bbox[2]/10}%;height:${r.bbox[3]/10}%" aria-label="Inspect region ${index+1}: ${esc(r.label)}" aria-pressed="${index===selection}"><b>${index+1}</b></button>`).join('');
    const note=q('#photo-overlay-note');note.hidden=false;note.innerHTML=`<small>POSSIBLE FIX / NEEDS CONFIRMATION</small><strong>${esc(region.label)}</strong><span>${esc(chosen)}</span>`;
    if(onTestPhotoFixInTwin)note.insertAdjacentHTML('beforeend',`<label>Proposed fix<select id="photo-component-fix" aria-label="Proposed fix on component">${region.possibleFixes.map((f,i)=>`<option value="${i}" ${i===fixIndex?'selected':''}>${esc(f)}</option>`).join('')}</select></label><label>Simulation mapping<select id="photo-recipe-map" aria-label="Simulation mapping for photo fix"><option value="">${proposal?'Wonder: '+esc(PHOTO_RECIPES[proposal.strategyId]):'Not modeled / choose hypothesis'}</option>${Object.entries(PHOTO_RECIPES).map(([id,title])=>`<option value="${id}" ${recipeOverride===id?'selected':''}>Operator hypothesis: ${esc(title)}</option>`).join('')}</select></label><small>${mapped?`${origin==='WONDER_PROPOSAL'?'WONDER PROPOSAL':'OPERATOR HYPOTHESIS'} · REFERENCE WORKCELL ONLY`:'Inspection / physical service is not simulated.'}</small>${proposal&&!recipeOverride?`<span>${esc(proposal.rationale)} ${proposal.assumptions.map(esc).join(' ')}</span>`:''}<label class="photo-assumptions"><input id="photo-test-assumptions" type="checkbox" ${assumptionsAck?'checked':''}> Test assumes this component behaves like the demo workcell. Photo condition stays unverified.</label><button id="photo-run-selected-fix" type="button" ${mapped&&assumptionsAck?'':'disabled'}>Test selected fix in Repair Twin ↗</button>`);
    if(onTestPhotoFixInTwin){photoTestControls.textContent='';while(note.children.length>3)photoTestControls.append(note.children[3]);photoTestControls.hidden=false;note.insertAdjacentHTML('beforeend','<button type="button" data-photo-open-test>Choose / test this fix ↗</button>');}
    q('#photo-pins').hidden=Boolean(clip)&&!inspectionStill;note.hidden=Boolean(clip)&&!inspectionStill;
    if(clip){frameButton.hidden=false;frameButton.textContent=inspectionStill?'Return to tracked clip':'Inspect analyzed first frame / select fix';clipPlayer.hidden=inspectionStill;q('#photo-image').hidden=!inspectionStill;}
    q('#photo-findings').innerHTML=`<p class="eyebrow">${image.sourceKind==='DEMO_ILLUSTRATION'?'DEMO IMAGE':'VISUAL EVIDENCE'} / ${esc(result.model)}</p><h3>${esc(result.summary)}</h3><div class="photo-region-list">${result.regions.map((r,index)=>`<button type="button" data-photo-region="${index}" aria-pressed="${index===selection}">${index+1} / ${esc(r.label)}</button>`).join('')}</div><h4>VISIBLE OBSERVATIONS</h4><ul>${region.observations.map(value=>`<li>${esc(value)}</li>`).join('')}</ul><h4>POSSIBLE CAUSES / UNCONFIRMED</h4><ul>${region.possibleCauses.map(value=>`<li>${esc(value)}</li>`).join('')}</ul><h4>POSSIBLE FIXES / PREVIEW ON IMAGE</h4>${region.possibleFixes.map((value,index)=>`<button type="button" class="photo-fix" data-photo-fix="${index}" aria-pressed="${index===fixIndex}">${esc(value)} ↗</button>`).join('')}<h4>CHECKS STILL NEEDED</h4><ul>${region.checks.map(value=>`<li>${esc(value)}</li>`).join('')}</ul><p class="scope-note">${result.limitations.map(esc).join(' ')} Physical verification is required; no repaired/safe status is issued from this image.</p>`;
    if(result.segmentation){
      const ids=[...new Set(result.segmentation.frames.flatMap(f=>f.objects.map(o=>o.id)))];
      q('#photo-findings').insertAdjacentHTML('beforeend',`<h4>SAM 3.1 / COMPONENT OUTLINE</h4><p class="scope-note">${result.segmentation.kind==='VIDEO_TRACKING'?'Stable object IDs in captured-clip playback. Frames without a match clear the outline.':'Still-image mask; no motion tracking.'} Geometry is not a fault classification.</p><div class="photo-region-list">${ids.map(id=>`<button type="button" data-sam-id="${esc(id)}">${esc(result.target)} / object ${esc(id)}</button>`).join('')||'<p>No matching component found. Try a more specific noun or clearer view.</p>'}</div><h4>WONDER / PROPOSED REPAIR PLAN</h4><ol>${result.repairPlan.map(s=>`<li><strong>${esc(s.step)}</strong><p>${esc(s.reason)}<br>Verify: ${esc(s.verification)}</p></li>`).join('')}</ol><h4>STOP CONDITIONS</h4><ul>${result.stopConditions.map(s=>`<li>${esc(s)}</li>`).join('')}</ul>${onTestRecipeInTwin&&!onTestPhotoFixInTwin?'<button type="button" class="inspector-action" id="photo-test-bypass" data-test-twin-recipe="coordinated_repair">Simulate Station B bypass in Repair Twin ↗</button><p class="scope-note">Runs deterministic coordinated_repair simulator recipe; Wonder text is not auto-compiled into controller code.</p>':''}<p class="scope-note">Plan only · not executed · no physical service clearance. <a href="/third-party/meta-sam-LICENSE.txt">SAM license</a></p>`);
    }
    if(onTestPhotoFixInTwin)q('#photo-findings').insertAdjacentHTML('afterbegin',`<p class="scope-note">Choose a fix on the image to test its mapped reference-workcell hypothesis. ${clip?'Use “Inspect analyzed first frame” for fix controls; Wonder diagnosed that frame, not the entire video.':''} A passing model test is not a repaired-photo verdict.</p>`);
    update();
  }
  async function analyze(){
    if(!image||busy)return;
    if(result){renderAssessment();return;}
    const key=`SAM_WONDER:${image.imageDigest}:${clip?.videoDataUrl||''}:${image.sourceKind}:${q('#photo-target').value}:${q('#photo-note').value}`;
    if(cache.has(key)){result={...cache.get(key),cached:true};samOverlay.setResult(result.segmentation);renderAssessment();return;}
    const savedImage=image;attempt={status:'PENDING'};busy=true;error();update();
    try{
      const response=await fetch('/api/muse/perception-scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({imageDataUrl:image.imageDataUrl,sourceKind:image.sourceKind,note:q('#photo-note').value,target:q('#photo-target').value.trim(),videoDataUrl:clip?.videoDataUrl||null,requestId:crypto.randomUUID(),consent:getStatus().consent}),signal:AbortSignal.timeout(65000)});
      if(!response.headers.get('content-type')?.includes('application/json'))throw Error('The hosted scan connection failed; its outcome needs review before another scan.');
      let value=await response.json();if(!response.ok)throw Error(value.error||'Image assessment did not complete.');
      if(response.status===202){
        const scanId=value.scanId;if(!/^[a-f0-9-]{36}$/.test(scanId))throw Error('Invalid hosted scan reference.');attempt.scanId=scanId;
        let completed=false;
        for(let i=0;i<140;i++){
          await new Promise(resolve=>setTimeout(resolve,1200));
          const poll=await fetch(`/api/muse/photo-result?scanId=${encodeURIComponent(scanId)}`,{cache:'no-store'});
          if(!poll.ok)throw Error(`Image scan ${scanId} could not be read back. Its outcome must be reviewed; do not resend.`);
          const state=await poll.json();
          if(state.status==='SUCCEEDED'&&state.result){value=state.result;completed=true;break;}
          if(state.status!=='PENDING')throw Error(`${state.error||'Image assessment stopped'} (${scanId}). No automatic retry.`);
        }
        if(!completed)throw Error(`Image scan ${scanId} is still pending. No new scan was sent.`);
      }
      if(value.kind!=='PHOTO_VISUAL_ASSESSMENT'||value.imageDigest!==savedImage.imageDigest||!Array.isArray(value.regions)||!value.regions.length)throw Error('Image assessment did not match this image.');
      if(image!==savedImage)throw Error('The image changed. This assessment cannot overlay the new image.');
      result=value;cache.set(key,value);selection=0;fixIndex=0;if(result.segmentation)samOverlay.setResult(result.segmentation);renderAssessment();
    }catch(e){attempt={...attempt,status:e.message.includes('MUSE_PHOTO_BOX_OUT_OF_RANGE')?'ASSESSMENT_REJECTED':'FAILED_OR_UNCERTAIN',errorCode:e.message.match(/MUSE_[A-Z_0-9]+/)?.[0]||'SCAN_OUTCOME_UNCONFIRMED'};error(scanFailure(e));}
    finally{busy=false;await refreshStatus();update();}
  }
  q('#photo-file').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{stopCamera();await selectImage(file,'USER_SUPPLIED_IMAGE');}catch(e){error(e.message);}finally{event.target.value='';}});
  q('#photo-demo').addEventListener('click',async()=>{try{stopCamera();const response=await fetch('/public/assets/robot-cutaway-v1.png');if(!response.ok)throw Error('Demo image unavailable. Upload an image instead.');await selectImage(await response.blob(),'DEMO_ILLUSTRATION');}catch(e){error(e.message);}});
  async function recordClip(draw,width,height,sourceKind){
    const controller=new AbortController(),epoch=cameraEpoch;captureAbort=controller;busy=true;error();update();
    try{
      const captured=await captureInspectionClip(draw,{width,height,signal:controller.signal});
      if(captureAbort===controller)captureAbort=null;
      if(controller.signal.aborted||epoch!==cameraEpoch)return;
      if(await selectImage(captured.poster,sourceKind,()=>!controller.signal.aborted&&epoch===cameraEpoch)===false)return;
      clip=captured;clipUrl=URL.createObjectURL(captured.blob);clipPlayer.src=clipUrl;clipPlayer.hidden=false;q('#photo-image').hidden=true;q('#photo-dimensions').textContent+=' · captured clip / local preview';
    }catch(e){if(!controller.signal.aborted&&epoch===cameraEpoch)error(e.message);}finally{busy=false;if(captureAbort===controller)captureAbort=null;stopCamera();update();}
  }
  async function verifiedDemo(){
    const intent=++revision;
    const response=await fetch('/public/verified-sam-wonder-demo.json',{cache:'no-cache'});if(intent!==revision)return true;if(response.status===404)return false;if(!response.ok)throw Error('Verified demo is unavailable.');
    const value=await response.json();if(value.mode!=='RECORDED_SAM_WONDER_DEMO'||value.sourceKind!=='DEMO_ILLUSTRATION')throw Error('Invalid demo provenance.');
    const [photoResponse,clipResponse]=await Promise.all([fetch('/public/assets/verified-tracking-demo-v1.jpg'),fetch('/public/assets/verified-tracking-demo-v1.mp4')]);
    if(!photoResponse.ok||!clipResponse.ok)throw Error('Verified demo media is unavailable.');
    const photo=await photoResponse.blob(),video=await clipResponse.blob();
    if(hex(await crypto.subtle.digest('SHA-256',await photo.arrayBuffer()))!==value.imageDigest||hex(await crypto.subtle.digest('SHA-256',await video.arrayBuffer()))!==value.videoDigest)throw Error('Verified demo media does not match its assessment.');
    const dataUrl=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(photo);});if(intent!==revision)return true;clearClip();clearResult();
    image={imageDataUrl:dataUrl,imageDigest:value.imageDigest,sourceKind:'DEMO_ILLUSTRATION',...value.dimensions};clip={blob:video};clipUrl=URL.createObjectURL(video);clipPlayer.src=clipUrl;clipPlayer.hidden=false;
    q('#photo-image').hidden=true;q('#photo-empty').hidden=true;q('#photo-image-wrap').style.aspectRatio=`${value.dimensions.width}/${value.dimensions.height}`;q('#photo-image-wrap').classList.add('recorded-media');
    q('#photo-source').textContent='VERIFIED SYNTHETIC DEMO / RECORDED MODEL RESULT';q('#photo-dimensions').textContent=`${value.dimensions.width} × ${value.dimensions.height} · captured-clip playback`;
    q('#photo-target').value=value.target;q('#photo-note').value='Published demo illustration with recorded SAM tracking and Wonder diagnosis. No fresh analysis is performed.';
    result=value;selection=0;fixIndex=0;samOverlay.setResult(value.segmentation);renderAssessment();return true;
  }
  q('#photo-demo-track').addEventListener('click',async()=>{try{stopCamera();error();if(await verifiedDemo())return;const demo=new Image();demo.src='/public/assets/robot-cutaway-v1.png';await demo.decode();await recordClip((ctx,i,w,h)=>{ctx.fillStyle='#11150f';ctx.fillRect(0,0,w,h);ctx.drawImage(demo,Math.sin(i/4)*12,0,w,h);},640,320,'DEMO_ILLUSTRATION');}catch(e){error(e.message);}});
  fallback.addEventListener('click',async()=>{try{stopCamera();error();if(!await verifiedDemo())error('Recorded inspection unavailable. The demo repair job still runs without a scan.');}catch(e){error(e.message);}});
  q('#photo-record').addEventListener('click',async()=>{const video=q('#photo-video');if(!video.videoWidth)return;const scale=Math.min(1,640/Math.max(video.videoWidth,video.videoHeight)),width=Math.floor(video.videoWidth*scale/2)*2,height=Math.floor(video.videoHeight*scale/2)*2;await recordClip((ctx,_,w,h)=>ctx.drawImage(video,0,0,w,h),width,height,'CAMERA_FRAME');});
  q('#photo-camera').addEventListener('click',async()=>{error();try{if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera is unavailable in this browser. Upload a photo or use the demo.');stopCamera();const epoch=cameraEpoch;const nextStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}},audio:false});if(!active||epoch!==cameraEpoch){for(const track of nextStream.getTracks())track.stop();return;}stream=nextStream;q('#photo-video').srcObject=stream;q('#photo-camera-panel').hidden=false;await q('#photo-video').play();update();}catch(e){stopCamera();error(e.name==='NotAllowedError'?'Camera permission was denied. Upload a photo or use the demo instead.':e.message);}});
  q('#photo-capture').addEventListener('click',async()=>{try{const video=q('#photo-video');if(!video.videoWidth)throw Error('Wait for the camera preview before taking a photo.');const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.85));stopCamera();await selectImage(blob,'CAMERA_FRAME');}catch(e){error(e.message);}});
  q('#photo-cancel-camera').addEventListener('click',()=>{captureAbort?.abort();stopCamera();});
  q('#photo-clear').addEventListener('click',()=>{revision++;stopCamera();clearClip();image=null;clearResult();q('#photo-image').removeAttribute('src');q('#photo-image').hidden=true;q('#photo-empty').hidden=false;q('#photo-image-wrap').classList.remove('recorded-media');q('#photo-image-wrap').style.aspectRatio='2/1';q('#photo-source').textContent='NO IMAGE SELECTED';q('#photo-dimensions').textContent='';q('#photo-note').value='';q('#photo-file').value='';});
  for(const field of ['#photo-note','#photo-target'])q(field).addEventListener('input',()=>{clearResult();error();});q('#photo-analyze').addEventListener('click',analyze);
  function changeChoice(){recipeOverride='';assumptionsAck=false;invalidatePhoto();renderAssessment();}
  root.addEventListener('change',event=>{
    if(event.target.id==='photo-component-fix'){fixIndex=Number(event.target.value);changeChoice();}
    if(event.target.id==='photo-recipe-map'){recipeOverride=event.target.value;assumptionsAck=false;invalidatePhoto();renderAssessment();}
    if(event.target.id==='photo-test-assumptions'){assumptionsAck=event.target.checked;const proposal=validateTwinProposals(result.twinProposals||[],result.regions).find(p=>p.regionIndex===selection&&p.fixIndex===fixIndex);q('#photo-run-selected-fix').disabled=!assumptionsAck||!(recipeOverride||proposal?.strategyId);q('[data-photo-open-test]').textContent=q('#photo-run-selected-fix').disabled?'Choose / test this fix ↗':'Test this fix in twin ↗';if(!assumptionsAck)invalidatePhoto();}
  });
  root.addEventListener('click',async event=>{const button=event.target.closest('button');if(button?.hasAttribute('data-photo-open-test')){if(!q('#photo-run-selected-fix').disabled)q('#photo-run-selected-fix').click();else{photoTestControls.scrollIntoView({block:'center'});q('#photo-component-fix')?.focus();}}if(button?.dataset.samId!==undefined)samOverlay.select(button.dataset.samId);if(button?.dataset.photoRegion!==undefined){selection=Number(button.dataset.photoRegion);fixIndex=0;changeChoice();}if(button?.dataset.photoFix!==undefined){fixIndex=Number(button.dataset.photoFix);changeChoice();}if(button?.dataset.testTwinRecipe&&onTestRecipeInTwin)onTestRecipeInTwin(button.dataset.testTwinRecipe);if(button?.id==='photo-run-selected-fix'&&assumptionsAck&&onTestPhotoFixInTwin){const proposal=validateTwinProposals(result.twinProposals||[],result.regions).find(p=>p.regionIndex===selection&&p.fixIndex===fixIndex);try{const epoch=photoEpoch,saved=image;const bytes=Uint8Array.from(atob(saved.imageDataUrl.split(',')[1]),c=>c.charCodeAt(0));if(hex(await crypto.subtle.digest('SHA-256',bytes))!==saved.imageDigest)throw Error('PHOTO_TWIN_PIXELS_MISMATCH');if(epoch!==photoEpoch||image!==saved)throw Error('STALE_PHOTO_TEST');onTestPhotoFixInTwin({image:{...image},result,regionIndex:selection,fixIndex,strategyId:recipeOverride||proposal?.strategyId,origin:recipeOverride?'OPERATOR_HYPOTHESIS':'WONDER_PROPOSAL',revision:photoEpoch});}catch(e){error(e.message);}}});
  const releaseCapture=()=>{captureAbort?.abort();clipPlayer.pause();stopCamera();};
  window.addEventListener('pagehide',releaseCapture);document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseCapture();});
  update();return {setStatus:update,setActive:value=>{active=value;if(!active){captureAbort?.abort();clipPlayer.pause();stopCamera();}}};
}
