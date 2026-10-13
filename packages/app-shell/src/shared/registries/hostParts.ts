/**
 * WE's own chrome, as parts an app template places by name.
 *
 * The host's counterpart of a module's published parts: `{ type: '$part', props: { id: 'host.sidebar' } }`
 * draws WE's sidebar wherever an app template puts it, and the same machinery a module's part has —
 * the ring naming it, keep / open / make it your own, giving a copy back — applies unchanged.
 *
 * Only the pieces an app arranges are here. The editor's panels and bar, the boot screen and its
 * modals, module chrome and the safety prompts stay drawn by the host whatever the app says: an app
 * that left one of those out would break something it cannot see, from creating a space to editing
 * the app back.
 */
import type { SchemaNode } from '@we/schema-shared';

import { slotRegistry } from './slotRegistry';

interface HostPart {
  /** The slot it is drawn from. */
  slot: string;
  label: string;
  description: string;
}

export const HOST_PARTS: Readonly<Record<string, HostPart>> = {
  'host.sidebar': {
    slot: 'core:sidebar',
    label: 'Sidebar',
    description: 'Your spaces, and the way to everything else in WE.',
  },
  'host.rail': {
    slot: 'core:chromeRail',
    label: 'Module rail',
    description: 'A button for each panel a module offers.',
  },
};

/** The slots an app template places, which the host's flat chrome therefore leaves out. */
export const HOST_PART_SLOTS: ReadonlySet<string> = new Set(Object.values(HOST_PARTS).map((part) => part.slot));

export const isHostPart = (id: string): boolean => id in HOST_PARTS;

/** What a host part draws: its slot's node, as the host would have drawn it. */
export function hostPartNode(id: string): SchemaNode | undefined {
  const part = HOST_PARTS[id];
  return part ? slotRegistry.nodeOf(part.slot) : undefined;
}
