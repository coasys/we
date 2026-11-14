/**
 * Path vector inputs: `{ id, to, current, base }` → `resolvePath(to, current, base)` plus
 * `isRelativePath(to)` — every case from `navigationPaths.test.ts` (ids `spec.*`) plus edge cases
 * around suffixes, clamping and bases deeper than the address.
 */

export interface PathCase {
  id: string;
  to: string;
  /** The address on screen, query and fragment included. */
  current: string;
  base: { depth: number; root: number };
}

const P = (id: string, to: string, current: string, base: { depth: number; root: number }): PathCase => ({
  id,
  to,
  current,
  base,
});

const ON_BOARD = '/space/abc/board?id=ad4m://obj/x';
const IN_ROUTE = { depth: 3, root: 2 };
const IN_CHROME = { depth: 2, root: 2 };
const AT_ROOT = { depth: 0, root: 0 };

export const PATH_CASES: PathCase[] = [
  /* --- every case from navigationPaths.test.ts --- */
  P('spec.dot', '.', ON_BOARD, IN_ROUTE),
  P('spec.empty', '', ON_BOARD, IN_ROUTE),
  P('spec.up', '..', ON_BOARD, IN_ROUTE),
  P('spec.up-child', '../wall', ON_BOARD, IN_ROUTE),
  P('spec.down', './cards', ON_BOARD, IN_ROUTE),
  P('spec.bare-child', 'cards', ON_BOARD, IN_ROUTE),
  P('spec.up-beyond', '../../..', ON_BOARD, IN_ROUTE),
  P('spec.up-beyond-child', '../../../settings', ON_BOARD, IN_ROUTE),
  P('spec.chrome-child', './board', ON_BOARD, IN_CHROME),
  P('spec.chrome-dot', '.', ON_BOARD, IN_CHROME),
  P('spec.root-slash', '~/', ON_BOARD, IN_ROUTE),
  P('spec.root', '~', ON_BOARD, IN_ROUTE),
  P('spec.root-child', '~/wall', ON_BOARD, IN_ROUTE),
  P('spec.root-chrome', '~/wall', ON_BOARD, IN_CHROME),
  P('spec.suffix', '~/board?id=ad4m://obj/y#top', ON_BOARD, IN_ROUTE),
  P('spec.query-only', '?sort=new', ON_BOARD, IN_ROUTE),
  P('spec.absolute', '/settings/ai', ON_BOARD, IN_ROUTE),
  P('spec.url', 'https://example.org/x', ON_BOARD, IN_ROUTE),
  P('spec.scheme', 'mailto:a@example.org', ON_BOARD, IN_ROUTE),
  P('spec.fragment', '#top', ON_BOARD, IN_ROUTE),
  P('spec.base-past-address', './x', '/space/abc', IN_ROUTE),
  P('spec.base-zero', './x', '/', AT_ROOT),

  /* --- edges --- */
  P('edge.up-exactly-root', '../..', '/space/abc/board', IN_ROUTE),
  P('edge.up-past-root', '../../../../x', '/space/abc/board', IN_ROUTE),
  P('edge.up-at-root', '..', '/space/abc', IN_CHROME),
  P('edge.up-at-top', '..', '/a', AT_ROOT),
  P('edge.dot-slash', './', ON_BOARD, IN_ROUTE),
  P('edge.dots-inside', './a/./b', ON_BOARD, IN_ROUTE),
  P('edge.child-query', './cards?x=1', ON_BOARD, IN_ROUTE),
  P('edge.child-fragment', './cards#frag', ON_BOARD, IN_ROUTE),
  P('edge.query-empty-path', '?', ON_BOARD, IN_ROUTE),
  P('edge.query-with-hash', '?s=1#h', ON_BOARD, IN_ROUTE),
  P('edge.tilde-only-child', '~/?x=1', ON_BOARD, IN_ROUTE),
  P('edge.root-no-space', '~/x', '/app/board', { depth: 1, root: 0 }),
  P('edge.relative-no-space', './y', '/app/board', { depth: 1, root: 0 }),
  P('edge.up-no-space', '../y', '/app/board', { depth: 1, root: 0 }),
  P('edge.root-deeper-than-segments', '~/x', '/a', { depth: 2, root: 3 }),
  P('edge.base-deeper-than-address', './z', '/a/b', { depth: 5, root: 1 }),
  P('edge.current-no-query', './c', '/x/y', { depth: 2, root: 0 }),
  P('edge.current-fragment', './c', '/x/y#frag', { depth: 2, root: 0 }),
  P('edge.current-query', './c', '/x/y?q=1', { depth: 2, root: 0 }),
  P('edge.to-whitespace', '  ./c  ', ON_BOARD, IN_ROUTE),
  P('edge.to-dotdot-suffix', '..?q=1', ON_BOARD, IN_ROUTE),
  P('edge.scheme-plus', 'ad4m://obj/x', ON_BOARD, IN_ROUTE),
  P('edge.scheme-mixed', 'we:thing', ON_BOARD, IN_ROUTE),
  P('edge.tilde-deep', '~/a/b/c', ON_BOARD, IN_ROUTE),
  P('edge.multi-up-mid', './a/../b', ON_BOARD, IN_ROUTE),
  P('edge.double-dot-seg', 'a/../b', ON_BOARD, IN_ROUTE),
];
