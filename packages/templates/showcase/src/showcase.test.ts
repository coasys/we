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

import type { SchemaNode, TemplatePanel } from '@we/schema-shared';
import { evaluateExpression, listFunctions, parseExpression } from '@we/schema-shared';
import { STATE_FILLS, stateIcon } from '@we/template-kit';
import { describe, expect, it } from 'vitest';

import * as showcase from './index.ts';
import {
  BY_KIND,
  BY_STATE,
  CANVAS_FILL,
  CANVAS_KEY,
  CARD_FILL,
  CARD_KEY,
  HIDDEN_KINDS,
  KIND_DEFAULTS,
  kindFill,
  LENS_PARAM,
  LENS_QUERY,
  LINK_ENTITY,
  LINK_FILL,
  LINK_KEY,
  NO_LENS,
  PLAIN_FILL,
  toggleKindShown,
  toggleLens,
} from './WorkshopKey.ts';

/** The workshop's own name for the call on screen — see `CALL_EXPR` in its schema. */
const CALL_EXPR = 'routeStore.params.call ? routeStore.params.call : modules.call.callRecordId';

type QueryNode = { $queries?: Record<string, unknown> };
type GateNode = { type?: string; props?: { condition?: { $?: string }; else?: unknown } };

/**
 * The nodes on the path down to the first one matching, outermost last.
 *
 * For asserting that something is *underneath* a guard rather than merely beside it in the same
 * JSON — the difference between a query that is never asked and one that is asked and discarded,
 * which a string search cannot tell apart. Walks every object value, so it descends through
 * `props`, `children`, `then`/`else` and `slots` alike without knowing which is which.
 */
function ancestorsOf(root: unknown, matches: (node: unknown) => boolean, trail: unknown[] = []): unknown[] {
  if (typeof root !== 'object' || root === null) return [];
  if (matches(root)) return trail;
  for (const value of Object.values(root)) {
    const found = ancestorsOf(value, matches, [root, ...trail]);
    if (found.length) return found;
  }
  return [];
}

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
        redirect to the parent *pattern* — so `/canvas` became a literal `/space/:spaceId/canvas`,
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
      A template addresses its own screens, not the whole URL. An absolute `/canvas` was correct only
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
 * came back to no call at all, and the canvas you were looking at could not be sent to anybody.
 *
 * A **query parameter**, not a path segment, and that is the part worth pinning: a record id is a
 * URI, so `./canvas/we://…/<uuid>` is several segments, `/canvas/:callId` matches none of them, and
 * every click landed on the catch-all saying "Page not found". Nothing in the expression language
 * can percent-encode; `setParam` writes through `URLSearchParams`, so it does not have to.
 */
describe('the workshop template’s call selection', () => {
  // `TemplatePanel` rather than a shape written out here: the hand-written one had no `dock`, so
  // adding that field to the real type left this file typechecking against a panel that no longer
  // existed.
  const workshop = showcase.workshopTemplate as Schema & { meta?: { panels?: TemplatePanel[] } };

  it('has one canvas route, whichever call it is about', () => {
    const paths = (workshop.routes ?? []).map((route) => route.path);

    expect(paths).toContain('/canvas');
    // The spelling that could never match: a record id is a URI, so it is not one segment.
    expect(paths).not.toContain('/canvas/:callId');
  });

  it('carries the call in a query parameter, and falls back to the live one', () => {
    const json = JSON.stringify(workshop);

    expect(json).toContain('routeStore.params.call');
    expect(json).not.toContain('./canvas/$');
  });

  it('asks the call module which call is live, not the transcriber', () => {
    /*
      `liveCollectionId` means "the record I am writing into", and the transcriber adopts the call's
      record only when it first has something to write — so for the opening stretch of every meeting
      its honest answer is "nothing". Every surface here waited for somebody to speak before it would
      admit a call was happening: an empty canvas, an empty feed, and a calls list that did not mark
      the call you were sitting in.

      The record exists from the first second — `startCall` writes it before anyone joins — and
      `callRecordId` is that. Asserted over the whole schema rather than at the one definition,
      because the same question is asked in four places and only one of them was `CALL`.
    */
    const json = JSON.stringify(workshop);

    expect(json).toContain('modules.call.callRecordId');
    expect(json).not.toContain('modules.transcribe.liveCollectionId');
  });

  it('changes the call in one navigation, on the page you are already on', () => {
    /*
      Two things this pins. **One** action: the router commits a navigation in a transition, so a
      `setParam` after it wrote the parameter onto the *old* pathname while the router's own write
      landed afterwards — the parameter took effect and the address ended up somewhere no route
      matched, which read as "the panels work and every route says Page not found".

      And the **page it lands on**, which is the one you were on. Naming `canvas` outright threw you
      onto the canvas every time you picked a call from the tasks list. Absolute either way, because
      the control doing it is a panel: host chrome, rendered outside the route tree, where a relative
      path has nothing dependable to resolve against.
    */
    const select = JSON.stringify(workshop.meta?.panels?.find((panel) => panel.id === 'calls'));

    expect(select).toContain('spaceStore.spacePath}/${routeStore.templateSegments[0]');
    expect(select).not.toContain('spacePath}/canvas?call=');
    expect(select).not.toContain('routeStore.setParam');
  });

  it('stops naming a call when a new one starts', () => {
    // `CALL` prefers what the address names, so a new call opened *behind* the one you had been
    // looking at: the transcript and the readout went on showing a finished meeting while a new one
    // was recorded beside them.
    const calls = JSON.stringify(workshop.meta?.panels?.find((panel) => panel.id === 'calls'));
    const start = calls.slice(calls.indexOf('modules.call.startCall'));

    expect(start).toContain("?call=${''}");
  });

  it('keeps the call corner on screen whether or not there is a call', () => {
    /*
      The pill alone lived here, so the region appeared with a call and vanished without one — which
      made the corner people had learned to look at the corner that was sometimes missing. Calls had
      no permanent address on screen at all: the rail's launcher is the least discoverable control in
      the app, the panel is a section somebody can close, and this flickered.

      Asserted on the root's own children, because "somewhere in the tree" is also true of the pill
      that used to be mounted there conditionally.
    */
    const region = ((workshop as SchemaNode).children as SchemaNode[])[0];
    expect(region.type).toBe('Row');
    expect((region.props as { position?: string }).position).toBe('fixed');
    // The pill is inside it and still conditional; the region around it is not.
    expect(JSON.stringify(region)).toContain('"condition":{"$":"routeStore.params.call ? routeStore.params.call');
  });

  it('offers a new call from the page rather than from the corner', () => {
    /*
      The corner held a start button beside the pill, shown on exactly the condition each route now
      gates its own placeholder on — so it was never a second way in. It was the same one, smaller
      and at the edge, while somebody with no call was reading the middle of the screen. Three of
      them at once (corner, page, calls panel) and the loudest was the one nobody's eye was on.

      Asserted in both directions, because removing the corner button is only right if the page
      gained one. A template that lost both would look tidier in the diff and strand a first-time
      reader on a screen with no door.
    */
    const corner = JSON.stringify(((workshop as SchemaNode).children as SchemaNode[])[0]);
    expect(corner).not.toContain('modules.call.startCall');
    // The corner still names the call, which is all it is for now.
    expect(corner).toContain('local.callRecord');

    for (const path of ['/kanban', '/calendar']) {
      const route = JSON.stringify((workshop.routes ?? []).find((entry) => entry.path === path));
      expect(route, path).toContain('modules.call.startCall');
    }

    // And the panel's own stays: picking up a call that has finished is the one state no page gate
    // covers, because a page with a call named draws no gate at all.
    expect(JSON.stringify(workshop.meta?.panels?.find((panel) => panel.id === 'calls'))).toContain(
      'modules.call.startCall',
    );
  });

  it('offers it from the canvas too, which cannot host a gate of its own', () => {
    /*
      The canvas is the landing route, so it is where "there is no call yet" is read most often —
      and its placeholder is drawn by `GraphView` out of a string rather than by a node this
      template owns, so there is nothing here to hang a button under. A slot is how a node hands a
      component something already rendered: it lands inside the graph's own centred box and stays
      under the sentence at every size, through every panel opening and closing.

      Gated, because that box answers two questions. `empty` says one thing when there is no call
      and another when a call has produced nothing yet, and only the first is an invitation to start
      one — the same condition the other two routes gate on, so all three agree.
    */
    const canvas = (workshop.routes ?? []).find((entry) => entry.path === '/canvas') as unknown as SchemaNode;
    const graph = (canvas.children as SchemaNode[]).find((child) => child.type === 'GraphView');
    const action = (graph?.slots as Record<string, GateNode> | undefined)?.emptyAction;

    expect(action?.type).toBe('$if');
    expect(action?.props?.condition?.$).toBe(`!(${CALL_EXPR})`);
    expect(JSON.stringify(action)).toContain('modules.call.startCall');

    // The sentence above it tests the same call, parenthesised: `CALL_EXPR` is a ternary, and pasted
    // in bare a chosen call's id became the whole expression — the canvas "said" `ad4m://obj/…`.
    expect((graph?.props?.empty as { $: string }).$.startsWith(`(${CALL_EXPR}) ? `)).toBe(true);
  });

  it('starts a call rather than reopening the one selected in the list', () => {
    /*
      The button was the whole of `goToCall`, which has a branch that continues the call *in the
      address* when nothing is running. That is how the module rail picks up the meeting you are
      reading, and it is the wrong reading of a button labelled "New call": with a call selected
      below it, pressing it reopened the selected one.

      Narrowed rather than swapped, because the other two branches are still wanted — back to your
      own call, or into one already running here instead of opening a second beside it. Only the
      third case starts anything, and only that case reaches `startCall`.
    */
    const calls = JSON.stringify(workshop.meta?.panels?.find((panel) => panel.id === 'calls'));

    /*
      With `args`, and the empty string carries the whole point. A handler with none does not call
      the method with none — it forwards the click, and `startCall` takes an optional anchor id, so
      it was handed a PointerEvent and the backend refused the write. `''` is how `startCall`
      already spells "no anchor".
    */
    expect(calls).toContain('{"$action":"modules.call.startCall","args":[""]}');
    // And it says which of the three it is about to do. The middle one had no words of its own.
    expect(calls).toContain("'Join the call'");
  });

  it('still offers a new call while one is running', () => {
    /*
      The regression this pair exists for, and it only appeared once calls became plural.

      One button branched three ways, and the branch that starts a call is the one the other two
      shadow: the moment anybody in the space was in a call it read "Join the call" — in the panel
      header and in all three route gates, which is every door this template has — so there was no
      way to start a second conversation without leaving the first. The call module had noticed the
      same thing and put a `+` beside its own join prompt; this template had nothing.

      Asserted as the pair rather than as the words, because the failure is one control doing two
      jobs: a start that is only reachable when nothing is running is a start that is missing exactly
      when somebody wants it.
    */
    const calls = JSON.stringify(workshop.meta?.panels?.find((panel) => panel.id === 'calls'));

    // The contextual verb keeps the primary — all three of its readings.
    expect(calls).toContain("'Go to the call'");
    expect(calls).toContain("'Join the call'");
    expect(calls).toContain("'New call'");
    // And starting one stands beside it, on exactly the condition that makes the primary not a start.
    expect(calls).toContain('"condition":{"$":"count(modules.call.liveCalls)"}');
    expect(calls).toContain("'Leave your call and start a new one'");

    // The same pair on the page, which is where somebody with no call is actually looking.
    for (const path of ['/kanban', '/calendar']) {
      const route = JSON.stringify((workshop.routes ?? []).find((entry) => entry.path === path));
      expect(route, path).toContain("'Leave your call and start a new one'");
    }
  });

  it('asks about this space, not about wherever your call is', () => {
    /*
      `modules.call.active` is true of a call in *any* space, and the button was gated on it — so
      standing in a space with no call at all, while in one somewhere else, every door read "Go to
      the call" and led out of the space you were looking at. There was no way to start one where you
      were standing, and nothing said why.

      `liveCalls` is the space on screen and includes your own call when it is here, so it answers
      both halves. Being in a call elsewhere keeps its own control — the call bar's "Back to the call
      in …" — which is the module's to draw.
    */
    const calls = JSON.stringify(workshop.meta?.panels?.find((panel) => panel.id === 'calls'));

    expect(calls).not.toContain('modules.call.active || count(modules.call.liveCalls)');
    expect(calls).toContain('modules.call.active && !modules.call.elsewhere');
  });

  it('joins the call it names rather than the one you are in', () => {
    /*
      `goToCall` answers "bring me to my call", and in a call elsewhere that is a different call from
      the one the button is about: pressed on "Join the call", or on a live row in the list, it took
      you to yours. `joinCall` names an id and leaves whatever you were in, which is what the word on
      both controls promises.
    */
    const calls = JSON.stringify(workshop.meta?.panels?.find((panel) => panel.id === 'calls'));

    // The header's singular default: the first of them, which is all a single button can mean.
    expect(calls).toContain('{"$action":"modules.call.joinCall","args":[{"$":"first(modules.call.liveCalls).id"}]}');
    // And the row's, which names the call beside it — see the next test for why the rows exist.
    expect(calls).toContain('find(modules.call.liveCalls, { recordId: call.id }).id');
  });

  it('says which calls in the list are happening now, and lets you join one', () => {
    /*
      The list is a query over the archive, so a meeting three people were sitting in looked exactly
      like one from last Tuesday — and the header's button cannot cover that gap, being singular:
      with two calls running it joins whichever `liveCalls` lists first and nothing says there was a
      choice. The call module makes the same argument for listing a row per call in its own join bar.

      Asserted on the row's own affordances rather than on the section, because the fix is that a row
      names the call it means: a marker with no way in is the state this replaces.
    */
    const calls = JSON.stringify(workshop.meta?.panels?.find((panel) => panel.id === 'calls'));

    // A live row is told apart by being live, not by being yours — which is what it used to test.
    expect(calls).not.toContain("call.id == modules.call.callRecordId ? 'danger' : 'text-faint'");
    expect(calls).toContain("find(modules.call.liveCalls, { recordId: call.id }) ? 'danger' : 'text-faint'");
    // Who is in it, and the two words that tell your call from somebody else's.
    expect(calls).toContain('"type":"AvatarStack"');
    expect(calls).toContain("'Go to' : 'Join'");
  });

  it('keeps a calendar where the archive of calls used to be', () => {
    // The calls panel does the choosing, from every route, and the transcript panel already shows
    // whichever call is on screen — so the archive was a second copy of both. What a conversation
    // produces and a list cannot show is the half with dates on it.
    const paths = (workshop.routes ?? []).map((route) => route.path);

    expect(paths).toContain('/calendar');
    expect(paths).not.toContain('/calls');
  });

  it('leaves its panels standing across every route', () => {
    /*
      They were scoped `route: 'canvas'`, which does not hide a panel — it unregisters the dock, so
      the transcript's scroll position, its subscription and wherever it had been dragged were
      destroyed on the way to the tasks list and rebuilt on the way back. Surviving navigation is
      the whole difference between a panel and a region of a page.
    */
    const scoped = (workshop.meta?.panels ?? []).filter((p) => 'route' in p);

    expect(workshop.meta?.panels?.length).toBeGreaterThan(0);
    expect(scoped).toEqual([]);
  });

  it('asks for no events until a call is chosen, and says why it is empty-handed', () => {
    /*
      A scope whose anchor does not resolve is DROPPED rather than refused, and pruning WIDENS — so
      with nothing selected the calendar asked for every `EventBlock` in the space and drew them
      all, on a page whose every other surface is about one call, with nothing on screen saying the
      reading had changed. The tasks list has kept this gate since it was written; the calendar was
      the one route that never got it.

      Asserted structurally rather than by looking for the sentence: the query must sit BENEATH the
      `$if`, so it is never asked instead of asked and thrown away. The string spelling of this
      passed while the query still hung off the route root.
    */
    const events = (workshop.routes ?? []).find((route) => route.path === '/calendar');
    const gate = ancestorsOf(events, (node) => Boolean((node as QueryNode).$queries?.events)).find(
      (node) => (node as GateNode).type === '$if',
    ) as GateNode | undefined;

    expect(gate).toBeDefined();
    expect(gate?.props?.condition?.$).toBe(CALL_EXPR);
    expect(JSON.stringify(gate?.props?.else)).toContain('Start or choose a call');
  });

  it('names the call, not the space, when there is nothing on the calendar', () => {
    /*
      `emptyState`'s own sentence is "This space doesn't have any events.", which is about the wrong
      subject twice: the list is scoped to one call, and this branch is also what a day with nothing
      on it shows — so a call with a full month in it announced that the space held no events
      because somebody clicked a quiet Tuesday.
    */
    const events = JSON.stringify((workshop.routes ?? []).find((route) => route.path === '/calendar'));

    expect(events).not.toContain("This space doesn't have any events");
    expect(events).toContain('Nothing on this day.');
    expect(events).toContain('Nothing from this call yet.');
  });

  it('carries the call from page to page in the switcher', () => {
    // Panels that stand on every route are about `CALL`, so a link that dropped the parameter would
    // show one call's transcript beside another call's canvas.
    expect(JSON.stringify(workshop)).toContain("/${nav.segment}?call=${routeStore.params.call ?? ''}");
  });

  it('leaves the delete confirmation to the host, panel or not', () => {
    /*
      This panel used to ask for itself, on the argument that a panel is drawn with the *chrome*
      bag and so escapes the tier's guard. It is not: `TemplatePanelBody` renders a supplied
      panel's contents with the **template** bag, because grants follow authorship rather than
      render site — so `shellStore.requestDestructive` sits in front of this delete exactly as it
      does in `CardsView`. Asking as well produced two dialogs for one click, the template's and
      then the host's.
    */
    const calls = JSON.stringify(workshop.meta?.panels?.find((panel) => panel.id === 'calls'));

    expect(calls).toContain('spaceStore.deleteCollection');
    expect(calls).not.toContain('Delete this call?');
    // The row's own id, not a dialog's holding pen — there is no dialog in between any more.
    expect(calls).toContain('"args":[{"$":"call.id"}]');
    /*
      Whether the deleted call was the one on screen is captured on the click, not asked afterwards:
      by the time the delete resolves the record is gone and the row with it, so an `onSuccess`
      comparing against it would be comparing against nothing.
    */
    expect(calls).toContain('{"$setLocal":"deletingIsCurrent"');
    expect(calls).toContain('{"$":"local.deletingIsCurrent"}');
  });

  it('marks a live recording in a red that reads as one', () => {
    /*
      `dangerText` is a derived foreground — its lightness is moved until it is legible against a
      card, which in a dark theme lifts it into a pale pink. Right for an error sentence somebody
      has to read; wrong for a recording indicator, which is not text and has to register as an
      alarm at a glance. The fill role holds a pinned lightness and full chroma.
    */
    const json = JSON.stringify(workshop);

    expect(json).not.toContain("'danger-text'");
    /*
      The calls list's own dot. The transcript panel's is the module's now — see its
      `Panel.schema.test.ts`, which is where that half of this test went.

      It asks whether the row is live rather than whether it is *yours*, which is a separate test —
      this one is only about the colour that answer is drawn in.
    */
    expect(json).toContain("find(modules.call.liveCalls, { recordId: call.id }) ? 'danger' : 'text-faint'");
  });

  it('draws a card nobody has agreed to yet as unsettled, and offers the decision on it', () => {
    /*
      An extraction pass can stage a whole record, and a staged record is in the graph: it answers
      the canvas's query exactly as an accepted one does, so the card was indistinguishable from one
      somebody had said yes to. The proposal list is the only thing that knows the difference.
    */
    const json = JSON.stringify(workshop);

    // Only a record a pass made is unsettled; an agreed one with a change suggested is `changed`.
    expect(json).toContain('"pending":{"$":"modules.transcribe.unconfirmedIds"}');
    expect(json).toContain('"changed":{"$":"modules.transcribe.changedIds"}');
    /*
      `data.pending`, with the prefix — the thing that was wrong the first time.

      A match clause reads a node's own field for a bare key and the seed's data bag behind `data.`,
      so `{ pending: true }` named a field that is not there and matched nothing at all: no card
      faded, no card offered the decision, on a canvas full of suggestions. Nothing failed, because
      nothing matching is what a clause does when it is right and there is nothing to match.
    */
    // Dashed as well as faded, as a draft is on the board and in the key.
    expect(json).toContain(
      '{"when":{"data.pending":true},"style":{"opacity":0.5,"borderStyle":"dashed","borderColor":"border-strong","borderWidth":2}}',
    );
    expect(json).not.toContain('"when":{"pending"');
    /*
      Resolvable from the card itself, so deciding about one you can see does not mean finding its
      line in a list somewhere else and matching them up by reading.

      The controls carry the same `{ pending: true }` clause the fade does — one fact read twice, so
      the cards that look unsettled and the cards offering the decision cannot come apart.
    */
    expect(json).toContain('modules.transcribe.acceptProposal');
    expect(json).toContain('modules.transcribe.rejectProposal');
    // Both halves toned, which is the point of the pair: a red cross beside a grey tick reads as one
    // real decision and one placeholder.
    expect(json).toContain('"id":"accept","icon":"check","title":"Accept"');
    expect(json).toContain('"when":{"data.pending":true},"tone":"positive"');
    expect(json).toContain('"when":{"data.pending":true},"tone":"danger"');
    expect(json).toContain('"id":"reject"');
  });

  it('tells an agreed card with a change suggested apart, and lets a reader put drafts away', () => {
    /*
      An agreed record a pass merely had an opinion about used to be faded like a draft. It keeps its
      look now, with an accent edge and a way into the inspector where the change is answered; and
      the one switch — in the key here, in the headers of the board and the calendar — hides drafts
      only, through the address so all three pages agree.
    */
    const json = JSON.stringify(workshop);

    // Amber rather than the accent a selected card wears, so the two outlines cannot be confused.
    expect(json).toContain('{"when":{"data.changed":true},"style":{"borderColor":"warning-text","borderWidth":2}}');
    expect(json).toContain('"id":"review"');
    expect(json).toContain(
      `"hidden":{"$":"(routeStore.params.suggestions == 'hide') ? modules.transcribe.unconfirmedIds : []"}`,
    );
    expect(json).toContain('"$action":"modules.transcribe.applyChange"');
    expect(json).toContain('Pending acceptance hidden');
    // Parked in slots a card fits, and pinned where it is drawn when kept.
    expect(json).toContain('"layout":{"type":"manual","options":{"size":{"width":180,"height":135}');
    expect(json).toContain(
      `"$action":"recordStore.placeOnCanvas","args":[{"$":"${CALL_EXPR}"},{"$":"event.recordId"},{"$":"event.recordType"},{"$":"event.x"},{"$":"event.y"}]`,
    );
    // The calendar reads its events through the same filter the board does.
    expect(json).toContain(
      "((routeStore.params.suggestions == 'hide') ? local.events.filter(r, !(r.id in modules.transcribe.unconfirmedIds)) : local.events)",
    );
  });

  it('draws the canvas off the call’s own list of what is being extracted', () => {
    /*
      What a space extracts is a community decision, changeable mid-call from the chips the
      extraction panel draws. Anything downstream that named the kinds itself was therefore a bug
      waiting on one click: `['TaskBlock', 'EventBlock']` was written into the canvas's `contains`,
      so turning a third model on produced records in the collection and nothing on the canvas, with
      no sign of why.

      Read per call rather than for the live one. Those differ the moment somebody narrows a call,
      and the canvas is about whichever call the address names — which is exactly the mismatch that
      made this template's own extraction panel wrong before the module's absorbed it.
    */
    const json = JSON.stringify(workshop);

    expect(json).toContain(`modules.transcribe.extractionFor[${CALL_EXPR}].targets.map(t, t.entity)`);
    expect(json).not.toContain('"TaskBlock","EventBlock"');
  });

  it('inspects the selected card from a panel, through the model’s own declaration', () => {
    /*
      A community defines a model, extraction writes one, and it lands on the canvas as a card nobody
      can look inside. The panel names no property of anything: `recordStore.displays` is derived
      from the model's own declaration, so a model adopted this morning renders with nothing written
      for it.

      The selection travels in the address rather than in a local, because a panel is not inside the
      route's tree — the two cannot share a `$localState`, and the address is the one thing both can
      read. Two parameters, since a schema cannot ask what type an id is.
    */
    const inspector = workshop.meta?.panels?.find((panel) => panel.id === 'inspector');
    const json = JSON.stringify(workshop);

    expect(inspector).toBeTruthy();
    expect(JSON.stringify(inspector)).toContain('recordStore.displays[routeStore.params.cardType]');
    expect(json).toContain('"syncParam":"card"');
    expect(json).toContain('"syncParam":"cardType"');
    // Set from the click, cleared only when the selection actually empties — an unguarded clear
    // would race the click that set it.
    expect(json).toContain('{"$setLocal":"inspectingType","value":{"$":"event.recordType"}}');
    expect(json).toContain('"condition":{"$":"!count(arg)"}');
  });

  it('connects from the card rather than from a mode', () => {
    /*
      `connect-nodes` claims a press anywhere on a node, so it has to be armed: a switch turned on to
      connect and off again to move cards. Forgetting it in either direction is a gesture doing
      something nobody asked for — drawing a line when you meant to move a card, or moving a card
      when you meant to draw a line.

      The handles on a selected card's edges need no arming, because the target is what makes the
      gesture unambiguous. They end in the same `edgeCreate`, so the handler is unchanged.
    */
    const json = JSON.stringify(workshop);

    expect(json).not.toContain('connect-nodes');
    expect(json).not.toContain('local.connecting');
    /*
      And the drop writes the connection rather than asking about it.

      `connectNodesNow`, not `connectNodes` — the substring is why this asserts the whole action
      path. The knowledge map keeps the form, where the claim is what the map is for; here the
      arrangement is the work and a modal per line is a mode change in the middle of a spatial
      gesture, on the one surface where every other gesture writes silently.
    */
    expect(json).toContain('"$action":"recordStore.connectNodesNow"');
    expect(json).not.toContain('"$action":"recordStore.connectNodes"');
    /*
      With the new line selected, which is the half that makes it discoverable.

      A line that appears with nothing selected teaches nobody that it is a record with a label, a
      kind and an author. Opening the inspector on it puts those in front of the person who drew it.
    */
    expect(json).toContain('{"$setLocal":"inspecting","value":{"$":"result"}}');
    /*
      The record form is still here, and still needed: `createOnCanvas` opens a draft, and a draft
      whose non-nullness mounts a modal needs something to mount it. The modal is placed by the
      default template's graph view, and this template supplies its own canvas — so without it the
      double-click completed, the store opened a form, and the screen showed nothing.
    */
    expect(json).toContain('recordStore.recordDraft');
    expect(json).toContain('recordStore.saveRecord');
  });

  it('gives a drawn line a way to be removed, since nothing asks before it exists', () => {
    /*
      Immediate creation takes away the modal's Cancel, which was the only way out of a line drawn by
      accident. Two things put one back, and neither is an edge toolbar: a card's bar works because a
      card is a box with a free top edge, where a selected line's whole length is already committed
      to the handles that bend it — for a straight route the midpoint, where a bar would go, is
      exactly where the "drag to bend the line here" grip sits.

      So: the inspector, which is the one surface that opens a card and a line through the same two
      parameters; and the delete key, for the case where reaching for a panel is disproportionate.
    */
    const json = JSON.stringify(workshop);

    // Guarded on `event.recordId`, which the graph fills only for a selection of exactly one record
    // — the host's delete confirmation is modal and per record, so N of them would stack N dialogs.
    expect(json).toContain('"onDeleteSelection"');
    expect(json).toContain('"condition":{"$":"event.recordId"}');

    // Through `record.delete` in both places, so the host's own confirmation stands in front of a
    // keystroke that has no undo behind it.
    expect(json).toContain('"$action":"record.delete"');

    // And the panel's own, which takes the id from the address rather than from a node payload —
    // the inspector is a panel, so the selection reaches it as parameters and nothing else.
    expect(json).toContain('"args":[{"$":"routeStore.params.cardType"},{"$":"routeStore.params.card"}]');
  });

  it('offers a connection’s kind where the line is read, not only where it was drawn', () => {
    /*
      `Relationship.relationshipTypeId` is absent from `authoring.fields` on purpose — the kinds are
      a list to pick from, not something to type — and `displays` derives its field list from that,
      so the generated panel draws it nowhere. With the create modal gone from this surface the
      community's vocabulary would have become unreachable from the canvas entirely.
    */
    const json = JSON.stringify(workshop);

    expect(json).toContain('"relationshipKinds":{"entity":"RelationshipType"');
    expect(json).toContain('relationshipTypeId');

    /*
      And the options come from a plain map.

      A schema cannot prepend to a list. The interpolation that looks like it can — two lists inside
      a template literal — evaluates to a *string*, so `options` receives "[object Object]" and the
      select renders with nothing in it. That spelling was live in `recordForm`'s kind picker, which
      is to say the picker never had any options; the unset state is the placeholder now, and the
      way back to it is a button beside the select.
    */
    expect(json).not.toContain('[{ label: ');
    expect(json).toContain('local.relationshipKinds.map(item, { label: item.name, value: item.id, icon: item.icon })');
  });

  it('accounts for both of the module’s panels, so neither is drawn twice', () => {
    /*
      The transcript entry named the module and the extraction entry named nothing, so the module's
      own extraction surface had no counterpart here — it opened *beside* this template's version the
      moment a pass ran. Two entries naming two docks line up one-to-one with what the module
      contributes, which is what makes placing them mean something.
    */
    const panels = workshop.meta?.panels ?? [];
    const placed = panels.filter((panel) => panel.module === 'transcribe');

    expect(placed.map((panel) => panel.dock).sort()).toEqual(['extraction', 'transcript']);
  });

  it('offers a delete on every card, not only on the unsettled ones', () => {
    /*
      Extraction proposes things that are simply wrong about a conversation, and one that has been
      accepted — or predates the proposal machinery — had no way off the canvas from the canvas.

      Through `record.delete` rather than a store action, so it is guarded by the host's own
      confirmation like every destructive call a template can name. The accept and discard controls
      need none: discarding a suggestion removes something nobody agreed to, and a dialog in front of
      that is a question about a question.
    */
    const json = JSON.stringify(workshop);

    expect(json).toContain('"id":"delete","icon":"trash"');
    expect(json).toContain('record.delete');
  });

  it('does not offer delete beside discard on a card still awaiting a decision', () => {
    /*
      They look like the same button and are not. Discarding resolves the suggestion; deleting only
      removes the record, leaving the staged overlay behind it — so the extraction panel would go on
      offering a decision about something that no longer exists.

      `{ exists: false }` rather than `{ not: true }`: the seed writes the flag only on the cards it
      applies to, so "settled" is the absence of the field.
    */
    const json = JSON.stringify(workshop);

    expect(json).toContain('"id":"delete","icon":"trash","title":"Delete","when":{"data.pending":{"exists":false}}');
  });

  it('places the transcribe module’s transcript panel rather than writing a second one', () => {
    /*
      There was a body here, for one reason: the module's panel read the call being *recorded into*,
      so placing it would have been one surface about a different meeting beside three about the one
      on screen. Supplying a body bought that at the price of a second copy of the header, the feed
      and the gating — and the copy drifted, never gaining the module's coverage readout or its
      capture status, so this template said less about a failing microphone than the default one did.

      Following the address is what a transcript panel should do everywhere, so it moved into the
      module. What is left here is where the panel goes, which is what a template's panel entry is
      for. `node` being absent is the assertion: with one, this template owns a copy again.
    */
    const transcript = workshop.meta?.panels?.find((panel) => panel.id === 'transcript');

    expect(transcript?.module).toBe('transcribe');
    expect(transcript?.dock).toBe('transcript');
    expect(transcript?.node).toBeUndefined();
    expect(transcript?.snap).toBe('left');
  });

  it('gives the canvas a height to be laid out in, the whole way down', () => {
    /*
      Both halves, because fixing the lower one alone left the canvas exactly as blank.

      The canvas sizes itself from its container, so every box above it has to have a height a
      percentage can resolve against. The root was `minHeight: '100%'` — the task list and the
      calendar are taller than the viewport and must grow — which leaves its specified height `auto`,
      and a flex item's post-flex main size counts as definite only where its container's does. So
      the canvas route stretched down the screen and the canvas inside it still resolved `height:
      100%` to `auto`, to its content, to nothing: the graph read its row, built its node, positioned
      it, and laid it out into a box 2009 pixels wide and 0 high.

      Nothing on screen distinguishes that from a call that produced nothing, which is what it was
      taken for. Pinned rather than left to be noticed again.
    */
    const root = workshop as { props?: Record<string, unknown> };
    const canvas = (workshop.routes ?? []).find((route) => route.path === '/canvas') as
      { props?: Record<string, unknown> } | undefined;

    // Definite, so what grows inside it can resolve against it. The scroll container above paints
    // the page background across its whole scrollable area, so pinning this clips nothing.
    expect(root.props?.height).toBe('100%');
    expect(root.props?.minHeight).toBeUndefined();

    expect(canvas?.props?.flex).toBe('1');
    expect(canvas?.props?.height).toBeUndefined();
  });
});

/**
 * Lanes, proved on the two templates that wanted them.
 *
 * A model the showcase does not exercise is a model that drifts. Twitter's sections are the home
 * lane case; Workshop's left pair are the displacing lane case. Kanban's columns are deliberately
 * neither — `$each` over collections is content, not lanes — and that absence is the counter-example
 * that keeps the rule honest.
 */
describe('the timeline’s sections', () => {
  const twitter = showcase.twitterTemplate as Schema & { meta?: { panels?: TemplatePanel[] } };
  const panels = twitter.meta?.panels ?? [];

  it('start in the right-hand lane, and are real', () => {
    // Both declare a home; neither is a spacer. The column this replaced was empty on the grounds
    // that a rail wired to nothing is a lie, so each section here reads a store or a query.
    expect(panels.map((panel) => panel.home)).toEqual(['right', 'right']);
    const json = JSON.stringify(panels);
    expect(json).toContain('spaceStore.members');
    expect(json).toContain('SignalType');
  });

  it('name where a click breaks them out to, and a lane on each side to be carried between', () => {
    expect(panels.every((panel) => panel.snap)).toBe(true);
    const outlets = JSON.stringify(twitter).match(/"type":"\$panels","props":\{"lane":"(\w+)"/g) ?? [];
    expect(outlets.map((match) => match.replace(/.*"lane":"(\w+)".*/, '$1')).sort()).toEqual(['left', 'right']);
  });

  it('keeps the feed as a route, not a section', () => {
    // A section's node has no router to hand `$routes` its pages. Pinned so nobody moves the routes
    // into a section for "feed full screen" and gets an empty column.
    expect(panels.some((panel) => JSON.stringify(panel.node).includes('$routes'))).toBe(false);
    expect(JSON.stringify((twitter as { children?: unknown }).children)).toContain('$routes');
  });
});

describe('the workshop’s left-hand lane', () => {
  const workshop = showcase.workshopTemplate as Schema & { meta?: { panels?: TemplatePanel[] } };
  const left = (workshop.meta?.panels ?? []).filter((panel) => panel.snap === 'left');

  it('is one sidebar cut in two — both displacing, sharing a band', () => {
    expect(left.map((panel) => panel.id)).toEqual(['transcript', 'extraction']);
    expect(left.every((panel) => panel.displace && panel.band === 0)).toBe(true);
    expect(left.map((panel) => panel.order)).toEqual([0, 1]);
  });

  it('gives the transcript a floor, since below it the text is a column of single words', () => {
    expect(left.find((panel) => panel.id === 'transcript')?.min?.width).toBeGreaterThan(0);
  });

  it('splits the column evenly — the same base and the same share each', () => {
    // A lane divides base-plus-slack, so only equal bases with equal grows come out half and half.
    expect(new Set(left.map((panel) => panel.size)).size).toBe(1);
    expect(left.map((panel) => panel.grow)).toEqual([1, 1]);
  });
});

describe('the workshop’s right-hand column', () => {
  const workshop = showcase.workshopTemplate as Schema & { meta?: { panels?: TemplatePanel[] } };
  const right = (workshop.meta?.panels ?? []).filter((panel) => panel.snap === 'right');

  it('is one sidebar cut in two — both displacing, sharing a band', () => {
    expect(right.every((panel) => panel.displace && panel.band === 0)).toBe(true);
  });

  it('is the inspector over the calls list, half each, and nothing else', () => {
    /*
      The pattern of the left-hand lane, mirrored. Anything else snapped here joins the column and
      takes a share of both — the key and the call window both did — so the membership is asserted
      and not just the order.
    */
    expect([...right].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((panel) => panel.id)).toEqual([
      'inspector',
      'calls',
    ]);
    expect(new Set(right.map((panel) => panel.size)).size).toBe(1);
    expect(right.map((panel) => panel.grow)).toEqual([1, 1]);
  });
});

describe('the workshop’s call window', () => {
  const workshop = showcase.workshopTemplate as Schema & { meta?: { panels?: TemplatePanel[] } };
  const call = workshop.meta?.panels?.find((panel) => panel.module === 'call');

  it('is placed but not opened, so entering the space never starts a call', () => {
    // Opening a module's panel invokes its launcher, and the call module's launcher joins a call.
    expect(call?.open).toBe(false);
  });

  it('opens bottom-centre as a strip, when a call opens it', () => {
    expect(call?.snap).toBe('bottom');
    expect(call?.displace).toBeFalsy();
    expect(call?.box?.width).toBeGreaterThan(call?.box?.height ?? Infinity);
  });
});

describe('the workshop template’s three placeholders', () => {
  const workshop = showcase.workshopTemplate as Schema & { meta?: { panels?: TemplatePanel[] } };

  it('centres them all on the same line', () => {
    /*
      A gate centres itself in the box it is given, so vertical padding anywhere ABOVE it moves it.

      The tasks and events routes carried `pt: '900'` / `pb: '600'` on the route itself, to clear the
      fixed nav pill and leave room under a long board — which put their midpoint 16px below the
      canvas's, whose placeholder centres in the whole route because a canvas has no padding. Too
      small to see in a screenshot and exactly big enough to read as a jump when somebody clicks
      between the three.

      So the band belongs to the branch that draws content, not to the route. Asserted as the shape
      rather than by measuring anything: nothing between the route and the gate may carry vertical
      padding, and the content branch must still have it.
    */
    for (const path of ['/kanban', '/calendar']) {
      const route = (workshop.routes ?? []).find((entry) => entry.path === path) as unknown as SchemaNode;
      const measure = (route.children as SchemaNode[])[0];
      const gate = (measure.children as SchemaNode[])[0];
      const content = (gate.props as { then?: SchemaNode })?.then;

      for (const [name, node] of [
        ['route', route],
        ['measure', measure],
      ] as const) {
        const props = (node.props ?? {}) as Record<string, unknown>;
        for (const key of ['p', 'py', 'pt', 'pb']) {
          expect(props[key], `${path} ${name}.${key}`).toBeUndefined();
        }
      }

      /*
        And the band is still there, on the half that wants it — with a top that is *derived* from
        the pills rather than a token that comes close to them.

        It was `pt: '900'`, 64px, against a bar whose bottom edge is 12 + 40 + 16 = 68 and more
        under a theme that adds to control heights. Both routes began under the chrome they were
        meant to clear. Asserted as the shape — an expression naming the control height and the
        theme's offset — because the alternative is pinning a number that is exactly the kind of
        number this replaced.
      */
      /*
        The kanban asks one more question before it has content: whether the call has a board. Its
        "no board yet" gate centres in the call branch, so that branch must be unpadded and take the
        height too, and the band moves down onto the board and the spinner.
      */
      let banded = content;
      if (path === '/kanban') {
        const props = (content?.props ?? {}) as Record<string, unknown>;
        for (const key of ['p', 'py', 'pt', 'pb']) {
          expect(props[key], `${path} call branch.${key}`).toBeUndefined();
        }
        expect(props.flex, `${path} call branch.flex`).toBe('1');
        const hasBoard = (content?.children as SchemaNode[])[0].props as { then?: SchemaNode; else?: SchemaNode };
        const loaded = hasBoard.else?.props as { else?: SchemaNode };
        expect((loaded.else?.props as Record<string, unknown>)?.pt, `${path} spinner band`).toBeDefined();
        banded = hasBoard.then;
      }

      const band = (banded?.props ?? {}) as Record<string, unknown>;
      expect(String(band.pt), path).toContain('var(--we-component-height-md)');
      expect(String(band.pt), path).toContain('var(--we-theme-control-height-offset, 0px)');
      expect(band.pb, path).toBe('600');
    }

    // The canvas is the one they are lining up against, so it must stay unpadded too.
    const canvas = (workshop.routes ?? []).find((entry) => entry.path === '/canvas') as unknown as SchemaNode;
    const canvasProps = (canvas.props ?? {}) as Record<string, unknown>;
    for (const key of ['p', 'py', 'pt', 'pb']) {
      expect(canvasProps[key], `/canvas.${key}`).toBeUndefined();
    }
  });

  it('gives the board the whole width and keeps the calendar to a measure', () => {
    /*
      A measure caps prose and grids that reflow; it caps a board's *column count*, which is not the
      same thing and is not something anybody chose. The columns are a fixed 300px each, so
      `var(--we-layout-lg)` — 1200 — was three of them and the edge of a fourth on a screen with room
      for six, the rest behind a horizontal scroll with empty page either side of it.

      Asserted in both directions, because uncapping the board is only interesting next to the route
      that stays capped: the calendar's month grid reflows and wants the measure.
    */
    const measureOf = (path: string) => {
      const route = (workshop.routes ?? []).find((entry) => entry.path === path) as unknown as SchemaNode;
      return ((route.children as SchemaNode[])[0].props ?? {}) as Record<string, unknown>;
    };
    expect(measureOf('/kanban').maxWidth).toBeUndefined();
    expect(measureOf('/calendar').maxWidth).toBe('var(--we-layout-lg)');
    // Still full width and still the box the gate centres in — the cap was the only thing removed.
    expect(measureOf('/kanban').width).toBe('100%');
    expect(measureOf('/kanban').flex).toBe('1');
  });
});

/**
 * The workshop's key: what the colours mean, and where each layer is decided.
 *
 * Three layers — by kind, by state, the card's own colour — and the tests are about the seams
 * between them rather than the drawing: which record each reads, where the lens lives, and that the
 * three pages read one policy.
 */
describe('the workshop’s key', () => {
  const workshop = showcase.workshopTemplate as Schema & { meta?: { panels?: TemplatePanel[] } };
  const json = JSON.stringify(workshop);
  const route = (path: string) =>
    JSON.stringify((workshop.routes ?? []).find((entry) => entry.path === path) as unknown as SchemaNode);
  const panel = (id: string) => JSON.stringify(workshop.meta?.panels?.find((entry) => entry.id === id));

  it('is a panel, open, floating in the top-right corner', () => {
    /*
      Closable and surviving the move between three pages — the tests the panel contract sets. Open,
      for the inspector's reason: a lens somebody has to find first is a lens nobody turns on. In a
      corner rather than the right-hand column: a legend over the canvas, not a third seat taking
      height from the two panels beside it — and not a tab, which a space template cannot bring
      forward.
    */
    const key = workshop.meta?.panels?.find((entry) => entry.id === 'key');

    expect(key?.node).toBeDefined();
    expect(key?.snap).toBe('top-right');
    expect(key?.open).toBeUndefined();
    // A corner cannot displace, and a legend is tall and narrow where every named size is 16:9.
    expect(key?.displace).toBeFalsy();
    expect(key?.box?.height).toBeGreaterThan(key?.box?.width ?? Infinity);
  });

  it('keeps the lenses in the address, and every navigation carries them', () => {
    /*
      A panel and a route cannot share a local, so the lens lives where the inspector's selection
      does. And every navigation this template makes spells its query in full — an explicit `?`
      drops what the address held — so each one has to carry it or a page switch resets the colours.
    */
    expect(panel('key')).toContain('routeStore.setParam');
    expect(panel('key')).toContain(`"${LENS_PARAM}"`);
    // The switcher, and the one navigation the calls panel and the start button share.
    expect(json).toContain(`?call=\${routeStore.params.call ?? ''}${LENS_QUERY}`);
    expect(json).toContain(`?call=\${''}${LENS_QUERY}`);
    // A result equal to the default is written as nothing, so an ordinary link stays clean.
    expect(JSON.stringify(toggleLens('state'))).toContain("? '' : 'none'");
    expect(JSON.stringify(toggleLens('kind'))).toContain("? 'kind,state' : ''");
  });

  it('builds the canvas’s colours from the space’s key, not from the seed', () => {
    /*
      The seed could read a canvas's own TypeStyles and stamp them onto each node — and a mapping
      the seed swallowed would be one only the graph could see. The key is the space's, wanted on
      the board and the calendar too, so the template queries it and writes the rules itself.
    */
    const canvas = route('/canvas');

    expect(canvas).not.toContain('"typeStyles":"TypeStyle"');
    expect(canvas).toContain('"anchor":"Space","via":"typeStyles"');
    expect(canvas).toContain('.map(s, { when: { type: s.nodeType }, style: { color: s.color } })');
    expect(canvas).toContain("spaceStore.taskStates.map(s, { when: { 'data.status': s.slug }");
    // The query waits for the space rather than reading every canvas's key while it settles.
    expect(canvas).toContain('"when":{"$":"spaceStore.currentSpace.id"}');
  });

  it('hides a card’s own colour while a lens is on, and never its size', () => {
    /*
      A lens that left individually coloured cards in their own colours would be a key that lied
      about some of them. So the freeform rule is an expression that contributes nothing while
      either lens is on — where the size a reader dragged out is a fact about the card whatever
      lens is on, and stays a plain rule.
    */
    const canvas = route('/canvas');

    expect(canvas).toContain(`${NO_LENS} ? [{ style: { color: { from: 'data.canvasColor' } } }] : []`);
    expect(canvas).not.toContain('"color":{"from":"data.canvasColor"}');
    expect(canvas).toContain('"width":{"from":"data.canvasWidth"},"height":{"from":"data.canvasHeight"}');
  });

  it('scopes its contents to the canvas without scoping the panel', () => {
    /*
      The colours are the canvas's, so the lenses and the legend answer nothing on the other two
      pages — but `route: 'canvas'` on the panel entry would be the wrong way to say so. Leaving a
      route UNREGISTERS a scoped panel, destroying its scroll position and both its subscriptions on
      every crossing; the transcript and the readout are unscoped for exactly that reason. The
      declaration is what a panel is; whether it has anything to say today is about its contents.

      So: no `route` on the entry, the branch inside it, and a sentence rather than a blank panel —
      an empty key reads as one that failed to load.
    */
    const entry = (workshop.meta?.panels ?? []).find((p) => p.id === 'key');
    expect(entry?.route).toBeUndefined();

    const key = panel('key');
    expect(key).toContain("'canvas' in routeStore.segments");
    expect(key).toContain('Colours are on the canvas.');
    // The subscriptions stay outside the branch, so crossing back does not refetch them.
    const body = key.slice(key.indexOf("'canvas' in routeStore.segments"));
    expect(body).not.toContain('"entity":"TypeStyle"');
    expect(body).not.toContain('"entity":"Placement"');
  });

  it('writes a kind’s colour to the space and a state’s to the vocabulary', () => {
    /*
      Two mappings, two homes, one control. A kind's colour has no other home, so the key keeps it on
      the space — a call's canvas is not a board anybody wants to recolour every meeting. A state's
      belongs to the community's vocabulary, where a board's column heading reads it too, so the row
      writes there and the `Edit` link still leads to the rest of what a state is.

      The state row was read-only on the argument that Settings is where a state's colour is set.
      Settings could not set it: `createTaskState` took a colour and nothing updated one, so the three
      states a space starts with — which ship without — could never have one at all.
    */
    const key = panel('key');

    expect(key).toContain('recordStore.setSpaceTypeColor');
    expect(key).toContain('spaceStore.currentSpace.id');
    expect(key).not.toContain('recordStore.setTypeColor');
    expect(key).toContain('"$action":"spaceStore.updateTaskState"');
    expect(key).toContain('"$action":"shellStore.openSpaceSettings","args":["vocabulary"]');
    expect(key).toContain('spaceStore.offeredTaskStates');
    // A state is addressed by slug, which is what lets one of the three virtual defaults be coloured
    // at all: writing to it is the act that adopts it.
    expect(key).toContain('"args":[{"$":"state.slug"},{"color":{"$":"event.detail"}}]');
    expect(key).toContain('"args":[{"$":"state.slug"},{"color":""}]');
    // Naming a state is Settings' business; the key only ever changes one that exists.
    expect(key).not.toContain('createTaskState');
    // The same picker the vocabulary uses, tokens first, on every row of the key: the three canvas
    // rows, a kind's, and a state's.
    const pickers = key.split('"type":"we-color-picker","props":{"tokens":true').length - 1;
    expect(pickers).toBe(5);
  });

  it('turns each lens on from the heading of the section it governs, and hides the rest', () => {
    /*
      The lenses were a pair of buttons in the panel's header, which put the controls one place and
      what they did another — and left both lists on screen whether or not either was colouring
      anything. A switch on the heading says what the section below it is for, and the section is
      drawn only while it is on, so the panel shows what is being read and nothing else.

      Still the address rather than a local: a panel and a route cannot share one.
    */
    const key = panel('key');

    expect(key).toContain('"type":"we-switch"');
    expect(key).toContain('routeStore.setParam');
    // Each list is behind its own lens rather than merely faded.
    expect(key).not.toContain('? 1 : 0.6');
    expect(key).toContain(`"condition":{"$":"${BY_KIND}"},"enterTransition"`);
    expect(key).toContain(`"condition":{"$":"${BY_STATE}"},"enterTransition"`);
  });

  it('offers what a canvas is made of above the lenses, as the key’s own rows', () => {
    /*
      The three things on a canvas that are not a kind of card: the plain fill, the ground behind it,
      and the lines between. Each was a constant in the template — the colour every canvas certainly
      shows was the one nobody could change. All three are `TypeStyle` rows on the space like every
      other colour in the key, under names no model can have, so they arrive in the same
      subscription and clear the same way; `lensNodeRules` filters them out of the per-kind rules
      rather than emitting one that matches nothing.
    */
    const key = panel('key');
    const canvas = route('/canvas');

    expect(key).toContain('"Cards"');
    expect(key).toContain('"Background"');
    expect(key).toContain('"Connections"');
    for (const reserved of [CARD_KEY, CANVAS_KEY, LINK_KEY]) expect(key).toContain(`"${reserved}"`);
    // The graph takes them as its base fill, its ground and its edge colour.
    expect(canvas).toContain(`[{ style: { color: ${CARD_FILL} } }]`);
    expect(canvas).toContain(`"bg":{"$":"${CANVAS_FILL}"}`);
    expect(canvas).toContain(`"showLabel":true,"color":{"$":"${LINK_FILL}"}`);
    expect(canvas).toContain(`filter(s, !(s.nodeType in ['${CARD_KEY}', '${CANVAS_KEY}', '${LINK_KEY}']))`);
  });

  it('never offers a fill for a connection among the kinds', () => {
    /*
      `Relationship` is one of the models a call can extract, and the kinds come from that list — so
      it was offered a colour in the Kinds section, where picking one changed nothing at all: the
      canvas seed takes relationships as `connections` and draws them as lines, and a line has no
      fill. Its colour is the Connections row now: the query for what extraction wrote does not ask
      for it, and the kinds list skips it again for a placement that names it.
    */
    const key = panel('key');

    expect(key).toContain(`targets.map(t, t.entity)).filter(k, k != '${LINK_ENTITY}')"`);
    expect(key).toContain(`local.placements.map(p, p.nodeType)).filter(k, k != '${LINK_ENTITY}')`);
  });

  it('says what is missing rather than listing a key about nothing', () => {
    /*
      The panel is reachable from three pages and from a page with no call, and without a call the
      lists are not merely empty — the kinds are what this space *could* extract rather than what is
      on a canvas, so the panel filled with rows about nothing. Both absences are the same kind of
      answer: one sentence naming what is missing, with the way out already on screen.
    */
    const key = panel('key');

    expect(key).toContain(`${CALL_EXPR}`);
    expect(key).toContain('Choose or start a call.');
    expect(key).toContain('Colours are on the canvas.');
  });

  it('draws every row the same way — a swatch, a glyph, a name, a reset', () => {
    /*
      One row shape for the canvas's two colours, each kind and each state. The glyph on a state is
      the vocabulary's — its own, or the shape its semantic falls back to — from the kit's table
      rather than from a chain written out here, which is how this and Settings had drifted into
      drawing the same state differently.

      The reset is `arrow-counter-clockwise` and comes after the name: an `x` reads as delete, and
      leading the row it sat between two marks and the word saying what they are about.
    */
    const key = panel('key');

    expect(key).toContain(stateIcon('state'));
    expect(key).toContain('"name":"arrow-counter-clockwise"');
    expect(key).not.toContain('"name":"x"');
    // Every mark is the picker's swatch, at one size.
    expect(key).toContain('"--we-color-picker-swatch":"24px"');
  });

  it('spells every fill as CSS, and every card fill as one that does not invert', () => {
    /*
      The picker emits `var(--we-color-…)` or a literal, and a chosen colour is whatever it emitted —
      so a default written as a bare token name would be the one value in the chain the picker's own
      swatch could not show.

      The card fills are absolute rather than roles, which is the second half. `accent-muted` and
      `success-surface` are tinted panels defined relative to the page, so they invert with it: in a
      dark theme "doing" and "done" came out DARKER than an uncoloured card and a few points off the
      canvas's own ground. A card is an object rather than a panel — the post-it said so in a hex
      first — so these hold one lightness in both themes, and the graph inks each label from the
      lightness of its fill.

      The plain card is the deliberate exception and stays on the neutral ramp: it is the absence of
      a colour, so following the theme's polarity is the whole of what it should do.
    */
    for (const [kind, fill] of Object.entries(KIND_DEFAULTS)) {
      expect(fill, kind).toMatch(/^(oklch\(|#)/);
    }
    for (const [semantic, fill] of Object.entries(STATE_FILLS)) {
      expect(fill, semantic).toMatch(/^(#|oklch\()/);
    }
    expect(PLAIN_FILL).toBe('var(--we-color-neutral-300)');
    expect(route('/canvas')).toContain(`style: { color: '${KIND_DEFAULTS.EventBlock}' }`);
    // Every state has one, `open` included: it shared the plain card until now, which made a to-do
    // task and a card that is not a task at all — a note, an event — the same colour under the lens
    // that exists to tell them apart.
    expect(Object.keys(STATE_FILLS).sort()).toEqual(['active', 'blocked', 'cancelled', 'done', 'open']);
  });

  it('keeps the colours on the canvas, and draws the other two pages plain', () => {
    /*
      The board and the calendar carried the same lenses, on the argument that three pages about one
      call should never disagree about what a colour means. Sound argument, false premise: neither
      lens said anything there.

      Kind was a *constant* on both — `recordFill` took the kind as a literal and a board holds only
      tasks, a calendar only events — so it tinted a whole page one colour, and it was the default
      lens, so that was the out-of-the-box reading. State is the column on a board, and on a calendar
      it fell through to plain, so turning it on only ever removed colour.

      Asserted as an absence with the canvas asserted beside it, because removing colour is only
      right if the page that discriminates kept all three layers.
    */
    for (const path of ['/kanban', '/calendar']) {
      expect(route(path), path).not.toContain('local.typeStyles');
      expect(route(path), path).not.toContain('"entity":"Placement"');
      // `stateFill`'s own tell. Not a bare `spaceStore.taskStates`, which the board still reads for
      // `arrangedBoard` and for the name on a lane card's state badge — the thing being asserted is
      // that no state reaches a *colour*, not that the board has stopped knowing what states exist.
      expect(route(path), path).not.toContain("semantic == 'done'");
    }

    // The canvas is a graph, so its three layers are `nodeStyle` rules rather than a `bg`: the
    // community's colour per kind, the vocabulary's per state, and the card's own off its placement.
    const canvas = route('/canvas');
    expect(canvas).toContain('.map(s, { when: { type: s.nodeType }, style: { color: s.color } })');
    expect(canvas).toContain("spaceStore.taskStates.map(s, { when: { 'data.status': s.slug }");
    expect(canvas).toContain("{ from: 'data.canvasColor' }");
    // And it still declares the key it reads — a query hoisted to the root does not reach past a
    // `$routes` outlet, so losing this is how the canvas would quietly fall back to the defaults.
    expect(canvas).toContain('"anchor":"Space","via":"typeStyles"');
  });

  it('keeps how a card looks in its header, and what it says in the inspector', () => {
    /*
      Colour, shape and content scale are facts about this card on this canvas, saved on its
      placement — so they live in the card's own header with the other things done *to* a card,
      and the inspector stays about the record. Host controls named by `control`; each reports
      through one action whose id is the placement field, previewing while it moves.
    */
    const inspector = panel('inspector');
    const canvas = route('/canvas');

    expect(inspector).not.toContain('recordStore.setCardStyle');
    expect(canvas).toContain('"id":"color","control":"color"');
    expect(canvas).toContain('"id":"cardShape","control":"shape"');
    expect(canvas).toContain('"id":"contentScale","control":"scale"');
    expect(canvas).toContain(
      `"$action":"recordStore.setCardStyle","args":[{"$":"${CALL_EXPR}"},{"$":"event.recordId"},{"$":"event.action"},{"$":"event.value"}]`,
    );
    expect(canvas).toContain('"$action":"recordStore.previewCardStyle"');
    // Not on a suggestion, which offers the decision and nothing else.
    expect(canvas).toContain('"value":{"from":"data.canvasColor"},"when":{"data.pending":{"exists":false}}');
    // Picking a colour turns the lenses off, so the pick is visible.
    expect(canvas).toContain(`"args":["${LENS_PARAM}","none"]`);
    // And the shape and scale a card was given show whatever lens is on.
    expect(canvas).toContain(
      '"cardShape":{"from":"data.canvasCardShape"},"contentScale":{"from":"data.canvasContentScale"}',
    );
  });
});

/**
 * Putting things on the canvas, opening them, and what the key lists as a result.
 */
describe('the workshop’s canvas', () => {
  const workshop = showcase.workshopTemplate as Schema & { meta?: { panels?: TemplatePanel[] } };
  const canvas = JSON.stringify((workshop.routes ?? []).find((entry) => entry.path === '/canvas'));
  const panel = (id: string) => JSON.stringify(workshop.meta?.panels?.find((entry) => entry.id === id));

  it('asks what goes here on a double-click, and offers a note or any model the space can make', () => {
    /*
      One gesture for every kind. A note goes through the composer, which is how a document is
      authored; a record goes through the generic form, opened by `createOnCanvas` — which remembers
      the canvas and the point — and then switched to the chosen model, since the first opens on
      whichever is offered first. Nothing is written until the form is submitted.
    */
    expect(canvas).toContain('"canvas-double-click"');
    // Only with a call on screen: every choice writes against it, so without one the chooser offered
    // a list of things that could only fail.
    expect(canvas).toContain(
      `"onCanvasDoubleClick":{"$if":{"condition":{"$":"${CALL_EXPR}"},"then":[{"$setLocal":"newAt","value":{"$":"event"}},{"$setLocal":"chooserOpen","value":true}]}}`,
    );
    // One searchable grid over the one list — the note, this space's types, then blocks led by tasks
    // and events (see `typePicker`). A composed kind opens the composer, anything else the form.
    expect(canvas).toContain('"placeholder":"Search types…"');
    expect(canvas).toContain(
      "distinct(['TaskBlock', 'EventBlock', 'ImageBlock', 'AudioBlock', 'VideoBlock', 'TextBlock', 'FileBlock', 'LocationBlock', 'LinkBlock', 'CodeBlock', 'TagBlock', 'CalloutBlock'], recordStore.creatableEntities",
    );
    // Back from the form or the composer reopens this chooser — and not for a drawn connection. In
    // the modal's top-left corner, not in the title's line.
    expect(canvas).toContain('"condition":{"$":"!recordStore.pendingLink"}');
    expect(canvas).toContain('"slot":"start-button"');
    // No model picker in the form: the kind was just chosen.
    expect(canvas).not.toContain('"label":"Entity"');
    // A pin rather than two number boxes, for anything with a latitude and a longitude.
    expect(canvas).toContain('"$action":"recordStore.setRecordPlace"');
    expect(canvas.split('{"$setLocal":"chooserOpen","value":true}').length - 1).toBeGreaterThanOrEqual(3);
    expect(canvas).toContain(
      `"condition":{"$":"kind.via == 'composer'"},"then":{"$setLocal":"newNoteOpen","value":true}`,
    );
    // A collection is called a note here; its description says it is a document of blocks.
    expect(canvas).toContain("(kind.via == 'composer' ? 'Note' : kind.label)");
    expect(canvas).toContain(
      `"$action":"recordStore.createOnCanvas","args":[{"$":"${CALL_EXPR}"},{"$":"local.newAt.x"},{"$":"local.newAt.y"}]`,
    );
    expect(canvas).toContain('"$action":"recordStore.setRecordEntity","args":[{"$":"kind.value"}]');
    expect(canvas).toContain('"$action":"recordStore.createCardOnCanvas"');
    expect(canvas).toContain('"at":{"$":"local.newAt"}');
  });

  it('opens a note in the composer on a double-click, and only a note', () => {
    expect(canvas).toContain('"node-double-click"');
    expect(canvas).toContain(`"onNodeDoubleClick":{"$if":{"condition":{"$":"event.recordType == 'CollectionBlock'"}`);
    expect(canvas).toContain('"$action":"spaceStore.updatePost","args":[{"$":"note.id"},{"$":"arg"}]');
    expect(canvas).toContain("local.inspectingType == 'CollectionBlock'");
  });

  it('takes a drop from the Pocket, through the store’s own refusals', () => {
    // The graph hands the template a world point; the store refuses another space's record.
    expect(canvas).toContain(
      `"onDrop":{"$action":"recordStore.dropOnCanvas","args":[{"$":"${CALL_EXPR}"},{"$":"event"}]}`,
    );
  });

  it('lets the graph ink a card by its fill', () => {
    // No `labelColor` on the base rule: the theme's text role is measured against the page, not
    // against a post-it, and the graph decides black or white from the fill's own lightness.
    expect(canvas).not.toContain('"labelColor"');
  });

  it('edits a record in the inspector, field by field, behind a pencil', () => {
    /*
      The inspector already shows every value a record has, so it is the surface that edits them.
      Each control writes as it commits — no Save button, since a record is shared and a buffered
      form would be state nobody else could see — through the one action that takes the field name.
    */
    const inspector = panel('inspector');

    expect(inspector).toContain('"$toggleLocal":"editing"');
    expect(inspector).toContain(
      '"$action":"recordStore.updateRecordField","args":[{"$":"routeStore.params.cardType"},{"$":"routeStore.params.card"},{"$":"field.name"},{"$":"event.detail"}]',
    );
    expect(inspector).not.toContain('saveRecord');
    // Typed controls commit on change, never on input — a keystroke is not a write.
    expect(inspector).not.toContain('"onInput"');
    // A closed set of values is a select over what the model declares.
    expect(inspector).toContain('field.options.map(o, { label: o, value: o })');
  });

  it('opens out the card that is selected, and says so when none is', () => {
    /*
      An unresolved operand in `where` is pruned, and pruning means "do not narrow" — the right
      reading for an optional filter and the worst available for the id that says which record this
      is. With `?cardType=TaskBlock` and no `card` — a shared link, or a selection cleared while the
      type lingered — the clause was dropped and `limit: 1` answered with whichever task came first,
      so the panel opened out a card the canvas showed as unselected. `when` is the distinction the
      pruner cannot draw: the id is not a narrowing, it is the whole query.
    */
    const inspector = panel('inspector');

    expect(inspector).toContain('"when":{"$":"routeStore.params.card"}');
    /*
      And with nothing selected it is the placeholder that shows, not a heading. "Untitled" stood
      here in heading type for a record with neither a name nor a document, on the argument that a
      nameless record otherwise reads as one still loading — which the unconditional kind strip
      above had already answered. What it added was a heading asserting the record is called
      something it is not, beside the field offering to name it.
    */
    expect(inspector).not.toContain('Untitled');
    expect(inspector).toContain('Click a card on the canvas to look inside it');
    // And no link out: the button pointed at `/record/:entity?id=`, which does not currently
    // arrive anywhere usable. This panel's case for existing is reading a card *without* leaving
    // the arrangement it is in, so the way out was the convenience rather than the feature.
    expect(inspector).not.toContain('Open full record');
    expect(inspector).not.toContain('/record/${routeStore.params.cardType}');
  });

  it('lists in the key only the kinds on this canvas', () => {
    /*
      Not every kind the space has: what extraction may write for this call, where a record of it
      exists, and whatever has been placed — a note, a dropped record, a shape — each once.

      One query over every extractable kind rather than one per kind inside the loop. Each of those
      answered its own row and nothing outside could read them, so the key could not tell a canvas
      with nothing on it from one with cards, and the sentence for the empty one never showed.
    */
    const key = panel('key');

    expect(key).not.toContain('shapeStore.extractionCandidates');
    expect(key).not.toContain('"found":{"entity":{"$":"kind"}');
    expect(key).not.toContain('placement.nodeType != prev.nodeType');
    expect(key).toContain('"onCall":{"entity":{"$":"(modules.transcribe.extractionFor[');
    expect(key).toContain('distinct(local.onCall.map(r, r.__subjectClass), local.placements.map(p, p.nodeType))');
    expect(key).toContain("'CollectionBlock' ? 'Note'");
    expect(KIND_DEFAULTS.CollectionBlock).toBe('#ffea9f');
  });

  it('says so when there are no kinds yet, once it knows', () => {
    // Both halves answered and empty, rather than either not yet asked — a call with cards on it
    // must not flash the sentence while its queries are still out.
    const key = panel('key');

    expect(key).toContain('"condition":{"$":"local.onCallLoaded && local.placementsLoaded && !count(distinct(');
    expect(key).toContain('No kinds yet. They appear here as cards land on the canvas — double-click it to add one.');
    expect(key).not.toContain('Nothing on the canvas yet. Double-click it to add something.');
  });
});

/**
 * Who is on what a call produced — the half of the question the board and the calendar could not
 * answer. What is worth pinning is the wiring that fails quietly: a board without its people option
 * draws no faces and nobody notices, and an RSVP read from the call's roster would claim a meeting
 * somebody skipped was one they attended.
 */
describe('the workshop’s people', () => {
  const workshop = showcase.workshopTemplate as Schema;
  const route = (path: string) => JSON.stringify((workshop.routes ?? []).find((entry) => entry.path === path));

  it('puts who is on each card on the kanban, with a filter', () => {
    const kanban = route('/kanban');
    expect(kanban).toContain('"$action":"spaceStore.setInvolvement"');
    expect(kanban).toContain('"syncParam":"who"');
    expect(kanban).toContain('Group by person');
    // Where a card came from is a mark and a hovercard line, never the author's name on its face.
    expect(kanban).toContain('card.id in first(local.callRow).extracted');
    // Pressing a card opens it in the inspector through the same parameters the canvas writes.
    expect(kanban).toContain('"$action":"routeStore.setParam","args":["card",{"$":"card.id"}]');
    expect(kanban).toContain('Extracted from the conversation');
  });

  it('keeps a card selected while its own menus are open, and lets go on a press anywhere else', () => {
    const kanbanRoute = (workshop.routes ?? []).find((entry) => entry.path === '/kanban') as unknown as SchemaNode;
    const onClick = JSON.stringify(kanbanRoute.props?.onClick);
    /*
      A press on the faces or the move menu is a press on the card too, so a card that let go of itself
      on a second press deselected itself behind the menu that press opened. A press only selects.
    */
    expect(route('/kanban')).not.toContain('"condition":{"$":"card.id == routeStore.params.card"}');
    expect(route('/kanban')).toContain('{"$setLocal":"pressedCard","value":true}');
    // The page lets go — both parameters, so no type is left behind to be read without its card.
    expect(onClick).toContain('local.pressedCard');
    expect(onClick).toContain('{"$action":"routeStore.setParam","args":["card",null]}');
    expect(onClick).toContain('{"$action":"routeStore.setParam","args":["cardType",null]}');
  });

  it('lets a member answer an event, reading answers rather than the call’s roster', () => {
    const calendar = route('/calendar');
    expect(calendar).toContain('"$action":"spaceStore.respondTo"');
    expect(calendar).toContain('.committed');
    expect(calendar).not.toContain('event.participants');
    expect(calendar).not.toContain('setAttending');
  });

  it('filters the calendar with the board’s own control, the chosen people in the address and the mode on the device', () => {
    const calendar = route('/calendar');
    expect(calendar).toContain('"calendarPeople":{"type":"array","initial":[],"syncParam":"who"}');
    expect(calendar).toContain('"calendarShow":{"type":"string","initial":"dim","persist":"calendar.show"}');
    expect(calendar).toContain('"children":["Dim"]');
    // Hiding is offered; grouping by person is a board's layout, and a calendar has no rows to lay out.
    expect(calendar).toContain('"children":["Hide"]');
    expect(calendar).not.toContain('Group by person');
  });
});

describe('the inspector’s connections', () => {
  const workshop = showcase.workshopTemplate as Schema & { meta?: { panels?: TemplatePanel[] } };
  const inspector = workshop.meta?.panels?.find((entry) => entry.id === 'inspector')?.node;
  const json = JSON.stringify(inspector);

  /** The `items` expression of the `$each` binding `as` — found by walking, not by exporting. */
  function itemsOf(as: string): string {
    let found: string | undefined;
    const walk = (value: unknown): void => {
      if (found || typeof value !== 'object' || value === null) return;
      const node = value as { type?: string; props?: { as?: string; items?: { $?: string } } };
      if (node.type === '$each' && node.props?.as === as && node.props.items?.$) {
        found = node.props.items.$;
        return;
      }
      Object.values(value).forEach(walk);
    };
    walk(inspector);
    if (!found) throw new Error(`no $each as "${as}" in the inspector`);
    return found;
  }

  /** Evaluate against a scope of plain objects — the same evaluator the renderer runs. */
  function evaluate(source: string, scope: Record<string, unknown>): unknown {
    return evaluateExpression(parseExpression(source), {
      root: (name: string) => (name in scope ? { bound: true, value: scope[name] } : { bound: false }),
      call: (name: string, args: unknown[]) =>
        listFunctions()
          .find((f) => f.name === name)
          ?.impl(args, {} as never),
    } as never);
  }

  const displays = {
    TaskBlock: { label: 'Task', icon: 'check-square', title: 'title' },
    EventBlock: { label: 'Event', icon: 'calendar', title: 'title' },
    CollectionBlock: { label: 'Collection', icon: 'folder', title: 'title' },
  };
  const kinds = [
    { id: 'k-blocks', name: 'blocks', inverseName: 'is blocked by', directed: true, color: '#d33' },
    { id: 'k-same', name: 'same as', directed: false },
  ];
  const scopeFor = (connections: unknown[], link: unknown[] = []) => ({
    local: { connections, link, relationshipKinds: kinds },
    routeStore: { params: { card: 'me' } },
    recordStore: { displays },
  });

  it('asks for the card’s connections at either end, with both ends hydrated', () => {
    // Native on AD4M: each arm is a triple pattern on the relation's predicate, the OR a UNION.
    expect(json).toContain(
      '"where":{"OR":[{"source":{"$":"routeStore.params.card"}},{"target":{"$":"routeStore.params.card"}}]}',
    );
    expect(json).toContain('"include":{"source":true,"target":true}');
  });

  it('reads every row from this card’s side of the line', () => {
    const rows = evaluate(
      itemsOf('conn'),
      scopeFor([
        // Outgoing, with a kind: its name, pointing away.
        {
          id: 'r1',
          source: { id: 'me' },
          target: { id: 't2', title: 'Ship the docs' },
          sourceType: 'TaskBlock',
          targetType: 'TaskBlock',
          relationshipTypeId: 'k-blocks',
        },
        // Incoming, with the same kind: its inverse, pointing back.
        {
          id: 'r2',
          source: { id: 'e1', title: 'Standup' },
          target: { id: 'me' },
          sourceType: 'EventBlock',
          targetType: 'TaskBlock',
          relationshipTypeId: 'k-blocks',
        },
        // Undirected kind: both ways, whichever end this card is.
        {
          id: 'r3',
          source: { id: 'n1', textContent: 'Draft plan' },
          target: { id: 'me' },
          sourceType: 'CollectionBlock',
          relationshipTypeId: 'k-same',
        },
        // Label only, and no stored types — an extraction pass's connection. The type comes from the
        // hydrated end, and the end arrived as a bare id rather than a record.
        { id: 'r4', source: 'me', target: { id: 't3', __subjectClass: 'TaskBlock' }, label: 'came out of' },
        // The far end is gone.
        { id: 'r5', source: { id: 'me' }, target: null, targetType: 'TaskBlock' },
      ]),
    ) as Record<string, unknown>[];

    expect(rows.map((row) => [row.arrow, row.verb, row.name, row.otherId, row.otherType])).toEqual([
      ['arrow-right', 'blocks', 'Ship the docs', 't2', 'TaskBlock'],
      ['arrow-left', 'is blocked by', 'Standup', 'e1', 'EventBlock'],
      ['arrows-left-right', 'same as', 'Draft plan', 'n1', 'CollectionBlock'],
      ['arrow-right', 'came out of', 'Task', 't3', 'TaskBlock'],
      // No id to open, which is what disables the row's button: the connection is shown, and so is
      // the fact that what it pointed at is gone.
      ['arrow-right', undefined, 'Removed', null, 'TaskBlock'],
    ]);
    // The kind's colour travels with the row, for the arrow.
    expect(rows[0].tint).toBe('#d33');
  });

  it('falls back to the kind’s name for an incoming row whose kind names no inverse', () => {
    // "same as" has no `inverseName`, so an incoming row reads the name itself — not blank.
    const [row] = evaluate(
      itemsOf('conn'),
      scopeFor([{ id: 'r1', source: { id: 'o', title: 'Other' }, target: { id: 'me' }, relationshipTypeId: 'k-same' }]),
    ) as Record<string, unknown>[];
    expect(row.verb).toBe('same as');
  });

  it('names both ends of a selected line', () => {
    const ends = evaluate(
      itemsOf('end'),
      scopeFor(
        [],
        [
          {
            id: 'r1',
            source: { id: 't1', title: 'Write it' },
            target: { id: 'e1', __subjectClass: 'EventBlock', title: 'Review' },
            sourceType: 'TaskBlock',
          },
        ],
      ),
    ) as Record<string, unknown>[];

    expect(ends.map((end) => [end.role, end.name, end.id, end.type, end.icon])).toEqual([
      ['From', 'Write it', 't1', 'TaskBlock', 'check-square'],
      ['To', 'Review', 'e1', 'EventBlock', 'calendar'],
    ]);
    // And nothing at all until the line's own query has answered.
    expect(evaluate(itemsOf('end'), scopeFor([], []))).toEqual([]);
  });

  it('opens a row by writing the address the canvas follows', () => {
    // The panel cannot reach the canvas's locals; the address is the one thing both can see, and the
    // canvas binds `focus` to it — so a row opened here is selected and brought into view there.
    expect(json).toContain('{"$action":"routeStore.setParam","args":["card",{"$":"conn.otherId"}]}');
    expect(json).toContain('{"$action":"routeStore.setParam","args":["cardType","Relationship"]}');
    expect(JSON.stringify(workshop)).toContain('"focus":{"$":"routeStore.params.card"}');
  });
});

describe('the workshop inspector’s people', () => {
  const workshop = showcase.workshopTemplate as Schema & { meta?: { panels?: TemplatePanel[] } };
  const inspector = JSON.stringify(workshop.meta?.panels?.find((panel) => panel.id === 'inspector'));

  it('names everyone on the selected record by part, with the card’s own picker', () => {
    expect(inspector).toContain('involvementMenu({ node: row.id');
    expect(inspector).toContain('"$action":"spaceStore.setInvolvement"');
    // Your own answer is withdrawn, never somebody else's.
    expect(inspector).toContain('"$action":"spaceStore.respondTo","args":[{"$":"row.id"},""]');
    expect(inspector).toContain('!holder.reflexive || holder.did == me.did');
  });

  it('says where the record came from, which a card’s face no longer does', () => {
    expect(inspector).toContain('row.id in first(local.inspectedCall).extracted');
    expect(inspector).toContain('Extracted from the conversation');
    // Under the title and description, ahead of People, rather than at the foot of the panel.
    expect(inspector.indexOf('Extracted from the conversation')).toBeLessThan(inspector.indexOf('involvementMenu('));
  });

  it('wraps where the record came from at words, with the glyph on its first line', () => {
    // One text holding the time inline, not three items in a wrapping row that broke between them.
    expect(inspector).toContain(
      '{"type":"we-timestamp","props":{"value":{"$":"row.createdAt"},"relative":true,"fontSize":"100"}}]}',
    );
    expect(inspector).toContain('"height":"1lh"');
  });

  it('keeps the same gap under every section caption, with the captions a step fainter', () => {
    expect(inspector).toContain('"props":{"ml":"auto","fontSize":"100","height":"1lh","ay":"center"}');
    expect(inspector).toContain('"props":{"gap":"200","ay":"center","opacity":0.75}');
  });

  it('offers no assignee text box beside the People section that answers it', () => {
    expect(inspector).toContain("f.name != 'assignee' || !count(spaceStore.offeredInvolvementTypes");
  });

  it('sets section names apart from the properties under them, with a picker sized like the header’s', () => {
    expect(inspector).toContain('"uppercase":true');
    expect(inspector).toContain('"triggerTitle":"Who is on this","triggerVariant":"ghost","size":"sm"');
  });
});

describe('the chooser’s colours', () => {
  const run = (source: string, scope: Record<string, unknown>) =>
    evaluateExpression(parseExpression(source), {
      root: (name: string) => (name in scope ? { bound: true, value: scope[name] } : { bound: false }),
      call: (name: string, args: unknown[]) =>
        listFunctions()
          .find((f) => f.name === name)
          ?.impl(args, {} as never),
    } as never);

  it('draws a card’s icon in its kind’s colour, looked up by the entry’s name — the default, or the space’s', () => {
    // The picker hands a whole entry; the key looks colours up by name. Passing the entry itself made
    // every lookup miss, and every icon came out the plain card's colour.
    const fill = kindFill('kind.value');
    const kind = { value: 'ImageBlock', label: 'Image' };
    expect(run(fill, { kind, local: { typeStyles: [] } })).toBe(KIND_DEFAULTS.ImageBlock);
    expect(run(fill, { kind, local: { typeStyles: [{ nodeType: 'ImageBlock', color: '#123456' }] } })).toBe('#123456');
  });
});

describe('putting a kind away from the canvas', () => {
  const run = (source: string, scope: Record<string, unknown>) =>
    evaluateExpression(parseExpression(source), {
      root: (name: string) => (name in scope ? { bound: true, value: scope[name] } : { bound: false }),
      call: (name: string, args: unknown[]) =>
        listFunctions()
          .find((f) => f.name === name)
          ?.impl(args, {} as never),
    } as never);
  const next = (hide: string, kind: string) => {
    const action = toggleKindShown('kind') as { args: [string, { $: string }] };
    return run(action.args[1].$, { kind, routeStore: { params: { hide } } });
  };

  it('adds a kind to the address, and takes it back out, leaving nothing when none is hidden', () => {
    expect(next('', 'ImageBlock')).toBe('ImageBlock');
    expect(next('ImageBlock', 'TextBlock')).toBe('ImageBlock,TextBlock');
    expect(next('ImageBlock,TextBlock', 'ImageBlock')).toBe('TextBlock');
    expect(next('TextBlock', 'TextBlock')).toBe('');
    expect(run(HIDDEN_KINDS, { routeStore: { params: {} } })).toEqual([]);
  });

  it('hands the hidden kinds to the canvas', () => {
    const workshop = showcase.workshopTemplate;
    const canvas = JSON.stringify((workshop.routes ?? []).find((entry) => entry.path === '/canvas'));
    expect(canvas).toContain(`"hiddenTypes":{"$":"${HIDDEN_KINDS}"}`);
  });
});
