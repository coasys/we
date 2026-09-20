import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildValidationContext, type SchemaNode, validateSemantic } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import {
  activitySummary,
  adminSection,
  agentByline,
  attributeRow,
  cardList,
  cardShell,
  composerModal,
  confirmModal,
  discardGuard,
  discussionSection,
  emptyNote,
  emptyState,
  field,
  formModal,
  gatePrompt,
  marketplaceList,
  pageShell,
  peopleFilter,
  peopleRow,
  peopleTooltip,
  railGroup,
  railItem,
  railShell,
  recordCard,
  recordFormModal,
  sectionCard,
  signalsSection,
  statChip,
  taskBoard,
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
  'agentByline (compact)': agentByline({
    did: { $: 'reply.author' },
    as: 'writer',
    timestamp: { $: 'reply.createdAt' },
    compact: true,
  }),
  peopleRow: peopleRow({ items: { $: 'spaceStore.members' }, noun: 'Member' }),
  peopleFilter: peopleFilter({
    people: 'who',
    show: 'whoMode',
    faces: { $: 'spaceStore.memberDids' },
    matched: { $: 'count(local.who)' },
    total: { $: 'count(spaceStore.members)' },
    noun: 'event',
  }),
  'taskBoard (people)': taskBoard({
    boardId: { $: 'spaceStore.currentSpace.id' },
    empty: { type: 'Column' },
    people: true,
  }),
  'taskBoard (social)': taskBoard({
    boardId: { $: 'spaceStore.currentSpace.id' },
    empty: { type: 'Column' },
    social: true,
  }),
  'peopleRow (dids)': peopleRow({ items: { $: 'call.participants' }, dids: true }),
  signalsSection: signalsSection({ record: 'row' }),
  discussionSection: discussionSection({ record: 'row' }),
  'discussionSection (flat)': discussionSection({ record: 'row', fractal: "routeStore.params.threads != 'flat'" }),
  activitySummary: activitySummary({ record: 'card' }),
  'activitySummary (no replies)': activitySummary({ record: 'card', replies: false }),
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
  // The signal fragments' half of that contract: one hoisted subscription, declared by whatever
  // renders the list rather than by the fragment, so a panel of thirty cards opens one and not thirty.
  $queries: { signalTypes: { entity: 'SignalType', subscribe: true } },
  $localState: {
    displayMode: { type: 'string', initial: 'expanded' },
    formOpen: { type: 'boolean', initial: false },
    composeOpen: { type: 'boolean', initial: false },
    who: { type: 'array', initial: [] },
    whoMode: { type: 'string', initial: 'dim' },
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
    'peopleFilter',
    'signalsSection',
    'discussionSection',
    'discussionSection (flat)',
    'activitySummary',
    'activitySummary (no replies)',
  ]);
  for (const [name, node] of Object.entries({ ...portable, ...weDomain })) {
    it(name, () => {
      const result = validateSemantic(needsAmbient.has(name) ? withAmbientScope(node) : node, context);
      expect(result.errors.filter((e) => e.severity === 'error')).toEqual([]);
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

  it('signalsSection offers every type, so the first reaction in a space can be given', () => {
    // The bug this fragment exists for: a feed row draws a control only where somebody has already
    // reacted, so a type a community just defined is unreachable from every surface at once. A
    // detail panel has the room, and must not inherit that rule — no count guard between the
    // `$each` over the offered types and the control it draws.
    const conditions: string[] = [];
    walk(weDomain.signalsSection, (n) => {
      const condition = (n.props as { condition?: { $?: string } } | undefined)?.condition?.$;
      if (condition) conditions.push(condition);
    });
    expect(conditions).toContain('count(filter(local.signalTypes, { retired: { not: true } }))');
    expect(conditions.filter((c) => c.includes('row.signals'))).toEqual([]);
  });

  it('folds a branch by id, declared once, and closes it without tearing it down', () => {
    /*
      Three decisions in one shape.

      The fold is a set of ids rather than a flag per row, because rows come from a subscription: a
      boolean on the row is lost the moment anybody replies anywhere and `<For>` remounts them, so a
      branch somebody folded would spring open because a stranger wrote something else.

      Declared once, at the top: a nested level that declared its own would shadow it, and a caret
      three deep would fold only what it could see.

      And closed with `$animate` rather than `$if` — unmounting disposes the nested thread's
      subscription and re-asks the backend on every expand.
    */
    const section = weDomain.discussionSection;
    let declarations = 0;
    let toggles = 0;
    let folds = 0;
    walk(section, (n) => {
      const state = (n as { $localState?: Record<string, unknown> }).$localState;
      if (state && 'collapsedReplies' in state) declarations += 1;
      if ((n as { $toggleLocalIn?: string }).$toggleLocalIn === 'collapsedReplies') toggles += 1;
      const condition = (n.props as { condition?: { $?: string } } | undefined)?.condition?.$;
      if (n.type === '$animate' && condition?.includes('collapsedReplies')) folds += 1;
    });
    expect(declarations).toBe(1);
    /*
      Three per level: the byline's own press, the line beside the words, and the rail beside the
      replies. It was four while a caret sat above the line, and that caret is gone — it said "this
      folds" at rest and said it twice, since a folded comment's stub carries one already.

      The byline is one of them because a folded comment is opened by pressing the stub itself — the
      biggest target the row has, and the only one a touchscreen can offer, there being no hover to
      reveal anything on. Open, that same press shows the reply's controls instead, so the handler
      chooses by the fold state and only one meaning is ever live.

      The line is two controls rather than one because it is drawn by two fragments: the segment
      beside the words belongs to the reply, the segment beside the replies belongs to the thread.
      They read as one line and behave as one — a press anywhere along it folds the branch, and both
      halves thicken on the same hover.
    */
    expect(toggles).toBe(9);
    // Each level folds twice: the reply's own words, and the branch under it.
    expect(folds).toBeGreaterThanOrEqual(6);
  });

  it('a reply keeps its controls out of the way until the pointer is on the row', () => {
    /*
      The transcript's pencil pattern: the ROW holds whether the pointer is on it, because
      `hoverProps` answers for the element it is on and an affordance that appears only once you are
      already over it cannot be found. Faded rather than unmounted, so the row does not change width
      as the pointer crosses it — and `focusProps`, without which tabbing lands on something
      invisible.
    */
    let controls: Record<string, unknown> | undefined;
    walk(weDomain.discussionSection, (n) => {
      const props = (n.props ?? {}) as Record<string, unknown>;
      const opacity = (props.opacity as { $?: string } | undefined)?.$;
      // The controls' own fade, not the byline's: a folded stub fades too, and it is the row the
      // walk meets first. The first level's, since the walk reaches reply2 and reply3 after it.
      // The controls' own fade: roused by the pointer OR by this being one of the open comments. The
      // reads `pointerOnReply` too — a folded stub fades and comes back under the pointer — so the
      // open-comment half is what tells them apart.
      // Named `reply` specifically: the scoped-root row (`focused`) carries the same contract and is
      // reached first, so a looser test would silently stop asserting about the thread's own levels.
      const isControls = opacity?.includes('pointerOnReply') && opacity.includes('reply.id in local.discussionOpen');
      if (n.type === 'Row' && isControls && !controls) controls = props;
    });
    // Roused by either: the pointer anywhere on the comment, or the comment being one of the open
    // ones — so a thread opened by touch, which has no hover, still shows what it can do.
    //
    // A SET of open ids, not one: opening a reply is mostly how you find out what people made of
    // it, and with one slot that is a question you can only ask about one comment at a time.
    expect(controls?.opacity).toEqual({ $: '(local.pointerOnReply || reply.id in local.discussionOpen) ? 1 : 0' });
    expect(controls?.focusProps).toEqual({ opacity: 1 });
    // Left-aligned: the pair sits after the time rather than at the far edge.
    expect(controls?.ml).toBeUndefined();
  });

  it('a thread that is still fetching more replies refuses a second press, and says so', () => {
    /*
      There is no "the query is running" signal to read — `local.<name>Loaded` latches true after
      the first answer — so the note infers it from the two numbers already on screen: the limit it
      asked for against what has arrived. Both the refusal and the wheel hang off the SAME
      expression, which is the part worth pinning: two spellings of "in flight" is how a button ends
      up spinning forever while still taking clicks.
    */
    let button: Record<string, unknown> | undefined;
    walk(weDomain.discussionSection, (n) => {
      const children = (n.children ?? []) as unknown[];
      const showsACount = children.some((c) => typeof c === 'string' && c === 'Show ');
      if (n.type === 'we-button' && showsACount && !button) button = n as Record<string, unknown>;
    });
    expect(button, 'no "Show N more replies" control in the thread').toBeTruthy();

    const props = button!.props as Record<string, unknown>;
    const pending = (props.disabled as { $?: string })?.$;
    expect(pending, 'the control takes presses while it is fetching').toBeTruthy();
    // Asked-for against arrived. The note only renders while the level is full, so this cannot
    // stick: a level showing everything it has hides the whole control.
    expect(pending).toContain('local.topReplies >');

    const spinner = (button!.children as Record<string, unknown>[]).find(
      (c) => (c.props as { then?: { type?: string } } | undefined)?.then?.type === 'we-spinner',
    );
    expect(spinner, 'no spinner on the control').toBeTruthy();
    expect((spinner!.props as { condition?: { $?: string } }).condition?.$).toBe(pending);
    // After the words. The button's own `loading` puts its wheel before the label, which is right
    // for "Save" and wrong for a line of text whose count is the thing that changes.
    expect((spinner!.props as { then?: { slot?: string } }).then?.slot).toBe('end');
  });

  it('offers the fold on every comment, as a line and no caret', () => {
    /*
      Folding used to be gated on having been replied to, so the affordance was missing exactly
      where a comment is worth collapsing — a long one nobody has answered — and present on a
      two-word one that somebody had. The machinery never had that limit: `collapsed` gates a
      comment's own words as well as its subtree.

      The line goes with the caret, and the first attempt at this gated it separately on the
      grounds that a line means "there is a branch below here". It does not: that is `branchRail`
      in `commentThread`, beside the REPLIES. This segment runs past the comment's own paragraphs
      and traces what the caret folds, which on a childless comment is the comment. So neither
      condition may mention `comments` — a caret with no line under it leaves the fold's extent
      unmarked.
    */
    const gutter: string[] = [];
    walk(weDomain.discussionSection, (n) => {
      const props = (n.props ?? {}) as { label?: unknown; onClick?: unknown };
      const label = props.label;
      const says = typeof label === 'string' ? label : ((label as { $?: string })?.$ ?? '');
      if (n.type === 'we-button' && says.includes('Fold this')) gutter.push(says);
    });
    // One control per comment, named for what folding it takes with it: a branch's answers, or a
    // leaf's words. No caret — see the note above.
    expect(gutter.length).toBeGreaterThanOrEqual(1);
    expect(gutter[0]).toContain("count(reply.comments) ? 'Fold this branch' : 'Fold this comment'");
  });

  it('says what a folded comment was, not only how much is under it', () => {
    /*
      The stub used to be the reply count alone, which answered the wrong half — and on a childless
      comment, now that those fold too, it would have said nothing at all. `textContent` is the
      composition flattened to a line, which the record already carries.
    */
    let stub: Record<string, unknown> | undefined;
    walk(weDomain.discussionSection, (n) => {
      const children = (n.children ?? []) as { $?: string }[];
      if (n.type === 'we-text' && children.some((c) => c?.$ === 'reply.textContent') && !stub) {
        stub = (n.props ?? {}) as Record<string, unknown>;
      }
    });
    expect(stub, 'a folded comment says nothing about itself').toBeTruthy();
    // One row: a folded comment that reflows to three lines is not folded.
    expect(stub!.truncate).toBe(true);
    expect(stub!.whiteSpace).toBe('nowrap');
  });

  it('a compact byline drops the face, the name and the time a step — and only those', () => {
    // A reply's byline sits above two lines of text and under another reply; at a post's weight it
    // competes with the words it introduces. The row stays as wide as its words: seventeen other
    // call sites place a byline inside a row of their own, where a full-width one pushes a sibling.
    const props = new Map<string, Record<string, unknown>>();
    walk(weDomain['agentByline (compact)'], (n) => {
      if (typeof n.type === 'string') props.set(n.type, (n.props ?? {}) as Record<string, unknown>);
    });
    expect(props.get('we-avatar')?.size).toBe('xs');
    expect(props.get('we-text')?.fontSize).toBe('200');
    // A name shouting over the sentence under it, once per reply, is what the weight would be here.
    expect(props.get('we-text')?.fontWeight).toBeUndefined();
    /*
      The time drops FURTHER than the name — it is the transcript's stamp, not a smaller byline.

      Both surfaces are a line of conversation with who said it and when, and a time on one is a
      coordinate you skim past to find a moment rather than part of the heading. That the two
      actually agree is asserted where both are in scope, in app-shell's `conversationStamp.test.ts`;
      here it is only that compact means something different for the time than for the name.
    */
    expect(props.get('we-timestamp')?.fontSize).toBe('100');
    expect(props.get('we-timestamp')?.color).toBe('text-faint');
    expect(props.get('we-timestamp')?.relativeStyle).toBe('narrow');
    expect(props.get('Row')?.gap).toBe('200');
    expect(props.get('Row')?.width).toBeUndefined();
    // And an ordinary byline is untouched.
    const plain = new Map<string, Record<string, unknown>>();
    walk(weDomain.agentByline, (n) => {
      if (typeof n.type === 'string') plain.set(n.type, (n.props ?? {}) as Record<string, unknown>);
    });
    expect(plain.get('we-avatar')?.size).toBe('sm');
    expect(plain.get('we-text')?.fontWeight).toBe('semibold');
    expect(plain.get('we-text')?.fontSize).toBeUndefined();
    expect(plain.get('we-timestamp')?.relativeStyle).toBeUndefined();
    // A byline over a post keeps the louder role: it heads a piece of content rather than a line
    // of talk, and its time is read as part of that heading.
    expect(plain.get('we-timestamp')?.color).toBe('text-muted');
    expect(plain.get('we-timestamp')?.fontSize).toBeUndefined();
  });

  it('a reply offers every reaction the community has, and Reply after them', () => {
    // The row reads left to right: the types, then the answer. A read-only count would be the wrong
    // half of the pair — a thread is where the thing being answered is somebody's sentence, and the
    // lightest answer to it should not be a press away in another panel.
    const order: string[] = [];
    walk(weDomain.discussionSection, (n) => {
      if (n.type === 'SignalControl') order.push('signal');
      if (n.type === 'we-button' && JSON.stringify(n.children ?? []).includes('Reply')) order.push('reply');
    });
    expect(order.indexOf('signal')).toBeLessThan(order.indexOf('reply'));
    // And nothing on that row is pinned to the right edge.
    let pinnedReply = false;
    walk(weDomain.discussionSection, (n) => {
      const props = (n.props ?? {}) as { ml?: unknown };
      if (n.type === 'we-button' && props.ml === 'auto') pinnedReply = true;
    });
    expect(pinnedReply).toBe(false);
  });

  it('a reply can be rewritten, and the composer waits for the record before it opens', () => {
    /*
      The failure this guards: `composerModal` mounts on its own local, the local is set on the
      click, and the query that fetches the reply answers a round trip later — so an ungated composer
      opens empty and Save writes that emptiness over somebody's words.
    */
    const section = weDomain.discussionSection as SchemaNode & {
      $queries?: Record<string, { when?: unknown }>;
    };
    expect(section.$queries?.discussionEdit?.when).toEqual({ $: 'local.discussionEditing' });
    let gated = false;
    walk(section, (n) => {
      const condition = (n.props as { condition?: { $?: string } } | undefined)?.condition?.$;
      if (condition === 'count(local.discussionEdit) && local.discussionEditing') gated = true;
    });
    expect(gated).toBe(true);
    let saves: unknown;
    walk(section, (n) => {
      if ((n as { $action?: string }).$action === 'spaceStore.updatePost') saves = (n as { args?: unknown }).args;
    });
    // The id first: `updatePost(postId, json)` takes the tree second.
    expect(saves).toEqual([{ $: 'local.discussionEditing' }, { $: 'arg' }]);
  });

  it('a reply draws its words flush, through the renderer rather than a wrapper', () => {
    // `.we-block-content` pads every paragraph on all four sides — a document's padding, which in a
    // thread insets the text from the byline above it and bands every line.
    let rootClass: unknown;
    walk(weDomain.discussionSection, (n) => {
      if (n.type === 'BlockRenderer') rootClass = (n.props as { rootClass?: unknown }).rootClass;
    });
    expect(rootClass).toBe('we-block-content--compact');
  });

  it('discussionSection can reply at every level it draws, not just the top', () => {
    // The bug the fragment was born from: threads rendered three deep and every surface offered one
    // Reply button, against the record — so nesting was a rendering of data nothing could produce.
    // Each level's button names that level's own reply, which is what makes the tree reachable.
    const targets = new Set<string>();
    walk(weDomain.discussionSection, (n) => {
      const value = (n as { $setLocal?: string; value?: { $?: string } }).value;
      if ((n as { $setLocal?: string }).$setLocal === 'discussionReplyTo' && value?.$) targets.add(value.$);
    });
    expect(targets).toContain('reply.id');
    expect(targets).toContain('reply2.id');
    expect(targets).toContain('reply3.id');
  });

  it('discussionSection turns the depth limit into a door rather than a wall', () => {
    // A schema cannot recurse at render time, so the expansion is finite; re-rooting is what keeps
    // the conversation it draws from being.
    let reroots = false;
    walk(weDomain.discussionSection, (n) => {
      const value = (n as { $setLocal?: string; value?: { $?: string } }).value;
      if ((n as { $setLocal?: string }).$setLocal === 'discussionRoot' && value?.$?.endsWith('.id')) reroots = true;
    });
    expect(reroots).toBe(true);
  });

  it('discussionSection in flat mode withholds the reply button from replies, not from the record', () => {
    // Flat is a policy about what may be *added*. The record keeps its Reply — a discussion with no
    // way in is not a flat discussion, it is a closed one — and stored nesting still renders.
    const conditions: string[] = [];
    walk(weDomain['discussionSection (flat)'], (n) => {
      const condition = (n.props as { condition?: { $?: string } } | undefined)?.condition?.$;
      if (condition) conditions.push(condition);
    });
    expect(conditions).toContain("routeStore.params.threads != 'flat'");
    /*
      The record's own way in is the INLINE composer at the foot, which writes straight to
      `createPost` rather than opening the modal — so this looks for the write, not for
      `discussionReplyTo`. The modal is what a reply to a REPLY still uses, and flat is exactly the
      mode that withholds those.
    */
    let recordReply = false;
    walk(weDomain['discussionSection (flat)'], (n) => {
      const props = (n.props ?? {}) as Record<string, unknown>;
      for (const handler of Object.values(props)) {
        for (const step of Array.isArray(handler) ? handler : [handler]) {
          const call = step as { $action?: string; args?: unknown[] } | undefined;
          if (call?.$action !== 'spaceStore.createPost') continue;
          const parent = (call.args?.[1] as { parentId?: { $?: string } } | undefined)?.parentId?.$;
          if (parent?.includes('row.id')) recordReply = true;
        }
      }
    });
    expect(recordReply).toBe(true);
  });

  it('a board drawing counts declares what they need, so it cannot be placed without them', () => {
    // The failure this guards against is the quiet one: the reads resolve to nothing, every count
    // reads zero, and the only sign is a line in the console. The board hoists the subscription and
    // hydrates the relation itself rather than asking the route to remember.
    const board = weDomain['taskBoard (social)'] as SchemaNode & {
      $queries?: Record<string, { entity?: string; include?: Record<string, unknown> }>;
    };
    expect(board.$queries?.signalTypes?.entity).toBe('SignalType');
    expect(board.$queries?.pool?.include).toEqual({ signals: true });
    // And a board that does not draw them pays for neither.
    const plain = weDomain['taskBoard (people)'] as SchemaNode & {
      $queries?: Record<string, { include?: unknown }>;
    };
    expect(plain.$queries?.signalTypes).toBeUndefined();
    expect(plain.$queries?.pool?.include).toBeUndefined();
  });

  it('activitySummary says nothing about a record nobody has touched', () => {
    // A column of zeroes down a board asserts nothing and costs a line on every card, so every
    // count it draws sits behind a guard on that same count.
    const conditions: string[] = [];
    walk(weDomain.activitySummary, (n) => {
      const condition = (n.props as { condition?: { $?: string } } | undefined)?.condition?.$;
      if (condition) conditions.push(condition);
    });
    expect(conditions).toContain('count(card.comments)');
    expect(conditions.some((c) => c.startsWith('count(filter(card.signals'))).toBe(true);
  });

  it('activitySummary leaves the reply count out where the thread is on screen anyway', () => {
    let mentionsComments = false;
    walk(weDomain['activitySummary (no replies)'], (n) => {
      if (JSON.stringify(n.props ?? {}).includes('comments')) mentionsComments = true;
    });
    expect(mentionsComments).toBe(false);
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

describe('Back through a discard guard', () => {
  const back = [{ $setLocal: 'chooserOpen', value: true }];

  it('asks when there is work, remembering it was Back, and goes back at once when there is none', () => {
    const guard = discardGuard({ dirty: { $: 'local.dirty' }, close: { $setLocal: 'open', value: false }, back });
    expect(guard.back).toEqual({
      $if: {
        condition: { $: 'local.dirty' },
        then: [
          { $setLocal: 'discardGoesBack', value: true },
          { $setLocal: 'confirmDiscardOpen', value: true },
        ],
        else: [{ $setLocal: 'open', value: false }, ...back],
      },
    });
    expect(guard.localState).toHaveProperty('discardGoesBack');
  });

  it('on Discard, finishes going back rather than only closing', () => {
    const guard = discardGuard({ dirty: { $: 'local.dirty' }, close: { $setLocal: 'open', value: false }, back });
    const text = JSON.stringify(guard.node);
    expect(text).toContain(
      JSON.stringify({
        $if: {
          condition: { $: 'local.discardGoesBack' },
          then: [{ $setLocal: 'open', value: false }, ...back],
          else: { $setLocal: 'open', value: false },
        },
      }),
    );
  });

  it('is left out, flag and all, for a guard with nowhere to go back to', () => {
    const guard = discardGuard({ dirty: { $: 'local.dirty' }, close: { $setLocal: 'open', value: false } });
    expect(guard.back).toBeUndefined();
    expect(JSON.stringify(guard)).not.toContain('discardGoesBack');
  });

  it('nests no handler arrays in a composer or a record form that go back', () => {
    const nested = (value: unknown): boolean =>
      Array.isArray(value)
        ? value.some((item) => Array.isArray(item) || nested(item))
        : !!value && typeof value === 'object' && Object.values(value as object).some(nested);
    const composer = composerModal({
      openLocal: 'noteOpen',
      title: 'New note',
      saveAction: { $action: 'x.save', args: [{ $: 'arg' }] },
      onClose: [{ $action: 'x.clear' }],
      back,
    });
    expect(nested(composer)).toBe(false);
    expect(nested(recordFormModal({ back }))).toBe(false);
  });
});
