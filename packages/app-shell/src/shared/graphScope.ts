/**
 * An inbound graph read, as a read the model layer answers natively.
 *
 * The graph's shared relation reader asks backward as `scope: { anchor, via, anchorId, direction:
 * 'in' }` — "what points at these through `via`", where `via` is the *result's* relation. The model
 * layer's reads narrow by a parent's own relation and have no inbound form, so the host answered every
 * such read by scanning candidates and filtering here.
 *
 * Most of them need no scan. When `via` is a to-one the result's class declares, holding the anchor's
 * id, the question is a filter on that field — `where: { replyTo: [ids] }` — which both backends push
 * down, the live test reads on an executor, and a watch can subscribe to like any other read. A list,
 * a reverse read, or a read over several entities are left to the scan, which still says so.
 */
import type { EntityManifestEntry } from '@we/backend-shared';

export interface GraphScope {
  anchor: string;
  via: string;
  anchorId: string | string[];
  direction?: 'in' | 'out';
}

export function inboundAsWhere(
  manifest: readonly EntityManifestEntry[],
  entity: string | string[],
  scope: GraphScope,
): Record<string, unknown> | undefined {
  if (scope.direction !== 'in' || typeof entity !== 'string') return undefined;
  const property = manifest.find((entry) => entry.name === entity)?.properties.find((p) => p.name === scope.via);
  if (!property || property.type !== 'uri' || property.isCollection || property.reverse) return undefined;
  return { [scope.via]: scope.anchorId };
}
