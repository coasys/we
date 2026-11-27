/**
 * Declared operations: compound writes as data, run by one runner over the record contract.
 *
 * The format is the manifest's (`operations` in `@we/backend-shared`); this is what reads it — the
 * static checks, the effect summary, the registry the host fills by namespace, and the runner.
 */
export {
  isOperationError,
  OperationError,
  type OperationErrorClass,
  type OperationErrorInit,
  type PreconditionErrorCode,
  type StaticErrorCode,
} from './errors';
export {
  describeEffects,
  describeOperation,
  operationCatalog,
  type OperationCatalogEntry,
  operationWrites,
} from './catalog';
export { type EffectOptions, effectSummary, type OperationEffects, type OperationEffectVerb } from './effects';
export { callSegment, deriveIdentityId, deriveRecordId, domainSegment, identityText, keySegment } from './ids';
export { identityIdOf, settledIdentityDomain } from './identity';
export {
  categoryMembers,
  getOperation,
  identityOf,
  listNamespaces,
  listOperations,
  operationsVersion,
  registerOperations,
  unregisterOperations,
} from './registry';
export { type OperationView, runOperation, type RunOperationOptions, serialKey } from './run';
export { onSpeculationMiss, type SpeculationMiss, speculateOperation, type Speculation } from './speculate';
export {
  callsOf,
  type OperationIssue,
  splitName,
  validateOperations,
  type ValidateOperationsOptions,
} from './validate';
export { PROTECTED_ENTITIES } from './values';
