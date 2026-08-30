/**
 * Six applications over one container, and the registration step that fails silently.
 *
 * The sibling of `templates/views/src/views.test.ts`, for the same reason and against the same
 * hazard. `pnpm validate:schemas` already judges whether these schemas are *valid*; what nothing
 * covered is whether they are **reachable**. A template exported here but absent from
 * `generateTemplateRegistry.mjs`'s `CATALOGUE` can never be named in a seed, so it is correct code
 * that no deployment can ship, and nothing fails.
 *
 * The other direction fails louder but later: a catalogue entry whose export does not exist breaks
 * the *generator* at build time with a module-resolution error naming a symbol, rather than here
 * with a sentence naming the template.
 *
 * So these are about identity and wiring rather than about what any template renders.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as showcase from './index.ts';

type Route = { path: string; redirect?: string; routes?: Route[] };
type Schema = {
  meta?: { name?: string; description?: string; icon?: string; role?: string };
  routes?: Route[];
};

/*
  The templates, not everything the index re-exports: `KIND` and `MODE` are the shared vocabulary
  constants the schemas are written against, and they live here so a template does not spell a kind
  by hand. Selected by having a `meta` rather than by name, so a template added without the
  `…Template` convention is still covered.
*/
const exported = (Object.entries(showcase) as [string, Schema][]).filter(
  ([, value]) => typeof value === 'object' && value !== null && 'meta' in value,
);

describe('the showcase templates', () => {
  it('finds some, so nothing below is vacuous', () => {
    expect(exported.length).toBeGreaterThan(4);
  });

  it.each(exported.map(([name]) => name))('%s is a shell, not a section', (name) => {
    /*
      `meta.role` is what tells a section from a shell, and absent means shell — which is what these
      are. An accidental `role: 'view'` would install a whole interface as one section *inside*
      another, so the shell would expand `{ path: '$views' }` into something that is itself a shell:
      a space rendering a space.
    */
    const meta = (showcase as Record<string, Schema>)[name].meta;
    expect(meta?.role ?? 'shell').toBe('shell');
  });

  it.each(exported.map(([name]) => name))('%s is named and described', (name) => {
    // The name and icon are what somebody reads in the template switcher; a template with neither
    // is a blank row they have to click to identify.
    const meta = (showcase as Record<string, Schema>)[name].meta;
    expect(meta?.name?.trim()).toBeTruthy();
    expect(meta?.description?.trim()).toBeTruthy();
    expect(meta?.icon?.trim()).toBeTruthy();
  });

  it('is exactly what the generator will offer a deployment', () => {
    /*
      `generateTemplateRegistry.mjs` holds its own `CATALOGUE` of id → { module, export }, and a
      seed may only name an id that is in it. The exports here and the entries there are the same
      fact written twice, and both directions of disagreement are invisible in review.

      Read from the script's source, because it is a build script rather than a module this package
      can import. Only the entries pointing at *this* package are compared — the catalogue also
      carries `default`, which lives in `@we/template-default`.
    */
    const script = readFileSync(
      fileURLToPath(new URL('../../../app-shell/scripts/generateTemplateRegistry.mjs', import.meta.url)),
      'utf8',
    );
    const block = /const CATALOGUE = \{([\s\S]*?)\n\};/.exec(script);
    expect(block, 'could not find CATALOGUE in generateTemplateRegistry.mjs').toBeTruthy();

    const catalogued = [...block![1].matchAll(/export: '([A-Za-z0-9_]+)'/g)]
      .map((m) => m[1])
      .filter((name) => exported.some(([exportName]) => exportName === name));

    expect([...catalogued].sort()).toEqual([...exported.map(([name]) => name)].sort());
  });

  /*
    Every one of these routes ITSELF — none marks where a space's sections go — so switching to one
    lands on `/` and the template decides from there. That is the contract `switchTemplate` reads:
    it carries the current section across only for a template that hosts sections, because those are
    the ones living at `/space/<id>/<segment>`.

    It was assuming the space shape of every template, so switching to Workshop landed on its
    catch-all — "No such page" until you pressed a nav button — and the rest were one click from the
    same fault. Both halves are asserted here: that these do not host sections, and that each can
    answer `/`.
  */
  it.each(exported)('%s routes itself and can answer /', (_name, schema) => {
    const hasViewsMarker = (routes: Route[] = []): boolean =>
      routes.some((route) => route.path === '$views' || hasViewsMarker(route.routes));

    expect(hasViewsMarker(schema.routes), 'a showcase template hosts no sections').toBe(false);

    /*
      Either no route table at all — the host's own catch-all renders nothing and the layout draws
      the template at every path, which is how a single-screen template like Events works — or a
      route that answers `/`, since that is where switching lands. A table with routes but no index
      falls to the template's own catch-all, which is the bug this pins.
    */
    if (!schema.routes?.length) return;
    const index = schema.routes.find((route) => route.path === '/');
    expect(index, 'has routes but none answers /, so switching to it lands on its 404').toBeTruthy();
    // A redirect has to point at a route that exists, or it bounces to the catch-all instead.
    if (index?.redirect) {
      /*
        Relative, and pointing at a route that exists. Both halves matter and both fail silently.

        The host mounts every template under `/space/:spaceId`, and `buildRoutes` joins an absolute
        redirect to the parent *pattern* — so `/board` became a literal `/space/:spaceId/board`,
        matching nothing. And a redirect at a path no route serves lands on the catch-all, which is
        the same "No such page" by a different route.
      */
      expect(index.redirect.startsWith('./'), 'an absolute redirect joins to the parent pattern').toBe(true);
      const target = index.redirect.slice(1);
      expect(schema.routes.some((route) => route.path === target)).toBe(true);
    }
  });

  it.each(exported)('%s navigates relatively, so the host can mount it anywhere', (_name, schema) => {
    /*
      A template addresses its own screens, not the whole URL. An absolute `/board` was correct only
      while these mounted at the root; under the space prefix it leaves the space entirely.

      Checked over the serialised schema rather than by walking it, because these paths appear in
      several shapes — a `navigate` argument, an interpolated expression, a nav array a `$each`
      reads, an option a fragment turns into a handler — and the string is the one thing they share.
    */
    const serialised = JSON.stringify(schema.routes ?? []);
    const absolute = [...serialised.matchAll(/routeStore\.navigate[^)]*?'(\/[a-z][^']*)'/g)].map((m) => m[1]);
    expect(absolute).toEqual([]);
  });
});
