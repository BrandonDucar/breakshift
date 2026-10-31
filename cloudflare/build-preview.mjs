import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const root = fileURLToPath(new URL('../',import.meta.url));
const target = join(root,'.cf-preview');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = [
  ['public/index.html','index.html'], ['public/style.css','style.css'],['public/sam-tracking.css','public/sam-tracking.css'],['public/visual-system.css','public/visual-system.css'],['public/visual-assets.mjs','public/visual-assets.mjs'],
  ...['component-bay.js','component-model.mjs','bay-job.mjs','spatial-xr.mjs','repair-twin-player.mjs','photo-inspection.mjs','camera-clip.mjs','sam-overlay.mjs','photo-repair-bridge.mjs'].map(name=>[`public/${name}`,`public/${name}`]),
  ['cloudflare/vendor/meta-sam-parser/LICENSE','third-party/meta-sam-LICENSE.txt'],
  ['public/bay-job.css','public/bay-job.css'],
  ['public/sabotage-console.css','public/sabotage-console.css'],
  ...['playback-speed.mjs','worker-intake.mjs','sabotage-console.mjs'].map(name=>[`public/${name}`,`public/${name}`]),
  ...['fault-lab.mjs','sabotage-command-guard.mjs','experiment-replay.mjs'].map(name=>[`public/${name}`,`public/${name}`]),
  ...['uncertainty-workbench.mjs','uncertainty-session.mjs','uncertainty-workbench.css','verified-uncertainty-patch.json'].map(name=>[`public/${name}`,`public/${name}`]),
  ['uncertainty-lab/repair-envelope.mjs','uncertainty-lab/repair-envelope.mjs'],
  ...['robot-asset-catalog.json','robot-asset-contract.mjs'].map(name=>[`public/${name}`,`public/${name}`]),
  ...['breakshift-microgrid-hero-v1.png','robot-cutaway-v1.png'].map(name=>[`public/assets/${name}`,`public/assets/${name}`]),
  ['session/inspection-session-core.mjs','session/inspection-session-core.mjs'],
  ...['kinematics-timing','planner','power-governor','telemetry-api','repair-compiler'].map(name=>[`controller/${name}.mjs`,`controller/${name}.mjs`]),
  ...['workcell','scenarios','repair-run'].map(name=>[`simulator/${name}.mjs`,`simulator/${name}.mjs`]),
];
try{
  const demo=JSON.parse(await readFile(join(root,'public/verified-sam-wonder-demo.json')));
  if(demo.mode!=='RECORDED_SAM_WONDER_DEMO'||demo.sourceKind!=='DEMO_ILLUSTRATION'||demo.model!=='muse-wonder-1.0'||demo.segmentation?.model!=='sam-3.1'||['usage','responseId','scanId','requestToken','Authorization'].some(k=>JSON.stringify(demo).includes(`"${k}"`)))throw Error('DEMO_PUBLIC_PROJECTION_REJECTED');
  for(const [name,digest] of [['verified-tracking-demo-v1.mp4',demo.videoDigest],['verified-tracking-demo-v1.jpg',demo.imageDigest]])if(hash(await readFile(join(root,'public/assets',name)))!==digest)throw Error('DEMO_MEDIA_BINDING_REJECTED');
  files.push(['public/verified-sam-wonder-demo.json','public/verified-sam-wonder-demo.json'],...['verified-tracking-demo-v1.mp4','verified-tracking-demo-v1.jpg'].map(name=>[`public/assets/${name}`,`public/assets/${name}`]));
}catch(error){if(error.code!=='ENOENT')throw error;}
await mkdir(target,{recursive:true});
const uncertainty=JSON.parse(await readFile(join(root,'public/verified-uncertainty-patch.json'),'utf8'));
const retainedUncertainty=await readFile(join(root,'artifacts/uncertainty-repair-20261028/2026-10-28T04-17-38-760Z/muse-trial-1.json'));
if(hash(retainedUncertainty)!==uncertainty.sourceArtifactSha256||uncertainty.mode!=='RECORDED_PROVIDER_PATCH'||uncertainty.physicalClearance!==false||uncertainty.executionAuthority!==false)throw Error('UNCERTAINTY_SOURCE_PROJECTION_REJECTED');
const evaluatedUncertainty=JSON.parse(retainedUncertainty);
if(JSON.stringify(evaluatedUncertainty.candidate)!==JSON.stringify(uncertainty.candidate)||evaluatedUncertainty.experiment.plan.planDigest!==uncertainty.recordedPlanDigest||!evaluatedUncertainty.accepted)throw Error('UNCERTAINTY_SOURCE_PROJECTION_REJECTED');
const allowed = new Set([...files.map(([,path])=>path),'preview-diagnosis.json','release.json']);
async function inspect(folder,prefix='') {
  for(const entry of await readdir(folder,{withFileTypes:true})) {
    if(entry.isSymbolicLink()) throw new Error('PREVIEW_SYMLINK_REJECTED');
    const path = `${prefix}${entry.name}`;
    if(entry.isDirectory()) await inspect(join(folder,entry.name),`${path}/`);
    else if(!allowed.has(path)) throw new Error(`UNEXPECTED_PREVIEW_FILE:${path}`);
  }
}
await inspect(target);
const manifest=[];
for(const [source,path] of files) {
  let bytes=await readFile(join(root,source));
  if(path==='index.html') {
    const html=bytes.toString();
    if(!html.includes('</header>')||!html.includes('</head><body>'))throw new Error('PREVIEW_HTML_BINDING_CHANGED');
    bytes=Buffer.from(html.replace('</head><body>','</head><body data-preview="live">').replace('</header>','</header><div class="public-access-banner"><strong id="public-access-state">OPEN DEMO · NO SIGN-IN REQUIRED</strong><a class="start-job-link" href="#bay-job">Start simulated repair job ↗</a></div>').replace('<section id="muse-panel"','<section class="tester-access" aria-label="Model access"><p id="tester-access-status" class="scope-note" role="status">Checking model availability…</p><form id="tester-access-form" hidden><label>Operator access<input id="tester-access-code" type="password" autocomplete="off" maxlength="64" aria-label="Private operator access code"></label><button type="submit">Unlock operator access</button></form></section><section id="muse-panel"'));
  }
  await mkdir(dirname(join(target,path)),{recursive:true});await writeFile(join(target,path),bytes);
  manifest.push({source,path,sha256:hash(bytes),bytes:bytes.length});
}
const original=JSON.parse(await readFile(join(root,'artifacts/muse-bay-20261026/live-scan-78d620ae-072e-4d50-9725-cf7ce1458ff8.json'),'utf8'));
if(original.mode!=='LIVE_MUSE'||original.stale||original.model!=='muse-spark-1.3')throw new Error('VERIFIED_MUSE_RECORD_REQUIRED');
// Project only the public workcell demonstration, not financial/transport data.
const {schema,scanId,model,createdAt,elapsedMs,zoneId,evidenceSnapshotId,sourceDigest,summary,evidenceIds,limitations,fixes}=original;
const publicDiagnosis={schema,scanId,model,mode:'RECORDED_MUSE_PREVIEW',createdAt,elapsedMs,zoneId,evidenceSnapshotId,sourceDigest,summary,evidenceIds,limitations,fixes,cached:true,stale:false};
const bytes=Buffer.from(JSON.stringify(publicDiagnosis));await writeFile(join(target,'preview-diagnosis.json'),bytes);
manifest.push({source:'verified-public-diagnosis-projection',path:'preview-diagnosis.json',sha256:hash(bytes),bytes:bytes.length});
const workerSha256=hash(await readFile(join(root,'cloudflare/worker.mjs')));
const vendorSources=(await readdir(join(root,'cloudflare/vendor/meta-sam-parser/dist'))).filter(name=>name.endsWith('.js')).map(name=>`cloudflare/vendor/meta-sam-parser/dist/${name}`);
const workerSources=await Promise.all(['cloudflare/live-muse.mjs','session/muse-diagnosis-contract.mjs','cloudflare/photo-contract.mjs','cloudflare/sam-wonder.mjs','cloudflare/bounded-mp4.mjs','public/photo-repair-bridge.mjs',...vendorSources].map(async path=>({path,sha256:hash(await readFile(join(root,path)))})));
const componentPaths=['controller/kinematics-timing.mjs','controller/planner.mjs','controller/power-governor.mjs','controller/telemetry-api.mjs','simulator/workcell.mjs','simulator/scenarios.mjs','session/inspection-session-core.mjs','session/muse-diagnosis-contract.mjs','public/component-model.mjs'];
const componentSourceDigest=hash(JSON.stringify(await Promise.all(componentPaths.map(async path=>({path,sha256:hash(await readFile(join(root,path)))})))));
const photoSourceDigest=hash(await readFile(join(root,'cloudflare/photo-contract.mjs')));
const perceptionSourceDigest=hash(JSON.stringify(workerSources.filter(x=>x.path.includes('sam-wonder')||x.path.includes('bounded-mp4')||x.path.includes('photo-repair-bridge')||x.path.includes('/vendor/'))));
const id=`live-${hash(JSON.stringify({manifest,workerSha256,workerSources})).slice(0,16)}`;
const release={id,builtAt:new Date().toISOString(),mode:'PROTECTED_LIVE_MUSE',workerSha256,workerSources,componentSourceDigest,photoSourceDigest,perceptionSourceDigest,manifest};
await writeFile(join(target,'release.json'),JSON.stringify(release,null,2));
console.log(JSON.stringify({id,files:manifest.length,totalBytes:manifest.reduce((sum,file)=>sum+file.bytes,0),assetDirectory:target}));
