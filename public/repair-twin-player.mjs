import { executeRepairRun, repairFrameAt } from '../simulator/repair-run.mjs';
import { COMPONENTS } from './component-model.mjs';
import { BAY_ART } from './visual-assets.mjs';
import { playbackRate as checkedRate, playbackOptions } from './playback-speed.mjs';
import {executePhotoRepairTest,photoTestReceipt} from './photo-repair-bridge.mjs';
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function createRepairTwinPlayer(root) {
  let run, title = '', elapsed = 0, playing = false, stale = false, raf, previous, resultShown = false, artworkView = 'workcell';
  let rate = 1 / 3;
  let photoSource=null;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const q = selector => root.querySelector(selector);
  function stop() { playing = false; cancelAnimationFrame(raf); previous = undefined; }
  function tick(now) {
    if (!playing) return;
    if (previous !== undefined) elapsed = Math.min(run.playbackDurationMs, elapsed + Math.min(100, now - previous) * rate);
    previous = now;
    if (elapsed >= run.playbackDurationMs) stop();
    draw();
    if (playing) raf = requestAnimationFrame(tick);
  }
  function play() {
    if (!run || stale) return;
    if (elapsed >= run.playbackDurationMs) elapsed = 0;
    playing = true; previous = undefined; draw(); raf = requestAnimationFrame(tick);
  }
  function renderArtwork() {
    if(run.photoBinding&&artworkView==='photo'){
      if(!photoSource){q('#repair-image').hidden=true;q('#repair-image-fallback').hidden=false;q('#repair-image-fallback').textContent='Photo or proposal changed. Select the current fix and test again.';draw();return;}
      const image=q('#repair-image');image.src=photoSource.imageDataUrl;image.alt='Exact analyzed photo / selected proposed fix; reference-model test only';image.hidden=false;q('#repair-image-fallback').hidden=true;
      q('#repair-stage').dataset.artwork='photo';q('#repair-stage').style.aspectRatio=`${photoSource.width}/${photoSource.height}`;
      const [x,y,w,h]=run.photoBinding.bbox;
      q('#repair-art-overlays').setAttribute('viewBox','0 0 1000 1000');q('#repair-art-overlays').setAttribute('preserveAspectRatio','none');
      q('#repair-art-overlays').setAttribute('aria-label',`Selected photo region: ${run.photoBinding.regionLabel}. Outline indicates selection, not a verified repair.`);
      q('#repair-art-overlays').innerHTML=`<rect class="photo-test-region" x="${x}" y="${y}" width="${w}" height="${h}"/><g id="repair-arm-a" hidden></g><g id="repair-arm-b" hidden></g>`;
      q('#repair-art-note').textContent='Same analyzed first frame / region · reference workcell tested, photographed component not repaired';
      for(const button of root.querySelectorAll('[data-repair-art]'))button.setAttribute('aria-pressed',String(button.dataset.repairArt==='photo'));
      draw();return;
    }
    const cutaway = artworkView === 'cutaway';
    q('#repair-stage').style.aspectRatio='2/1';q('#repair-art-overlays').setAttribute('viewBox','0 0 1000 500');q('#repair-art-overlays').removeAttribute('preserveAspectRatio');
    const image = q('#repair-image');
    image.src = BAY_ART[artworkView].src;
    image.alt = cutaway ? 'Original detailed Station A robot cutaway, shared with the component inspection view' : 'Original detailed two-arm workcell and microgrid, shared with the homepage';
    image.hidden = false; q('#repair-image-fallback').hidden = true;
    q('#repair-stage').dataset.artwork = artworkView;
    q('#repair-art-overlays').setAttribute('aria-label', cutaway ? 'Station A cutaway with modeled power and fault overlays. Station B is outside this view.' : 'Workcell artwork with modeled arm surge and repair route overlays');
    const point = id => COMPONENTS[id][artworkView];
    const a = point('GANTRY-STA-A'), b = point('GANTRY-STB-B');
    const ring = (id, coords, number) => `<g id="${id}" class="repair-arm" ${coords?'':'hidden'}>${coords ? `<circle cx="${coords[0]*10}" cy="${coords[1]*5}" r="31"/><text x="${coords[0]*10}" y="${coords[1]*5+4}" text-anchor="middle">${number}</text>` : ''}</g>`;
    const power = cutaway ? 'M320 390L320 230L460 100L710 200' : 'M850 140L710 140L710 220L570 260M710 220L880 325';
    const route = cutaway ? 'M590 145L660 180L790 230' : 'M700 355L800 355L880 325';
    q('#repair-art-overlays').innerHTML = `<path class="repair-power-route" d="${power}"/><path class="repair-handoff-route" d="${route}"/>${ring('repair-arm-a',a,'A')}${ring('repair-arm-b',b,'B')}`;
    q('#repair-art-note').textContent = cutaway ? 'Station A cutaway · Station B handoff runs outside this view' : 'Same workcell as inspection · modeled power and handoff overlays';
    for (const button of root.querySelectorAll('[data-repair-art]')) button.setAttribute('aria-pressed',String(button.dataset.repairArt===artworkView));
    draw();
  }
  function draw() {
    if (!run) return;
    const frame = repairFrameAt(run, elapsed);
    const done = frame.phase === 'COMPLETE';
    root.dataset.state = stale ? 'stale' : playing ? 'running' : done ? 'complete' : 'paused';
    root.dataset.strategy = run.strategyId;
    const tone = stale ? 'amber' : done ? run.passed ? 'green' : 'red' : 'amber';
    const verdict = stale ? 'STALE / CONDITIONS CHANGED' : done ? run.photoBinding ? run.passed ? 'REFERENCE MODEL PASSED / PHOTO UNVERIFIED' : 'REFERENCE MODEL REJECTED / PHOTO UNVERIFIED' : run.passed ? 'PASS / BOTH SCENARIOS' : 'FAIL / REPAIR REJECTED' : playing ? 'REPAIR TWIN RUNNING' : 'REPAIR TWIN PAUSED';
    q('#repair-verdict').className = `repair-verdict ${tone}`;
    q('#repair-verdict').textContent = verdict;
    q('#repair-toggle').textContent = playing ? 'Pause' : done ? 'Replay fix ↻' : 'Play';
    q('#repair-toggle').disabled = stale;
    q('#repair-finish').disabled = stale || done;
    q('#repair-scrub').disabled = stale;
    q('#repair-speed').disabled = stale;
    if(q('#repair-tighten'))q('#repair-tighten').disabled=stale;
    if(q('#repair-recompute'))q('#repair-recompute').disabled=!stale;
    if(q('#repair-plan-save'))q('#repair-plan-save').disabled=stale;
    if(q('#repair-plan-status'))q('#repair-plan-status').textContent=`${stale ? 'STALE PLAN' : 'COMPILED PLAN'} / ${run.compiledPlan.planDigest.slice(0,12)} / simulator only`;
    q('#repair-scrub').value = Math.round(elapsed);
    q('#repair-progress').textContent = frame.phase === 'POWER_TRACE' ? `${Math.round(elapsed)} / 1200 ms power trace` : `${frame.checked}/${run.repair.orderCount} batch order checks`;
    q('#repair-phase').textContent = stale ? 'Return to the current component diagnosis before another run.' : frame.phase === 'POWER_TRACE' ? '01 / Shared bus · acceleration surges' : done ? '03 / Judge + challenger verdict' : '02 / Timing + handoff · order checks';
    q('#repair-current-kw').textContent = `${frame.sample.kw.toFixed(3)} kW`;
    q('#repair-bus-state').textContent = (run.photoBinding?'MODEL / ':'')+(frame.sample.tripped ? 'BREAKER TRIPPED' : 'BUS WITHIN CAP');
    q('#repair-bus-state').style.color = frame.sample.tripped ? '#ff8777' : '#dbfa86';
    q('#repair-stage').classList.toggle('bus-tripped', frame.sample.tripped);
    q('#repair-packed').textContent = `${frame.packed}/${run.repair.orderCount}`;
    q('#repair-arm-a').classList.toggle('surging', frame.armSurges.includes('A'));
    q('#repair-arm-b').classList.toggle('surging', frame.armSurges.includes('B'));
    q('#repair-queue').textContent = run.recipe.handoff ? 'QUEUE → STATION B' : 'QUEUE → A + B / A FAULTED';
    q('#repair-parts').innerHTML = run.repair.parts.map((part, index) => {
      const checked = index < frame.checked;
      return `<span class="repair-order ${checked ? part.packed ? 'packed' : 'missed' : 'waiting'}" aria-label="Order ${part.order}, station ${part.station}, ${checked ? part.packed ? 'packed' : 'missed' : 'not checked'}"><b>${checked ? part.packed ? '✓' : '×' : String(part.order).padStart(2,'0')}</b><small>${part.station}</small></span>`;
    }).join('');
    const x = 36 + Math.min(1200, elapsed) / 1200 * 680;
    q('#repair-cursor').setAttribute('x1', x); q('#repair-cursor').setAttribute('x2', x);
    q('#repair-plot').setAttribute('aria-label', `Selected fix power trace: ${frame.sample.kw} kW at ${Math.min(1200,Math.round(elapsed))} ms, cap ${run.breakerKw} kW`);
    q('#repair-results').hidden = !done || stale;
    q('#repair-parts').hidden=Boolean(run.photoBinding&&stale);q('.repair-meters').hidden=Boolean(run.photoBinding&&stale);
    if (done && !resultShown) {
      resultShown = true;
      q('#repair-announcement').textContent = `${run.photoBinding?'Reference workcell hypothesis: ':''}${title}. ${run.passed ? 'Passed' : 'Failed'} judge and challenger checks. ${run.repair.packed} of ${run.repair.orderCount} parts packed, peak ${run.repair.peakKw.toFixed(3)} kilowatts.${run.photoBinding?' Photographed component remains unverified.':''}`;
    }
    if (stale) q('#repair-announcement').textContent = 'Conditions changed. This run is stale and its verdict is withdrawn.';
  }
  function start({ fix, diagnosis, snapshotId, breakerKw, photo }) {
    stop();
    if (!fix || diagnosis.stale || diagnosis.evidenceSnapshotId !== snapshotId) throw new Error('STALE_REPAIR_PROPOSAL');
    run = photo ? executePhotoRepairTest({...photo,snapshotId,breakerKw}) : executeRepairRun({ strategyId: fix.strategyId, breakerKw, snapshotId, scanId: diagnosis.scanId });
    photoSource=photo?{imageDataUrl:photo.image.imageDataUrl,width:photo.image.width,height:photo.image.height}:null;
    if(photo)artworkView='photo';else if(artworkView==='photo')artworkView='workcell';
    title = fix.title; elapsed = 0; stale = false; resultShown = false; root.hidden = false;
    const y = kw => 137 - kw / Math.max(3.3, breakerKw + .25) * 117;
    const line = (result, color) => `<polyline fill="none" stroke="${color}" stroke-width="2" points="${result.waveform.map(p => `${36+p.timeMs/1200*680},${y(p.kw)}`).join(' ')}"/>`;
    const provenanceNote = diagnosis.mode === 'DETERMINISTIC_CONSOLE' ? 'deterministic compiler recipe · no model call' : `saved ${esc(diagnosis.model)} diagnosis · no new model call`;
    root.innerHTML = `<div class="repair-header"><div><p class="eyebrow">REPAIR TWIN / EXECUTABLE CONTROLLER RECIPE</p><h2 id="repair-title">${esc(title)}</h2></div><strong id="repair-verdict" role="status"></strong></div>
      <p class="scope-note">${esc(snapshotId)} · ${provenanceNote}</p>
      <div class="repair-grid"><div><div class="repair-art-toolbar"><span>REPAIR TWIN / ILLUSTRATED WORKCELL</span><div role="group" aria-label="Repair Twin artwork"><button type="button" data-repair-art="workcell" aria-pressed="true">Workcell</button><button type="button" data-repair-art="cutaway" aria-pressed="false">Robot cutaway</button></div></div><div id="repair-stage" class="repair-stage repair-art-stage">
        <img id="repair-image" width="1774" height="887" src="/public/assets/breakshift-microgrid-hero-v1.png" alt="Original detailed workcell, shared with the homepage">
        <div id="repair-image-fallback" class="repair-art-fallback" hidden><strong>Workcell illustration unavailable</strong><p>The same power trace, order outcomes and controller comparison remain available below.</p></div>
        <svg id="repair-art-overlays" viewBox="0 0 1000 500" role="img"></svg><div class="repair-art-badges"><span class="repair-art-fault">A / GRIPPER FAULT</span><span id="repair-bus-state"></span></div>
      </div><div class="repair-art-caption"><span id="repair-queue"></span><span id="repair-art-note"></span></div><div id="repair-parts" class="repair-order-strip" aria-label="Batch order-check outcomes"></div>
      <div class="repair-controls"><button type="button" id="repair-toggle">Pause</button><button type="button" id="repair-finish">Show result</button><label>Playback speed <select id="repair-speed" aria-label="Repair Twin playback speed">${playbackOptions(rate)}</select></label><span id="repair-progress"></span></div><input id="repair-scrub" type="range" min="0" max="${run.playbackDurationMs}" step="10" value="0" aria-label="Repair Twin playback position"><p id="repair-phase" class="scope-note"></p>
      <div class="repair-plot-heading"><span>RED / WORKING &nbsp; LIME / SELECTED FIX</span><b id="repair-current-kw"></b></div><div id="repair-plot" role="img"><svg viewBox="0 0 750 165" preserveAspectRatio="none"><path d="M36 ${y(breakerKw)}H716" stroke="#efbe77" stroke-dasharray="5 5"/>${line(run.working,'#ff8777')}${line(run.repair,'#dbfa86')}<line id="repair-cursor" x1="36" x2="36" y1="12" y2="140" stroke="#f1f5e8"/><text x="38" y="${y(breakerKw)-7}">${breakerKw.toFixed(2)} kW breaker</text><text x="36" y="159">0 ms</text><text x="650" y="159">1200 ms</text></svg></div></div>
      <div class="repair-comparison"><p class="eyebrow">WHAT THIS FIX CHANGES</p><table><thead><tr><th scope="col">Controller</th><th scope="col">Working</th><th scope="col">Selected fix</th></tr></thead><tbody>${run.changes.map(change => `<tr class="${change.before!==change.after?'changed':''}"><th scope="row">${esc(change.label)}<small>${esc(change.path)}</small></th><td>${esc(change.before)}</td><td>${esc(change.after)}</td></tr>`).join('')}</tbody></table><p class="scope-note">Runs the selected recipe through the existing controller modules. Source files are unchanged.</p>
      <div class="repair-meters"><div><span>PARTS PACKED</span><b id="repair-packed">0/8</b></div><div><span>PEAK / WORKING → FIX</span><b>${run.working.peakKw.toFixed(3)} → ${run.repair.peakKw.toFixed(3)} <small>kW</small></b></div></div>
      <div id="repair-results" hidden><h3>${run.passed?'✓ Fix works in both modeled scenarios':'× This fix is incomplete'}</h3><p>Judge: ${run.repair.packed}/${run.repair.orderCount} packed · ${run.repair.breakerTrip?'breaker tripped':'power within cap'}. Challenger: ${run.challenger.packed}/${run.challenger.orderCount} packed · ${run.challenger.telemetryErrors.length} malformed packets rejected.</p><p>${run.passed?'Station B completes the queue while Station A remains faulted.':repairFrameAt(run,run.playbackDurationMs).failures.map(esc).join(' ')}</p><p class="scope-note">Model metrics: ${run.repair.whPerPart??'—'} Wh/part · ${run.repair.throughputPerMin} orders/min · ${run.repair.socWh} Wh buffer remaining.</p></div></div></div>
      <p class="scope-note repair-scope">Slowed playback: computed 10 ms power samples, then batch order-check reveal. Arm drawing is illustrative; this model does not simulate a full robot trajectory. SIMULATED_WORKCELL_ENERGY_MODEL. Physical gripper fault remains unresolved.</p><p id="repair-announcement" class="sr-only" aria-live="polite"></p>`;
    const planStatus=document.createElement('p');planStatus.id='repair-plan-status';planStatus.className='scope-note';
    if(photo){
      q('.repair-art-toolbar [role=group]').insertAdjacentHTML('afterbegin','<button type="button" data-repair-art="photo" aria-pressed="true">Analysis photo</button>');
      q('.repair-art-fault').textContent='PHOTO CONDITION / UNVERIFIED';
      q('.repair-art-toolbar>span').textContent='PHOTO → REFERENCE MODEL TEST';
      q('.repair-header+p').textContent=`${run.photoBinding.origin==='WONDER_PROPOSAL'?'Wonder proposal':'Operator-mapped hypothesis'} · ${run.photoBinding.model} · ${run.photoBinding.mode} · no new model call`;
      q('.repair-comparison').insertAdjacentHTML('afterbegin',`<p class="photo-proposal-binding"><strong>${esc(run.photoBinding.regionLabel)}</strong><br>${esc(run.photoBinding.proposedFix)}<br><small>Selected photo → exact proposal → reference workcell recipe. ${run.photoBinding.bindingDigest.slice(0,16)}</small></p>`);
      q('#repair-results h3').textContent=run.passed?'✓ Reference workcell test passed':'× Reference workcell test rejected';
      q('.repair-scope').textContent='SIMULATED_WORKCELL_ENERGY_MODEL. Tests the selected controller hypothesis on the reference workcell, not physics recovered from this photo. First analyzed frame remains unchanged. Physical component service and repair success are unverified.';
    }
    q('.repair-comparison').prepend(planStatus);
    const savePlan=document.createElement('button');savePlan.type='button';savePlan.id='repair-plan-save';savePlan.textContent='Save compiled plan';
    savePlan.addEventListener('click',()=>{
      if(stale)return;
      const url=URL.createObjectURL(new Blob([JSON.stringify(run.photoBinding?photoTestReceipt(run):run.compiledPlan,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download=`breakshift-plan-${run.compiledPlan.planDigest.slice(0,12)}.json`;a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    q('.repair-controls').append(savePlan);
    const tighten=document.createElement('button');tighten.type='button';tighten.id='repair-tighten';tighten.textContent='Inject 1.45 kW limit';
    tighten.addEventListener('click',()=>root.dispatchEvent(new CustomEvent('breakshift-inject-limit',{bubbles:true})));
    const recompute=document.createElement('button');recompute.type='button';recompute.id='repair-recompute';recompute.textContent='Replay current conditions';
    recompute.addEventListener('click',()=>root.dispatchEvent(new CustomEvent('breakshift-replay-current',{bubbles:true})));
    q('.repair-controls').append(tighten,recompute);
    const stress=document.createElement('button');stress.type='button';stress.id='repair-open-uncertainty';stress.textContent='Open uncertainty check';
    stress.addEventListener('click',()=>root.dispatchEvent(new CustomEvent('breakshift-open-uncertainty',{bubbles:true})));
    q('.repair-controls').append(stress);
    if(photo){tighten.hidden=true;recompute.hidden=true;savePlan.textContent='Save photo test receipt';}
    q('#repair-toggle').addEventListener('click', () => { if (playing) { stop(); draw(); } else play(); });
    q('#repair-finish').addEventListener('click', () => { stop(); elapsed = run.playbackDurationMs; draw(); });
    q('#repair-scrub').addEventListener('input', event => { stop(); elapsed = Number(event.target.value); draw(); });
    q('#repair-speed').addEventListener('change', event => { rate = checkedRate(event.target.value); previous = undefined; });
    q('#repair-image').addEventListener('error', () => { q('#repair-image').hidden = true; q('#repair-image-fallback').hidden = false; });
    for (const button of root.querySelectorAll('[data-repair-art]')) button.addEventListener('click', () => { artworkView = button.dataset.repairArt; renderArtwork(); });
    renderArtwork(); if (!reduced.matches) play();
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && playing) { stop(); draw(); } });
  reduced.addEventListener('change', () => { if (reduced.matches && playing) { stop(); draw(); } });
  return {
    start,
    sync(snapshotId) { if (run && snapshotId !== run.snapshotId && !stale) { stop(); stale = true; draw(); } },
    invalidatePhoto() {if(run?.photoBinding&&!stale){stop();stale=true;photoSource=null;q('#repair-image').removeAttribute('src');q('#repair-image').hidden=true;q('#repair-image-fallback').hidden=false;q('#repair-image-fallback').textContent='Photo or proposal changed. Select the current fix and test again.';draw();}},
    getState: () => run ? { strategyId: run.strategyId, scanId: run.scanId, snapshotId: run.snapshotId, elapsed, playing, stale, passed: run.passed, playbackRate: rate } : null,
  };
}
