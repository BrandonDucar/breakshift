import recordedPatch from './verified-uncertainty-patch.json' with { type: 'json' };
import { createUncertaintySession, MAX_UNCERTAINTY_IMPORT_BYTES } from './uncertainty-session.mjs';

export function createUncertaintyWorkbench(root, { getContext }) {
  const session = createUncertaintySession({getContext,recordedPatch});
  root.innerHTML = `<div class="section-heading"><div><p class="eyebrow">REFERENCE MODEL / ROBUSTNESS</p><h2>Uncertainty check</h2></div><strong id="uncertainty-status" class="uncertainty-status" role="status">NOT CHECKED</strong></div>
    <p id="uncertainty-context" class="scope-note"></p>
    <div class="uncertainty-layout"><div class="uncertainty-settings">
      <label class="uncertainty-bound">Robot profile<select id="uncertainty-asset" aria-label="Robot asset profile"></select></label><p id="uncertainty-asset-status" class="scope-note"></p>
      <div class="segmented" role="group" aria-label="Uncertainty candidate"><button type="button" data-uncertainty-candidate="reference" aria-pressed="true">Nominal reference</button><button type="button" data-uncertainty-candidate="muse" aria-pressed="false">Recorded Muse patch</button></div>
      <label class="uncertainty-bound">Maximum motor load<output id="uncertainty-load-value">1.12×</output><input id="uncertainty-load" type="range" min="1" max="1.3" value="1.12" step=".01"></label>
      <label class="uncertainty-bound">Maximum sensor delay<output id="uncertainty-delay-value">40 ms</output><input id="uncertainty-delay" type="range" min="0" max="100" value="40" step="5"></label>
      <label class="uncertainty-bound">Surge timing jitter<output id="uncertainty-jitter-value">±15 ms</output><input id="uncertainty-jitter" type="range" min="0" max="40" value="15" step="1"></label>
      <dl class="uncertainty-candidate" id="uncertainty-parameters"></dl>
      <p class="scope-note">SIMULATED REFERENCE MODEL · Arm power and duration use an assumed reciprocal relationship. Not an equipment-specific motor model or service clearance.</p>
    </div><div><div class="uncertainty-results" id="uncertainty-results" hidden><div class="uncertainty-table-wrap"><table class="uncertainty-table"><thead><tr><th scope="col">Check</th><th scope="col">Nominal sample</th><th scope="col">Envelope extrema</th><th scope="col">Limit</th></tr></thead><tbody id="uncertainty-rows"></tbody></table></div><div id="uncertainty-plot" class="uncertainty-plot" role="img" aria-label="Nominal and worst-case modeled power traces"></div><p id="uncertainty-failure" class="uncertainty-failure"></p><p id="uncertainty-cases" class="scope-note"></p></div>
      <p id="uncertainty-origin" class="scope-note"></p><p class="scope-note">Energy model v2 and integrated workflow reviewed by Argon. Recorded proposal rechecked with no new model call. Source identity and physical outcomes are not authenticated by a receipt checksum.</p>
      <div class="action-row"><button type="button" id="uncertainty-run" class="primary">Run checks</button><button type="button" id="uncertainty-save" disabled>Download experiment</button><button type="button" id="uncertainty-review">Review saved receipt</button></div>
      <input type="file" id="uncertainty-file" accept=".json,application/json" aria-label="Saved uncertainty experiment" hidden><p id="uncertainty-review-result" class="scope-note" role="status" aria-live="polite"></p>
    </div></div>`;
  const q = selector => root.querySelector(selector);
  const showError = error => { q('#uncertainty-review-result').textContent = `Rejected / ${error.message}. Current workcell unchanged.`; };
  function draw() {
    const s = session.state(), live = s.latest && !s.stale;
    root.dataset.state = !s.canRun ? 'unqualified' : s.stale ? 'stale' : !s.latest ? 'unchecked' : s.latest.experiment.result.verdict.startsWith('SUPPORTED') ? 'supported' : 'refuted';
    q('#uncertainty-status').textContent = !s.canRun ? 'ASSET ADAPTER UNQUALIFIED' : s.stale ? 'STALE / RESULT WITHDRAWN' : !s.latest ? 'NOT CHECKED' : live && root.dataset.state === 'supported' ? 'SUPPORTED IN THIS MODEL' : 'REFUTED IN THIS MODEL';
    q('#uncertainty-save').disabled = !s.canExport;
    q('#uncertainty-run').disabled = !s.canRun;
    q('#uncertainty-asset-status').textContent = s.asset.qualification==='SIMULATOR_FIXTURE_ONLY' ? `v${s.asset.version} · synthetic fixture only` : `v${s.asset.version} · missing: ${s.asset.missingBindings.join('; ')}. No simulation pass or physical clearance.`;
    q('#uncertainty-context').textContent = `${s.current?.snapshotId || 'Unavailable snapshot'} · ${Number(s.current?.breakerKw).toFixed(2)} kW ceiling`;
    q('#uncertainty-load-value').textContent = `${s.bounds.loadMax.toFixed(2)}×`;
    q('#uncertainty-delay-value').textContent = `${s.bounds.delayMaxMs} ms`;
    q('#uncertainty-jitter-value').textContent = `±${s.bounds.jitterMs} ms`;
    for (const button of root.querySelectorAll('[data-uncertainty-candidate]')) button.setAttribute('aria-pressed',String(button.dataset.uncertaintyCandidate === s.selection));
    const p=s.candidate;
    q('#uncertainty-parameters').innerHTML = `<div><dt>Arm power</dt><dd>${(p.armPowerScale*100).toFixed(0)}%</dd></div><div><dt>Belt speed</dt><dd>${p.beltSpeedMps.toFixed(2)} m/s</dd></div><div><dt>Surge separation</dt><dd>${p.surgeGapMs} ms</dd></div><div><dt>Delay compensation</dt><dd>${p.timingCompensationMs} ms</dd></div>`;
    q('#uncertainty-origin').textContent = s.selection === 'muse' ? `RECORDED muse-spark-1.3 · source ${recordedPatch.sourceArtifactSha256.slice(0,16)}` : 'DETERMINISTIC NOMINAL REFERENCE · not the currently selected photo or component recipe';
    q('#uncertainty-results').hidden = !live;
    if (!live) return;
    const r=s.latest.experiment.result,n=r.nominal,c=r.challenger,trace=session.worstTrace();
    q('#uncertainty-rows').innerHTML = `<tr><th scope="row">Peak power</th><td>${n.peakW.toFixed(1)} W</td><td>${c.worstPeakW.toFixed(1)} W</td><td>${(s.current.breakerKw*1000).toFixed(0)} W</td></tr><tr><th scope="row">Timing error</th><td>${n.timingErrorMs.toFixed(1)} ms</td><td>${c.worstTimingErrorMs.toFixed(1)} ms</td><td>22 ms</td></tr><tr><th scope="row">Job duration</th><td>${n.jobMs.toFixed(1)} ms</td><td>${c.jobMs.toFixed(1)} ms</td><td>2400 ms</td></tr>`;
    q('#uncertainty-failure').textContent = c.reasons.length ? c.reasons.join(' · ') : `Worst-case power margin: ${c.worstMarginW.toFixed(1)} W`;
    q('#uncertainty-failure').dataset.state = c.reasons.length ? 'refuted' : 'supported';
    q('#uncertainty-plot').setAttribute('aria-label','Nominal and maximum-load, maximum-delay modeled power traces; timing-error extrema are reported separately');
    q('#uncertainty-cases').textContent = `${r.passedCases}/${r.caseCount} corners passed · analytic interval challenger ${c.robustWithinDeclaredModel?'supported':'refuted'} · nominal sample ${n.passed?'passed':'failed'} · maximum-load/delay modeled energy ${trace.energyWh.toFixed(4)} Wh`;
    const horizon=Math.max(n.jobMs,trace.jobMs),peak=Math.max(c.worstPeakW,s.current.breakerKw*1000)*1.15;
    const x=t=>32+t/horizon*580,y=w=>125-w/peak*110;
    const points=run=>run.segments.flatMap(v=>[`${x(v.fromMs)},${y(v.watts)}`,`${x(v.toMs)},${y(v.watts)}`]).join(' ');
    q('#uncertainty-plot').innerHTML = `<svg viewBox="0 0 640 154" preserveAspectRatio="none"><path d="M32 ${y(s.current.breakerKw*1000)}H612" fill="none" stroke="#efc67b" stroke-dasharray="4 4"/><polyline points="${points(n)}" fill="none" stroke="#79c9ce" stroke-width="2"/><polyline points="${points(trace)}" fill="none" stroke="#c8ed8c" stroke-width="2"/><text x="32" y="148">0 ms</text><text x="520" y="148">${horizon.toFixed(0)} ms</text></svg>`;
  }
  for (const button of root.querySelectorAll('[data-uncertainty-candidate]')) button.addEventListener('click',()=>{session.setSelection(button.dataset.uncertaintyCandidate);draw();});
  for(const profile of session.state().profiles){const option=document.createElement('option');option.value=profile.assetId;option.textContent=profile.label;q('#uncertainty-asset').append(option);}
  q('#uncertainty-asset').addEventListener('change',()=>{session.setAsset(q('#uncertainty-asset').value);draw();});
  for (const id of ['load','delay','jitter']) q(`#uncertainty-${id}`).addEventListener('input',()=>{
    try {session.setBounds({loadMax:Number(q('#uncertainty-load').value),delayMaxMs:Number(q('#uncertainty-delay').value),jitterMs:Number(q('#uncertainty-jitter').value)});q('#uncertainty-review-result').textContent='';draw();} catch(error){showError(error);}
  });
  q('#uncertainty-run').addEventListener('click',()=>{try{session.run();q('#uncertainty-review-result').textContent='';draw();}catch(error){showError(error);draw();}});
  q('#uncertainty-save').addEventListener('click',()=>{try{
    const receipt=session.exportReceipt(),url=URL.createObjectURL(new Blob([JSON.stringify(receipt,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=`breakshift-uncertainty-${receipt.receiptDigest.slice(0,12)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){showError(error);draw();}});
  q('#uncertainty-review').addEventListener('click',()=>q('#uncertainty-file').click());
  q('#uncertainty-file').addEventListener('change',async()=>{const file=q('#uncertainty-file').files?.[0];if(!file)return;
    try{if(file.size>MAX_UNCERTAINTY_IMPORT_BYTES)throw Error('UNCERTAINTY_RECEIPT_TOO_LARGE');const r=session.reviewReceipt(await file.text());q('#uncertainty-review-result').textContent=`Replay matched / ${r.verdict}. Not applied; source identity and physical repair unverified.`;}
    catch(error){showError(error);}finally{q('#uncertainty-file').value='';}
  });
  draw();return {sync:draw,getState:()=>session.state()};
}
