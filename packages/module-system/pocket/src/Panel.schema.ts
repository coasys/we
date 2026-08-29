import type { SchemaNode } from '@we/schema-shared';

import { POCKET_PREDICATES } from './entities';

/**
 * Everything the Pocket draws, as data.
 *
 * No framework import anywhere in this package — `Column`, `we-button` and `we-drop-zone` are
 * registry *keys* resolved by whichever renderer is running, so the same fragments would render
 * under a React host. Tier 1 in the convention: framework code only for imperative cores, and a
 * list of things you kept has none.
 *
 * ## Where its data comes from
 *
 * The root dataset, read straight from the fragments with `dataset: 'datasetStore.rootDataset'` and
 * written with `record.create`'s `perspective` option. That surface already existed; what the module
 * contract was missing was permission for a *module's own* entities to be installed there, which is
 * what `entities: { scope: 'agent' }` adds. Only the parts a template genuinely cannot do — building
 * a reference, asking whether one is already held, going to one — are in the store.
 */

/** The dataset every fragment here reads and writes. Named once so a typo cannot scatter. */
const ROOT = 'datasetStore.rootDataset';

/**
 * The folder being looked at: the one somebody navigated into, or the root.
 *
 * The root is found rather than remembered, for the reason the notes module finds its collection
 * rather than remembering it — a held id is a value that has to be invalidated, and getting that
 * wrong writes into the wrong container.
 *
 * **A ternary, not `||`.** WE's `||` answers with a *boolean*, never with an operand — so the
 * obvious JavaScript spelling of this resolves to `true`, and `true` is what then reached the
 * executor as an `anchorId` ("data did not match any variant of untagged enum Scope") and as a
 * link source ("Link source must not be empty"). Every fallback in this file was written that way
 * and every one of them was wrong; `??` is no use either, since these all default to `''` rather
 * than to null.
 */
const currentFolder = { $: 'modules.pocket.folderId ? modules.pocket.folderId : first(local.rootFolder).id' };

/** A row's own drag payload — the parts of its reference, written out when it was gathered. */
const itemRow: SchemaNode = {
  type: 'we-draggable',
  props: {
    entity: { $: 'item.entity' },
    recordId: { $: 'item.recordId' },
    datasetKey: { $: 'item.datasetKey' },
    label: { $: 'item.label' },
    icon: { $: 'item.icon' },
  },
  children: [
    {
      type: 'Row',
      props: {
        bg: 'surface-sunken',
        r: '300',
        p: '300',
        gap: '300',
        ay: 'center',
        width: '100%',
      },
      children: [
        {
          type: 'we-icon',
          props: { name: { $: "item.icon ? item.icon : 'bookmark-simple'" }, color: 'text-muted' },
        },
        {
          type: 'Column',
          props: { gap: '100', flex: '1', minWidth: '0' },
          children: [
            {
              type: 'we-text',
              props: { truncate: true },
              children: [{ $: "item.label ? item.label : (item.entity ? item.entity : 'Untitled')" }],
            },
            {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-faint', truncate: true },
                  children: [{ $: "item.sourceName ? item.sourceName : 'Somewhere else'" }],
                },
                {
                  type: 'we-timestamp',
                  props: { value: { $: 'item.gatheredAt' }, relative: true, fontSize: '100', color: 'text-faint' },
                },
              ],
            },
          ],
        },
        /*
          Going to a gathered thing opens the record's own page, joining the space first where it
          has not been joined — a sequence, which is why it is a store action rather than an href.

          Absent for a person, who has no page: gated on the stored `datasetKey` rather than by
          asking the store, because a store's actions are unreachable from an expression and the row
          already carries the answer. A control that cannot work is worse than no control.
        */
        {
          type: '$if',
          props: {
            condition: { $: "item.datasetKey != 'agent'" },
            then: {
              type: 'we-button',
              props: {
                variant: 'ghost',
                size: 'sm',
                title: 'Open',
                onClick: { $action: 'modules.pocket.goTo', args: [{ $: 'item.ref' }] },
              },
              children: [{ type: 'we-icon', props: { name: 'arrow-square-out' } }],
            },
          },
        },
        {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'sm',
            title: 'Take out of your Pocket',
            onClick: { $action: 'modules.pocket.forget', args: [{ $: 'item.id' }] },
          },
          children: [{ type: 'we-icon', props: { name: 'x' } }],
        },
      ],
    },
  ],
};

const folderRow: SchemaNode = {
  type: 'we-button',
  props: {
    variant: 'ghost',
    width: '100%',
    ax: 'start',
    gap: '300',
    onClick: { $action: 'modules.pocket.enter', args: [{ $: 'folder.id' }, { $: 'folder.name' }] },
  },
  children: [
    { type: 'we-icon', props: { name: { $: "folder.icon ? folder.icon : 'folder'" } } },
    { type: 'we-text', props: { truncate: true }, children: [{ $: "folder.name ? folder.name : 'Folder'" }] },
  ],
};

/** What the panel says when there is nothing in it — which is most people's first sight of it. */
const emptyPocket: SchemaNode = {
  type: 'Column',
  props: { ax: 'center', ay: 'center', gap: '200', p: '600', width: '100%' },
  children: [
    { type: 'we-icon', props: { name: 'bag-simple', size: 'lg', color: 'text-faint' } },
    {
      type: 'we-text',
      props: { color: 'text-faint', textAlign: 'center' },
      children: ['Drag anything in here to keep it — a post, a person, a space.'],
    },
    {
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-faint', textAlign: 'center' },
      children: ['What you keep is yours, and follows you between spaces.'],
    },
  ],
};

/**
 * What is in the folder being looked at: its sub-folders, then what was gathered into it.
 *
 * Split out so the whole subtree — both subscriptions included — can be gated on there being a
 * folder at all. `$queries` on a node run whether or not anything reads them, so leaving these
 * mounted and merely hiding the rows would still fire two drill-downs with no anchor.
 */
const folderContents: SchemaNode = {
  type: 'Column',
  props: { gap: '200', width: '100%' },
  $queries: {
    folders: {
      entity: 'PocketFolder',
      scope: { anchor: 'PocketFolder', via: 'folders', anchorId: currentFolder },
      dataset: ROOT,
    },
    items: {
      entity: 'PocketItem',
      scope: { anchor: 'PocketFolder', via: 'items', anchorId: currentFolder },
      order: { gatheredAt: 'desc' },
      dataset: ROOT,
    },
  },
  children: [
    { type: '$each', props: { items: { $: 'local.folders' }, as: 'folder' }, children: [folderRow] },
    { type: '$each', props: { items: { $: 'local.items' }, as: 'item' }, children: [itemRow] },
    /*
      Only once both subscriptions have answered. An empty `$each` renders nothing at all, so
      without this the first frame of every open would claim the Pocket is empty — which for the one
      screen whose whole job is to hold what you kept is the worst possible thing to say.
    */
    {
      type: '$if',
      props: {
        condition: {
          $: 'local.foldersLoaded && local.itemsLoaded && !count(local.folders) && !count(local.items)',
        },
        then: emptyPocket,
      },
    },
  ],
};

const header: SchemaNode = {
  type: 'Row',
  props: { ay: 'center', gap: '200', width: '100%' },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: 'count(modules.pocket.trail)' },
        then: {
          type: 'we-button',
          props: { variant: 'ghost', size: 'sm', title: 'Back', onClick: { $action: 'modules.pocket.up' } },
          children: [{ type: 'we-icon', props: { name: 'arrow-left' } }],
        },
      },
    },
    {
      type: 'we-text',
      props: { variant: 'heading-sm', flex: '1', minWidth: '0', truncate: true },
      children: ['Pocket'],
    },
    {
      type: 'we-button',
      props: {
        variant: 'ghost',
        size: 'sm',
        title: 'New folder',
        onClick: { $setLocal: 'newFolderOpen', value: true },
      },
      children: [{ type: 'we-icon', props: { name: 'folder-plus' } }],
    },
  ],
};

/**
 * Naming a new folder.
 *
 * Written out rather than reaching for `formModal`, because that fragment lives in
 * `@we/template-kit` — which reads WE's own stores, and a module depending on it would be taking on
 * the host's store surface. The kit's portable half is `@we/schema-kit`; a form modal is not in it.
 */
const newFolderForm: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'local.newFolderOpen' },
    then: {
      type: 'Row',
      props: { gap: '200', width: '100%' },
      children: [
        {
          type: 'we-input',
          props: {
            value: { $: 'local.newFolderName' },
            placeholder: 'Folder name…',
            size: 'sm',
            autofocus: true,
            onInput: { $setLocal: 'newFolderName', value: { $: 'event.detail' } },
          },
        },
        {
          type: 'we-button',
          props: {
            size: 'sm',
            disabled: { $: '!trim(local.newFolderName)' },
            onClick: [
              {
                $action: 'record.create',
                args: [
                  'PocketFolder',
                  { name: { $: 'local.newFolderName' } },
                  {
                    perspective: ROOT,
                    parent: { id: currentFolder, predicate: POCKET_PREDICATES.folders },
                  },
                ],
                onSuccess: [
                  { $setLocal: 'newFolderName', value: '' },
                  { $setLocal: 'newFolderOpen', value: false },
                ],
              },
            ],
          },
          children: ['Add'],
        },
        {
          type: 'we-button',
          props: { variant: 'ghost', size: 'sm', onClick: { $setLocal: 'newFolderOpen', value: false } },
          children: ['Cancel'],
        },
      ],
    },
  },
};

/**
 * The docked panel.
 *
 * The whole thing is one drop zone, listing nothing in `accepts`: a Pocket that refused a kind of
 * thing would have to be taught every new one, and "keep this" is not a claim about what a thing
 * *is*. A composer says what it takes; a bag does not.
 */
const panel: SchemaNode = {
  type: '$if',
  props: {
    // No dataset of your own, nowhere to keep anything. Unlike the notes panel this does **not**
    // check for a current space: the Pocket's whole point is that it outlives the one you are in.
    condition: { $: 'datasetStore.rootDataset && modules.pocket.open' },
    then: {
      type: 'we-drop-zone',
      props: {
        width: '100%',
        height: '100%',
        onDropped: { $action: 'modules.pocket.gather', args: [{ $: 'event.detail' }] },
      },
      children: [
        {
          type: 'Column',
          $queries: {
            rootFolder: { entity: 'PocketFolder', where: { root: true }, limit: 1, dataset: ROOT },
          },
          $localState: {
            newFolderOpen: { type: 'boolean', initial: false },
            newFolderName: { type: 'string', initial: '' },
          },
          props: { width: '100%', height: '100%', p: '400', gap: '300', overflow: 'hidden' },
          children: [
            header,
            newFolderForm,
            {
              type: 'we-scroll-area',
              children: [
                /*
                  Nothing is listed until there is a folder to list the contents of.

                  The root folder is made by the first gather, so before that there is no anchor —
                  and a drill-down whose `anchorId` is undefined is not an empty query, it is a
                  malformed one. The notes panel gates its own scoped query the same way and for the
                  same reason; this is that lesson, one module later.

                  `rootFolderLoaded` rather than the folder itself, so the first frame of every open
                  says nothing rather than claiming the Pocket is empty.
                */
                {
                  type: '$if',
                  props: {
                    condition: currentFolder,
                    then: folderContents,
                    else: {
                      type: '$if',
                      props: { condition: { $: 'local.rootFolderLoaded' }, then: emptyPocket },
                    },
                  },
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
  props: { variant: 'ghost', size: 'sm', onClick: { $action: 'modules.pocket.toggle' } },
  children: [{ type: 'we-icon', props: { name: 'bag-simple' } }],
};

export { panel, toggleButton };
