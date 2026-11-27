/**
 * Writes drawn before they land, from a speculative run of the operation that will make them — see
 * `registry.ts` for the lifecycle, `overlay.ts` for how one meets a result, `live.ts` for the reads,
 * `held.ts` for what a speculative run reads first.
 */
export { applyPredictions, predictionFingerprint, readShapeOf, type ReadShape } from './overlay';
export { withPredictedPages, withPredictedRows, withPredictions } from './live';
export { heldAnswer, type HeldRead, heldRows, holdRead } from './held';
export {
  anyPredictions,
  clearPredictions,
  datasetKey,
  onPredictionsChange,
  predict,
  type PredictedWrite,
  type Prediction,
  predictionLanded,
  predictionsFor,
  withdrawPrediction,
} from './registry';
