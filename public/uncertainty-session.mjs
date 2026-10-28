import { canonicalJson, sha256Hex } from '../session/inspection-session-core.mjs';
import { MODEL, BASELINE, DEFAULT_CONTEXT, compileEnvelopePlan, createEnvelopeReceipt, replayEnvelopeReceipt, evaluateDisturbance } from '../uncertainty-lab/repair-envelope.mjs';
import catalogSource from './robot-asset-catalog.json' with {type:'json'};
import recordedSource from './verified-uncertainty-patch.json' with {type:'json'};
import { validateRobotCatalog, assetBinding } from './robot-asset-contract.mjs';

export const MAX_UNCERTAINTY_IMPORT_BYTES = 49152;
const need = (condition, code) => { if (!condition) throw Error(code); };
const exact = (value, keys) => need(value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).sort().join(',') === keys.sort().join(','), 'UNCERTAINTY_PUBLIC_SOURCE_INVALID');
export function validateRecordedPatch(value) {
  exact(value, ['schema','mode','model','energyModel','sourceArtifactSha256','recordedPlanDigest','candidate','peerReview','physicalClearance','executionAuthority']);
  need(value.schema === 'breakshift.recorded-uncertainty-patch.v1' && value.mode === 'RECORDED_PROVIDER_PATCH'
    && value.model === 'muse-spark-1.3' && value.energyModel === 'breakshift-uncertainty-energy/1' && value.peerReview === 'REQUESTED_NOT_RECEIVED'
    && value.physicalClearance === false && value.executionAuthority === false && /^[a-f0-9]{64}$/.test(value.sourceArtifactSha256), 'UNCERTAINTY_PUBLIC_SOURCE_INVALID');
  // The provider's historical V1 proposal is immutable provenance, not a V2
  // certificate. Each run recompiles its parameters under the current model.
  need(canonicalJson(value) === canonicalJson(recordedSource), 'UNCERTAINTY_PUBLIC_SOURCE_INVALID');
  return structuredClone(value);
}
export function createUncertaintySession({ getContext, recordedPatch }) {
  const projection = validateRecordedPatch(recordedPatch);
  const catalog = validateRobotCatalog(catalogSource);
  let asset = catalog.profiles[0];
  let selection = 'reference', bounds = { loadMax: 1.12, delayMaxMs: 40, jitterMs: 15 }, latest = null, invalidated = false;
  function context() {
    need(asset.qualification==='SIMULATOR_FIXTURE_ONLY','ROBOT_ADAPTER_UNQUALIFIED');
    const current = getContext(); need(current?.available !== false, 'UNCERTAINTY_CONTEXT_UNAVAILABLE');
    return { snapshotId: current.snapshotId, breakerKw: current.breakerKw, envelope: {
      loadMultiplier: [1,bounds.loadMax], sensorDelayMs: [0,bounds.delayMaxMs], surgeJitterMs: [-bounds.jitterMs,bounds.jitterMs] } };
  }
  function source(mode) {
    need(['reference','muse'].includes(mode), 'UNCERTAINTY_SELECTION_INVALID');
    return mode === 'reference' ? { selection: mode, origin: 'DETERMINISTIC_NOMINAL_REFERENCE', model: null, sourceArtifactSha256: null }
      : { selection: mode, origin: 'RECORDED_PROVIDER_PATCH', model: projection.model, sourceArtifactSha256: projection.sourceArtifactSha256 };
  }
  const candidate = mode => mode === 'reference' ? BASELINE : projection.candidate;
  function makeReceipt(mode, current) {
    const body = { schema: 'breakshift.uncertainty-workbench-experiment.v1', source: source(mode), asset:assetBinding(asset),
      experiment: createEnvelopeReceipt(compileEnvelopePlan(candidate(mode), current), current), peerReview: projection.peerReview,
      physicalClearance: false, executionAuthority: false, sourceAuthenticated: false };
    return { ...body, receiptDigest: sha256Hex(body) };
  }
  function sync() {
    if (latest && !invalidated) {
      try { if (canonicalJson(latest.experiment.plan.assumptions) !== canonicalJson(context())) invalidated = true; }
      catch { invalidated = true; }
    }
  }
  return {
    setAsset(id){const next=catalog.profiles.find(p=>p.assetId===id);need(next,'ROBOT_ASSET_UNKNOWN');if(next.assetId!==asset.assetId){asset=next;if(latest)invalidated=true;}},
    setSelection(value) { source(value); if (selection !== value) { selection = value; if (latest) invalidated = true; } },
    setBounds(value) {
      exact(value, ['loadMax','delayMaxMs','jitterMs']);
      const current = getContext(), proposed = { snapshotId: current.snapshotId, breakerKw: current.breakerKw,
        envelope: { loadMultiplier:[1,value.loadMax],sensorDelayMs:[0,value.delayMaxMs],surgeJitterMs:[-value.jitterMs,value.jitterMs] } };
      need(value.jitterMs >= 0, 'UNCERTAINTY_RANGE_INVALID'); compileEnvelopePlan(candidate(selection),proposed);
      if (canonicalJson(bounds) !== canonicalJson(value)) { bounds = structuredClone(value); if (latest) invalidated = true; }
    },
    run() { latest = makeReceipt(selection, context()); invalidated = false; return structuredClone(latest); },
    sync,
    state() { sync(); return { selection, bounds:structuredClone(bounds), candidate:structuredClone(candidate(selection)),
      latest:latest ? structuredClone(latest) : null, stale:invalidated, canExport:Boolean(latest && !invalidated),
      asset:structuredClone(asset),profiles:structuredClone(catalog.profiles),canRun:asset.qualification==='SIMULATOR_FIXTURE_ONLY'&&getContext()?.available!==false,
      peerReview:projection.peerReview, current:getContext() }; },
    exportReceipt() { sync(); need(latest && !invalidated,'UNCERTAINTY_STALE_EXPORT_BLOCKED'); return structuredClone(latest); },
    reviewReceipt(text) {
      need(typeof text === 'string' && new TextEncoder().encode(text).length <= MAX_UNCERTAINTY_IMPORT_BYTES,'UNCERTAINTY_RECEIPT_TOO_LARGE');
      let saved;
      try { saved = JSON.parse(text); } catch { throw Error('UNCERTAINTY_RECEIPT_INVALID'); }
      const current = context();
      exact(saved,['schema','source','asset','experiment','peerReview','physicalClearance','executionAuthority','sourceAuthenticated','receiptDigest']);
      replayEnvelopeReceipt(JSON.stringify(saved.experiment),current);
      const expected = makeReceipt(saved.source?.selection,current);
      need(canonicalJson(expected) === canonicalJson(saved),'UNCERTAINTY_WORKBENCH_RECEIPT_MISMATCH');
      return { verdict:expected.experiment.result.verdict, source:expected.source.origin, snapshotId:current.snapshotId,
        currentStateChanged:false, sourceAuthenticated:false };
    },
    worstTrace() {
      sync(); if (!latest || invalidated) return null;
      const plan = latest.experiment.plan, e = plan.assumptions.envelope;
      // Plot the maximum-load/delay energy horizon. The table independently
      // reports timing-error extrema, which may occur at the other delay end.
      return evaluateDisturbance(plan,{loadMultiplier:e.loadMultiplier[1],sensorDelayMs:e.sensorDelayMs[1],jitterAMs:e.surgeJitterMs[1],jitterBMs:e.surgeJitterMs[0]},context());
    },
  };
}
