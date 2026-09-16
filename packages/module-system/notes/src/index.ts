/**
 * The Notes feature module — a per-space scratchpad in a right-hand dock panel.
 *
 * The second module, and originally chosen to prove **module-owned entities** worked. It did, and
 * then the point stopped being worth making here: it owned a `Note` whose entire content was a
 * string, which is a `TextBlock` with fewer fields. Two nouns for one thing meant a note written in
 * the composer and a note written in this panel were unrelated records that could never meet.
 *
 * ## Own the container, never the content
 *
 * A note is now a core `TextBlock`, held in a `CollectionBlock` with `kind: 'notes'` — one per space,
 * created on the first note written there. That is the rule the module system settled on: borrow the
 * shared vocabulary for *what a thing is*, and own only the container that says *what surface it
 * belongs to*.
 *
 * It buys more than deduplication. A module that names entities by string rather than shipping
 * decorated classes needs no `backends` declaration, so writing durable data no longer costs
 * portability — which is why this module still declares none while writing to the space.
 *
 * The container is a `CollectionBlock` rather than a `kind`-less bag of tagged blocks because
 * containment and taxonomy are different questions. A tag is what a *user* says a thing is about, and
 * is theirs to remove; if the panel's contents were "blocks tagged note", removing a tag would
 * silently empty someone's scratchpad, and anything anyone tagged would appear in it.
 *
 * Old `Note` records are still read (see `Note.ts`) and never written. Dropping their manifest would
 * not delete them, it would orphan them.
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
 * - **Creating one** — `record.create`, already in the stores bag. The module ships no CRUD wrapper.
 * - **The collection** — found by `$query`, not held anywhere. Deriving it every time is what keeps
 *   it correct across a space switch; a cached id would write this space's notes into the last one.
 * - **Panel open/closed** — the host's. A panel's openness is a fact about the screen rather than
 *   about notes, so the module declares the panel and the host holds the flag: the rail toggles it, a
 *   template's `meta.panels` opens it, the titlebar closes it. Which is why this module has **no
 *   store at all** — the six members it used to carry existed only to answer the dock's string keys.
 *
 * A module that is entirely declaration is the shape the distribution ladder calls rung 2: nothing
 * here is code, so nothing here has to be trusted. Notes is the proof that the data half of the
 * contract is complete for the commonest kind of module, and the file a first author should copy.
 */
import { defineModule, type ModuleDefinition, type ModuleHost } from '@we/module-shared';
import { panelScroll, panelShell } from '@we/schema-kit';
import { type SchemaNode } from '@we/schema-shared';

import { NOTE_MANIFEST, NOTE_PREDICATES } from './Note';

export { NOTE_MANIFEST, NOTE_PREDICATES };

/** The `CollectionBlock.kind` marking a collection as this space's notes. */
export const NOTES_KIND = 'notes';

/** The predicate `CollectionBlock.children` is minted under — how a note attaches to the collection. */
const CHILDREN_PREDICATE = 'we://children';

/**
 * This space's notes collection, resolved live rather than remembered.
 *
 * One hoisted subscription on the panel, read wherever it is needed, and the alternative — holding the id in the store — would be a value that has to be invalidated
 * every time the dataset changes. Getting that wrong writes one space's notes into another, which is
 * the kind of bug nobody notices until the wrong people can read them.
 */
const collectionId = { $: 'first(local.notesCollection).id' };

/**
 * One note, for whichever entity is holding it.
 *
 * Parameterised only by the entity name, which is all that differs between a note and a legacy
 * `Note` — both expose `text` and both delete by id. Written once so the two lists cannot drift into
 * looking like different things, which they are not.
 */
const noteCard = (entity: string): SchemaNode => ({
  type: 'Column',
  props: { bg: 'surface-sunken', r: '300', p: '300', gap: '200' },
  children: [
    { type: 'we-text', children: [{ $: 'note.text' }] },
    {
      type: 'we-button',
      props: {
        variant: 'ghost',
        size: 'xs',
        onClick: { $action: 'record.delete', args: [entity, { $: 'note.id' }] },
      },
      children: [{ type: 'we-icon', props: { name: 'trash' } }],
    },
  ],
});

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
    // an invitation to lose what you typed. Whether the panel is *open* is the host's question and
    // the frame around this node already answers it; this is only about whether there is a space.
    condition: { $: 'datasetStore.currentDataset' },
    /*
      Fills the box the host gave it, and names itself the way every panel does.

      It used to position itself — `fixed`, `right: 48px`, a hardcoded copy of the module rail's
      width — which meant it overlaid the space rather than making room in it, sat on top of the
      editor's controls, and stayed put when a docked call panel took the edge out from under it.
      All three are the host's job; see `docks` below. The box and the header are `panelShell`'s
      now; the close button went the same way, to the host's titlebar via `close` on the dock
      contribution, so every panel has one in one place at one size.

      Spread rather than called plainly, because this root carries a `$queries` of its own — the
      collection every note hangs off, subscribed once for the whole panel. See `collectionId`.
    */
    then: {
      ...panelShell({
        title: 'Notes',
        children: [
          {
            type: 'Column',
            props: { gap: '300' },
            $localState: { draft: { type: 'string', initial: '' } },
            children: [
              {
                type: 'we-textarea',
                props: {
                  value: { $: 'local.draft' },
                  placeholder: 'Jot something down…',
                  rows: 3,
                  onInput: { $setLocal: 'draft', value: { $: 'event.detail' } },
                },
              },
              /*
              Two buttons, identical to look at, because the first note in a space has to make the
              collection before it has somewhere to go.

              Split at the node rather than branching inside `onClick` so each path is a plain action
              list — a `$if` whose arms are action arrays would work, but "what does this button do"
              stops being answerable by reading it, and this is the file people will copy.

              No CRUD wrapper either way: `record.create` is already in the stores bag, and a module
              reaching for its own persistence layer would be duplicating the data port.
            */
              {
                type: '$if',
                props: {
                  condition: collectionId,
                  then: {
                    type: 'we-button',
                    props: {
                      size: 'sm',
                      onClick: [
                        {
                          $action: 'record.create',
                          args: [
                            'TextBlock',
                            { text: { $: 'local.draft' } },
                            { parent: { id: collectionId, predicate: CHILDREN_PREDICATE } },
                          ],
                        },
                        { $setLocal: 'draft', value: '' },
                      ],
                    },
                    children: ['Add note'],
                  },
                  // First note here. Create the collection, then hang the note off whatever id comes
                  // back — chained rather than fired together, since the second needs the first's
                  // result and two parallel creates would race to make two collections.
                  else: {
                    type: 'we-button',
                    props: {
                      size: 'sm',
                      onClick: [
                        {
                          $action: 'record.create',
                          // `mode: 'feed'` is what stops `reconcileBlocks` ever running here: notes
                          // accumulate from whoever is in the space, so treating one writer's tree
                          // as the whole truth would delete everyone else's.
                          args: ['CollectionBlock', { kind: NOTES_KIND, type: 'collection', mode: 'feed' }],
                          onSuccess: [
                            {
                              $action: 'record.create',
                              args: [
                                'TextBlock',
                                { text: { $: 'local.draft' } },
                                { parent: { id: { $: 'result.id' }, predicate: CHILDREN_PREDICATE } },
                              ],
                            },
                            { $setLocal: 'draft', value: '' },
                          ],
                        },
                      ],
                    },
                    children: ['Add note'],
                  },
                },
              },
            ],
          },
          panelScroll({
            children: [
              {
                type: 'Column',
                props: { gap: '300' },
                children: [
                  // The notes themselves — the collection's children, newest first.
                  {
                    type: '$if',
                    props: {
                      condition: collectionId,
                      then: {
                        type: '$each',
                        // Live query — the renderer handles subscription and reactivity, so the module
                        // needs neither a notes array nor a refresh method. Scoped to the collection
                        // rather than filtered, because a drill-down from an anchor is the traversal
                        // the query layer does natively; a `TextBlock` query with no scope would pick
                        // up every paragraph of every post in the space.
                        props: {
                          items: {
                            $query: {
                              entity: 'TextBlock',
                              scope: { anchor: 'CollectionBlock', via: 'children', anchorId: collectionId },
                              order: { createdAt: 'desc' },
                            },
                          },
                          as: 'note',
                        },
                        children: [noteCard('TextBlock')],
                      },
                    },
                  },
                  /*
                  Notes written before a note was a `TextBlock`.

                  Read, never written. They are shown in the same list rather than behind a "legacy"
                  heading because to the person who wrote them they are simply their notes, and the
                  storage change is not their problem. Deleting still works, so the set drains on its
                  own; when it is empty everywhere, this block and `Note.ts` go together.
                */
                  {
                    type: '$each',
                    props: { items: { $query: { entity: 'Note' } }, as: 'note' },
                    children: [noteCard('Note')],
                  },
                ],
              },
            ],
          }),
        ],
      }),
      // The collection every note hangs off, subscribed once for the whole panel.
      $queries: { notesCollection: { entity: 'CollectionBlock', where: { kind: NOTES_KIND }, limit: 1 } },
    },
  },
};

/**
 * A drop-in trigger a template can place wherever it likes.
 *
 * Through the host, because the host holds the flag: `launchModule` takes a panel's dock id and does
 * what the rail's button does, including bringing a panel that is open but out of sight into view.
 */
const toggleButton: SchemaNode = {
  type: 'we-button',
  props: { variant: 'ghost', size: 'sm', onClick: { $action: 'spaceStore.launchModule', args: ['notes:main'] } },
  children: [{ type: 'we-icon', props: { name: 'note' } }],
};

export const notesModule: ModuleDefinition = defineModule({
  manifest: {
    id: 'notes',
    name: 'Notes',
    description: 'A per-space scratchpad in a docked panel.',
    icon: 'note',
    // No `frameworks` — every piece of UI here is a fragment. No kernels — everything the panel does
    // goes through `record.create` and `$query`, which are the template's. What a person is told at
    // install ("stores data in your spaces", "adds a panel") is derived from what is declared below.
  },
  contributes: {
    // Still declared, still never written to. Notes are `TextBlock`s now; this keeps the ones written
    // before that readable, and removing it would orphan them rather than delete them. See `Note.ts`.
    entities: { manifest: NOTE_MANIFEST },

    parts: { toggleButton },

    /**
     * The panel. One object: what it is called, what it shows, how it would like to open. The host
     * holds whether it is open, draws its rail button from `icon` and `title`, and remembers wherever
     * somebody drags it. `right` because that is the edge the module rail is on; `md` is an opening
     * bid the user overrides by dragging.
     */
    panels: [{ name: 'main', title: 'Notes', icon: 'note', node: panel, bid: { edge: 'right', size: 'md' } }],
  },
});

/** The one factory shape every module package exports — the generated registry imports it. */
export const createModule = (_host: ModuleHost): ModuleDefinition => notesModule;
