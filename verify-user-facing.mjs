import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createReviewPreviewServer } from './preview-review.mjs';
import { parseAndReplayExperiment } from './public/experiment-replay.mjs';

const deployed=process.argv.includes('--verify-deployed-user-facing');
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])).href);
const release=JSON.parse(await readFile(new URL('./.cf-preview/release.json',import.meta.url),'utf8'));
const output=fileURLToPath(new URL(`./artifacts/${deployed?'deployed-':''}user-facing-${Date.now()}/`,import.meta.url));await mkdir(output,{recursive:true});
const server=deployed?null:createReviewPreviewServer();if(server)await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=deployed?'https://breakshift-maintenance-bay.dreamnet-intel.workers.dev':`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const report={release:release.id,url:base,evidence:deployed?'DEPLOYED_PUBLIC_USER_JOURNEYS':'LOCAL_PUBLIC_USER_JOURNEYS',cameraEvidence:'SYNTHETIC_BROWSER_CAMERA_NOT_PHYSICAL_PHONE_HARDWARE',providerCalls:0,unexpectedPosts:0,checks:[],errors:[],buttonCoverage:[]};
try {
  for(const [name,width,height] of [['phone',390,844],['tablet',768,1024],['desktop',1440,1000]]) {
    const context=await browser.newContext({viewport:{width,height},acceptDownloads:true,permissions:['camera']});
    await context.addInitScript(()=>{
      const key=el=>el.id||`${el.closest('[id]')?.id||el.parentElement?.closest('[id]')?.id||el.tagName}/${JSON.stringify({...el.dataset})}${Object.keys(el.dataset).length?'':`/${el.getAttribute('aria-label')||el.textContent.trim().slice(0,70)}`}`;
      window.__buttonAudit={seen:{},clicked:[],key};
      document.addEventListener('click',e=>{const b=e.target.closest('button');if(b)window.__buttonAudit.clicked.push(key(b));},true);
    });
    const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>report.errors.push(`${name}: ${e.message}`));
    await page.route('**/api/**',route=>{if(route.request().method()!=='GET'){report.unexpectedPosts++;return route.abort();}return route.continue();});
    const seen=new Map(),clicked=new Set();
    const scan=async()=>{const value=await page.evaluate(()=>{const a=window.__buttonAudit;for(const el of document.querySelectorAll('button')){if(!el.getClientRects().length)continue;const k=a.key(el),old=a.seen[k];a.seen[k]={label:el.textContent.trim(),everEnabled:Boolean(old?.everEnabled||!el.disabled),disabled:el.disabled};}return {seen:a.seen,clicked:a.clicked};});for(const [k,v]of Object.entries(value.seen))seen.set(k,{...v,everEnabled:Boolean(v.everEnabled||seen.get(k)?.everEnabled)});value.clicked.forEach(k=>clicked.add(k));};
    const reset=async()=>{if(page.url()!=='about:blank')await scan();await page.goto(base);await page.locator('#sync-pill').filter({hasText:'DEVICE-LOCAL'}).waitFor();await scan();};
    const click=async selector=>{await scan();await page.locator(selector).click();};
    const download=async selector=>{const [file]=await Promise.all([page.waitForEvent('download'),click(selector)]);return readFile(await file.path(),'utf8');};
    const setRange=async(selector,value)=>page.locator(selector).evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},value);
    const check=async(label,run)=>{try{await reset();await run();await scan();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);report.checks.push({viewport:name,label,passed:true});}catch(error){report.checks.push({viewport:name,label,passed:false,error:error.message,stack:error.stack});}};

    await check('visual-first entry and five inspection views',async()=>{
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
    await context.close();
  }
  report.passed=report.checks.every(c=>c.passed)&&report.buttonCoverage.every(c=>c.notClickedEnabled.length===0)&&report.unexpectedPosts===0&&report.errors.length===0;if(!report.passed)process.exitCode=1;
} finally {await browser.close();if(server)await new Promise(done=>server.close(done));await writeFile(resolve(output,'receipt.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({output,...report},null,2));
