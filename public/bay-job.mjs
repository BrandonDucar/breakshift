import { executeRepairRun } from '../simulator/repair-run.mjs';

const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const titles = { station_handoff: 'Faulted line', surge_interleave: 'Power-only fix', timing_compensation: 'Timing-only fix', coordinated_repair: 'Coordinated fix' };

export function scanAvailability(status) {
  if (!status) return 'Checking live analysis availability.';
  if (status.reason === 'LOCAL_PREVIEW_NO_PROVIDER') return 'Local review build. Live analysis disabled; demo job and recorded results are available.';
  if (status.reason === 'MUSE_LEDGER_RECONCILIATION_REQUIRED') return 'Live analysis paused: a prior scan needs operator review. No new scan will be sent. Demo job and recorded results are available.';
  if (status.reason === 'MUSE_SCAN_BUDGET_NOT_AVAILABLE') return 'Shared scan allowance exhausted. Demo job and recorded results are available.';
  if (status.enabled) return `Live analysis available. ${status.remainingScans ?? 0} shared scans remaining.`;
  if (status.authenticated === false) return 'Open access. Live model analysis is restricted.';
  return 'Live analysis unavailable. Demo job and recorded results are available.';
}

export function scanFailure(error) {
  const message = String(error?.message ?? error);
  if (message.includes('MUSE_PHOTO_BOX_OUT_OF_RANGE')) return 'The model returned invalid image coordinates. Assessment rejected; no repair was applied. A receipt review is needed before another paid scan.';
  if (message.includes('MUSE_LEDGER_RECONCILIATION_REQUIRED')) return 'A prior scan needs operator review. No new scan was sent. The recorded inspection remains available.';
  return `Image assessment did not complete (${message}). No physical repair was applied.`;
}

export function evaluateBayJob({ strategyId, breakerKw, snapshotId, scanId = 'DETERMINISTIC_DEMO_JOB' }) {
  const run = executeRepairRun({ strategyId, breakerKw, snapshotId, scanId });
  const blockers = [];
  if (run.repair.breakerTrip || run.challenger.breakerTrip) blockers.push('Breaker limit exceeded in at least one modeled scenario.');
  if (run.repair.packed !== run.repair.orderCount || run.challenger.packed !== run.challenger.orderCount) blockers.push('The full order queue was not completed in both scenarios.');
  if (run.repair.socWh <= 0 || run.challenger.socWh <= 0) blockers.push('Energy buffer depleted.');
  return {
    schema: 'breakshift.demo-job-result.v1', source: 'DETERMINISTIC_DEMO_RECIPE', modelCalls: 0,
    snapshotId, strategyId, title: titles[strategyId], breakerKw, passed: run.passed, compiledPlan: run.compiledPlan,
    repair: { peakKw: run.repair.peakKw, packed: run.repair.packed, orders: run.repair.orderCount },
    challenger: { peakKw: run.challenger.peakKw, packed: run.challenger.packed, orders: run.challenger.orderCount },
    blockers, changes: run.changes,
    scope: 'SIMULATED_WORKCELL_ENERGY_MODEL. Station A remains faulted; work is rerouted, not physically repaired. No model-authored code or equipment commands were executed.',
  };
}

export function bayJobReport(result) {
  if (!result || result.schema !== 'breakshift.demo-job-result.v1') throw Error('DEMO_JOB_RESULT_REQUIRED');
  const e = escape;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BREAKSHIFT service-plan report</title>
    <style>body{font:16px/1.6 system-ui;margin:32px auto;padding:0 24px;max-width:820px;color:#1c2424}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:10px;border-bottom:1px solid #ccd4d4}code{overflow-wrap:anywhere}h1{font-size:28px}small{color:#485656}</style>
    <h1>BREAKSHIFT / service-plan report</h1><p><strong>${result.passed ? 'PASSED MODELED CHECKS' : 'REJECTED BY MODELED CHECKS'}</strong> · ${e(result.title)}</p>
    <p>Snapshot: <code>${e(result.snapshotId)}</code><br>Breaker ceiling: ${e(result.breakerKw)} kW</p>
    <table><tr><th>Scenario</th><th>Peak power</th><th>Orders completed</th></tr>${['repair', 'challenger'].map(k => `<tr><td>${e(k)}</td><td>${e(result[k].peakKw)} kW</td><td>${e(result[k].packed)}/${e(result[k].orders)}</td></tr>`).join('')}</table>
    <h2>Decision</h2><p>${result.passed ? 'The selected recipe completed both modeled scenarios within their power limits. This is not physical service clearance.' : result.blockers.map(e).join(' ')}</p>
    <h2>Controller recipe</h2><table><tr><th>Parameter</th><th>Before</th><th>Candidate</th></tr>${result.changes.map(c => `<tr><td>${e(c.label)}<br><small>${e(c.path)}</small></td><td>${e(c.before)}</td><td>${e(c.after)}</td></tr>`).join('')}</table>
    <h2>Compiled plan</h2><p><code>${e(result.compiledPlan?.planDigest)}</code><br>Proposal: <code>${e(result.compiledPlan?.bindings.scanId)}</code></p>
    <h2>Evidence scope</h2><p>${e(result.scope)}</p><p>Deterministic demo recipe. Zero model calls. Source files unchanged. Unsigned local report, not an independent certification.</p></html>`;
}

export function createBayJob(root, { getContext, prepare, openRecordedDemo, onResult = () => {}, saveEvidence = () => {}, canSaveEvidence = () => false }) {
  let phase = 0, result = null, busy = false;
  const stages = [
    { action: 'Start demo job', strategyId: 'station_handoff', cap: 1.65 },
    { action: 'Test power-only fix', strategyId: 'surge_interleave' },
    { action: 'Test coordinated fix', strategyId: 'coordinated_repair' },
    { action: 'Stress at 1.45 kW', strategyId: 'coordinated_repair', cap: 1.45 },
    { action: 'Restore 1.65 kW', strategyId: 'coordinated_repair', cap: 1.65 },
  ];
  root.innerHTML = `<div class="bay-job-heading"><div><p class="eyebrow">DEMO JOB / 01 · NO UPLOAD REQUIRED</p><h2>Recover 8 orders without tripping the breaker.</h2></div><span class="job-tag">SIMULATION · NO API COST</span></div><ol id="job-progress" class="job-progress" aria-label="Repair job progress"></ol><div class="job-actions"><button type="button" class="primary" id="job-next">Start demo job</button><button type="button" id="job-recorded">Recorded camera result</button><button type="button" id="job-download" disabled>Download service plan</button><button type="button" id="job-save-evidence" disabled>Save repair evidence</button><button type="button" id="job-restart" hidden>Restart demo job</button></div><div id="job-outcome" role="status" aria-live="polite"><p>Station A has a gripper fault. The shared power ceiling is 1.65 kW.</p></div><p id="job-freshness" class="scope-note"></p>`;
  const q = selector => root.querySelector(selector);
  function sync() {
    const context = getContext();
    const stale = result && result.snapshotId !== context.snapshotId;
    q('#job-download').disabled = !result || stale || busy;
    q('#job-next').disabled = busy || !context.available || phase === stages.length;
    q('#job-save-evidence').disabled = !result || stale || busy || !canSaveEvidence();
    q('#job-restart').hidden = phase !== stages.length;
    q('#job-next').textContent = phase === stages.length ? 'Demo complete' : stages[phase].action;
    q('#job-progress').innerHTML = ['Fault','Power','Repair','Stress','Restore'].map((label,index) => `<li ${index === phase ? 'aria-current="step"' : ''} data-complete="${index < phase}">${index+1} / ${label}</li>`).join('');
    q('#job-freshness').textContent = stale ? 'Conditions changed. This result is retained, not current. Run a current check before export.' : phase === stages.length ? 'Complete / five checks finished. Restored plan passes both scenarios; report and evidence are ready. Physical service remains unverified.' : result ? 'Deterministic recipe, not a new AI scan. Station A still requires physical service.' : '';
  }
  q('#job-next').addEventListener('click', async () => {
    if (busy || phase === stages.length) return;
    busy = true; sync();
    try {
      const stage = stages[phase % stages.length];
      await prepare(stage.cap);
      const context = getContext();
      if (!context.available || (stage.cap !== undefined && context.breakerKw !== stage.cap)) throw Error('Session unavailable or conditions changed. Reconnect before continuing.');
      result = evaluateBayJob({ strategyId: stage.strategyId, ...context });
      onResult(result);
      phase++;
      const r = result;
      q('#job-outcome').innerHTML = `<div class="job-result-head"><strong class="${r.passed ? 'green' : 'red'}">${r.passed ? 'PASSED MODELED CHECKS' : 'REJECTED BY MODELED CHECKS'}</strong><span>${escape(r.title)} · ${r.breakerKw.toFixed(2)} kW limit</span></div><dl class="job-metrics"><div><dt>ORDERS / CANDIDATE</dt><dd>${r.repair.packed}/${r.repair.orders}</dd></div><div><dt>PEAK / CANDIDATE</dt><dd>${r.repair.peakKw.toFixed(3)} kW</dd></div><div><dt>ORDERS / CHALLENGER</dt><dd>${r.challenger.packed}/${r.challenger.orders}</dd></div></dl><p>${r.passed ? 'Both modeled scenarios complete the queue. Work moves to Station B; Station A is not repaired.' : r.blockers.map(escape).join(' ')}</p>${r.strategyId === 'surge_interleave' ? '<p>The power fix alone is incomplete: belt timing and the faulted station still need attention.</p>' : ''}`;
    } catch (error) { q('#job-outcome').textContent = error.message; }
    finally { busy = false; sync(); }
  });
  q('#job-recorded').addEventListener('click', openRecordedDemo);
  q('#job-save-evidence').addEventListener('click', () => { if(result && result.snapshotId === getContext().snapshotId && canSaveEvidence())saveEvidence(); });
  q('#job-restart').addEventListener('click', () => { phase = 0; result = null; q('#job-outcome').textContent = 'New demo job / ready to reproduce the fault.'; sync(); });
  q('#job-download').addEventListener('click', () => {
    if (!result || result.snapshotId !== getContext().snapshotId) { sync(); return; }
    const url = URL.createObjectURL(new Blob([bayJobReport(result)], { type: 'text/html' }));
    const a = document.createElement('a'); a.href = url; a.download = `breakshift-service-plan-${result.snapshotId}.html`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  sync(); return { sync };
}
