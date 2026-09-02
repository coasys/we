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

import type { TemplatePanel } from '@we/schema-shared';
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
  // `TemplatePanel` rather than a shape written out here: the hand-written one had no `dock`, so
  // adding that field to the real type left this file typechecking against a panel that no longer
  // existed.
  const workshop = showcase.workshopTemplate as Schema & { meta?: { panels?: TemplatePanel[] } };

  it('has one board route, whichever call it is about', () => {
    const paths = (workshop.routes ?? []).map((route) => route.path);

    expect(paths).toContain('/board');
    // The spelling that could never match: a record id is a URI, so it is not one segment.
    expect(paths).not.toContain('/board/:callId');
  });

  it('carries the call in a query parameter, and falls back to the live one', () => {
    const json = JSON.stringify(workshop);

    expect(json).toContain('routeStore.params.call');
    expect(json).not.toContain('./board/$');
  });

  it('asks the call module which call is live, not the transcriber', () => {
    /*
      `liveCollectionId` means "the record I am writing into", and the transcriber adopts the call's
      record only when it first has something to write — so for the opening stretch of every meeting
      its honest answer is "nothing". Every surface here waited for somebody to speak before it would
      admit a call was happening: an empty board, an empty feed, and a calls list that did not mark
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
    expect(json).toContain("modules.transcribe.listening ? 'danger' : 'text-muted'");
    expect(json).toContain("modules.call.callRecordId ? 'danger' : 'text-faint'");
  });

  it('keeps the unsaved line inside the scroll region, with the rows', () => {
    /*
      Outside it, the line is pinned to an edge of the panel while a short transcript sits at the
      other, and the first sentence written appears to leap the gap between them. Inside, it follows
      the last row whether there are two of them or two hundred.

      `transcriptLines` rather than the module's whole feed, because the feed carries the unsaved
      line unconditionally and this template has to omit it on a past call — that buffer is this
      agent's live microphone, and last month's meeting is not what it is saying.
    */
    const transcript = JSON.stringify(workshop.meta?.panels?.find((panel) => panel.id === 'transcript'));

    expect(transcript).toContain('transcribe.transcriptLines');
    expect(transcript).toContain('"pin":"end"');
    // Gated, where the rows are not: the rows are about the call on screen, the buffer is not.
    expect(transcript).toContain('transcribe.pendingUtterance');
    expect(transcript).not.toContain('transcribe.transcriptFeed');
  });

  it('draws a card nobody has agreed to yet as unsettled, and offers the decision on it', () => {
    /*
      An extraction pass can stage a whole record, and a staged record is in the graph: it answers
      the board's query exactly as an accepted one does, so the card was indistinguishable from one
      somebody had said yes to. The proposal list is the only thing that knows the difference.
    */
    const json = JSON.stringify(workshop);

    expect(json).toContain('modules.transcribe.proposals.map(p, p.id)');
    /*
      `data.pending`, with the prefix — the thing that was wrong the first time.

      A match clause reads a node's own field for a bare key and the seed's data bag behind `data.`,
      so `{ pending: true }` named a field that is not there and matched nothing at all: no card
      faded, no card offered the decision, on a board full of suggestions. Nothing failed, because
      nothing matching is what a clause does when it is right and there is nothing to match.
    */
    expect(json).toContain('{"when":{"data.pending":true},"style":{"opacity":0.5}}');
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
    expect(json).toContain('"id":"accept","icon":"check","title":"Keep this"');
    expect(json).toContain('"when":{"data.pending":true},"tone":"positive"');
    expect(json).toContain('"when":{"data.pending":true},"tone":"danger"');
    expect(json).toContain('"id":"reject"');
  });

  it('says what is being extracted, and draws the board and the readout off that same list', () => {
    /*
      What a space extracts is a community decision, changeable mid-call from the chips this panel
      places. Everything downstream that named the kinds itself was therefore a bug waiting on one
      click: `['TaskBlock', 'EventBlock']` was written into the board's `contains` and into the
      readout's two queries, so turning a third model on produced records in the collection, nothing
      on the board, and nothing in the readout — with no sign of why in any of the three.

      One list now, read from the call's own targets rather than the space's: those differ the moment
      somebody narrows a call, and the call is what these surfaces are about.
    */
    const json = JSON.stringify(workshop);

    expect(json).toContain('transcribe.extractionTargets');
    expect(json).toContain('modules.transcribe.extractionTargets.map(t, t.entity)');
    expect(json).not.toContain('"TaskBlock","EventBlock"');
  });

  it('inspects the selected card from a panel, through the model’s own declaration', () => {
    /*
      A community defines a model, extraction writes one, and it lands on the board as a card nobody
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
    expect(json).toContain('recordStore.connectNodes');
    /*
      And the form that asks what the connection *is*.

      `connectNodes` opens a draft, and a draft whose non-nullness mounts a modal needs something to
      mount it. The modal is placed by the default template's graph view, and this template supplies
      its own board — so the drag completed, the store opened a form, and the screen showed nothing.
      The gesture looked like it had silently failed when what had failed was the surface that asks
      about it.
    */
    expect(json).toContain('recordStore.recordDraft');
    expect(json).toContain('recordStore.saveRecord');
  });

  it('supplies both of the module’s panels, so neither is drawn twice', () => {
    /*
      The transcript entry named the module and the extraction entry named nothing, so the module's
      own extraction surface had no counterpart here — it opened *beside* this template's version the
      moment a pass ran. Two entries naming two docks line up one-to-one with what the module
      contributes, which is what makes "the interface supplies this" mean something.

      The dock names are required now that there are two: without them the host refuses to supply
      either rather than guessing, because a transcript body inside an extraction panel is a silent
      wrong answer.
    */
    const panels = workshop.meta?.panels ?? [];
    const supplied = panels.filter((panel) => panel.module === 'transcribe');

    expect(supplied.map((panel) => panel.dock).sort()).toEqual(['extraction', 'transcript']);
    for (const panel of supplied) expect(panel.node).toBeTruthy();
  });

  it('offers a delete on every card, not only on the unsettled ones', () => {
    /*
      Extraction proposes things that are simply wrong about a conversation, and one that has been
      accepted — or predates the proposal machinery — had no way off the board from the board.

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

  it('shows the transcript panel what the microphone is doing, not only what it saved', () => {
    /*
      An utterance becomes a row only once the speaker stops, the audio reaches the model and the
      block lands — seconds in which a feed of saved lines is indistinguishable from a dead
      microphone. The module's own panel never had that problem because the meter and the unsaved
      line sit with it; this template supplies its own panel, so it places the same two parts.

      Both gated on being on the live call: they are about the microphone this agent is running
      now, which says nothing about a past call opened from a link.
    */
    const transcript = JSON.stringify(workshop.meta?.panels?.find((panel) => panel.id === 'transcript'));

    expect(transcript).toContain('transcribe.captureMeter');
    expect(transcript).toContain('transcribe.pendingUtterance');
    // After the feed, so it stays put outside the feed's own scroll area as the transcript grows.
    expect(transcript!.indexOf('transcribe.pendingUtterance')).toBeGreaterThan(
      transcript!.indexOf('transcribe.transcriptFeed'),
    );
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
