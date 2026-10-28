import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
import diagnosis from '../.cf-preview/preview-diagnosis.json' with {type:'json'};
import release from '../.cf-preview/release.json' with {type:'json'};
import {createInspectionSessionCore} from '../session/inspection-session-core.mjs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const request=(path,method='GET')=>new Request(`https://preview.example${path}`,{method});
test('public preview cannot start paid scans or mutate server sessions',async()=>{
  for(const path of ['/api/muse/scan','/api/muse/perception-scan','/api/session/mutate','/api/pairing/rotate']){
    const res=await worker.fetch(request(path,'POST'),{});assert.equal(res.status,403);
    assert.match((await res.json()).error,/PUBLIC_PREVIEW|MUSE_/);
  }
  const status=await(await worker.fetch(request('/api/muse/status'),{})).json();
  assert.equal(status.enabled,false);assert.equal(status.mode,'RECORDED_MUSE_PREVIEW');
});

test('public tracking demo is a hash-bound generated-media replay without private transport/billing fields',async()=>{
  const file=release.manifest.find(f=>f.path==='public/verified-sam-wonder-demo.json');if(!file)return;
  const demo=JSON.parse(await readFile(new URL('../public/verified-sam-wonder-demo.json',import.meta.url)));
  assert.equal(demo.mode,'RECORDED_SAM_WONDER_DEMO');assert.equal(demo.sourceKind,'DEMO_ILLUSTRATION');assert.equal(demo.planExecution,'NOT_EXECUTED_PHYSICAL_VERIFICATION_REQUIRED');
  for(const field of ['responseId','usage','scanId','Authorization','API_KEY','budgetUsd'])assert.equal(JSON.stringify(demo).includes(`"${field}"`),false);
  for(const [name,digest] of [['verified-tracking-demo-v1.mp4',demo.videoDigest],['verified-tracking-demo-v1.jpg',demo.imageDigest]])assert.equal(createHash('sha256').update(await readFile(new URL(`../public/assets/${name}`,import.meta.url))).digest('hex'),digest);
});
test('recorded diagnosis is scoped to exact component/snapshot and actual model record',async()=>{
  const state=createInspectionSessionCore().getState();assert.equal(diagnosis.evidenceSnapshotId,state.evidenceSnapshotId);
  const path=`/api/muse/result?zoneId=${diagnosis.zoneId}&snapshotId=${state.evidenceSnapshotId}`;
  const result=(await(await worker.fetch(request(path),{})).json()).result;
  assert.equal(result.cached,true);assert.equal(result.model,'muse-spark-1.3');
  assert.equal(result.fixes.find(f=>f.strategyId==='coordinated_repair').evaluation.packed,8);
  for(const wrong of [path.replace(diagnosis.zoneId,'PANEL-BUS-48V'),path.replace(state.evidenceSnapshotId,'new-snapshot')])assert.equal((await(await worker.fetch(request(wrong),{})).json()).result,null);
});
test('deployment manifest contains browser-only allowlisted files and no provider/billing records',()=>{
  assert.equal(release.manifest.length,release.manifest.some(f=>f.path==='public/verified-sam-wonder-demo.json')?45:42);
  for(const path of ['public/uncertainty-workbench.mjs','public/uncertainty-session.mjs','public/uncertainty-workbench.css','public/verified-uncertainty-patch.json','uncertainty-lab/repair-envelope.mjs','public/robot-asset-catalog.json','public/robot-asset-contract.mjs'])assert.ok(release.manifest.some(file=>file.path===path));
  assert.ok(release.manifest.some(file=>file.path==='public/experiment-replay.mjs'));
  assert.ok(release.manifest.some(file=>file.path==='controller/repair-compiler.mjs'));
  for(const path of ['public/fault-lab.mjs','public/sabotage-command-guard.mjs'])assert.ok(release.manifest.some(file=>file.path===path));
  for(const path of ['public/bay-job.mjs','public/bay-job.css','public/playback-speed.mjs','public/worker-intake.mjs','public/sabotage-console.mjs','public/sabotage-console.css'])assert.ok(release.manifest.some(file=>file.path===path));
  assert.ok(release.manifest.some(file=>file.path==='public/photo-inspection.mjs'));
  for(const file of release.manifest)assert.match(file.path,/^(?:index\.html|style\.css|preview-diagnosis\.json|third-party\/meta-sam-LICENSE\.txt|uncertainty-lab\/repair-envelope\.mjs|(?:public|controller|session|simulator)\/[\w/.-]+)$/);
  const bytes=JSON.stringify(diagnosis);
  for(const key of ['responseId','usage','requestToken','Authorization','API_KEY','budgetUsd'])assert.equal(bytes.includes(`"${key}"`),false);
});
test('asset responses receive preview identity and browser protection headers',async()=>{
  const res=await worker.fetch(request('/'),{ASSETS:{fetch:async()=>new Response('<html>preview</html>',{headers:{'content-type':'text/html'}})}});
  assert.equal(res.headers.get('x-breakshift-release'),release.id);
  assert.match(res.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal(res.headers.get('cache-control'),'no-cache');
});
