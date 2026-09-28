/**
 * The sections a space is made of, and the registration step that fails silently.
 *
 * 7,584 lines of view schemas with no `test` script at all — the largest package in the repo
 * without one. Schema validity is covered by `pnpm validate:schemas`, which is a real gate; what
 * nothing covered is the *registration*, which `docs/contributing/surfaces.md` names as the step
 * whose omission is invisible: a view that is written but not in the generator's catalogue is
 * correct code that never appears anywhere, with nothing failing.
 *
 * So these are about identity and wiring rather than about what any view renders.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BUILT_IN_VIEWS } from './index.ts';

const ids = Object.keys(BUILT_IN_VIEWS);

describe('the built-in views', () => {
  it('finds some, so nothing below is vacuous', () => {
    expect(ids.length).toBeGreaterThan(4);
  });

  it.each(ids)('%s declares itself a view', (id) => {
    /*
      `meta.role` is what tells a section from a shell, and absent means shell — so a view that
      forgets it is installed as a whole interface. The host would then expand `{ path: '$views' }`
      inside something that is not a section, which reads as a space rendering a space.
    */
    expect(BUILT_IN_VIEWS[id].meta?.role).toBe('view');
  });

  it.each(ids)('%s is named and described', (id) => {
    // The name is what a member reads in the section list and in the space's own settings; a view
    // with none is a row somebody has to guess at.
    const meta = BUILT_IN_VIEWS[id].meta;
    expect(meta?.name?.trim()).toBeTruthy();
    expect(meta?.description?.trim()).toBeTruthy();
    expect(meta?.icon?.trim()).toBeTruthy();
  });

  it('is exactly what the generator will offer a deployment', () => {
    /*
      `generateViewRegistry.mjs` holds its own `CATALOGUE` of id → export, and a seed may only name
      an id that is in it. The two lists are the same fact written twice, and the failure is
      asymmetric and silent in both directions: a view missing from the catalogue can never be put
      in a seed, and a catalogue entry with no export here fails the *generator* at build time with
      an import error rather than here with a sentence.

      Read from the script's source, because it is a build script rather than a module this package
      can import.
    */
    const script = readFileSync(
      fileURLToPath(new URL('../../../app-shell/scripts/generateViewRegistry.mjs', import.meta.url)),
      'utf8',
    );
    const block = /const CATALOGUE = \{([\s\S]*?)\n\};/.exec(script);
    expect(block, 'could not find CATALOGUE in generateViewRegistry.mjs').toBeTruthy();

    const catalogued = [...block![1].matchAll(/^\s*([A-Za-z0-9_-]+):/gm)].map((m) => m[1]);
    expect([...catalogued].sort()).toEqual([...ids].sort());
  });
});

/**
 * The feed asks for posts, and a post is not every record that happens to be stored like one.
 *
 * `createPost` writes `kind` ALONGSIDE `type: 'root'` rather than instead of it, so a reply written
 * from a thread is `type: 'root'` too. Nothing said so until replies could be written from
 * anywhere, and then every comment in the space appeared in the feed as a post of its own.
 *
 * Pinned as a shape rather than a screenshot, because the two plausible fixes fail in opposite
 * directions: `kind: 'post'` and `kind: { not: 'reply' }` both turn on a field older posts do not
 * carry, and on AD4M an unbound value fails both tests — so either one empties the feed of
 * everything written before the field existed. Asking whether the record answers something is the
 * only spelling that is true of a post from any era.
 */
describe('the cards view’s post feed', () => {
  /** Every node in a schema tree, including the ones behind `$if` branches and `routes`. */
  function walk(node: unknown, visit: (n: Record<string, unknown>) => void): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
    const n = node as Record<string, unknown>;
    if (typeof n.type === 'string' || n.props || n.children) visit(n);
    for (const value of Object.values(n)) walk(value, visit);
  }

  /**
   * The feed's own query: a `CollectionBlock` read filtered on `type: 'root'`.
   *
   * Looked for in `$queries` as well as in props, because `cardList` HOISTS its query onto the node
   * it builds rather than leaving it on an `$each` — which is the whole point of the fragment, and
   * would make a props-only search silently find nothing and pass.
   */
  function feedQuery(): Record<string, unknown> | undefined {
    let found: Record<string, unknown> | undefined;
    const consider = (value: unknown) => {
      const q = ((value as { $query?: unknown })?.$query ?? value) as
        { entity?: string; where?: Record<string, unknown> } | undefined;
      if (q?.entity === 'CollectionBlock' && q.where?.type === 'root' && !found) {
        found = q as Record<string, unknown>;
      }
    };
    walk(BUILT_IN_VIEWS.cards, (n) => {
      for (const value of Object.values((n.props ?? {}) as Record<string, unknown>)) consider(value);
      for (const value of Object.values((n.$queries ?? {}) as Record<string, unknown>)) consider(value);
    });
    return found;
  }

  it('excludes anything that is a reply to something else', () => {
    const where = feedQuery()?.where as Record<string, unknown> | undefined;
    expect(where, 'no CollectionBlock query filtered on type: root in the cards view').toBeTruthy();
    expect(where!.inReplyTo).toEqual({ none: {} });
  });

  it('counts the whole conversation on each post, not the replies directly under it', () => {
    // The number beside the icon is what expanding reveals in total; direct children would say
    // "2" over a thread of forty. `transitive` is the difference, and it rides in the same read.
    const include = feedQuery()?.include as Record<string, Record<string, unknown>> | undefined;
    expect(include?.$commentCount).toMatchObject({ from: 'comments', count: true, transitive: true });
  });
});
