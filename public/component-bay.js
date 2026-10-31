import { createInspectionSessionCore, projectSessionForSurface } from '../session/inspection-session-core.mjs';
import { COMPONENTS, componentState } from './component-model.mjs';
import { createSpatialXrController } from './spatial-xr.mjs';
import { createRepairTwinPlayer } from './repair-twin-player.mjs';
import { createPhotoInspector } from './photo-inspection.mjs';
import { PHOTO_RECIPES } from './photo-repair-bridge.mjs';
import { referencePlate, bindReferenceFallback } from './visual-assets.mjs';
import { createBayJob, scanAvailability } from './bay-job.mjs';
import { createSabotageConsole, RECIPE_TITLES } from './sabotage-console.mjs';
import { createFaultExperiment } from './fault-lab.mjs';
import { MAX_EXPERIMENT_BYTES, parseAndReplayExperiment } from './experiment-replay.mjs';
import { createUncertaintyWorkbench } from './uncertainty-workbench.mjs';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const params = new URLSearchParams(location.search);
const hostedPreview = Boolean(document.body.dataset.preview);
const operatorView = hostedPreview && params.get('operator') === '1';
const localSession = createInspectionSessionCore();
const envelopeFor = state => ({ sessionId: state.sessionId, version: state.version, evidenceSnapshotId: state.evidenceSnapshotId, projections: Object.fromEntries(['laptop', 'ipad', 'glasses'].map(surface => [surface, projectSessionForSurface(state, surface)])) });
let envelope = envelopeFor(localSession.getState());
let connected = false;
let everConnected = false;
let view = ['workcell', 'cutaway', 'schematic', 'spatial', 'photo'].includes(params.get('view')) ? params.get('view') : 'workcell';
let trace = 'working';
let surface = params.get('surface');
if (!['laptop', 'ipad', 'glasses'].includes(surface)) surface = 'all';
const initialRoomCode = params.get('room') || '';
const disableWebGl = params.get('webgl') === 'off';
let pairToken = '';
try { pairToken = sessionStorage.getItem('breakshift.pairToken') || ''; } catch {}
let pairingDescriptor = null;
let qrTarget = surface === 'ipad' ? 'glasses' : 'ipad';
let activeStream = null;
let mutationQueue = Promise.resolve();
let pending = 0;
let museStatus;
let scanBusy = false;
let scanError = '';
const museResults = new Map();
let selectedFix;
let showMuseOverlay = false;
let cacheRequestKey;
const scanKey = (zoneId = envelope.projections.laptop.activeZoneId, snapshotId = envelope.evidenceSnapshotId) => `${zoneId}:${snapshotId}`;
const repairPlayer = createRepairTwinPlayer($('#repair-twin'));
const uncertaintyWorkbench = createUncertaintyWorkbench($('#uncertainty-workspace'), {
  getContext: () => ({snapshotId:envelope.evidenceSnapshotId,breakerKw:envelope.projections.laptop.breakerKw,available:connected||!everConnected}),
});
$('#repair-twin').addEventListener('breakshift-open-uncertainty',()=>{$('#uncertainty-workspace').scrollIntoView({block:'start',behavior:'instant'});$('#uncertainty-run').focus({preventScroll:true});});
function launchRepairTwin(fix, diagnosis) {
  if (view === 'photo') setView('workcell');
  faultExperiment.recordRecipe(fix.strategyId, envelope.evidenceSnapshotId, diagnosis.scanId);
  repairPlayer.start({ fix, diagnosis, snapshotId: envelope.evidenceSnapshotId, breakerKw: envelope.projections.laptop.breakerKw });
  $('#repair-twin').scrollIntoView({ block: 'start', behavior: 'instant' });
  $('#repair-toggle')?.focus({ preventScroll: true });
}
function runDeterministicRecipeInTwin(strategyId) {
  if (!Object.hasOwn(RECIPE_TITLES, strategyId)) return;
  launchRepairTwin({ strategyId, title: RECIPE_TITLES[strategyId] }, { scanId: 'DETERMINISTIC_CONSOLE', model: 'deterministic-compiler', mode: 'DETERMINISTIC_CONSOLE', stale: false, evidenceSnapshotId: envelope.evidenceSnapshotId });
}
const photoInspector = createPhotoInspector($('#photo-workspace'), {getStatus:()=>museStatus,refreshStatus:refreshMuseStatus,onTestRecipeInTwin:runDeterministicRecipeInTwin,onPhotoContextChanged:()=>repairPlayer.invalidatePhoto(),onTestPhotoFixInTwin:photo=>{
  repairPlayer.start({photo,fix:{strategyId:photo.strategyId,title:photo.origin==='OPERATOR_HYPOTHESIS'?`Operator hypothesis: ${PHOTO_RECIPES[photo.strategyId]}`:photo.result.regions[photo.regionIndex].possibleFixes[photo.fixIndex]},diagnosis:{scanId:photo.result.scanId||'photo-assessment',model:photo.result.model,stale:false,evidenceSnapshotId:envelope.evidenceSnapshotId},snapshotId:envelope.evidenceSnapshotId,breakerKw:envelope.projections.laptop.breakerKw});
  $('#repair-twin').scrollIntoView({block:'start',behavior:'instant'});$('#repair-toggle')?.focus({preventScroll:true});
}});

const spatialXr = createSpatialXrController({
  stageEl: $('#spatial-stage'),
  canvasEl: $('#spatial-canvas'),
  pinsEl: $('#spatial-pins'),
  fallbackEl: $('#spatial-fallback'),
  xrButtonEl: $('#xr-enter'),
  xrStatusEl: $('#xr-status'),
  domOverlayRoot: $('#component-workspace'),
  onSelectZone: zoneId => selectZone(zoneId),
  disableWebGl,
});
window.__breakshiftSpatial = spatialXr;
const faultExperiment = createFaultExperiment({
  getContext: () => ({ snapshotId: envelope.evidenceSnapshotId, version: envelope.version, breakerKw: envelope.projections.laptop.breakerKw, available: connected || !everConnected }),
  applyBreaker: (cap, expectedSnapshotId) => mutate({ type: 'SET_BREAKER_KW', breakerKw: cap }, expectedSnapshotId),
  getActiveRun: () => {
    const player = repairPlayer.getState();
    if (player && !player.stale && player.snapshotId === envelope.evidenceSnapshotId) return player;
    const selected = sabotageConsole.getState();
    return selected.activeSnapshotId === envelope.evidenceSnapshotId ? { snapshotId: selected.activeSnapshotId, strategyId: selected.activeStrategyId, scanId: 'DETERMINISTIC_CONSOLE', elapsed: 0, playing: false, stale: false } : null;
  },
  startPlayback: () => {},
  onChange: () => renderExperimentTrace(),
});
const experimentRoot = document.createElement('div'); experimentRoot.className = 'experiment-trail';
experimentRoot.innerHTML = '<div class="section-heading"><strong>Experiment evidence</strong><button type="button" id="experiment-save" disabled>Save experiment receipt</button></div><p id="experiment-state" role="status">No experiment recorded.</p><ol id="experiment-events" aria-label="Timestamped experiment events"></ol>';
$('#sabotage-console').after(experimentRoot);
const reviewReceipt = document.createElement('button'); reviewReceipt.type = 'button'; reviewReceipt.id = 'experiment-review'; reviewReceipt.textContent = 'Review saved receipt';
const receiptFile = document.createElement('input'); receiptFile.type = 'file'; receiptFile.accept = '.json,application/json'; receiptFile.id = 'experiment-file'; receiptFile.hidden = true; receiptFile.setAttribute('aria-label', 'Saved experiment receipt');
const receiptResult = document.createElement('p'); receiptResult.id = 'experiment-replay-result'; receiptResult.className = 'scope-note'; receiptResult.setAttribute('role', 'status'); receiptResult.setAttribute('aria-live', 'polite');
experimentRoot.querySelector('.section-heading').append(reviewReceipt);
experimentRoot.append(receiptFile, receiptResult);
reviewReceipt.addEventListener('click', () => receiptFile.click());
receiptFile.addEventListener('change', async () => {
  const file = receiptFile.files?.[0]; if (!file) return;
  reviewReceipt.disabled = true; receiptResult.textContent = 'Checking saved receipt...';
  try {
    if (file.size > MAX_EXPERIMENT_BYTES) throw Error('EXPERIMENT_FILE_TOO_LARGE_OR_INVALID');
    const replay = parseAndReplayExperiment(await file.text());
    receiptResult.textContent = `Replay matched / recorded result: ${replay.recordedVerdict} / ${replay.breakerKw.toFixed(2)} kW / ${replay.snapshotId}. Saved snapshot only; not applied. Author and historical events are not authenticated.`;
  } catch (error) { receiptResult.textContent = `Receipt rejected / ${error.message}. Current workcell unchanged.`; }
  finally { reviewReceipt.disabled = false; receiptFile.value = ''; }
});
function saveExperimentReceipt() {
  try {
    const receipt = faultExperiment.exportReceipt(), url = URL.createObjectURL(new Blob([JSON.stringify(receipt,null,2)], {type:'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = `breakshift-experiment-${receipt.currentSnapshotId}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  } catch (error) { receiptResult.textContent = `Evidence not saved / ${error.message}`; renderExperimentTrace(); }
}
$('#experiment-save').addEventListener('click', saveExperimentReceipt);
function renderExperimentTrace() {
  const state = faultExperiment.state(), latest = state.latest;
  $('#experiment-save').disabled = !state.canExport;
  $('#experiment-state').textContent = !latest ? 'No experiment recorded.' : latest.invalidated ? 'Previous result withdrawn. Re-evaluate the current conditions.' : `${latest.passed ? 'PASS' : 'REJECTED'} / ${latest.title} · ${latest.repair.peakKw.toFixed(3)} kW peak / ${latest.breakerKw.toFixed(2)} kW limit · ${latest.snapshotId}`;
  $('#experiment-state').className = latest && !latest.invalidated ? latest.passed ? 'green' : 'red' : 'scope-note';
  const labels = { BASELINE_CAPTURED:'Recipe captured', COMMAND_RECEIVED:'Limit requested', COMMAND_APPLIED:'Conditions confirmed', RUN_INVALIDATED:'Prior result withdrawn', RUN_EVALUATED:'Checks recomputed', COMMAND_NO_CHANGE:'Conditions unchanged', COMMAND_REJECTED:'Command rejected' };
  $('#experiment-events').innerHTML = state.events.slice(-5).map(e=>`<li><time>${esc(e.at.slice(11,19))}</time><span>${esc(labels[e.type]||e.type)}<small>${esc(e.detail.currentSnapshot||e.detail.snapshotId||e.detail.expectedSnapshot||e.detail.reason||'')}</small></span></li>`).join('');
  experimentRoot.dataset.omittedEvents = String(state.omittedEvents);
}
const sabotageConsole = createSabotageConsole({
  hudEl: $('#reasoning-hud'),
  consoleEl: $('#sabotage-console'),
  getContext: () => ({
    session: envelope.projections.laptop,
    trace,
    view,
    available: connected || !everConnected,
    webglAvailable: spatialXr.getDiagnostics().webglAvailable,
  }),
  applyBreaker: async cap => { if (!await faultExperiment.inject({ breakerKw: cap })) throw Error(faultExperiment.state().error || 'COMMAND_NOT_APPLIED'); },
  selectZone: zoneId => selectZone(zoneId),
  setView: nextView => setView(nextView),
  setCameraPreset: preset => spatialXr.setCameraPreset(preset),
  launchRepairTwin: ({ strategyId }) => runDeterministicRecipeInTwin(strategyId),
  onRecipeEvaluated: (strategyId,snapshotId) => faultExperiment.recordRecipe(strategyId,snapshotId,'DETERMINISTIC_CONSOLE'),
  onCommandRejected: code => faultExperiment.recordRejection(code),
});
$('#repair-twin').addEventListener('breakshift-inject-limit', () => sabotageConsole.executeCommand('drop breaker to 1.45 kW'));
$('#repair-twin').addEventListener('breakshift-replay-current', () => {
  const state = faultExperiment.state();
  if (state.canExport) runDeterministicRecipeInTwin(state.latest.strategyId);
});
window.__breakshiftConsole = sabotageConsole;
const bayJob = createBayJob($('#bay-job'), {
  getContext: () => ({ snapshotId: envelope.evidenceSnapshotId, breakerKw: envelope.projections.laptop.breakerKw, available: connected || !everConnected }),
  prepare: async cap => { if (cap !== undefined) await mutate({ type: 'SET_BREAKER_KW', breakerKw: cap }); setView('workcell'); },
  openRecordedDemo: () => { setView('photo'); $('#photo-demo-track').click(); $('#photo-workspace').scrollIntoView({ block: 'start' }); },
  onResult: result => faultExperiment.recordRecipe(result.strategyId,result.snapshotId,result.compiledPlan.bindings.scanId),
  saveEvidence: saveExperimentReceipt,
  canSaveEvidence: () => faultExperiment.state().canExport,
});

function authHeaders(extra = {}) { return pairToken ? { ...extra, 'x-breakshift-token': pairToken } : { ...extra }; }
function savePairToken(next) { pairToken = next || ''; try { if (pairToken) sessionStorage.setItem('breakshift.pairToken', pairToken); else sessionStorage.removeItem('breakshift.pairToken'); } catch {} }

function showError(message = '') { $('#connection-error').textContent = message; $('#connection-error').hidden = !message; }
function setConnection(value) {
  connected = value;
  everConnected ||= value;
  const needsRoom = pairingDescriptor?.roomCodeRequired && !pairingDescriptor?.paired;
  $('#sync-pill').textContent = value ? '● SHARED SESSION CONNECTED' : needsRoom ? '● ROOM CODE REQUIRED TO PAIR' : everConnected ? '● CONNECTION LOST / RETAINED SNAPSHOT' : '● LOCAL DEMO / SINGLE DEVICE';
  if (hostedPreview) $('#sync-pill').textContent = '● CLOUDFLARE PREVIEW / DEVICE-LOCAL SESSION';
  $('#sync-pill').classList.toggle('stale', !value);
  for (const el of $$('#cap, #sabotage, #zone-select, #download-receipt, [data-layer-toggle]')) el.disabled = everConnected && !value;
  $('#overlay-toggle').disabled = (everConnected && !value) || !envelope.projections.laptop.allSimulatedChecksGreen;
  updateScanButton();
  bayJob.sync();
  renderExperimentTrace();
  sabotageConsole.sync();
  uncertaintyWorkbench.sync();
}

function acceptEnvelope(next, allowRestart = false) {
  if (!next?.projections?.laptop?.twins || !Number.isInteger(next.version)) throw new Error('Invalid session response');
  if (!allowRestart && connected && next.sessionId === envelope.sessionId && next.version < envelope.version) return;
  envelope = next;
  repairPlayer.sync(next.evidenceSnapshotId);
  uncertaintyWorkbench.sync();
  if (next.pairing && pairingDescriptor) {
    pairingDescriptor = { ...pairingDescriptor, ...next.pairing };
  }
  render();
}

function mutate(payload, expectedSnapshotId) {
  pending++;
  mutationQueue = mutationQueue.then(async () => {
    try {
      if (everConnected && !connected) throw new Error('Reconnect to the shared bay before changing this snapshot.');
      if (expectedSnapshotId && expectedSnapshotId !== envelope.evidenceSnapshotId) throw new Error('Evidence changed before this command. Review the current snapshot.');
      const action = { ...payload, surface: surface === 'all' ? 'laptop' : surface, expectedVersion: envelope.version };
      if (connected && !hostedPreview) {
        const response = await fetch('/api/session/mutate', { method: 'POST', headers: authHeaders({ 'content-type': 'application/json' }), body: JSON.stringify(action), signal: AbortSignal.timeout(5000) });
        const body = await response.json();
        if (response.status === 409) { acceptEnvelope(body.currentEnvelope); throw new Error('Another surface changed this session. The latest version is shown; repeat your action.'); }
        if (response.status === 403 && body.error === 'ROOM_CODE_REQUIRED') { savePairToken(''); await refreshPairing(); setConnection(false); throw new Error('Room code rotated or required — enter the 6-character code below to re-pair.'); }
        if (!response.ok) throw new Error(body.error || 'Session change rejected');
        acceptEnvelope(body);
      } else acceptEnvelope(envelopeFor(localSession.mutate(action)));
      showError();
      return envelope;
    } catch (error) { showError(error.message); render(); return null; }
    finally { pending--; }
  });
  return mutationQueue;
}

function selectZone(zoneId) { return mutate({ type: 'SELECT_ZONE', zoneId }); }
function setView(nextView) {
  view = nextView;
  if (view === 'cutaway') mutate({ type: 'SET_CUTAWAY', cutawayOpen: true });
  renderScene();
}

function renderScene() {
  const photoMode=view==='photo';
  $('#photo-workspace').hidden=!photoMode;
  $('#component-workspace .inspection-grid').hidden=photoMode;
  $('#muse-panel').hidden=photoMode;
  $('#trace-select').disabled=photoMode;
  photoInspector.setActive(photoMode);
  $$('[data-view]').filter(el=>el.tagName==='BUTTON').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.view===view)));
  if(photoMode)return;
  const session = envelope.projections.laptop;
  const activeId = session.activeZoneId;
  const active = componentState(activeId, session, trace);
  const pointPart = COMPONENTS[activeId];
  $('#scene').dataset.view = view;
  $('#workcell-image').hidden = view !== 'workcell';
  $('#cutaway-image').hidden = view !== 'cutaway';
  $('#schematic-stage').hidden = view !== 'schematic';
  $('#spatial-stage').hidden = view !== 'spatial';
  if ($('#asset-error')) $('#asset-error').hidden = view === 'schematic' || view === 'spatial';
  $('#scene').classList.toggle('mechanical-hidden', !session.visibleLayers.includes('mechanical'));
  $('#scene-mode').textContent = `${view === 'cutaway' ? 'ROBOT CUTAWAY / STATION A' : view === 'schematic' ? 'SCHEMATIC / DEMO REFERENCE' : view === 'spatial' ? 'SPATIAL 3D / WORKCELL ANCHORS' : 'WORKCELL / COMPONENT MAP'} · ${trace.toUpperCase()}`;
  $('#scene-badge').textContent = view === 'spatial' ? '3D WEBGL / WEBXR STAGE' : view === 'schematic' ? 'DEMO SCHEMATIC' : 'ILLUSTRATED TWIN';
  $$('[data-view]').filter(el => el.tagName === 'BUTTON').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.view === view)));
  const visibleComponents = Object.entries(COMPONENTS).filter(([, part]) => part[view] && session.visibleLayers.includes(part.layer));
  $('#hotspots').innerHTML = visibleComponents.map(([id, part]) => {
    const status = componentState(id, session, trace);
    return `<button class="hotspot ${status.color}" data-zone="${id}" style="left:${part[view][0]}%;top:${part[view][1]}%" aria-label="Inspect ${esc(part.name)}: ${esc(status.label)}" aria-pressed="${id === activeId}">${part.number}</button>`;
  }).join('');
  $('#component-strip').innerHTML = Object.entries(COMPONENTS).map(([id, part]) => {
    const status = componentState(id, session, trace);
    return `<button type="button" class="component-button" data-zone="${id}" aria-pressed="${id === activeId}"><i class="dot ${status.color}"></i><span>${esc(part.short)}<small>${part.number} / ${status.color === 'green' ? 'CHECK PASSED' : status.color === 'red' ? 'FAULT' : 'CONSTRAINED'}</small></span></button>`;
  }).join('');
  const fault = $('#scene-fault');
  fault.className = `scene-fault ${active.color}`;
  fault.textContent = view === 'cutaway' && activeId === 'GANTRY-STB-B' ? 'Station B is shown in the workcell or 3D spatial view; this cutaway depicts Station A.' : `${pointPart.number} / ${active.label} · ${active.metric} ${active.unit}`;
  renderLines(session);
  if (view === 'schematic') renderSchematic();
  spatialXr.updateState({ session, trace, active: view === 'spatial' });
  sabotageConsole.sync();
  renderMuseOverlay();
}

function renderLines(session) {
  const layers = session.visibleLayers;
  const verified = session.repairOverlayMode === 'VERIFIED_SIMULATED_OVERLAY';
  $('#overlay-label').textContent = verified ? 'Solid / verified simulation repair' : 'Dashed / proposed repair';
  const power = view === 'cutaway' ? 'M320 390L320 230L460 100L710 200' : 'M850 140L710 140L710 220L570 260M710 220L880 325';
  const signal = view === 'cutaway' ? 'M590 145L660 180L790 230' : 'M700 355L680 300L570 260';
  const repair = view === 'cutaway' ? 'M650 285L790 230' : 'M700 355L800 355L880 325';
  $('#fault-lines').innerHTML = view === 'schematic' || view === 'spatial' ? '' : `${layers.includes('energy') ? `<path class="power-line" d="${power}"/>` : ''}${layers.includes('electrical') ? `<path class="signal-line" d="${signal}"/>` : ''}${layers.includes('software') ? `<path class="repair-line ${verified ? 'verified-line' : ''}" d="${repair}"/>` : ''}`;
}

function renderSchematic() {
  const session = envelope.projections.laptop;
  const zone = envelope.projections.ipad.activeZoneSchematic;
  const active = componentState(zone.zoneId, session, trace);
  const color = { red: '#ff8777', amber: '#efbe77', green: '#b9e79d' }[active.color];
  const nodes = [
    [180, 155, '48V SOURCE', 'PANEL-BUS-48V'], [500, 155, 'BREAKER / BUS', 'PANEL-BUS-48V'],
    [180, 255, 'OPTICAL GATE', 'JBOX-OPT-S1'], [500, 255, 'TIMING / LOGIC', 'JBOX-OPT-S1'],
    [780, 255, 'ARM A / GRIP', 'GANTRY-STA-A'], [500, 365, 'POWER GUARD', 'PANEL-BUS-48V'], [780, 365, 'ARM B / PICK', 'GANTRY-STB-B']
  ];
  $('#schematic-stage').innerHTML = `${referencePlate(zone.zoneId === 'GANTRY-STA-A' ? 'cutaway' : 'workcell', zone.zoneId === 'GANTRY-STA-A' ? 'Station A / internal assembly' : 'Shared cell / connected systems')}<div class="schematic-drawing" role="region" tabindex="0" aria-label="Demo signal drawing; scroll horizontally on smaller screens"><svg viewBox="70 65 840 365" role="img" aria-label="Demo signal schematic ${esc(zone.schematicRef)} with ${esc(active.label)}"><text x="100" y="85" font-size="15">${esc(zone.schematicRef)} / SIGNAL PATH</text><text x="100" y="106" class="schematic-note" font-size="11">48V DC · SENSOR → TIMING → PLANNER → ACTUATORS</text><g fill="none" stroke="#84917c" stroke-width="2"><path d="M260 155H420M500 180V230M260 255H420M580 255H700M500 280V340M580 365H700"/><path stroke="${color}" d="M500 180V230M580 255H700" stroke-dasharray="${session.repairOverlayMode === 'GHOSTED_PROPOSAL' ? '6 6' : 'none'}"/></g>${nodes.map(([x,y,title,id]) => `<rect x="${x-80}" y="${y-25}" width="160" height="50" rx="3" fill="#1b211b" stroke="${id === zone.zoneId ? color : '#56614a'}" stroke-width="${id === zone.zoneId ? 2 : 1}"/><text x="${x}" y="${y-2}" text-anchor="middle" font-size="12">${title}</text><text x="${x}" y="${y+15}" text-anchor="middle" class="schematic-note" font-size="9">${esc(id)}</text><circle cx="${x-80}" cy="${y}" r="3" fill="#efbe77"/><circle cx="${x+80}" cy="${y}" r="3" fill="#efbe77"/>`).join('')}<text x="100" y="412" class="schematic-note" font-size="11">PANEL ${esc(zone.panelId)} · DEMO REFERENCE</text></svg><p class="schematic-footnote">${esc(zone.pins.join(' · '))}<br>${esc(envelope.evidenceSnapshotId)} · Select a component below to cross-reference.</p></div>`;
  bindReferenceFallback($('#schematic-stage'));
}

function renderDetail() {
  const session = envelope.projections.laptop;
  const zone = envelope.projections.ipad.activeZoneSchematic;
  const part = COMPONENTS[zone.zoneId];
  const status = componentState(zone.zoneId, session, trace);
  const margin = session.breakerKw - session.twins[trace].peakKw;
  $('#component-detail').innerHTML = `<div class="detail-index"><span>COMPONENT / ${part.number}</span><span>${esc(zone.schematicRef)}</span></div><h2 id="component-name">${esc(part.name)}</h2><p class="status-label ${status.color}"><i class="dot ${status.color}"></i>${esc(status.label)}</p><p class="detail-description">${esc(part.description)}</p><div class="detail-metric"><div><span>${esc(status.unit.toUpperCase())}</span><b>${esc(status.metric)}</b></div><div><span>BUS HEADROOM / kW</span><b class="${margin < 0 ? 'red' : 'green'}">${margin.toFixed(3)}</b></div></div><div class="detail-group"><h4>HARDWARE REFERENCE</h4><code>${esc(zone.panelId)}</code><h4>SIGNAL / TERMINAL</h4><code>${esc(zone.pins[0])}<br>${esc(zone.pins[1])}</code></div><div class="detail-group"><h4>CONTROLLER</h4><code>${esc(part.file)}</code><h4>CANDIDATE REPAIR CHECK</h4><p class="check-text">${status.check ? `${status.check.passed ? '✓' : '×'} ${esc(status.check.metricText)}` : 'Station A remains faulted; repair routes work to Station B.'}</p><p class="scope-note">Candidate checks apply to ${esc(envelope.evidenceSnapshotId)}.</p></div><button type="button" class="inspector-action" id="open-schematic">Open linked schematic ↗</button>`;
  const scanAction = document.createElement('button');
  scanAction.type = 'button'; scanAction.id = 'muse-scan'; scanAction.className = 'primary muse-scan-action';
  $('#component-detail').append(scanAction);
  const scanScope = document.createElement('p'); scanScope.className = 'scope-note';
  scanScope.textContent = hostedPreview ? museStatus?.authenticated ? 'Live Muse scans current simulation evidence. Each new scan reserves $0.05 from the shared allowance; matching live results are cached.' : 'Fresh model analysis is restricted to the operator. No account is required for the workbench.' : 'Scans simulation evidence and component references. Up to $0.05 reserved per new Meta API scan; cached results cost no new call.';
  $('#component-detail').append(scanScope);
  updateScanButton();
}

function updateScanButton() {
  const button = $('#muse-scan');
  if (!button) return;
  const cached = museResults.get(scanKey());
  button.disabled = scanBusy || !connected || (!cached && !museStatus?.enabled);
  button.textContent = scanBusy ? 'Muse is analyzing…' : cached ? 'Review Muse scan ↗' : 'Scan component with Muse ↗';
}

function renderMuse() {
  const focusedFix = document.activeElement?.dataset?.museFix;
  const result = museResults.get(scanKey());
  $('#muse-error').hidden = !scanError; $('#muse-error').textContent = scanError;
  const reason = { MUSE_ADAPTER_UNAVAILABLE: 'Muse adapter is unavailable. Component inspection remains available.', MUSE_SCAN_BUDGET_NOT_AVAILABLE: 'Muse adapter is wired. A paid scan budget must be enabled before a new provider request.', MUSE_CREDENTIAL_NOT_CONFIGURED: 'Muse credentials are not configured in the protected server environment.', MUSE_LEDGER_RECONCILIATION_REQUIRED: 'An earlier scan has unresolved delivery or usage. Reconcile its receipt before another paid request.' };
  $('#muse-availability').textContent = scanBusy ? 'Analyzing the selected evidence snapshot…' : result ? `${result.mode === 'TEST_ADAPTER' ? 'TEST ADAPTER / NO PROVIDER CALL' : result.model} · ${result.cached ? 'cached result' : result.mode === 'TEST_ADAPTER' ? 'fixture response' : 'provider response'} · ${result.evidenceSnapshotId} · ${(result.elapsedMs / 1000).toFixed(1)} s` : museStatus ? `${museStatus.mode === 'TEST_ADAPTER' ? 'Test adapter / no provider call. ' : ''}${reason[museStatus.reason] || `${museStatus.model} configured · ${museStatus.remainingScans} budgeted scans remaining.`}` : 'Connecting to Muse adapter…';
  if (hostedPreview) $('#muse-availability').textContent = scanBusy ? 'Muse is diagnosing this component through Cloudflare…' : result?.mode === 'LIVE_MUSE' ? `${result.model} · ${result.cached ? 'cached live diagnosis' : 'LIVE PROVIDER DIAGNOSIS'} · ${result.evidenceSnapshotId}. ${scanAvailability(museStatus)}` : scanAvailability(museStatus);
  if (!result) {
    $('#muse-summary').textContent = 'Select a component and scan its current simulated evidence with Muse. Choose a proposed fix to inspect its effect on the robot.';
    $('#muse-fixes').innerHTML = '<p class="muted">No Muse diagnosis on this component snapshot yet. Earlier results never carry a green status onto changed conditions.</p>';
    $('#muse-evidence').textContent = '';
  } else {
    $('#muse-summary').textContent = result.summary;
    $('#muse-evidence').innerHTML = `<p class="muse-citations">EVIDENCE / ${result.evidenceIds.map(esc).join(' · ')}</p><details><summary>What Muse could not establish</summary><p class="scope-note">${result.limitations.map(esc).join(' ')}</p></details>`;
    if (selectedFix?.key !== scanKey()) selectedFix = { key: scanKey(), id: result.fixes[0].strategyId };
    $('#muse-fixes').innerHTML = result.fixes.map(fix => {
      const evaluation = fix.evaluation;
      const tone = evaluation.passed ? 'green' : evaluation.status === 'PHYSICAL_REVIEW_REQUIRED' ? 'amber' : 'red';
      return `<article class="muse-fix ${selectedFix?.id === fix.strategyId ? 'selected' : ''}"><div class="fix-heading"><h3>${esc(fix.title)}</h3><span class="${tone}">${evaluation.passed ? 'SIMULATION PASSED' : evaluation.status === 'PHYSICAL_REVIEW_REQUIRED' ? 'PHYSICAL REVIEW' : 'SIMULATION REJECTED'}</span></div><p>${esc(fix.explanation)}</p><p class="scope-note">${esc(fix.tradeoff)}</p><div class="fix-footer"><span>${evaluation.peakKw === null ? 'Outcome not modeled' : `${evaluation.peakKw.toFixed(3)} kW · ${evaluation.packed}/${evaluation.orderCount} packed`}</span><button type="button" data-muse-fix="${esc(fix.strategyId)}" aria-pressed="${selectedFix?.id === fix.strategyId}">Preview on robot ↗</button><button type="button" data-run-fix="${esc(fix.strategyId)}" ${evaluation.status === 'PHYSICAL_REVIEW_REQUIRED' ? 'disabled' : ''}>${evaluation.status === 'PHYSICAL_REVIEW_REQUIRED' ? 'Not modeled' : 'Run in Repair Twin ↗'}</button></div></article>`;
    }).join('');
  }
  updateScanButton(); renderMuseOverlay();
  if (focusedFix) document.querySelector(`[data-muse-fix="${focusedFix}"]`)?.focus({ preventScroll: true });
}

function renderMuseOverlay() {
  const annotations = $('#muse-annotations'); const lines = $('#muse-repair-lines');
  annotations.textContent = ''; lines.innerHTML = '';
  const result = showMuseOverlay ? museResults.get(scanKey()) : null;
  const fix = result?.fixes.find(item => item.strategyId === selectedFix?.id);
  if (!fix || result.stale || scanBusy) return;
  const points = view === 'spatial' ? [] : fix.affectedZoneIds.map(id => COMPONENTS[id]?.[view]).filter(Boolean);
  const focus = view === 'spatial' ? [22, 24] : (COMPONENTS[result.zoneId]?.[view] || points[0]);
  if (!focus) return;
  const color = fix.evaluation.passed ? '#b9e79d' : fix.evaluation.status === 'PHYSICAL_REVIEW_REQUIRED' ? '#efbe77' : '#ff8777';
  lines.innerHTML = points.map(point => `<circle cx="${point[0]*10}" cy="${point[1]*5}" r="28" stroke="${color}"/><path d="M${focus[0]*10} ${focus[1]*5}L${point[0]*10} ${point[1]*5}" style="stroke:${color};stroke-dasharray:4 5"/>`).join('');
  const note = document.createElement('div'); note.className = 'muse-callout';
  note.style.borderColor = color;
  const badge = document.createElement('small'); badge.textContent = result.mode === 'RECORDED_MUSE_PREVIEW' ? 'RECORDED MUSE / SIMULATED' : result.mode === 'TEST_ADAPTER' ? 'TEST PROPOSAL / SIMULATED' : 'LIVE MUSE PROPOSAL / SIMULATED';
  const title = document.createElement('select'); title.className = 'muse-fix-picker';
  title.setAttribute('aria-label', 'Choose a Muse fix on the robot');
  for (const optionFix of result.fixes) { const option = document.createElement('option'); option.value = optionFix.strategyId; option.textContent = optionFix.title; title.append(option); }
  title.value = fix.strategyId;
  title.addEventListener('change', () => { selectedFix = { key: scanKey(), id: title.value }; renderMuse(); $('#muse-annotations select')?.focus({ preventScroll: true }); });
  const status = document.createElement('span'); status.style.color = color;
  status.textContent = fix.evaluation.passed ? `✓ ${fix.evaluation.peakKw.toFixed(3)} kW · ${fix.evaluation.packed}/${fix.evaluation.orderCount} packed` : fix.evaluation.status === 'PHYSICAL_REVIEW_REQUIRED' ? 'Physical outcome not modeled' : '× Rejected by simulation';
  const runButton = document.createElement('button'); runButton.type = 'button';
  runButton.dataset.runFix = fix.strategyId; runButton.textContent = 'Run fix in Repair Twin ↗';
  runButton.disabled = fix.evaluation.status === 'PHYSICAL_REVIEW_REQUIRED';
  if (runButton.disabled) runButton.textContent = 'Physical repair is not modeled';
  note.append(badge, title, status, runButton); annotations.append(note);
}

function runFix(strategyId) {
  const diagnosis = museResults.get(scanKey());
  const fix = diagnosis?.fixes.find(item => item.strategyId === strategyId);
  try {
    if (!diagnosis || scanBusy) throw new Error('Choose a current Muse proposal first.');
    selectedFix = { key: scanKey(), id: strategyId }; showMuseOverlay = true;
    launchRepairTwin(fix, diagnosis);
    renderMuse();
  } catch (error) { scanError = error.message; renderMuse(); }
}

async function refreshMuseStatus() {
  try { const response = await fetch('/api/muse/status'); if (!response.ok) throw new Error(); const next = await response.json(); if (hostedPreview && Boolean(next.authenticated) !== Boolean(museStatus?.authenticated)) { museResults.clear(); cacheRequestKey = null; } museStatus = next; }
  catch { museStatus = { enabled: false, reason: 'MUSE_ADAPTER_UNAVAILABLE' }; }
  renderMuse();
  if (hostedPreview) { $('#tester-access-form').hidden = !operatorView; $('#tester-access-status').textContent = scanAvailability(museStatus); renderDetail(); findCachedScan(); }
  photoInspector.setStatus();
}
function receiveDiagnosis(result) {
  if (!result?.zoneId || !Array.isArray(result.fixes)) return;
  if (hostedPreview && museStatus?.authenticated && result.mode !== 'LIVE_MUSE') return;
  if (result.stale || result.evidenceSnapshotId !== envelope.evidenceSnapshotId) { scanError = 'The bay changed during the scan. That result is retained but cannot overlay the current snapshot. Scan the new conditions.'; renderMuse(); return; }
  museResults.set(scanKey(result.zoneId, result.evidenceSnapshotId), result);
  if (result.zoneId === envelope.projections.laptop.activeZoneId) { selectedFix = { key: scanKey(), id: result.fixes[0].strategyId }; renderMuse(); }
}
async function findCachedScan() {
  if (!connected || museResults.has(scanKey()) || cacheRequestKey === scanKey()) return;
  cacheRequestKey = scanKey();
  const key = cacheRequestKey;
  const authenticatedAtStart = Boolean(museStatus?.authenticated);
  try { const response = await fetch(`/api/muse/result?zoneId=${encodeURIComponent(envelope.projections.laptop.activeZoneId)}&snapshotId=${encodeURIComponent(envelope.evidenceSnapshotId)}`); if (response.ok) { const data = await response.json(); if (data.result && key === scanKey() && authenticatedAtStart === Boolean(museStatus?.authenticated)) receiveDiagnosis(data.result); } }
  catch { /* Cached result discovery cannot disable component inspection. */ }
}
async function scanWithMuse() {
  const cached = museResults.get(scanKey());
  if (cached) { showMuseOverlay = true; renderMuse(); $('#muse-panel').scrollIntoView({ block: 'nearest' }); return; }
  if (!connected || !museStatus?.enabled || scanBusy) return;
  scanBusy = true; scanError = ''; renderMuse();
  const request = hostedPreview ? { zoneId: envelope.projections.laptop.activeZoneId, snapshotId: envelope.evidenceSnapshotId, breakerKw: envelope.projections.laptop.breakerKw, requestId: crypto.randomUUID(), consent: museStatus.consent } : { zoneId: envelope.projections.laptop.activeZoneId, snapshotId: envelope.evidenceSnapshotId, requestToken: museStatus.requestToken, consent: museStatus.consent };
  try {
    const response = await fetch('/api/muse/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(55000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'MUSE_SCAN_UNAVAILABLE');
    receiveDiagnosis(result);
  } catch (error) { scanError = error.message === 'MUSE_STALE_COMPONENT_SNAPSHOT' ? 'The bay changed before Muse started. Scan the current conditions.' : `Muse scan did not complete (${error.message}). No repair was applied.`; }
  finally { scanBusy = false; await refreshMuseStatus(); renderMuse(); }
}

function renderWave() {
  const s = envelope.projections.laptop;
  const colors = { working: '#ff8777', repair: '#dbfa86', challenger: '#9fb6e9' };
  const maxKw = Math.max(3.3, s.breakerKw + .25);
  const y = kw => 137 - kw / maxKw * 117;
  const x = t => 36 + t / 1200 * 680;
  const lines = Object.entries(s.twins).map(([name, result]) => `<polyline fill="none" stroke="${colors[name]}" stroke-width="${name === trace ? 2.6 : 1.3}" opacity="${name === trace ? 1 : .6}" points="${result.waveform.map(p => `${x(p.timeMs)},${y(p.kw)}`).join(' ')}"/>`).join('');
  $('#wave').innerHTML = `<svg viewBox="0 0 750 170" preserveAspectRatio="none" aria-hidden="true">${[0,1,2,3].map(kw => `<path d="M36 ${y(kw)}H720" stroke="#343a2d" stroke-width=".8"/><text x="4" y="${y(kw)+3}">${kw}.0</text>`).join('')}<path d="M36 ${y(s.breakerKw)}H720" stroke="#efbe77" stroke-dasharray="5 5"/>${lines}<text x="36" y="160">0 ms</text><text x="337" y="160">600 ms</text><text x="676" y="160">1200 ms</text></svg>`;
  $('#wave-summary').textContent = `${s.breakerKw.toFixed(2)} kW ceiling · ${s.twins[trace].socWh.toFixed(3)} Wh buffer`;
  $('#twins').innerHTML = Object.entries(s.twins).map(([name,result]) => `<article class="twin"><header><i class="dot ${result.breakerTrip ? 'red' : 'green'}"></i>${name.toUpperCase()}</header><div class="twin-peak" style="color:${colors[name]}">${result.peakKw.toFixed(3)} <small>kW</small></div><p>${result.packed}/${result.orderCount} packed · ${result.breakerTrip ? 'TRIPPED' : 'POWER OK'}<br>${result.whPerPart ?? '—'} Wh/part · ${result.throughputPerMin} orders/min</p></article>`).join('');
}

function renderSurfaces() {
  const { laptop: s, ipad, glasses } = envelope.projections;
  const selectedEvidence = s.observations.filter(item => item.zoneId === s.activeZoneId);
  const selectedHypotheses = s.hypotheses.filter(item => item.zoneId === s.activeZoneId);
  $('#laptop-evidence').innerHTML = [...selectedEvidence.map(item => `<div class="evidence-item"><small>SIMULATION EVIDENCE / ${esc(item.id)}</small><p>${esc(item.summary)}</p></div>`), ...selectedHypotheses.map(item => `<div class="evidence-item"><small>DIAGNOSTIC HYPOTHESIS / DEMO</small><p>${esc(item.summary)}</p></div>`)].join('') || '<p>No fault evidence for this component. Review the named handoff check.</p>';
  $('#compiler-verdict').textContent = `REFERENCE RECIPE / ${s.allSimulatedChecksGreen ? 'PASSED' : 'REJECTED'} · ${s.compilerReceipt.testsPassed} checks · ${s.compilerReceipt.partsCompleted} packed`;
  $('#compiler-verdict').style.color = s.allSimulatedChecksGreen ? 'var(--lime)' : 'var(--red)';
  $('#diff').textContent = s.compilerReceipt.changedFiles.map(file => `${file.path}\n  ${file.change}`).join('\n\n') + '\n\nDeterministic controller recipe summary. Muse diagnosis is separate from code synthesis.\n' + (s.compilerReceipt.signatureBase64 ? 'Receipt signed by this local server’s ephemeral Ed25519 key.' : 'Local preview receipt is unsigned.');
  $('#zone-select').innerHTML = ipad.availableZones.map(zone => `<option value="${esc(zone.zoneId)}">${esc(COMPONENTS[zone.zoneId].name)}</option>`).join('');
  $('#zone-select').value = ipad.activeZoneId;
  const z = ipad.activeZoneSchematic;
  $('#ipad-schematic').innerHTML = `<div class="field-reference">DEMO REFERENCE / <code>${esc(z.schematicRef)}</code><br>PANEL / <code>${esc(z.panelId)}</code><br>${z.pins.map(pin => `<code>${esc(pin)}</code>`).join('<br>')}<br>${z.cables.map(cable => `<code>${esc(cable)}</code>`).join('<br>')}</div>`;
  $('#ipad-checklist').innerHTML = ipad.checklist.map(item => `<label class="checklist-item"><input type="checkbox" data-check-id="${esc(item.id)}" ${item.completed ? 'checked' : ''} ${everConnected && !connected ? 'disabled' : ''}><span>${esc(item.label)}${item.completed ? '<small> · recorded on this snapshot</small>' : ''}</span></label>`).join('');
  $('#ipad-banner').textContent = 'Illustrative panel IDs and terminals; checklist records demo actions only. Changing the evidence snapshot clears completed items.';
  $('#glasses-warning').textContent = `Spatial preview · ${glasses.evidenceSnapshotId} · component anchor ${glasses.focusedAnchorId}`;
  $('#glasses-callouts').innerHTML = glasses.spatialCallouts.map(callout => `<div class="callout ${callout.color.startsWith('green') ? 'green' : callout.color === 'red' ? 'red' : 'amber'}"><small>${esc(callout.anchorId)}</small><p><strong>${esc(callout.label)}</strong></p><p>${esc(callout.detail)}</p></div>`).join('');
  $$('[data-surface]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.surface === surface)));
  $$('[data-surface-panel]').forEach(panel => panel.hidden = surface !== 'all' && panel.dataset.surfacePanel !== surface);
  $('#surfaces-container').style.gridTemplateColumns = surface === 'all' ? '' : 'minmax(0, 1fr)';
}

function formatRoster(counts) {
  if (!counts) return 'Local demo';
  const parts = [];
  const wb = (counts.laptop || 0) + (counts.all || 0);
  if (wb) parts.push(`${wb} workbench`);
  if (counts.ipad) parts.push(`${counts.ipad} tablet`);
  if (counts.glasses) parts.push(`${counts.glasses} spatial`);
  return `${counts.total} live${parts.length ? ` (${parts.join(' · ')})` : ''}`;
}

function renderPairing() {
  if (hostedPreview) { $('#pairing-panel').hidden = true; return; }
  $('#qr-target-select').value = qrTarget;
  if (!pairingDescriptor) {
    $('#room-code-badge').textContent = 'LOCAL';
    $('#peer-roster').textContent = connected ? 'Connected' : 'Single-device local demo';
    $('#join-url-code').textContent = location.origin + location.pathname;
    $('#qr-svg-box').textContent = 'LOCAL DEMO';
    $('#qr-caption').textContent = 'OFFLINE PREVIEW';
    $('#rotate-room-code').hidden = true;
    return;
  }
  if (pairingDescriptor.roomCodeRequired && !pairingDescriptor.paired) {
    $('#room-code-badge').textContent = 'LOCKED';
    $('#peer-roster').textContent = `${formatRoster(pairingDescriptor.connectedCounts)} · enter host code`;
    $('#join-url-code').textContent = 'Enter the 6-character bay room code (BS-XXXX) shown on the host workbench to pair this surface.';
    $('#qr-svg-box').textContent = 'ENTER HOST CODE';
    $('#qr-caption').textContent = 'ROOM AUTH REQUIRED';
    $('#pairing-notice').textContent = pairingDescriptor.lanReachableNotice || '';
    $('#rotate-room-code').hidden = true;
    return;
  }
  $('#room-code-badge').textContent = pairingDescriptor.roomCode || 'LOCAL';
  $('#peer-roster').textContent = `${formatRoster(pairingDescriptor.connectedCounts)} · ${pairingDescriptor.bindMode === 'LAN_PAIRING_ENABLED' ? 'LAN Wi-Fi active' : 'loopback safe mode'}`;
  const target = pairingDescriptor.surfaces?.[qrTarget] || pairingDescriptor.surfaces?.ipad;
  if (target) {
    $('#join-url-code').textContent = target.joinUrl;
    $('#qr-svg-box').innerHTML = target.qrSvg;
    $('#qr-caption').textContent = qrTarget === 'ipad' ? 'SCAN FOR TABLET' : qrTarget === 'glasses' ? 'SCAN FOR SPATIAL 3D' : 'SCAN FOR LAPTOP';
  }
  $('#pairing-notice').textContent = pairingDescriptor.lanReachableNotice || '';
  $('#rotate-room-code').hidden = Boolean(pairToken);
}

async function refreshPairing() {
  try {
    const res = await fetch('/api/pairing', { headers: authHeaders(), signal: AbortSignal.timeout(3500) });
    if (res.ok) pairingDescriptor = await res.json();
  } catch { /* Offline demo keeps pairingDescriptor null */ }
  renderPairing();
}

function render() {
  const focused = document.activeElement;
  const focusZone = focused?.dataset?.zone;
  const focusIsSpatialPin = focused?.classList?.contains('spatial-pin');
  const focusCheck = focused?.dataset?.checkId;
  const s = envelope.projections.laptop;
  $('#mission-id').textContent = envelope.sessionId;
  $('#mission-version').textContent = `v${envelope.version}`;
  $('#mission-snapshot').textContent = envelope.evidenceSnapshotId;
  $('#cap').value = s.breakerKw;
  $('#cap-label').value = `${s.breakerKw.toFixed(2)} kW`;
  $$('[data-layer-toggle]').forEach(input => input.checked = s.visibleLayers.includes(input.dataset.layerToggle));
  $('#overlay-toggle').textContent = !s.allSimulatedChecksGreen ? 'Repair blocked by constraint' : s.repairOverlayMode === 'GHOSTED_PROPOSAL' ? 'Show simulator-verified repair' : 'Show proposed repair';
  renderScene(); renderDetail(); renderWave(); renderSurfaces(); renderPairing(); setConnection(connected);
  renderMuse(); findCachedScan();
  if (focusZone && !focusIsSpatialPin) document.querySelector(`.component-button[data-zone="${focusZone}"]`)?.focus({ preventScroll: true });
  if (focusCheck) document.querySelector(`[data-check-id="${focusCheck}"]`)?.focus({ preventScroll: true });
}

document.addEventListener('click', event => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.zone) selectZone(target.dataset.zone);
  if (target.id === 'muse-scan') scanWithMuse();
  if (target.dataset.museFix) { selectedFix = { key: scanKey(), id: target.dataset.museFix }; showMuseOverlay = true; renderMuse(); }
  if (target.dataset.runFix) runFix(target.dataset.runFix);
  if (target.dataset.view) setView(target.dataset.view);
  if (target.dataset.cam) spatialXr.setCameraPreset(target.dataset.cam);
  if (target.id === 'open-schematic') { setView('schematic'); $('#component-workspace').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }
  if (target.id === 'open-spatial') { setView('spatial'); $('#component-workspace').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }
  if (target.dataset.surface) { surface = target.dataset.surface; renderSurfaces(); }
});
$('#qr-target-select').addEventListener('change', event => { qrTarget = event.target.value; renderPairing(); });
$('#copy-join-url').addEventListener('click', async () => {
  const urlText = $('#join-url-code').textContent;
  try { await navigator.clipboard?.writeText(urlText); $('#copy-join-url').textContent = 'Copied ✓'; setTimeout(() => { $('#copy-join-url').textContent = 'Copy link'; }, 1400); } catch {}
});
$('#rotate-room-code').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/pairing/rotate', { method: 'POST', signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error('Only the host loopback workbench can rotate the room code.');
    pairingDescriptor = await res.json();
    renderPairing();
    showError();
  } catch (error) { showError(error.message); }
});
$('#pair-join-form').addEventListener('submit', async event => {
  event.preventDefault();
  const code = $('#join-code-input').value.trim();
  if (!code) return;
  try {
    const res = await fetch('/api/pairing/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roomCode: code, surface: surface === 'all' ? 'ipad' : surface }),
      signal: AbortSignal.timeout(4000),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error === 'TOO_MANY_PAIRING_ATTEMPTS' ? 'Too many pairing attempts. Wait 60 seconds and retry.' : 'Invalid room code. Enter the 6-character BS-XXXX code displayed on the host workbench.');
    savePairToken(body.pairToken);
    $('#join-code-input').value = '';
    showError();
    await connect(true);
  } catch (error) { showError(error.message); }
});
$('#trace-select').addEventListener('change', event => { trace = event.target.value; renderScene(); renderDetail(); renderWave(); });
$('#cap').addEventListener('input', event => { $('#cap-label').value = `${Number(event.target.value).toFixed(2)} kW`; });
$('#cap').addEventListener('change', event => mutate({ type: 'SET_BREAKER_KW', breakerKw: Number(event.target.value) }));
$('#sabotage').addEventListener('click', async () => { await mutate({ type: 'SET_BREAKER_KW', breakerKw: Number($('#cap').value) }); $('#run-status').textContent = `Scenario evaluated · ${envelope.evidenceSnapshotId} · ${envelope.projections.laptop.allSimulatedChecksGreen ? 'repair passed' : 'repair rejected'}`; });
$('#overlay-toggle').addEventListener('click', () => { const verified = envelope.projections.laptop.repairOverlayMode !== 'VERIFIED_SIMULATED_OVERLAY'; trace = verified ? 'repair' : 'working'; $('#trace-select').value = trace; mutate({ type: 'SET_REPAIR_OVERLAY_MODE', mode: verified ? 'VERIFIED_SIMULATED_OVERLAY' : 'GHOSTED_PROPOSAL' }); });
$('#zone-select').addEventListener('change', event => selectZone(event.target.value));
$('#ipad-checklist').addEventListener('change', event => { if (event.target.dataset.checkId) mutate({ type: 'TOGGLE_CHECKLIST_ITEM', itemId: event.target.dataset.checkId }); });
$$('[data-layer-toggle]').forEach(input => input.addEventListener('change', () => { const visibleLayers = $$('[data-layer-toggle]:checked').map(el => el.dataset.layerToggle); if (!visibleLayers.length) { input.checked = true; showError('Keep at least one inspection layer visible.'); return; } mutate({ type: 'SET_CUTAWAY', visibleLayers }); }));
$('#download-receipt').addEventListener('click', async () => { await mutationQueue; const receipt = { schema:'breakshift.session-snapshot-export.v1',snapshotId:envelope.evidenceSnapshotId,version:envelope.version,selectedZone:envelope.projections.laptop.activeZoneId,referenceRecipeProjection:envelope.projections.laptop.compilerReceipt,selectedRepairVerified:false,physicalClearance:false,scope:'Reference recipe and session snapshot only. This is not the selected repair result; its experiment evidence is separate.' }; const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `breakshift-session-v${envelope.version}-${envelope.evidenceSnapshotId}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
function reportMissingImage() {
  if ($('#asset-error')) return;
  const note = document.createElement('div');
  note.id = 'asset-error'; note.className = 'image-error';
  note.textContent = 'Illustration unavailable. Select Schematic or Spatial 3D to continue inspecting the same component and evidence.';
  note.hidden = view === 'schematic' || view === 'spatial';
  $('#scene').append(note);
}
$$('.scene-image').forEach(image => {
  image.addEventListener('error', reportMissingImage);
  if (image.complete && image.naturalWidth === 0) reportMissingImage();
});

async function connect(skipAutoRoom = false) {
  if (hostedPreview) {
    setConnection(true);
    acceptEnvelope(envelopeFor(localSession.mutate({ type: 'SELECT_ZONE', zoneId: 'GANTRY-STA-A', surface: 'laptop', expectedVersion: localSession.getState().version })));
    $('#mission-id').textContent = 'Public preview / this browser';
    return;
  }
  if (!skipAutoRoom && initialRoomCode) {
    try {
      const joinRes = await fetch('/api/pairing/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomCode: initialRoomCode, surface: surface === 'all' ? 'ipad' : surface }),
        signal: AbortSignal.timeout(4000),
      });
      if (joinRes.ok) { const joined = await joinRes.json(); savePairToken(joined.pairToken); }
    } catch { /* Offline fallback handled below */ }
  }
  await refreshPairing();
  if (pairingDescriptor?.roomCodeRequired && !pairingDescriptor?.paired) {
    setConnection(false); render(); return;
  }
  try {
    const response = await fetch('/api/session', { headers: authHeaders(), signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('Shared session unavailable');
    const body = await response.json(); setConnection(true); acceptEnvelope(body, true);
  } catch { setConnection(false); render(); }
  if (typeof EventSource !== 'function') return;
  if (activeStream) { activeStream.close(); activeStream = null; }
  const streamQuery = new URLSearchParams({ surface, ...(pairToken ? { token: pairToken } : {}) });
  const stream = new EventSource(`/api/session/stream?${streamQuery.toString()}`);
  activeStream = stream;
  stream.addEventListener('pairing-roster', event => {
    try { const summary = JSON.parse(event.data); pairingDescriptor = pairingDescriptor ? { ...pairingDescriptor, ...summary } : summary; renderPairing(); } catch {}
  });
  stream.addEventListener('muse-diagnosis', event => { try { receiveDiagnosis(JSON.parse(event.data)); refreshMuseStatus(); } catch { scanError = 'Muse diagnosis could not be displayed.'; renderMuse(); } });
  stream.onmessage = event => { try { const next = JSON.parse(event.data); const reconnected = !connected; setConnection(true); acceptEnvelope(next, reconnected); } catch { showError('Session data could not be read. The last inspection snapshot is retained.'); } };
  stream.onerror = () => setConnection(false);
}
async function unlockTester(accessCode) {
  const response=await fetch('/api/muse/access',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accessCode}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('Tester access was not accepted. Use the private access link or code supplied by Brandon.');
  $('#tester-access-code').value='';
  await refreshMuseStatus();
}
if(hostedPreview) $('#tester-access-form').addEventListener('submit',async event=>{
  event.preventDefault();
  try{await unlockTester($('#tester-access-code').value.trim());showError();}catch(error){showError(error.message);}
});
window.addEventListener('pagehide', () => { if (activeStream) activeStream.close(); }, { once: true });
render(); connect();
if(hostedPreview && location.hash.startsWith('#access=')) {
  const accessCode=location.hash.slice(8);
  history.replaceState(null,'',`${location.pathname}${location.search}#component-workspace`);
  unlockTester(accessCode).catch(error=>{showError(error.message);refreshMuseStatus();});
} else refreshMuseStatus();
