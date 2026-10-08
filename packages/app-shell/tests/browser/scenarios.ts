/**
 * What the browser harness can mount.
 *
 * A scenario is the real schema — the same fragment or template the app renders, imported rather
 * than restated — plus the rows a seeded backend should answer with. Nothing here describes layout;
 * the assertions live beside the cases, so one scenario can be measured several ways.
 */
import { transcriptLines } from '@we/module-transcribe';
import { cardShell, panelScroll, timeline, timelineMoreAt, timelineOrder } from '@we/schema-kit';
import type { SchemaNode } from '@we/schema-shared';
import { discussionSection, foldingSectionLabel, signalDisplay } from '@we/template-kit';
import { CALL_CHROME_BAND, TREE_LOCALS, TREE_QUERIES, treeStrip } from '@we/template-showcase';

export interface Scenario {
  /** The schema to mount, exactly as the app would render it. */
  node: SchemaNode;
  /** Rows the in-memory backend answers with, by entity. */
  tables: Record<string, Record<string, unknown>[]>;
  /** How those rows relate, so a scoped query resolves the way it does against a real backend. */
  relations?: Record<string, Record<string, { type: 'hasOne' | 'hasMany'; target: string; foreignKey: string }>>;
  /** Host store members the schema reads. Merged over the harness's own defaults. */
  stores?: Record<string, unknown>;
  /**
   * `space` renders against the bag a space template is given — the tier's grants, and the gesture
   * gate enforcing — rather than the raw stores. For a scenario about the trust boundary.
   */
  bag?: 'space';
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
 * A corner-pinned control, pinned with a space token rather than a length.
 *
 * `position: absolute` with a `top`/`right`/`bottom`/`left` is how anything gets pinned to the
 * corner of a picture — a badge over a thumbnail, a reconnect button over a video tile. The offset
 * is typed `string` and documented as "space token or CSS length", so `bottom: '200'` is what an
 * author writes, and it has to become `var(--we-space-200)` before it reaches CSS.
 *
 * The Lit primitives and the Solid components resolve that in two different places, and only one of
 * them was doing it: a primitive emitted the unitless `bottom: 200`, which is invalid, so the
 * browser dropped the declaration. That failure is much worse than a no-op, and that is the whole
 * reason for measuring it here. `position: absolute` still applied, and an absolutely positioned box
 * with no valid offsets renders at its *static* position — so inside a centring parent the control
 * landed dead centre and read as somebody's deliberate choice rather than as a bug.
 *
 * Both are pinned to the same `bottom`, one primitive and one component, so the case is a
 * comparison rather than a number: whatever `space-200` is worth, the two paths owe the same answer.
 */
const tokenOffsets = (): Scenario => ({
  node: {
    type: 'Column',
    props: { id: 'pin-box', position: 'relative', width: '400px', height: '300px', ax: 'center', ay: 'center' },
    children: [
      // The Lit path — the one that passed the offset through raw.
      {
        type: 'we-button',
        props: {
          id: 'pin-lit',
          variant: 'secondary',
          size: 'xs',
          square: true,
          position: 'absolute',
          bottom: '200',
          right: '200',
        },
        children: [{ type: 'we-icon', props: { name: 'arrows-clockwise' } }],
      },
      // The Solid path, mirrored into the other corner — the control, which already resolved tokens.
      {
        type: 'Row',
        props: { id: 'pin-solid', position: 'absolute', bottom: '200', left: '200', width: '24px', height: '24px' },
      },
    ],
  },
  tables: {},
});

/**
 * Square icon-only buttons, loading and not, at the two sizes the app actually uses them at.
 *
 * `square` sizes the width from the height, so the button is a box with room for one glyph. A
 * spinner that joins the icon rather than replacing it therefore puts two of them in a box built
 * for one — and since the spinner was a fixed 24px, an `xs` button (24px tall, 12px icons) had a
 * spinner as big as its whole self before padding and border.
 *
 * Both of those are layout, and neither is visible in jsdom: the markup is well-formed either way,
 * and what goes wrong is arithmetic the browser does.
 */
const squareLoading = (): Scenario => ({
  node: {
    type: 'Row',
    props: { gap: '400', ay: 'center', p: '300' },
    children: [
      {
        type: 'we-button',
        props: { id: 'md-idle', variant: 'secondary', square: true },
        children: [{ type: 'we-icon', props: { name: 'paper-plane-tilt' } }],
      },
      {
        type: 'we-button',
        props: { id: 'md-busy', variant: 'secondary', square: true, loading: true },
        children: [{ type: 'we-icon', props: { name: 'paper-plane-tilt' } }],
      },
      {
        type: 'we-button',
        props: { id: 'xs-busy', variant: 'secondary', size: 'xs', square: true, loading: true },
        children: [{ type: 'we-icon', props: { name: 'arrows-clockwise' } }],
      },
    ],
  },
  tables: {},
});

/**
 * The shape every call surface is: a square control, a name of unknown length, a square control.
 *
 * A row capped narrower than its contents want, which is what a pill measured to its own contents
 * and a panel row in a `sm` dock both are. The question is which item gives up the room, and the
 * only honest answer is the text: it can truncate and say so with an ellipsis, where a square
 * button has no narrower form and merely deforms.
 *
 * Nothing here is a stand-in for the real thing — it is the same three elements in the same order,
 * with the same props. The defect is not in any one of them, it is in what flexbox does with a
 * declaration nobody made, so a case that reproduced the *arrangement* is the case that reproduces
 * the bug.
 *
 * `maxWidth` rather than a narrow viewport, so the squeeze is in the row itself and the sweep of
 * widths stays free to say something else.
 */
const crowdedSquareRow = (): Scenario => ({
  node: {
    type: 'Row',
    props: { gap: '200', ay: 'center', p: '300', maxWidth: '260px' },
    children: [
      {
        type: 'we-button',
        props: { id: 'lead', variant: 'ghost', square: true },
        children: [{ type: 'we-icon', props: { name: 'phone-call' } }],
      },
      {
        type: 'we-text',
        props: { id: 'title', variant: 'subheading', tag: 'h5', truncate: true, minWidth: '0' },
        children: ['Thursday planning session about the autumn release and what is left in it'],
      },
      {
        type: 'we-button',
        props: { id: 'trail', variant: 'ghost', square: true },
        children: [{ type: 'we-icon', props: { name: 'pencil-simple' } }],
      },
    ],
  },
  tables: {},
});

/**
 * A pinned scroll area opening onto a page of rows that all arrive at once.
 *
 * The shape of a transcript opening: a bounded window, so the rows do not trickle in — the whole
 * page mounts in one pass, and each row is several custom elements that render their own shadow
 * content, which mount at one height and settle at another.
 *
 * Rows of real text at a real width, because the thing being measured is layout taking time: a
 * scenario of fixed-height boxes settles in one frame and proves nothing.
 *
 * **Parameterised by length**, because the two used to fail differently and it is worth keeping both
 * honest. A pinned list is now `column-reverse`, so it rests at its newest end by layout rather than
 * by any scroll, and neither length should be able to open anywhere else.
 *
 * `grow` is here to make the case that actually mattered testable: the rows in a real transcript
 * keep getting taller for seconds after they mount, as bylines resolve and avatars load. Pressing it
 * reflows every row, which is what the old implementation could not survive — it jumped to the
 * bottom, the content grew, the browser moved the scroller to hold the reader's place, and the
 * element read that as the reader scrolling away and gave up 108px short.
 */
const pinnedPage = (rows: number) => (): Scenario => ({
  node: {
    type: 'Column',
    props: { height: '320px', width: '100%' },
    $localState: { tall: { type: 'boolean', initial: false } },
    children: [
      { type: 'we-button', props: { id: 'grow', size: 'xs', onClick: { $toggleLocal: 'tall' } }, children: ['grow'] },
      {
        type: 'we-scroll-area',
        props: { id: 'feed', pin: 'end', flex: '1', minHeight: '0' },
        children: [
          {
            type: 'Column',
            props: { gap: '300', p: '300' },
            children: [
              {
                type: '$each',
                props: {
                  items: Array.from({ length: rows }, (_, i) => ({
                    id: `row-${i}`,
                    text: `Line ${i} — something somebody said that runs on for long enough to wrap`,
                    last: i === rows - 1,
                  })),
                  as: 'row',
                },
                children: [
                  {
                    type: 'Row',
                    props: { gap: '200', ay: 'start' },
                    children: [
                      { type: 'we-avatar', props: { hash: { $: 'row.id' }, size: 'xs' } },
                      {
                        type: 'we-text',
                        props: {
                          variant: 'body',
                          flex: '1',
                          minWidth: '0',
                          // What makes a row grow after it has mounted, the way a real one does when
                          // its byline arrives.
                          py: { $: "local.tall ? '500' : '0'" },
                          // The last row is findable, so the case can ask the only question that
                          // matters: is the newest line actually on screen.
                          id: { $: "row.last ? 'last-line' : ''" },
                        },
                        children: [{ $: 'row.text' }],
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
  tables: {},
});

/**
 * A timeline, in one of its four readings — anchored at the newest or the oldest end, drawn with the
 * newest at the bottom or the top. The rows are what a query would answer: newest-first while
 * following the live end, oldest-first from the start. The first of them is the row nearest the
 * anchor, and is findable; so are the "more is coming" markers, at whichever edge they land.
 */
/** The same node, findable by the case. */
const withId = (node: SchemaNode, id: string): SchemaNode => ({ ...node, props: { ...(node.props ?? {}), id } });

const timelineReading = (fromStart: boolean, orientation: 'newestBottom' | 'newestTop') => (): Scenario => {
  const rows = Array.from({ length: 80 }, (_, i) => ({
    id: `row-${i}`,
    text: `Line ${i} — something somebody said that runs on for long enough to wrap`,
  }));
  const queried = fromStart ? rows : [...rows].reverse();
  const marker = (end: 'start' | 'end'): SchemaNode => ({
    type: '$if',
    props: {
      condition: { $: timelineMoreAt(end, 'local.fromStart', 'local.orientation') },
      then: { type: 'Row', props: { id: `more-${end}`, 'data-we-more': end, py: '200' }, children: ['more…'] },
    },
  });
  const feed = timeline({
    fromStart: 'local.fromStart',
    orientation: 'local.orientation',
    onLoadOlder: { $setLocal: 'fromStart', value: { $: 'local.fromStart' } },
    onLoadNewer: { $setLocal: 'fromStart', value: { $: 'local.fromStart' } },
    onJumpNewest: { $setLocal: 'fromStart', value: false },
    onJumpOldest: { $setLocal: 'fromStart', value: true },
    children: [
      {
        type: 'Column',
        props: { gap: '300', p: '300' },
        children: [
          marker('start'),
          {
            type: '$each',
            props: { items: { $: timelineOrder('local.rows', 'local.fromStart', 'local.orientation') }, as: 'row' },
            children: [
              {
                type: 'we-text',
                props: {
                  variant: 'body',
                  // The row nearest the anchor — the first the query answered with.
                  id: { $: `row.id == '${queried[0].id}' ? 'anchor-row' : ''` },
                },
                children: [{ $: 'row.text' }],
              },
            ],
          },
          marker('end'),
        ],
      },
    ],
  });
  return {
    node: {
      type: 'Column',
      props: { height: '320px', width: '100%' },
      $localState: {
        fromStart: { type: 'boolean', initial: fromStart },
        orientation: { type: 'string', initial: orientation },
        rows: { type: 'array', initial: queried },
      },
      children: [withId(feed, 'feed')],
    },
    tables: {},
  };
};

const pinnedShortContent = (): Scenario => ({
  node: {
    type: 'Column',
    props: { height: '320px', width: '100%' },
    children: [
      {
        type: 'we-scroll-area',
        props: { id: 'feed', pin: 'end', flex: '1', minHeight: '0' },
        children: [
          {
            type: 'Column',
            props: { gap: '300', p: '300' },
            children: [{ type: 'we-text', props: { id: 'placeholder' }, children: ['Nothing has been said yet.'] }],
          },
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

/**
 * A call's transcript at whatever length a case asks for — the real `transcriptLines`.
 *
 * The real fragment rather than a stand-in, because the subject is what that fragment costs: its
 * query, its `$agent` per row, its speaker grouping. A hand-written list of `we-text` would measure
 * something nobody ships.
 *
 * Utterances vary in length and rotate between three speakers on purpose. Equal-length lines all
 * wrap identically and make layout cost look flatter than it is, and one speaker means the grouping
 * branch is never taken — both would flatter the thing being measured.
 */
const SPEAKERS = ['did:peer-a', 'did:peer-b', 'did:peer-c'];
const CALL = 'call-record-1';

const transcriptAt = (rows: number): Scenario => ({
  /*
    The feed's real shape: the rows inside a scroll area that follows the tail.

    Composed here rather than importing `transcriptFeed`, which reaches its rows through `$part` and
    so needs the module registry the harness does not mount. What matters is that the scroll area is
    PRESENT — it observes its own size and reads `scrollTop`/`scrollHeight` whenever that changes,
    which is the entire cost of resizing a panel full of transcript. Mounting the rows bare measures
    a resize with nobody watching, which is a different and much cheaper thing.
  */
  node: panelScroll({ pin: 'end', jump: 'both', children: [transcriptLines] }),
  tables: {
    CollectionBlock: [{ id: CALL, kind: 'call', title: 'Standup', createdAt: '2026-09-01T09:00' }],
    TextBlock: Array.from({ length: rows }, (_, i) => ({
      id: `utterance-${i}`,
      // What the scope drill-down resolves through — without it the relation finds nothing and the
      // scenario measures an empty list very quickly.
      parentId: CALL,
      text: `${'A line of what somebody said. '.repeat(1 + (i % 4))}(${i})`,
      author: SPEAKERS[i % SPEAKERS.length],
      // Ordered, and lexicographically sortable, so `order: { createdAt }` means something.
      createdAt: `2026-09-01T09:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`,
    })),
  },
  relations: {
    CollectionBlock: { children: { type: 'hasMany', target: 'TextBlock', foreignKey: 'parentId' } },
  },
  stores: {
    profileStore: { profiles: SPEAKERS.map((did, i) => ({ did, name: `Peer ${i + 1}` })) },
    /*
      The window's own state, stubbed at the module's defaults.

      Worth stating why these are here even where the fragment being measured does not read them: an
      unresolved `limit` is DROPPED rather than refused — the same widening an unresolved `where`
      gets — so a scenario that forgets them measures an unbounded query and reports the windowed
      version as having changed nothing. Which is exactly what this scenario did until it was run
      against the fix and reported no difference at all.
    */
    modules: {
      transcribe: {
        collectionId: CALL,
        callOnScreenLive: true,
        transcriptShown: 200,
        transcriptFromStart: false,
      },
    },
  },
});

/**
 * The canvas's reading strip, under the chrome it has to clear.
 *
 * The strip is `position: absolute`, and the question is not whether it renders — it always did — but
 * whether a reader can see it. The workshop pins a bar of pills over the whole route with
 * `position: fixed`, so a strip at the container's own top corner is *underneath* them: rendered,
 * measurable, correct in every jsdom assertion, and neither visible nor pressable. That is what shipped,
 * and it took somebody deleting the pills in devtools to find it.
 *
 * So the scenario puts a stand-in bar where the pills are — the same `top` and the same height, off the
 * band the template exports, so a theme that adds to control heights moves both together — and the case
 * asserts the two do not overlap. A case that hard-coded 68px would pass here and lie about every other
 * theme.
 *
 * `position: absolute` for the stand-in where the real bar is `fixed`: a fixed bar resolves against the
 * viewport, which in the app is where this route's top edge is, and in the harness is the top of the
 * page rather than the top of the mounted box. The vertical geometry under test is the same either way.
 *
 * The strip itself is the app's, imported. What is restated is the box around it — three props off the
 * canvas route — because the real first child is a `GraphView` and needs a graph host.
 */
const treeStripOverCanvas = (): Scenario => ({
  node: {
    type: 'Column',
    props: { width: '100%', height: '420px', minHeight: '0', overflow: 'hidden', position: 'relative' },
    $localState: { ...TREE_LOCALS },
    $queries: { ...TREE_QUERIES },
    children: [
      // Stands in for the canvas: a sibling as tall as the container, which is what the strip floats over.
      { type: 'Column', props: { width: '100%', height: '100%', bg: 'surface-sunken' } },
      /*
        Stands in for the pinned pill bar. Addressed by its words in the case, and given the band's own
        `top` and `height` rather than numbers, so it cannot drift from what the template pins.
      */
      {
        type: 'Row',
        props: {
          position: 'absolute',
          top: CALL_CHROME_BAND.top,
          left: '300',
          height: CALL_CHROME_BAND.height,
          px: '300',
          ay: 'center',
          bg: 'surface-raised',
          r: 'pill',
          zIndex: 3,
        },
        children: [{ type: 'we-text', props: { variant: 'label' }, children: ['Call pill'] }],
      },
      treeStrip({ below: CALL_CHROME_BAND.bottom }),
    ],
  },
  tables: {
    // Two kinds to choose a spine from, and one reaction to order by — enough for every picker in the
    // strip to have something to show, which is what makes its width worth measuring.
    RelationshipType: [
      { id: 'rt-1', name: 'Supports', slug: 'supports' },
      { id: 'rt-2', name: 'Contradicts', slug: 'contradicts' },
    ],
    SignalType: [{ id: 'st-1', name: 'Agree', slug: 'agree', mode: 'toggle', aggregate: 'count' }],
  },
});

/**
 * The tree strip ordered by a reaction, with the Voices list holding three people — what the
 * canvas seed's summary would report — so the popover has rows to lay out.
 */
const voicesPopover = (): Scenario => {
  const base = treeStripOverCanvas();
  const column = base.node as SchemaNode & { $localState: Record<string, unknown> };
  column.$localState = {
    ...column.$localState,
    treeMode: { ...TREE_LOCALS.treeMode, initial: true },
    order: { ...TREE_LOCALS.order, initial: 'signal' },
    voiceSummary: {
      type: 'object',
      initial: {
        type: 'st-1',
        voices: [
          { author: 'did:key:ana', cards: 4, mean: 3.5 },
          { author: 'did:key:ben', cards: 2, mean: 1 },
          { author: 'pretend:1', cards: 1, mean: 5, name: 'Ada' },
        ],
      },
    },
  };
  return base;
};

/**
 * The same vocabulary panel with exactly ONE person's reaction on each type.
 *
 * Its own scenario rather than a width of the other one, because the count is the whole subject: a
 * summary saying "1 person" behind a press that reveals one row is three pieces of indirection in
 * front of something shorter than the thing hiding it, so one reactor is shown outright and the
 * summary is not drawn at all.
 *
 * That used to be a `total == 1` branch with the list written into both of its sides. It is now two
 * conditions over one list, which is the same answer in half the characters — and the case exists
 * because nothing else measures the one-person path: `signals:vocabulary` seeds two reactions per
 * type, so every assertion about it was about the crowd.
 */
const oneReactor = (): Scenario => {
  const base = vocabulary();
  /*
    The reader's own, so the row has something to say.

    This scenario seeds no profiles, so a peer resolves to no name and their row renders as an
    empty string — which is why `reactorDisclosure` asserts on "You" as well. One reaction, and it
    is the reader's.
  */
  const only = [
    { signalTypeId: 'st-like', value: 1, author: 'did:me' },
    { signalTypeId: 'st-stars', value: 5, author: 'did:me' },
  ];
  // The reactions are a literal on the `$each`, as they are in the scenario this builds on — the
  // display reads `row.signals`, so there is no table to seed.
  const each = base.node as SchemaNode & { props: { items: Record<string, unknown>[] } };
  each.props.items = [{ id: 'card-1', signals: only }];
  return base;
};

/**
 * A glyph that was told not to shrink, in a row with nothing else that can give.
 *
 * `flexShrink` is a recognised layout key and worked on `Column`/`Row`/`Grid`, which take their
 * styles inline — and did nothing at all on any `we-*` element, because the primitives reach CSS
 * by a second path and neither half of it knew the prop. 217 places across the composed templates
 * asked an icon, an avatar or a timestamp not to shrink and were ignored.
 *
 * Most of those never showed it: `we-timestamp` hard-codes `flex-shrink: 0` in its own CSS, and
 * an avatar in a byline is rarely under enough pressure to compress. So this row is built to apply
 * the pressure — a long unbreakable word beside a glyph, in a box too narrow for both — because a
 * case measured where the prop happens not to bite would have passed before the fix and after it.
 */
const unshrinkableBox = (): Scenario => {
  /*
    A box with a width it can be squeezed out of.

    An icon will not do, however tight the row: its SVG gives it a min-content floor at its own
    size, so it cannot shrink whether or not anything told it to. The item has to be one whose
    min-content is genuinely smaller than its width — short words inside a wider box — or the case
    measures the same number before the fix and after, which is exactly what the first draft of it
    did.
  */
  const pill: SchemaNode = {
    type: 'we-text',
    props: { width: '120px', flexShrink: '0', bg: 'surface-sunken' },
    children: ['one two three'],
  };
  return {
    node: {
      type: 'Column',
      props: { width: '100%', gap: '400' },
      children: [
        // Under pressure: a neighbour that wants more room than the row has left.
        {
          type: 'Row',
          props: { width: '100%', ay: 'center', gap: '200' },
          children: [pill, { type: 'we-text', children: ['several more words to crowd it out of its width'] }],
        },
        /*
          The same box with the row to itself, as the control.

          A width the case states as a number goes stale the day the type scale moves, and would
          then fail for a reason that has nothing to do with the prop. Two of them in one tree
          answer "did this one keep its width" without anybody having to know what the width is.
        */
        { type: 'Row', props: { width: '100%', ay: 'center', gap: '200' }, children: [pill] },
      ],
    },
    tables: {},
  };
};

/**
 * One card, and a way to change its display mode while it is on screen.
 *
 * `cardShell` draws its body through a single `CollapsedContent` whose props carry the mode,
 * rather than through a `$if` holding the body down both branches — which is what took every card
 * list in WE from three copies of its body to two. The saving is only safe if the two modes still
 * render what they rendered: clipped with a toggle when compact, and no wrapper at all when
 * expanded.
 *
 * The mode is switched by pressing, not by mounting twice, because the failure worth catching is a
 * reactivity one. A Solid component body runs ONCE, so deciding "is there anything to collapse"
 * with an early `return` freezes that decision at creation — every mode renders correctly on a
 * first paint and the card then keeps the first mode's shape for the rest of its life. Both modes
 * measured from a fresh mount would pass against exactly that bug.
 */
const collapsingCard = (): Scenario => ({
  node: {
    type: 'Column',
    props: { width: '100%', p: '300', gap: '300' },
    $localState: { displayMode: { type: 'string', initial: 'compact' } },
    children: [
      {
        type: 'we-button',
        props: { size: 'sm', onClick: { $setLocal: 'displayMode', value: 'expanded' } },
        children: ['Expanded mode'],
      },
      {
        type: 'we-button',
        props: { size: 'sm', onClick: { $setLocal: 'displayMode', value: 'compact' } },
        children: ['Compact mode'],
      },
      cardShell({
        header: [{ type: 'we-text', props: { variant: 'heading-sm' }, children: ['A card'] }],
        // Comfortably past the 100px a compact card clips to, so "is it clipped" has an answer.
        body: Array.from({ length: 14 }, (_, i) => ({
          type: 'we-text',
          props: { tag: 'p' },
          children: [`Body line ${i + 1}`],
        })),
      }),
    ],
  },
  tables: {},
});

/**
 * Elements whose events fire on their own, each wired to a write, rendered as a space template is.
 *
 * Event props bind by shape — any `on[A-Z]…` key holding an action list — so a template reaches every
 * event an element can fire, including the ones nobody causes. Each of these once ran its action on
 * render. `record.create` is the real write a template names, behind the real space-tier bag with the
 * gesture gate on; only the store underneath is a stub, marking the page so the case can see a call.
 *
 * The button is the other half: pressed by the case, its write must go through, or the gate is simply
 * refusing everything. The two `x-late-emitter`s are the same question asked after the press has
 * finished dispatching — one answering a press, one answering nobody.
 */
const selfFiringEvents = (): Scenario => {
  const write = (name: string) => [{ $action: 'record.create', args: ['Probe', { probe: name }] }];
  return {
    node: {
      type: 'Column',
      props: { width: '100%', gap: '200' },
      children: [
        { type: 'button', props: { id: 'pressed', onClick: write('control-click') }, children: ['press me'] },
        { type: 'img', props: { src: '/does-not-exist.png', alt: '', onError: write('img-error') } },
        {
          type: 'img',
          props: {
            src: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
            alt: '',
            onLoad: write('img-load'),
          },
        },
        { type: 'details', props: { open: true, onToggle: write('details-toggle') }, children: ['open on mount'] },
        { type: 'input', props: { autofocus: true, onFocus: write('autofocus') } },
        // Answers its own press late — after the press has finished — as a crop or a lookup does.
        { type: 'x-late-emitter', props: { id: 'late', onDone: write('late-pressed') }, children: ['press me later'] },
        // Answers nobody, late: emits once after mounting.
        { type: 'x-late-emitter', props: { auto: true, onDone: write('late-unasked') } },
      ],
    },
    tables: {},
    bag: 'space',
    stores: {
      record: {
        create: (_entity: string, fields: { probe: string }) =>
          document.body.setAttribute(`data-fired-${fields.probe}`, ''),
      },
    },
  };
};

/**
 * Ways a template might run code of its own, rendered as a space template is.
 *
 * Each tries to mark the page, and before the element allowlist three of them did: a `script` ran, an
 * `iframe` with `srcdoc` ran with access to the page, and a `javascript:` link ran on a click. A
 * string `onerror` did not run but threw while mounting, taking the whole render down — so the
 * marker at the end is a check that the rest of the template still drew.
 */
const codeInTemplate = (): Scenario => {
  const mark = (name: string) => `document.body.setAttribute('data-ran-${name}', '')`;
  return {
    node: {
      type: 'Column',
      props: { width: '100%', gap: '200' },
      children: [
        { type: 'script', children: [mark('script')] },
        { type: 'iframe', props: { srcdoc: `<script>parent.${mark('srcdoc')}</script>` } },
        { type: 'img', props: { src: '/does-not-exist.png', alt: '', onerror: mark('onerror') } },
        { type: 'a', props: { id: 'js-link', href: `javascript:${mark('jshref')}` }, children: ['link'] },
        // The same URL, built by an expression rather than written down.
        {
          type: 'a',
          props: { id: 'js-expr', href: { $: `'javascript:' + "${mark('jsexpr').replace(/"/g, '\\"')}"` } },
          children: ['built'],
        },
        // And handed to a design-system link, which draws its own anchor inside a shadow root.
        { type: 'we-link', props: { id: 'js-we-link', href: `javascript:${mark('welink')}` }, children: ['we-link'] },
        {
          type: 'embed',
          props: { src: `data:text/html,<script>parent.${mark('embed')}</script>`, type: 'text/html' },
        },
        { type: 'span', props: { id: 'still-here' }, children: ['the rest of the template drew'] },
      ],
    },
    tables: {},
    bag: 'space',
  };
};

/**
 * Sliders with labelled marks, one at each size the thumb differs at, so a mark's place can be
 * checked against where the thumb really goes rather than against the arithmetic that placed it.
 */
const sliderMarks = (): Scenario => ({
  node: {
    type: 'Column',
    props: { gap: '600', p: '400' },
    children: (['sm', 'md', 'lg'] as const).map((size) => ({
      type: 'we-slider',
      props: {
        size,
        min: 0,
        max: 1,
        step: 0.001,
        value: 0.5,
        marks: [
          { value: 0, label: 'Jan 2026' },
          { value: 0.25, label: 'Apr' },
          { value: 0.5, label: 'Jul' },
          { value: 0.75, label: 'Oct' },
          { value: 1, label: 'Jan 2027' },
        ],
      },
    })),
  },
  tables: {},
});

/**
 * A section folded and unfolded in place by `$animate` with a reveal — how a rail group's rows
 * open — with a line under it whose position says how open the section is.
 */
const foldingSection = (): Scenario => ({
  node: {
    type: 'Column',
    $localState: { open: { type: 'boolean', initial: true } },
    props: { width: '100%', gap: '200' },
    children: [
      { type: 'we-button', props: { id: 'fold-toggle', onClick: { $toggleLocal: 'open' } }, children: ['Toggle'] },
      {
        type: '$animate',
        props: {
          condition: { $: 'local.open' },
          enterTransition: [{ type: 'reveal', duration: 300, easing: 'ease-in-out' }],
          exitTransition: [{ type: 'reveal', duration: 300, easing: 'ease-in-out' }],
        },
        children: [{ type: 'Column', props: { height: '200px', bg: 'surface-sunken' } }],
      },
      { type: 'we-text', props: { id: 'below-fold' }, children: ['Below'] },
    ],
  },
  tables: {},
});

export const scenarios: Record<string, (scale?: number) => Scenario> = {
  'ds:slider-marks': sliderMarks,
  'security:self-firing-events': selfFiringEvents,
  'security:code-in-template': codeInTemplate,
  'canvas:tree-strip': treeStripOverCanvas,
  'canvas:voices': voicesPopover,
  'perf:transcript': (scale) => transcriptAt(scale ?? 100),
  'discussion:thread': discussionThread,
  'signals:reaction': reactionControl,
  'cards:counts': countControls,
  'tooltip:rich': richTooltip,
  'signals:vocabulary': vocabulary,
  'signals:one-reactor': oneReactor,
  'inspector:provenance': provenanceLine,
  'ds:nested-interactive': nestedInteractive,
  'ds:token-offsets': tokenOffsets,
  'ds:square-loading': squareLoading,
  'ds:crowded-square-row': crowdedSquareRow,
  'ds:pinned-page': pinnedPage(120),
  'ds:pinned-short': pinnedPage(20),
  'ds:pinned-empty': pinnedShortContent,
  'timeline:live-newest-bottom': timelineReading(false, 'newestBottom'),
  'timeline:live-newest-top': timelineReading(false, 'newestTop'),
  'timeline:start-newest-bottom': timelineReading(true, 'newestBottom'),
  'timeline:start-newest-top': timelineReading(true, 'newestTop'),
  'panel:sections': panelSections,
  'cards:collapse': collapsingCard,
  'ds:unshrinkable-box': unshrinkableBox,
  'ds:folding-section': foldingSection,
};
