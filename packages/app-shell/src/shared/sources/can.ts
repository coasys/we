/**
 * Whether the viewer may take an action in the space on screen — for a template choosing what to
 * offer. See `canFrom` in `shared/spacePolicy.ts`; the write is checked again when it is made, so a
 * template that offers too much is refused, not obeyed.
 */
import { canFrom, type SpacePolicyView } from '../spacePolicy';

export function can(options: { policy?: unknown; action?: unknown; record?: unknown }): boolean {
  if (!options || typeof options.action !== 'string') return false;
  return canFrom(options.policy as SpacePolicyView | undefined, options.action, options.record);
}
