import type { OperationDefinition } from '@we/backend-shared';

/**
 * WE's own declared operations — the `core` namespace. Authored as TypeScript data, as the entity
 * definitions are, and held to the same rule: plain JSON, nothing a function or a class could add,
 * so what runs here is exactly what another implementation reads (the package's tests check every
 * one survives a round trip through JSON unchanged, and passes `validateOperations`).
 *
 * Empty until the store writes that fit the step set are converted.
 */
export const CORE_OPERATIONS: Record<string, OperationDefinition> = {};
