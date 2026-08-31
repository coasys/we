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

/**
 * The workshop is about one call, and which call that is lives in the address.
 *
 * Three things it used to be, all wrong in the same way: `modules.transcribe.collectionId` means
 * "the call I am recording into", so looking at a finished call meant joining a call first, a reload
 * came back to no call at all, and the board you were looking at could not be sent to anybody.
 *
 * A **query parameter**, not a path segment, and that is the part worth pinning: a record id is a
 * URI, so `./board/we://…/<uuid>` is several segments, `/board/:callId` matches none of them, and
 * every click landed on the catch-all saying "Page not found". Nothing in the expression language
 * can percent-encode; `setParam` writes through `URLSearchParams`, so it does not have to.
 */
describe('the workshop template’s call selection', () => {
  const workshop = showcase.workshopTemplate as Schema & {
    meta?: { panels?: { id: string; node?: unknown; module?: string; route?: string | string[] }[] };
  };

  it('has one board route, whichever call it is about', () => {
    const paths = (workshop.routes ?? []).map((route) => route.path);

    expect(paths).toContain('/board');
    // The spelling that could never match: a record id is a URI, so it is not one segment.
    expect(paths).not.toContain('/board/:callId');
  });

  it('carries the call in a query parameter, and falls back to the live one', () => {
    const json = JSON.stringify(workshop);

    expect(json).toContain('routeStore.params.call');
    expect(json).toContain('modules.transcribe.liveCollectionId');
    expect(json).not.toContain('./board/$');
  });

  it('changes the call in one navigation, on the page you are already on', () => {
    /*
      Two things this pins. **One** action: the router commits a navigation in a transition, so a
      `setParam` after it wrote the parameter onto the *old* pathname while the router's own write
      landed afterwards — the parameter took effect and the address ended up somewhere no route
      matched, which read as "the panels work and every route says Page not found".

      And the **page it lands on**, which is the one you were on. Naming `board` outright threw you
      onto the board every time you picked a call from the tasks list. Absolute either way, because
      the control doing it is a panel: host chrome, rendered outside the route tree, where a relative
      path has nothing dependable to resolve against.
    */
    const select = JSON.stringify(workshop.meta?.panels?.find((panel) => panel.id === 'calls'));

    expect(select).toContain('spaceStore.spacePath}/${routeStore.templateSegments[0]');
    expect(select).not.toContain('spacePath}/board?call=');
    expect(select).not.toContain('routeStore.setParam');
  });

  it('stops naming a call when a new one starts', () => {
    // `CALL` prefers what the address names, so a new call opened *behind* the one you had been
    // looking at: the transcript and the readout went on showing a finished meeting while a new one
    // was recorded beside them.
    const calls = JSON.stringify(workshop.meta?.panels?.find((panel) => panel.id === 'calls'));
    const start = calls.slice(calls.indexOf('modules.call.goToCall'));

    expect(start).toContain("?call=${''}");
  });

  it('keeps a calendar where the archive of calls used to be', () => {
    // The calls panel does the choosing, from every route, and the transcript panel already shows
    // whichever call is on screen — so the archive was a second copy of both. What a conversation
    // produces and a list cannot show is the half with dates on it.
    const paths = (workshop.routes ?? []).map((route) => route.path);

    expect(paths).toContain('/events');
    expect(paths).not.toContain('/calls');
  });

  it('leaves its panels standing across every route', () => {
    /*
      They were scoped `route: 'board'`, which does not hide a panel — it unregisters the dock, so
      the transcript's scroll position, its subscription and wherever it had been dragged were
      destroyed on the way to the tasks list and rebuilt on the way back. Surviving navigation is
      the whole difference between a panel and a region of a page.
    */
    const scoped = (workshop.meta?.panels ?? []).filter((p) => 'route' in p);

    expect(workshop.meta?.panels?.length).toBeGreaterThan(0);
    expect(scoped).toEqual([]);
  });

  it('carries the call from page to page in the switcher', () => {
    // Panels that stand on every route are about `CALL`, so a link that dropped the parameter would
    // show one call's transcript beside another call's board.
    expect(JSON.stringify(workshop)).toContain("/${nav.segment}?call=${routeStore.params.call ?? ''}");
  });

  it('asks before deleting a call, because a panel is not guarded by the tier', () => {
    /*
      A space template's destructive actions are guarded at the tier boundary — `templateBag` puts
      the host's own prompt in front of anything marked destructive, which is why the calls list in
      `CardsView` needs no dialog. A panel is drawn with the *chrome* bag, which has no guard, so a
      delete there would take a meeting and its whole transcript on one click with nothing in
      between. The dialog is the panel's own.
    */
    const calls = JSON.stringify(workshop.meta?.panels?.find((panel) => panel.id === 'calls'));

    expect(calls).toContain('spaceStore.deleteCollection');
    expect(calls).toContain('Delete this call?');
    // The delete names what the dialog is holding, never the row — the row is gone by then.
    expect(calls).toContain('{"$":"local.confirming"}');
  });

  it('arranges the transcribe module’s panel rather than placing or duplicating it', () => {
    /*
      `module` *and* `node`. The module's own panel reads the call being recorded into, so placing it
      would be one surface about a different meeting beside three about the one on screen — and
      declaring a separate panel instead put both on screen at once, since pressing record anywhere
      opens the module's. Naming the module says "that panel, arranged here": it keeps whether the
      surface is up, this decides what is in it.
    */
    const transcript = workshop.meta?.panels?.find((panel) => panel.id === 'transcript');

    expect(transcript?.node).toBeDefined();
    expect(transcript?.module).toBe('transcribe');
  });

  it('gives the board a height to be laid out in, the whole way down', () => {
    /*
      Both halves, because fixing the lower one alone left the board exactly as blank.

      The canvas sizes itself from its container, so every box above it has to have a height a
      percentage can resolve against. The root was `minHeight: '100%'` — the task list and the
      calendar are taller than the viewport and must grow — which leaves its specified height `auto`,
      and a flex item's post-flex main size counts as definite only where its container's does. So
      the board route stretched down the screen and the canvas inside it still resolved `height:
      100%` to `auto`, to its content, to nothing: the graph read its row, built its node, positioned
      it, and laid it out into a box 2009 pixels wide and 0 high.

      Nothing on screen distinguishes that from a call that produced nothing, which is what it was
      taken for. Pinned rather than left to be noticed again.
    */
    const root = workshop as { props?: Record<string, unknown> };
    const board = (workshop.routes ?? []).find((route) => route.path === '/board') as
      { props?: Record<string, unknown> } | undefined;

    // Definite, so what grows inside it can resolve against it. The scroll container above paints
    // the page background across its whole scrollable area, so pinning this clips nothing.
    expect(root.props?.height).toBe('100%');
    expect(root.props?.minHeight).toBeUndefined();

    expect(board?.props?.flex).toBe('1');
    expect(board?.props?.height).toBeUndefined();
  });
});
