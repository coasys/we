/**
 * What the browser harness can mount.
 *
 * A scenario is the real schema — the same fragment or template the app renders, imported rather
 * than restated — plus the rows a seeded backend should answer with. Nothing here describes layout;
 * the assertions live beside the cases, so one scenario can be measured several ways.
 */
import type { SchemaNode } from '@we/schema-shared';
import { discussionSection, foldingSectionLabel, signalDisplay } from '@we/template-kit';

export interface Scenario {
  /** The schema to mount, exactly as the app would render it. */
  node: SchemaNode;
  /** Rows the in-memory backend answers with, by entity. */
  tables: Record<string, Record<string, unknown>[]>;
  /** How those rows relate, so a scoped query resolves the way it does against a real backend. */
  relations?: Record<string, Record<string, { type: 'hasOne' | 'hasMany'; target: string; foreignKey: string }>>;
  /** Host store members the schema reads. Merged over the harness's own defaults. */
  stores?: Record<string, unknown>;
}

/**
 * A comment thread in an inspector panel — the case this harness was built for.
 *
 * A long name and a comment with replies, which is the combination that crowds the byline: face,
 * name, time, a fold stub and a pair of controls, all on one line inside a panel.
 */
const discussionThread = (): Scenario => ({
  node: {
    type: '$each',
    props: { items: [{ id: 'card-1', comments: ['r1'] }], as: 'row' },
    $queries: { signalTypes: { entity: 'SignalType', subscribe: true } },
    children: [discussionSection({ record: 'row' })],
  },
  /*
    `comments` is seeded on each row as well as being derivable from `parentId`, and that is a
    fidelity fix rather than belt and braces.

    On AD4M a relation's own ids arrive whether or not the query included it — a relation IS a link,
    so reading `count(row.comments)` costs nothing and every thread does it. The in-memory engine
    resolves a declared relation on demand and leaves no ids on the row, so `count` read zero, the
    nested level never rendered, and the harness quietly showed a one-reply thread while asserting
    about it. Seeded here so a scenario matches what the app is handed.
  */
  tables: {
    SignalType: [],
    CollectionBlock: [
      { id: 'card-1', parentId: null, author: 'did:me', createdAt: '2026-09-01T09:00:00Z', comments: ['r1'] },
      /*
        The reply is the VIEWER'S OWN, which is what puts the edit and delete controls on the line —
        they are gated on `author == me.did`, and faded rather than unmounted, so they take their
        room whether or not the pointer is anywhere near. A thread of other people's replies is the
        uncrowded case and says nothing about the crowded one.
      */
      {
        id: 'r1',
        parentId: 'card-1',
        author: 'did:me',
        createdAt: '2026-09-01T10:00:00Z',
        editorState: [{ _type: 'block', style: 'normal', text: 'A reply with something under it' }],
        textContent: 'A reply with something under it',
        comments: ['r2'],
      },
      /*
        Childless, and the reason this scenario has a third row: folding is offered on every comment
        now, and the one worth checking is the one that has nothing to fold BUT itself.

        `textContent` is what the folded stub shows — the composition flattened to a line, which the
        record already carries for search and for a drag chip.
      */
      {
        id: 'r2',
        parentId: 'r1',
        author: 'did:them',
        createdAt: '2026-09-01T11:00:00Z',
        /*
          A real composition, not `null`.

          The gutter line is `flex: 1` down the side of the comment's words, so a row with no words
          gives it nothing to stretch over and it measures 0 — which looks exactly like a line that
          is not being drawn. A scenario meant to judge whether the line is there has to give it
          something to run beside.
        */
        editorState: [{ _type: 'block', style: 'normal', text: 'A reply with nothing under it at all' }],
        textContent: 'A reply with nothing under it at all',
        comments: [],
      },
    ],
  },
  relations: {
    CollectionBlock: {
      comments: { type: 'hasMany', target: 'CollectionBlock', foreignKey: 'parentId' },
      inReplyTo: { type: 'hasOne', target: 'CollectionBlock', foreignKey: 'parentId' },
    },
  },
  stores: {
    profileStore: {
      profiles: [
        { did: 'did:them', name: 'Theodora Fairweather', avatar: '' },
        // Two words, and long enough that the row genuinely runs short inside a panel. A name that
        // fits is a name that proves nothing.
        { did: 'did:me', name: 'Alexandra Whitfield', avatar: '' },
      ],
    },
  },
});

/**
 * One reaction at the size a thread draws it — the glyph and its count, side by side.
 *
 * Both are a size somebody chose and neither can be judged from the source: `we-icon`'s size inside
 * a `we-button` comes from the button's own `--we-context-icon-size`, and the count's comes from a
 * `fontSize` the component passes down. Whether either arrives is a question about the rendered box.
 */
const reactionControl = (): Scenario => ({
  node: {
    type: '$each',
    /*
      A signal on the record, because `compact` draws the types somebody has USED.

      Seeded on the row rather than as a table: on AD4M a relation's own rows arrive with the
      record, and the in-memory engine resolves a declared relation on demand and leaves nothing on
      it — the same fidelity gap the thread scenarios hit. A reaction row with no reactions is also
      not the row worth measuring.
    */
    props: {
      items: [{ id: 'card-1', signals: [{ signalTypeId: 'st-like', value: 1, author: 'did:them' }] }],
      as: 'row',
    },
    $queries: { signalTypes: { entity: 'SignalType', subscribe: true } },
    children: [signalDisplay({ record: 'row', mode: 'compact', inline: true, size: 'xs' })],
  },
  tables: {
    SignalType: [
      { id: 'st-like', name: 'Like', slug: 'like', icon: 'heart', mode: 'toggle', rangeMin: 0, rangeMax: 1 },
    ],
  },
});

/**
 * The inspector's provenance line: a glyph, a sentence, and a time that belongs in the sentence.
 *
 * "Added by you · 3 days ago" broke onto two rows with the panel half empty, which is the shape of
 * a BLOCK-level box sitting in a run of text rather than of a row running out of room — and the
 * difference between those two is invisible in the markup, because both are a `we-timestamp` inside
 * a `we-text`. Mounted at a width where there is plainly enough space, so a break is a verdict.
 */
const provenanceLine = (): Scenario => ({
  node: {
    type: 'Row',
    props: { gap: '100', ay: 'start', width: '100%' },
    children: [
      {
        type: 'Row',
        props: { fontSize: '100', height: '1lh', ay: 'center', flexShrink: '0' },
        children: [{ type: 'we-icon', props: { name: 'pencil-simple-line', size: 'xs', color: 'text-faint' } }],
      },
      {
        type: 'we-text',
        props: { variant: 'footnote', color: 'text-faint', flex: '1', minWidth: '0' },
        children: [
          'Added by you \u00b7 ',
          { type: 'we-timestamp', props: { value: '2026-09-17T09:00:00Z', relative: true, fontSize: '100' } },
        ],
      },
    ],
  },
  tables: {},
});

/**
 * The two count controls on a post card, side by side, at the size the feed draws them.
 *
 * A reaction and a comment count are the same object — a filled mark and how many — and they were
 * written in two languages, so they came out at different sizes, in different colours, answering
 * the pointer differently. Twice. `CountMark` is what both are now drawn with; this is the
 * assertion that says so in pixels rather than by reading two files.
 */
const countControls = (): Scenario => ({
  node: {
    type: '$each',
    props: {
      items: [
        {
          id: 'card-1',
          // Used, so `compact` draws it — see the reaction scenario for why it is seeded here.
          signals: [{ signalTypeId: 'st-like', value: 1, author: 'did:them' }],
          $commentCount: 3,
          $myComments: 0,
        },
      ],
      as: 'row',
    },
    $queries: { signalTypes: { entity: 'SignalType', subscribe: true } },
    children: [
      {
        type: 'Row',
        props: { ay: 'center', gap: '700' },
        children: [
          signalDisplay({ record: 'row', mode: 'compact', inline: true }),
          {
            type: 'CountMark',
            props: {
              icon: 'chat-circle',
              count: { $: 'row.$commentCount' },
              mine: { $: 'row.$myComments > 0' },
              label: 'Show the conversation',
            },
          },
        ],
      },
    ],
  },
  tables: {
    SignalType: [
      { id: 'st-like', name: 'Like', slug: 'like', icon: 'heart', mode: 'toggle', rangeMin: 0, rangeMax: 1 },
    ],
  },
});

/**
 * A tooltip carrying a name and a description, which is what a signal type has to say.
 *
 * The bubble was `white-space: nowrap` with no cap, so a sentence came out as one line as wide as
 * the sentence — in a 320px panel, a tooltip wider than the app. A phrase must still not wrap,
 * though, so the two cases are mounted together: only measuring both says the cap bites where it
 * should and nowhere else.
 */
const richTooltip = (): Scenario => ({
  node: {
    type: 'Column',
    props: { gap: '400', width: '100%' },
    children: [
      {
        type: 'we-tooltip',
        props: { content: 'Delete this reply', placement: 'bottom', open: true },
        children: [{ type: 'we-button', props: { variant: 'ghost', label: 'phrase' }, children: ['Phrase'] }],
      },
      {
        type: 'we-tooltip',
        props: { placement: 'bottom', open: true },
        children: [
          {
            type: 'we-button',
            props: { variant: 'ghost', label: 'sentence' },
            children: ['Sentence'],
          },
          {
            // A native element carries the slot assignment — a layer-4 component receives `slot` as
            // a prop and drops it, and the content then lands beside the trigger as visible chrome.
            type: 'div',
            slot: 'content',
            children: [
              {
                type: 'Column',
                props: { gap: '100', textAlign: 'left' },
                children: [
                  { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Insightful'] },
                  {
                    type: 'we-text',
                    props: { variant: 'footnote' },
                    children: [
                      'For a comment that changed how somebody was thinking about the problem, rather than one that was merely correct.',
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
  tables: {},
});

/**
 * A record with a whole vocabulary on it, drawn at each of the three densities.
 *
 * One of each kind that behaves differently: a toggle, whose control IS a mark and so presses
 * straight through; a rating, whose five stars ARE the reading and cannot be collapsed to one press;
 * and a vote, which has two ends. Plus a type nobody has used, which is the whole of what
 * `showUnused` decides.
 *
 * The three modes are mounted together on purpose. Each is easy to get right alone and the point is
 * that they differ — a `compact` that quietly drew everything, or a `total` that drew a count per
 * type, would pass any assertion written about it in isolation.
 */
const vocabulary = (): Scenario => {
  const signals = [
    { signalTypeId: 'st-like', value: 1, author: 'did:them' },
    { signalTypeId: 'st-like', value: 1, author: 'did:me' },
    { signalTypeId: 'st-stars', value: 5, author: 'did:them' },
    { signalTypeId: 'st-stars', value: 4, author: 'did:me' },
    { signalTypeId: 'st-vote', value: 1, author: 'did:them' },
    { signalTypeId: 'st-vote', value: -1, author: 'did:me' },
    // A two-digit reading on a 0–100 scale, which is what made the number stack its own digits.
    { signalTypeId: 'st-mood', value: 70, author: 'did:them' },
    { signalTypeId: 'st-mood', value: 53, author: 'did:me' },
  ];
  const modes = ['total', 'compact', 'full'] as const;
  return {
    node: {
      type: '$each',
      props: { items: [{ id: 'card-1', signals }], as: 'row' },
      $queries: { signalTypes: { entity: 'SignalType', subscribe: true } },
      /*
        One child, holding the three.

        `$each` renders its FIRST child and drops the rest — the same trap `threadDepth` records,
        where a row built as a list lost every level below the first without a word. Three modes as
        three children showed only `total`, and every assertion about the other two would have been
        about an empty tree.
      */
      children: [
        {
          type: 'Column',
          props: { width: '100%', gap: '400' },
          children: modes.map((mode) => ({
            type: 'Column',
            props: { width: '100%', p: '200' },
            /*
            `sm`, which is what a panel draws them at.

            Not the default `md`: nothing renders these at `md` any more, and a case that measured
            it would be pinning a size no reader sees.
          */
            children: [signalDisplay({ record: 'row', mode, size: 'sm', as: `sig${mode}` })],
          })),
        },
      ],
    },
    tables: {
      SignalType: [
        {
          id: 'st-like',
          name: 'Like',
          slug: 'like',
          description: 'The ordinary yes — you read it and you are glad it is here.',
          icon: 'heart',
          mode: 'toggle',
          rangeMin: 0,
          rangeMax: 1,
        },
        { id: 'st-stars', name: 'Rating', slug: 'rating', icon: 'star', mode: 'rating', rangeMin: 0, rangeMax: 5 },
        {
          id: 'st-vote',
          name: 'Vote',
          slug: 'vote',
          icon: 'arrow-fat-up',
          iconSecondary: 'arrow-fat-down',
          mode: 'vote',
          rangeMin: -1,
          rangeMax: 1,
        },
        {
          id: 'st-mood',
          name: 'Mood',
          slug: 'mood',
          description: 'How the room feels, nought to a hundred.',
          icon: 'sun',
          mode: 'slider',
          rangeMin: 0,
          rangeMax: 100,
        },
        // Offered and unused: `full` shows it, `compact` and `total` do not.
        { id: 'st-spark', name: 'Spark', slug: 'spark', icon: 'lightning', mode: 'toggle', rangeMin: 0, rangeMax: 1 },
      ],
    },
  };
};

/**
 * Two nested boxes, each of which varies by state. The smallest shape the design system's
 * `--we-ds-*` indirection can be wrong about.
 *
 * `hoverProps` moves the outer row's ordinary props out of its inline style into custom properties,
 * and custom properties inherit — so the inner row, which also has a state bag and so reads the
 * same vars, used to pick up `--we-ds-width: 100%` from its ancestor and fill the line. Nothing in
 * either row's own declaration says anything about its width.
 *
 * Deliberately not a fragment: this is a fact about the interop stylesheet, and stating it in
 * fourteen nodes is what keeps the next reader from thinking it is about comment threads.
 */
const nestedInteractive = (): Scenario => ({
  node: {
    type: 'Row',
    props: { width: '100%', ay: 'center', gap: '200', hoverProps: { opacity: 1 } },
    children: [
      { type: 'we-text', children: ['A name beside it'] },
      {
        type: 'Row',
        props: { gap: '100', ay: 'center', flexShrink: '0', focusProps: { opacity: 1 } },
        children: [
          { type: 'we-button', props: { variant: 'ghost', size: 'sm', square: true }, children: ['A'] },
          { type: 'we-button', props: { variant: 'ghost', size: 'sm', square: true }, children: ['B'] },
        ],
      },
    ],
  },
  tables: {},
});

/**
 * Three folding section headings in a column — plain, with a count, and with a control beside it.
 *
 * The heading with a control is a different tree from the other two: a button around the whole row
 * is invalid markup once there is a second button in it, so an `action` splits the heading into a
 * name and a count-with-caret, with the control between them. Two shapes that must read as one
 * kind of row is exactly the thing a schema test cannot check and a rendered page can.
 */
const panelSections = (): Scenario => ({
  node: {
    type: 'Column',
    props: { width: '100%', gap: '400', p: '300' },
    $localState: {
      plainOpen: { type: 'boolean', initial: false },
      countedOpen: { type: 'boolean', initial: false },
      actionedOpen: { type: 'boolean', initial: false },
    },
    children: [
      foldingSectionLabel({ label: 'Connects', open: { field: 'plainOpen' } }),
      foldingSectionLabel({ label: 'Connections', count: '3', open: { field: 'countedOpen' } }),
      foldingSectionLabel({
        label: 'People',
        count: '2',
        open: { field: 'actionedOpen' },
        /*
          The inspector's picker, at the size a heading's aside is.

          `xs` because that is what `sectionLabel` reserves room for. It was `sm` here, and the row
          came out 32px against the other two headings' 24 — which is what this case caught.
        */
        action: {
          type: 'DropdownMenu',
          props: {
            triggerIcon: 'user-plus',
            triggerTitle: 'Who is on this',
            triggerVariant: 'ghost',
            size: 'xs',
            itemSize: 'sm',
            items: [],
          },
        },
      }),
    ],
  },
  tables: {},
});

export const scenarios: Record<string, () => Scenario> = {
  'discussion:thread': discussionThread,
  'signals:reaction': reactionControl,
  'cards:counts': countControls,
  'tooltip:rich': richTooltip,
  'signals:vocabulary': vocabulary,
  'inspector:provenance': provenanceLine,
  'ds:nested-interactive': nestedInteractive,
  'panel:sections': panelSections,
};
