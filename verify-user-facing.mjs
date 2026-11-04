import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createReviewPreviewServer } from './preview-review.mjs';
import { parseAndReplayExperiment } from './public/experiment-replay.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function parseReleaseSnapshot(bytes) {
  const body = Buffer.from(bytes);
  assert(body.length > 0 && body.length <= 262144, 'RELEASE_SIZE_INVALID');
  const release = JSON.parse(body.toString('utf8'));
  assert(/^live-[a-f0-9]{16}$/.test(release.id), 'RELEASE_ID_INVALID');
  assert(Array.isArray(release.manifest) && release.manifest.length > 0 && release.manifest.length <= 256, 'RELEASE_MANIFEST_INVALID');
  const paths = new Set();
  let totalBytes = 0;
  const manifestPins = release.manifest.map(file => {
    assert(typeof file.path === 'string' && /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*(?:\.[a-zA-Z0-9_-]+)?$/.test(file.path) &&
      file.path.split('/').every(part => part !== '.' && part !== '..') && !paths.has(file.path), 'RELEASE_PATH_INVALID');
    assert(/^[a-f0-9]{64}$/.test(file.sha256), 'RELEASE_ASSET_DIGEST_INVALID');
    assert(Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= 8388608, 'RELEASE_ASSET_SIZE_INVALID');
    paths.add(file.path); totalBytes += file.bytes;
    return { path: file.path, sha256: file.sha256, bytes: file.bytes };
  });
  assert(totalBytes <= 33554432, 'RELEASE_TOTAL_SIZE_INVALID');
  return { release, sha256: sha256(body), bytes: body.length, manifestPins };
}

export function verifyAssetBytes({ snapshot, assetPath, bytes, status = 200, contentRange = null,
  fullBytes, releaseHeader, deployed = false }) {
  const pin = snapshot.manifestPins.find(file => file.path === assetPath);
  assert(pin, `ASSET_NOT_IN_RELEASE:${assetPath}`);
  if (deployed) assert.equal(releaseHeader, snapshot.release.id, `ASSET_RELEASE_HEADER_MISMATCH:${assetPath}`);
  const body = Buffer.from(bytes);
  assert(status === 200 || status === 206, `ASSET_STATUS_INVALID:${assetPath}:${status}`);
  if (status === 206) {
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange || '');
    assert(range, `ASSET_RANGE_INVALID:${assetPath}`);
    const [start, end, total] = range.slice(1).map(Number);
    assert([start, end, total].every(Number.isSafeInteger) && start >= 0 && end >= start && end < total && total === pin.bytes,
      `ASSET_RANGE_INVALID:${assetPath}`);
    assert(fullBytes, `ASSET_RANGE_REFERENCE_MISSING:${assetPath}`);
    const full = Buffer.from(fullBytes);
    assert.equal(full.length, pin.bytes, `ASSET_SIZE_MISMATCH:${assetPath}`);
    assert.equal(sha256(full), pin.sha256, `ASSET_DIGEST_MISMATCH:${assetPath}`);
    assert.equal(body.length, end - start + 1, `ASSET_RANGE_SIZE_MISMATCH:${assetPath}`);
    assert(body.equals(full.subarray(start, end + 1)), `ASSET_RANGE_BYTES_MISMATCH:${assetPath}`);
  } else {
    assert.equal(body.length, pin.bytes, `ASSET_SIZE_MISMATCH:${assetPath}`);
    assert.equal(sha256(body), pin.sha256, `ASSET_DIGEST_MISMATCH:${assetPath}`);
  }
  return { path: assetPath, status, contentRange, responseSha256: sha256(body), responseBytes: body.length,
    manifestSha256: pin.sha256, manifestBytes: pin.bytes, verified: true };
}

export async function readCompletedResponse(response) {
  const completionError = await response.finished();
  if (completionError instanceof Error) return { cancelled: true, reason: completionError.message };
  assert.equal(completionError, null, 'ASSET_COMPLETION_STATUS_INVALID');
  return { cancelled: false, bytes: await response.body() };
}

export function unavailableBodyEvidence({ bytes, pin, browserReadbacks }) {
  if (bytes.length !== 0 || !pin || pin.bytes === 0) return null;
  const witnesses = browserReadbacks.filter(record => record.status === 200 && Number.isSafeInteger(record.bytes) && record.bytes > 0);
  if (!witnesses.length) return null;
  for (const witness of witnesses) {
    assert.equal(witness.bytes, pin.bytes, `BROWSER_FETCH_SIZE_MISMATCH:${pin.path}`);
    assert.equal(witness.sha256, pin.sha256, `BROWSER_FETCH_DIGEST_MISMATCH:${pin.path}`);
  }
  return { reason: 'EMPTY_INSTRUMENTATION_BODY_WITH_NONEMPTY_BROWSER_FETCH', browserReadbacks: witnesses };
}

async function getBytes(url, maxBytes) {
  const response = await fetch(url, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
    signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, `READBACK_HTTP_${response.status}`);
  const chunks = [], reader = response.body.getReader();
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      assert(size <= maxBytes, 'READBACK_SIZE_EXCEEDED');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

async function main() {
const deployed=process.argv.includes('--verify-deployed-user-facing');
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])).href);
const output=fileURLToPath(new URL(`./artifacts/${deployed?'deployed-':''}user-facing-${Date.now()}/`,import.meta.url));await mkdir(output,{recursive:true});
const server=deployed?null:createReviewPreviewServer();if(server)await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=deployed?'https://breakshift-maintenance-bay.dreamnet-intel.workers.dev':`http://127.0.0.1:${server.address().port}`;
let browser, snapshot;
const report={release:null,url:base,evidence:deployed?'DEPLOYED_PUBLIC_USER_JOURNEYS':'LOCAL_PUBLIC_USER_JOURNEYS',cameraEvidence:'SYNTHETIC_BROWSER_CAMERA_NOT_PHYSICAL_PHONE_HARDWARE',providerCalls:0,unexpectedPosts:0,checks:[],errors:[],buttonCoverage:[],passed:false,
  sourceBinding:{baseline:deployed?'DEPLOYED_SAME_ORIGIN_RELEASE':'LOCAL_STAGED_RELEASE',releaseSha256:null,manifestPins:[],capturedAssets:[],cancelledCaptures:[],unavailableBodyCaptures:[],captureStatus:'NOT_COMPLETED',unobservedManifestPaths:[],postReleaseVerified:false,
    scope:'Captured asset bytes checked against the served manifest; not independent publisher authentication or proof that all manifest assets were exercised.'}};
const readSnapshot = async () => parseReleaseSnapshot(deployed ? await getBytes(`${base}/release.json`,262144)
  : await readFile(new URL('./.cf-preview/release.json',import.meta.url)));
const partialReferences = new Map();
const capturesByKey = new Map();
try {
  snapshot = await readSnapshot();
  report.release = snapshot.release.id;
  report.sourceBinding.releaseSha256 = snapshot.sha256;
  report.sourceBinding.manifestPins = snapshot.manifestPins;
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  for(const [name,width,height] of [['phone',390,844],['tablet',768,1024],['desktop',1440,1000]]) {
    const context=await browser.newContext({viewport:{width,height},acceptDownloads:true,permissions:['camera'],serviceWorkers:'block'});
    const pendingCaptures = new Set();
    await context.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      if(request.method()!=='GET'){report.unexpectedPosts++;return route.abort();}
      if(url.origin!==base){report.errors.push(`${name}: EXTERNAL_REQUEST_BLOCKED:${url.origin}`);return route.abort();}
      return route.continue();
    });
    context.on('response',response=>{
      const url=new URL(response.url());
      if(url.origin!==base||url.pathname.startsWith('/api/'))return;
      const task=(async()=>{
        const assetPath=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
        const completed=await readCompletedResponse(response);
        if(completed.cancelled){
          report.sourceBinding.cancelledCaptures.push({viewport:name,path:assetPath,status:response.status(),
            reason:completed.reason,verified:false});
          return;
        }
        const body=completed.bytes;
        if(body.length===0&&response.status()===200){
          const pin=snapshot.manifestPins.find(file=>file.path===assetPath);
          const browserReadbacks=await response.frame().evaluate(async url=>{
            const records=(window.__breakshiftAssetReadbacks||[]).filter(record=>record.url===url);
            await Promise.all(records.map(record=>record.done));
            return records.map(({url,status,bytes,sha256,error})=>({url,status,bytes,sha256,error}));
          },response.url());
          const unavailable=unavailableBodyEvidence({bytes:body,pin,browserReadbacks});
          if(unavailable){
            // A same-URL witness is not exact request correlation, so this event stays unverified.
            report.sourceBinding.unavailableBodyCaptures.push({viewport:name,path:assetPath,status:response.status(),
              ...unavailable,verified:false});
            return;
          }
        }
        if(assetPath==='release.json'){
          assert.equal(sha256(body),snapshot.sha256,'BROWSER_RELEASE_CHANGED');return;
        }
        let fullBytes;
        if(response.status()===206){
          const pin=snapshot.manifestPins.find(file=>file.path===assetPath);
          assert(pin,`ASSET_NOT_IN_RELEASE:${assetPath}`);
          if(!partialReferences.has(assetPath))partialReferences.set(assetPath,getBytes(new URL(assetPath,`${base}/`).href,pin.bytes));
          fullBytes=await partialReferences.get(assetPath);
        }
        const capture=verifyAssetBytes({snapshot,assetPath,bytes:body,status:response.status(),
          contentRange:response.headers()['content-range']||null,releaseHeader:response.headers()['x-breakshift-release'],deployed,fullBytes});
        const key=JSON.stringify([name,capture.path,capture.status,capture.contentRange,capture.responseSha256]);
        const prior=capturesByKey.get(key);
        if(prior)prior.responses++;
        else{const record={viewport:name,...capture,responses:1};capturesByKey.set(key,record);report.sourceBinding.capturedAssets.push(record);}
      })().catch(error=>report.errors.push(`${name}: ${error.message}`));
      pendingCaptures.add(task);task.finally(()=>pendingCaptures.delete(task));
    });
    await context.addInitScript(({sourceOrigin,paths})=>{
      const allowed=new Set(paths),nativeFetch=window.fetch;
      const readbacks=window.__breakshiftAssetReadbacks=[];
      window.fetch=async function(...args){
        const response=await Reflect.apply(nativeFetch,this,args);
        const url=new URL(response.url),path=url.pathname.slice(1);
        if(url.origin===sourceOrigin&&allowed.has(path)){
          const record={url:response.url,status:response.status,bytes:null,sha256:null,error:null};
          record.done=(async()=>{
            try{
              const bytes=await response.clone().arrayBuffer();
              record.bytes=bytes.byteLength;
              record.sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
            }catch(error){record.error=error.message;}
          })();
          readbacks.push(record);
        }
        return response;
      };
      const key=el=>el.id||`${el.closest('[id]')?.id||el.parentElement?.closest('[id]')?.id||el.tagName}/${JSON.stringify({...el.dataset})}${Object.keys(el.dataset).length?'':`/${el.getAttribute('aria-label')||el.textContent.trim().slice(0,70)}`}`;
      window.__buttonAudit={seen:{},clicked:[],key};
      document.addEventListener('click',e=>{const b=e.target.closest('button');if(b)window.__buttonAudit.clicked.push(key(b));},true);
    },{sourceOrigin:base,paths:snapshot.manifestPins.map(pin=>pin.path)});
    const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>report.errors.push(`${name}: ${e.message}`));
    const seen=new Map(),clicked=new Set();
    const scan=async()=>{const value=await page.evaluate(()=>{const a=window.__buttonAudit;for(const el of document.querySelectorAll('button')){if(!el.getClientRects().length)continue;const k=a.key(el),old=a.seen[k];a.seen[k]={label:el.textContent.trim(),everEnabled:Boolean(old?.everEnabled||!el.disabled),disabled:el.disabled};}return {seen:a.seen,clicked:a.clicked};});for(const [k,v]of Object.entries(value.seen))seen.set(k,{...v,everEnabled:Boolean(v.everEnabled||seen.get(k)?.everEnabled)});value.clicked.forEach(k=>clicked.add(k));};
    const reset=async()=>{
      if(page.url()!=='about:blank'){
        await scan();
        while(pendingCaptures.size)await Promise.all([...pendingCaptures]);
      }
      await page.goto(base);await page.locator('#sync-pill').filter({hasText:'DEVICE-LOCAL'}).waitFor();await scan();
    };
    const click=async selector=>{await scan();await page.locator(selector).click();};
    const download=async selector=>{const [file]=await Promise.all([page.waitForEvent('download'),click(selector)]);return readFile(await file.path(),'utf8');};
    const setRange=async(selector,value)=>page.locator(selector).evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},value);
    const check=async(label,run)=>{try{await reset();await run();await scan();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);report.checks.push({viewport:name,label,passed:true});}catch(error){report.checks.push({viewport:name,label,passed:false,error:error.message,stack:error.stack});}};

    await check('visual-first entry and five inspection views',async()=>{
      if(!deployed){assert.match(await page.locator('#public-access-state').textContent(),/OPEN DEMO/);assert.match(await page.locator('.start-job-link').textContent(),/simulated repair job/);}
      assert.match(await page.locator('#mission-version').textContent(),/^v\d+$/);
      const frame=await page.locator('#scene').boundingBox();assert.ok(frame.y<height&&frame.y+frame.height>0,'workcell visual intersects first viewport');
      assert.ok(await page.locator('#workcell-image').evaluate(el=>el.complete&&el.naturalWidth>0));
      assert.ok((await page.locator('#bay-job').boundingBox()).y>frame.y+frame.height);
      await page.screenshot({path:resolve(output,`${name}-first-viewport.png`)});
      for(const view of ['cutaway','schematic','spatial','photo','workcell']){await click(`button[data-view="${view}"]`);assert.equal(await page.locator(`button[data-view="${view}"]`).getAttribute('aria-pressed'),'true');}
      for(const trace of ['repair','challenger','working']){await page.locator('#trace-select').selectOption(trace);assert.match(await page.locator('#scene-mode').textContent(),new RegExp(trace.toUpperCase()));}
      for(const id of ['PANEL-BUS-48V','JBOX-OPT-S1','GANTRY-STA-A','GANTRY-STB-B']){await click(`.component-button[data-zone="${id}"]`);assert.equal(await page.locator('.component-button[aria-pressed=true]').getAttribute('data-zone'),id);}
      const hotspots=await page.locator('#hotspots button').evaluateAll(els=>els.map(el=>el.dataset.zone));
      for(const id of hotspots)await click(`#hotspots [data-zone="${id}"]`);
      await click('#open-schematic');assert.equal(await page.locator('#scene').getAttribute('data-view'),'schematic');
      await click('.start-job-link');assert.equal(new URL(page.url()).hash,'#bay-job');
    });
    await check('layers, energy limits, reference overlays and surface checklist',async()=>{
      for(const layer of ['mechanical','electrical','software','energy']){const el=page.locator(`[data-layer-toggle="${layer}"]`);await el.uncheck();assert.equal(await el.isChecked(),false);await el.check();}
      for(const layer of ['mechanical','electrical','software'])await page.locator(`[data-layer-toggle="${layer}"]`).uncheck();
      await page.locator('[data-layer-toggle="energy"]').click();assert.equal(await page.locator('[data-layer-toggle="energy"]').isChecked(),true);assert.match(await page.locator('#connection-error').textContent(),/at least one/);
      for(const layer of ['mechanical','electrical','software'])await page.locator(`[data-layer-toggle="${layer}"]`).check();
      for(const cap of [1.45,1.65]){await setRange('#cap',cap);await click('#sabotage');assert.match(await page.locator('#run-status').textContent(),cap===1.45?/rejected/:/passed/);}
      await click('#overlay-toggle');await click('#overlay-toggle');
      for(const surface of ['laptop','ipad','glasses','all']){await click(`[data-surface="${surface}"]`);assert.equal(await page.locator(`[data-surface="${surface}"]`).getAttribute('aria-pressed'),'true');}
      await page.locator('#zone-select').selectOption('JBOX-OPT-S1');
      const item=page.locator('#ipad-checklist input').first();await item.check();assert.equal(await item.isChecked(),true);await item.uncheck();
      const snapshot=JSON.parse(await download('#download-receipt'));assert.equal(snapshot.selectedRepairVerified,false);
      await click('#open-spatial');await page.waitForFunction(()=>window.__breakshiftSpatial.sampleNonBlankPixels().nonBackgroundPixels>120);
      for(const preset of ['top','wrist','default']){const prior=await page.evaluate(()=>window.__breakshiftSpatial.getDiagnostics().camera);await click(`[data-cam="${preset}"]`);assert.notDeepEqual(await page.evaluate(()=>window.__breakshiftSpatial.getDiagnostics().camera),prior);}
      const pins=await page.locator('#spatial-pins button').evaluateAll(els=>els.map(el=>el.dataset.zone));for(const id of pins)await click(`#spatial-pins [data-zone="${id}"]`);
      assert.equal(await page.locator('#xr-enter').isDisabled(),true);assert.match(await page.locator('#xr-status').textContent(),/unavailable|unsupported|not supported|preview/i);
    });
    await check('guided job completes with report, replayable evidence and restart',async()=>{
      for(let i=0;i<5;i++)await click('#job-next');assert.equal(await page.locator('#job-next').isDisabled(),true);
      assert.match(await page.locator('#job-freshness').textContent(),/Complete/);
      assert.match(await download('#job-download'),/Compiled plan/);
      assert.equal(parseAndReplayExperiment(await download('#job-save-evidence')).recordedVerdict,'PASS');
      await page.locator('#bay-job').screenshot({path:resolve(output,`${name}-completed-job.png`)});
      await click('#job-restart');assert.equal(await page.locator('#job-next').isEnabled(),true);
      await click('#job-recorded');await page.locator('#photo-first-frame').waitFor();
    });
    await check('recorded component proposals, preview, playback and matching evidence',async()=>{
      await page.locator('#muse-fixes [data-run-fix]').first().waitFor();
      await click('#muse-scan');
      const strategies=await page.locator('#muse-fixes [data-muse-fix]').evaluateAll(els=>els.map(el=>el.dataset.museFix));
      for(const id of strategies){await click(`#muse-fixes [data-muse-fix="${id}"]`);const run=page.locator(`#muse-fixes [data-run-fix="${id}"]`);if(await run.isDisabled())continue;await click(`#muse-annotations [data-run-fix="${id}"]`);await click(`#muse-fixes [data-run-fix="${id}"]`);const evidence=JSON.parse(await download('#experiment-save'));const plan=JSON.parse(await download('#repair-plan-save'));assert.equal(evidence.currentResult.compiledPlan.planDigest,plan.planDigest);parseAndReplayExperiment(JSON.stringify(evidence));}
      await page.locator('#muse-annotations select').selectOption('coordinated_repair');await click('#muse-annotations [data-run-fix]');
      if(await page.locator('#repair-toggle').textContent()==='Pause')await click('#repair-toggle');await click('#repair-toggle');
      await page.locator('#repair-speed').selectOption('2');await setRange('#repair-scrub',300);await click('#repair-finish');assert.match(await page.locator('#repair-verdict').textContent(),/PASS/);
      await click('[data-repair-art="cutaway"]');assert.equal(await page.locator('#repair-stage').getAttribute('data-artwork'),'cutaway');await click('[data-repair-art="workcell"]');
      await click('#repair-toggle');await page.locator('#bay-job').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('#repair-twin').dataset.state==='complete');
      await click('#repair-tighten');await page.locator('#repair-twin[data-state=stale]').waitFor();assert.equal(await page.locator('#repair-plan-save').isDisabled(),true);await click('#repair-recompute');await click('#repair-finish');assert.match(await page.locator('#repair-verdict').textContent(),/FAIL/);
    });
    await check('uncertainty proposal, challenge, stale withdrawal, download and non-mutating replay',async()=>{
      await click('[data-uncertainty-candidate="reference"]');await click('#uncertainty-run');assert.equal(await page.locator('#uncertainty-workspace').getAttribute('data-state'),'refuted');
      await click('[data-uncertainty-candidate="muse"]');assert.equal(await page.locator('#uncertainty-save').isDisabled(),true);
      await click('#uncertainty-run');assert.equal(await page.locator('#uncertainty-workspace').getAttribute('data-state'),'supported');
      assert.match(await page.locator('#uncertainty-rows').textContent(),/2350\.0/);
      assert.equal(await page.locator('#uncertainty-failure').getAttribute('data-state'),'supported');
      assert.equal(await page.locator('#uncertainty-failure').evaluate(el=>getComputedStyle(el).color),'rgb(200, 237, 140)');
      await setRange('#uncertainty-delay',35);await click('#uncertainty-run');
      assert.match(await page.locator('#uncertainty-rows').textContent(),/2345\.0/);assert.match(await page.locator('#uncertainty-plot').textContent(),/2345 ms/);
      await setRange('#uncertainty-delay',40);await click('#uncertainty-run');
      const receipt=await download('#uncertainty-save');assert.equal(JSON.parse(receipt).experiment.model,'breakshift-uncertainty-energy/2');
      const importText=async text=>{const [chooser]=await Promise.all([page.waitForEvent('filechooser'),click('#uncertainty-review')]);await chooser.setFiles({name:'experiment.json',mimeType:'application/json',buffer:Buffer.from(text)});};
      await importText(receipt);await page.locator('#uncertainty-review-result').filter({hasText:'Replay matched'}).waitFor();
      assert.equal(await page.locator('#uncertainty-workspace').getAttribute('data-state'),'supported');
      await importText('null');await page.locator('#uncertainty-review-result').filter({hasText:'Rejected'}).waitFor();
      await importText('x'.repeat(49153));await page.locator('#uncertainty-review-result').filter({hasText:'TOO_LARGE'}).waitFor();
      await setRange('#uncertainty-delay',100);assert.equal(await page.locator('#uncertainty-save').isDisabled(),true);
      await click('#uncertainty-run');assert.equal(await page.locator('#uncertainty-workspace').getAttribute('data-state'),'refuted');
      assert.equal(await page.locator('#uncertainty-failure').getAttribute('data-state'),'refuted');
      await setRange('#uncertainty-delay',40);await setRange('#uncertainty-load',1.13);await setRange('#uncertainty-jitter',16);await click('#uncertainty-run');
      await setRange('#cap',1.45);await page.locator('#uncertainty-workspace[data-state="stale"]').waitFor();assert.equal(await page.locator('#uncertainty-save').isDisabled(),true);
      await click('#uncertainty-run');assert.equal(await page.locator('#uncertainty-workspace').getAttribute('data-state'),'refuted');
      await importText(receipt);await page.locator('#uncertainty-review-result').filter({hasText:'Rejected'}).waitFor();
      const options=await page.locator('#uncertainty-asset option').evaluateAll(els=>els.map(el=>el.value));
      for(const id of options.slice(1)){await page.locator('#uncertainty-asset').selectOption(id);assert.equal(await page.locator('#uncertainty-run').isDisabled(),true);assert.equal(await page.locator('#uncertainty-save').isDisabled(),true);}
      await page.locator('#uncertainty-asset').selectOption(options[0]);await setRange('#cap',1.65);await setRange('#uncertainty-load',1.12);await setRange('#uncertainty-jitter',15);await click('#uncertainty-run');
      await page.locator('#uncertainty-workspace').screenshot({path:resolve(output,`${name}-uncertainty.png`)});
      assert.equal(await page.locator('#uncertainty-workspace').getAttribute('data-state'),'supported');
      await reset();await page.locator('#muse-fixes [data-run-fix="coordinated_repair"]').waitFor();await click('#muse-fixes [data-run-fix="coordinated_repair"]');await click('#repair-open-uncertainty');assert.equal(await page.locator('#uncertainty-run').evaluate(el=>document.activeElement===el),true);
    });
    await check('fault presets, invalid commands, trace toggle and receipt import',async()=>{
      await click('#reasoning-hud-toggle');assert.equal(await page.locator('#reasoning-hud-list').isHidden(),true);await click('#reasoning-hud-toggle');
      const commands=await page.locator('[data-sabotage-cmd]').evaluateAll(els=>els.map(el=>el.dataset.sabotageCmd));for(const cmd of commands)await click(`[data-sabotage-cmd="${cmd}"]`);
      await page.locator('#sabotage-input').fill('drop breaker to 1.45 kW then delete everything');await click('#sabotage-submit');assert.match(await page.locator('#sabotage-status').textContent(),/Unsupported|Unmodeled|ambiguous/i);
      await click('[data-sabotage-cmd="coordinated repair"]');const evidence=await download('#experiment-save');
      const [chooser]=await Promise.all([page.waitForEvent('filechooser'),click('#experiment-review')]);await chooser.setFiles({name:'receipt.json',mimeType:'application/json',buffer:Buffer.from(evidence)});await page.locator('#experiment-replay-result').filter({hasText:'Replay matched'}).waitFor();
      await click('#sabotage-open-twin');assert.equal(await page.locator('#repair-twin').isVisible(),true);
    });
    await check('photo upload, recorded regions, suggestions, tracking and repair handoff',async()=>{
      await click('[data-view="photo"]');await click('#photo-demo');await page.locator('#worker-intake-stages').filter({hasText:'Accepted on this device'}).waitFor();
      assert.equal(await page.locator('#photo-analyze').isDisabled(),true);const intake=JSON.parse(await download('#worker-intake-download'));assert.equal(intake.analysis,'NOT_REQUESTED');
      await click('#photo-recorded-fallback');await page.locator('#photo-first-frame').waitFor();await click('#photo-analyze');await click('#photo-first-frame');
      const regions=await page.locator('#photo-findings [data-photo-region]').evaluateAll(els=>els.map(el=>el.dataset.photoRegion));
      for(const id of regions){await click(`#photo-findings [data-photo-region="${id}"]`);const fixes=await page.locator('[data-photo-fix]').evaluateAll(els=>els.map(el=>el.dataset.photoFix));for(const fix of fixes){await click(`[data-photo-fix="${fix}"]`);assert.equal(await page.locator(`[data-photo-fix="${fix}"]`).getAttribute('aria-pressed'),'true');}}
      const ids=await page.locator('[data-sam-id]').evaluateAll(els=>els.map(el=>el.dataset.samId));for(const id of ids)await click(`[data-sam-id="${id}"]`);
      const pins=await page.locator('#photo-pins [data-photo-region]').evaluateAll(els=>els.map(el=>el.dataset.photoRegion));for(const id of pins)await click(`#photo-pins [data-photo-region="${id}"]`);
      await click('[data-photo-open-test]');assert.equal(await page.locator('#photo-run-selected-fix').isDisabled(),true);
      await page.locator('#photo-recipe-map').selectOption('coordinated_repair');await page.locator('#photo-test-assumptions').check();assert.equal(await page.locator('#photo-run-selected-fix').isEnabled(),true);
      for(const speed of ['0.25','0.5','1','2']){await page.locator('#photo-playback-speed').selectOption(speed);assert.equal(await page.locator('#photo-clip').evaluate(el=>el.playbackRate),Number(speed));}
      await page.locator('#photo-clip').evaluate(async el=>{await el.play();el.currentTime=.5;el.pause();});
      assert.equal((await context.request.get(`${base}/third-party/meta-sam-LICENSE.txt`)).status(),200);
      await click('#photo-run-selected-fix');await page.locator('#repair-stage[data-artwork="photo"]').waitFor();assert.equal(await page.locator('#repair-twin').isVisible(),true);
      for(const art of ['workcell','cutaway','photo'])await click(`[data-repair-art="${art}"]`);
      await click('[data-view="photo"]');await page.locator('#photo-note').fill('Changed observation');assert.equal(await page.locator('#photo-repair-controls').isHidden(),true);await page.locator('#photo-target').fill('gripper');
      await click('#photo-clear');assert.equal(await page.locator('#worker-intake-download').isDisabled(),true);
      await page.locator('#photo-file').setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});await page.locator('#photo-error').filter({hasText:'JPEG'}).waitFor();
      await page.locator('#photo-file').setInputFiles(fileURLToPath(new URL('./public/assets/robot-cutaway-v1.png',import.meta.url)));await page.locator('#worker-intake-stages').filter({hasText:'Accepted on this device'}).waitFor();
      await click('.photo-job-link');assert.equal(new URL(page.url()).hash,'#bay-job');
    });
    await check('synthetic camera capture, local clip and cancellation',async()=>{
      await click('[data-view="photo"]');await click('#photo-camera');await page.waitForFunction(()=>document.querySelector('#photo-video').videoWidth>0);await click('#photo-capture');await page.locator('#worker-intake-stages').filter({hasText:'Accepted on this device'}).waitFor();
      await click('#photo-camera');await page.waitForFunction(()=>document.querySelector('#photo-video').videoWidth>0);await click('#photo-cancel-camera');assert.equal(await page.locator('#photo-camera-panel').isHidden(),true);
      await click('#photo-camera');await page.waitForFunction(()=>document.querySelector('#photo-video').videoWidth>0);await click('#photo-record');await page.locator('#photo-dimensions').filter({hasText:'captured clip'}).waitFor({timeout:15000});assert.equal(await page.locator('#photo-clip').isVisible(),true);assert.equal(await page.locator('#photo-analyze').isDisabled(),true);
      await click('#photo-clear');await click('#photo-demo-track');await page.locator('#photo-first-frame').waitFor();await click('#photo-first-frame');await click('#photo-first-frame');
    });
    await scan();const untested=[...seen].filter(([key,v])=>v.everEnabled&&!clicked.has(key));report.buttonCoverage.push({viewport:name,observedButtons:seen.size,clickedButtons:clicked.size,notClickedEnabled:untested.map(([key,v])=>({key,label:v.label})),disabledOnly:[...seen].filter(([,v])=>!v.everEnabled).map(([key,v])=>({key,label:v.label}))});
    await page.waitForLoadState('networkidle');
    while(pendingCaptures.size)await Promise.all([...pendingCaptures]);
    for(const path of ['index.html','style.css','public/component-bay.js'])assert(report.sourceBinding.capturedAssets.some(asset=>asset.viewport===name&&asset.path===path),`REQUIRED_ASSET_NOT_CAPTURED:${name}:${path}`);
    await context.close();
  }
  report.passed=report.checks.every(c=>c.passed)&&report.buttonCoverage.every(c=>c.notClickedEnabled.length===0)&&report.unexpectedPosts===0&&report.errors.length===0;if(!report.passed)process.exitCode=1;
} catch(error) {
  report.errors.push(error.message);report.passed=false;process.exitCode=1;
} finally {
  if(snapshot){
    try{
      const after=await readSnapshot();
      report.sourceBinding.postReleaseId=after.release.id;
      report.sourceBinding.postReleaseSha256=after.sha256;
      assert.equal(after.sha256,snapshot.sha256,'RELEASE_CHANGED_DURING_VERIFICATION');
      assert.equal(after.release.id,snapshot.release.id,'RELEASE_ID_CHANGED_DURING_VERIFICATION');
      report.sourceBinding.postReleaseVerified=true;
    }catch(error){report.errors.push(error.message);report.passed=false;process.exitCode=1;}
    const observed=new Set(report.sourceBinding.capturedAssets.map(asset=>asset.path));
    report.sourceBinding.unobservedManifestPaths=snapshot.manifestPins.filter(pin=>!observed.has(pin.path)).map(pin=>pin.path);
  }
  if(report.errors.length||!report.sourceBinding.postReleaseVerified){report.passed=false;process.exitCode=1;}
  report.behaviorPassed=report.checks.length===24&&report.checks.every(check=>check.passed)&&
    report.buttonCoverage.length===3&&report.buttonCoverage.every(coverage=>coverage.notClickedEnabled.length===0)&&report.unexpectedPosts===0;
  const partial=report.sourceBinding.unavailableBodyCaptures.length>0||report.sourceBinding.cancelledCaptures.length>0;
  report.sourceBinding.captureStatus=report.errors.length||!report.sourceBinding.postReleaseVerified?'FAILED':partial?'PARTIAL_CAPTURE':'OBSERVED_RESPONSES_VERIFIED';
  if(partial){report.passed=false;process.exitCode=1;}
  await browser?.close();if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}
  await writeFile(resolve(output,'receipt.json'),JSON.stringify(report,null,2));
}
console.log(JSON.stringify({output,...report},null,2));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
