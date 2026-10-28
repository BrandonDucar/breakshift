// Deterministic Live Perturbation Compiler & REASONING STEPS HUD.
// Zero model calls, zero node:* specifiers. Maps bounded operator commands to
// shared-session mutations and existing controller recipes, and projects real
// simulator/constraint traces into a translucent HUD.
import { executeRepairRun } from '../simulator/repair-run.mjs';
import { COMPONENTS } from './component-model.mjs';
import { completeSabotageCommand } from './sabotage-command-guard.mjs';

const esc = value =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export const RECIPE_TITLES = Object.freeze({
  station_handoff: 'Faulted line (Station A unbypassed)',
  surge_interleave: 'Power-only fix (150 ms surge interleave)',
  timing_compensation: 'Timing-only fix (measured belt velocity)',
  coordinated_repair: 'Coordinated repair (interleave + timing + Station B handoff)',
});

const PLC_OR_UNSAFE_RE =
  /\b(?:plc|live\s+machine|energize|de-?energize|override\s+safety|bypass\s+loto|skip\s+loto|unlock\s+guard|physical\s+clearance|real\s+equipment)\b/i;

function matchBreakerKw(text) {
  const kwExplicit = text.match(/(?:^|[\s:=])(-?\d+(?:\.\d{1,3})?)\s*kw\b/i);
  if (kwExplicit) return Number(kwExplicit[1]);
  const capImplicit = text.match(
    /\b(?:breaker|cap|ceiling|brownout|limit)\s*(?:to|at|=|:)?\s*(-?\d+(?:\.\d{1,3})?)\b/i,
  );
  if (capImplicit) return Number(capImplicit[1]);
  if (/\b(?:restore|reset|nominal)\b.*\b(?:breaker|cap|power|1\.65)?\b/i.test(text) && !/\b(?:power-?only)\b/i.test(text)) {
    return 1.65;
  }
  if (/\b(?:brownout|cut\s+power|drop\s+power|stress\s+cap|tighter\s+cap)\b/i.test(text)) {
    return 1.45;
  }
  return null;
}

function matchStrategyId(text) {
  if (/\b(?:power[\s-]*only|surge[\s-]*interleave|stagger\s+surge|interleave\s+only)\b/i.test(text)) {
    return 'surge_interleave';
  }
  if (/\b(?:timing[\s-]*only|timing\s+fix|timing\s+compensation|delay\s+sensor|optical\s+lag|sensor\s+lag|belt\s+timing)\b/i.test(text)) {
    return 'timing_compensation';
  }
  if (/\b(?:coordinated|full\s+repair|recover\s+orders|recover\s+line|bypass\s+station\s*a|handoff\s+to\s*(?:station\s*)?b|reroute\s+to\s*(?:station\s*)?b)\b/i.test(text)) {
    return 'coordinated_repair';
  }
  if (/\b(?:jam\b|disable\s+gripper|sabotage\s+station\s*a|faulted\s+line|unrepaired|station\s+handoff\s+baseline)\b/i.test(text)) {
    return 'station_handoff';
  }
  return null;
}

function matchZoneId(text) {
  if (/\b(?:48\s*v|cabinet|busbar|main\s+bus|panel\s*p1)\b/i.test(text)) return 'PANEL-BUS-48V';
  if (/\b(?:optical|gate|junction\s*j2|encoder|photoeye)\b/i.test(text)) return 'JBOX-OPT-S1';
  if (/\b(?:station\s*b|arm\s*b)\b/i.test(text)) return 'GANTRY-STB-B';
  if (/\b(?:station\s*a|arm\s*a|pinch\s+gripper|solenoid\s+head)\b/i.test(text)) return 'GANTRY-STA-A';
  return null;
}

function matchViewOrCamera(text) {
  if (/\b(?:top\s+bus|overhead\s+cam|bird'?s[\s-]*eye)\b/i.test(text)) {
    return { kind: 'CAMERA_PRESET', view: 'spatial', preset: 'top', label: '3D camera → Top bus' };
  }
  if (/\b(?:wrist\s+cam|zoom\s+arm|focus\s+wrist)\b/i.test(text)) {
    return { kind: 'CAMERA_PRESET', view: 'spatial', preset: 'wrist', label: '3D camera → Arm A wrist' };
  }
  if (/\b(?:iso\s+cam|reset\s+cam|isometric)\b/i.test(text)) {
    return { kind: 'CAMERA_PRESET', view: 'spatial', preset: 'default', label: '3D camera → Isometric' };
  }
  if (/\b(?:spatial|3d\s+stage|3d\s+view)\b/i.test(text)) {
    return { kind: 'SET_VIEW', view: 'spatial', label: 'View → 04 Spatial 3D' };
  }
  if (/\b(?:cutaway|peel\s+exterior|look\s+inside)\b/i.test(text)) {
    return { kind: 'SET_VIEW', view: 'cutaway', label: 'View → 02 Robot cutaway' };
  }
  if (/\b(?:schematic|wiring\s+diagram)\b/i.test(text)) {
    return { kind: 'SET_VIEW', view: 'schematic', label: 'View → 03 Schematic' };
  }
  if (/\b(?:workcell\s+map|overview\s+map)\b/i.test(text)) {
    return { kind: 'SET_VIEW', view: 'workcell', label: 'View → 01 Workcell' };
  }
  return null;
}

export function parseSabotageCommand(rawInput) {
  const raw = String(rawInput ?? '').trim().replace(/\s+/g, ' ');
  if (!raw) {
    return {
      ok: false,
      code: 'COMMAND_EMPTY',
      raw: '',
      message: 'Enter a bounded perturbation (e.g., "drop breaker to 1.45 kW", "power-only fix", or "coordinated repair").',
    };
  }
  if (raw.length > 160) {
    return {
      ok: false,
      code: 'COMMAND_TOO_LONG',
      raw: raw.slice(0, 160),
      message: 'Keep perturbation commands under 160 characters.',
    };
  }
  if (PLC_OR_UNSAFE_RE.test(raw)) {
    return {
      ok: false,
      code: 'PHYSICAL_OR_PLC_BLOCKED',
      raw,
      message:
        'Blocked: Live PLC control, physical LOTO overrides, and real-equipment actuation are disabled. Only simulated workcell constraints and recipes can run here.',
    };
  }

  if (!completeSabotageCommand(raw)) return { ok: false, code: 'UNSUPPORTED_PERTURBATION', raw, message: 'Unsupported or ambiguous command. Use one named preset, or one breaker limit followed by one named recipe. Numeric sensor delays are not modeled.' };
  const breakerKw = matchBreakerKw(raw);
  if (breakerKw !== null && (!Number.isFinite(breakerKw) || breakerKw < 1.4 || breakerKw > 3.2)) {
    return {
      ok: false,
      code: 'BREAKER_OUT_OF_RANGE',
      raw,
      message: `Breaker ceiling ${breakerKw} kW is outside the modeled 1.40–3.20 kW microgrid range.`,
    };
  }

  if (breakerKw !== null && Math.abs(breakerKw * 20 - Math.round(breakerKw * 20)) > 1e-7) return { ok: false, code: 'BREAKER_GRID_REQUIRED', raw, message: 'Use 0.05 kW increments. The requested limit was not changed.' };
  const strategyId = matchStrategyId(raw);
  if (breakerKw !== null && strategyId) {
    const rounded = Number(breakerKw.toFixed(2));
    return {
      ok: true,
      kind: 'COMPOUND',
      raw,
      breakerKw: rounded,
      strategyId,
      label: `Set ${rounded.toFixed(2)} kW ceiling + ${RECIPE_TITLES[strategyId]}`,
    };
  }
  if (strategyId) {
    return {
      ok: true,
      kind: 'EVALUATE_RECIPE',
      raw,
      strategyId,
      label: `Evaluate ${RECIPE_TITLES[strategyId]}`,
    };
  }
  if (breakerKw !== null) {
    const rounded = Number(breakerKw.toFixed(2));
    return {
      ok: true,
      kind: 'SET_BREAKER_KW',
      raw,
      breakerKw: rounded,
      label: `Set shared breaker ceiling to ${rounded.toFixed(2)} kW`,
    };
  }

  const viewOrCam = matchViewOrCamera(raw);
  if (viewOrCam) {
    return { ok: true, raw, ...viewOrCam };
  }

  const zoneId = matchZoneId(raw);
  if (zoneId) {
    return {
      ok: true,
      kind: 'SELECT_ZONE',
      raw,
      zoneId,
      label: `Focus anchor ${COMPONENTS[zoneId].number} / ${COMPONENTS[zoneId].short}`,
    };
  }

  return {
    ok: false,
    code: 'UNSUPPORTED_PERTURBATION',
    raw,
    message:
      'Unmodeled command. Supported inputs: breaker caps (1.40–3.20 kW), recipes (coordinated repair, power-only fix, timing-only fix, jam Station A), or anchors (48V bus, optical gate, Arm A, Station B).',
  };
}

function summarizeRunBlockers(run) {
  const reasons = [];
  if (run.repair.breakerTrip || run.challenger.breakerTrip) {
    reasons.push(`peak ${Math.max(run.repair.peakKw, run.challenger.peakKw).toFixed(3)} kW > ${run.breakerKw.toFixed(2)} kW cap`);
  }
  if (run.recipe.timingMode === 'working' && run.recipe.powerMode === 'repair') {
    reasons.push('timing still assumes 1.0 m/s after 0.7 m/s throttle');
  }
  if (!run.recipe.handoff) {
    reasons.push('faulted Station A kept in dispatch queue');
  }
  if (run.repair.packed !== run.repair.orderCount || run.challenger.packed !== run.challenger.orderCount) {
    reasons.push(`orders ${run.repair.packed}/${run.repair.orderCount} judge, ${run.challenger.packed}/${run.challenger.orderCount} challenger`);
  }
  return reasons.join(' · ') || 'modeled check failed';
}

export function buildReasoningSteps({ session, trace = 'working', activeRun = null, lastCommand = null } = {}) {
  if (!session?.twins) throw new Error('SESSION_PROJECTION_REQUIRED');
  const currentRun = activeRun && activeRun.snapshotId === session.evidenceSnapshotId ? activeRun : null;
  const staleRun = activeRun && activeRun.snapshotId !== session.evidenceSnapshotId ? activeRun : null;
  const part = COMPONENTS[session.activeZoneId] || COMPONENTS['PANEL-BUS-48V'];

  const step1 = {
    step: '01',
    title: 'SNAPSHOT & FAULT SCOPE',
    tone: 'amber',
    detail: `${session.evidenceSnapshotId} · ${session.breakerKw.toFixed(2)} kW cap · Focus ${part.number} ${part.short} · Station A gripper fault + +140/+167 ms optical lag.`,
  };

  const step2 = lastCommand
    ? {
        step: '02',
        title: lastCommand.ok ? 'OPERATOR PERTURBATION' : 'COMMAND REJECTED',
        tone: lastCommand.ok ? 'lime' : 'red',
        detail: lastCommand.ok
          ? `"${lastCommand.raw}" → ${lastCommand.label}.`
          : `"${lastCommand.raw}" → ${lastCommand.code} (operation not confirmed; current snapshot retained).`,
      }
    : {
        step: '02',
        title: 'ACTIVE TRACE & LAYERS',
        tone: 'lime',
        detail: `Viewing ${trace.toUpperCase()} twin · ${session.visibleLayers.length}/4 cutaway layers active · 0 model calls.`,
      };

  const step3 = currentRun
    ? {
        step: '03',
        title: 'RECIPE CONSTRAINT GATE',
        tone: currentRun.passed ? 'green' : 'red',
        detail: `${RECIPE_TITLES[currentRun.strategyId]}: ${currentRun.repair.peakKw.toFixed(3)} kW peak · Judge ${currentRun.repair.packed}/${currentRun.repair.orderCount} · Challenger ${currentRun.challenger.packed}/${currentRun.challenger.orderCount} (${currentRun.challenger.telemetryErrors.length} bad packets blocked).`,
      }
    : {
        step: '03',
        title: 'BASELINE vs REPAIR COMPILER',
        tone: session.allSimulatedChecksGreen ? 'green' : 'amber',
        detail: `Working ${session.twins.working.peakKw.toFixed(3)} kW (${session.twins.working.packed}/8) → Coordinated ${session.twins.repair.peakKw.toFixed(3)} kW (${session.twins.repair.packed}/8 judge, ${session.twins.challenger.packed}/8 challenger).${staleRun ? ' Prior recipe withdrawn on snapshot change.' : ''}`,
      };

  const step4 = currentRun
    ? {
        step: '04',
        title: currentRun.passed ? 'PASSED NAMED CHECKS' : 'HALTED BY EVALUATOR',
        tone: currentRun.passed ? 'green' : 'red',
        detail: currentRun.passed
          ? `GREEN WITHIN SCOPE: Queue routed to Station B under ${session.breakerKw.toFixed(2)} kW. Station A still requires physical LOTO.`
          : `REJECTED: ${summarizeRunBlockers(currentRun)}. Unsafe candidate blocked.`,
      }
    : {
        step: '04',
        title: session.allSimulatedChecksGreen ? 'SCOPED GREEN READY' : 'BREAKER CONSTRAINT BREACH',
        tone: session.allSimulatedChecksGreen ? 'green' : 'red',
        detail: session.allSimulatedChecksGreen
          ? `4/4 simulated checks pass on ${session.evidenceSnapshotId}. Not physical machine clearance.`
          : `Coordinated peak ${session.twins.repair.peakKw.toFixed(3)} kW exceeds ${session.breakerKw.toFixed(2)} kW ceiling.`,
      };

  return {
    schema: 'breakshift.reasoning-steps.v1',
    source: 'DETERMINISTIC_SIMULATOR_TRACE',
    modelCalls: 0,
    snapshotId: session.evidenceSnapshotId,
    verdictTone: step4.tone,
    hasCurrentRun: Boolean(currentRun),
    steps: [step1, step2, step3, step4],
  };
}

const PRESETS = Object.freeze([
  { label: '1.45 kW brownout', cmd: 'drop breaker to 1.45 kW' },
  { label: 'Jam Station A', cmd: 'jam Station A' },
  { label: 'Power-only fix', cmd: 'power-only fix' },
  { label: 'Timing-only fix', cmd: 'timing-only fix' },
  { label: 'Coordinated repair', cmd: 'coordinated repair' },
  { label: 'Restore 1.65 kW', cmd: 'restore breaker to 1.65 kW' },
]);

export function createSabotageConsole({
  hudEl,
  consoleEl,
  getContext,
  applyBreaker,
  selectZone,
  setView,
  setCameraPreset,
  launchRepairTwin,
  onRecipeEvaluated = () => {},
  onCommandRejected = () => {},
}) {
  let collapsed = false;
  let busy = false;
  let activeRun = null;
  let lastCommand = null;

  if (hudEl) {
    hudEl.innerHTML = `<div class="reasoning-hud-head"><span class="reasoning-hud-title"><i id="reasoning-hud-dot" class="dot green"></i>RECOVERY TRACE</span><span class="reasoning-hud-tag">SIMULATED · 0 CALLS</span><button type="button" id="reasoning-hud-toggle" aria-expanded="true" aria-controls="reasoning-hud-list">Hide</button></div><ol id="reasoning-hud-list" class="reasoning-hud-list"></ol>`;
    hudEl.querySelector('#reasoning-hud-toggle').addEventListener('click', () => {
      collapsed = !collapsed;
      render();
    });
  }

  if (consoleEl) {
    consoleEl.innerHTML = `<div class="sabotage-bar-head"><span class="eyebrow">LIVE PERTURBATION / DETERMINISTIC COMPILER</span><span id="wasd-badge" class="wasd-badge" hidden><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> + <kbd>Q</kbd><kbd>E</kbd> orbit 3D · <kbd>R</kbd> reset</span></div>
      <form id="sabotage-form" class="sabotage-form"><label for="sabotage-input" class="sr-only">Live sabotage or constraint command</label><input id="sabotage-input" type="text" maxlength="160" autocomplete="off" placeholder="Steer constraints mid-run: e.g. drop breaker to 1.45 kW, power-only fix, coordinated repair…"><button type="submit" id="sabotage-submit" class="primary">Apply ↗</button><button type="button" id="sabotage-open-twin" hidden>Open in Repair Twin ↗</button></form>
      <div class="sabotage-presets" role="group" aria-label="Quick perturbation presets">${PRESETS.map(p => `<button type="button" class="sabotage-chip" data-sabotage-cmd="${esc(p.cmd)}">${esc(p.label)}</button>`).join('')}</div>
      <p id="sabotage-status" class="sabotage-status scope-note" role="status" aria-live="polite">Deterministic command bar ready · mutates simulated session &amp; controller recipes with zero paid model calls.</p>`;

    consoleEl.querySelector('#sabotage-form').addEventListener('submit', event => {
      event.preventDefault();
      executeText(consoleEl.querySelector('#sabotage-input').value);
    });

    consoleEl.addEventListener('click', event => {
      const chip = event.target.closest('[data-sabotage-cmd]');
      if (chip) {
        const cmd = chip.dataset.sabotageCmd;
        consoleEl.querySelector('#sabotage-input').value = cmd;
        executeText(cmd);
        return;
      }
      if (event.target.closest('#sabotage-open-twin')) {
        const ctx = getContext();
        if (!activeRun || activeRun.snapshotId !== ctx.session.evidenceSnapshotId) {
          render();
          return;
        }
        launchRepairTwin({
          strategyId: activeRun.strategyId,
          title: RECIPE_TITLES[activeRun.strategyId],
          snapshotId: activeRun.snapshotId,
          breakerKw: activeRun.breakerKw,
        });
      }
    });
  }

  function setStatus(text, tone = 'muted') {
    if (!consoleEl) return;
    const el = consoleEl.querySelector('#sabotage-status');
    el.className = `sabotage-status scope-note ${tone}`;
    el.textContent = text;
  }

  async function executeText(rawText) {
    if (busy) return;
    const ctx = getContext();
    if (!ctx.available) {
      setStatus('Reconnect to the shared bay before injecting a session change.', 'red');
      return;
    }
    const parsed = parseSabotageCommand(rawText);
    if (!parsed.ok) {
      lastCommand = parsed;
      onCommandRejected(parsed.code);
      setStatus(parsed.message, 'red');
      render();
      return;
    }

    busy = true;
    render();
    try {
      if (parsed.kind === 'SET_BREAKER_KW') {
        await applyBreaker(parsed.breakerKw);
        const after = getContext();
        if (!after.available || after.session.breakerKw !== parsed.breakerKw) throw Error('COMMAND_NOT_APPLIED: breaker readback does not match the requested limit.');
        activeRun = null;
        lastCommand = parsed;
        setStatus(
          `${ctx.session.breakerKw === parsed.breakerKw ? 'Already at' : 'Applied'} ${parsed.breakerKw.toFixed(2)} kW ceiling on ${after.session.evidenceSnapshotId} · ${after.session.allSimulatedChecksGreen ? '4/4 simulated checks pass' : 'breaker constraint tripped'}.`,
          after.session.allSimulatedChecksGreen ? 'green' : 'amber',
        );
      } else if (parsed.kind === 'EVALUATE_RECIPE') {
        const now = getContext();
        activeRun = executeRepairRun({
          strategyId: parsed.strategyId,
          breakerKw: now.session.breakerKw,
          snapshotId: now.session.evidenceSnapshotId,
          scanId: 'DETERMINISTIC_CONSOLE',
        });
        onRecipeEvaluated(activeRun.strategyId, activeRun.snapshotId);
        lastCommand = parsed;
        setStatus(
          `${RECIPE_TITLES[parsed.strategyId]} → ${activeRun.passed ? 'PASSED' : 'REJECTED'} (${activeRun.repair.peakKw.toFixed(3)} kW peak, ${activeRun.repair.packed}/${activeRun.repair.orderCount} judge, ${activeRun.challenger.packed}/${activeRun.challenger.orderCount} challenger).`,
          activeRun.passed ? 'green' : 'red',
        );
      } else if (parsed.kind === 'COMPOUND') {
        await applyBreaker(parsed.breakerKw);
        const after = getContext();
        if (!after.available || after.session.breakerKw !== parsed.breakerKw) throw Error('COMMAND_NOT_APPLIED: breaker readback does not match the requested limit.');
        activeRun = executeRepairRun({
          strategyId: parsed.strategyId,
          breakerKw: after.session.breakerKw,
          snapshotId: after.session.evidenceSnapshotId,
          scanId: 'DETERMINISTIC_CONSOLE',
        });
        onRecipeEvaluated(activeRun.strategyId, activeRun.snapshotId);
        lastCommand = parsed;
        setStatus(
          `${parsed.breakerKw.toFixed(2)} kW + ${RECIPE_TITLES[parsed.strategyId]} → ${activeRun.passed ? 'PASSED' : 'REJECTED'} (${activeRun.repair.peakKw.toFixed(3)} kW peak, ${activeRun.repair.packed}/${activeRun.repair.orderCount} packed).`,
          activeRun.passed ? 'green' : 'red',
        );
      } else if (parsed.kind === 'SELECT_ZONE') {
        await selectZone(parsed.zoneId);
        lastCommand = parsed;
        setStatus(`${parsed.label} selected on ${getContext().session.evidenceSnapshotId}.`, 'green');
      } else if (parsed.kind === 'SET_VIEW') {
        setView(parsed.view);
        lastCommand = parsed;
        setStatus(`${parsed.label}.`, 'green');
      } else if (parsed.kind === 'CAMERA_PRESET') {
        setView(parsed.view);
        setCameraPreset(parsed.preset);
        lastCommand = parsed;
        setStatus(`${parsed.label}.`, 'green');
      }
    } catch (error) {
      lastCommand = { ok: false, raw: parsed.raw, code: 'COMMAND_NOT_APPLIED' };
      setStatus(error?.message || 'Perturbation could not be applied.', 'red');
    } finally {
      busy = false;
      render();
    }
  }

  function render() {
    const ctx = getContext();
    if (!ctx?.session) return;
    const model = buildReasoningSteps({
      session: ctx.session,
      trace: ctx.trace,
      activeRun,
      lastCommand,
    });

    if (hudEl) {
      hudEl.dataset.collapsed = String(collapsed);
      const dot = hudEl.querySelector('#reasoning-hud-dot');
      dot.className = `dot ${model.verdictTone === 'lime' ? 'green' : model.verdictTone}`;
      const toggle = hudEl.querySelector('#reasoning-hud-toggle');
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.textContent = collapsed ? 'Steps +' : 'Hide −';
      const list = hudEl.querySelector('#reasoning-hud-list');
      list.hidden = collapsed;
      list.innerHTML = model.steps
        .map(
          item =>
            `<li class="reasoning-step ${esc(item.tone)}"><div class="reasoning-step-head"><span>${esc(item.step)}</span><strong>${esc(item.title)}</strong></div><p>${esc(item.detail)}</p></li>`,
        )
        .join('');
    }

    if (consoleEl) {
      const wasd = consoleEl.querySelector('#wasd-badge');
      if (wasd) wasd.hidden = !(ctx.view === 'spatial' && ctx.webglAvailable);
      const disabled = busy || !ctx.available;
      consoleEl.querySelector('#sabotage-input').disabled = disabled;
      consoleEl.querySelector('#sabotage-submit').disabled = disabled;
      for (const chip of consoleEl.querySelectorAll('[data-sabotage-cmd]')) chip.disabled = disabled;
      const openBtn = consoleEl.querySelector('#sabotage-open-twin');
      const currentRun = activeRun && activeRun.snapshotId === ctx.session.evidenceSnapshotId ? activeRun : null;
      openBtn.hidden = !currentRun;
      openBtn.disabled = disabled || !currentRun;
    }
  }

  render();

  return {
    sync: render,
    executeCommand: executeText,
    getState: () => ({
      collapsed,
      busy,
      activeStrategyId: activeRun?.strategyId ?? null,
      activeSnapshotId: activeRun?.snapshotId ?? null,
      lastCommandCode: lastCommand?.ok ? lastCommand.kind : lastCommand?.code ?? null,
    }),
  };
}
