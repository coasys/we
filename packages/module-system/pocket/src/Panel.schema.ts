import { recordCard } from '@we/schema-kit';
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
 * a reference, asking whether one is already held, going to one, and remembering which folder you
 * are in — are in the store.
 */

/** The dataset every fragment here reads and writes. Named once so a typo cannot scatter. */
const ROOT = 'datasetStore.rootDataset';

/**
 * The folder being looked at, straight from the store.
 *
 * It used to be found here instead — `modules.pocket.folderId ? … : first(local.rootFolder).id`,
 * over a `$query` for the root — which is how the panel ended up with a folder id the *store* did
 * not have. `enter` could then never record where you had come from, so the way back out never
 * appeared and a folder was a one-way door. One value, in one place, is the fix; the store now
 * resolves the root when the panel opens and holds the whole path.
 *
 * Empty for the one round trip before that resolves, which is what the gate below is for.
 *
 * A note that outlives the bug: **WE's `||` answers with a boolean, never with an operand.** Every
 * fallback in this file was once written that way, and each resolved to `true` — reaching the
 * executor as an `anchorId` ("data did not match any variant of untagged enum Scope") and as a link
 * source ("Link source must not be empty"). `??` is no use either, since these default to `''`
 * rather than to null. The ternary is the operator that answers with an operand.
 */
const currentFolder = { $: 'modules.pocket.folderId' };

/** What a row says its label is, falling back through the entity name to something rather than nothing. */
const itemLabel = { $: "item.label ? item.label : (item.entity ? item.entity : 'Untitled')" };
const itemIcon = { $: "item.icon ? item.icon : 'bookmark-simple'" };
const itemSource = { $: "item.sourceName ? item.sourceName : 'Somewhere else'" };

/** The parts of a row's reference, as `we-draggable` wants them — so anything kept can be taken out again. */
const dragProps = {
  entity: { $: 'item.entity' },
  recordId: { $: 'item.recordId' },
  datasetKey: { $: 'item.datasetKey' },
  label: { $: 'item.label' },
  icon: { $: 'item.icon' },
  /*
    The snapshot goes back out exactly as it came in, so dragging a post from the Pocket into a
    composition gets the same tile as dragging it from the feed. `content` is deliberately absent:
    the document was read for its picture at gather time and never stored — see the store.
  */
  preview: {
    thumbnail: { $: 'item.thumbnail' },
    author: { $: 'item.sourceAuthor' },
    date: { $: 'item.gatheredAt' },
  },
};

/** Take this out of the Pocket. The thing itself is untouched — a Pocket holds references. */
const forgetButton = (extra: Record<string, unknown> = {}): SchemaNode => ({
  type: 'we-button',
  props: {
    variant: 'ghost',
    size: 'sm',
    square: true,
    title: 'Take out of your Pocket',
    onClick: { $action: 'modules.pocket.forget', args: [{ $: 'item.id' }] },
    ...extra,
  },
  children: [{ type: 'we-icon', props: { name: 'x' } }],
});

/*
  Going to a gathered thing opens the record's own page, joining the space first where it has not
  been joined — a sequence, which is why it is a store action rather than an href.

  Absent for a person, who has no page: gated on the stored `datasetKey` rather than by asking the
  store, because a store's actions are unreachable from an expression and the row already carries
  the answer. A control that cannot work is worse than no control.
*/
const openable = { $: "item.datasetKey != 'agent'" };
const openAction = { $action: 'modules.pocket.goTo', args: [{ $: 'item.ref' }] };

// ─── List mode ───────────────────────────────────────────────────────────────

const itemRow: SchemaNode = {
  type: 'we-draggable',
  props: dragProps,
  children: [
    {
      type: 'Row',
      props: { bg: 'surface-sunken', r: '300', p: '300', gap: '300', ay: 'center', width: '100%' },
      children: [
        {
          // The picture where the snapshot has one, the icon where it does not. The same choice the
          // grid tile makes, one size down.
          type: '$if',
          props: {
            condition: { $: 'item.thumbnail' },
            then: {
              type: 'we-image',
              props: { src: { $: 'item.thumbnail' }, fit: 'cover', width: '32px', height: '32px', r: '200' },
            },
            else: { type: 'we-icon', props: { name: itemIcon, color: 'text-muted' } },
          },
        },
        {
          type: 'Column',
          props: { gap: '100', flex: '1', minWidth: '0' },
          children: [
            { type: 'we-text', props: { truncate: true }, children: [itemLabel] },
            {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-faint', truncate: true },
                  children: [itemSource],
                },
                {
                  type: 'we-timestamp',
                  props: { value: { $: 'item.gatheredAt' }, relative: true, fontSize: '100', color: 'text-faint' },
                },
              ],
            },
          ],
        },
        {
          type: '$if',
          props: {
            condition: openable,
            then: {
              type: 'we-button',
              props: { variant: 'ghost', size: 'sm', square: true, title: 'Open', onClick: openAction },
              children: [{ type: 'we-icon', props: { name: 'arrow-square-out' } }],
            },
          },
        },
        forgetButton(),
      ],
    },
  ],
};

/**
 * A folder, and a place to file things into.
 *
 * The row is a drop zone as well as a button, which is what recovers the one thing a breadcrumb
 * gives up against a tree navigator: filing something two levels down without opening anything.
 * Nested inside the panel's own zone, and the innermost zone under the pointer wins — so a drop on
 * a folder goes into the folder and a drop anywhere else goes into the folder being looked at.
 *
 * `noArm`, like every zone inside the panel: see the panel itself for why only one of them speaks
 * when a drag begins.
 */
const folderRow: SchemaNode = {
  type: 'we-drop-zone',
  props: {
    width: '100%',
    noArm: true,
    onDropped: { $action: 'modules.pocket.gatherInto', args: [{ $: 'folder.id' }, { $: 'event.detail' }] },
  },
  children: [
    {
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
    },
  ],
};

// ─── Grid mode ───────────────────────────────────────────────────────────────

/**
 * The same square that follows the pointer during a drag.
 *
 * One fragment for both, so what you saw yourself carrying is what you find afterwards. It draws
 * the stored snapshot rather than the live record, which is the whole reason a snapshot is stored:
 * a grid of things gathered from six spaces would otherwise be six cross-dataset resolutions before
 * anything could be painted.
 *
 * No `content` here, unlike the ghost — the composed document was read for its picture when the
 * thing was gathered and deliberately never written to the agent's own dataset.
 */
const itemTile: SchemaNode = {
  type: 'we-draggable',
  props: dragProps,
  children: [
    {
      type: 'Column',
      props: { position: 'relative' },
      children: [
        {
          type: 'we-button',
          props: { variant: 'bare', title: 'Open', disabled: { $: "item.datasetKey == 'agent'" }, onClick: openAction },
          children: [
            recordCard({
              label: itemLabel,
              icon: itemIcon,
              thumbnail: { $: 'item.thumbnail' },
              // A DID with no name attached: the tile draws an identicon from it, and says where the
              // thing came from in words. Resolving the DID to a name would mean reading the host's
              // profile store, which this package will not do.
              byline: { hash: { $: 'item.sourceAuthor' } },
              source: itemSource,
              date: { $: 'item.gatheredAt' },
            }),
          ],
        },
        // Over the tile rather than beside it: at 100px there is no room in flow, and a grid you
        // cannot remove anything from would send you back to the list to do it.
        forgetButton({ position: 'absolute', top: '0', right: '0', bg: 'surface' }),
      ],
    },
  ],
};

const folderTile: SchemaNode = {
  type: 'we-drop-zone',
  props: {
    noArm: true,
    onDropped: { $action: 'modules.pocket.gatherInto', args: [{ $: 'folder.id' }, { $: 'event.detail' }] },
  },
  children: [
    {
      type: 'we-button',
      props: {
        variant: 'bare',
        onClick: { $action: 'modules.pocket.enter', args: [{ $: 'folder.id' }, { $: 'folder.name' }] },
      },
      children: [
        recordCard({
          label: { $: "folder.name ? folder.name : 'Folder'" },
          icon: { $: "folder.icon ? folder.icon : 'folder'" },
        }),
      ],
    },
  ],
};

// ─── The listing ─────────────────────────────────────────────────────────────

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

const eachFolder = (child: SchemaNode): SchemaNode => ({
  type: '$each',
  props: { items: { $: 'local.folders' }, as: 'folder' },
  children: [child],
});

const eachItem = (child: SchemaNode): SchemaNode => ({
  type: '$each',
  props: { items: { $: 'local.items' }, as: 'item' },
  children: [child],
});

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
    {
      type: '$if',
      props: {
        condition: { $: "local.pocketView == 'grid'" },
        then: {
          type: 'Grid',
          props: { minChildWidth: '100px', gap: '300', width: '100%' },
          children: [eachFolder(folderTile), eachItem(itemTile)],
        },
        else: {
          type: 'Column',
          props: { gap: '200', width: '100%' },
          children: [eachFolder(folderRow), eachItem(itemRow)],
        },
      },
    },
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

// ─── Chrome ──────────────────────────────────────────────────────────────────

/**
 * Where you are, and the way back.
 *
 * A breadcrumb rather than a tree. The panel is a narrow dock, so a tree would spend most of its
 * width on indentation; and a breadcrumb is the model people already have from every file manager,
 * where the contents of one place fill the pane and the path above says how you got there. The one
 * thing the tree does better — filing into a folder you are not in — is given back by making both
 * the crumbs and the folder rows drop zones.
 *
 * Every crumb is a drop target, so dragging something onto "Pocket" while three levels down files
 * it at the top without leaving where you are.
 */
const breadcrumb: SchemaNode = {
  type: 'Row',
  props: { gap: '0', ay: 'center', flex: '1', minWidth: '0', overflowX: 'auto', scrollbarWidth: 'none' },
  children: [
    {
      type: '$each',
      props: { items: { $: 'modules.pocket.crumbs' }, as: 'crumb' },
      children: [
        {
          type: 'Row',
          props: { gap: '0', ay: 'center', flexShrink: '0' },
          children: [
            {
              type: '$if',
              props: {
                condition: { $: 'index > 0' },
                then: { type: 'we-icon', props: { name: 'caret-right', size: 'xs', color: 'text-faint' } },
              },
            },
            {
              type: 'we-drop-zone',
              props: {
                noArm: true,
                onDropped: {
                  $action: 'modules.pocket.gatherInto',
                  args: [{ $: 'crumb.id' }, { $: 'event.detail' }],
                },
              },
              children: [
                {
                  type: 'we-button',
                  props: {
                    variant: 'ghost',
                    size: 'sm',
                    gap: '100',
                    // `goToCrumb` refuses the last position, so pressing where you already are does
                    // nothing rather than reloading the folder you are looking at.
                    onClick: { $action: 'modules.pocket.goToCrumb', args: [{ $: 'index' }] },
                  },
                  children: [
                    {
                      type: '$if',
                      props: {
                        condition: { $: 'crumb.icon' },
                        then: { type: 'we-icon', props: { name: { $: 'crumb.icon' } } },
                      },
                    },
                    {
                      type: 'we-text',
                      props: { variant: 'footnote', truncate: true, maxWidth: '90px' },
                      children: [{ $: "crumb.name ? crumb.name : 'Folder'" }],
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
};

const header: SchemaNode = {
  type: 'Row',
  props: { ay: 'center', gap: '100', width: '100%' },
  children: [
    {
      type: '$if',
      props: {
        // The control that did not exist: `canGoUp` is a store read, so it is true the moment there
        // is a path to go back along rather than depending on a value the template computed.
        condition: { $: 'modules.pocket.canGoUp' },
        then: {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'sm',
            square: true,
            title: 'Back',
            onClick: { $action: 'modules.pocket.up' },
          },
          children: [{ type: 'we-icon', props: { name: 'arrow-left' } }],
        },
      },
    },
    breadcrumb,
    {
      type: 'we-button',
      props: {
        variant: 'ghost',
        size: 'sm',
        square: true,
        title: { $: "local.pocketView == 'grid' ? 'Show as a list' : 'Show as a grid'" },
        onClick: {
          $setLocal: 'pocketView',
          value: { $: "local.pocketView == 'grid' ? 'list' : 'grid'" },
        },
      },
      children: [{ type: 'we-icon', props: { name: { $: "local.pocketView == 'grid' ? 'list' : 'squares-four'" } } }],
    },
    {
      type: 'we-button',
      props: {
        variant: 'ghost',
        size: 'sm',
        square: true,
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
 *
 * ## One zone speaks when a drag begins, and it is this one
 *
 * Every zone inside — each crumb, each folder — carries `noArm`, so picking something up outlines
 * the panel and nothing else. The first version armed all of them, and a Pocket three folders deep
 * lit up nine nested rectangles the moment a card was touched: it read as an error state, and the
 * one thing it needed to say — *this panel is where things go* — was the hardest to pick out.
 *
 * The rows are not undiscoverable for it. Arming answers "where could this go", which for a
 * container is worth saying and for a row inside a container the reader is already looking at is
 * noise; hovering one still lights it, which is the answer to the question actually being asked by
 * then — "is it going *there*". Same division the dock makes: the eight snap targets appear over
 * empty screen where nothing else would suggest them, and the one under the pointer fills in.
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
          $localState: {
            newFolderOpen: { type: 'boolean', initial: false },
            newFolderName: { type: 'string', initial: '' },
            /*
              A preference, not view state: which way somebody likes to look at their own Pocket is
              not something a shared link should impose, and there is no link to a panel anyway.
              Namespaced, since the key is deployment-global.
            */
            pocketView: { type: 'string', initial: 'list', persist: 'pocket.displayMode' },
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

                  A drill-down whose `anchorId` is undefined is not an empty query, it is a malformed
                  one. The store creates the root folder when the panel opens, so this is one round
                  trip rather than "until the first gather" — but it is still a frame, and the notes
                  panel gates its own scoped query the same way for the same reason.
                */
                {
                  type: '$if',
                  props: { condition: currentFolder, then: folderContents },
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
