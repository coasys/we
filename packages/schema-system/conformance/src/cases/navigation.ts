/**
 * Navigation vector inputs: scripts run against a mounted RouteStore over a real jsdom history.
 * Each step is one operation; `expect` (recorded per step) holds the href, the page identity and
 * the history stack's depth and position.
 *
 * The rules under test are screen-state.md §4's ten: relative resolution, root-relative `~`,
 * query-only `?`, `navigate` with query/base/replace, the same-target no-op, remembered queries,
 * `setParam` replace vs push and removal, page identity = path + `?id=`, `syncParam` precedence
 * and back-at-initial removal, and `back`/`forward` traversal.
 */

export interface NavigationScriptCase {
  id: string;
  /** What this script pins, for the failure message and the Rust-side reader. */
  note: string;
  /**
   * The screen's declared params (screen-state.md §4.3) — the typed-params declaration a Rust
   * engine enforces. `id` carries `identity: true` (it feeds `page_identity()`); a param any step
   * pushes carries `push: true`. Everything else is `string`-typed: sync `type` (the write
   * encoding) is an orthogonal axis and stays in the op args.
   */
  schema: { params: Record<string, { type: string; identity?: boolean; push?: boolean }> };
  /** The URL the script's history opens on. */
  start: string;
  steps: { op: string; args?: Record<string, unknown> }[];
}

/** The §4.3 declaration this script's steps imply: param names from ops, `id` marked identity. */
function schemaFor(steps: NavigationScriptCase['steps']): NavigationScriptCase['schema'] {
  const params: NavigationScriptCase['schema']['params'] = {};
  for (const step of steps) {
    const args = step.args ?? {};
    const name = args.name as string | undefined;
    if ((step.op === 'set_param' || step.op === 'sync_param' || step.op === 'local_read') && name) {
      const entry = (params[name] ??= { type: name === 'id' ? 'id' : 'string' });
      if (name === 'id') entry.identity = true;
      if (args.push === true) entry.push = true;
    }
    const query = (args.options as { query?: Record<string, unknown> } | undefined)?.query;
    if (step.op === 'navigate' && query) {
      for (const key of Object.keys(query))
        params[key] ??= { type: key === 'id' ? 'id' : 'string', ...(key === 'id' ? { identity: true } : {}) };
    }
  }
  return { params };
}

const S = (id: string, note: string, start: string, steps: NavigationScriptCase['steps']): NavigationScriptCase => ({
  id,
  note,
  schema: schemaFor(steps),
  start,
  steps,
});

export const NAVIGATION_CASES: NavigationScriptCase[] = [
  /* rule 1-2: relative paths resolve against the current node route; .. clamps at the root */
  S('nav.relative-child', "rule 1: './cards' resolves a level against the node's route depth", '/space/abc/board', [
    { op: 'navigate', args: { to: './cards' } },
  ]),
  S('nav.relative-bare', "rule 1: a bare relative segment resolves like './x'", '/space/abc/board', [
    { op: 'navigate', args: { to: 'cards' } },
  ]),
  S('nav.relative-up', "rule 1: '..' climbs one route level", '/space/abc/board', [
    { op: 'navigate', args: { to: '../wall' } },
  ]),
  S('nav.relative-up-past-root', 'rule 1: .. never climbs above the template root (/space/:id)', '/space/abc/board', [
    { op: 'navigate', args: { to: '../../../settings' } },
  ]),
  S('nav.template-root', 'rule 2: ~/x resolves from the template root; ~ alone is the root', '/space/abc/board/cards', [
    { op: 'navigate', args: { to: '~/wall' } },
    { op: 'navigate', args: { to: '~' } },
  ]),
  S('nav.query-only', 'rule 1: ?x keeps the current pathname and only changes the query', '/space/abc/board', [
    { op: 'navigate', args: { to: '?sort=new' } },
  ]),

  /* rule 3: absolute paths, hashes and URLs pass through */
  S('nav.absolute', 'rule 3: an absolute path passes through untouched', '/space/abc/board', [
    { op: 'navigate', args: { to: '/settings/ai' } },
  ]),

  /* rule 4: navigate() with query and base options */
  S('nav.with-query', 'rule 4: navigate() appends the options.query object', '/space/abc/board', [
    { op: 'navigate', args: { to: './record', options: { query: { id: 'ad4m://obj/x', tab: 'info' } } } },
  ]),
  S(
    'nav.query-encoding',
    'rule 4: query values encode — strings, lists, objects JSON-encoded, empty/nil handling',
    '/space/abc/board',
    [
      {
        op: 'navigate',
        args: {
          to: './x',
          options: { query: { call: 'ad4m://obj/y', list: ['a', 'b'], obj: { k: 1 }, empty: '', nil: null } },
        },
      },
    ],
  ),
  S(
    'nav.base-option',
    'rule 4: options.base.depth overrides the route depth the relative path resolves against',
    '/space/abc/board/deep',
    [{ op: 'navigate', args: { to: './sibling', options: { base: { depth: 3 } } } }],
  ),

  /* rule 5: same-target navigation is a no-op — no entry, no move */
  S('nav.same-target', 'rule 5: navigating to the current path is a no-op — no entry, no move', '/space/abc/board', [
    { op: 'navigate', args: { to: '/space/abc/board' } },
    { op: 'navigate', args: { to: '.' } },
  ]),

  /* rule 6: remembered query — a bare path back restores what was last seen there */
  S(
    'nav.remembered-query',
    'rule 6: a bare path back restores the query last seen there',
    '/space/abc/board?sort=top',
    [
      { op: 'navigate', args: { to: '~/wall' } },
      { op: 'navigate', args: { to: '~/board' } },
    ],
  ),
  S('nav.explicit-query-wins', 'rule 6: an explicit query beats the remembered one', '/space/abc/board?sort=top', [
    { op: 'navigate', args: { to: '~/wall' } },
    { op: 'navigate', args: { to: '~/board', options: { query: { sort: 'new' } } } },
  ]),

  /* rule 7: setParam — replace by default, push on request, ''/null removes */
  S('nav.set-param-replace', 'rule 7: setParam replaces by default — same entry overwritten', '/space/abc/board', [
    { op: 'set_param', args: { name: 'sel', value: 'r:1' } },
    { op: 'set_param', args: { name: 'sel', value: 'r:2' } },
  ]),
  S('nav.set-param-push', 'rule 7: push:true pushes a history entry; back undoes it', '/space/abc/board', [
    { op: 'set_param', args: { name: 'sel', value: 'r:1' } },
    { op: 'set_param', args: { name: 'sel', value: 'r:2', push: true } },
    { op: 'back' },
  ]),
  S(
    'nav.set-param-remove',
    'rule 7: null and empty-string values remove the param',
    '/space/abc/board?sel=r:1&keep=1',
    [
      { op: 'set_param', args: { name: 'sel', value: null } },
      { op: 'set_param', args: { name: 'keep', value: '' } },
    ],
  ),

  /* rule 8: page identity — path plus ?id */
  S(
    'nav.page-identity',
    'rule 8: page identity is pathname + ?id — a param write changes identity, a path change drops the id',
    '/space/abc/board',
    [
      { op: 'set_param', args: { name: 'id', value: 'we://r/1' } },
      { op: 'navigate', args: { to: './other' } },
    ],
  ),

  /* rule 9: syncParam — non-strings serialize as JSON, back-at-initial removes, push opt */
  S('nav.sync-json', 'rule 9: syncParam serialises a non-string value as JSON', '/space/abc/board', [
    { op: 'sync_param', args: { name: 'filters', value: { kind: 'task' }, initial: {}, type: 'object' } },
  ]),
  S(
    'nav.sync-back-at-initial',
    'rule 9: a value back at the declared initial removes the param',
    '/space/abc/board?filters={"kind":"task"}',
    [{ op: 'sync_param', args: { name: 'filters', value: {}, initial: {}, type: 'object' } }],
  ),
  S('nav.sync-string-raw', 'rule 9: string-typed params write raw text, not JSON', '/space/abc/board', [
    { op: 'sync_param', args: { name: 'q', value: 'a b', initial: '', type: 'string' } },
  ]),
  S('nav.sync-push', 'rule 9: syncParam with push:true grows history; back undoes it', '/space/abc/board', [
    { op: 'sync_param', args: { name: 'q', value: 'x', initial: '', type: 'string', push: true } },
    { op: 'back' },
  ]),
  S(
    'nav.local-precedence',
    'rule 9: mount-time precedence is URL param > persisted > declared initial',
    '/space/abc/board?sort=url',
    [
      // First persist a different value for the same key: the URL must still win.
      {
        op: 'sync_param',
        args: { name: 'other-param', value: 'grid', initial: 'list', type: 'string', persist: 'view-sort' },
      },
      { op: 'local_read', args: { name: 'sort', persist: 'view-sort', initial: 'top', type: 'string' } },
      { op: 'local_read', args: { name: 'other', persist: 'view-other', initial: 'init', type: 'string' } },
    ],
  ),
  S(
    'nav.local-persisted',
    'rule 9: a persisted we-local:<key> fills in when the URL has no param',
    '/space/abc/board',
    [
      { op: 'sync_param', args: { name: 'view', value: 'grid', initial: 'list', type: 'string', persist: 'v' } },
      { op: 'local_read', args: { name: 'nope', persist: 'v', initial: 'list', type: 'string' } },
    ],
  ),

  /* rule 10: back/forward — entries setParam pushed are traversed; at the start back does nothing */
  S('nav.back-at-start', 'rule 10: back at the first entry is a no-op', '/space/abc/board', [
    { op: 'back' },
    { op: 'back' },
  ]),
  S('nav.back-forward', 'rule 10: back/forward traverse pushed navigation entries', '/space/abc/board', [
    { op: 'navigate', args: { to: '~/wall' } },
    { op: 'navigate', args: { to: '~/people' } },
    { op: 'back' },
    { op: 'back' },
    { op: 'forward' },
  ]),
  S('nav.back-over-param', 'rule 10: back traverses entries setParam pushed too', '/space/abc/board', [
    { op: 'set_param', args: { name: 'sel', value: 'r:1', push: true } },
    { op: 'navigate', args: { to: '~/wall' } },
    { op: 'back' },
    { op: 'back' },
  ]),
  S(
    'nav.replace-option',
    'rule 4/10: navigate replace:true swaps the current entry; back skips it',
    '/space/abc/board',
    [{ op: 'navigate', args: { to: '~/wall', options: { replace: true } } }, { op: 'back' }],
  ),
  S('nav.open-deep-link', 'open lands on a deep link; .. then climbs from it within the root', '/space/abc/board', [
    { op: 'open', args: { href: '/space/abc/people?tab=all' } },
    { op: 'navigate', args: { to: '..' } },
  ]),
];
