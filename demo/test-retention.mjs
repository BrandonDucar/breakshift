import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

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
test('renderer refuses an existing output before synthesis or encoding',{skip:process.platform!=='win32'},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'breakshift-render-retention-'));
  try {
    await writeFile(join(dir,'capture-receipt.json'),JSON.stringify({passed:true,recording:true}));
    await writeFile(join(dir,'demo.srt'),'retained caption evidence');
    const result=spawnSync('powershell.exe',['-NoProfile','-File',join(root,'demo/render.ps1'),'-OutputPath',dir],{encoding:'utf8'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/DEMO_RENDER_EVIDENCE_ALREADY_EXISTS/);
    assert.equal(await readFile(join(dir,'demo.srt'),'utf8'),'retained caption evidence');
  } finally { await rm(dir,{recursive:true,force:true}); }
});
