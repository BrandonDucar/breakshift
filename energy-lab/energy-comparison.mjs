import { canonicalJson, sha256Hex } from '../session/inspection-session-core.mjs';
import { BASELINE, MODEL, compileEnvelopePlan, validateContext, evaluateDisturbance, evaluateEnvelope } from '../uncertainty-lab/repair-envelope.mjs';

function run(candidate,current,input){
  const plan=compileEnvelopePlan(candidate,current),trace=evaluateDisturbance(plan,input,current);
  const windowMs=trace.segments.at(-1).toMs-trace.segments[0].fromMs;
  return {plan,trace,robustnessVerdict:evaluateEnvelope(plan,current).verdict,
    metrics:{peakW:trace.peakW,energyWh:trace.energyWh,windowMs,modeledPacked:trace.packed,
      whPerSuccessfulModeledPart:trace.passed&&trace.packed>0?trace.energyWh/trace.packed:null,
      batchEquivalentPartsPerMinute:trace.passed&&trace.packed>0?trace.packed/windowMs*60000:null}};
}
export function createEnergyComparison(candidate,current,input){
  const reference=run(BASELINE,current,input),proposed=run(candidate,current,input);
  const comparableOutput=reference.trace.passed&&proposed.trace.passed&&reference.trace.packed===proposed.trace.packed;
  const body={schema:'breakshift.energy-comparison.v1',model:MODEL,context:structuredClone(current),input:structuredClone(input),
    reference,proposed,difference:{peakReductionW:reference.metrics.peakW-proposed.metrics.peakW,
      batchEnergyChangeWh:proposed.metrics.energyWh-reference.metrics.energyWh,windowChangeMs:proposed.metrics.windowMs-reference.metrics.windowMs,
      successfulOutputComparable:comparableOutput,
      whPerSuccessfulModeledPartChange:comparableOutput?proposed.metrics.whPerSuccessfulModeledPart-reference.metrics.whPerSuccessfulModeledPart:null},
    limits:{scope:'SAME_DECLARED_DISTURBANCE_REFERENCE_MODEL_ONLY',steadyStateThroughputMeasured:false,
      actuationScope:'TWO_MODELED_SURGES_FOR_ABSTRACT_EIGHT_ORDER_BATCH_NOT_CALIBRATED_ROBOT_CYCLES',
      failureEnergyPolicy:'FULL_ATTEMPT_HORIZON_NO_PHYSICAL_BREAKER_SHUTOFF_MODEL',
      physicalEnergyMeasured:false,tariffOrMoneySavingsClaim:false,simulationPassIsPhysicalClearance:false},
    physicalClearance:false,executionAuthority:false};
  return {...body,receiptDigest:sha256Hex(body)};
}
export function replayEnergyComparison(text,current){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>65536)throw Error('ENERGY_RECEIPT_TOO_LARGE');
  validateContext(current);let saved;
  try{saved=JSON.parse(text);}catch{throw Error('ENERGY_RECEIPT_INVALID');}
  if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error('ENERGY_RECEIPT_INVALID');
  if(canonicalJson(saved.context)!==canonicalJson(current))throw Error('ENERGY_CONTEXT_MISMATCH');
  const expected=createEnergyComparison(saved.proposed?.plan?.candidate,current,saved.input);
  if(canonicalJson(expected)!==canonicalJson(saved))throw Error('ENERGY_REPLAY_MISMATCH');
  return {receipt:expected,scope:'LOCAL_RECOMPUTATION_NOT_PHYSICAL_MEASUREMENT',sourceAuthenticated:false};
}
