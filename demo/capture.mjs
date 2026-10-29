import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReviewPreviewServer } from '../preview-review.mjs';
import { DEFAULT_CONTEXT } from '../uncertainty-lab/repair-envelope.mjs';
import { createEnergyComparison } from '../energy-lab/energy-comparison.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const story = JSON.parse(await readFile(new URL('./story.json', import.meta.url)));
const output = resolve(process.argv[3] || resolve(root, '.local/demo-draft'));
const quick = process.argv.includes('--rehearsal');
assert.ok(process.argv[2], 'Pass the absolute path to an existing Playwright index.mjs');
await mkdir(output, {recursive:true});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const receipt = {schema:'breakshift.demo-capture.v1',mode:story.mode,recording:!quick,
  providerCalls:0,incrementalSpendUsd:0,productionChanged:false,teachingRuntimeContacted:false,
  checks:[],errors:[],blockedRequests:[],sourceCommit:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim()};
const build = spawnSync(process.execPath,['cloudflare/build-preview.mjs'],{cwd:root,encoding:'utf8'});
assert.equal(build.status,0,build.stderr);
const release = JSON.parse(await readFile(resolve(root,'.cf-preview/release.json')));
receipt.release = release.id;
const tests = spawnSync(process.execPath,['test-offline.mjs'],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:4000000});
await writeFile(resolve(output,'offline-tests.tap'),tests.stdout+tests.stderr);
assert.equal(tests.status,0,'Offline tests must pass before recording');
receipt.testOutputSha256 = hash(tests.stdout+tests.stderr);
receipt.testSummary = tests.stdout.split('\n').filter(s=>/^# (tests|pass|fail|duration_ms) /.test(s));
const energy = createEnergyComparison({armPowerScale:.85,beltSpeedMps:.4,surgeGapMs:200,timingCompensationMs:20},DEFAULT_CONTEXT,
  {loadMultiplier:1,sensorDelayMs:0,jitterAMs:0,jitterBMs:0});
assert.ok(energy.difference.peakReductionW>226 && energy.difference.batchEnergyChangeWh>0);
await writeFile(resolve(output,'energy-comparison.json'),JSON.stringify(energy,null,2));
const server = createReviewPreviewServer();
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base = `http://127.0.0.1:${server.address().port}`;
const {chromium} = await import(pathToFileURL(resolve(process.argv[2])).href);
let browser, context, video;
const hold = async ms => {if(!quick)await new Promise(done=>setTimeout(done,ms));};
try {
  browser = await chromium.launch({channel:'msedge',headless:true});
  context = await browser.newContext({viewport:{width:1920,height:1080},acceptDownloads:true,
    ...(quick?{}:{recordVideo:{dir:resolve(output,'raw'),size:{width:1920,height:1080}}})});
  const videoStarted = performance.now();
  const page = await context.newPage(); video = page.video(); page.setDefaultTimeout(15000);
  page.on('pageerror',error=>receipt.errors.push(error.message));
  await context.route('**/*',route=>{
    const url = new URL(route.request().url());
    if(['data:','blob:'].includes(url.protocol))return route.continue();
    if(url.origin!==base || !['GET','HEAD'].includes(route.request().method())) {
      receipt.blockedRequests.push({origin:url.origin,method:route.request().method()});return route.abort();
    }
    return route.continue();
  });
  const click = async selector => {const el=page.locator(selector).first();await el.scrollIntoViewIfNeeded();await el.click();};
  const frame = async selector => page.locator(selector).evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
  const range = async (selector,value) => page.locator(selector).evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));},value);
  const stage = (title,body) => `<!doctype html><html><head><style>body{margin:0;background:#101210;color:#eee;font:24px Arial;padding:65px 100px;letter-spacing:0}h1{font-size:44px;color:#dbfa86}h2{font-size:32px}pre{font:21px Consolas;white-space:pre-wrap}p{line-height:1.55}table{border-collapse:collapse;width:100%;margin:35px 0}th,td{text-align:left;padding:18px;border-bottom:1px solid #454b42}small{color:#c4c9c1}a{color:#79c9ce}</style></head><body><small>BREAKSHIFT / LOCAL EVIDENCE READBACK / NO PROVIDER CALLS</small><h1>${escape(title)}</h1>${body}</body></html>`;
  await page.goto(base);
  await page.locator('#sync-pill').filter({hasText:'DEVICE-LOCAL'}).waitFor();
  await page.locator('#workcell-image').evaluate(img=>img.decode());
  await page.evaluate(()=>window.scrollTo(0,0));
  receipt.startVideoSeconds = (performance.now()-videoStarted)/1000;
  const started = performance.now();
  let savedReceipt;
  for(const shot of story.shots) {
    await hold(Math.max(0,shot.start*1000-(performance.now()-started)));
    const start = performance.now()-started;
    if(shot.id==='workcell') {
      assert.equal(await page.locator('#cap').inputValue(),'1.65');
      assert.ok(await page.locator('#workcell-image').evaluate(img=>img.naturalWidth>0));
    } else if(shot.id==='perception') {
      await click('[data-view="photo"]');await click('#photo-demo-track');
      await page.locator('#photo-first-frame').waitFor();await frame('#photo-clip');
      await page.locator('#photo-clip').evaluate(async el=>{el.muted=true;el.loop=true;await el.play();});
      await hold(7000);await click('#photo-first-frame');await frame('#photo-first-frame');
    } else if(shot.id==='repair') {
      await click('[data-view="workcell"]');
      await page.locator('#muse-fixes [data-run-fix="coordinated_repair"]').waitFor();
      await click('#muse-fixes [data-run-fix="coordinated_repair"]');await frame('#repair-twin');
      await hold(4000);await click('#repair-finish');await frame('#repair-twin');
    } else if(shot.id==='baseline') {
      await click('[data-uncertainty-candidate="reference"]');await click('#uncertainty-run');await frame('#uncertainty-workspace');
      assert.equal(await page.locator('#uncertainty-workspace').getAttribute('data-state'),'refuted');
      assert.match(await page.locator('#uncertainty-rows').textContent(),/1722\.5/);
    } else if(shot.id==='patch') {
      await click('[data-uncertainty-candidate="muse"]');await click('#uncertainty-run');await frame('#uncertainty-workspace');
      assert.equal(await page.locator('#uncertainty-workspace').getAttribute('data-state'),'supported');
      assert.match(await page.locator('#uncertainty-rows').textContent(),/1470\.8/);
      assert.match(await page.locator('#uncertainty-cases').textContent(),/16\/16/);
    } else if(shot.id==='stale') {
      await range('#uncertainty-delay',100);assert.equal(await page.locator('#uncertainty-workspace').getAttribute('data-state'),'stale');
      assert.equal(await page.locator('#uncertainty-save').isDisabled(),true);await frame('#uncertainty-workspace');
      await hold(6500);await click('#uncertainty-run');
      assert.equal(await page.locator('#uncertainty-workspace').getAttribute('data-state'),'refuted');
      await hold(4500);await range('#uncertainty-delay',40);await click('#uncertainty-run');await frame('#uncertainty-workspace');
    } else if(shot.id==='receipt') {
      const [download] = await Promise.all([page.waitForEvent('download'),click('#uncertainty-save')]);
      savedReceipt = resolve(output,'uncertainty-experiment.json');await download.saveAs(savedReceipt);
      const before=await page.locator('#uncertainty-workspace').getAttribute('data-state');
      await page.locator('#uncertainty-file').setInputFiles(savedReceipt);
      await page.locator('#uncertainty-review-result').filter({hasText:'Replay matched'}).waitFor();
      assert.equal(await page.locator('#uncertainty-workspace').getAttribute('data-state'),before);await frame('#uncertainty-workspace');
    } else if(shot.id==='energy') {
      const a=energy.reference.metrics,b=energy.proposed.metrics;
      await page.setContent(stage('Lower peak. Higher batch energy.',`<p>Computed by the repository's actual <code>energy-comparison.mjs</code>.<br>Same declared nominal disturbance; full batch horizon.</p><table><tr><th>Modeled quantity</th><th>Reference</th><th>Muse proposal</th></tr><tr><td>Peak power</td><td>${a.peakW.toFixed(1)} W</td><td>${b.peakW.toFixed(1)} W</td></tr><tr><td>Batch energy</td><td>${a.energyWh.toFixed(4)} Wh</td><td>${b.energyWh.toFixed(4)} Wh</td></tr><tr><td>Batch duration</td><td>${a.windowMs} ms</td><td>${b.windowMs} ms</td></tr></table><p>No utility-bill savings claim. No calibrated motor model.<br>No physical energy measurements or machine clearance.</p><small>Receipt SHA-256: ${energy.receiptDigest}</small>`));
    } else if(shot.id==='proof') {
      await page.setContent(stage('Reproduce it. Challenge it.',`<h2>Actual local offline test output</h2><pre>${escape(receipt.testSummary.join('\n'))}</pre><p>Node 22.12+ / npm test / no dependencies / no API keys</p><p>Public source: github.com/BrandonDucar/breakshift<br>Live app: breakshift-maintenance-bay.dreamnet-intel.workers.dev</p><p>Apache-2.0. Recorded model outputs. Fictional workcell.<br>Simulation evidence is not physical machine clearance.</p><small>Source commit: ${escape(receipt.sourceCommit)}<br>Release reproduced: ${escape(release.id)}</small>`));
    }
    await page.screenshot({path:resolve(output,`${shot.id}.png`)});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal clipping');
    receipt.checks.push({id:shot.id,passed:true,startSeconds:start/1000,actionsCompleteSeconds:(performance.now()-started)/1000});
    if(!quick)assert.ok(performance.now()-started < shot.end*1000,`Shot overrun: ${shot.id}`);
  }
  await hold(Math.max(0,story.durationSeconds*1000-(performance.now()-started)));
  assert.equal(receipt.errors.length,0,JSON.stringify(receipt.errors));
  assert.equal(receipt.blockedRequests.length,0,JSON.stringify(receipt.blockedRequests));
  receipt.passed=true;
} catch(error) {
  receipt.passed=false;receipt.errors.push(error.stack);process.exitCode=1;
} finally {
  if(context)await context.close();
  if(video)receipt.rawVideoPath=await video.path();
  if(browser)await browser.close();
  await new Promise(done=>server.close(done));
  if(video)receipt.rawVideoSha256=hash(await readFile(receipt.rawVideoPath));
  receipt.storySha256=hash(await readFile(new URL('./story.json',import.meta.url)));
  await writeFile(resolve(output,'capture-receipt.json'),JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({output,...receipt}));
}
