import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const output=resolve(process.argv[2]||'.local/demo-draft');
const file=resolve(output,'breakshift-demo-draft.mp4');
const story=JSON.parse(await readFile(new URL('./story.json',import.meta.url)));
const capture=JSON.parse(await readFile(resolve(output,'capture-receipt.json')));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
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
  const result=run('ffmpeg',['-v','error','-ss',String((shot.start+shot.end)/2),'-i',file,'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','-'],null);
  assert.equal(result.stdout.length,3);const rgb=[...result.stdout];
  assert.ok(rgb.some(v=>v>6),'Blank frame');assert.ok(rgb.some(v=>v<245),'Blank white frame');
  samples.push({shot:shot.id,timeSeconds:(shot.start+shot.end)/2,averageRgb:rgb});
}
const volume=run('ffmpeg',['-hide_banner','-i',file,'-vn','-af','volumedetect','-f','null','-']).stderr;
const mean=Number(volume.match(/mean_volume: ([-\d.]+)/)?.[1]);
const peak=Number(volume.match(/max_volume: ([-\d.]+)/)?.[1]);
assert.ok(Number.isFinite(mean)&&mean>-45);assert.ok(Number.isFinite(peak)&&peak>-20&&peak<=0);
const captions=await readFile(resolve(output,'demo.srt'),'utf8');
assert.ok(captions.split('-->').length>20);
const assets=[];
for(const name of ['breakshift-demo-draft.mp4','demo.srt','capture-receipt.json','offline-tests.tap','uncertainty-experiment.json','energy-comparison.json']){
  const bytes=await readFile(resolve(output,name));assets.push({name,bytes:bytes.length,sha256:digest(bytes)});
}
const receipt={schema:'breakshift.demo-media-verification.v1',passed:true,
  evidence:'LOCAL_MEDIA_DECODE_DIMENSION_DURATION_PIXEL_AND_AUDIO_LEVEL_CHECKS',
  independentReview:'PENDING',humanListeningReview:'PENDING',hostedVideoUrl:null,
  durationSeconds:Number(probe.format.duration),videoDurationSeconds:Number(video[0].duration),
  audioDurationSeconds:Number(audio[0].duration),width:1920,height:1080,volume:{meanDb:mean,peakDb:peak},
  frameSamples:samples,artifacts:assets,providerCalls:0,incrementalSpendUsd:0,
  paidAllowanceModified:false,teachingRuntimeContacted:false,productionChanged:false};
receipt.tooling=[];
for(const name of ['capture.mjs','render.ps1','story.json','verify-media.mjs']) {
  receipt.tooling.push({name:`demo/${name}`,sha256:digest(await readFile(new URL(`./${name}`,import.meta.url)))});
}
await writeFile(resolve(output,'media-verification.json'),JSON.stringify(receipt,null,2));
console.log(JSON.stringify(receipt,null,2));
