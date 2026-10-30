/**
 * WE's own chrome, as parts an app template places by name.
 *
 * The host's counterpart of a module's published parts: `{ type: '$part', props: { id: 'host.sidebar' } }`
 * draws WE's sidebar wherever an app template puts it, and the same machinery a module's part has —
 * the ring naming it, keep / open / make it your own, giving a copy back — applies unchanged.
 *
 * Two kinds:
 *
 * - **The app's chrome** — the sidebar and the module rail, drawn from their slots, placed by an app.
 * - **The sign-in screen's pieces** — the form at its centre and the other accounts, placed by an
 *   app's own sign-in screen. WE's sign-in is built from the same two, so an app's that places them is
 *   WE's with its own frame, corner and words around them, and every step and fix arrives in both.
 *   Their inputs change the words a screen is likely to want different, each with WE's as its
 *   default.
 *
 * The editor's panels and bar, the modals and the safety prompts stay drawn by the host whatever the
 * app says: an app that left one of those out would break something it cannot see, from creating a
 * space to editing the app back.
 */
import type { SchemaNode } from '@we/schema-shared';
import { signInAccounts, signInForm } from '@we/template-shell';

import { slotRegistry } from './slotRegistry';

interface HostPart {
  /** The slot it is drawn from, for a piece of chrome the host otherwise draws itself. */
  slot?: string;
  /** Or the node it is, for a piece only ever drawn where somebody places it. */
  node?: SchemaNode;
  label: string;
  description: string;
  /** Words a placement may change, each with WE's own as the default. */
  inputs?: Record<string, { description: string; default: string }>;
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
  'host.signIn.form': {
    node: signInForm,
    label: 'Sign-in form',
    description:
      'Whoever is signing in and the step they are on — unlocking, setting up an account, waiting, or why it failed.',
    inputs: {
      unlockLabel: { description: 'The text of the button that signs in', default: 'Login' },
      passwordLabel: { description: 'A label over the password field; empty for none', default: '' },
    },
  },
  'host.signIn.accounts': {
    node: signInAccounts,
    label: 'Other accounts',
    description: 'The other accounts on this device, and a way to add one. Place it where it should sit.',
  },
};

/** The slots an app template places, which the host's flat chrome therefore leaves out. */
export const HOST_PART_SLOTS: ReadonlySet<string> = new Set(
  Object.values(HOST_PARTS).flatMap((part) => (part.slot ? [part.slot] : [])),
);

export const isHostPart = (id: string): boolean => id in HOST_PARTS;

/** What a host part draws: its own node, or its slot's as the host would have drawn it. */
export function hostPartNode(id: string): SchemaNode | undefined {
  const part = HOST_PARTS[id];
  if (!part) return undefined;
  return part.node ?? (part.slot ? slotRegistry.nodeOf(part.slot) : undefined);
}

/** The words a host part's placement may change. */
export function hostPartInputs(id: string): HostPart['inputs'] {
  return HOST_PARTS[id]?.inputs;
}
