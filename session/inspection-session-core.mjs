// Browser- and Node-compatible Shared Versioned Inspection-Session Core.
// Zero node:* bare specifiers so public/app.js runs cleanly in any browser.
import { judgeScenario, challengerScenario } from '../simulator/scenarios.mjs';
import { simulate } from '../simulator/workcell.mjs';

export const ENERGY_MODEL_LABEL = 'SIMULATED_WORKCELL_ENERGY_MODEL';
export const SCOPED_GREEN_POLICY =
  'PASSED_NAMED_SIMULATED_CHECK_ON_CURRENT_SNAPSHOT_ONLY_NOT_WHOLE_MACHINE_SAFE';

export const CELL_ZONES = Object.freeze({
  'PANEL-BUS-48V': Object.freeze({
    zoneId: 'PANEL-BUS-48V',
    title: 'Cabinet P1 — 48V Shared DC Power Bus & Solid-State Breaker',
    schematicRef: 'SCH-PWR-04A',
    panelId: 'CAB-P1-DOOR-B',
    pins: ['TB1-01 (+48V_MAIN)', 'TB1-04 (SHUNT_SENSE_A)', 'TB1-05 (SHUNT_SENSE_B)', 'SSR-TRIP-09'],
    cables: ['CBL-48V-TRUNK-01', 'CBL-ARM-A-PWR', 'CBL-ARM-B-PWR'],
    arAnchorId: 'ANCHOR-CABINET-BUS',
  }),
  'JBOX-OPT-S1': Object.freeze({
    zoneId: 'JBOX-OPT-S1',
    title: 'Junction J2 — Conveyor Optical Gate & Encoder Tap',
    schematicRef: 'SCH-SEN-11C',
    panelId: 'RAIL-J2-NORTH',
    pins: ['J2-PIN-3 (OPT_TRIG_OUT)', 'J2-PIN-6 (BELT_ENC_A)', 'J2-PIN-8 (24V_RET)'],
    cables: ['CBL-OPT-120', 'CBL-CONV-VFD-02'],
    arAnchorId: 'ANCHOR-SENSOR-RAIL',
  }),
  'GANTRY-STA-A': Object.freeze({
    zoneId: 'GANTRY-STA-A',
    title: 'Station A — Primary Pinch Manipulator & Solenoid Head',
    schematicRef: 'SCH-MECH-02A',
    panelId: 'ARM-A-WRIST-HOUSING',
    pins: ['XA-02 (SOLENOID_PWM)', 'XA-07 (JAW_HALL_FB)', 'XA-12 (SERVO_PHASE_U)'],
    cables: ['CBL-STA-UMBILICAL', 'CBL-STA-GRIP-04'],
    arAnchorId: 'ANCHOR-ARM-A-WRIST',
  }),
  'GANTRY-STB-B': Object.freeze({
    zoneId: 'GANTRY-STB-B',
    title: 'Station B — Secondary Handoff Manipulator',
    schematicRef: 'SCH-MECH-02B',
    panelId: 'ARM-B-HANDOFF-BAY',
    pins: ['XB-01 (VAC_VALVE_CMD)', 'XB-04 (PRESSURE_OK)', 'XB-11 (SERVO_PHASE_U)'],
    cables: ['CBL-STB-UMBILICAL', 'CBL-HANDOFF-SYNC'],
    arAnchorId: 'ANCHOR-ARM-B-HANDOFF',
  }),
});

export const CUTAWAY_LAYERS = Object.freeze(['mechanical', 'electrical', 'software', 'energy']);

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.keys(value)
    .sort()
    .map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`);
  return `{${entries.join(',')}}`;
}

// Pure-JS RFC 6234 SHA-256 so browser and Node compute identical snapshot/session digests
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

export function sha256Hex(value) {
  const text = typeof value === 'string' ? value : canonicalJson(value);
  const bytes = new TextEncoder().encode(text);
  const bitLen = bytes.length * 8;
  const paddedLen = (((bytes.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(n => n.toString(16).padStart(8, '0')).join('');
}

const DEFAULT_UNSIGNED_SIGNER = Object.freeze({
  publicKeySha256: 'browser-local-preview-unsigned-use-server-ed25519',
  publicKeyPem: null,
  signCanonical: () => null,
});

function evaluateWorkcellEvidence(breakerKw, receiptSigner = DEFAULT_UNSIGNED_SIGNER) {
  const roundedCap = Number(breakerKw.toFixed(2));
  const scenario = {
    ...judgeScenario,
    breakerKw: roundedCap,
    cloudDips: [{ fromMs: 300, toMs: 520, capKw: roundedCap }],
  };
  const challenge = {
    ...challengerScenario,
    breakerKw: roundedCap,
    cloudDips: [{ fromMs: 250, toMs: 610, capKw: roundedCap }],
  };
  const working = simulate(scenario, 'working');
  const repair = simulate(scenario, 'repair');
  const challenger = simulate(challenge, 'repair');

  const snapshotPayload = {
    energyModelLabel: ENERGY_MODEL_LABEL,
    breakerKw: roundedCap,
    sensorLagMs: scenario.sensorLagMs,
    challengerLagMs: challenge.sensorLagMs,
    stationAFault: scenario.stationAFault,
    workingSummary: { breakerTrip: working.breakerTrip, peakKw: working.peakKw, packed: working.packed },
    repairSummary: { breakerTrip: repair.breakerTrip, peakKw: repair.peakKw, packed: repair.packed },
    challengerSummary: {
      breakerTrip: challenger.breakerTrip,
      peakKw: challenger.peakKw,
      packed: challenger.packed,
      telemetryErrors: [...challenger.telemetryErrors].sort(),
    },
  };
  const evidenceSnapshotId = `snap-${sha256Hex(snapshotPayload).slice(0, 16)}`;

  const observations = [
    {
      id: 'OBS-CURR-BUS',
      zoneId: 'PANEL-BUS-48V',
      modality: 'current-draw',
      truthClass: 'OBSERVED_EVIDENCE',
      severity: 'amber',
      summary: `Working twin simultaneous arm surges hit ${working.peakKw.toFixed(3)} kW against ${roundedCap.toFixed(2)} kW cloud-dip breaker ceiling.`,
    },
    {
      id: 'OBS-OPT-LAG',
      zoneId: 'JBOX-OPT-S1',
      modality: 'camera-timing',
      truthClass: 'OBSERVED_EVIDENCE',
      severity: 'red',
      summary: `Optical gate lead lags by +${scenario.sensorLagMs}ms (+${challenge.sensorLagMs}ms under challenger jitter) while working timing assumes unthrottled 1.0 m/s belt.`,
    },
    {
      id: 'OBS-STA-GRIP',
      zoneId: 'GANTRY-STA-A',
      modality: 'thermal-vibration-log',
      truthClass: 'OBSERVED_EVIDENCE',
      severity: 'red',
      summary: 'Station A fault flag active; uncoordinated motor surge still draws 1.40 kW without completing pick.',
    },
  ];

  const hypotheses = [
    {
      id: 'HYP-INRUSH-COUPLE',
      zoneId: 'PANEL-BUS-48V',
      truthClass: 'CONFIDENCE_RANKED_HYPOTHESIS',
      confidence: 0.94,
      linkedFile: 'controller/power-governor.mjs',
      summary: 'Simultaneous t=300ms servo acceleration causes main bus overcurrent; 150ms surge interleave + 0.7 m/s belt should cap load at 1.555 kW.',
    },
    {
      id: 'HYP-SPEED-MISMATCH',
      zoneId: 'JBOX-OPT-S1',
      truthClass: 'CONFIDENCE_RANKED_HYPOTHESIS',
      confidence: 0.91,
      linkedFile: 'controller/kinematics-timing.mjs',
      summary: 'Grasp window miss stems from hardcoded 1.0 m/s nominal belt velocity in predictGrasp after power-governor throttles conveyor to 0.7 m/s.',
    },
    {
      id: 'HYP-SOLENOID-HANDOFF',
      zoneId: 'GANTRY-STA-A',
      truthClass: 'CONFIDENCE_RANKED_HYPOTHESIS',
      confidence: 0.86,
      linkedFile: 'controller/planner.mjs',
      summary: 'Station A actuator fault requires full order rerouting to Station B before any technician opens Arm A wrist housing.',
    },
  ];

  const timingPassed = repair.packed === repair.orderCount && challenger.packed === challenger.orderCount;
  const powerPassed = !repair.breakerTrip && !challenger.breakerTrip && repair.peakKw <= roundedCap && challenger.peakKw <= roundedCap;
  const handoffPassed = repair.parts.every(p => p.station === 'B' && p.packed);
  const telemetryPassed =
    challenger.telemetryErrors.includes('INVALID_SENSOR_VALUES') &&
    challenger.telemetryErrors.includes('UNEXPECTED_SENSOR_FIELD');

  const scopedChecks = [
    {
      checkId: 'CHK-POWER-INTERLEAVE',
      zoneId: 'PANEL-BUS-48V',
      arAnchorId: 'ANCHOR-CABINET-BUS',
      title: '150ms Surge Interleave & 0.7 m/s Belt Cap',
      file: 'controller/power-governor.mjs',
      passed: powerPassed,
      colorState: powerPassed ? 'green-scoped' : 'amber-constrained',
      truthClass: 'SIMULATED_CHECK_RESULT',
      evidenceSnapshotId,
      metricText: `${repair.peakKw.toFixed(3)} kW / ${roundedCap.toFixed(2)} kW ceiling`,
      scopeNotice: powerPassed
        ? `GREEN WITHIN SCOPE (${evidenceSnapshotId}): Simulated peak ${repair.peakKw.toFixed(3)} kW <= ${roundedCap.toFixed(2)} kW ceiling. Does NOT certify live 48V bus de-energization.`
        : `AMBER CONSTRAINT BREACH (${evidenceSnapshotId}): Simulated repair peak ${repair.peakKw.toFixed(3)} kW exceeds ${roundedCap.toFixed(2)} kW breaker ceiling!`,
    },
    {
      checkId: 'CHK-TIMING-SYNC',
      zoneId: 'JBOX-OPT-S1',
      arAnchorId: 'ANCHOR-SENSOR-RAIL',
      title: 'Throttled Belt Velocity Grasp Compensation',
      file: 'controller/kinematics-timing.mjs',
      passed: timingPassed,
      colorState: timingPassed ? 'green-scoped' : 'red-fault',
      truthClass: 'SIMULATED_CHECK_RESULT',
      evidenceSnapshotId,
      metricText: `${challenger.packed}/${challenger.orderCount} challenger parts packed`,
      scopeNotice: timingPassed
        ? `GREEN WITHIN SCOPE (${evidenceSnapshotId}): Passed +140ms/+167ms simulated lag window. Does NOT verify physical optical lens alignment.`
        : `RED TIMING MISS (${evidenceSnapshotId}): Packed ${challenger.packed}/${challenger.orderCount} parts under simulated brownout.`,
    },
    {
      checkId: 'CHK-STATION-HANDOFF',
      zoneId: 'GANTRY-STB-B',
      arAnchorId: 'ANCHOR-ARM-B-HANDOFF',
      title: 'Station A → Station B Capability Handoff',
      file: 'controller/planner.mjs',
      passed: handoffPassed,
      colorState: handoffPassed ? 'green-scoped' : 'red-fault',
      truthClass: 'SIMULATED_CHECK_RESULT',
      evidenceSnapshotId,
      metricText: handoffPassed ? '8/8 routed to Station B' : 'Handoff incomplete',
      scopeNotice: handoffPassed
        ? `GREEN WITHIN SCOPE (${evidenceSnapshotId}): Simulated orders rerouted to Station B. Station A physical actuator remains faulted until LOTO service.`
        : `RED HANDOFF BLOCKED (${evidenceSnapshotId}): Orders failed to complete on Station B.`,
    },
    {
      checkId: 'CHK-TELEMETRY-SCHEMA',
      zoneId: 'JBOX-OPT-S1',
      arAnchorId: 'ANCHOR-SENSOR-RAIL',
      title: 'Malformed Sensor Packet Rejection',
      file: 'controller/telemetry-api.mjs',
      passed: telemetryPassed,
      colorState: telemetryPassed ? 'green-scoped' : 'red-fault',
      truthClass: 'SIMULATED_CHECK_RESULT',
      evidenceSnapshotId,
      metricText: `Blocked ${challenger.telemetryErrors.length} bad packets`,
      scopeNotice: telemetryPassed
        ? `GREEN WITHIN SCOPE (${evidenceSnapshotId}): Rejected INVALID_SENSOR_VALUES & UNEXPECTED_SENSOR_FIELD in simulator.`
        : 'RED TELEMETRY LEAK: Malformed packet accepted.',
    },
  ];

  const allSimulatedChecksGreen = scopedChecks.every(c => c.passed);

  const changedFiles = [
    { path: 'controller/kinematics-timing.mjs', change: 'Use throttled beltSpeedMps instead of nominal 1.0 m/s in predictGrasp' },
    { path: 'controller/planner.mjs', change: 'Filter faulted Station A and hand off all 8 orders to Station B' },
    { path: 'controller/power-governor.mjs', change: 'Interleave arm surges by 150ms and throttle conveyor to 0.7 m/s' },
    { path: 'controller/telemetry-api.mjs', change: 'Reject NaN, negative timestamps, and unexpected packet fields' },
  ];
  const compilerReceiptBody = {
    schema: 'breakshift.repair-compiler-receipt.v1',
    energyModelLabel: ENERGY_MODEL_LABEL,
    evidenceSnapshotId,
    compilerVerdict: allSimulatedChecksGreen
      ? 'VERIFIED_SIMULATED_REPAIR_PACKAGE'
      : 'REJECTED_BY_BREAKER_OR_SAFETY_CONSTRAINT',
    greenPolicy: SCOPED_GREEN_POLICY,
    changedFiles,
    beforePeakKw: working.peakKw,
    afterPeakKw: repair.peakKw,
    breakerKw: roundedCap,
    partsCompleted: `${repair.packed}/${repair.orderCount}`,
    challengerPartsCompleted: `${challenger.packed}/${challenger.orderCount}`,
    testsPassed: `${scopedChecks.filter(c => c.passed).length}/${scopedChecks.length}`,
    publicKeySha256: receiptSigner.publicKeySha256,
    nonPlcDisclaimer: 'Simulated workcell repair receipt only; does not compile to a live PLC or certify physical machine safety.',
  };
  const canonicalReceipt = canonicalJson(compilerReceiptBody);
  const signatureBase64 = allSimulatedChecksGreen ? receiptSigner.signCanonical(canonicalReceipt) : null;

  return {
    evidenceSnapshotId,
    twins: { working, repair, challenger },
    observations,
    hypotheses,
    scopedChecks,
    allSimulatedChecksGreen,
    compilerReceipt: {
      ...compilerReceiptBody,
      signatureBase64,
      publicKeyPem: receiptSigner.publicKeyPem,
    },
  };
}

const DEFAULT_CHECKLIST = Object.freeze([
  { id: 'SCAN-IR-STANDOFF', zoneId: 'GANTRY-STA-A', label: 'Confirm non-contact IR thermal reading on Arm A wrist housing from outside guard', completed: false, completedOnSnapshotId: null },
  { id: 'SCAN-BUS-CAP', zoneId: 'PANEL-BUS-48V', label: 'Verify 48V bus breaker ceiling & simulated surge margin on Cabinet P1', completed: false, completedOnSnapshotId: null },
  { id: 'SCAN-OPT-CABLE', zoneId: 'JBOX-OPT-S1', label: 'Inspect CBL-OPT-120 connector seating at Junction J2 without energizing belt', completed: false, completedOnSnapshotId: null },
  { id: 'SCAN-HANDOFF-CLEAR', zoneId: 'GANTRY-STB-B', label: 'Confirm Station B handoff envelope clear before human LOTO review', completed: false, completedOnSnapshotId: null },
]);

export function createInspectionSessionCore({
  sessionId = 'msn-breakshift-bay-01',
  initialBreakerKw = 1.65,
  receiptSigner = DEFAULT_UNSIGNED_SIGNER,
} = {}) {
  let state = null;
  const listeners = new Set();

  function buildNextState({ prev, breakerKw, activeZoneId, cutawayOpen, visibleLayers, repairOverlayMode, checklist, lastActorSurface, lastAction }) {
    const evalBundle = evaluateWorkcellEvidence(breakerKw, receiptSigner);
    const snapshotChanged = prev && prev.evidenceSnapshotId !== evalBundle.evidenceSnapshotId;

    const normalizedChecklist = checklist.map(item => {
      if (snapshotChanged && item.completed && item.completedOnSnapshotId !== evalBundle.evidenceSnapshotId) {
        return { ...item, completed: false, completedOnSnapshotId: null };
      }
      return item;
    });

    const version = prev ? prev.version + 1 : 1;
    const core = {
      schema: 'breakshift.inspection-session.v1',
      sessionId,
      version,
      updatedAt: new Date().toISOString(),
      energyModelLabel: ENERGY_MODEL_LABEL,
      scopedGreenPolicy: SCOPED_GREEN_POLICY,
      evidenceSnapshotId: evalBundle.evidenceSnapshotId,
      parentSessionDigest: prev ? prev.sessionDigest : null,
      lastActorSurface,
      lastAction,
      breakerKw: Number(breakerKw.toFixed(2)),
      activeZoneId,
      cutawayOpen,
      visibleLayers: [...visibleLayers],
      repairOverlayMode,
      allSimulatedChecksGreen: evalBundle.allSimulatedChecksGreen,
      twins: evalBundle.twins,
      observations: evalBundle.observations,
      hypotheses: evalBundle.hypotheses,
      scopedChecks: evalBundle.scopedChecks,
      checklist: normalizedChecklist,
      compilerReceipt: evalBundle.compilerReceipt,
      authorityGranted: false,
    };
    const sessionDigest = sha256Hex(core);
    return Object.freeze({ ...core, sessionDigest });
  }

  state = buildNextState({
    prev: null,
    breakerKw: initialBreakerKw,
    activeZoneId: 'PANEL-BUS-48V',
    cutawayOpen: true,
    visibleLayers: [...CUTAWAY_LAYERS],
    repairOverlayMode: 'GHOSTED_PROPOSAL',
    checklist: DEFAULT_CHECKLIST.map(item => ({ ...item })),
    lastActorSurface: 'system',
    lastAction: 'SESSION_INITIALIZED',
  });

  function mutate(action) {
    if (!action || typeof action !== 'object') throw new Error('INVALID_SESSION_ACTION');
    if (!Number.isInteger(action.expectedVersion) || action.expectedVersion !== state.version) {
      const err = new Error(`VERSION_CONFLICT:expected=${action.expectedVersion},actual=${state.version}`);
      err.code = 'VERSION_CONFLICT';
      err.currentVersion = state.version;
      throw err;
    }
    const actorSurface = ['laptop', 'ipad', 'glasses'].includes(action.surface) ? action.surface : 'laptop';
    let nextBreakerKw = state.breakerKw;
    let nextZoneId = state.activeZoneId;
    let nextCutawayOpen = state.cutawayOpen;
    let nextLayers = [...state.visibleLayers];
    let nextOverlayMode = state.repairOverlayMode;
    let nextChecklist = state.checklist.map(c => ({ ...c }));

    switch (action.type) {
      case 'SET_BREAKER_KW': {
        const val = Number(action.breakerKw);
        if (!Number.isFinite(val) || val < 1.4 || val > 3.2) throw new Error('INVALID_BREAKER_KW');
        nextBreakerKw = val;
        nextOverlayMode = 'GHOSTED_PROPOSAL';
        break;
      }
      case 'SELECT_ZONE': {
        if (!Object.hasOwn(CELL_ZONES, action.zoneId)) throw new Error('INVALID_ZONE_ID');
        nextZoneId = action.zoneId;
        break;
      }
      case 'SET_CUTAWAY': {
        if (typeof action.cutawayOpen === 'boolean') nextCutawayOpen = action.cutawayOpen;
        if (Array.isArray(action.visibleLayers)) {
          const filtered = CUTAWAY_LAYERS.filter(l => action.visibleLayers.includes(l));
          if (filtered.length === 0) throw new Error('EMPTY_CUTAWAY_LAYERS');
          nextLayers = filtered;
        }
        break;
      }
      case 'TOGGLE_CHECKLIST_ITEM': {
        const idx = nextChecklist.findIndex(c => c.id === action.itemId);
        if (idx === -1) throw new Error('INVALID_CHECKLIST_ITEM');
        const nextDone = !nextChecklist[idx].completed;
        nextChecklist[idx] = {
          ...nextChecklist[idx],
          completed: nextDone,
          completedOnSnapshotId: nextDone ? state.evidenceSnapshotId : null,
        };
        break;
      }
      case 'SET_REPAIR_OVERLAY_MODE': {
        if (!['GHOSTED_PROPOSAL', 'VERIFIED_SIMULATED_OVERLAY'].includes(action.mode)) {
          throw new Error('INVALID_OVERLAY_MODE');
        }
        if (action.mode === 'VERIFIED_SIMULATED_OVERLAY' && !state.allSimulatedChecksGreen) {
          throw new Error('CANNOT_PROMOTE_UNVERIFIED_OVERLAY');
        }
        nextOverlayMode = action.mode;
        break;
      }
      default:
        throw new Error(`UNKNOWN_ACTION_TYPE:${action.type}`);
    }

    state = buildNextState({
      prev: state,
      breakerKw: nextBreakerKw,
      activeZoneId: nextZoneId,
      cutawayOpen: nextCutawayOpen,
      visibleLayers: nextLayers,
      repairOverlayMode: nextOverlayMode,
      checklist: nextChecklist,
      lastActorSurface: actorSurface,
      lastAction: action.type,
    });

    for (const fn of listeners) fn(state);
    return state;
  }

  return {
    getState: () => state,
    mutate,
    project: surface => projectSessionForSurface(state, surface),
    subscribe: fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function projectSessionForSurface(session, surface = 'laptop') {
  const sharedHeader = {
    sessionId: session.sessionId,
    version: session.version,
    sessionDigest: session.sessionDigest,
    evidenceSnapshotId: session.evidenceSnapshotId,
    energyModelLabel: session.energyModelLabel,
    scopedGreenPolicy: session.scopedGreenPolicy,
    breakerKw: session.breakerKw,
    activeZoneId: session.activeZoneId,
    cutawayOpen: session.cutawayOpen,
    visibleLayers: session.visibleLayers,
    repairOverlayMode: session.repairOverlayMode,
    allSimulatedChecksGreen: session.allSimulatedChecksGreen,
    lastActorSurface: session.lastActorSurface,
    lastAction: session.lastAction,
  };

  if (surface === 'ipad') {
    const zone = CELL_ZONES[session.activeZoneId];
    return {
      surface: 'ipad',
      role: 'TECHNICIAN_CELL_SCHEMATIC',
      ...sharedHeader,
      availableZones: Object.values(CELL_ZONES),
      activeZoneSchematic: zone,
      zoneObservations: session.observations.filter(o => o.zoneId === zone.zoneId),
      zoneHypotheses: session.hypotheses.filter(h => h.zoneId === zone.zoneId),
      zoneScopedChecks: session.scopedChecks.filter(c => c.zoneId === zone.zoneId),
      checklist: session.checklist,
      safetyBanner:
        'Non-contact field schematic only. Green badges apply strictly to the named simulated check on snapshot ' +
        session.evidenceSnapshotId +
        ' — physical LOTO required before opening ' +
        zone.panelId +
        '.',
    };
  }

  if (surface === 'glasses') {
    const spatialCallouts = [
      {
        anchorId: 'ANCHOR-ARM-A-WRIST',
        panelId: CELL_ZONES['GANTRY-STA-A'].panelId,
        color: 'red',
        kind: 'ACTIVE_FAULT',
        label: 'STATION A GRIPPER FAULT',
        detail: 'Pinch head faulted; motor surge still pulls 1.40 kW if un-rerouted.',
        evidenceSnapshotId: session.evidenceSnapshotId,
      },
      {
        anchorId: 'ANCHOR-SENSOR-RAIL',
        panelId: CELL_ZONES['JBOX-OPT-S1'].panelId,
        color: session.scopedChecks.find(c => c.checkId === 'CHK-TIMING-SYNC')?.passed ? 'green-scoped' : 'red',
        kind: 'SIGNAL_PATH',
        label: 'OPTICAL GATE +140ms/+167ms PATH',
        detail: session.scopedChecks.find(c => c.checkId === 'CHK-TIMING-SYNC')?.scopeNotice,
        evidenceSnapshotId: session.evidenceSnapshotId,
      },
      {
        anchorId: 'ANCHOR-CABINET-BUS',
        panelId: CELL_ZONES['PANEL-BUS-48V'].panelId,
        color: session.scopedChecks.find(c => c.checkId === 'CHK-POWER-INTERLEAVE')?.passed ? 'green-scoped' : 'amber',
        kind: 'ENERGY_CONSTRAINT',
        label: `48V BUS CEILING ${session.breakerKw.toFixed(2)} kW`,
        detail: session.scopedChecks.find(c => c.checkId === 'CHK-POWER-INTERLEAVE')?.scopeNotice,
        evidenceSnapshotId: session.evidenceSnapshotId,
      },
      {
        anchorId: 'ANCHOR-ARM-B-HANDOFF',
        panelId: CELL_ZONES['GANTRY-STB-B'].panelId,
        color: session.scopedChecks.find(c => c.checkId === 'CHK-STATION-HANDOFF')?.passed ? 'green-scoped' : 'red',
        kind: 'VERIFIED_HANDOFF_PATH',
        label:
          session.repairOverlayMode === 'VERIFIED_SIMULATED_OVERLAY'
            ? 'VERIFIED SIMULATED HANDOFF OVERLAY'
            : 'GHOSTED PROPOSAL: A → B HANDOFF',
        detail: session.scopedChecks.find(c => c.checkId === 'CHK-STATION-HANDOFF')?.scopeNotice,
        evidenceSnapshotId: session.evidenceSnapshotId,
      },
    ];
    return {
      surface: 'glasses',
      role: 'SPATIAL_CABINET_AND_ROBOT_OVERLAY',
      ...sharedHeader,
      focusedAnchorId: CELL_ZONES[session.activeZoneId].arAnchorId,
      spatialCallouts,
      hudWarning: `SIMULATED OVERLAY (${session.evidenceSnapshotId}) · GREEN = NAMED CHECK ONLY, NEVER WHOLE-MACHINE SAFE`,
    };
  }

  return {
    surface: 'laptop',
    role: 'MUSE_INVESTIGATION_AND_REPAIR_COMPILER',
    ...sharedHeader,
    availableZones: Object.values(CELL_ZONES),
    twins: session.twins,
    observations: session.observations,
    hypotheses: session.hypotheses,
    scopedChecks: session.scopedChecks,
    checklist: session.checklist,
    compilerReceipt: session.compilerReceipt,
  };
}
