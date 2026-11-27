/**
 * The cases the dock layout's vectors are recorded from: a handful of arrangements, each asked
 * every question that applies to it, and targeted cases for the branches an arrangement does not
 * reach. `recordKernelVectors.ts` runs each through the kernel and writes the answer beside it.
 *
 * A case is `{ name, fn, args, frame? }`: the function, its arguments in order, and the app frame it
 * is asked under (the default one when absent). Arguments are plain JSON, so an optional argument in
 * the middle is never left out — every case passes what it means.
 */
import {
  type AppFrame,
  type ContentInset,
  DEFAULT_APP_FRAME,
  type DockRequest,
  type DockResolution,
  type FloatPlacement,
  laneable,
  laneSectionsOf,
  type Rect,
  rectOf,
  resolveDocks,
  seatLanes,
  type SnapPoint,
  type Viewport,
} from '../src/shared/dockGeometry';

export interface DockLayoutCase {
  name: string;
  fn: string;
  args: unknown[];
  frame?: AppFrame;
  /** Argument positions passed as absent (`undefined`), which JSON cannot hold: each is `null` in `args`. */
  absent?: number[];
}

/** An argument left out, where a later one is given — written `null`, and listed in `absent`. */
const ABSENT = Symbol('absent');

const desktop: Viewport = { width: 1440, height: 900 };
const narrow: Viewport = { width: 800, height: 700 };
const wide: Viewport = { width: 2560, height: 1440 };
const NONE: ContentInset = { left: 0, right: 0, top: 0, bottom: 0 };
const chrome: ContentInset = { left: 0, right: 56, top: 0, bottom: 74 };
const fullChrome: ContentInset = { left: 0, right: 0, top: 0, bottom: 0 };
const topBar: AppFrame = { ...DEFAULT_APP_FRAME, top: 48 };
const noRail: AppFrame = { ...DEFAULT_APP_FRAME, right: 0 };

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
  edge: placement === null ? null : 'right',
  size: 'md',
  float: false,
  ...(placement ? { placement } : {}),
  ...over,
});

/** The arrangements every whole-layout question is asked of. */
const arrangements: { name: string; requests: DockRequest[]; touched: Record<string, number> }[] = [
  { name: 'nothing open', requests: [], touched: {} },
  {
    name: 'one sidebar on the right',
    requests: [dock('notes', card({ displace: true, thicknessX: 380 }))],
    touched: {},
  },
  {
    name: 'two sidebars sharing a left band, and a card on the right',
    requests: [
      dock('a', card({ snap: 'left', displace: true, band: 0, order: 0, h: 300 }), { edge: 'left' }),
      dock('b', card({ snap: 'left', displace: true, band: 0, order: 1, h: 500, grow: 2 }), {
        edge: 'left',
        min: { height: 240 },
      }),
      dock('c', card()),
    ],
    touched: { b: 2 },
  },
  {
    name: 'a stack of two tabs on the right, and a card along the top',
    requests: [
      dock('a', card({ displace: true, band: 0, order: 0, tab: 0 })),
      dock('b', card({ displace: true, band: 0, order: 0, tab: 1 })),
      dock('t', card({ snap: 'top', h: 200 }), { edge: 'top' }),
    ],
    touched: { a: 1, b: 4 },
  },
  {
    name: 'a lane put away on the left, a band along the bottom, a panel maximised',
    requests: [
      dock('s1', card({ snap: 'left', displace: true, band: 0, order: 0, stowed: true }), { edge: 'left' }),
      dock('s2', card({ snap: 'left', displace: true, band: 0, order: 1, stowed: true }), { edge: 'left' }),
      dock('b', card({ snap: 'bottom', displace: true, thicknessY: 240 }), { edge: 'bottom' }),
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
  },
  {
    name: 'two bands on the left, the inner one folded beside an open mate',
    requests: [
      dock('outer', card({ snap: 'left', displace: true, band: 0, order: 0 }), { edge: 'left' }),
      dock('in1', card({ snap: 'left', displace: true, band: 1, order: 0, collapsed: true }), { edge: 'left' }),
      dock('in2', card({ snap: 'left', displace: true, band: 1, order: 1 }), { edge: 'left' }),
      dock('top', card({ snap: 'top', displace: true, thicknessY: 160 }), { edge: 'top' }),
    ],
    touched: {},
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
];

const titles = { a: 'Notes', b: 'Transcript', 'template:chat': 'Chat' };

const boxesOf = (requests: DockRequest[], viewport: Viewport): Record<string, Rect> => {
  const seating = seatLanes({ requests, viewport, chrome, touched: {}, titles: {} });
  const geometry = resolveDocks(resolution(requests, viewport, {}, seating));
  return Object.fromEntries(
    requests.map((request) => [request.id, rectOf(geometry[request.id], viewport, request.placement ?? card())]),
  );
};

const resolution = (
  requests: DockRequest[],
  viewport: Viewport,
  touched: Record<string, number>,
  seating: ReturnType<typeof seatLanes>,
  over: Partial<DockResolution> = {},
): DockResolution => ({
  requests,
  seating,
  viewport,
  chrome,
  fullScreenChrome: fullChrome,
  touched,
  titles,
  settling: '',
  landedTab: '',
  laneMove: null,
  stowPending: null,
  away: 'shown' as const,
  sections: laneSectionsOf({ requests, homes: {}, declared: requests.map((request) => request.id), instances: {} }),
  fixed: {},
  framed: Object.fromEntries(requests.map((request) => [request.id, true])),
  ...over,
});

const EDGES = ['left', 'right', 'top', 'bottom'] as const;
const SNAPS: SnapPoint[] = ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left'];

export function dockLayoutCases(): DockLayoutCase[] {
  const cases: DockLayoutCase[] = [];
  const add = (name: string, fn: string, args: unknown[], frame?: AppFrame) => {
    const absent = args.flatMap((arg, index) => (arg === ABSENT ? [index] : []));
    cases.push({
      name: `${fn}: ${name}`,
      fn,
      args: args.map((arg) => (arg === ABSENT ? null : arg)),
      ...(frame ? { frame } : {}),
      ...(absent.length ? { absent } : {}),
    });
  };

  // ── Every arrangement, every whole-layout question ──────────────────────────
  for (const { name, requests, touched } of arrangements) {
    for (const [vname, viewport] of [
      ['', desktop],
      [' (narrow)', narrow],
    ] as const) {
      const label = `${name}${vname}`;
      add(label, 'laneable', [requests, viewport]);
      add(label, 'contentInset', [requests, viewport]);
      add(label, 'coveredInset', [requests, viewport]);
      add(label, 'displacingLanes', [requests, viewport]);
      add(label, 'coveringLanes', [requests, viewport, chrome]);
      add(label, 'edgeLaneLayout', [requests, viewport, chrome, touched]);
      const seatingInput = { requests, viewport, chrome, touched, titles };
      add(label, 'seatLanes', [seatingInput]);
      const seating = seatLanes(seatingInput);
      add(label, 'resolveDocks', [resolution(requests, viewport, touched, seating)]);
      // Per panel, and the frames, on the wide window only: the narrow one adds no branch they take.
      if (viewport === desktop)
        requests.forEach((request, index) => {
          add(`${label}, ${request.id}`, 'occupiedFor', [requests, index, viewport]);
          add(`${label}, ${request.id}`, 'resolveDock', [request, viewport, NONE, chrome]);
        });
      if (requests.length) {
        add(`${label}, a tab carried out`, 'occupiedById', [requests, requests[0].id, viewport, true]);
        add(`${label}, staying`, 'occupiedById', [requests, requests[0].id, viewport, false]);
      }
      const panels = laneable(requests, viewport);
      for (const edge of EDGES) add(`${label}, ${edge}`, 'edgeGroups', [panels, edge, viewport]);
      add(label, 'looseSeats', [panels]);
      add(label, 'stackCandidates', [requests, seating.hidden, requests[0]?.id ?? null]);
      add(label, 'takenSnapsOf', [requests, seating.hidden, requests.slice(0, 1).map((request) => request.id)]);
      add(label, 'layerOrder', [requests.map((request) => request.id), touched]);
      const geometry = resolveDocks(resolution(requests, viewport, touched, seating));
      if (viewport === desktop)
        add(label, 'panelFramesOf', [
          {
            geometry,
            edges: { left: 'flush', right: 'none' },
            requests,
            laneFrames: { main: 'none' },
            declared: requests[0] ? { [requests[0].id]: 'window' } : {},
          },
        ]);
    }
  }

  // ── resolveDocks: what a moment adds on top of the arrangement ──────────────
  {
    const { requests, touched } = arrangements[4];
    const seating = seatLanes({ requests, viewport: desktop, chrome, touched, titles });
    const laneMove = (closing: boolean) => ({
      ids: ['s1', 's2'],
      closing,
      faded: true,
      sizes: { s1: { width: '360px', height: '400px' } },
    });
    add('a lane shrinking onto its strip', 'resolveDocks', [
      resolution(requests, desktop, touched, seating, { laneMove: laneMove(true), settling: 'b' }),
    ]);
    const open = arrangements[2];
    const openSeating = seatLanes({ ...open, viewport: desktop, chrome, titles });
    add('a lane opening out of its strip, a drag pulling it past the threshold', 'resolveDocks', [
      resolution(open.requests, desktop, open.touched, openSeating, {
        laneMove: { ...laneMove(false), ids: ['a', 'b'] },
        stowPending: 'a',
        landedTab: 'b',
      }),
    ]);
    for (const away of ['leaving', 'away', 'arriving'])
      add(`every panel ${away}`, 'resolveDocks', [
        resolution(open.requests, desktop, open.touched, openSeating, { away: away as DockResolution['away'] }),
      ]);
    const home = arrangements[7];
    const homeSeating = seatLanes({ ...home, viewport: desktop, chrome, titles });
    add('a template lane, its second seat a stack, one section fixed', 'resolveDocks', [
      resolution(home.requests, desktop, home.touched, homeSeating, {
        fixed: { 'template:feed': true },
        away: 'away',
      }),
    ]);
    const two = [dock('m1', card({ snap: null, maximised: true })), dock('m2', card({ snap: null, maximised: true }))];
    add('two maximised, the one on top wins', 'resolveDocks', [
      resolution(two, desktop, { m1: 3 }, seatLanes({ requests: two, viewport: desktop, chrome, touched: {}, titles })),
    ]);
    const right = [dock('r', card({ snap: 'right', displace: true, stowed: true }))];
    const bottom = [dock('bt', card({ snap: 'bottom', displace: true, stowed: true }), { edge: 'bottom' })];
    for (const stowed of [right, bottom])
      add(`a ${stowed[0].id} lane put away`, 'resolveDocks', [
        resolution(
          stowed,
          desktop,
          {},
          seatLanes({ requests: stowed, viewport: desktop, chrome, touched: {}, titles }),
        ),
      ]);
  }

  // ── laneSectionsOf ──────────────────────────────────────────────────────────
  {
    const home = arrangements[7].requests;
    add('declared order breaks ties, instances follow their panel, one away', 'laneSectionsOf', [
      {
        requests: [
          ...home,
          dock('template:chat~x', card({ snap: 'home', home: 'main', order: 1 })),
          dock('template:chat~y', card({ snap: 'home', home: 'main', order: 1 })),
          dock('template:shut', card({ snap: 'home', home: 'side' }), { edge: null }),
        ],
        homes: { 'template:away': 'main' },
        declared: ['template:info', 'template:chat', 'template:feed'],
        instances: {
          'template:chat~x': { of: 'template:chat', opened: 20 },
          'template:chat~y': { of: 'template:chat', opened: 10 },
        },
      },
    ]);
  }

  // ── One panel ───────────────────────────────────────────────────────────────
  for (const edge of [...EDGES, null] as const)
    for (const size of ['sm', 'md', 'lg', 'full'] as const) {
      add(`${edge} ${size}`, 'seedPlacement', [{ id: 'p', edge, size, float: false }, desktop]);
      if (edge) add(`${edge} ${size}`, 'dockThickness', [edge, size, desktop, 0, NONE]);
    }
  add('a floating bid', 'seedPlacement', [{ id: 'p', edge: 'left', size: 'md', float: true }, narrow]);
  add('resized to 420, beside a sidebar', 'dockThickness', ['right', 'md', desktop, 420, { ...NONE, right: 300 }]);
  add('on a narrow window', 'dockThickness', ['left', 'lg', narrow, 0, NONE]);
  add('on a wide window', 'dockThickness', ['bottom', 'lg', wide, 0, NONE]);
  for (const declared of [
    { snap: 'left', displace: true, band: 1, order: 2, size: 'lg' },
    { home: 'side', order: 0, tab: 1, grow: 2 },
    { snap: 'bottom-right', box: { width: 480, height: 320 } },
    {},
  ])
    add(JSON.stringify(declared), 'placementFromDeclaration', [declared, desktop, NONE]);
  for (const placement of [card({ displace: true }), card({ snap: 'top-left', displace: true }), card()])
    for (const viewport of [desktop, narrow])
      add(`${placement.snap}${placement.displace ? ' displacing' : ''} at ${viewport.width}`, 'displaces', [
        placement,
        viewport,
      ]);
  for (const edge of EDGES) {
    add(`${edge}, stored`, 'thicknessOf', [card({ thicknessX: 300, thicknessY: 180 }), edge]);
    add(`${edge}, from the card`, 'thicknessOf', [card(), edge]);
    add(edge, 'stripBox', [edge, desktop, { ...NONE, left: 200 }]);
    add(edge, 'edgeLaneBox', [edge, { left: 300, right: 200, top: 100, bottom: 50 }]);
    add(`${edge} under a top bar`, 'edgeLaneBox', [edge, NONE], topBar);
    add(edge, 'edgeZone', [edge, desktop, 0]);
    add(`${edge}, a lane already there`, 'edgeZone', [edge, desktop, 320]);
    add(`${edge}, far`, 'nearEdge', [{ x: 600, y: 300, w: 200, h: 200 }, edge, desktop, 0]);
    add(`${edge}, against it`, 'nearEdge', [{ x: 1300, y: 760, w: 120, h: 120 }, edge, desktop, 0]);
  }
  for (const snap of [...SNAPS, 'home', null]) add(String(snap), 'edgeOfSnap', [snap]);
  for (const snap of SNAPS) {
    add(snap, 'snapOrigin', [snap, 360, 420, desktop, NONE, chrome]);
    add(`${snap}, beside a left sidebar`, 'snapOrigin', [snap, 360, 420, desktop, { ...NONE, left: 300 }, chrome]);
  }
  add('a card larger than the room', 'snapOrigin', ['bottom-right', 2000, 2000, narrow, NONE, chrome]);
  add('a card under a top bar', 'snapOrigin', ['top-left', 300, 300, desktop, NONE, chrome], topBar);
  for (const [label, request, occupied, seat] of [
    ['a card at its snap', dock('p', card({ snap: 'top-right' })), NONE, undefined],
    ['a free card dragged off screen', dock('p', card({ snap: null, x: -400, y: 2000 })), NONE, undefined],
    ['a docked card in a seat', dock('p', card({ displace: true })), NONE, { x: 1100, y: 0, w: 340, h: 450 }],
    [
      'a docked bottom panel beside a left one',
      dock('p', card({ snap: 'bottom', displace: true }), { edge: 'bottom' }),
      { ...NONE, left: 300 },
      undefined,
    ],
    ['at home', dock('p', card({ snap: 'home', home: 'side' })), NONE, undefined],
    ['closed', dock('p', null), NONE, undefined],
    ['full size', dock('p', card(), { size: 'full' }), NONE, undefined],
    ['maximised', dock('p', card({ maximised: true })), NONE, undefined],
    ['folded', dock('p', card({ collapsed: true })), NONE, undefined],
    ['with no placement', { id: 'p', edge: 'left', size: 'lg', float: false }, NONE, undefined],
  ] as const)
    for (const viewport of [desktop, narrow])
      add(`${label} at ${viewport.width}`, 'resolveDock', [
        request,
        viewport,
        occupied,
        chrome,
        ...(seat ? [seat] : []),
      ]);
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
  ] as const)
    add(label, 'fitPlacement', [placement, aspect, options]);
  for (const [label, min, axis, spanning, collapsed] of [
    ['nothing declared, a card', undefined, 'w', false, false],
    ['nothing declared, spanning', undefined, 'h', true, false],
    ['a declared width', { width: 300 }, 'w', false, false],
    ['folded', { height: 300 }, 'h', true, true],
  ] as const)
    add(label, 'floorOf', [min ?? ABSENT, axis, spanning, collapsed]);
  for (const [label, box, folded, room] of [
    ['a floating card', { floating: true }, false, false],
    ['a docked panel with room', { floating: false }, false, true],
    ['a lone sidebar', { floating: false }, false, false],
    ['already folded, nowhere to go', { floating: false }, true, false],
    ['maximised', { floating: true, maximised: true }, false, true],
    ['at home', { floating: false, home: true }, false, true],
  ] as const)
    add(label, 'canFold', [box, folded, room]);
  add('a resolved box', 'rectOf', [
    { edge: 'right', floating: false, right: '0px', top: '0px', width: '320px', height: '900px' },
    desktop,
    card(),
  ]);
  add('a box anchored right and bottom', 'rectOf', [
    { edge: 'right', floating: true, right: '56px', bottom: '74px', width: '320px', height: '400px' },
    desktop,
    card(),
  ]);
  add('no box', 'rectOf', [ABSENT, desktop, card({ snap: null, x: 10, y: 20 })]);
  for (const [label, side, dx, dy] of [
    ['the left edge out', 'left', -60, 0],
    ['the right edge in, past the floor', 'right', -400, 0],
    ['the top edge up', 'top', 0, -40],
    ['a corner', 'bottom-right', 30, 50],
    ['the top-left corner past both floors', 'top-left', 500, 500],
  ] as const)
    add(label, 'resizedBox', [{ x: 200, y: 100, w: 360, h: 420 }, side, dx, dy, { w: 200, h: 120 }]);
  add('a boundary moved down', 'movedBoundary', [{ top: 300, bottom: 400 }, 80, { top: 120, bottom: 120 }]);
  add('a boundary pushed past the lower floor', 'movedBoundary', [
    { top: 300, bottom: 400 },
    900,
    { top: 120, bottom: 120 },
  ]);
  add('a boundary pushed past the upper floor', 'movedBoundary', [
    { top: 300, bottom: 400 },
    -900,
    { top: 120, bottom: 120 },
  ]);
  add('floors larger than the room', 'movedBoundary', [{ top: 100, bottom: 100 }, 10, { top: 150, bottom: 150 }]);
  add('pulled off a maximised panel near its left end', 'liftedCard', [
    card({ maximised: true }),
    { x: 0, y: 0, w: 1440, h: 900 },
    { x: 100, y: 10 },
  ]);
  add('pulled off an edge it was pushing aside', 'liftedCard', [
    card({ displace: true }),
    { x: 1080, y: 0, w: 360, h: 900 },
    { x: 1260, y: 12 },
  ]);
  add('a box with no width', 'liftedCard', [card(), { x: 0, y: 0, w: 0, h: 0 }, { x: 50, y: 50 }]);
  for (const [label, placement] of [
    ['at home', card({ snap: 'home', home: 'side', order: 1, tab: 0, grow: 2 })],
    ['snapped and pushing aside', card({ snap: 'left', displace: true, band: 1, order: 0 })],
    ['free', card({ snap: null })],
  ] as const)
    add(label, 'arrangedPanel', [
      { id: 'notes', title: 'Notes', snap: 'right', order: 4, size: 'md', min: { width: 200 } },
      placement,
    ]);

  // ── Lanes and seats ─────────────────────────────────────────────────────────
  const members = [
    card({ snap: 'left', displace: true, band: 0, order: 0, h: 300 }),
    { ...card({ snap: 'left', displace: true, band: 0, order: 1, h: 400, grow: 2 }), min: { height: 260 } },
    card({ snap: 'left', displace: true, band: 0, order: 2, h: 200, collapsed: true }),
  ];
  for (const edge of EDGES) {
    add(`${edge}, displacing`, 'columnLayout', [members, edge, desktop, NONE, chrome, { displacing: true }]);
    add(`${edge}, floating`, 'columnLayout', [
      members.map((m) => ({ ...m, displace: false })),
      edge,
      desktop,
      NONE,
      chrome,
      { displacing: false },
    ]);
    add(edge, 'laneThickness', [members, edge]);
    add(edge, 'laneShrunk', [members, edge]);
    add(`${edge}, three boxes`, 'columnSlots', [
      edge,
      [
        { x: 0, y: 0, w: 300, h: 300 },
        { x: 0, y: 300, w: 300, h: 300 },
        { x: 0, y: 600, w: 300, h: 300 },
      ],
      { x: 0, y: 0, w: 1440, h: 900 },
    ]);
    add(`${edge}, unbounded`, 'columnSlots', [edge, [{ x: 100, y: 100, w: 200, h: 200 }]]);
    add(`${edge}, empty`, 'insertionSlots', [edge, [], desktop, NONE]);
    add(`${edge}, two lanes`, 'insertionSlots', [
      edge,
      [
        { x: 0, y: 0, w: 300, h: 900 },
        { x: 300, y: 0, w: 200, h: 900 },
      ],
      desktop,
      { ...NONE, left: 80 },
    ]);
  }
  add('nothing in a lane', 'columnLayout', [[], 'right', desktop, NONE, chrome, {}]);
  add('a lane too short for its members', 'columnLayout', [
    members,
    'left',
    { width: 1440, height: 300 },
    NONE,
    chrome,
    { displacing: true },
  ]);
  add('too short, floating', 'columnLayout', [
    members.map((m) => ({ ...m, displace: false })),
    'right',
    { width: 1440, height: 300 },
    NONE,
    chrome,
    { displacing: false },
  ]);
  add('a member that shrank its lane', 'laneShrunk', [[card({ thicknessX: 200 }), card({ w: 500 })], 'right']);
  for (const [label, member, axis, spanning] of [
    ['a sized card along a column', members[1], 'h', false],
    ['spanning', members[1], 'h', true],
    ['folded', members[2], 'h', true],
    ['along a row', members[0], 'w', true],
  ] as const)
    add(label, 'laneBase', [member, axis, spanning]);
  add('two declared floors', 'widestMin', [[{ width: 200 }, { height: 300, width: 100 }, null]]);
  add('none declared', 'widestMin', [[null, null]]);
  add('only one', 'widestMin', [[{ height: 240 }]]);
  for (const [label, open, seat] of [
    ['another seat open', [true, false, true], 0],
    ['the last open seat', [false, true, false], 1],
    ['a lane of one', [true], 0],
  ] as const)
    add(label, 'roomElsewhere', [open, seat]);
  add('tabs sharing an order, a seat of its own, an unnamed pair', 'seatsOf', [
    [
      { placement: card({ order: 0, tab: 1 }) },
      { placement: card({ order: 0, tab: 0 }) },
      { placement: card({ order: 1 }) },
      { placement: card() },
      { placement: card() },
    ],
  ]);
  add('a column of three on the right', 'columnMembers', [
    [
      { placement: card({ order: 2 }), index: 0 },
      { placement: card({ order: 0 }), index: 1 },
      { placement: card({ snap: 'left' }), index: 2 },
      { placement: card(), index: 3 },
    ],
    'right',
    desktop,
  ]);
  add('the one touched last', 'frontOf', [['a', 'b', 'c'], { b: 3, c: 1 }]);
  add('none touched', 'frontOf', [['a', 'b'], {}]);
  add('a tie keeps the registry order', 'layerOrder', [['a', 'b', 'c'], { a: 2, c: 2 }]);

  // ── Seats ───────────────────────────────────────────────────────────────────
  add('a mate following a stack to an edge', 'followSeat', [
    card({ snap: null, seat: 'x', tab: 1, w: 200 }),
    card({ snap: 'left', displace: true, band: 1, order: 2 }),
  ]);
  add('a mate following a stack into open space', 'followSeat', [
    card({ tab: 2 }),
    card({ snap: null, seat: 'x', x: 50, y: 60 }),
  ]);
  add('a mate following a stack home', 'followSeat', [card(), card({ snap: 'home', home: 'side', order: 0 })]);
  add('a mate taking the seat’s size', 'seatSize', [
    card({ w: 200, h: 200, thicknessX: 100 }),
    card({ w: 500, h: 600, thicknessY: 300 }),
  ]);
  add('keeps its own', 'seatOrder', [2, [0, 1]]);
  add('after the last taken', 'seatOrder', [ABSENT, [0, 1]]);
  add('its own taken', 'seatOrder', [1, [3, 1]]);
  add('nothing taken', 'seatOrder', [ABSENT, []]);
  add('to a corner', 'unlaned', [
    card({ band: 0, order: 1, tab: 0, seat: 's', stowed: true, displace: true }),
    'top-left',
  ]);
  add('into the air', 'unlaned', [card({ band: 0, order: 1 }), null]);

  // ── Drops ───────────────────────────────────────────────────────────────────
  const edgePanels = (requests: DockRequest[]) => laneable(requests, desktop);
  const drop = arrangements[2].requests;
  for (const [label, moving, target] of [
    ['a new lane outboard of the left band', 2, { edge: 'left', mode: 'band', position: 0 }],
    ['a new lane inboard of it', 2, { edge: 'left', mode: 'band', position: 1 }],
    ['a seat in the left band', 2, { edge: 'left', mode: 'lane', position: 1, lane: 0 }],
    ['a tab behind the first seat', 2, { edge: 'left', mode: 'tab', position: 0, lane: 0 }],
    ['the floating lane on the right', 0, { edge: 'right', mode: 'lane', position: 0, lane: 'float' }],
    ['a tab in the floating lane', 0, { edge: 'right', mode: 'tab', position: 0, lane: 'float' }],
    ['an empty edge', 1, { edge: 'bottom', mode: 'band', position: 0 }],
  ] as const)
    add(label, 'arrangeDrop', [edgePanels(drop), moving, target, desktop]);
  const home = edgePanels(arrangements[7].requests);
  add('into a home lane between two', 'arrangeHomeDrop', [home, 3, 'main', 1]);
  add('into an empty home lane', 'arrangeHomeDrop', [home, 0, 'side', 0]);
  add('a lane', 'homeLaneMembers', [home, 'main']);
  const hits = [
    { mode: 'band', hit: { x: 0, y: 0, w: 20, h: 900 } },
    { mode: 'lane', hit: { x: 0, y: 400, w: 300, h: 20 } },
    { mode: 'tab', hit: { x: 0, y: 0, w: 300, h: 400 } },
  ];
  add('the pointer inside two, the smaller wins', 'chooseTarget', [
    hits,
    { x: 10, y: 405 },
    { x: 0, y: 380, w: 300, h: 300 },
  ]);
  add('the pointer in none, covering two', 'chooseTarget', [
    hits,
    { x: 600, y: 600 },
    { x: 0, y: 380, w: 300, h: 300 },
  ]);
  add('nothing under it', 'chooseTarget', [hits, { x: 900, y: 900 }, { x: 800, y: 800, w: 40, h: 40 }]);
  add('a snap, no slot', 'snapBeatsSlot', [{ x: 0, y: 0, w: 100, h: 100 }, null, { x: 50, y: 50 }]);
  add('no snap', 'snapBeatsSlot', [null, { x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 50 }]);
  add('the pointer in the snap only', 'snapBeatsSlot', [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 200, y: 0, w: 10, h: 10 },
    { x: 50, y: 50 },
  ]);
  add('the pointer in both', 'snapBeatsSlot', [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 40, y: 40, w: 20, h: 20 },
    { x: 50, y: 50 },
  ]);
  add('the pointer in neither', 'snapBeatsSlot', [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 40, y: 40, w: 20, h: 20 },
    { x: 500, y: 500 },
  ]);
  for (const [label, rect] of [
    ['over the top-right target', { x: 1100, y: 10, w: 300, h: 200 }],
    ['in the middle of the screen', { x: 600, y: 350, w: 200, h: 200 }],
    ['over the left edge', { x: 40, y: 360, w: 200, h: 200 }],
  ] as const) {
    add(label, 'snapCandidate', [rect, desktop, NONE, chrome]);
    add(`${label}, pointer given`, 'snapCandidate', [rect, desktop, NONE, chrome, { x: rect.x + 10, y: rect.y + 10 }]);
  }
  add('the eight', 'snapTargetRects', [desktop, NONE, chrome]);
  add('beside a sidebar, narrow', 'snapTargetRects', [narrow, { ...NONE, right: 300 }, chrome]);
  add('the region', 'snapTargetSize', [desktop, NONE]);
  add('a squeezed region', 'snapTargetSize', [narrow, { ...NONE, left: 300, right: 300 }]);
  add('cards, a hidden one, one displacing, one at home', 'takenSnaps', [
    [
      { id: 'a', placement: card({ snap: 'top-left' }) },
      { id: 'b', placement: card({ snap: 'top' }), hidden: true },
      { id: 'c', placement: card({ snap: 'left', displace: true }) },
      { id: 'd', placement: card({ snap: 'home', home: 'side' }) },
      { id: 'e', placement: card({ snap: 'right', maximised: true }) },
      { id: 'f', placement: card({ snap: 'bottom' }) },
    ],
    ['f'],
  ]);
  add('after the cards on the edge', 'edgeSeatOrder', [arrangements[5].requests, ['l1'], 'right', ABSENT]);
  add('keeping the seat it held', 'edgeSeatOrder', [arrangements[5].requests, ['r2'], 'right', 1]);
  for (const [label, requests, moving, carried] of [
    ['a card carried to the left band', arrangements[2].requests, 'c', { x: 60, y: 300, w: 360, h: 300 }],
    ['a card carried nowhere near an edge', arrangements[2].requests, 'c', { x: 600, y: 300, w: 200, h: 200 }],
    ['a sidebar carried along the top', arrangements[6].requests, 'outer', { x: 500, y: 20, w: 300, h: 200 }],
    ['to a stowed lane', arrangements[4].requests, 'b', { x: 40, y: 300, w: 300, h: 300 }],
    ['a stack’s tab carried to the right', arrangements[3].requests, 't', { x: 1200, y: 300, w: 200, h: 300 }],
    ['nothing carried', arrangements[3].requests, 'a', null],
  ] as const) {
    const seating = seatLanes({ requests: [...requests], viewport: desktop, chrome, touched: {}, titles: {} });
    add(label, 'edgeDropSlots', [
      {
        requests,
        moving,
        boxes: boxesOf([...requests], desktop),
        hidden: seating.hidden,
        viewport: desktop,
        inset: { ...NONE, left: 300 },
        occupied: { ...NONE, left: 300 },
        carried,
      },
    ]);
  }
  add('two cards to stack onto', 'stackDropSlots', [
    [
      { x: 100, y: 100, w: 300, h: 400 },
      { x: 600, y: 100, w: 300, h: 400 },
    ],
  ]);
  add('none', 'stackDropSlots', [[]]);
  add('a column lane of two', 'homeDropSlots', [
    'side',
    'column',
    [
      { x: 0, y: 0, w: 300, h: 200 },
      { x: 0, y: 200, w: 300, h: 300 },
    ],
    { x: 0, y: 0, w: 300, h: 600 },
  ]);
  add('a row lane of one', 'homeDropSlots', [
    'main',
    'row',
    [{ x: 0, y: 0, w: 500, h: 600 }],
    { x: 0, y: 0, w: 1000, h: 600 },
  ]);
  add('an empty, collapsed lane', 'homeDropSlots', ['side', 'column', [], { x: 10, y: 10, w: 0, h: 0 }]);

  // ── Branches no arrangement above reaches ───────────────────────────────────
  add('a box grown on every side', 'grown', [{ x: 10, y: 20, w: 100, h: 50 }, 8]);
  add('two boxes crossing', 'overlapArea', [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 50, y: 50, w: 100, h: 100 },
  ]);
  add('two boxes apart', 'overlapArea', [
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 50, y: 50, w: 10, h: 10 },
  ]);
  add('an aspect that is no ratio', 'fitPlacement', [card(), { ratio: 0 }, { spanning: false }]);
  add('chrome larger than the card', 'fitPlacement', [
    card({ w: 20, h: 20 }),
    { ratio: 1 },
    { spanning: false, chrome: { x: 40, y: 40 } },
  ]);
  add('home', 'snapOrigin', ['home', 360, 420, desktop, NONE, chrome]);
  add('the top edge pulled past the floor', 'resizedBox', [
    { x: 200, y: 100, w: 360, h: 420 },
    'top',
    0,
    400,
    { w: 200, h: 120 },
  ]);
  add('an empty lane', 'laneShrunk', [[], 'left']);
  add('no boxes', 'columnSlots', ['left', [], { x: 0, y: 0, w: 1440, h: 900 }]);
  add('a panel that is not there', 'occupiedById', [arrangements[2].requests, 'gone', desktop, true]);
  add('a narrow floating column', 'columnLayout', [
    members.map((m) => ({ ...m, displace: false })),
    'right',
    narrow,
    NONE,
    chrome,
    { displacing: false },
  ]);
  {
    const lone = [dock('one', card({ snap: 'left', displace: true, stowed: true }), { edge: 'left' })];
    add('a lane of one put away', 'seatLanes', [
      { requests: lone, viewport: desktop, chrome, touched: {}, titles: {} },
    ]);
    const requests = arrangements[2].requests;
    add('a box the host did not measure', 'edgeDropSlots', [
      {
        requests,
        moving: 'c',
        boxes: {},
        hidden: {},
        viewport: desktop,
        inset: { ...NONE, left: 300 },
        occupied: { ...NONE, left: 300 },
        carried: { x: 60, y: 300, w: 360, h: 300 },
      },
    ]);
  }

  // ── The chrome's own arithmetic ─────────────────────────────────────────────
  add('nothing at the top', 'railBand', [desktop, NONE, { height: 0, width: 0 }]);
  add('a call bar under the rail', 'railBand', [desktop, NONE, { height: 120, width: 1400 }]);
  add('a call bar clear of the rail', 'railBand', [desktop, { ...NONE, right: 400 }, { height: 120, width: 200 }]);
  add('an app with no rail', 'railBand', [desktop, NONE, { height: 120, width: 1400 }], noRail);
  add('the call bar covering the bottom', 'withChromeCovered', [
    { ...NONE, right: 300 },
    { top: 0, bottom: 74 },
  ]);
  add('more covered than the chrome', 'withChromeCovered', [
    { ...NONE, bottom: 200, top: 10 },
    { top: 40, bottom: 74 },
  ]);
  return cases;
}
