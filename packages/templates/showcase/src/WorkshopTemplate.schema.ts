/**
 * Workshop — a call, its transcript, and what came out of it.
 *
 * The seventh showcase template, and the first that is about *panels* rather than about a content
 * arrangement. The other six demonstrate that channels, boards, playlists and events are all one
 * container seen differently; this one demonstrates that where the surfaces around the content sit
 * is also data.
 *
 * ## The screen
 *
 * A call is running. Down the left, the transcript as everyone speaks, and beneath it a readout of
 * what extraction is making of it. On the right, the call itself. In the middle, a board of the
 * records the call produced — tasks and events — which can be dragged into an arrangement and joined
 * to each other.
 *
 * Then two more routes over the same material: the tasks as a list by state, and the events as a
 * month. The panels stand across all three — a panel that survives navigation is the whole
 * difference between one and a region of a page — so moving between them changes the content and
 * leaves the surfaces around it where they are.
 *
 * ## One call, named in the address
 *
 * Every surface here is about one call, and `?call=<id>` is where that id lives — so a reload comes
 * back to the same meeting, the address can be sent to somebody, and the switcher carries it from
 * page to page. Naming none of them means the call being recorded, which is the ordinary case. See
 * `CALL`.
 *
 * ## What it does not mint
 *
 * Nothing. Like the other six, this template adds no content model. The transcript is the
 * `CollectionBlock` `@we/module-transcribe` already writes (`docs/architecture/transcripts.md`), and
 * the board's cards are the `TaskBlock`s and `EventBlock`s extraction already produces from it. The
 * template is arrangement over both.
 *
 * ## Where the panels come from
 *
 * `meta.panels`, and three of the four kinds of entry it can carry:
 *
 * - **`node`** for the transcript, the extraction readout and the calls list — this template's own
 *   schema. The transcript was `module: 'transcribe'` and is not any more: that panel reads the call
 *   being *recorded into*, and everything here is about the call *on screen*, so placing it would
 *   put one surface about a different meeting beside three about this one. The module still owns the
 *   microphone and every write; what moved is arrangement, which is what a template is made of.
 * - **`module`** for the call itself, which is a video stage no schema could express.
 * - **no `route` on any of them.** The key exists for a shell that routes itself and wants a panel on
 *   one page only — but scoping these to the board meant crossing to the tasks list *unregistered*
 *   them, throwing away their scroll position, their subscriptions and wherever they had been
 *   dragged. A column of context on a page that did not strictly need it is the cheaper of the two.
 * - **`open: false`** on the call, because the call module's launcher action is `goToCall`, which
 *   *joins a call* when there is not one. Placed, never opened.
 */
import type { RouteSchema, SchemaNode, SchemaProp, TemplateSchema } from '@we/schema-shared';
import { agentByline, confirmModal, emptyState, gatePrompt } from '@we/template-kit';

/**
 * What extraction is allowed to make from a transcript.
 *
 * The same two classes `@we/module-transcribe` names, restated because `templates → modules` is a
 * sideways edge. If that list grows, this one has to grow with it — the board would simply stop
 * showing the new kind, silently, which is the failure `docs/architecture/transcripts.md` exists to
 * make visible.
 */
const EXTRACTED = ['TaskBlock', 'EventBlock'];

/**
 * The call on screen — **named in the address**, or the one being recorded when it names none.
 *
 * Every surface here is about one call: the transcript, the extraction readout, the board. That id
 * used to be `modules.transcribe.collectionId`, which means "the call I am recording into" — so
 * looking at a finished call meant *joining a call* first, a refresh left the template about no call
 * at all, and there was no way to send somebody the board you were looking at. In the address
 * instead, which answers all three: it survives a reload, pastes into a message, and needs no state
 * anywhere. The live call is the default, so the ordinary case — you are in a meeting, you open the
 * board — is unchanged and names nothing.
 *
 * ## A query parameter, not a path segment
 *
 * `/board/<call>` was the obvious spelling and it cannot work: a record id is a **URI**
 * (`we://…/<uuid>`), so it carries slashes and a colon, and `./board/we://…` is several segments —
 * `/board/:callId` matches none of them, and every click landed on the catch-all with "Page not
 * found". A query value takes those characters as they are, which is why the host's own record
 * links are `…/record/<Entity>?id=<id>` and not a segment either.
 */
const CALL_EXPR = 'routeStore.params.call ? routeStore.params.call : modules.transcribe.liveCollectionId';
const CALL = { $: CALL_EXPR };

/** Whether the call on screen is the one being recorded, as opposed to one being looked back at. */
const VIEWING_LIVE = { $: 'routeStore.params.call ? false : true' };

/**
 * The page on screen, as a segment — or the board, before the redirect has landed on one.
 *
 * Changing which call you are looking at is not a reason to change the page. Both of these used to
 * name `board` outright, so choosing a call from the tasks list threw you onto the board, and the
 * only way back was the switcher.
 */
const PAGE_EXPR = "routeStore.templateSegments[0] ? routeStore.templateSegments[0] : 'board'";

/** This space's current page, with whatever call parameter is given — `''` for none. */
const pageWithCall = (callExpr: string): SchemaProp => ({
  /*
    **One** navigation, path and query together.

    It was two actions, a `navigate` then a `setParam`, and they raced. The router commits a
    navigation in a transition rather than synchronously, so `setParam` — which writes
    `window.location.pathname + '?…'` straight through `history` — read the *old* pathname and wrote
    the parameter onto it; the router's own write landed afterwards. The parameter took effect (the
    panels followed it, which is why this looked half-working) and the address ended up somewhere no
    route matched, so every route said "Page not found". Nothing that navigates and sets a parameter
    can be two steps.

    Absolute, from `spaceStore.spacePath`. A relative path resolves against wherever the click came
    from, and most of these clicks are on a **panel** — host chrome, rendered outside the route tree
    — so "wherever you are" is not a thing they can rely on. The switcher's own buttons are inside
    the tree, and even they are absolute now that they carry a query: a relative path with a `?` is
    where resolution rules and remembered query strings meet.

    The id rides in the query rather than a path segment because it is a URI; see `CALL`. Raw, as the
    host's own record links are (`…/record/<Entity>?id=<id>`): a query value takes the slashes and
    the colon as they are.
  */
  $action: 'routeStore.navigate',
  args: [{ $: `\`\${spaceStore.spacePath}/\${${PAGE_EXPR}}?call=\${${callExpr}}\`` }],
});

/** Look at a call, wherever you are. */
const openCall = (idExpr: string): SchemaProp => pageWithCall(idExpr);

/**
 * Back to the call being recorded — the same one navigation, naming no call.
 *
 * An empty value rather than a bare path. `navigate` restores the query a path was last left with —
 * which is what makes leaving for the tasks list and coming back keep the call you were on — so the
 * path alone would bring the old parameter straight back. An explicit `?` always wins, and an empty
 * parameter reads as absent everywhere it is tested.
 */
const openLiveCall: SchemaProp = pageWithCall("''");

/**
 * Routes, as segments. Compared against `routeStore.segments`, which is how `route` matches too.
 *
 * There was a `calls` route here — the archive, with each meeting's transcript under a disclosure.
 * The calls *panel* does the choosing better and from every route, and the transcript panel already
 * shows whichever call is on screen, so what the archive had left was a second copy of both. The
 * segment it freed goes to the other half of what a conversation produces: tasks have no date and
 * events do, and a list is the wrong shape for the second.
 */
const ROUTE = { board: 'board', tasks: 'tasks', events: 'events' } as const;

const NAV = [
  { segment: ROUTE.board, icon: 'graph', label: 'Board' },
  { segment: ROUTE.tasks, icon: 'check-square', label: 'Tasks' },
  { segment: ROUTE.events, icon: 'calendar', label: 'Events' },
];

/**
 * Where a switcher button goes: this space's page for that segment, carrying the call on screen.
 *
 * The call has to come along. The panels stand on every route now, and they are about `CALL` — so a
 * link that dropped the parameter would show the transcript of the *live* call while the board two
 * clicks away showed the one you chose, and switching pages would look like it changed the subject.
 *
 * `?? ''` rather than a ternary: an absent parameter interpolates as the word `undefined`, and an
 * empty one reads as absent everywhere it is tested — `CALL` falls through to the live call, which
 * is exactly right.
 *
 * Absolute, from `spacePath`, because it now has a query on it: a relative path with a `?` is where
 * resolution rules and remembered query strings meet, and neither of them is worth relying on.
 */
const navPath = { $: "`${spaceStore.spacePath}/${nav.segment}?call=${routeStore.params.call ?? ''}`" };

/**
 * The view switcher, floating over the content.
 *
 * Chrome rather than layout: it is pinned, it sits above whatever the route renders, and the routes
 * fill the screen underneath it. `meta.chromeReserve` declares the band it occupies so floating
 * panels clear it — without that a panel snapped top-left opens underneath this.
 *
 * Centred on the content rather than the window, through `--we-chrome-center-x`. A right-hand panel
 * that displaces slides the content's centre, and a bar that ignored it would drift off-centre as
 * soon as anything opened.
 */
const switcher: SchemaNode = {
  type: 'Row',
  props: {
    position: 'fixed',
    top: '300',
    left: '50%',
    styles: { transform: 'translateX(calc(-50% + var(--we-chrome-center-x, 0px)))' },
    zIndex: 'sticky',
    gap: '100',
    p: '100',
    r: 'pill',
    bg: 'surface-raised',
    border: '1px solid border',
    shadow: 'lg',
  },
  children: [
    {
      type: '$each',
      props: { items: NAV, as: 'nav' },
      children: [
        {
          type: 'we-button',
          props: {
            size: 'sm',
            r: 'pill',
            gap: '200',
            variant: { $: "nav.segment in routeStore.segments ? 'secondary' : 'ghost'" },
            onClick: { $action: 'routeStore.navigate', args: [navPath] },
          },
          children: [
            { type: 'we-icon', props: { name: { $: 'nav.icon' } } },
            { type: 'we-text', children: [{ $: 'nav.label' }] },
          ],
        },
      ],
    },
  ],
};

/**
 * What a pass has made, of one kind, on the call on screen.
 *
 * One query per class rather than one over both: a `$query` names an entity, and the two have
 * nothing in common to sort by across the pair. Newest first, because this is a "what just
 * happened" readout rather than a record — the board and the calendar are where they are kept.
 */
function extractedRows(entity: string, icon: string, label: string): SchemaNode {
  return {
    type: '$each',
    props: {
      items: {
        $query: {
          entity,
          scope: { anchor: 'CollectionBlock', via: 'children', anchorId: CALL },
          order: { createdAt: 'desc' },
          limit: 12,
        },
      },
      as: 'item',
    },
    children: [
      {
        type: 'Row',
        props: { gap: '200', ay: 'center', bg: 'surface-sunken', r: '300', px: '300', py: '200' },
        children: [
          { type: 'we-icon', props: { name: icon, color: 'accent-text' } },
          {
            type: 'we-text',
            props: { variant: 'footnote', flex: '1', truncate: true },
            children: [{ $: `item.${label}` }],
          },
        ],
      },
    ],
  };
}

/**
 * Suggestions the backend staged rather than wrote, and the two buttons that resolve them.
 *
 * Carried here because this template supplies its own panels rather than placing the module's, and
 * accept/reject is not decoration: a staged value is not committed until somebody says so, so a
 * template that showed extraction activity and no way to resolve it would leave records permanently
 * half-made with no sign of why.
 *
 * Absent in the ordinary case. A value is staged only where a human already owns one, so a first
 * pass over a fresh transcript stages nothing — and a permanently empty "0 pending" box teaches
 * people to stop looking at the one place their attention is eventually needed.
 */
const proposalsReview: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'count(modules.transcribe.proposals)' },
    then: {
      type: 'Column',
      props: { gap: '200' },
      children: [
        {
          type: 'we-text',
          props: { variant: 'label', color: 'text-muted', textTransform: 'uppercase', letterSpacing: 'wide' },
          children: ['Awaiting your call'],
        },
        {
          type: '$each',
          props: { items: { $: 'modules.transcribe.proposals' }, as: 'proposal' },
          children: [
            {
              type: 'we-alert',
              props: { variant: 'warning' },
              children: [
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    { type: 'we-text', props: { variant: 'footnote' }, children: [{ $: 'proposal.summary' }] },
                    {
                      type: 'Row',
                      props: { gap: '200' },
                      children: [
                        {
                          type: 'we-button',
                          props: {
                            size: 'sm',
                            variant: 'secondary',
                            onClick: { $action: 'modules.transcribe.acceptProposal', args: [{ $: 'proposal.id' }] },
                          },
                          children: ['Keep'],
                        },
                        {
                          type: 'we-button',
                          props: {
                            size: 'sm',
                            variant: 'ghost',
                            onClick: { $action: 'modules.transcribe.rejectProposal', args: [{ $: 'proposal.id' }] },
                          },
                          children: ['Discard'],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
};

/**
 * The extraction readout — this template's own panel, supplied as a `node`.
 *
 * Two questions, and they are different: what is the model *doing*, and what has it *made*. The
 * first comes from `interpretationStore.activity`, which already carries display-ready strings and
 * covers peers' passes as well as this agent's — extraction runs on whoever's node it runs on, and a
 * readout that showed only your own would be quietly wrong in a meeting. The second is an ordinary
 * query against the call.
 *
 * Gated on `capable`, which answers "can this node interpret at all". False means no fix exists from
 * inside the app, so the panel says so rather than offering a control that cannot work.
 */
const extractionPanel: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%', p: '300', gap: '300', overflow: 'hidden' },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: 'interpretationStore.capable' },
        then: {
          type: 'Column',
          props: { width: '100%', flex: '1', minHeight: '0', gap: '300' },
          children: [
            // What is running, if anything. `activity` is empty in the ordinary case, which means
            // "nothing is happening" rather than "not supported" — hence the separate `capable` gate
            // above, and no empty state here.
            {
              type: '$each',
              props: { items: { $: 'interpretationStore.activity' }, as: 'pass' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '200', ay: 'center', bg: 'surface-sunken', r: '300', px: '300', py: '200' },
                  children: [
                    {
                      type: '$if',
                      props: {
                        condition: { $: 'pass.running' },
                        then: { type: 'we-spinner', props: { size: 'xs' } },
                        else: { type: 'we-icon', props: { name: 'check', color: 'success-text' } },
                      },
                    },
                    {
                      type: 'we-text',
                      props: { variant: 'footnote', flex: '1', truncate: true },
                      children: [{ $: 'pass.label' }],
                    },
                    {
                      type: 'we-text',
                      props: { variant: 'footnote', color: 'text-faint' },
                      children: [{ $: 'pass.elapsed' }],
                    },
                  ],
                },
              ],
            },
            proposalsReview,
            {
              type: 'Row',
              props: { width: '100%', ay: 'center', gap: '200' },
              children: [
                {
                  type: 'we-text',
                  props: {
                    variant: 'label',
                    color: 'text-muted',
                    textTransform: 'uppercase',
                    letterSpacing: 'wide',
                    flex: '1',
                  },
                  children: ['Extracted'],
                },
                /*
                  Run a pass over the call on screen, rather than over "the call I am in".

                  `extractCollection` takes the record, which is what makes this work on a call
                  somebody opened from the list — `extract` can only ever mean the live one. Gated on
                  `canExtract`, which is the module's own answer about models and targets.
                */
                {
                  type: '$if',
                  props: {
                    condition: { $: 'modules.transcribe.canExtract' },
                    then: {
                      type: 'we-button',
                      props: {
                        size: 'sm',
                        variant: 'ghost',
                        gap: '200',
                        loading: { $: "modules.transcribe.extractStatus == 'running'" },
                        onClick: { $action: 'modules.transcribe.extractCollection', args: [CALL] },
                      },
                      children: [
                        { type: 'we-icon', props: { name: 'sparkle' } },
                        { type: 'we-text', props: { variant: 'footnote' }, children: ['Extract'] },
                      ],
                    },
                  },
                },
              ],
            },
            {
              type: 'we-scroll-area',
              props: { flex: '1', minHeight: '0' },
              children: [
                {
                  type: '$if',
                  props: {
                    condition: CALL,
                    then: {
                      type: 'Column',
                      props: { gap: '200' },
                      children: [
                        /*
                          Both kinds, because both are what a pass may write — `EXTRACTED` is the
                          list, and the board draws from the same one.

                          It queried `TaskBlock` alone, so an extracted event was invisible here
                          while sitting on the board next to it: the readout that exists to say
                          "here is what the model just made" was quietly saying half of it.
                        */
                        extractedRows('TaskBlock', 'check-square', 'title'),
                        extractedRows('EventBlock', 'calendar', 'title'),
                      ],
                    },
                    else: emptyState({ icon: 'sparkle', label: 'extracted records' }),
                  },
                },
              ],
            },
          ],
        },
        else: {
          // A property of the node rather than a failure, so it says so plainly instead of offering
          // a control that cannot work from here. Not `emptyState`, which describes an empty list —
          // this list is not empty, it is unavailable.
          type: 'Column',
          props: { ax: 'center', ay: 'center', gap: '200', p: '400', flex: '1' },
          children: [
            { type: 'we-icon', props: { name: 'plugs', size: 'lg', color: 'text-faint' } },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-faint', textAlign: 'center' },
              children: ['This node has no model configured, so nothing can be extracted from a call.'],
            },
          ],
        },
      },
    },
  ],
};

/**
 * The way into a call: start one, or go to the one already running.
 *
 * `goToCall` is the call module's own verb and does both — it joins when there is no call and moves
 * to the running one when there is. That is exactly why `meta.panels` declares the call window with
 * `open: false`: placing a panel invokes its launcher, and this verb would have started a call for
 * anyone who opened the template. Here it is a button somebody presses, which is the one place it
 * means what it says.
 *
 * ## And it stops naming a call
 *
 * `openLiveCall` after it, or a new call opens behind the *old* one: the address still named
 * whichever call you had been looking at, and `CALL` prefers what the address names, so the
 * transcript and the readout went on showing a finished meeting while a new one was being recorded
 * beside them. Nothing said which was which.
 *
 * Right for the other branch too. "Go to the call" means the one running now, and that is exactly
 * what naming none of them resolves to.
 *
 * Gated on `canCall`, which is "this space can hold a call at all" — a personal space cannot, and an
 * offer to start one there fails at the point of pressing.
 */
const startCall: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'modules.call.canCall' },
    then: {
      type: 'we-button',
      props: {
        size: 'sm',
        gap: '200',
        variant: { $: "modules.call.active ? 'secondary' : 'primary'" },
        onClick: [{ $action: 'modules.call.goToCall' }, openLiveCall],
      },
      children: [
        { type: 'we-icon', props: { name: 'phone-call' } },
        {
          type: 'we-text',
          children: [{ $: "modules.call.active ? 'Go to the call' : 'New call'" }],
        },
      ],
    },
  },
};

/**
 * The transcript of the call on screen — this template's own, not the module's.
 *
 * `@we/module-transcribe` has a perfectly good transcript panel and this template used to place it.
 * It reads `modules.transcribe.collectionId`, which is the call being *recorded into* — so once the
 * call on screen became something the path could name, the module's panel and every other surface
 * here would have been about different calls whenever somebody opened a past one. A panel that
 * disagrees with the board beside it is worse than one more `$query`.
 *
 * So the arrangement is the template's, which is the whole thesis of this package: the feed is a
 * query, the record button is `modules.transcribe.toggle`, and the module still owns everything that
 * is not arrangement — the microphone, the buffering, the writes. The module's own panel is one
 * click away in the chrome rail for anyone who wants it.
 */
const transcriptPanel: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%', p: '300', gap: '300', overflow: 'hidden' },
  children: [
    {
      type: 'Row',
      props: { width: '100%', ay: 'center', gap: '200' },
      children: [
        {
          type: 'we-text',
          props: {
            variant: 'label',
            color: 'text-muted',
            textTransform: 'uppercase',
            letterSpacing: 'wide',
            flex: '1',
          },
          children: [{ $: "routeStore.templateSegments[1] ? 'Past call' : 'Transcript'" }],
        },
        /*
          Recording is about the call you are *in*, so the control is only offered there.

          On a past call the honest offer is to pick it back up — `goToCall` to be in a call at all,
          then `resume` to point the recorder at this record. Gated exactly as the calls list gates
          the same pair: mid-call, on some other call's board, `resume` would re-point every peer's
          live transcript at this one, since peers adopt an announced record over their own.
        */
        {
          type: '$if',
          props: {
            condition: VIEWING_LIVE,
            then: {
              type: '$if',
              props: {
                condition: { $: 'modules.call.active' },
                then: {
                  type: 'we-button',
                  props: {
                    size: 'sm',
                    gap: '200',
                    variant: { $: "modules.transcribe.enabled ? 'secondary' : 'ghost'" },
                    onClick: { $action: 'modules.transcribe.toggle' },
                  },
                  children: [
                    {
                      type: 'we-icon',
                      props: {
                        name: 'microphone',
                        weight: { $: "modules.transcribe.listening ? 'fill' : 'regular'" },
                        color: { $: "modules.transcribe.listening ? 'danger-text' : 'text-muted'" },
                      },
                    },
                    {
                      type: 'we-text',
                      props: { variant: 'footnote' },
                      children: [{ $: "modules.transcribe.enabled ? 'Recording' : 'Record'" }],
                    },
                  ],
                },
              },
            },
            else: {
              type: '$if',
              props: {
                condition: { $: 'modules.call.canCall && !modules.call.active' },
                then: {
                  type: 'we-button',
                  props: {
                    size: 'sm',
                    gap: '200',
                    variant: 'ghost',
                    onClick: [
                      { $action: 'modules.call.goToCall' },
                      { $action: 'modules.transcribe.resume', args: [{ $: 'routeStore.params.call' }] },
                      // And stop naming it: the recorder has just adopted this record, so it is the
                      // live call now, and an address still pinning to it would say the opposite for
                      // the rest of the meeting.
                      openLiveCall,
                    ],
                  },
                  children: [
                    { type: 'we-icon', props: { name: 'phone-call' } },
                    { type: 'we-text', props: { variant: 'footnote' }, children: ['Continue'] },
                  ],
                },
              },
            },
          },
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: CALL,
        /*
          The transcribe module's own feed, pointed at the call on screen.

          This was a copy — the same query, the same byline, written out again here because a
          template cannot import a module. It is published as a part with its subject named, so
          placing it is naming it, and the attribution, the pinned scroll and every later fix to
          them arrive from the module rather than being re-made here.
        */
        then: { type: '$part', props: { id: 'transcribe.transcriptFeed', subject: CALL } },
        else: emptyState({ icon: 'microphone', label: 'a transcript' }),
      },
    },
  ],
};

/**
 * Pick a call up again — and land on the board that is about it.
 *
 * This template's three routes are all about `modules.transcribe.collectionId`: the transcript
 * panel, the extraction readout and the board all read it. Nothing set it but a call starting, so
 * after a refresh the template was about no call at all and the only way back was to start a new
 * one — a fresh meeting, beside the record of the one you actually wanted.
 *
 * `resume` is what sets it: it takes a *record* id (not a call id, which names the place calls
 * happen rather than any one of them) and holds it until there is a call to attach it to. Paired
 * with `goToCall`, that is "continue this conversation".
 *
 * ## The gate, which is the same one `CallsList` arrived at
 *
 * Offered only when no call is running — where it continues *this* one — or when this row **is** the
 * running call, where "go to the call" can only mean the one it is attached to. Mid-call on any
 * other row, `goToCall` silently tears down the call you are in and `resume` re-points everybody's
 * live transcript at last month's meeting, since peers adopt an announced record over their own. See
 * the long note in `templates/views/.../CallsList.ts`; this is the second surface with the problem
 * and the reasoning is not repeated here.
 *
 * Absent rather than disabled, for the same reason it is there: a disabled button does not reliably
 * deliver hover to the tooltip that would explain it, so the explanation is the part that goes
 * missing.
 */
const continueCall: SchemaNode = {
  type: '$if',
  props: {
    condition: {
      $: 'modules.call.canCall && (!modules.call.active || call.id == modules.transcribe.liveCollectionId)',
    },
    then: {
      type: 'we-tooltip',
      props: {
        title: { $: "modules.call.active ? 'Go to the call' : 'Continue this call and put it on the board'" },
        placement: 'top',
      },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'sm',
            square: true,
            /*
              Branched in the handler rather than around the node, so one button is rendered either
              way. Handler arrays resolve lazily, so each condition reads the store as it is when the
              button is pressed rather than as it was when the row painted.
            */
            onClick: [
              {
                $if: {
                  condition: { $: 'modules.call.active' },
                  then: { $action: 'modules.call.goToCall' },
                },
              },
              {
                $if: {
                  condition: { $: '!modules.call.active' },
                  // Two actions rather than one with an `onSuccess`: `goToCall` returns nothing for a
                  // lifecycle key to hang off, and `resume` holds the record until there is a call to
                  // attach it to, so the order they resolve in does not matter.
                  then: [
                    { $action: 'modules.call.goToCall' },
                    { $action: 'modules.transcribe.resume', args: [{ $: 'call.id' }] },
                  ],
                },
              },
              // The point of picking a call: its board. Cleared rather than named, for the reason
              // above — resuming makes this the live call.
              openLiveCall,
            ],
          },
          children: [{ type: 'we-icon', props: { name: 'phone-call', size: '20px' } }],
        },
      ],
    },
  },
};

/**
 * The calls, as a panel — how you change which call every other surface is about.
 *
 * The same list the `/calls` route draws, without the transcripts: choosing is a two-second act and
 * a panel that made you scroll past a meeting to reach the one below it would not be a switcher.
 *
 * Declared with no `route`, so it is reachable from the tasks list as well. Selection is a
 * *navigation* — `./board/<id>` — which is what makes it survive a reload and paste into a message.
 */
const callsPanel: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%', p: '300', gap: '300', overflow: 'hidden' },
  /*
    Which call a delete is about, held on the panel rather than on the row.

    A row cannot hold it: `$localState` names are fixed when the template is written and the rows
    come from a query, so there is no name per row — the id is the state. One dialog outside the
    list, told which call it is for.

    `confirmingIsCurrent` is captured at the same moment and for a reason worth stating: after the
    delete the dialog's own close clears `confirming`, so an `onSuccess` asking "was that the call on
    screen?" would be comparing against an id that is already gone.
  */
  $localState: {
    confirming: { type: 'string', initial: '' },
    confirmingIsCurrent: { type: 'boolean', initial: false },
    deleting: { type: 'boolean', initial: false },
  },
  $queries: {
    calls: { entity: 'CollectionBlock', where: { kind: 'call' }, order: { createdAt: 'desc' }, limit: 30 },
  },
  children: [
    {
      type: 'Row',
      props: { width: '100%', ay: 'center', gap: '200' },
      children: [
        {
          type: 'we-text',
          props: {
            variant: 'label',
            color: 'text-muted',
            textTransform: 'uppercase',
            letterSpacing: 'wide',
            flex: '1',
          },
          children: ['Calls'],
        },
        startCall,
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'count(local.calls)' },
        then: {
          type: 'we-scroll-area',
          props: { flex: '1', minHeight: '0' },
          children: [
            {
              type: 'Column',
              props: { gap: '100' },
              children: [
                {
                  type: '$each',
                  props: { items: { $: 'local.calls' }, as: 'call' },
                  children: [
                    {
                      // Two verbs, side by side rather than nested: looking at a call and recording
                      // into it are different weights, and a button inside a button is not a thing.
                      type: 'Row',
                      props: { width: '100%', ay: 'center', gap: '100' },
                      children: [
                        {
                          type: 'we-button',
                          props: {
                            variant: { $: `call.id == (${CALL_EXPR}) ? 'secondary' : 'ghost'` },
                            flex: '1',
                            ax: 'start',
                            gap: '200',
                            // The whole of choosing: the id goes in the address, and every surface
                            // follows. Nothing is joined, claimed or written.
                            onClick: openCall('call.id'),
                          },
                          children: [
                            {
                              type: 'we-icon',
                              props: {
                                name: 'phone-call',
                                color: {
                                  $: "call.id == modules.transcribe.liveCollectionId ? 'danger-text' : 'text-faint'",
                                },
                              },
                            },
                            {
                              type: 'we-timestamp',
                              props: { value: { $: 'call.createdAt' }, relative: true, flex: '1', truncate: true },
                            },
                          ],
                        },
                        // The heavy half — join a call and point the recorder at this record.
                        continueCall,
                        {
                          type: 'we-tooltip',
                          props: { title: 'Delete this call', placement: 'top' },
                          children: [
                            {
                              type: 'we-button',
                              props: {
                                variant: 'ghost',
                                size: 'sm',
                                square: true,
                                color: 'text-faint',
                                hoverProps: { color: 'danger-text' },
                                onClick: [
                                  { $setLocal: 'confirming', value: { $: 'call.id' } },
                                  { $setLocal: 'confirmingIsCurrent', value: { $: `call.id == (${CALL_EXPR})` } },
                                ],
                              },
                              children: [{ type: 'we-icon', props: { name: 'trash' } }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        else: emptyState({ icon: 'archive', label: 'recorded calls' }),
      },
    },
    /*
      Asked for here, rather than left to the host's own destructive prompt.

      A space template's actions are guarded at the tier boundary — `templateBag` puts
      `shellStore.requestDestructive` in front of every action marked destructive, which is why the
      calls list in `CardsView` needs no dialog of its own. A **panel** is not rendered through that
      bag: its frame is registered into the slot registry and drawn with the *chrome* bag, which has
      no guard, because chrome is authored in this repo and asks its own questions. So this one asks.
      Without it, a click one pixel from "continue this call" would delete a meeting and everything
      said in it, with nothing in between.
    */
    confirmModal({
      open: { $: 'local.confirming' },
      close: { $setLocal: 'confirming', value: '' },
      title: 'Delete this call?',
      body: 'The recording, its transcript and everything extracted from it go with it. This cannot be undone.',
      confirmLabel: 'Delete',
      // A recursive delete walks the whole collection, so it is not instant — without a spinner the
      // button absorbs the click and invites a second one.
      busyLocal: 'deleting',
      confirm: {
        $action: 'spaceStore.deleteCollection',
        args: [{ $: 'local.confirming' }],
        // Only when the record just deleted is the one every other surface is reading. Deleting some
        // other call must not move you off the one you are looking at.
        onSuccess: [{ $if: { condition: { $: 'local.confirmingIsCurrent' }, then: openLiveCall } }],
      },
    }),
  ],
};

/**
 * The board — what the call produced, arranged.
 *
 * The `board` seed over the call's own collection: its contents at the positions somebody put them.
 * `contains` narrows it to what extraction makes, because the collection's children are *also* every
 * utterance, and a board of six hundred transcript fragments is not a board.
 *
 * `manual` layout parks anything without a placement in a grid, which is what makes a freshly
 * extracted record appear somewhere sensible rather than stacked at the origin. Dragging pins it and
 * `onNodeDragEnd` writes that back — without which the board is a layout that forgets, silently,
 * until the next reload.
 */
const board: SchemaNode = {
  type: 'GraphView',
  props: {
    seeds: {
      source: 'board',
      options: { board: CALL, contains: EXTRACTED, connections: 'Relationship' },
    },
    // Nothing opens automatically: a card's own blocks are fragments of it, not more cards.
    expansion: { defaultDepth: 0 },
    layout: { type: 'manual' },
    nodeStyle: [
      { style: { shape: 'card', width: 180, content: 'block', contentMinZoom: 0.5 } },
      { when: { type: 'TaskBlock' }, style: { color: 'primary-50', labelColor: 'primary-800' } },
      { when: { type: 'EventBlock' }, style: { color: 'warning-50', labelColor: 'warning-800' } },
      // The card's own presentation, in front of the rules above — a size and colour somebody chose
      // is a fact about the card, where the rules are this template's opinion about a kind.
      {
        style: {
          width: { from: 'data.boardWidth' },
          height: { from: 'data.boardHeight' },
          color: { from: 'data.boardColor' },
        },
      },
    ],
    behaviours: [
      // Before drag-node, which is what makes arming mean anything: both claim a press on a node.
      { type: 'connect-nodes', options: { armed: { $: 'local.connecting' } } },
      'select',
      { type: 'drag-node', options: { pin: true } },
      // Last, because it is the background fallback — listed earlier it claims the press `select`
      // needs to see, and clicking empty canvas silently stops clearing the selection.
      'pan-zoom',
    ],
    edgeStyle: [{ style: { curve: 'smooth', arrow: 'target', width: 2, showLabel: true } }],
    controls: ['zoom-in', 'zoom-out', 'fit', 'lock'],
    height: '100%',
    /*
      The graph's own status strip, on.

      Every read a seed makes is caught and reported through `context.warn` rather than thrown — a
      board that cannot read one of its types keeps the rest — and with no strip there is nowhere for
      that report to land. A board that silently draws nothing is then indistinguishable from a call
      that produced nothing, which is exactly the state this template spent three sittings in.
    */
    showStatus: true,
    // Connecting two records means the same thing wherever the line was drawn, so it goes through
    // the same store call the knowledge map makes and ends in the same form.
    onEdgeCreate: { $action: 'recordStore.connectNodes', args: [{ $: 'event' }] },
    /*
      The drop, written back — an upsert against the *board* rather than an update of the record.

      A coordinate is a fact about the pair, so the same task can sit on two boards in two places and
      the record never learns it was on one. `recordId`/`recordType` rather than the node's address:
      the graph names a node `we-graph://entity/<dataset>/<type>/<id>` and a template has no operator
      that could take that apart.
    */
    onNodeDragEnd: {
      $action: 'recordStore.placeOnBoard',
      args: [CALL, { $: 'event.recordId' }, { $: 'event.recordType' }, { $: 'event.x' }, { $: 'event.y' }],
    },
    onNodeResize: { $action: 'recordStore.resizeOnBoard', args: [CALL, { $: 'event' }] },
  },
};

/**
 * The board's body. One route, whichever call it is about: the id is a query parameter, so the path
 * is the same for the live call and for one somebody chose — see `CALL`.
 */
const boardBody: Omit<RouteSchema, 'path'> = {
  type: 'Column',
  /*
    `flex: 1`, not `height: '100%'` — and the difference is the whole board.

    The root is `minHeight: '100%'`, because the task list and the calendar are taller than the
    viewport and must grow. That leaves its *specified* height `auto`, and a percentage height
    against an auto-height parent is `auto`: so this box was as tall as its content, and its content
    is a canvas that sizes itself from its container. The graph read its row, built its node, placed
    it and laid it out into a box 2009 pixels wide and 0 high — a blank rectangle indistinguishable
    from a call that produced nothing, which is where three sittings of this went.

    A flex-grown item has a definite used height, so the percentage inside it resolves. This is the
    chain the graph view in `templates/views` uses, and the one the panels above already use.
  */
  props: { width: '100%', flex: '1', minHeight: '0', overflow: 'hidden' },
  $localState: { connecting: { type: 'boolean', initial: false } },
  children: [
    {
      type: '$if',
      props: {
        condition: CALL,
        then: board,
        /*
          No collection means nothing has been said yet — the record is created on the first
          utterance, so its absence is exactly "this call has produced nothing".

          Padded clear of the switcher, where the board itself is not. A graph is *meant* to run under
          the floating bar — that is what a full-bleed view with chrome over it looks like, and its
          own controls sit at the other corners. Text centred in the same box is not: it reads as
          content that has slid underneath something, because that is exactly what it is.
        */
        else: {
          type: 'Column',
          props: { width: '100%', height: '100%', pt: '900' },
          children: [
            gatePrompt({
              icon: 'graph',
              iconColor: 'text-faint',
              title: 'Nothing to arrange yet',
              body: 'Start a call and turn on recording. What the conversation produces appears here as cards you can move and join up.',
            }),
          ],
        },
      },
    },
  ],
};

const boardRoute: RouteSchema = { path: '/board', ...boardBody };

/** The states a task moves through. `status` is a closed vocabulary the model fills from. */
const COLUMNS = [
  { status: 'todo', label: 'To do', color: 'text-muted' },
  { status: 'in-progress', label: 'In progress', color: 'accent-text' },
  { status: 'done', label: 'Done', color: 'success-text' },
];

/**
 * The tasks, by state.
 *
 * Read off `status` rather than off containment, which is the distinction `TasksView` already draws
 * and is worth keeping: a kanban board's columns are collections and moving a card is a relink,
 * while a task's state is a property of the task. Extraction fills `status`, so these columns are
 * populated by the conversation rather than by anyone dragging.
 *
 * Every task in the space, not only this call's — the point of the list is what is outstanding, and
 * a task does not stop being outstanding because the meeting it came from ended.
 */
const tasksRoute: RouteSchema = {
  path: '/tasks',
  type: 'Column',
  props: { width: '100%', minHeight: '100%', ax: 'center', px: '400', pt: '900', pb: '600' },
  children: [
    {
      type: 'Grid',
      props: { width: '100%', maxWidth: 'var(--we-layout-lg)', minChildWidth: '260px', gap: '400' },
      children: [
        {
          type: '$each',
          props: { items: COLUMNS, as: 'column' },
          children: [
            {
              type: 'Column',
              props: { gap: '300', bg: 'surface', r: '400', border: '1px solid border', p: '400' },
              $queries: {
                tasks: { entity: 'TaskBlock', where: { status: { $: 'column.status' } }, order: { createdAt: 'desc' } },
              },
              children: [
                {
                  type: 'Row',
                  props: { ay: 'center', gap: '200' },
                  children: [
                    {
                      type: 'we-text',
                      props: { variant: 'label', color: { $: 'column.color' } },
                      children: [{ $: 'column.label' }],
                    },
                    {
                      type: 'we-badge',
                      props: { size: 'xs' },
                      children: [{ $: 'count(local.tasks)' }],
                    },
                  ],
                },
                {
                  type: '$if',
                  props: {
                    condition: { $: 'count(local.tasks)' },
                    then: {
                      type: 'Column',
                      props: { gap: '300' },
                      children: [
                        {
                          type: '$each',
                          props: { items: { $: 'local.tasks' }, as: 'task' },
                          children: [
                            {
                              type: 'Column',
                              props: { gap: '200', bg: 'surface-sunken', r: '300', p: '300' },
                              children: [
                                { type: 'we-text', props: { fontWeight: 'medium' }, children: [{ $: 'task.title' }] },
                                {
                                  type: '$if',
                                  props: {
                                    condition: { $: 'task.description' },
                                    then: {
                                      type: 'we-text',
                                      props: { variant: 'footnote', color: 'text-muted' },
                                      children: [{ $: 'task.description' }],
                                    },
                                  },
                                },
                                {
                                  type: 'Row',
                                  props: { ay: 'center', ax: 'between', gap: '200', wrap: true },
                                  children: [
                                    // Who wrote it — which for an extracted task is whoever's node
                                    // ran the pass, so it answers "where did this come from".
                                    agentByline({ did: { $: 'task.author' }, as: 'author', avatarSize: 'xxs' }),
                                    {
                                      type: '$if',
                                      props: {
                                        condition: { $: 'task.dueDate' },
                                        then: {
                                          type: 'we-timestamp',
                                          props: { value: { $: 'task.dueDate' }, fontSize: '100', color: 'text-faint' },
                                        },
                                      },
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    else: {
                      type: 'we-text',
                      props: { variant: 'footnote', color: 'text-faint', italic: true },
                      children: ['Nothing here.'],
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/**
 * The events under the grid: the chosen day's, or what is coming when no day is chosen.
 *
 * Two readings of one query, because a month grid answers "what does this month look like" and a
 * list answers "what is next" — and the second is the question most people open a calendar with.
 * Both read the hoisted `events`, so the grid and the list can never disagree about what is there.
 *
 * A row says when, what, and who is coming: extraction writes a title and a date off what was said,
 * and `participants` is how anybody answers it afterwards.
 */
const eventList: SchemaNode = {
  type: 'Column',
  props: { width: '100%', gap: '300' },
  children: [
    {
      type: 'we-text',
      props: {
        variant: 'label',
        color: 'text-muted',
        textTransform: 'uppercase',
        letterSpacing: 'wide',
        text: { $: "local.day ? local.day : 'Coming up'" },
      },
    },
    {
      type: '$if',
      props: {
        condition: {
          $: 'count(local.day ? filter(local.events, { startDate: { startsWith: local.day } }) : local.events)',
        },
        then: {
          type: 'Column',
          props: { width: '100%', gap: '300' },
          children: [
            {
              type: '$each',
              props: {
                items: {
                  $: 'local.day ? filter(local.events, { startDate: { startsWith: local.day } }) : local.events',
                },
                as: 'event',
              },
              children: [
                {
                  type: 'Row',
                  props: {
                    width: '100%',
                    ay: 'center',
                    gap: '300',
                    bg: 'surface',
                    r: '400',
                    border: '1px solid border',
                    p: '400',
                  },
                  children: [
                    { type: 'we-icon', props: { name: 'calendar', color: 'accent-text' } },
                    {
                      type: 'Column',
                      props: { flex: '1', gap: '100' },
                      children: [
                        { type: 'we-text', props: { fontWeight: 'semibold', text: { $: 'event.title' } } },
                        {
                          type: '$if',
                          props: {
                            condition: { $: 'event.location' },
                            then: {
                              type: 'we-text',
                              props: { variant: 'footnote', color: 'text-muted', text: { $: 'event.location' } },
                            },
                          },
                        },
                      ],
                    },
                    {
                      type: 'we-timestamp',
                      props: {
                        value: { $: 'event.startDate' },
                        color: 'text-muted',
                        // The date is already the heading a reader arrived through, so the row says
                        // the part that is not: when in the day.
                        hour: '2-digit',
                        minute: '2-digit',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        else: emptyState({
          icon: 'calendar',
          label: 'events',
        }),
      },
    },
  ],
};

/**
 * The events, as a month.
 *
 * The counterpart to the tasks list, and the same argument: a conversation produces two kinds of
 * commitment, one with a date on it and one without, and neither stops mattering because the meeting
 * ended. So this is every `EventBlock` in the space rather than this call's — the calendar answers
 * "what is coming", which is a question about the community and not about a recording.
 *
 * It replaces the archive of past calls, which the calls panel does better and from every route.
 *
 * ## Why a grid built out of nodes rather than the `Calendar` component
 *
 * `Calendar` owns its own grid and can only be styled from outside; every cell here is the
 * template's, which is what lets a fork turn a title chip into a count, a heat square or a week
 * view without touching code. The one thing a schema cannot compute for itself — which weekday the
 * 1st falls on, how long a month is, how many cells make whole weeks — comes from `calendarMonth()`,
 * a host function. Code answers the arithmetic; the drawing is data. The same division `CalendarView`
 * makes, and the second of the two surfaces that make it.
 *
 * ## Dates
 *
 * `startDate` is `YYYY-MM-DDTHH:mm` and a cell is a day, so the match is `startsWith` over the
 * cell's date — exact for a fixed-width datetime, where a `YYYY-MM-DD` substring can occur nowhere
 * but position 0. It is a `filter()` over the month's own hoisted query rather than a `$query` per
 * cell: one subscription sifted 42 times, against 42 subscriptions for rows already in hand.
 */
const eventsRoute: RouteSchema = {
  path: '/events',
  type: 'Column',
  props: { width: '100%', minHeight: '100%', ax: 'center', px: '400', pt: '900', pb: '600' },
  children: [
    {
      type: 'Column',
      props: { width: '100%', maxWidth: 'var(--we-layout-lg)', gap: '400' },
      $localState: {
        // Paging is arithmetic on an offset, so every source reads the same offset and the template
        // only ever adds to it.
        monthOffset: { type: 'number', initial: 0 },
        // The day a reader has picked, as `YYYY-MM-DD`, or empty for the whole month.
        day: { type: 'string', initial: '' },
      },
      $queries: {
        events: { entity: 'EventBlock', order: { startDate: 'asc' }, limit: 200 },
      },
      children: [
        // ── The month, with the way through them either side ──────────────────
        {
          type: 'Row',
          props: {
            width: '100%',
            ay: 'center',
            gap: '100',
            bg: 'surface',
            r: '500',
            border: '1px solid border',
            px: '400',
            py: '300',
          },
          children: [
            {
              type: 'we-text',
              props: { variant: 'heading-sm', flex: '1', text: { $: 'monthLabel({ offset: local.monthOffset })' } },
            },
            {
              // Only when it would do something: "Today" on a calendar already showing today is a
              // button that cannot be pressed to any effect.
              type: '$if',
              props: {
                condition: { $: 'local.monthOffset' },
                then: {
                  type: 'we-button',
                  props: { size: 'sm', variant: 'ghost', onClick: { $setLocal: 'monthOffset', value: 0 } },
                  children: ['Today'],
                },
              },
            },
            {
              type: 'we-button',
              props: {
                size: 'sm',
                variant: 'ghost',
                square: true,
                onClick: { $setLocal: 'monthOffset', value: { $: 'local.monthOffset - 1' } },
              },
              children: [{ type: 'we-icon', props: { name: 'caret-left' } }],
            },
            {
              type: 'we-button',
              props: {
                size: 'sm',
                variant: 'ghost',
                square: true,
                onClick: { $setLocal: 'monthOffset', value: { $: 'local.monthOffset + 1' } },
              },
              children: [{ type: 'we-icon', props: { name: 'caret-right' } }],
            },
          ],
        },

        // ── The grid ──────────────────────────────────────────────────────────
        {
          type: 'Column',
          props: {
            width: '100%',
            gap: '300',
            bg: 'surface-sunken',
            border: '1px solid border',
            r: '500',
            p: '400',
          },
          children: [
            {
              type: 'Row',
              props: { width: '100%', gap: '100' },
              children: [
                {
                  type: '$each',
                  props: { items: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'], as: 'weekday' },
                  children: [
                    {
                      type: 'Row',
                      props: { flex: '1', ax: 'center' },
                      children: [
                        {
                          type: 'we-text',
                          props: { variant: 'footnote', color: 'text-muted', text: { $: 'weekday' } },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: 'Row',
              props: { width: '100%', gap: '100', wrap: true },
              children: [
                {
                  type: '$each',
                  props: { items: { $: 'calendarMonth({ offset: local.monthOffset })' }, as: 'cell' },
                  children: [
                    {
                      type: 'Column',
                      props: {
                        // Seven to a row, by width rather than by a grid the schema cannot express.
                        width: 'calc(14.28% - 6px)',
                        minHeight: '92px',
                        gap: '050',
                        p: '100',
                        r: '300',
                        cursor: 'pointer',
                        overflow: 'hidden',
                        // A tint and an outline rather than a fill: with titles in the cell, a solid
                        // fill wins every contrast fight against its own contents.
                        bg: { $: "cell.date == local.day ? 'accent-muted' : cell.inMonth ? '' : 'page'" },
                        border: { $: "cell.date == local.day ? '1px solid accent' : '1px solid transparent'" },
                        hoverProps: { bg: { $: "cell.date == local.day ? 'accent-muted' : 'surface-hover'" } },
                        // Pressing the selected day again releases it — the first thing anyone tries.
                        // Inside the handler so it reads the state at click time, not at paint.
                        onClick: [
                          {
                            $if: {
                              condition: { $: 'cell.date == local.day' },
                              then: { $setLocal: 'day', value: '' },
                              else: { $setLocal: 'day', value: { $: 'cell.date' } },
                            },
                          },
                        ],
                      },
                      children: [
                        {
                          // Today in a filled disc — the one convention people read without being
                          // taught.
                          type: 'Row',
                          props: {
                            width: '20px',
                            height: '20px',
                            ax: 'center',
                            ay: 'center',
                            r: 'pill',
                            bg: { $: "cell.isToday ? 'accent' : ''" },
                          },
                          children: [
                            {
                              type: 'we-text',
                              props: {
                                fontSize: '100',
                                text: { $: 'cell.day' },
                                color: { $: "cell.isToday ? 'on-accent' : cell.inMonth ? 'text' : 'text-faint'" },
                                fontWeight: { $: "cell.isToday ? 'semibold' : ''" },
                              },
                            },
                          ],
                        },
                        {
                          type: '$each',
                          props: {
                            items: { $: 'filter(local.events, { startDate: { startsWith: cell.date } }, 2)' },
                            as: 'mark',
                          },
                          children: [
                            {
                              type: 'we-text',
                              props: {
                                width: '100%',
                                fontSize: '100',
                                truncate: true,
                                px: '100',
                                r: '200',
                                text: { $: 'mark.title' },
                                // Faded for the neighbouring months, so a busy 1st of next month
                                // does not read as part of the month being looked at.
                                bg: { $: "cell.inMonth ? 'accent-muted' : 'surface-sunken'" },
                                color: { $: "cell.inMonth ? 'accent-text' : 'text-muted'" },
                              },
                            },
                          ],
                        },
                        {
                          // A third event and beyond, as a count. The two titles above answer "is
                          // this worth clicking"; a number answers "how much more is there".
                          type: '$if',
                          props: {
                            condition: {
                              $: 'count(filter(local.events, { startDate: { startsWith: cell.date } })) > 2',
                            },
                            then: {
                              type: 'we-text',
                              props: {
                                variant: 'footnote',
                                color: 'text-faint',
                                px: '100',
                                text: {
                                  $: '`+${count(filter(local.events, { startDate: { startsWith: cell.date } })) - 2} more`',
                                },
                              },
                            },
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },

        // ── What is on the chosen day, or what is next ────────────────────────
        eventList,
      ],
    },
  ],
};

export const workshopTemplate: TemplateSchema = {
  meta: {
    name: 'Workshop',
    description: 'A call, its transcript, and what came out of it — as a board, a task list and a record.',
    icon: 'compass-tool',
    /*
      The band the floating switcher occupies, so panels clear it.

      Its collapsed height, as the contract asks: the bar is a row of `sm` buttons in a padded pill,
      and it never grows. The width is generous on purpose — over-reporting costs a panel that moves
      slightly earlier than it had to, and under-reporting puts two things on top of each other.
    */
    chromeReserve: { top: 64, width: 420 },
    /*
      The layout, and none of it is scoped to a route.

      It was: the transcript and the readout were declared `route: 'board'`, on the argument that a
      task list does not need a transcript beside it. True, and beside the point — crossing to the
      tasks list *unregistered* both panels, so their scroll position, their subscriptions and
      wherever they had been dragged were destroyed and rebuilt on the way back. Panels that survive
      navigation is the whole difference between a panel and a region of a page; scoping them by
      route gave that up to save a column of context nobody minded.

      Left standing, they cost nothing to switch between: the declaration is unchanged across a route
      change, so nothing is announced and nothing re-registers.

      The call is placed on every route and opened by none of them — see `open` in `TemplatePanel`.
    */
    panels: [
      /*
        The transcript is this template's own node, where it used to be `module: 'transcribe'`.

        The module's panel reads `modules.transcribe.collectionId` — the call being recorded into —
        and the call *on screen* is now whatever the path names. Placing the module's panel would put
        one surface about a different call beside three about this one, which is worse than either
        answer on its own. What the module owns is unchanged: the microphone, the buffering and every
        write. This is arrangement, which is the layer templates are made of.
      */
      /*
        The transcribe module's panel, arranged here.

        `module` *and* `node` together: the module goes on owning whether the surface is up — press
        record anywhere and it opens — and this owns what is inside it. Declared as a panel of its
        own instead, as it was, the module's panel opened beside this one on the first press and the
        screen carried two transcripts of the same call.
      */
      {
        id: 'transcript',
        module: 'transcribe',
        node: transcriptPanel,
        title: 'Transcript',
        snap: 'left',
        order: 0,
        size: 'sm',
        grow: 1,
      },
      {
        id: 'extraction',
        node: extractionPanel,
        title: 'Extraction',
        snap: 'left',
        order: 1,
        size: 'sm',
        // Pinned to its own height while the transcript above absorbs the slack — which is what
        // "the transcript takes most of the height" is made of.
        grow: 0,
      },
      { id: 'calls', node: callsPanel, title: 'Calls', snap: 'right', order: 0, size: 'sm', open: false },
      { id: 'call', module: 'call', snap: 'right', order: 1, size: 'sm', open: false },
    ],
  },
  type: 'Column',
  /*
    A **definite** height, which is the one thing a full-bleed route needs from its root.

    This was `minHeight: '100%'`, so that a route taller than the viewport grew rather than clipped.
    It does grow — and the box growing is not the same as the height being *definite*. A flex item's
    post-flex main size counts as definite only where its container's main size is, and `height:
    auto` with a min-height clamp is not: so the board route stretched down the screen while the
    canvas inside it resolved `height: 100%` against an indefinite height, got `auto`, and measured
    zero. The board grew; the percentage inside it did not.

    Nothing is lost by pinning it. The hazard `minHeight` was avoiding — this node's background
    stopping at the fold under a long task list — belongs to the scroll container above, which paints
    `page` across its whole scrollable area and says so. A tall route overflows this box, is not
    clipped (no `overflow` here), and scrolls in that container exactly as before.
  */
  props: { bg: 'page', width: '100%', height: '100%' },
  children: [switcher, { type: '$routes' }],
  routes: [
    /*
      Relative, because the parent path this now sits under carries a parameter: an absolute target
      is joined to the *pattern*, so `/board` became a literal `/space/:spaceId/board`. Relative
      resolves against the address actually on screen.
    */
    { path: '/', redirect: './board' },
    boardRoute,
    tasksRoute,
    eventsRoute,
    {
      path: '*',
      type: 'Column',
      props: { flex: '1', ax: 'center', ay: 'center', p: '600' },
      children: [{ type: 'we-text', props: { color: 'text-faint' }, children: ['No such page.'] }],
    },
  ],
};
