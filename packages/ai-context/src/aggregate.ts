import type { ContextData, ContextFragment } from '@we/schema-shared';

/**
 * Merge multiple context fragments into a unified ContextData.
 * Each fragment contributes its non-empty sections; arrays are concatenated.
 */
export function aggregateFragments(fragments: ContextFragment[]): ContextData {
  return {
    primitives: fragments.flatMap((f) => f.primitives ?? []),
    components: fragments.flatMap((f) => f.components ?? []),
    models: fragments.flatMap((f) => f.models ?? []),
    tokens: fragments.flatMap((f) => f.tokens ?? []),
    storeEntries: fragments.flatMap((f) => f.storeEntries ?? []),
    pluginCatalogs: fragments.flatMap((f) => f.pluginCatalogs ?? []),
  };
}
