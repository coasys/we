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
 * it — organised into folders, kept in the agent's own root dataset, and reachable wherever they
 * are, including outside a space entirely.
 *
 * ## The first agent-scoped module
 *
 * Both halves of the module contract assumed a community: entities install into spaces, and chrome
 * is gated on the space having the module on. Neither is right here — a panel that gathers from
 * *across* spaces has no space to be enabled in, and its contents are nobody else's business. So
 * this module declares `scope: 'agent'` and `entities: { scope: 'agent' }`, which are the two
 * fields that change, and everything else about the contract is unchanged.
 *
 * ## Own the container, never the content
 *
 * The same rule the notes module settled on, applied one level up. A gathered post is not copied:
 * what is owned here is a `PocketItem`, which is an address plus a note-to-self about how the thing
 * looked. Nothing about the post itself moves, and taking something out of your Pocket leaves it
 * exactly where it was.
 *
 * ## Fragments, not components
 *
 * Every piece of UI is a `SchemaNode` (see `panel.ts`). The store holds the four things data cannot
 * express — see its docstring — and nothing else.
 */
import { defineModule, type ModuleStoreDeps } from '@we/module-shared';

import { POCKET_MANIFEST, POCKET_PREDICATES } from './entities';
import { panel, toggleButton } from './Panel.schema';
import { createPocketStore } from './store';

export { POCKET_MANIFEST, POCKET_PREDICATES };
export type { GatherInput, PocketFolderRow, PocketRow } from './store';

export const pocketModule = defineModule({
  id: 'pocket',
  name: 'Pocket',
  description: 'Keep things from any space — posts, people, spaces — in a panel that follows you.',
  icon: 'bag-simple',

  /**
   * The agent's, not a community's. See `ModuleDefinition.scope`.
   *
   * The consequence worth stating: turning this off is Settings → Modules, and no space can turn it
   * off for you or on for you. That is the same asymmetry as your mute list.
   */
  scope: 'agent',

  // Displayed at install, never scored. "Store data in your spaces" and "add a panel to your
  // screen" are the two things somebody is actually agreeing to.
  capabilities: ['storage', 'dock'],

  // No `frameworks` and no `backends` — every piece of UI is a fragment, and the entities are
  // declared rather than written against a backend.
  entities: { manifest: POCKET_MANIFEST, scope: 'agent' },

  schemas: { toggleButton },

  docks: [{ edge: 'dockEdge', size: 'dockSize', float: 'dockFloat', close: 'close', node: panel }],

  /**
   * `holdsWhen` on the panel being open is deliberate even though `scope: 'agent'` already keeps it
   * mounted everywhere: the gate is a disjunction, so this survives a future in which somebody
   * narrows the agent gate again. Cheap, and the failure it prevents — a panel vanishing with what
   * it was holding — is the one this module exists to avoid.
   */
  holdsWhen: 'modules.pocket.open',

  launcher: { icon: 'bag-simple', label: 'Pocket', action: 'toggle', activeWhen: 'open' },

  createStore: (deps: ModuleStoreDeps) => createPocketStore(deps),

  /*
    Everything that reads or writes the Pocket's contents is chrome's alone.

    The Pocket is the first module whose store touches the **agent's private root dataset** —
    `PocketItem` and `PocketFolder` live beside your settings and your installed templates, not in
    the space you happen to be looking at. `modules` is the one namespace a template bag hands over
    whole, so before this a synced space template could call `modules.pocket.gather` and file things
    into a store belonging to no space at all, or read `refs` to enumerate what somebody keeps.

    The reads are withheld along with the writes: `refs` and `crumbs` are the contents and the folder
    names, which is the same private thing seen from the other side.

    What stays open is what the Pocket is *as chrome* — `open`, `toggle`, `show`, `close`, the dock
    keys and `canOpen`. A template offering "put this in your Pocket" wants a button that opens the
    panel, and the person then drops the thing in themselves; that is the whole interaction, and it
    costs a space template nothing to have to go through the person.

    The panel itself is host chrome (module panels render against the chrome bag), so it reaches all
    of these unchanged.
  */
  chromeOnlyStoreMembers: [
    'folderId',
    'crumbs',
    'canGoUp',
    'enter',
    'up',
    'goToCrumb',
    'refs',
    'holds',
    'busy',
    'lastError',
    'gather',
    'gatherInto',
    'forget',
    'refresh',
    'goTo',
  ],
});
