/**
 * The Notes feature module — a per-space scratchpad in a right-hand dock panel.
 *
 * The second module, and chosen for what it tests that the globe cannot: **module-owned entities**.
 * It is fully solo-testable, because a personal perspective is local-only — no neighbourhood, no
 * Holochain sync — so it exercises the install path without depending on peer connectivity.
 *
 * ## Fragments, not components
 *
 * Every piece of UI here is a `SchemaNode`. Nothing in this package imports Solid, `@we/components`,
 * or any framework — `Column`, `we-button` and `we-textarea` are registry *keys* resolved by whichever
 * renderer is running, so the same fragments would render under a React host. The module is Tier 1 in
 * the convention: framework code only for imperative cores, and a notes panel has none.
 *
 * Note what that buys concretely: this module has no framework import to duplicate, so it cannot
 * introduce the second-runtime hazard when modules eventually load dynamically.
 *
 * ## Where its state lives
 *
 * - **The notes themselves** — a live `$query` in the fragment. No store method, no manual
 *   subscription; the renderer's reactivity does it.
 * - **Creating one** — `model.create`, already in the stores bag. The module ships no CRUD wrapper.
 * - **Panel open/closed** — the store, because this is *chrome*. `$localState` is per-node and would
 *   reset the panel every time the route changed, which is exactly what a docked panel must not do.
 *
 * The store's reactivity is injected (`deps.signal`) rather than imported, the same port trick that
 * keeps `@we/schema-shared` framework-neutral.
 */
import { defineModule, type ModuleStoreDeps } from '@we/module-shared';
import { type SchemaNode } from '@we/schema-shared';

import { NOTE_MANIFEST, NOTE_PREDICATES } from './Note';

export { NOTE_MANIFEST, NOTE_PREDICATES };

/**
 * The docked panel.
 *
 * A module has to be reachable on its own — shipping only the expanded panel plus a `toggleButton`
 * fragment left no entry point until some template placed it, so the module was installed, registered
 * and invisible. That was first fixed with a launcher tab this module drew itself, at the right edge.
 * The call module then needed the same thing and put it somewhere else, which is how a per-module
 * launcher became visibly the wrong shape.
 *
 * It is now declared (`launcher` below) and drawn by the host's module rail, so every module is opened
 * the same way. `toggleButton` is still exported for templates that want the trigger somewhere of
 * their own choosing.
 */
const panel: SchemaNode = {
  type: '$if',
  props: {
    // Nothing at all outside a space. Notes are written into the current dataset, so the panel is
    // only meaningful where there is one — offering it on a screen with nowhere to save to would be
    // an invitation to lose what you typed.
    //
    // This is the crude version of a question the module system hasn't answered yet: *which* spaces
    // should show it. `Space.enabledModules` is the real answer — a community turning the module on
    // for its space — and it arrives with the marketplace, alongside consent. Until then a module's
    // chrome appears in every space, which is fine while modules are first-party and bundled.
    condition: { $and: [{ $store: 'datasetStore.currentDataset' }, { $store: 'modules.notes.open' }] },
    then: {
      type: 'Column',
      props: {
        position: 'fixed',
        top: '0px',
        // Beside the module rail, not under it — the rail has to stay reachable while a panel is open.
        right: '48px',
        width: '320px',
        height: '100%',
        bg: 'neutral-0',
        borderLeft: '1px solid neutral-200',
        p: '400',
        gap: '400',
        zIndex: 'sticky',
      },
      children: [
        {
          type: 'Row',
          props: { ax: 'between', ay: 'center' },
          children: [
            { type: 'we-text', props: { variant: 'heading-sm' }, children: ['Notes'] },
            {
              type: 'we-button',
              props: { variant: 'ghost', size: 'sm', onClick: { $action: 'modules.notes.close' } },
              children: [{ type: 'we-icon', props: { name: 'x' } }],
            },
          ],
        },
        {
          type: 'Column',
          props: { gap: '300' },
          $localState: { draft: { type: 'string', initial: '' } },
          children: [
            {
              type: 'we-textarea',
              props: {
                value: { $local: 'draft' },
                placeholder: 'Jot something down…',
                rows: 3,
                onInput: { $setLocal: 'draft', from: '$event.detail' },
              },
            },
            {
              type: 'we-button',
              props: {
                size: 'sm',
                // No CRUD wrapper in this module — `model.create` is already in the stores bag, and a
                // module reaching for its own persistence layer would be duplicating the data port.
                onClick: [
                  { $action: 'model.create', args: ['Note', { text: { $local: 'draft' } }] },
                  { $setLocal: 'draft', value: '' },
                ],
              },
              children: ['Add note'],
            },
          ],
        },
        {
          type: 'we-scroll-area',
          children: [
            {
              type: 'Column',
              props: { gap: '300' },
              children: [
                {
                  type: '$each',
                  // Live query — the renderer handles subscription and reactivity, so the module needs
                  // neither a notes array nor a refresh method.
                  props: { items: { $query: { entity: 'Note' } }, as: 'note' },
                  children: [
                    {
                      type: 'Column',
                      props: { bg: 'neutral-50', r: '300', p: '300', gap: '200' },
                      children: [
                        { type: 'we-text', children: ['$note.text'] },
                        {
                          type: 'we-button',
                          props: {
                            variant: 'ghost',
                            size: 'xs',
                            onClick: { $action: 'model.delete', args: ['Note', '$note.id'] },
                          },
                          children: [{ type: 'we-icon', props: { name: 'trash' } }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
};

/** A drop-in trigger a template can place wherever it likes. */
const toggleButton: SchemaNode = {
  type: 'we-button',
  props: { variant: 'ghost', size: 'sm', onClick: { $action: 'modules.notes.toggle' } },
  children: [{ type: 'we-icon', props: { name: 'note' } }],
};

export const notesModule = defineModule({
  id: 'notes',
  name: 'Notes',
  description: 'A per-space scratchpad in a docked panel.',
  icon: 'note',

  // Displayed at install, never scored. "Store data in your spaces" and "add a panel to your screen"
  // are the two things a user is actually agreeing to.
  capabilities: ['storage', 'slot:dock-right'],

  // No `frameworks` — every piece of UI here is a fragment, so this module is framework-agnostic.

  entities: { manifest: NOTE_MANIFEST },
  schemas: { toggleButton },
  slots: [{ anchor: 'dock-right', node: panel, order: 100 }],

  // Drawn by the host's module rail rather than by this module, so every module is opened the same
  // way. `activeWhen` is what makes the rail tab highlight while the panel is open.
  launcher: { icon: 'note', label: 'Notes', action: 'toggle', activeWhen: 'open' },

  createStore: ({ signal }: ModuleStoreDeps) => {
    const [open, setOpen] = signal(false);
    return {
      open,
      toggle: () => setOpen(!open()),
      close: () => setOpen(false),
    };
  },
});
