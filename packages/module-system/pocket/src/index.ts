/**
 * The Pocket — a panel you drag things into, from anywhere, and that stays yours.
 *
 * ## What it is for
 *
 * WE is a lot of spaces. A post here, a person there, a space somebody mentioned: the app had no
 * way to say "keep this" that was not *in* the space it was said in. Everything durable belonged to
 * a community, so anything a person wanted to hold across communities had nowhere to be.
 *
 * The Pocket is that place. It holds **references** — a post stays in its space, and this points at
 * it — organised into folders, kept in the agent's own personal space, and reachable wherever they
 * are, including outside a space entirely.
 *
 * ## The first agent-scoped module
 *
 * Both halves of the module contract assumed a community: entities install into spaces, and chrome
 * is gated on the space having the module on. Neither is right here — a panel that gathers from
 * *across* spaces has no space to be enabled in, and its contents are nobody else's business. So
 * this module declares `manifest.scope: 'agent'` and `entities: { scope: 'agent' }`, and reaches its
 * data through the `agentData` kernel, which is the personal space and nothing else.
 *
 * ## Own the container, never the content
 *
 * The same rule the notes module settled on, applied one level up. A gathered post is not copied:
 * what is owned here is a `PocketItem`, which is an address plus a note-to-self about how the thing
 * looked. Nothing about the post itself moves, and taking something out of your Pocket leaves it
 * exactly where it was.
 *
 * ## Private by default
 *
 * The Pocket is the module whose store touches the **agent's private personal space**, and it was the
 * reason the contract grew an opt-out list of members a space template could not reach: before it, a
 * synced template could call `modules.pocket.gather` and file things into a store belonging to no
 * space at all. Members are private unless marked now, so the list is gone: the store marks the four
 * chrome members public and says nothing about the rest, which is what "private" means.
 */
import { defineModule, type ModuleDefinition, type ModuleHost, type ModuleStoreDeps } from '@we/module-shared';

import { POCKET_MANIFEST, POCKET_PREDICATES } from './entities';
import { panel, toggleButton } from './Panel.schema';
import { createPocketStore } from './store';

export { POCKET_MANIFEST, POCKET_PREDICATES };
export type { GatherInput, PocketFolderRow, PocketRow } from './store';

export const pocketModule: ModuleDefinition = defineModule({
  manifest: {
    id: 'pocket',
    name: 'Pocket',
    description: 'Keep things from any space — posts, people, spaces — in a panel that follows you.',
    icon: 'bag-simple',
    /**
     * The agent's, not a community's. See `ModuleManifest.scope`.
     *
     * The consequence worth stating: turning this off is Settings → Modules, and no space can turn it
     * off for you or on for you. That is the same asymmetry as your mute list.
     */
    scope: 'agent',
    // No `frameworks` — every piece of UI is a fragment. One kernel: the agent's own records.
    requires: { kernels: ['agentData'] },
  },

  contributes: {
    // Declared rather than written against a backend, and installed into the personal space.
    entities: { manifest: POCKET_MANIFEST, scope: 'agent' },

    parts: { toggleButton },

    /**
     * The panel. The Pocket keeps ownership of whether it is open — `open`, `show`, `close` name its
     * own store members — because opening it is what resolves the root folder, so the flag is a fact
     * about the Pocket and not only about the screen. Most modules leave the flag to the host.
     */
    panels: [
      {
        name: 'main',
        title: 'Pocket',
        icon: 'bag-simple',
        node: panel,
        bid: { edge: 'right', size: 'md' },
        open: 'open',
        show: 'show',
        close: 'close',
      },
    ],

    /**
     * `holds` on the panel being open is deliberate even though `scope: 'agent'` already keeps it
     * mounted everywhere: the gate is a disjunction, so this survives a future in which somebody
     * narrows the agent gate again. Cheap, and the failure it prevents — a panel vanishing with what
     * it was holding — is the one this module exists to avoid.
     */
    holds: 'open',
  },

  createStore: (deps: ModuleStoreDeps) => createPocketStore(deps),
});

/** The one factory shape every module package exports — the generated registry imports it. */
export const createModule = (_host: ModuleHost): ModuleDefinition => pocketModule;
