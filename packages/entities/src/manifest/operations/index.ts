import type { OperationDefinition } from '@we/backend-shared';

import { BOARDS_OPERATIONS } from './boards';
import { CANVAS_OPERATIONS } from './canvas';
import { CONTENT_OPERATIONS } from './content';
import { SIGNALS_OPERATIONS } from './signals';
import { SPACE_OPERATIONS } from './space';

/**
 * WE's own declared operations — the `core` namespace. Authored as TypeScript data, as the entity
 * definitions are, and held to the same rule: plain JSON, nothing a function or a class could add,
 * so what runs here is exactly what another implementation reads (the package's tests check every
 * one survives a round trip through JSON unchanged, and passes `validateOperations`).
 *
 * One file per area, so each reads as the writes of one part of the app.
 */
export const CORE_OPERATIONS: Record<string, OperationDefinition> = {
  ...SIGNALS_OPERATIONS,
  ...BOARDS_OPERATIONS,
  ...CONTENT_OPERATIONS,
  ...SPACE_OPERATIONS,
  ...CANVAS_OPERATIONS,
};
