/**
 * Panel-resolution vector inputs: which declared panels are on the screen, and where each one is.
 *
 * Two questions a host answers for every panel ([Panels](../../../../../docs/spec/template/panels.md)):
 *
 * - `op: 'active'` — the interface's (`shell`), the section's (`view`) and the app's (`app`)
 *   declarations, and the address as segments → the panels present, by id, in order. The interface
 *   wins a collision of id over the section and the app; a `route` keeps a panel to its segments.
 * - `op: 'placement'` — a panel's three rungs, the reader's `disposition`, the template's
 *   `declared` entry and the panel's own bid (`request`), in a `viewport` → where it is.
 *
 * A change of template is a case with the same disposition and a different declaration: the
 * declaration is live, the disposition is the reader's and is never written back.
 *
 * Case ids are append-only.
 */
export type PanelCase =
  | {
      id: string;
      note: string;
      op: 'active';
      shell: Record<string, unknown>[];
      view?: Record<string, unknown>[];
      app?: Record<string, unknown>[];
      segments: string[];
    }
  | {
      id: string;
      note: string;
      op: 'placement';
      request: { id: string; edge: string | null; size: string; float: boolean };
      declared?: Record<string, unknown>;
      disposition?: Record<string, unknown>;
      viewport: { width: number; height: number };
    };

const viewport = { width: 1440, height: 900 };
const bid = (edge: string | null = 'right', float = false) => ({ id: 'notes', edge, size: 'md', float });
const dragged = { snap: 'left', x: 0, y: 0, w: 380, h: 600, displace: true };

export const PANEL_CASES: PanelCase[] = [
  /* ── which panels are present ──────────────────────────────────────────────────────────── */
  {
    id: 'panels.active.shell',
    note: "the interface's declarations are present, in order",
    op: 'active',
    shell: [
      { id: 'a', node: { type: 'Column' } },
      { id: 'b', module: 'notes' },
    ],
    segments: [],
  },
  {
    id: 'panels.active.shell-beats-view',
    note: "the interface's entry wins a collision of id over the section's; the section adds the rest",
    op: 'active',
    shell: [{ id: 'a', title: 'shell' }],
    view: [
      { id: 'a', title: 'view' },
      { id: 'v', title: 'view only' },
    ],
    segments: [],
  },
  {
    id: 'panels.active.shell-beats-app',
    note: "the app's panels ride under the interface's and lose a collision of id to it",
    op: 'active',
    shell: [{ id: 'chat', title: 'shell' }],
    app: [
      { id: 'chat', title: 'app' },
      { id: 'help', title: 'app' },
    ],
    segments: [],
  },
  {
    id: 'panels.active.route-one',
    note: 'a panel with a route is present only while that segment is in the address',
    op: 'active',
    shell: [{ id: 'always' }, { id: 'board', route: 'board' }],
    segments: ['canvas'],
  },
  {
    id: 'panels.active.route-matches',
    note: 'the same declarations on an address holding the segment',
    op: 'active',
    shell: [{ id: 'always' }, { id: 'board', route: 'board' }],
    segments: ['board', 'card'],
  },
  {
    id: 'panels.active.route-list',
    note: 'a route may be a list of segments, any of which keeps the panel',
    op: 'active',
    shell: [{ id: 'inspector', route: ['board', 'list'] }],
    segments: ['list'],
  },

  /* ── where each one is: the three rungs ────────────────────────────────────────────────── */
  {
    id: 'panels.placement.suggestion',
    note: 'with no declaration and no disposition, the panel opens where its own bid asks',
    op: 'placement',
    request: bid('right'),
    viewport,
  },
  {
    id: 'panels.placement.suggestion-float',
    note: 'a bid to float opens as a card at the middle of the edge it names',
    op: 'placement',
    request: bid('bottom', true),
    viewport,
  },
  {
    id: 'panels.placement.declaration',
    note: "the template's declaration beats the bid",
    op: 'placement',
    request: bid('right'),
    declared: { snap: 'left', size: 'lg', displace: true },
    viewport,
  },
  {
    id: 'panels.placement.declaration-corner-no-displace',
    note: 'a declaration cannot displace from a corner, where pushing content aside means nothing',
    op: 'placement',
    request: bid('right'),
    declared: { snap: 'top-right', displace: true },
    viewport,
  },
  {
    id: 'panels.placement.declaration-box',
    note: 'a declared box in pixels is held to the room there is',
    op: 'placement',
    request: bid('right'),
    declared: { snap: 'right', box: { width: 5000, height: 120 } },
    viewport,
  },
  {
    id: 'panels.placement.disposition',
    note: "the reader's disposition beats the declaration",
    op: 'placement',
    request: bid('right'),
    declared: { snap: 'right', size: 'sm' },
    disposition: dragged,
    viewport,
  },
  {
    id: 'panels.placement.template-switch',
    note: 'a change of template changes the declaration and leaves the disposition: it still wins',
    op: 'placement',
    request: bid('right'),
    declared: { snap: 'bottom', size: 'md' },
    disposition: dragged,
    viewport,
  },
  {
    id: 'panels.placement.home-declared',
    note: 'a declared home starts the panel in the template',
    op: 'placement',
    request: bid('right'),
    declared: { home: 'inspector', snap: 'right', order: 1 },
    viewport,
  },
  {
    id: 'panels.placement.home-undeclared-refused',
    note: 'a disposition into a home lane the declaration does not give the panel is not honoured',
    op: 'placement',
    request: bid('right'),
    disposition: { snap: 'home', x: 0, y: 0, w: 300, h: 300, displace: false },
    viewport,
  },
  {
    id: 'panels.placement.home-undeclared-falls-to-declaration',
    note: 'and with a declaration that is not a home, the declaration answers instead',
    op: 'placement',
    request: bid('right'),
    declared: { snap: 'left' },
    disposition: { snap: 'home', x: 0, y: 0, w: 300, h: 300, displace: false },
    viewport,
  },
];
