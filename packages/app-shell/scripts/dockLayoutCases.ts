/**
 * The scenarios the dock layout's vectors are recorded from. `recordKernelVectors.ts` asks each one
 * of the kernel and writes the answers beside the questions.
 *
 * A scenario is what a host has in hand at one moment — the panels and what each asks for, the
 * window, its chrome, which was touched last — and the questions it asks of the kernel then, each
 * `{ fn, args }`: one of the kernel's entry points and its arguments in order. An arrangement of
 * panels is asked every whole-layout question (how the lanes seat, every panel's box, the edge lanes,
 * the insets, the frames) and what a drag over it would clear and stack onto; a drag is asked what it
 * is offered and what a drop writes; a gesture what it leaves. The helpers those answers are built
 * from are pinned by nothing here, so they can be refactored without re-recording.
 *
 * An argument may name something the scenario already holds rather than repeat it: `{ "$": "requests" }`
 * is the scenario's `given.requests`, and `{ "$": "seatLanes.hidden" }` is a field of the answer an
 * earlier question in the same scenario got (named by its `as`, or by its `fn`). That is the host's
 * own order — `resolveDocks` is handed the seating `seatLanes` gave — and it keeps the file to one
 * copy of each arrangement.
 *
 * The app frame a scenario is asked under rides on its viewport (`Viewport.frame`); absent, it is the
 * default one. Arguments are plain JSON, so an optional argument in the middle is never left out —
 * every question passes what it means.
 */
import {
  type AppFrame,
  type ContentInset,
  DEFAULT_APP_FRAME,
  type DockRequest,
  type DockResolution,
  type FloatPlacement,
  laneable,
  type Rect,
  seatLanes,
  type SnapPoint,
  snapTargetRects,
  type Viewport,
} from '../src/shared/dockGeometry';

/** One question asked of the kernel. */
export interface DockAsk {
  /** What it asks, where a scenario asks one function more than once. */
  name?: string;
  fn: string;
  args: unknown[];
  /** Argument positions passed as absent (`undefined`), which JSON cannot hold: each is `null` in `args`. */
  absent?: number[];
  /** The name a later question refers to this one's answer by, in place of `fn`. */
  as?: string;
}

/** One moment, and every question asked of it. */
export interface DockScenario {
  name: string;
  given: Record<string, unknown>;
  asks: DockAsk[];
}

/**
 * Ask a scenario's questions in order, each with its references read: the reading of the vectors a
 * second host follows. Calls `run` with each question's arguments, and returns the answers in order.
 */
export function askScenario(scenario: DockScenario, run: (fn: string, args: unknown[]) => unknown): unknown[] {
  const known: Record<string, unknown> = { ...scenario.given };
  const read = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(read);
    if (!value || typeof value !== 'object') return value;
    const entries = Object.entries(value);
    if (entries.length === 1 && entries[0][0] === '$' && typeof entries[0][1] === 'string')
      return entries[0][1].split('.').reduce<unknown>((at, key) => (at as Record<string, unknown>)?.[key], known);
    return Object.fromEntries(entries.map(([key, inner]) => [key, read(inner)]));
  };
  return scenario.asks.map((ask) => {
    const args = ask.args.map((arg, index) => (ask.absent?.includes(index) ? undefined : read(arg)));
    const answer = run(ask.fn, args);
    known[ask.as ?? ask.fn] = answer;
    return answer;
  });
}

/** An argument naming what the scenario holds — see {@link askScenario}. */
const ref = (path: string) => ({ $: path });

/** An argument left out, where a later one is given — written `null`, and listed in `absent`. */
const ABSENT = Symbol('absent');

const desktop: Viewport = { width: 1440, height: 900 };
const narrow: Viewport = { width: 800, height: 700 };
const wide: Viewport = { width: 2560, height: 1440 };
const short: Viewport = { width: 1440, height: 300 };
const topBar: AppFrame = { ...DEFAULT_APP_FRAME, top: 48 };
const noRail: AppFrame = { ...DEFAULT_APP_FRAME, right: 0 };
const NONE: ContentInset = { left: 0, right: 0, top: 0, bottom: 0 };
const chrome: ContentInset = { left: 0, right: 56, top: 0, bottom: 74 };
const fullChrome: ContentInset = { left: 0, right: 0, top: 0, bottom: 0 };

const EDGES = ['left', 'right', 'top', 'bottom'] as const;
const SNAPS: SnapPoint[] = ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left'];
const edgeOf = (snap: SnapPoint) => (EDGES as readonly string[]).includes(snap);

const card = (over: Partial<FloatPlacement> = {}): FloatPlacement => ({
  snap: 'right',
  x: 400,
  y: 120,
  w: 360,
  h: 420,
  displace: false,
  ...over,
});
const dock = (id: string, placement: FloatPlacement | null, over: Partial<DockRequest> = {}): DockRequest => ({
  id,
  edge: placement === null ? null : placement.snap && edgeOf(placement.snap) ? (placement.snap as 'left') : 'right',
  size: 'md',
  float: false,
  ...(placement ? { placement } : {}),
  ...over,
});
/** A lane of three seats on an edge: one plain, one growing with a floor, one folded. */
const laneOfThree = (edge: (typeof EDGES)[number], displace: boolean): DockRequest[] => [
  dock(`${edge}1`, card({ snap: edge, displace, band: 0, order: 0, h: 300, w: 300 })),
  dock(`${edge}2`, card({ snap: edge, displace, band: 0, order: 1, h: 400, w: 400, grow: 2 }), {
    min: { height: 260, width: 260 },
  }),
  dock(`${edge}3`, card({ snap: edge, displace, band: 0, order: 2, h: 200, w: 200, collapsed: true })),
];

interface Scenario {
  name: string;
  requests: DockRequest[];
  touched: Record<string, number>;
  /** The windows it is asked under; desktop when absent. */
  viewports?: [string, Viewport][];
}

const ONLY_DESKTOP: [string, Viewport][] = [['', desktop]];
const DESKTOP_AND_NARROW: [string, Viewport][] = [
  ['', desktop],
  [' (narrow)', narrow],
];

/** The arrangements every whole-layout question is asked of. */
const scenarios: Scenario[] = [
  { name: 'nothing open', requests: [], touched: {} },
  ...EDGES.map((edge): Scenario => ({
    name: `one sidebar on the ${edge}`,
    requests: [dock('p', card({ snap: edge, displace: true, ...(edge === 'right' ? { thicknessX: 380 } : {}) }))],
    touched: {},
    // A narrow window refuses the trade on every edge alike: asked of one.
    viewports: edge === 'left' ? DESKTOP_AND_NARROW : undefined,
  })),
  {
    name: 'one card at each snap',
    requests: SNAPS.map((snap) => dock(snap, card({ snap, w: 240, h: 160 }))),
    touched: { top: 2, right: 1 },
  },
  {
    name: 'one card at each snap, beside a left sidebar, under a top bar',
    requests: [
      dock('side', card({ snap: 'left', displace: true, thicknessX: 300 })),
      ...SNAPS.filter((snap) => snap !== 'left').map((snap) => dock(snap, card({ snap, w: 240, h: 160 }))),
    ],
    touched: {},
    viewports: [[' (top bar)', { ...desktop, frame: topBar }]],
  },
  {
    name: 'two sidebars sharing a left band, and a card on the right',
    requests: [
      dock('a', card({ snap: 'left', displace: true, band: 0, order: 0, h: 300 })),
      dock('b', card({ snap: 'left', displace: true, band: 0, order: 1, h: 500, grow: 2 }), { min: { height: 240 } }),
      dock('c', card()),
    ],
    touched: { b: 2 },
    viewports: DESKTOP_AND_NARROW,
  },
  {
    name: 'a stack of two tabs on the right, and a card along the top',
    requests: [
      dock('a', card({ displace: true, band: 0, order: 0, tab: 0 })),
      dock('b', card({ displace: true, band: 0, order: 0, tab: 1 })),
      dock('t', card({ snap: 'top', h: 200 })),
    ],
    touched: { a: 1, b: 4 },
  },
  {
    name: 'a lane put away on the left, a band along the bottom, a panel maximised',
    requests: [
      dock('s1', card({ snap: 'left', displace: true, band: 0, order: 0, stowed: true })),
      dock('s2', card({ snap: 'left', displace: true, band: 0, order: 1, stowed: true })),
      dock('b', card({ snap: 'bottom', displace: true, thicknessY: 240 })),
      dock('m', card({ snap: null, maximised: true })),
    ],
    touched: { m: 9, s2: 3 },
  },
  {
    name: 'cards in open space: a column of two, a corner, a loose stack, one closed, one full',
    requests: [
      dock('r1', card({ order: 0, h: 300 })),
      dock('r2', card({ order: 1, h: 300, collapsed: true })),
      dock('corner', card({ snap: 'bottom-left' }), { edge: 'left' }),
      dock('l1', card({ snap: null, seat: 'l1', x: 600, y: 200 })),
      dock('l2', card({ snap: null, seat: 'l1', x: 600, y: 200 })),
      dock('closed', null),
      dock('full', card({ snap: null }), { size: 'full' }),
    ],
    touched: { l2: 5, r1: 1 },
    viewports: DESKTOP_AND_NARROW,
  },
  {
    name: 'two bands on the left, the inner one folded beside an open mate',
    requests: [
      dock('outer', card({ snap: 'left', displace: true, band: 0, order: 0 })),
      dock('in1', card({ snap: 'left', displace: true, band: 1, order: 0, collapsed: true })),
      dock('in2', card({ snap: 'left', displace: true, band: 1, order: 1 })),
      dock('top', card({ snap: 'top', displace: true, thicknessY: 160 })),
    ],
    touched: {},
    viewports: DESKTOP_AND_NARROW,
  },
  {
    name: 'a crowded left edge: three lanes, one of them put away, and a column of cards on the right',
    requests: [
      dock('l0', card({ snap: 'left', displace: true, band: 0, thicknessX: 320 })),
      dock('l1', card({ snap: 'left', displace: true, band: 1, stowed: true })),
      dock('l2', card({ snap: 'left', displace: true, band: 2, thicknessX: 900 })),
      dock('r0', card({ order: 0, h: 500 })),
      dock('r1', card({ order: 1, h: 500, w: 2000 })),
      dock('r2', card({ order: 2, h: 500 })),
    ],
    touched: { r2: 1 },
  },
  ...EDGES.flatMap((edge): Scenario[] => [
    {
      name: `a lane of three seats pushing the content aside on the ${edge}, one folded`,
      requests: [...laneOfThree(edge, true), dock('mover', card({ snap: null, x: 600, y: 300 }))],
      touched: {},
      // Too short for its seats: across a side lane's length, and a bottom band's.
      viewports:
        edge === 'left' || edge === 'bottom'
          ? [
              ['', desktop],
              [' (short)', short],
            ]
          : undefined,
    },
    {
      name: `a column of three cards over the content on the ${edge}, one folded`,
      requests: laneOfThree(edge, false),
      touched: { [`${edge}2`]: 1 },
      viewports: [
        ['', desktop],
        ...(edge === 'left' || edge === 'bottom' ? [[' (short)', short] as [string, Viewport]] : []),
        ...(edge === 'right' ? [[' (narrow)', narrow] as [string, Viewport]] : []),
      ],
    },
  ]),
  {
    name: 'a lane of one put away on the left',
    requests: [dock('one', card({ snap: 'left', displace: true, stowed: true }))],
    touched: {},
  },
  {
    name: 'a lane of two seats put away on the right, one a stack',
    requests: [
      dock('a', card({ displace: true, band: 0, order: 0, stowed: true })),
      dock('b', card({ displace: true, band: 0, order: 1, tab: 0, stowed: true })),
      dock('c', card({ displace: true, band: 0, order: 1, tab: 1, stowed: true })),
    ],
    touched: { c: 1 },
  },
  {
    name: 'a band put away along the bottom',
    requests: [dock('bt', card({ snap: 'bottom', displace: true, stowed: true }))],
    touched: {},
  },
  {
    name: 'single panels in every condition: off screen, no placement, full size, maximised, folded, corner',
    requests: [
      dock('off', card({ snap: null, x: -400, y: 2000 })),
      { id: 'bare', edge: 'left', size: 'lg', float: false },
      { id: 'bid', edge: 'bottom', size: 'sm', float: true },
      { id: 'corner', edge: null, size: 'md', float: true },
      dock('fullsize', card(), { size: 'full' }),
      dock('folded', card({ snap: 'top-right', collapsed: true })),
      dock('huge', card({ snap: 'bottom-right', w: 2000, h: 2000 })),
    ],
    touched: { folded: 2 },
    viewports: DESKTOP_AND_NARROW,
  },
  {
    name: 'two panels maximised, the one touched last on top',
    requests: [dock('m1', card({ snap: null, maximised: true })), dock('m2', card({ snap: null, maximised: true }))],
    touched: { m1: 3 },
  },
  {
    name: 'a sidebar and a card in an app with no rail',
    requests: [dock('side', card({ snap: 'right', displace: true })), dock('c', card({ snap: 'top-right' }))],
    touched: {},
    viewports: [[' (no rail)', { ...desktop, frame: noRail }]],
  },
  {
    name: 'sections at home in a template lane',
    requests: [
      dock('template:feed', card({ snap: 'home', home: 'main', order: 0 })),
      dock('template:chat', card({ snap: 'home', home: 'main', order: 1, tab: 0 })),
      dock('template:info', card({ snap: 'home', home: 'main', order: 1, tab: 1 })),
      dock('template:away', card({ snap: 'bottom-right' })),
    ],
    touched: { 'template:info': 2 },
  },
  {
    name: 'a band put away along the top',
    requests: [dock('tp', card({ snap: 'top', displace: true, stowed: true }))],
    touched: {},
  },
  ...(['right', 'top', 'bottom'] as const).map((edge): Scenario => ({
    name: `two lanes pushing the content aside on the ${edge}`,
    requests: [
      dock(`${edge}-outer`, card({ snap: edge, displace: true, band: 0, thicknessX: 300, thicknessY: 160 })),
      dock(`${edge}-inner`, card({ snap: edge, displace: true, band: 1, thicknessX: 260, thicknessY: 140 })),
      dock('mover', card({ snap: null, x: 600, y: 300 })),
    ],
    touched: {},
  })),
];

const titles = { a: 'Notes', b: 'Transcript', 'template:chat': 'Chat' };

const scenario = (name: string) => {
  const found = scenarios.find((entry) => entry.name === name);
  if (!found) throw new Error(`no scenario ${name}`);
  return found;
};

/** The drags asked over a scenario's arrangement, on the desktop window: what each carried box is offered. */
const drags: Record<
  string,
  { moves: [label: string, moving: string, carried: Rect | null][]; inset: ContentInset; stackFor?: string }
> = {
  'two sidebars sharing a left band, and a card on the right': {
    moves: [
      ['a card carried to the left band', 'c', { x: 60, y: 300, w: 360, h: 300 }],
      ['a card carried nowhere near an edge', 'c', { x: 600, y: 300, w: 200, h: 200 }],
    ],
    inset: { ...NONE, left: 300 },
  },
  'two bands on the left, the inner one folded beside an open mate': {
    moves: [['a sidebar carried along the top', 'outer', { x: 500, y: 20, w: 300, h: 200 }]],
    inset: { ...NONE, left: 600, top: 160 },
  },
  'a lane put away on the left, a band along the bottom, a panel maximised': {
    moves: [['to a stowed lane', 'b', { x: 40, y: 300, w: 300, h: 300 }]],
    inset: { ...NONE, left: 34, bottom: 240 },
  },
  'a stack of two tabs on the right, and a card along the top': {
    moves: [
      ['a stack’s tab carried to the right', 't', { x: 1200, y: 300, w: 200, h: 300 }],
      ['nothing carried', 'a', null],
    ],
    inset: { ...NONE, right: 440 },
  },
  'a crowded left edge: three lanes, one of them put away, and a column of cards on the right': {
    moves: [
      ['a sidebar carried to the bottom', 'l0', { x: 600, y: 760, w: 300, h: 120 }],
      ['a card carried to the right, past the column on it', 'r1', { x: 1200, y: 300, w: 200, h: 200 }],
    ],
    inset: { ...NONE, left: 1254 },
  },
  'cards in open space: a column of two, a corner, a loose stack, one closed, one full': {
    moves: [['a card carried to the right column', 'corner', { x: 1100, y: 300, w: 300, h: 200 }]],
    inset: NONE,
    stackFor: 'r1',
  },
  ...Object.fromEntries(
    EDGES.map((edge) => [
      `a lane of three seats pushing the content aside on the ${edge}, one folded`,
      {
        moves: [
          [
            `a card carried to the ${edge}`,
            'mover',
            {
              left: { x: 10, y: 300, w: 200, h: 200 },
              right: { x: 1230, y: 300, w: 200, h: 200 },
              top: { x: 600, y: 10, w: 200, h: 200 },
              bottom: { x: 600, y: 690, w: 200, h: 200 },
            }[edge],
          ],
        ],
        inset: NONE,
      },
    ]),
  ),
  ...Object.fromEntries(
    (['right', 'top', 'bottom'] as const).map((edge) => [
      `two lanes pushing the content aside on the ${edge}`,
      {
        moves: [
          [
            `a card carried to the ${edge}`,
            'mover',
            {
              right: { x: 1230, y: 300, w: 200, h: 200 },
              top: { x: 600, y: 10, w: 200, h: 200 },
              bottom: { x: 600, y: 690, w: 200, h: 200 },
            }[edge],
          ],
        ],
        inset: { ...NONE, [edge]: edge === 'right' ? 560 : 300 },
      },
    ]),
  ),
};

export function dockLayoutScenarios(): DockScenario[] {
  const out: DockScenario[] = [];
  let current: DockScenario = { name: '', given: {}, asks: [] };
  const begin = (name: string, given: Record<string, unknown> = {}) => {
    current = { name, given, asks: [] };
    out.push(current);
  };
  const add = (name: string | undefined, fn: string, args: unknown[], as?: string) => {
    const absent = args.flatMap((arg, index) => (arg === ABSENT ? [index] : []));
    current.asks.push({
      ...(name ? { name } : {}),
      fn,
      args: args.map((arg) => (arg === ABSENT ? null : arg)),
      ...(absent.length ? { absent } : {}),
      ...(as ? { as } : {}),
    });
  };

  /** A layout scenario's inputs, and the two answers every other question builds on. */
  const seated = (requests: DockRequest[], viewport: Viewport, touched: Record<string, number>, name: string) => {
    begin(name, { requests, viewport, chrome, touched, titles });
    add(undefined, 'seatLanes', [
      {
        requests: ref('requests'),
        viewport: ref('viewport'),
        chrome: ref('chrome'),
        touched: ref('touched'),
        titles: ref('titles'),
      },
    ]);
    // Only where a panel is at home in a template's lane: anywhere else the answer is `{}`.
    if (requests.some((request) => request.placement?.snap === 'home'))
      add(undefined, 'laneSectionsOf', [
        { requests: ref('requests'), homes: {}, declared: requests.map((request) => request.id), instances: {} },
      ]);
  };
  /** `resolveDocks` over the scenario, as the shell asks it at rest, with a moment's differences. */
  const resolving = (requests: DockRequest[], over: Partial<Record<keyof DockResolution, unknown>> = {}) => ({
    requests: ref('requests'),
    seating: ref('seatLanes'),
    viewport: ref('viewport'),
    chrome: ref('chrome'),
    fullScreenChrome: fullChrome,
    touched: ref('touched'),
    titles: ref('titles'),
    settling: '',
    landedTab: '',
    laneMove: null,
    stowPending: null,
    away: 'shown',
    sections: requests.some((request) => request.placement?.snap === 'home') ? ref('laneSectionsOf') : {},
    fixed: {},
    framed: Object.fromEntries(requests.map((request) => [request.id, true])),
    ...over,
  });

  // ── The seated layout: every scenario, every whole-layout question ──────────
  for (const { name, requests, touched, viewports = ONLY_DESKTOP } of scenarios)
    for (const [vname, viewport] of viewports) {
      seated(requests, viewport, touched, `${name}${vname}`);
      add(undefined, 'resolveDocks', [resolving(requests)]);
      add(undefined, 'edgeLaneLayout', [ref('requests'), ref('viewport'), ref('chrome'), ref('touched')]);
      add(undefined, 'contentInset', [ref('requests'), ref('viewport')]);
      add(undefined, 'coveredInset', [ref('requests'), ref('viewport')]);
      if (!requests.length) continue;
      if (viewport === desktop)
        add(undefined, 'panelFramesOf', [
          {
            geometry: ref('resolveDocks'),
            edges: { left: 'flush', right: 'none', bottom: 'flush' },
            requests: ref('requests'),
            laneFrames: { main: 'none' },
            declared: { [requests[0].id]: 'window' },
          },
        ]);
      // The snap targets free to the first panel carried off — as a tab, and as itself.
      const first = requests[0].id;
      const moment = (moving: string, carryingTab: boolean) => ({
        requests: ref('requests'),
        moving,
        seat: [],
        hidden: ref('seatLanes.hidden'),
        viewport: ref('viewport'),
        carryingTab,
        chrome: ref('chrome'),
      });
      add(`${first} carried as a tab`, 'dragSnapTargets', [moment(first, true)]);
      if (drags[name]) add(`${first} carried itself`, 'dragSnapTargets', [moment(first, false)]);

      // A drag over it: every panel's box as the shell measures it, what each carried box is offered,
      // and which offer a pointer at its centre means.
      const drag = viewport === desktop ? drags[name] : undefined;
      if (!drag) continue;
      for (const request of requests)
        add(
          undefined,
          'rectOf',
          [ref(`resolveDocks.${request.id}`), ref('viewport'), request.placement ?? card()],
          `box ${request.id}`,
        );
      const boxes = Object.fromEntries(requests.map((request) => [request.id, ref(`box ${request.id}`)]));
      const moves: [string, string, Rect | null][] = [
        ...drag.moves,
        ...(drag.stackFor
          ? [
              [`${drag.stackFor} carried over the cards it could stack onto`, drag.stackFor, null] as [
                string,
                string,
                null,
              ],
            ]
          : []),
      ];
      for (const [label, moving, carried] of moves) {
        add(
          label,
          'dragDropSlots',
          [{ ...moment(moving, false), boxes, inset: drag.inset, carried, homes: [] }],
          `slots ${label}`,
        );
        if (carried)
          add(`${label}, the pointer at its centre`, 'dragTarget', [
            {
              ...moment(moving, false),
              slots: ref(`slots ${label}`),
              pointer: { x: carried.x + carried.w / 2, y: carried.y + carried.h / 2 },
              rect: carried,
            },
          ]);
      }
    }

  begin('a panel carried that is not there', {
    requests: scenario('two sidebars sharing a left band, and a card on the right').requests,
  });
  add(undefined, 'dragSnapTargets', [
    { requests: ref('requests'), moving: 'gone', seat: [], hidden: {}, viewport: desktop, carryingTab: true, chrome },
  ]);
  add(undefined, 'dragDropSlots', [
    {
      requests: ref('requests'),
      moving: null,
      seat: [],
      hidden: {},
      viewport: desktop,
      carryingTab: false,
      chrome,
      boxes: {},
      inset: NONE,
      carried: null,
      homes: [],
    },
  ]);

  // ── The seated layout: what a moment adds on top of the arrangement ─────────
  {
    const laneMove = (closing: boolean, ids: string[]) => ({
      ids,
      closing,
      faded: true,
      sizes: { [ids[0]]: { width: 360, height: 400 } },
    });
    const stowed = scenario('a lane put away on the left, a band along the bottom, a panel maximised');
    seated(stowed.requests, desktop, stowed.touched, `${stowed.name}, as the lane is put away`);
    add('a lane shrinking onto its strip, another panel settling', 'resolveDocks', [
      resolving(stowed.requests, { laneMove: laneMove(true, ['s1', 's2']), settling: 'b' }),
    ]);
    const open = scenario('two sidebars sharing a left band, and a card on the right');
    seated(open.requests, desktop, open.touched, `${open.name}, in motion`);
    add('a lane opening out of its strip, a drag pulling it past the threshold, a tab landing', 'resolveDocks', [
      resolving(open.requests, { laneMove: laneMove(false, ['a', 'b']), stowPending: 'a', landedTab: 'b' }),
    ]);
    for (const away of ['leaving', 'away', 'arriving'] as const)
      add(`every panel ${away}`, 'resolveDocks', [resolving(open.requests, { away })]);
    add('panels the host does not frame in a lane', 'resolveDocks', [resolving(open.requests, { framed: {} })]);
    const home = scenario('sections at home in a template lane');
    seated(home.requests, desktop, home.touched, `${home.name}, while every panel is away`);
    add('one section fixed', 'resolveDocks', [
      resolving(home.requests, { fixed: { 'template:feed': true }, away: 'away' }),
    ]);
    add('a section the lane still lists after its panel has gone', 'resolveDocks', [
      resolving(home.requests, {
        sections: {
          main: [
            { id: 'template:gone', open: true, order: 0 },
            { id: 'template:feed', open: true, order: 0 },
          ],
        },
      }),
    ]);
  }

  // ── What a template lane holds ──────────────────────────────────────────────
  begin('a template’s lanes');
  add('declared order breaks ties, instances follow their panel, one away', 'laneSectionsOf', [
    {
      requests: [
        ...scenario('sections at home in a template lane').requests,
        dock('template:chat~x', card({ snap: 'home', home: 'main', order: 1 })),
        dock('template:chat~y', card({ snap: 'home', home: 'main', order: 1 })),
        dock('template:shut', card({ snap: 'home', home: 'side' }), { edge: null }),
        dock('template:free', card({ snap: 'home', home: 'side' })),
      ],
      homes: { 'template:away': 'main' },
      declared: ['template:info', 'template:chat', 'template:feed'],
      instances: {
        'template:chat~x': { of: 'template:chat', opened: 20 },
        'template:chat~y': { of: 'template:chat', opened: 10 },
      },
    },
  ]);

  // ── The chrome the content and the rail clear ───────────────────────────────
  begin('the chrome');
  add('nothing at the top', 'railBand', [desktop, NONE, { height: 0, width: 0 }]);
  add('a call bar under the rail', 'railBand', [desktop, NONE, { height: 120, width: 1400 }]);
  add('a call bar clear of the rail', 'railBand', [desktop, { ...NONE, right: 400 }, { height: 120, width: 200 }]);
  add('an app with no rail', 'railBand', [{ ...desktop, frame: noRail }, NONE, { height: 120, width: 1400 }]);
  add('more covered than the chrome', 'withChromeCovered', [
    { ...NONE, bottom: 200, top: 10 },
    { top: 40, bottom: 74 },
  ]);

  // ── Where one panel is placed ───────────────────────────────────────────────
  begin('where one panel is placed');
  for (const edge of [...EDGES, null] as const)
    for (const size of ['sm', 'md', 'lg', 'full'] as const)
      add(`the opening bid for ${edge} ${size}`, 'resolvePlacement', [
        { request: { id: 'p', edge, size, float: false }, viewport: desktop },
      ]);
  for (const [label, viewport] of [
    ['narrow', narrow],
    ['wide', wide],
  ] as const)
    for (const edge of EDGES)
      add(`the opening bid for ${edge} lg, ${label}`, 'resolvePlacement', [
        { request: { id: 'p', edge, size: 'lg', float: false }, viewport },
      ]);
  add('a floating bid', 'resolvePlacement', [
    { request: { id: 'p', edge: 'left', size: 'md', float: true }, viewport: narrow },
  ]);
  for (const declared of [
    { snap: 'left', displace: true, band: 1, order: 2, size: 'lg' },
    { home: 'side', order: 0, tab: 1, grow: 2 },
    { snap: 'bottom-right', box: { width: 480, height: 320 } },
    { snap: 'top-left', displace: true },
    { snap: 'bottom', size: 'sm', box: { width: 5000 } },
    {},
  ])
    add(`declared ${JSON.stringify(declared)}`, 'resolvePlacement', [
      { declared, request: { id: 'p', edge: 'right', size: 'md', float: false }, viewport: desktop },
    ]);
  add('what the reader last put it at beats the declaration', 'resolvePlacement', [
    {
      disposition: card({ snap: 'top-left' }),
      declared: { snap: 'left' },
      request: { id: 'p', edge: 'right', size: 'md', float: false },
      viewport: desktop,
    },
  ]);
  add('a disposition into a lane the declaration does not home it in is refused', 'resolvePlacement', [
    {
      disposition: card({ snap: 'home', home: 'main' }),
      declared: { snap: 'left' },
      request: { id: 'p', edge: 'right', size: 'md', float: false },
      viewport: desktop,
    },
  ]);
  add('a disposition home with no declaration falls to the bid', 'resolvePlacement', [
    {
      disposition: card({ snap: 'home', home: 'main' }),
      request: { id: 'p', edge: 'bottom', size: 'sm', float: false },
      viewport: desktop,
    },
  ]);
  add('a disposition home where the declaration homes it', 'resolvePlacement', [
    {
      disposition: card({ snap: 'home', home: 'side', order: 2 }),
      declared: { home: 'main' },
      request: { id: 'p', edge: 'right', size: 'md', float: false },
      viewport: desktop,
    },
  ]);

  // ── A panel fitted to its content ───────────────────────────────────────────
  begin('a panel fitted to its content');
  for (const [label, placement, aspect, options] of [
    ['a free 16:9 card', card({ snap: null }), { ratio: 16 / 9 }, { spanning: false }],
    ['a docked side panel', card({ displace: true }), { ratio: 16 / 9, insetY: 40 }, { spanning: true, edge: 'right' }],
    [
      'a docked bottom panel',
      card({ snap: 'bottom', displace: true }),
      { ratio: 4 / 3 },
      { spanning: true, edge: 'bottom', chrome: { x: 2, y: 40 } },
    ],
    [
      'a fit past the most a dock may take',
      card({ displace: true, h: 2000 }),
      { ratio: 0.2 },
      { spanning: true, edge: 'right', maxThickness: 400 },
    ],
    [
      'a bottom fit past the most a dock may take',
      card({ snap: 'bottom', displace: true, w: 3000 }),
      { ratio: 8 },
      { spanning: true, edge: 'bottom', maxThickness: 200 },
    ],
    ['an aspect that is no ratio', card(), { ratio: 0 }, { spanning: false }],
    [
      'chrome larger than the card',
      card({ w: 20, h: 20 }),
      { ratio: 1 },
      { spanning: false, chrome: { x: 40, y: 40 } },
    ],
  ] as const)
    add(label, 'fitPlacement', [placement, aspect, options]);

  // ── The arrangement written back as a declaration ───────────────────────────
  begin('an arrangement saved into the template');
  for (const [label, placement] of [
    ['at home', card({ snap: 'home', home: 'side', order: 1, tab: 0, grow: 2 })],
    ['snapped and pushing aside', card({ snap: 'left', displace: true, band: 1, order: 0 })],
    ['free', card({ snap: null })],
  ] as const)
    add(label, 'arrangedPanel', [
      { id: 'notes', title: 'Notes', snap: 'right', order: 4, size: 'md', min: { width: 200 } },
      placement,
    ]);

  // ── During a drag: the snaps offered, and the one a card is over ────────────
  {
    const mover = dock('mover', card({ snap: null }));
    const aside = dock('aside', card({ snap: 'right', displace: true, w: 300 }));
    const carrying = (requests: DockRequest[], viewport: Viewport, over: Record<string, unknown> = {}) => ({
      requests,
      moving: 'mover',
      seat: [],
      hidden: {},
      viewport,
      carryingTab: false,
      chrome,
      ...over,
    });
    begin('a card carried over the snaps');
    add('the eight', 'dragSnapTargets', [carrying([mover], desktop)]);
    add('beside a sidebar, narrow', 'dragSnapTargets', [carrying([mover, aside], narrow)]);
    add('a squeezed region under a top bar', 'dragSnapTargets', [
      carrying(
        [
          mover,
          dock('l', card({ snap: 'left', displace: true, w: 300 })),
          dock('r', card({ snap: 'right', displace: true, w: 300 })),
        ],
        { ...narrow, frame: topBar },
      ),
    ]);
    add('between drags, every snap but the ones held', 'dragSnapTargets', [
      carrying([mover, dock('held', card({ snap: 'top-left' }))], desktop, { moving: null }),
    ]);
    const aimed = (rect: Rect, pointer: { x: number; y: number }, requests: DockRequest[] = [mover], slots = []) => [
      { ...carrying(requests, desktop), slots, pointer, rect },
    ];
    for (const [label, rect] of [
      ['over the top-right target', { x: 1100, y: 10, w: 300, h: 200 }],
      ['in the middle of the screen', { x: 600, y: 350, w: 200, h: 200 }],
      ['over the left edge', { x: 40, y: 360, w: 200, h: 200 }],
      ['tall across a corner and an edge centre', { x: 1100, y: 300, w: 300, h: 600 }],
    ] as const) {
      add(label, 'dragTarget', aimed(rect, { x: rect.x + 10, y: rect.y + 10 }));
      add(`${label}, the pointer off the card`, 'dragTarget', aimed(rect, { x: 720, y: 450 }));
    }
    {
      const corner = snapTargetRects(desktop, NONE, chrome).find((target) => target.id === 'bottom-left')!;
      add(
        'the pointer on a corner’s target, the card across an edge centre',
        'dragTarget',
        aimed({ x: corner.x, y: 300, w: 300, h: 600 }, { x: corner.x + corner.w / 2, y: corner.y + corner.h / 2 }),
      );
      add(
        'the corner another card holds',
        'dragTarget',
        aimed(
          { x: corner.x, y: corner.y, w: 300, h: 200 },
          { x: corner.x + corner.w / 2, y: corner.y + corner.h / 2 },
          [mover, dock('held', card({ snap: 'bottom-left' }))],
        ),
      );
    }
    begin('the snaps a drop is refused: a hidden card, one pushing aside, one at home, one maximised', {
      requests: [
        dock('a', card({ snap: 'top-left' })),
        dock('b', card({ snap: 'top' })),
        dock('c', card({ snap: 'left', displace: true })),
        dock('d', card({ snap: 'home', home: 'side' })),
        dock('e', card({ snap: 'right', maximised: true })),
        dock('f', card({ snap: 'bottom' })),
        dock('g', card({ snap: 'bottom-left' }), { size: 'full' }),
      ],
    });
    add('carrying the one at the bottom', 'dragSnapTargets', [
      {
        requests: ref('requests'),
        moving: 'f',
        seat: [],
        hidden: { b: true },
        viewport: desktop,
        carryingTab: false,
        chrome,
      },
    ]);
    add('carrying it with the one at the top as its mate', 'dragSnapTargets', [
      {
        requests: ref('requests'),
        moving: 'f',
        seat: ['a'],
        hidden: {},
        viewport: desktop,
        carryingTab: false,
        chrome,
      },
    ]);
  }

  // ── During a drag: the edge slots, stacks and home lanes offered ────────────
  begin('a drag over boxes the host did not measure', {
    requests: scenario('two sidebars sharing a left band, and a card on the right').requests,
  });
  const offered = (over: Record<string, unknown>) => ({
    requests: ref('requests'),
    moving: 'c',
    seat: [],
    hidden: {},
    viewport: desktop,
    carryingTab: false,
    chrome,
    boxes: {},
    inset: { ...NONE, left: 300 },
    carried: { x: 60, y: 300, w: 360, h: 300 },
    homes: [],
    ...over,
  });
  add('a card carried to the left band', 'dragDropSlots', [offered({})]);
  add('no card to stack onto, nothing carried', 'dragDropSlots', [offered({ carried: null })]);

  begin('a panel carried over a template’s lanes', {
    requests: [dock('carried', card({ snap: null, x: 100, y: 250, w: 200, h: 200 }))],
  });
  const overLanes = (carried: Rect, homes: unknown[]) => [
    {
      requests: ref('requests'),
      moving: 'carried',
      seat: [],
      hidden: {},
      viewport: desktop,
      carryingTab: false,
      chrome,
      boxes: {},
      inset: NONE,
      carried,
      homes,
    },
  ];
  add(
    'a column lane of two',
    'dragDropSlots',
    overLanes({ x: 100, y: 250, w: 200, h: 200 }, [
      {
        lane: 'side',
        direction: 'column',
        sections: [
          { x: 0, y: 0, w: 300, h: 200 },
          { x: 0, y: 200, w: 300, h: 300 },
        ],
        box: { x: 0, y: 0, w: 300, h: 600 },
      },
    ]),
  );
  add(
    'a column lane, the panel carried nowhere near it',
    'dragDropSlots',
    overLanes({ x: 900, y: 300, w: 200, h: 200 }, [
      {
        lane: 'side',
        direction: 'column',
        sections: [{ x: 0, y: 0, w: 300, h: 200 }],
        box: { x: 0, y: 0, w: 300, h: 600 },
      },
    ]),
  );
  add(
    'a row lane of one',
    'dragDropSlots',
    overLanes({ x: 1020, y: 100, w: 200, h: 200 }, [
      {
        lane: 'main',
        direction: 'row',
        sections: [{ x: 0, y: 0, w: 500, h: 600 }],
        box: { x: 0, y: 0, w: 1000, h: 600 },
      },
    ]),
  );
  add(
    'an empty, collapsed lane',
    'dragDropSlots',
    overLanes({ x: 40, y: 40, w: 200, h: 200 }, [
      { lane: 'side', direction: 'column', sections: [], box: { x: 10, y: 10, w: 0, h: 0 } },
    ]),
  );

  // ── During a drag: which offer the pointer means ────────────────────────────
  begin('the offer a pointer means', { requests: [dock('mover', card({ snap: null }))] });
  {
    const slot = (mode: string, hit: Rect, key: string) => ({
      mode,
      hit,
      key,
      index: 0,
      edge: '',
      lane: '',
      top: '',
      left: '',
      width: '',
      height: '',
    });
    const hits = [
      slot('band', { x: 0, y: 0, w: 20, h: 900 }, 'band:left::0'),
      slot('lane', { x: 0, y: 400, w: 300, h: 20 }, 'lane:left:0:1'),
      slot('tab', { x: 0, y: 0, w: 300, h: 400 }, 'tab:left:0:0'),
      slot('home', { x: 0, y: 600, w: 300, h: 20 }, 'home:side::0'),
    ];
    const pointing = (slots: unknown[], pointer: { x: number; y: number }, rect: Rect) => [
      {
        requests: ref('requests'),
        moving: 'mover',
        seat: [],
        hidden: {},
        viewport: desktop,
        carryingTab: false,
        chrome,
        slots,
        pointer,
        rect,
      },
    ];
    add(
      'the pointer inside two, the smaller wins',
      'dragTarget',
      pointing(hits, { x: 10, y: 405 }, { x: 0, y: 380, w: 300, h: 300 }),
    );
    add(
      'the pointer in none, the card covering a line and a region',
      'dragTarget',
      pointing(hits, { x: 600, y: 600 }, { x: 0, y: 380, w: 300, h: 300 }),
    );
    add(
      'the pointer in none, the card covering two lines',
      'dragTarget',
      pointing(hits, { x: 600, y: 600 }, { x: 100, y: 410, w: 300, h: 200 }),
    );
    add('nothing under it', 'dragTarget', pointing(hits, { x: 900, y: 600 }, { x: 800, y: 500, w: 40, h: 40 }));
    // Against the snaps: a slot in the corner the top-left target sits in, and one beside it.
    const corner = snapTargetRects(desktop, NONE, chrome).find((target) => target.id === 'top-left')!;
    const inCorner = slot('lane', { x: corner.x + 4, y: corner.y + 4, w: 10, h: 10 }, 'lane:left:0:0');
    const besideCorner = slot('lane', { x: corner.x + corner.w + 200, y: corner.y, w: 10, h: 10 }, 'lane:left:0:2');
    const overCorner = { x: corner.x, y: corner.y, w: 200, h: 150 };
    const atCorner = { x: corner.x + 8, y: corner.y + 8 };
    add('a snap, no slot', 'dragTarget', pointing([], atCorner, overCorner));
    add('the pointer in the snap only', 'dragTarget', pointing([besideCorner], atCorner, overCorner));
    add('the pointer in both, the slot smaller', 'dragTarget', pointing([inCorner], atCorner, overCorner));
    add('a slot, the pointer off every snap', 'dragTarget', pointing([inCorner], { x: 720, y: 450 }, overCorner));
  }

  // ── What a drop writes ──────────────────────────────────────────────────────
  {
    begin('a drop onto an edge', {
      panels: laneable(scenario('two sidebars sharing a left band, and a card on the right').requests, desktop),
      viewport: desktop,
    });
    for (const [label, moving, target] of [
      ['a new lane outboard of the left band', 2, { edge: 'left', mode: 'band', position: 0 }],
      ['a new lane inboard of it', 2, { edge: 'left', mode: 'band', position: 1 }],
      ['a seat in the left band', 2, { edge: 'left', mode: 'lane', position: 1, lane: 0 }],
      ['a tab behind the first seat', 2, { edge: 'left', mode: 'tab', position: 0, lane: 0 }],
      ['the floating lane on the right', 0, { edge: 'right', mode: 'lane', position: 0, lane: 'float' }],
      ['a tab in the floating lane', 0, { edge: 'right', mode: 'tab', position: 0, lane: 'float' }],
      ['a seat in a lane that is not there', 2, { edge: 'left', mode: 'lane', position: 0, lane: 4 }],
      ['an empty edge', 1, { edge: 'bottom', mode: 'band', position: 0 }],
    ] as const)
      add(label, 'arrangeDrop', [ref('panels'), moving, target, ref('viewport')]);
    add('joining an unnamed lane names it', 'arrangeDrop', [
      laneable(
        [
          dock('u1', card({ snap: 'left', displace: true })),
          dock('u2', card({ snap: 'left', displace: true })),
          dock('u3', card()),
        ],
        desktop,
      ),
      2,
      { edge: 'left', mode: 'lane', position: 1, lane: 0 },
      ref('viewport'),
    ]);
    add('a tab into a seat of a stack', 'arrangeDrop', [
      laneable(scenario('a stack of two tabs on the right, and a card along the top').requests, desktop),
      2,
      { edge: 'right', mode: 'tab', position: 0, lane: 0 },
      ref('viewport'),
    ]);
    begin('a drop into a template’s lane', {
      panels: laneable(scenario('sections at home in a template lane').requests, desktop),
    });
    add('into a home lane between two', 'arrangeHomeDrop', [ref('panels'), 3, 'main', 1]);
    add('into an empty home lane', 'arrangeHomeDrop', [ref('panels'), 0, 'side', 0]);
    add('moving within its own home lane', 'arrangeHomeDrop', [ref('panels'), 0, 'main', 2]);
  }
  begin('a drop onto a snap', {
    requests: scenario('cards in open space: a column of two, a corner, a loose stack, one closed, one full').requests,
  });
  const dropping = (moving: string, seat: string[] = []) => ({ requests: ref('requests'), moving, seat });
  add('after the cards on the edge', 'snapDrop', [dropping('l1'), card({ snap: null }), 'right']);
  add('keeping the seat it held', 'snapDrop', [dropping('r2'), card({ snap: 'right', order: 1 }), 'right']);
  add('its seat taken, after the last', 'snapDrop', [dropping('l1'), card({ snap: null, order: 0 }), 'right']);
  add('an edge nobody holds, the loose seat key dropped', 'snapDrop', [
    dropping('l1', ['x']),
    card({ snap: null, seat: 'loose', displace: true }),
    'left',
  ]);
  add('to a corner', 'snapDrop', [
    dropping('l1'),
    card({ band: 0, order: 1, tab: 0, seat: 's', stowed: true, displace: true }),
    'top-left',
  ]);
  add('to a corner with its stack', 'snapDrop', [dropping('l1', ['m']), card({ snap: null, seat: 's' }), 'top-left']);
  {
    const open = scenario('cards in open space: a column of two, a corner, a loose stack, one closed, one full');
    begin('a drop onto another card', {
      requests: open.requests,
      hidden: seatLanes({ requests: open.requests, viewport: desktop, chrome, touched: open.touched, titles }).hidden,
    });
    const onto = { requests: ref('requests'), hidden: ref('hidden'), viewport: desktop };
    add('the corner card onto a stack, which keeps its seat', 'stackDrop', [onto, 'corner', 0]);
    add('a card no stack is offered past the last', 'stackDrop', [onto, 'corner', 1]);
    add('a card that is not there', 'stackDrop', [onto, 'gone', 0]);
    add('two cards nobody has placed, each seeded', 'stackDrop', [
      {
        requests: [
          dock('bare', null, { edge: 'right', float: true }),
          dock('joiner', null, { edge: 'left', float: true }),
        ],
        hidden: {},
        viewport: desktop,
      },
      'joiner',
      0,
    ]);
    add('two loose cards, the one landed on naming the seat', 'stackDrop', [
      {
        requests: [
          dock('p', card({ snap: null, x: 100 })),
          dock('q', card({ snap: null, x: 800, tab: 3 })),
          dock('seedless', null, { float: true }),
        ],
        hidden: {},
        viewport: desktop,
      },
      'q',
      0,
    ]);
  }
  begin('a stack’s mates following it');
  add('to an edge', 'followSeat', [
    card({ snap: null, seat: 'x', tab: 1, w: 200 }),
    card({ snap: 'left', displace: true, band: 1, order: 2 }),
  ]);
  add('into open space', 'followSeat', [card({ tab: 2 }), card({ snap: null, seat: 'x', x: 50, y: 60 })]);
  add('home', 'followSeat', [card(), card({ snap: 'home', home: 'side', order: 0 })]);
  add('taking the seat’s size', 'seatSize', [
    card({ w: 200, h: 200, thicknessX: 100 }),
    card({ w: 500, h: 600, thicknessY: 300 }),
  ]);
  add('taking a seat with no thickness of its own', 'seatSize', [card({ thicknessX: 100 }), card({ w: 500 })]);

  // ── Gestures: a resize, a boundary between seats, a card pulled off ─────────
  begin('a resize');
  for (const [label, side, dx, dy] of [
    ['the left edge out', 'left', -60, 0],
    ['the right edge in, past the floor', 'right', -400, 0],
    ['the top edge up', 'top', 0, -40],
    ['the top edge pulled past the floor', 'top', 0, 400],
    ['the bottom edge down', 'bottom', 0, 90],
    ['a corner', 'bottom-right', 30, 50],
    ['the top-left corner past both floors', 'top-left', 500, 500],
  ] as const)
    add(label, 'resizedBox', [{ x: 200, y: 100, w: 360, h: 420 }, side, dx, dy, { w: 200, h: 120 }]);
  begin('the boundary between two seats moved');
  add('down', 'movedBoundary', [{ top: 300, bottom: 400 }, 80, { top: 120, bottom: 120 }]);
  add('past the lower floor', 'movedBoundary', [{ top: 300, bottom: 400 }, 900, { top: 120, bottom: 120 }]);
  add('past the upper floor', 'movedBoundary', [{ top: 300, bottom: 400 }, -900, { top: 120, bottom: 120 }]);
  add('floors larger than the room', 'movedBoundary', [{ top: 100, bottom: 100 }, 10, { top: 150, bottom: 150 }]);
  begin('a panel pulled off what it was attached to');
  add('a maximised panel, near its left end', 'liftedCard', [
    card({ maximised: true }),
    { x: 0, y: 0, w: 1440, h: 900 },
    { x: 100, y: 10 },
  ]);
  add('an edge it was pushing aside', 'liftedCard', [
    card({ displace: true }),
    { x: 1080, y: 0, w: 360, h: 900 },
    { x: 1260, y: 12 },
  ]);
  add('a box with no width', 'liftedCard', [card(), { x: 0, y: 0, w: 0, h: 0 }, { x: 50, y: 50 }]);

  return out;
}
