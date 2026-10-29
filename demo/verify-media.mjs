import assert from 'node:assert/strict';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { inspectFramePixels } from './frame-quality.mjs';

const output=resolve(process.argv[2]||'.local/demo-draft');
const verificationPath=resolve(output,'media-verification.json');
await lstat(verificationPath).then(()=>{throw Error('DEMO_VERIFICATION_EVIDENCE_ALREADY_EXISTS');},error=>{if(error.code!=='ENOENT')throw error;});
const file=resolve(output,'breakshift-demo-draft.mp4');
const story=JSON.parse(await readFile(new URL('./story.json',import.meta.url)));
const capture=JSON.parse(await readFile(resolve(output,'capture-receipt.json')));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const render=JSON.parse(await readFile(resolve(output,'render-receipt.json')));
assert.equal(render.schema,'breakshift.demo-render.v1');assert.equal(render.passed,true);
assert.equal(render.inputPolicy,'LOCAL_BOUND_SOURCE_AND_CAPTURE_TREE_REQUIRED');
assert.equal(render.outputSha256,digest(await readFile(file)));
for(const pin of render.inputs)assert.equal(digest(await readFile(pin.path)),pin.sha256,`Render input changed: ${pin.path}`);
function run(cmd,args,encoding='utf8'){
  const result=spawnSync(cmd,args,{encoding,maxBuffer:8000000,timeout:120000});
  assert.equal(result.status,0,`${cmd}: ${result.stderr}`);return result;
}
const probe=JSON.parse(run('ffprobe',['-v','error','-show_format','-show_streams','-of','json',file]).stdout);
const video=probe.streams.filter(s=>s.codec_type==='video');
const audio=probe.streams.filter(s=>s.codec_type==='audio');
assert.equal(video.length,1);assert.equal(audio.length,1);
assert.equal(video[0].width,1920);assert.equal(video[0].height,1080);
for(const stream of [video[0],audio[0]])assert.ok(Math.abs(Number(stream.duration)-story.durationSeconds)<.15,'Each stream must cover the full timeline');
assert.ok(Number(probe.format.duration)<=180);
assert.ok(capture.passed&&capture.recording&&capture.checks.length===story.shots.length);
assert.equal(capture.providerCalls,0);assert.equal(capture.blockedRequests.length,0);
assert.equal(digest(await readFile(new URL('./story.json',import.meta.url))),capture.storySha256);
run('ffmpeg',['-v','error','-i',file,'-f','null','-']);
const samples=[];
for(const shot of story.shots){
  for(const timeSeconds of [shot.start+.8,(shot.start+shot.end)/2,shot.end-.8]){
    const result=run('ffmpeg',['-v','error','-ss',String(timeSeconds),'-i',file,'-frames:v','1','-vf','scale=64:36','-f','rawvideo','-pix_fmt','rgb24','-'],null);
    samples.push({shot:shot.id,timeSeconds,...inspectFramePixels(result.stdout)});
  }
}
const volume=run('ffmpeg',['-hide_banner','-i',file,'-vn','-af','volumedetect','-f','null','-']).stderr;
const mean=Number(volume.match(/mean_volume: ([-\d.]+)/)?.[1]);
const peak=Number(volume.match(/max_volume: ([-\d.]+)/)?.[1]);
assert.ok(Number.isFinite(mean)&&mean>-45);assert.ok(Number.isFinite(peak)&&peak>-20&&peak<=0);
const captions=await readFile(resolve(output,'demo.srt'),'utf8');
assert.ok(captions.split('-->').length>20);
const timing=JSON.parse(await readFile(resolve(output,'narration-timing.json')));
assert.equal(timing.length,story.shots.length);
const narration=[];
for(const shot of story.shots){
  const row=timing.find(t=>t.shot===shot.id);assert.ok(row);
  assert.equal(row.start,shot.start);assert.equal(row.end,shot.end);
  assert.ok(row.tempo>=1&&row.tempo<=1.3);
  const slot=shot.end-shot.start-.4;
  const processed=run('ffmpeg',['-hide_banner','-i',resolve(output,`${shot.id}.wav`),'-af',`atempo=${row.tempo.toFixed(6)},ashowinfo`,'-f','null','-']).stderr;
  const samples=[...processed.matchAll(/nb_samples:(\d+)/g)].reduce((sum,m)=>sum+Number(m[1]),0);
  const actualDuration=samples/16000;
  assert.ok(actualDuration>0&&actualDuration<=slot+.05,`Narration overrun: ${shot.id}`);
  assert.ok(row.wordMarks.at(-1).Seconds/row.tempo<actualDuration,'Last narration word truncated');
  narration.push({shot:shot.id,actualDuration,chapterSeconds:shot.end-shot.start,lastWordSeconds:row.wordMarks.at(-1).Seconds/row.tempo});
}
const time=s=>s.split(':').reduce((n,p)=>n*60+Number(p.replace(',','.')),0);
let previousEnd=0;const captionText=[];
for(const block of captions.trim().split(/\r?\n\r?\n/)){
  const [,span,...lines]=block.split(/\r?\n/);const [start,end]=span.split(' --> ').map(time);
  assert.ok(start>=previousEnd-.002&&end>start&&end<=story.durationSeconds);previousEnd=end;
  captionText.push(lines.join(' '));
}
assert.equal(captionText.join(' '),story.shots.map(s=>s.narration).join(' '),'Caption words missing');
const assets=[];
for(const name of ['breakshift-demo-draft.mp4','demo.srt','capture-receipt.json','offline-tests.tap','uncertainty-experiment.json','energy-comparison.json','render-receipt.json','narration-timing.json','filter-graph.txt']){
  const bytes=await readFile(resolve(output,name));assets.push({name,bytes:bytes.length,sha256:digest(bytes)});
}
const receipt={schema:'breakshift.demo-media-verification.v1',passed:true,
  evidence:'LOCAL_MEDIA_DECODE_DIMENSION_DURATION_PIXEL_AND_AUDIO_LEVEL_CHECKS',
  independentReview:'PENDING',humanListeningReview:'PENDING',hostedVideoUrl:null,
  durationSeconds:Number(probe.format.duration),videoDurationSeconds:Number(video[0].duration),
  audioDurationSeconds:Number(audio[0].duration),width:1920,height:1080,volume:{meanDb:mean,peakDb:peak},
  frameSamples:samples,artifacts:assets,providerCalls:0,incrementalSpendUsd:0,
  narrationChecks:narration,
  paidAllowanceModified:false,teachingRuntimeContacted:false,productionChanged:false};
receipt.tooling=[];
for(const name of ['capture.mjs','render.ps1','story.json','verify-media.mjs','Narration.cs','frame-quality.mjs','narration-timing.ps1']) {
  receipt.tooling.push({name:`demo/${name}`,sha256:digest(await readFile(new URL(`./${name}`,import.meta.url)))});
}
await writeFile(verificationPath,JSON.stringify(receipt,null,2),{flag:'wx'});
console.log(JSON.stringify(receipt,null,2));
