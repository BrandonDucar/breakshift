import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root=fileURLToPath(new URL('../',import.meta.url));
test('capture refuses an existing evidence directory before launching a browser',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'breakshift-capture-retention-'));
  try {
    await writeFile(join(dir,'capture-receipt.json'),'retained failed capture');
    const result=spawnSync(process.execPath,['demo/capture.mjs','not-a-provider',dir,'--rehearsal'],{cwd:root,encoding:'utf8'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/EEXIST/);
    assert.equal(await readFile(join(dir,'capture-receipt.json'),'utf8'),'retained failed capture');
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('media verifier refuses to replace an earlier receipt before reading media',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'breakshift-verification-retention-'));
  try {
    await writeFile(join(dir,'media-verification.json'),'retained verification evidence');
    const result=spawnSync(process.execPath,['demo/verify-media.mjs',dir],{cwd:root,encoding:'utf8'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/DEMO_VERIFICATION_EVIDENCE_ALREADY_EXISTS/);
    assert.equal(await readFile(join(dir,'media-verification.json'),'utf8'),'retained verification evidence');
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('renderer refuses an existing output before synthesis or encoding',{skip:process.platform!=='win32'},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'breakshift-render-retention-'));
  try {
    const storySha256=createHash('sha256').update(await readFile(join(root,'demo/story.json'))).digest('hex');
    await writeFile(join(dir,'capture-receipt.json'),JSON.stringify({passed:true,recording:true,storySha256}));
    await writeFile(join(dir,'demo.srt'),'retained caption evidence');
    const result=spawnSync('powershell.exe',['-NoProfile','-File',join(root,'demo/render.ps1'),'-OutputPath',dir],{encoding:'utf8'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/DEMO_RENDER_EVIDENCE_ALREADY_EXISTS/);
    assert.equal(await readFile(join(dir,'demo.srt'),'utf8'),'retained caption evidence');
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('speech timing preserves fractional tempo and emits bounded word timestamps',{skip:process.platform!=='win32'},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'breakshift-narration-'));
  try {
    const script=`$ErrorActionPreference='Stop'
      Add-Type -AssemblyName System.Speech
      Add-Type -Path '${join(root,'demo/Narration.cs').replaceAll("'","''")}' -ReferencedAssemblies System.Speech
      $marks=[DemoNarration]::Synthesize('Simulation evidence is never physical machine clearance.','${join(dir,'voice.wav').replaceAll("'","''")}')
      $tempo=[Math]::Max([double]1,20.045986/15.6)
      if ($tempo -lt 1.28 -or $tempo -gt 1.29) { throw 'FRACTIONAL_TEMPO_LOST' }
      if ($marks.Count -lt 7) { throw 'MISSING_WORD_TIMESTAMPS' }
      if ($marks[-1].Seconds -le $marks[0].Seconds) { throw 'INVALID_WORD_TIMESTAMPS' }
      $duration=[double](& ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 '${join(dir,'voice.wav').replaceAll("'","''")}')
      if ($LASTEXITCODE -ne 0 -or $marks[-1].Seconds -ge $duration) { throw 'SPEECH_CLOCK_MISMATCH' }
      $source=Get-Content -Raw '${join(root,'demo/render.ps1').replaceAll("'","''")}'
      if (-not $source.Contains('[Math]::Max([double]1, $duration / $slot)')) { throw 'RENDERER_TEMPO_REGRESSION' }
      @{tempo=$tempo;words=$marks.Count;lastWordSeconds=$marks[-1].Seconds} | ConvertTo-Json -Compress`;
    const result=spawnSync('powershell.exe',['-NoProfile','-Command',script],{encoding:'utf8',timeout:30000});
    assert.equal(result.status,0,result.stdout+result.stderr);
    const timing=JSON.parse(result.stdout.trim());
    assert.ok(timing.tempo>1.28);assert.ok(timing.words>=7);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
