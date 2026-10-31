import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createReviewPreviewServer } from '../preview-review.mjs';

const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
const output=fileURLToPath(new URL(`../artifacts/readiness-regressions-${Date.now()}/`,import.meta.url));
await mkdir(output,{recursive:true});
const server=createReviewPreviewServer();
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true,
  args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const report={schema:'breakshift.readiness-regression-checks.v1',version:'1.0.0',
  evidence:'LOCAL_BROWSER_WITH_SYNTHETIC_CAMERA_AND_PAIRING_FIXTURES',
  providerCalls:0,unexpectedExternalRequests:0,unexpectedPosts:0,checks:[],errors:[]};
const upload=await readFile(new URL('../public/assets/robot-cutaway-v1.png',import.meta.url));
const unhostedHtml=(await readFile(new URL('../.cf-preview/index.html',import.meta.url),'utf8')).replace('data-preview="live"','');
try{
  for(const [name,width,height] of [['phone',390,844],['tablet',768,1024],['desktop',1440,1000]]){
    const context=await browser.newContext({viewport:{width,height},permissions:['camera']});
    await context.addInitScript(()=>{
      sessionStorage.setItem('breakshift.pairToken','existing-fixture-token');
      const bitmap=window.createImageBitmap.bind(window),digest=crypto.subtle.digest.bind(crypto.subtle);
      window.__delayBitmap=false;window.__delayDigest=false;window.__held=false;
      const wait=()=>new Promise((done,reject)=>{window.__held=true;
        window.__release=()=>{window.__held=false;done();};
        window.__rejectHeld=()=>{window.__held=false;reject(new Error('Synthetic cancelled decode failure'));};});
      window.createImageBitmap=async(...args)=>{if(window.__delayBitmap){window.__delayBitmap=false;await wait();}return bitmap(...args);};
      crypto.subtle.digest=async(...args)=>{if(window.__delayDigest){window.__delayDigest=false;await wait();}return digest(...args);};
    });
    const page=await context.newPage();page.setDefaultTimeout(10000);
    page.on('pageerror',error=>report.errors.push(`${name}: ${error.message}`));
    let pairFixture={status:200,contentType:'text/html',body:'<p>Not a pairing response</p>'};
    let unhosted=false;
    await page.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin!==base){report.unexpectedExternalRequests++;return route.abort();}
      if(unhosted&&url.pathname==='/'&&request.method()==='GET')return route.fulfill({status:200,contentType:'text/html',body:unhostedHtml});
      if(url.pathname==='/api/pairing/join'&&request.method()==='POST')return route.fulfill(pairFixture);
      if(!['GET','HEAD'].includes(request.method())){report.unexpectedPosts++;return route.abort();}
      return route.continue();
    });
    const check=async(label,fn)=>{
      try{await fn();report.checks.push({viewport:name,label,passed:true});}
      catch(error){report.checks.push({viewport:name,label,passed:false,error:error.message,stack:error.stack,
        captureState:await page.evaluate(()=>({held:window.__held,delayBitmap:window.__delayBitmap,delayDigest:window.__delayDigest,
          error:document.querySelector('#photo-error')?.textContent,status:document.querySelector('#photo-status')?.textContent,
          fileDisabled:document.querySelector('#photo-file')?.disabled,cameraVisible:!document.querySelector('#photo-camera-panel')?.hidden})).catch(()=>null)});}
    };
    await page.goto(base+'/?view=photo&webgl=off');
    await page.waitForFunction(()=>document.querySelector('#mission-version')?.textContent.startsWith('v'));
    await check('typed note survives an upload finishing after delayed decoding',async()=>{
      await page.locator('#photo-demo').click();
      await page.waitForFunction(()=>document.querySelector('#photo-source').textContent.startsWith('DEMO ILLUSTRATION'));
      await page.evaluate(()=>{window.__delayBitmap=true;});
      await page.locator('#photo-file').setInputFiles({name:'component.png',mimeType:'image/png',buffer:upload});
      await page.waitForFunction(()=>window.__held);
      await page.locator('#photo-note').fill('New operator note typed during image decode');
      await page.evaluate(()=>window.__release());
      await page.waitForFunction(()=>document.querySelector('#photo-source').textContent.startsWith('UPLOADED IMAGE'));
      assert.equal(await page.locator('#photo-note').inputValue(),'New operator note typed during image decode');
      assert.equal(await page.locator('#photo-file').inputValue(),'');
    });
    for(const [kind,leave,reject] of [['Bitmap',false,false],['Digest',true,false],['Bitmap',false,true]])await check(`cancelled capture preserves prior evidence during deferred ${kind.toLowerCase()}${reject?' rejection':''}`,async()=>{
      // Isolate deferred hooks so an earlier failure cannot hold this case's work.
      await page.goto(base+'/?view=photo&webgl=off');
      await page.waitForFunction(()=>document.querySelector('#mission-version')?.textContent.startsWith('v'));
      await page.locator('button[data-view="photo"]').click();
      await page.locator('#photo-demo-track').click();
      await page.waitForFunction(()=>document.querySelector('#photo-source').textContent.startsWith('VERIFIED SYNTHETIC DEMO'));
      const before=await page.evaluate(()=>({source:document.querySelector('#photo-source').textContent,
        dimensions:document.querySelector('#photo-dimensions').textContent,
        findings:document.querySelector('#photo-findings').textContent}));
      await page.locator('#photo-camera').click();
      await page.waitForFunction(()=>document.querySelector('#photo-video').videoWidth>0);
      await page.evaluate(key=>{window[`__delay${key}`]=true;},kind);
      await page.locator('#photo-record').click();
      await page.waitForFunction(()=>window.__held);
      if(leave)await page.locator('button[data-view="workcell"]').click();
      else await page.locator('#photo-cancel-camera').click();
      await page.evaluate(fail=>fail?window.__rejectHeld():window.__release(),reject);
      await page.waitForFunction(()=>!document.querySelector('#photo-file').disabled);
      await page.locator('button[data-view="photo"]').click();
      const after=await page.evaluate(()=>({source:document.querySelector('#photo-source').textContent,
        dimensions:document.querySelector('#photo-dimensions').textContent,
        findings:document.querySelector('#photo-findings').textContent}));
      assert.deepEqual(after,before);
      assert.equal(await page.locator('#photo-error').isVisible(),false);
    });
    const submit=async()=>{
      const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/pairing/join'&&r.request().method()==='POST');
      await page.evaluate(()=>{
        document.querySelector('#connection-error').textContent='';
        document.querySelector('#join-code-input').value='BS-TEST';
        document.querySelector('#pair-join-form').requestSubmit();
      });
      await response;
    };
    const assertRetained=async()=>{
      await page.waitForFunction(()=>document.querySelector('#connection-error').textContent.includes('Pairing response could not be verified'));
      assert.equal(await page.evaluate(()=>sessionStorage.getItem('breakshift.pairToken')),'existing-fixture-token');
      assert.equal(await page.locator('#join-code-input').inputValue(),'BS-TEST');
    };
    const malformed=[
        {status:200,contentType:'text/html',body:'<p>Not JSON</p>'},
        {status:200,contentType:'application/json',body:'{"pairToken":'},
        {status:200,contentType:'application/json',body:'{}'},
    ];
    for(const [i,fixture] of malformed.entries())await check(`malformed successful pairing case ${i+1} preserves token and room input`,async()=>{
      pairFixture=fixture;await submit();await assertRetained();
    });
    await check('failed pairing does not clear prior token',async()=>{
      pairFixture={status:404,contentType:'text/html',body:'Unavailable'};await submit();
      await page.waitForFunction(()=>document.querySelector('#connection-error').textContent.includes('pairing is unavailable'));
      assert.equal(await page.evaluate(()=>sessionStorage.getItem('breakshift.pairToken')),'existing-fixture-token');
      assert.equal(await page.locator('#join-code-input').inputValue(),'BS-TEST');
    });
    await check('valid pairing response still updates token',async()=>{
      pairFixture={status:200,contentType:'application/json',body:'{"pairToken":"new-fixture-token"}'};await submit();
      await page.waitForFunction(()=>sessionStorage.getItem('breakshift.pairToken')==='new-fixture-token');
      assert.equal(await page.locator('#join-code-input').inputValue(),'');
    });
    unhosted=true;
    for(const [i,fixture] of [...malformed,{status:200,contentType:'application/json',body:'{"pairToken":"new-fixture-token"}'}].entries())await check(`unhosted autojoin case ${i+1} validates before token replacement`,async()=>{
      pairFixture=fixture;
      const session=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/session');
      await page.goto(base+'/?room=BS-TEST&webgl=off');await session;
      assert.equal(await page.evaluate(()=>Boolean(document.body.dataset.preview)),false);
      assert.equal(await page.evaluate(()=>sessionStorage.getItem('breakshift.pairToken')),i<malformed.length?'existing-fixture-token':'new-fixture-token');
    });
    await page.screenshot({path:resolve(output,`${name}-review-regressions.png`)});
    await context.close();
  }
}finally{
  await browser.close();await new Promise(done=>server.close(done));
}
report.passed=report.checks.filter(x=>x.passed).length;
report.failed=report.checks.filter(x=>!x.passed).length;
await writeFile(resolve(output,'receipt.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({output,...report},null,2));
assert.equal(report.checks.length,39);assert.equal(report.failed,0);assert.equal(report.errors.length,0);
assert.equal(report.unexpectedPosts,0);assert.equal(report.unexpectedExternalRequests,0);
