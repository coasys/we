/**
 * Flux — reading what the Flux app stores, where WE's own models cannot reach it.
 *
 * A space synced in from Flux holds Flux's records, and most of them are reached like any other: a
 * `$query` against the shapes Flux installed. One is not. A conversation subgroup's messages hang off
 * it through a link no shape declares, so this module asks for them the way Flux itself does.
 *
 * That question is written in AD4M's query language against Flux's link vocabulary, so it belongs
 * here, in a module that says which backend it needs, and not on the backend contract every backend
 * implements.
 */
import { defineModule, type ModuleDefinition, type ModuleHost, type ModuleStoreDeps } from '@we/module-shared';

import { type FluxSubgroupMessage, subgroupMessages } from './subgroupMessages';

export { type FluxSubgroupMessage, subgroupMessages } from './subgroupMessages';

/** The store: one read, against the space on screen. */
export function createFluxStore(deps: ModuleStoreDeps) {
  const { action, dataset } = deps;

  /** A subgroup's messages, or none — outside a space, or when the read fails. */
  async function readSubgroupMessages(subgroupId: string): Promise<FluxSubgroupMessage[]> {
    const handle = dataset?.();
    if (!handle || !subgroupId) return [];
    try {
      return await subgroupMessages(handle, subgroupId);
    } catch (error) {
      console.error('flux: could not read a subgroup’s messages', error);
      return [];
    }
  }

  return {
    subgroupMessages: action(
      readSubgroupMessages,
      'The messages in one of Flux’s conversation subgroups, oldest first — { id, author, timestamp, body }. Read when asked, since a subgroup’s messages are not a relation a $query can follow.',
      { ambient: true },
    ),
  };
}

export const fluxModule: ModuleDefinition = defineModule({
  manifest: {
    id: 'flux',
    name: 'Flux',
    description: 'Reads conversations a Flux community keeps, in a space synced in from Flux.',
    icon: 'chats-circle',
    requires: { backends: ['ad4m'] },
  },
  createStore: (deps: ModuleStoreDeps) => createFluxStore(deps),
});

/** The one factory shape every module package exports — the generated registry imports it. */
export const createModule = (_host: ModuleHost): ModuleDefinition => fluxModule;
