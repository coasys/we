import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildValidationContext, type SchemaNode, validateSemantic } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import {
  adminSection,
  agentByline,
  attributeRow,
  cardList,
  cardShell,
  composerModal,
  confirmModal,
  emptyNote,
  emptyState,
  field,
  formModal,
  gatePrompt,
  marketplaceList,
  pageShell,
  peopleRow,
  peopleTooltip,
  railGroup,
  railItem,
  railShell,
  recordCard,
  sectionCard,
  statChip,
} from './index.ts';

/**
 * The kit's contract is its *output*: every fragment expands to plain nodes a template could have
 * carried by hand. So the tests assert about expansions, not implementations — a fragment is free
 * to restructure internally as long as what it emits stays valid, tier-honest, and keeps the few
 * behaviours call sites depend on.
 */

// The same generated context the validator CLI reads. This package deliberately does not depend on
// `@we/ai-context` (a build tool — the dependency would point the wrong way).
const contextData = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../ai-context/context.json'), 'utf-8'));
const context = buildValidationContext(contextData);

/** Representative expansions. Fragments with structural branches contribute one entry per branch. */
const portable: Record<string, SchemaNode> = {
  emptyState: emptyState({ icon: 'newspaper', label: 'posts', searchable: true }),
  'emptyState (no delay)': emptyState({ icon: 'user', label: 'members', delay: 0 }),
  emptyNote: emptyNote('No spaces yet'),
  gatePrompt: gatePrompt({ icon: 'lock', iconGradient: 'primary', title: 'Join', body: 'Body.' }),
  'gatePrompt (form)': gatePrompt({
    icon: 'rocket',
    title: 'Set up',
    scroll: true,
    localState: { name: { type: 'string', initial: '' } },
    children: [field({ name: 'name', label: 'Name' })],
  }),
  pageShell: pageShell({ children: [{ type: 'we-text', children: ['x'] }], minHeight: '100dvh' }),
  sectionCard: sectionCard({ title: 'About', description: 'D.', children: [] }),
  'sectionCard (aside)': sectionCard({ title: 'Signals', aside: { type: 'we-spinner' }, children: [] }),
  attributeRow: attributeRow({ icon: 'globe', label: 'Discovery', value: 'Listed' }),
  'attributeRow (control)': attributeRow({
    icon: 'map-pin',
    label: 'Location',
    value: 'Berlin',
    control: { type: 'we-switch' },
  }),
  statChip: statChip({ icon: 'chat-dots', count: { $: 'channel.$count' }, label: 'Conversations' }),
  recordCard: recordCard({ label: { $: 'item.label' }, icon: 'bookmark-simple' }),
  'recordCard (thumbnail)': recordCard({
    label: { $: 'item.label' },
    icon: 'image',
    thumbnail: { $: 'item.thumbnail' },
    byline: { hash: { $: 'item.sourceAuthor' } },
    source: { $: 'item.sourceName' },
    date: { $: 'item.gatheredAt' },
  }),
  'recordCard (content)': recordCard({
    label: { $: 'post.textContent' },
    icon: 'newspaper',
    content: { type: 'BlockRenderer', props: { editorState: { $: 'post.editorState' } } },
    ghost: true,
  }),
  'statChip (value)': statChip({ icon: 'lock-simple', label: 'Access', value: 'Shared' }),
  cardShell: cardShell({ header: [{ type: 'we-text', children: ['h'] }], body: [] }),
  'cardList (query)': cardList({
    query: { entity: 'SignalType', subscribe: true },
    as: 'sig',
    empty: emptyNote('none'),
    children: [{ type: 'we-text', children: [{ $: 'sig.name' }] }],
  }),
  'cardList (items)': cardList({
    items: { $: 'local.rows' },
    as: 'row',
    empty: emptyNote('none'),
    children: [{ type: 'we-text', children: [{ $: 'row.name' }] }],
  }),
  confirmModal: confirmModal({
    open: { $: 'local.confirmOpen' },
    close: { $setLocal: 'confirmOpen', value: false },
    title: 'Delete?',
    body: 'Gone forever.',
    confirmLabel: 'Delete',
    confirm: { $action: 'spaceStore.deleteCollection', args: [{ $: 'post.id' }] },
    busyLocal: 'deleting',
  }),
  composerModal: composerModal({
    openLocal: 'composeOpen',
    title: 'New post',
    saveAction: { $action: 'spaceStore.createPost', args: [{ $: 'arg' }] },
  }),
  'composerModal (unguarded)': composerModal({
    openLocal: 'composeOpen',
    title: 'New post',
    guardDraft: false,
    saveAction: { $action: 'spaceStore.createPost', args: [{ $: 'arg' }] },
  }),
  'formModal (guarded)': formModal({
    open: { $: 'local.formOpen' },
    close: { $setLocal: 'formOpen', value: false },
    title: 'New thing',
    localState: { thingName: { type: 'string', initial: '' } },
    children: [field({ name: 'thingName', label: 'Name' })],
    discardWhen: { $: 'local.thingName' },
    submit: { $action: 'record.create', args: ['CollectionBlock', { title: { $: 'local.thingName' } }] },
  }),
  formModal: formModal({
    open: { $: 'local.formOpen' },
    close: { $setLocal: 'formOpen', value: false },
    title: 'New thing',
    localState: {
      thingName: { type: 'string', initial: '' },
      creating: { type: 'boolean', initial: false },
    },
    children: [field({ name: 'thingName', label: 'Name' })],
    disabled: { $: '!local.thingName' },
    busyLocal: 'creating',
    submit: { $action: 'record.create', args: ['CollectionBlock', { title: { $: 'local.thingName' } }] },
  }),
  field: field({ name: 'name', label: 'Name', validated: true, touchOnBlur: true }),
  'field (select)': field({ name: 'mode', control: 'select', props: { options: [] } }),
  'field (textarea)': field({ name: 'bio', control: 'textarea' }),
  railShell: railShell({
    header: { type: 'we-image', props: { src: '/logo.svg' } },
    footer: railItem({ icon: 'sign-out', label: 'Logout' }),
    persistKey: 'test.rail',
    children: [
      railItem({ icon: 'user', label: 'Profile', active: true, tooltip: 'Profile' }),
      railGroup({
        id: 'spaces',
        label: 'Spaces',
        badge: '3',
        reorderable: true,
        onReorder: { $action: 'datasetStore.reorderDatasets', args: [{ $: 'arg.detail' }] },
        action: { icon: 'plus', label: 'Create a space', onClick: { $action: 'shellStore.setCreateSpaceOpen' } },
        children: [
          railItem({
            id: { $: 'space.uuid' },
            avatar: { src: { $: 'space.avatar' }, name: { $: 'space.name' } },
            label: { $: 'space.name' },
          }),
        ],
      }),
    ],
  }),
  /*
    Portable, and filed here to prove it — the walk below fails on any `$store` a fragment introduces
    itself. It sat in the WE tier because its first callers passed a WE store as `items`, which is
    the caller's dependency rather than the fragment's: every person, picture and name arrives as an
    option. That misfiling is why the call module had to hand-copy it, and why it now lives in
    `@we/schema-kit` where a module can reach it.
  */
  peopleTooltip: peopleTooltip({
    items: { $: 'call.participants' },
    image: { $: 'person.avatar' },
    hash: { $: 'person.did' },
    name: { $: 'person.name' },
    children: [{ type: 'we-text', children: ['7'] }],
  }),
};

const weDomain: Record<string, SchemaNode> = {
  agentByline: agentByline({ did: { $: 'post.author' }, timestamp: { $: 'post.createdAt' } }),
  'agentByline (stacked)': agentByline({ did: { $: 'u.author' }, as: 'speaker', stacked: true }),
  peopleRow: peopleRow({ items: { $: 'spaceStore.members' }, noun: 'Member' }),
  'peopleRow (dids)': peopleRow({ items: { $: 'call.participants' }, dids: true }),
  adminSection: adminSection({ title: 'Models', icon: 'sparkle', refresh: 'runtimeStore.loadAiModels', children: [] }),
  marketplaceList: marketplaceList({
    entity: 'Template',
    as: 'template',
    label: 'templates',
    emptyIcon: 'layout',
    sortable: true,
    card: { mode: 'marketplace' },
  }),
  'marketplaceList (list)': marketplaceList({
    entity: 'Theme',
    as: 'theme',
    label: 'themes',
    emptyIcon: 'paint-bucket',
    layout: 'list',
    card: { mode: 'compact' },
  }),
};

/** Depth-first over nodes, props and operator tokens alike. */
function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) return value.forEach((v) => walk(v, visit));
  if (value === null || typeof value !== 'object') return;
  visit(value as Record<string, unknown>);
  Object.values(value).forEach((v) => walk(v, visit));
}

/**
 * The ambient scope these fragments document as their contract: `displayMode` belongs to the page
 * (`lists/cards.ts`), and an overlay's open flag belongs to whatever holds the button that sets it,
 * which is by definition not the overlay. Declaring their own `$localState` is what switches the
 * validator's scope checking on for these fragments, so validating them bare would flag the very
 * reads the contract permits — this shim is that contract made explicit, the same declaration the
 * palette's insert-with-fix will one day add for real.
 */
const withAmbientScope = (node: SchemaNode): SchemaNode => ({
  type: 'Column',
  $localState: {
    displayMode: { type: 'string', initial: 'expanded' },
    formOpen: { type: 'boolean', initial: false },
    composeOpen: { type: 'boolean', initial: false },
  },
  children: [node],
});

describe('every expansion is a valid schema fragment', () => {
  const needsAmbient = new Set([
    'cardShell',
    'cardList (query)',
    'formModal',
    'formModal (guarded)',
    'composerModal',
    'composerModal (unguarded)',
  ]);
  for (const [name, node] of Object.entries({ ...portable, ...weDomain })) {
    it(name, () => {
      const result = validateSemantic(needsAmbient.has(name) ? withAmbientScope(node) : node, context);
      expect(result.errors.filter((e) => e.severity === 'error')).toEqual([]);
    });
  }
});

/**
 * The tier is a package boundary now, so it is checked against the package rather than the fixtures.
 *
 * The walk below tests *expansions*, which only covers fragments a fixture exists for — and when the
 * portable tier moved to `@we/schema-kit`, four collection fragments went with it that filter on
 * `spaceStore.mutedDids`, because none of them had one. They were store-namers sitting in the package
 * whose whole claim is that it names none, and nothing failed.
 *
 * Reading the source catches what no fixture set can promise to. Comments are stripped first: half
 * these files discuss `$store` in prose, and a test that cannot tell an explanation from a dependency
 * would be answered by rewording rather than by moving the fragment.
 */
describe('@we/schema-kit names no store, as a package', () => {
  const SRC = resolve(import.meta.dirname, '../../../schema-system/kit/src');

  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = resolve(dir, entry.name);
      return entry.isDirectory() ? sources(path) : entry.name.endsWith('.ts') ? [path] : [];
    });

  const withoutComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  /*
    What a store reference actually looks like now.

    The checks below it are `/\$store\s*:/` — a token #169 deleted — and `'$agent'`, so between them
    they matched nothing a fragment would write today and this walk passed for everything. Live
    evidence: `lists/kanbanBoard.ts` hard-coded `$action: 'spaceStore.moveChild'` inside the package
    whose one promise is that it names no store, in the file the README points at as the example,
    and the guard was green.

    Two spellings reach a store now: an expression whose reference starts at one
    (`{ $: 'spaceStore.x' }`) and an action naming one (`$action: 'spaceStore.y'`). Matched against
    the `…Store.` *shape* rather than a list of names, so a store added later is covered without
    this file being told about it.

    `modules.<id>.…` is deliberately not matched: a module namespace is optional by construction and
    resolves to nothing when the module is absent, which is degradation this tier is allowed.
  */
  const STORE_REFERENCE = /\$(?::|action:)?\s*['"`][a-z][A-Za-z]*Store\./;

  for (const file of sources(SRC)) {
    it(file.slice(SRC.length + 1), () => {
      const code = withoutComments(readFileSync(file, 'utf-8'));
      expect(code).not.toMatch(/\$store\s*:/);
      expect(code).not.toMatch(/'\$agent'/);
      expect(code, `${file} names a store — the portable tier takes one from its caller`).not.toMatch(STORE_REFERENCE);
    });
  }
});

describe('the portable tier names no store and no agent machinery', () => {
  // The tier split is the kit's real dependency declaration (see README) and nothing in
  // package.json can enforce it. This walk can: the inputs above are store-free except where a
  // *caller* supplies an action, so any `$store` or `$agent` found here was introduced by the
  // fragment itself. `$action` is exempt for exactly that reason — confirmModal passes its
  // caller's action through, which is the caller's dependency, not the kit's.
  for (const [name, node] of Object.entries(portable)) {
    it(name, () => {
      const offences: string[] = [];
      walk(node, (n) => {
        if ('$store' in n) offences.push(`$store: ${String(n.$store)}`);
        if (n.type === '$agent') offences.push('$agent node');
      });
      // confirmModal's `confirm` is caller input — filter the one store path this test passed in.
      expect(offences.filter((o) => !o.includes('spaceStore.deleteCollection'))).toEqual([]);
    });
  }
});

describe('contracts call sites depend on', () => {
  it('peopleRow in dids mode seeds avatar hashes from the did itself, never a literal', () => {
    // THE bug this branch was born from: a literal where the hash belongs gives every generated face
    // the same colour. The projection must read the comprehension's own variable.
    let avatars: string | undefined;
    walk(weDomain['peopleRow (dids)'], (n) => {
      const value = (n.props as { avatars?: { $?: string } } | undefined)?.avatars;
      if (n.type === 'AvatarStack' && value?.$) avatars = value.$;
    });
    expect(avatars).toBeDefined();
    expect(avatars).not.toContain("'$item'");
    expect(avatars).toMatch(/hash: [a-zA-Z]+\b/);
  });

  it('field wires the event each control actually emits', () => {
    const eventOf = (node: SchemaNode, tag: string) => {
      let props: Record<string, unknown> = {};
      walk(node, (n) => {
        if (n.type === tag) props = n.props as Record<string, unknown>;
      });
      return props;
    };
    expect(eventOf(portable.field, 'we-input')).toHaveProperty('onInput');
    expect(eventOf(portable['field (select)'], 'we-select')).toHaveProperty('onChange');
    expect(eventOf(portable['field (textarea)'], 'we-textarea')).toHaveProperty('onInput');
  });

  it('confirmModal clears its flag from every exit: close, cancel, and success', () => {
    let closes = 0;
    walk(portable.confirmModal, (n) => {
      if (n.$setLocal === 'confirmOpen' && n.value === false) closes += 1;
    });
    expect(closes).toBeGreaterThanOrEqual(3);
  });

  it('a guarded form asks on every exit, and only when there is something to lose', () => {
    const node = portable['formModal (guarded)'];
    const modal = (node.props as { then: SchemaNode }).then;

    // The modal's own close and the Cancel button are the same guarded expression — two exits that
    // disagreed about whether the draft mattered is the bug this shape exists to make impossible.
    const guarded = { $if: { condition: { $: 'local.thingName' }, then: expect.anything(), else: expect.anything() } };
    expect((modal.props as Record<string, unknown>).close).toMatchObject(guarded);
    let cancel: unknown;
    walk(modal, (n) => {
      if (Array.isArray(n.children) && n.children[0] === 'Cancel') cancel = (n.props as { onClick: unknown }).onClick;
    });
    expect(cancel).toMatchObject(guarded);

    // The flag lives on the modal, so it is destroyed with the draft it guards rather than
    // surviving to greet the next open.
    expect(modal.$localState).toHaveProperty('confirmDiscardOpen');

    // And Discard runs the *unguarded* close — the one the guard intercepted — rather than looping
    // back through the condition that raised the question.
    let discard: unknown;
    walk(modal, (n) => {
      if (Array.isArray(n.children) && n.children[0] === 'Discard') discard = (n.props as { onClick: unknown }).onClick;
    });
    expect(discard).toEqual([
      { $setLocal: 'formOpen', value: false },
      { $setLocal: 'confirmDiscardOpen', value: false },
    ]);
  });

  /*
    The bug this exists for: `composerModal` took the guard's `close` and its `$localState` and never
    mounted the confirmation. So the backdrop raised a flag nothing read, and "New post" could not be
    closed at all once anything had been typed — the worst shape a modal can have, reached by
    forgetting one line. Asserted over every fixture rather than at the one call site, because the
    three pieces `discardGuard` hands back go in three different places and any of them can be missed.
  */
  it('every fragment that raises the discard flag also mounts something that reads it', () => {
    for (const [name, node] of Object.entries({ ...portable, ...weDomain })) {
      let writes = 0;
      let reads = 0;
      walk(node, (n) => {
        if (n.$setLocal === 'confirmDiscardOpen') writes += 1;
        if (typeof n.$ === 'string' && n.$.includes('local.confirmDiscardOpen')) reads += 1;
      });
      if (writes === 0 && reads === 0) continue;
      expect(writes, `${name} reads the discard flag but never raises it`).toBeGreaterThan(0);
      expect(reads, `${name} raises the discard flag but nothing reads it`).toBeGreaterThan(0);
    }
  });

  it('the composer guards its draft by default, and lets a caller turn it off', () => {
    const flagOf = (node: SchemaNode) => {
      const modal = (node.props as { then: SchemaNode }).then;
      return (modal.$localState as Record<string, unknown> | undefined)?.confirmDiscardOpen;
    };
    expect(flagOf(portable.composerModal)).toBeDefined();
    expect(flagOf(portable['composerModal (unguarded)'])).toBeUndefined();

    // Unguarded, the backdrop closes outright rather than through a condition.
    const bare = (portable['composerModal (unguarded)'].props as { then: SchemaNode }).then;
    expect((bare.props as Record<string, unknown>).close).toEqual({ $setLocal: 'composeOpen', value: false });
  });

  it('an unguarded form closes outright — the guard is opt-in, not the default', () => {
    const modal = (portable.formModal.props as { then: SchemaNode }).then;
    expect((modal.props as Record<string, unknown>).close).toEqual({ $setLocal: 'formOpen', value: false });
    expect(modal.$localState).not.toHaveProperty('confirmDiscardOpen');
  });

  it('cardList in query mode hoists under <as>Rows, and both branches read the same items', () => {
    const node = portable['cardList (query)'];
    expect(node.$queries).toHaveProperty('sigRows');
    const readers: unknown[] = [];
    walk(node, (n) => {
      if (n.type === '$if') readers.push((n.props as { condition: unknown }).condition);
      if (n.type === '$each') readers.push((n.props as { items: unknown }).items);
    });
    expect(readers).toContainEqual({ $: 'count(local.sigRows)' });
    expect(readers).toContainEqual({ $: 'local.sigRows' });
    for (const reader of readers) expect((reader as { $: string }).$).toContain('local.sigRows');
  });

  it('agentByline uses one interpolation for the profile in both arrangements', () => {
    for (const node of [weDomain.agentByline, weDomain['agentByline (stacked)']]) {
      const as = (node.props as { as: string }).as;
      let avatarProps: Record<string, unknown> = {};
      walk(node, (n) => {
        if (n.type === 'we-avatar') avatarProps = n.props as Record<string, unknown>;
      });
      expect(avatarProps.image).toEqual({ $: `${as}.avatar` });
      expect(avatarProps.hash).toEqual({ $: `${as}.did` });
    }
  });

  it('the rail reveals its label sideways and its groups downward', () => {
    // The two axes are not interchangeable: a label opening downward pushes the row below it, and
    // a group opening sideways does nothing visible at all.
    const axes: Array<string | undefined> = [];
    walk(portable.railShell, (n) => {
      if (n.type === 'reveal') axes.push(n.axis as string | undefined);
    });
    // Two per node, enter and exit. Inline: the label on each of the three items. Block: the
    // group's body, and only its body — the heading fades in place on `opacity` instead, because
    // revealing it grew it from nothing on every expand and pushed that group's own items down.
    expect(axes.filter((a) => a === 'inline')).toHaveLength(6);
    expect(axes.filter((a) => a === undefined)).toHaveLength(2);
  });

  it('the rail holds collapsed groups as a set, so groups can come from data', () => {
    // A boolean per group cannot be declared for groups the template has not seen yet — the whole
    // reason $toggleLocalIn exists. If this reverts to $toggleLocal, that capability is gone.
    const shell = portable.railShell;
    expect((shell.$localState as Record<string, { type: string }>).collapsedGroups.type).toBe('array');
    let writes = 0;
    walk(shell, (n) => {
      if (n.$toggleLocalIn === 'collapsedGroups') writes += 1;
    });
    expect(writes).toBe(1);
  });

  it('a reorderable rail item carries its id on a native element, not on the button', () => {
    // we-sortable reads a DOM *attribute*; the renderer assigns a web component's props as
    // properties, so the id on a we-button would silently never exist.
    let carrier: Record<string, unknown> | undefined;
    walk(portable.railShell, (n) => {
      if (n.props && (n.props as Record<string, unknown>)['data-we-id'] !== undefined) carrier = n;
    });
    expect(carrier?.type).toBe('div');
  });

  it('emptyState mounts bare when delay is 0, wrapped in $animate otherwise', () => {
    expect(portable['emptyState (no delay)'].type).toBe('Column');
    expect(portable.emptyState.type).toBe('$animate');
  });
});

describe('handler arrays are never nested', () => {
  /*
    The resolver runs a handler array step by step and does not flatten: an array inside an array
    is a step that does nothing. `composerModal` with `onClose` hands `discardGuard` a multi-step
    close, and `discardGuard` hands that to `confirmModal` as its confirm — which once wrapped it
    in another array, so discarding an edited post silently did nothing while a fresh post (a
    single-token close) discarded fine.
  */
  function nestedHandlerArrays(value: unknown, path: string[] = []): string[] {
    if (Array.isArray(value)) {
      const nested = value.some((item) => Array.isArray(item));
      return [
        ...(nested ? [path.join('.')] : []),
        ...value.flatMap((item, i) => nestedHandlerArrays(item, [...path, String(i)])),
      ];
    }
    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => nestedHandlerArrays(v, [...path, k]));
    }
    return [];
  }

  it('a composer whose close has several steps discards through all of them', () => {
    const node = composerModal({
      openLocal: 'editOpen',
      title: 'Edit',
      saveAction: { $action: 'spaceStore.updatePost', args: ['x', { $: 'arg' }] },
      onClose: [{ $action: 'presenceStore.clearActivity', args: ['edit', 'x'] }],
    });
    expect(nestedHandlerArrays(node)).toEqual([]);
  });

  it('a confirm given as a handler array is spliced into the button, not wrapped', () => {
    const node = confirmModal({
      open: { $: 'local.flag' },
      close: { $setLocal: 'flag', value: false },
      title: 't',
      body: 'b',
      confirmLabel: 'Go',
      confirm: [{ $setLocal: 'a', value: 1 }, { $action: 'x.y' }],
    });
    expect(nestedHandlerArrays(node)).toEqual([]);
  });
});

/**
 * The record tile — the square that follows the pointer during a drag, and the one a grid of
 * gathered things is made of.
 *
 * One fragment for both, so what you saw yourself carrying is what you find afterwards. What is
 * worth pinning is the order it draws in: each source hands it a different one of the three, and
 * getting the precedence wrong shows an icon over a picture that was right there.
 */
describe('recordCard draws what the source had', () => {
  const types = (node: SchemaNode): string[] => {
    const found: string[] = [];
    walk(node, (n) => {
      if (typeof n.type === 'string') found.push(n.type);
    });
    return found;
  };

  it('shows the picture where there is one, and the fallback where there is not', () => {
    // `thumbnail` is an expression, so which applies is only knowable at render time — hence a
    // branch in the output rather than a decision taken here.
    const node = recordCard({ icon: 'image', thumbnail: { $: 'item.thumbnail' } });

    expect(types(node)).toContain('$if');
    expect(types(node)).toContain('we-image');
    expect(types(node)).toContain('we-icon');
  });

  it('draws the composition itself when given one, in place of the icon', () => {
    const node = recordCard({
      icon: 'newspaper',
      content: { type: 'BlockRenderer', props: { editorState: { $: 'post.editorState' } } },
    });

    expect(types(node)).toContain('BlockRenderer');
    // No branch: a node either exists or it does not, so this choice is made at authoring time.
    expect(types(node)).not.toContain('$if');
  });

  it('scales the composition down rather than laying it out small', () => {
    // Rendered into a 100px box, every paragraph re-flows into a column one word wide. Scaling keeps
    // the shape of the document, which is the only thing legible at this size.
    const node = recordCard({
      size: '100px',
      contentWidth: '320px',
      content: { type: 'BlockRenderer', props: { editorState: 'x' } },
    });

    const scaled: Record<string, unknown>[] = [];
    walk(node, (n) => {
      const props = n.props as Record<string, unknown> | undefined;
      if (props && typeof props.transform === 'string') scaled.push(props);
    });

    expect(scaled).toHaveLength(1);
    expect(scaled[0].transform).toBe('scale(0.3125)');
    expect(scaled[0].width).toBe('320px');
  });

  it('leaves the scale to CSS when the sizes are not plain pixels', () => {
    const node = recordCard({ size: 'var(--tile)', content: { type: 'we-text', children: ['x'] } });

    const found: string[] = [];
    walk(node, (n) => {
      const props = n.props as Record<string, unknown> | undefined;
      if (props && typeof props.transform === 'string') found.push(props.transform);
    });

    expect(found).toEqual(['scale(calc(var(--tile) / 320px))']);
  });

  it('draws an identicon from a DID alone, rather than a blank disc', () => {
    // A Pocket row keeps the author's DID and cannot resolve it — the panel names no store. Two
    // unresolved people must not look like the same person.
    const node = recordCard({ label: 'A post', byline: { hash: { $: 'item.sourceAuthor' } } });

    expect(types(node)).toContain('we-avatar');
  });

  it('draws no caption at all when there is nothing to say', () => {
    const node = recordCard({ icon: 'folder' });

    expect(types(node)).not.toContain('we-text');
    expect(types(node)).not.toContain('we-timestamp');
  });

  it('cannot take the pointer when it is a ghost', () => {
    // It sits under the pointer for the whole gesture; a tile that accepted clicks would swallow
    // the drop.
    const ghost = recordCard({ label: 'A post', ghost: true }) as { props: Record<string, unknown> };
    const tile = recordCard({ label: 'A post' }) as { props: Record<string, unknown> };

    expect(ghost.props.pointerEvents).toBe('none');
    expect(tile.props.pointerEvents).toBeUndefined();
  });
});
