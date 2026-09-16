/**
 * The feature modules compiled into this build.
 *
 * GENERATED FILE — do not edit. Rewritten by `pnpm --filter @we/app-shell generate-modules`
 * from `we-seed.json`'s `modules` list. Change the seed and regenerate; editing this by hand
 * is undone by the next build.
 *
 * Key order is the seed's order, and it is load-bearing: it is the module rail's order.
 */
import { createModule as module_call } from '@we/module-call';
import { createModule as module_globe } from '@we/module-globe';
import { createModule as module_graph } from '@we/module-graph';
import { createModule as module_notes } from '@we/module-notes';
import { createModule as module_pocket } from '@we/module-pocket';
import { createModule as module_polls } from '@we/module-polls';
import type { ModuleDefinition, ModuleHost } from '@we/module-shared';
import { createModule as module_transcribe } from '@we/module-transcribe';

export const bundledModules: Record<string, (host: ModuleHost) => ModuleDefinition> = {
  call: module_call,
  transcribe: module_transcribe,
  pocket: module_pocket,
  notes: module_notes,
  globe: module_globe,
  graph: module_graph,
  polls: module_polls,
};
