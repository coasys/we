/**
 * Writes drawn before they land, from a speculative run of the operation that will make them — see
 * `registry.ts` for the lifecycle, `overlay.ts` for how one meets a result, `live.ts` for the reads,
 * `held.ts` for what a speculative run reads first.
 */
export { applyPredictions, predictionFingerprint, readShapeOf, type ReadShape } from './overlay';
export { withPredictedPages, withPredictedRows, withPredictions } from './live';
export { type HeldRead, type HeldRow } from './held';
export {
  bindPredictions,
  boundPredictions,
  createPredictions,
  datasetKey,
  type PredictedWrite,
  type Prediction,
  type Predictions,
} from './registry';
