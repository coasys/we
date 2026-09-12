/**
 * Workshop — a call, its transcript, and what came out of it.
 *
 * The seventh showcase template, and the first that is about *panels* rather than about a content
 * arrangement. The other six demonstrate that channels, canvases, playlists and events are all one
 * container seen differently; this one demonstrates that where the surfaces around the content sit
 * is also data.
 *
 * ## The screen
 *
 * A call is running. Down the left, the transcript as everyone speaks, and beneath it a readout of
 * what extraction is making of it. On the right, the call itself. In the middle, a canvas of the
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
 * the canvas's cards are the `TaskBlock`s and `EventBlock`s extraction already produces from it. The
 * template is arrangement over both.
 *
 * ## Where the panels come from
 *
 * `meta.panels`, and three of the four kinds of entry it can carry:
 *
 * - **`node`** for the extraction readout and the calls list — this template's own schema.
 * - **`module`** for the call stage, which no schema could express, and for the transcript, which
 *   one could and should not. The transcript was a `node` here for one real reason: the module's
 *   panel read the call being *recorded into*, and everything here is about the call *on screen*.
 *   Writing a body bought that and a second copy of the header, the feed and the gating, which
 *   promptly drifted — the copy never gained the module's coverage readout or its capture status,
 *   so the interface built around recording a meeting said less about a failing microphone than the
 *   default one did. Following the address is what any transcript panel should do, so it lives in
 *   the module now and this places it. A body is for an arrangement the module genuinely cannot
 *   express, not for a difference it should have absorbed.
 * - **no `route` on any of them.** The key exists for a shell that routes itself and wants a panel on
 *   one page only — but scoping these to the canvas meant crossing to the kanban *unregistered*
 *   them, throwing away their scroll position, their subscriptions and wherever they had been
 *   dragged. A column of context on a page that did not strictly need it is the cheaper of the two.
 * - **`open: false`** on the call, because the call module's launcher action is `goToCall`, which
 *   *joins a call* when there is not one. Placed, never opened.
 */
import type { RouteSchema, SchemaNode, SchemaProp, TemplateSchema } from '@we/schema-shared';
// `field` and `formModal` through the template kit rather than `@we/schema-kit`: this package
// depends on the former, which re-exports them, and on the latter not at all.
import {
  anchorScope,
  composerModal,
  emptyState,
  field,
  formModal,
  panelHeader,
  panelScroll,
  peopleRow,
  recordFormModal,
  taskBoard,
  taskBoardLoading,
} from '@we/template-kit';

import {
  askWhatGoesHere,
  CARD_LOCALS,
  editNoteModal,
  fieldEditor,
  newNoteModal,
  newThingChooser,
} from './WorkshopCards.ts';
import {
  CANVAS_FILL,
  keyPanel,
  kindIcon,
  kindLabel,
  LENS_PARAM,
  LENS_QUERY,
  lensNodeRules,
  LINK_FILL,
  NO_LENS,
  PLAIN_FILL,
  TYPE_STYLES_QUERY,
} from './WorkshopKey.ts';

/**
 * The call on screen — **named in the address**, or the one being recorded when it names none.
 *
 * Every surface here is about one call: the transcript, the extraction readout, the canvas. That id
 * used to be `modules.transcribe.collectionId`, which means "the call I am recording into" — so
 * looking at a finished call meant *joining a call* first, a refresh left the template about no call
 * at all, and there was no way to send somebody the canvas you were looking at. In the address
 * instead, which answers all three: it survives a reload, pastes into a message, and needs no state
 * anywhere. The live call is the default, so the ordinary case — you are in a meeting, you open the
 * canvas — is unchanged and names nothing.
 *
 * ## A query parameter, not a path segment
 *
 * `/canvas/<call>` was the obvious spelling and it cannot work: a record id is a **URI**
 * (`we://…/<uuid>`), so it carries slashes and a colon, and `./canvas/we://…` is several segments —
 * `/canvas/:callId` matches none of them, and every click landed on the catch-all with "Page not
 * found". A query value takes those characters as they are, which is why the host's own record
 * links are `…/record/<Entity>?id=<id>` and not a segment either.
 *
 * ## The call module, not the transcriber
 *
 * The fallback asks **the capability that owns the fact**. `modules.transcribe.liveCollectionId`
 * means "the record I am writing into", and the transcriber only adopts the call's record when it
 * first has something to write — so for the whole opening stretch of a meeting its honest answer is
 * "nothing", and every surface here waited for somebody to speak before it would admit a call was
 * happening. The record exists from the first second: `startCall` writes it before anyone joins and
 * publishes it on presence. `callRecordId` is that, which is the question these surfaces are
 * actually asking.
 */
const CALL_EXPR = 'routeStore.params.call ? routeStore.params.call : modules.call.callRecordId';
const CALL = { $: CALL_EXPR };

/**
 * What extraction is allowed to make from a transcript — asked, rather than restated.
 *
 * This was `['TaskBlock', 'EventBlock']`, a copy of the two classes the module used to compile in,
 * with a comment admitting that the canvas would silently stop showing a new kind if that list ever
 * grew. It grew: what a space extracts is a community decision now, and the extraction panel offers
 * it as chips somebody can change mid-call. So the constant went from a maintenance note to a bug
 * one click away — turn on `Sighting`, extract, and the records land in the collection while the
 * canvas shows nothing and says nothing.
 *
 * The call's own list, not the space's: those differ the moment somebody narrows a call, and it is
 * the call that this canvas is about. Every entity in it, whether or not it is currently ticked — a
 * model switched off half way through a meeting must not take what it already found off the canvas.
 */
const EXTRACTED = { $: `modules.transcribe.extractionFor[${CALL_EXPR}].targets.map(t, t.entity)` };

/**
 * The page on screen, as a segment — or the canvas, before the redirect has landed on one.
 *
 * Changing which call you are looking at is not a reason to change the page. Both of these used to
 * name `canvas` outright, so choosing a call from the kanban threw you onto the canvas, and the
 * only way back was the switcher.
 */
const PAGE_EXPR = "routeStore.templateSegments[0] ? routeStore.templateSegments[0] : 'canvas'";

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

    The key's lens comes along — an explicit `?` drops whatever the address held, so a navigation
    that spelt only the call would turn the lens back to its default on every change of call.
  */
  $action: 'routeStore.navigate',
  args: [{ $: `\`\${spaceStore.spacePath}/\${${PAGE_EXPR}}?call=\${${callExpr}}${LENS_QUERY}\`` }],
});

/** Look at a call, wherever you are. */
const openCall = (idExpr: string): SchemaProp => pageWithCall(idExpr);

/**
 * Back to the call being recorded — the same one navigation, naming no call.
 *
 * An empty value rather than a bare path. `navigate` restores the query a path was last left with —
 * which is what makes leaving for the kanban and coming back keep the call you were on — so the
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
/**
 * The three pages, named for the arrangement rather than for what happens to be in them.
 *
 * They were `canvas`, `tasks` and `events` — one named for its form and two for a content type,
 * which reads as three different subjects when it is three readings of one. What a call produces is
 * not a fixed pair either: `EXTRACTED` asks the call what it is extracting, so a community that
 * defines a `Sighting` gets Sightings on the canvas, and two tabs named after two members of an open
 * set stop describing it the moment somebody adds a third. A form-name stays true — a calendar is
 * still a calendar, and a record with no date is self-evidently not on it.
 *
 * ## Kanban, where the rest of WE says Boards
 *
 * A **board** is the record: a `CollectionBlock` holding columns, which is what `createBoard` makes
 * and `arrangedBoard` arranges. **Kanban** is the arrangement — cards in columns standing for
 * states. `KIND.board` already says so, calling it "a kanban board holding columns": kanban is the
 * adjective, board is the noun, and they are not two words for one thing.
 *
 * So the code goes on saying board everywhere, and this strip says Kanban — because it is the one
 * surface in WE where the two arrangements are *adjacent tabs*. Miro, Trello and Jira all call their
 * canvas or their columns a board, so "Canvas | Board" asks a reader to tell apart two things the
 * word covers equally well. `BoardsView` keeps its name: it lists board records, has a picker, and
 * has no canvas beside it. See `docs/architecture/boards.md`.
 */
const ROUTE = { canvas: 'canvas', kanban: 'kanban', calendar: 'calendar' } as const;

const NAV = [
  { segment: ROUTE.canvas, icon: 'graph', label: 'Canvas' },
  // `kanban`, not `check-square`: the icon named a content type while the page's own placeholder
  // already used this one, so the strip and the page it led to disagreed about what was there.
  { segment: ROUTE.kanban, icon: 'kanban', label: 'Kanban' },
  { segment: ROUTE.calendar, icon: 'calendar', label: 'Calendar' },
];

/**
 * Where a switcher button goes: this space's page for that segment, carrying the call on screen.
 *
 * The call has to come along. The panels stand on every route now, and they are about `CALL` — so a
 * link that dropped the parameter would show the transcript of the *live* call while the canvas two
 * clicks away showed the one you chose, and switching pages would look like it changed the subject.
 *
 * `?? ''` rather than a ternary: an absent parameter interpolates as the word `undefined`, and an
 * empty one reads as absent everywhere it is tested — `CALL` falls through to the live call, which
 * is exactly right.
 *
 * Absolute, from `spacePath`, because it now has a query on it: a relative path with a `?` is where
 * resolution rules and remembered query strings meet, and neither of them is worth relying on.
 *
 * The key's lens rides along for the same reason the call does: it is in the address, and a page
 * switch that spelt its query without it would silently put the colours back to the default.
 */
const navPath = {
  $: `\`\${spaceStore.spacePath}/\${nav.segment}?call=\${routeStore.params.call ?? ''}${LENS_QUERY}\``,
};

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
/**
 * What this conversation is called, and who was in it.
 *
 * ## Its own pill, beside the switcher rather than inside it
 *
 * The obvious home is the bar the route buttons live in, and it is the wrong one: that pill is
 * content-sized and centred, so a title in it moves Canvas, Kanban and Calendar sideways every time
 * somebody renames a call or opens one with a longer name. Nav you cannot build muscle memory for
 * is worse than nav you have to look at. Two pills of the same family, each sized by its own
 * contents, and neither disturbs the other.
 *
 * Left rather than centred, for the same reason: this one grows with its title, and a centred box
 * that grows moves at both ends.
 *
 * ## Who counts as a participant
 *
 * `participants` on the call record — everyone who was *in* the call, whether or not they ever
 * said anything. The transcribe module writes it for any agent present once the record exists, and
 * its own note argues why: a transcript showing somebody was there and silent is worth more than
 * one that quietly looks complete. Not live presence, which is empty for every call being read
 * back, and not the set of people who spoke, which would drop exactly the attendee a reader is
 * most likely to have forgotten.
 *
 * Read straight off the record as a list of DIDs — the relation is untyped, so it comes back
 * unhydrated, which is the shape `peopleRow` takes.
 */
const callPill: SchemaNode = {
  type: '$if',
  props: {
    // Nothing to name when no call is on screen, and the query below would have no id to ask about.
    condition: CALL,
    then: {
      type: 'Row',
      props: {
        gap: '200',
        ay: 'center',
        /*
          Yields to the button beside it rather than pushing it off the edge.

          The pill has a title of unknown length and the button does not, so when the region runs out
          of room the honest thing to give up is a few characters of a name that is already truncated
          at 360px. `minWidth: '0'` is the half that is easy to forget: without it a flex item is
          never asked to be narrower than its content, so the truncation never happens.
        */
        minWidth: '0',
        p: '200',
        /*
          The extra inset is on the trailing edge now, not the leading one.

          It was `pl`, from when a title led the pill and a heading wants room from the edge it
          starts at. A button leads now, and a ghost control carries its own padding — so the inset
          was added to padding that was already there and pushed the glyph away from the corner it
          reads from. The roster that ends the pill has no such padding of its own, which is where
          the room was wanted.
        */
        pr: '400',
        // The theme's control shape, for the switcher's reason — see there.
        r: 'control',
        bg: 'surface-raised',
        border: '1px solid border',
        shadow: 'lg',
        // A title can be any length; the pill is chrome and must not span the window.
        maxWidth: '360px',
      },
      /*
        `when`, because an unresolved operand is *pruned* rather than sent — and pruning widens. A
        `where` that lost its id would ask for every CollectionBlock in the space and hand back the
        first one, which is a different call's name shown with confidence.
      */
      $queries: {
        callRecord: {
          entity: 'CollectionBlock',
          where: { id: CALL },
          limit: 1,
          when: CALL,
        },
      },
      $localState: {
        editOpen: { type: 'boolean', initial: false },
        titleDraft: { type: 'string', initial: '' },
        descriptionDraft: { type: 'string', initial: '' },
      },
      children: [
        /*
          The way back into the call, before its name.

          It was the transcript panel's, and being there was a category error that read as an
          asymmetry: two panels sit side by side about this call and only one offered the way into
          it. Picking a call back up is about the *call*, so it belongs against the call's name — and
          here it survives both panels being closed, which the panel copy could not.

          At the start rather than at the end because it is the one thing on this pill that is an
          offer. The pencil and the roster describe the meeting; this changes what you are doing, and
          a control the eye reaches first is the one to lead with.

          A part rather than a button written out here: the gate, the wording and the refusal while
          another call runs are the call module's to own, and every other interface that draws a call
          name gets them with one line. It renders nothing where the call module is off.
        */
        { type: '$part', props: { id: 'call.continueCallButton' } },
        {
          type: 'we-text',
          // The name of the thing every other surface is about, so it reads as a heading rather
          // than as a caption on the chrome around it.
          props: { variant: 'subheading', tag: 'h5', truncate: true, minWidth: '0' },
          children: [{ $: "first(local.callRecord).title ? first(local.callRecord).title : 'Call'" }],
        },
        {
          type: 'we-tooltip',
          props: { content: 'Name this conversation' },
          children: [
            {
              type: 'we-button',
              props: {
                label: 'Name this conversation',
                variant: 'ghost',
                square: true,
                color: 'text-faint',
                /*
                  Seeded on the press, not at mount: the drafts have to hold what the record says
                  *now*, and a local declared with an `initial` reads it once — before the query has
                  answered, on the first frame. The Cards view's own edit button does the same.
                */
                onClick: [
                  { $setLocal: 'titleDraft', value: { $: 'first(local.callRecord).title' } },
                  { $setLocal: 'descriptionDraft', value: { $: 'first(local.callRecord).description' } },
                  { $setLocal: 'editOpen', value: true },
                ],
              },
              /*
                No explicit size, which is the usual rule: a sized primitive sets its nested icon,
                and a control at the default height gives it 24px.

                It was pinned at 18px on the reasoning that a full-size glyph is heavy beside a
                heading it belongs to. Tested against the real pill that is simply wrong — at 18px it
                reads as an afterthought in a 40px box, and the box is the thing the eye aims at. The
                box stays 40px either way: shrinking the button would take the pill down with it, and
                the band reserved above is measured from a control at that height.
              */
              children: [{ type: 'we-icon', props: { name: 'pencil-simple' } }],
            },
          ],
        },
        /*
          No rule between the name and the faces.

          It separated two things that were never going to be confused for each other — a heading and
          a row of avatars — and in a box this small a vertical rule is a third kind of mark competing
          with the gap that was already doing the job. The pill reads as one object again without it.
        */
        // No `noun`: the pill is chrome and a count beside three faces is a word doing no work. The
        // roster is on hover, which is where a name belongs when the faces are this small.
        peopleRow({ items: { $: 'first(local.callRecord).participants' }, dids: true, max: 4, size: 'sm' }),
        formModal({
          open: { $: 'local.editOpen' },
          close: { $setLocal: 'editOpen', value: false },
          title: 'Name this conversation',
          size: 'sm',
          children: [
            field({ name: 'titleDraft', label: 'Title', placeholder: 'What was this call about?' }),
            field({
              name: 'descriptionDraft',
              label: 'Description',
              control: 'textarea',
              placeholder: 'Anything worth remembering about it',
            }),
          ],
          /*
            Changed, not filled in: the fields arrive holding the record, so a form nobody has
            touched is already full and a guard testing non-emptiness would fire on every close.
          */
          discardWhen: {
            $: 'local.titleDraft != first(local.callRecord).title || local.descriptionDraft != first(local.callRecord).description',
          },
          submit: {
            $action: 'record.update',
            args: [
              'CollectionBlock',
              CALL,
              { title: { $: 'local.titleDraft' }, description: { $: 'local.descriptionDraft' } },
            ],
          },
        }),
      ],
    },
  },
};

const switcher: SchemaNode = {
  type: 'Row',
  props: {
    position: 'fixed',
    top: '300',
    left: '50%',
    styles: { transform: 'translateX(calc(-50% + var(--we-chrome-center-x, 0px)))' },
    zIndex: 'sticky',
    gap: '100',
    p: '200',
    /*
      The theme's control shape, not a hardcoded pill.

      `r: 'control'` resolves to `var(--we-theme-control-radius, var(--we-radius-400))` — the same
      expression the call bar spells out, and its note is where the argument lives: a pinned `pill`
      left three of the theme's four shape presets working and the fourth indistinguishable from
      Pill, because a bar that is always round cannot follow a theme set to Sharp. Matching the
      *controls* rather than deriving a concentric figure is the rule that survives all four, since
      the padding it would be derived from is not a theme variable and the radius is.

      Unchanged that resolves to 8px, which is a slight round rather than a capsule.
    */
    r: 'control',
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
            // `md`, the default control height: these are the template's primary navigation and
            // were reading as a row of small ornaments over a full-bleed canvas.
            r: 'control',
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
 * happened" readout rather than a record — the canvas and the calendar are where they are kept.
 */
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
/** A call is running somewhere in this space, whether or not this agent is in it. */
const A_CALL_IS_RUNNING = 'modules.call.active || count(modules.call.liveCalls)';

/**
 * Start a call, join the one running here, or go back to your own.
 *
 * Takes its size because it is placed at two scales. `md` on a page with no call to be about —
 * under the sentence each of the three routes shows there, which is the template's main way in and
 * wants the default control height. `sm` in the calls panel header, where `panelShell` reserves the
 * height of a small control and a default one would make that header taller than every other
 * panel's.
 *
 * It used to sit in the corner beside the pill as well. That placement showed on the same condition
 * the page gates do and did the same thing, so it was the same door drawn twice — see `callChrome`.
 */
const startCallButton = (size: 'sm' | 'md'): SchemaNode => ({
  type: '$if',
  props: {
    condition: { $: 'modules.call.canCall' },
    then: {
      type: 'we-button',
      props: {
        size,
        gap: '200',
        /*
          Room above it, in the placement that sits under a sentence.

          `md` is always that one — the gate on each of the three routes — where the placeholder's
          own `gap` alone reads as too tight: an icon, a line of prose and a button spaced identically
          make three items in a list rather than a statement and the thing to do about it. `sm` is the
          calls panel header, where a top margin would push the control out of a band whose height
          `panelShell` has already reserved.
        */
        ...(size === 'md' ? { mt: '400' } : {}),
        // Its words are fixed, so it is the wrong half of the pair to shorten — see `callPill`.
        flexShrink: '0',
        variant: { $: "modules.call.active ? 'secondary' : 'primary'" },
        /*
          `goToCall` only where there is a call to go to.

          It was the whole of this button, and `goToCall` has a branch that continues the call *in
          the address* when nothing is running — which is exactly right for the module rail, where it
          is how you pick up the meeting you are reading, and exactly wrong here. With a call
          selected in the list below, pressing "New call" reopened the selected one.

          The two other branches are still wanted, which is why this is a narrowing rather than a
          swap to `startCall`. Somebody already in a call gets taken back to it; somebody who is not,
          in a space where a call is running, joins that one rather than opening a second beside it.
          Only the third case starts anything.

          Branched in the handler rather than in the node, so one button is rendered either way and
          the conditions read the store at the press instead of at the paint that happened to be
          current when the panel opened.
        */
        onClick: [
          {
            $if: {
              condition: { $: A_CALL_IS_RUNNING },
              then: { $action: 'modules.call.goToCall' },
              /*
                `args` explicitly, and the empty string is the point.

                A handler with no `args` does not call the method with none — it forwards the
                handler's own arguments, so a click passes the PointerEvent as the first parameter.
                `startCall` takes an optional anchor id, so it received the event and the backend
                refused the write: "invalid type: map, expected a string". `args: []` does not help
                either; an empty list reads as "no args given" and forwards the event too.

                `''` is falsy, which is how `startCall` already spells "no anchor" — a call about the
                space rather than about some node in it.
              */
              else: { $action: 'modules.call.startCall', args: [''] },
            },
          },
          openLiveCall,
        ],
      },
      children: [
        { type: 'we-icon', props: { name: 'phone-call' } },
        {
          type: 'we-text',
          /*
            Three words for three acts, because the middle one used to be missing: with a call
            running that this agent had not joined, the button said "New call" and joined it.
          */
          children: [
            {
              $: "modules.call.active ? 'Go to the call' : count(modules.call.liveCalls) ? 'Join the call' : 'New call'",
            },
          ],
        },
      ],
    },
  },
});

/**
 * Where the fixed pill bar starts, how tall it is, and where it ends — the three numbers every
 * surface that has to clear it reads.
 *
 * Both pills are pinned to `top: '300'` — which is what `CHROME_TOP` spells, in the form a `calc`
 * can read — and both come to `PILL_HEIGHT`, which is not a coincidence: each is a padded row whose
 * tallest child is one control at the default height. So one band covers both, and `CHROME_BOTTOM`
 * is the line content has to start below.
 *
 * Written once and shared because it had already drifted. `ROUTE_BAND` spelt the same clearance as
 * `pt: '900'` — 64px against a bar that ends at 68 — so the kanban and the calendar began four
 * pixels *inside* the pills, and further in under any theme that adds to control heights, since a
 * token cannot know about `--we-theme-control-height-offset` and this expression can. A number that
 * approximates an expression is a number that goes stale the next time the expression moves; see
 * `chromeReserve`, which is the one place the shell forces a number and where that has already
 * happened once.
 */
const CHROME_TOP = 'var(--we-space-300)';
const PILL_HEIGHT =
  'calc(var(--we-component-height-md) + var(--we-theme-control-height-offset, 0px) + 2 * var(--we-space-200))';
const CHROME_BOTTOM = `calc(${CHROME_TOP} + ${PILL_HEIGHT})`;

/**
 * The corner that says which call every other surface is about.
 *
 * ## What it is, now that it is one thing
 *
 * The call on screen, named — and nothing when there is not one. It held a start button beside the
 * pill as well, under an argument worth recording because it was right for as long as its premise
 * held: calls needed a permanent address, since the module rail's launcher is the least discoverable
 * control in the app and the calls panel is a section somebody can close, so a corner that was
 * sometimes empty left the whole subject with nowhere to live.
 *
 * What changed is that the *page* now offers it. Each of the three routes draws a gate when no call
 * is named, and each carries the same button — under the sentence explaining why the page is empty,
 * in the middle of the screen, which is where somebody with no call is already looking. The corner
 * button showed on exactly that condition and did exactly that thing, so it was not a second way in;
 * it was the same way in, smaller and at the edge. Three of them on one screen — corner, page, calls
 * panel — and the loudest was the one nobody's eye was on.
 *
 * So the corner narrows to the subject. When there is a call it names it; when there is not, the
 * page asks the question and the region is empty. Nothing is lost: every state that had the button
 * here has it in the middle instead, and the calls panel keeps its own for the one state neither
 * covers — wanting a fresh call while reading a finished one, where the pill holds this corner.
 *
 * ## The band keeps its height regardless
 *
 * `minHeight` stands whether or not the pill does, so the switcher pinned to the same `top` has
 * something to align against. The switcher itself does not move either way: it is centred on the
 * *content*, computed from the sidebar and dock insets, so a neighbour that changes width — or
 * disappears — is nothing to it.
 */
const callChrome: SchemaNode = {
  type: 'Row',
  props: {
    position: 'fixed',
    top: '300',
    /*
      Beside the content, not over the sidebar.

      `--we-chrome-left` is the shell's published answer for exactly this: the sidebar's width plus
      whatever any left-hand dock has taken. Chrome that worked it out from the ingredients got it
      wrong in one arrangement or another every time, which is why the shell computes it once — the
      switcher beside this reads the same number through `--we-chrome-center-x`, which is a
      subtraction over it.
    */
    left: 'calc(var(--we-chrome-left, 0px) + var(--we-space-300))',
    zIndex: 'sticky',
    gap: '200',
    ay: 'center',
    /*
      The pill's own height, held whether or not the pill is there.

      Without it the region is as tall as whatever it happens to contain, so with no call it
      collapsed to nothing while the switcher beside it sat centred in the full height — the two
      pinned to the same `top` and looking misaligned. Stated as the arithmetic the pill arrives at
      rather than as a number: a control at the default height, plus the padding above and below it,
      including whatever a theme adds to control heights. Shared with the routes that clear this bar
      — see `PILL_HEIGHT`.
    */
    minHeight: PILL_HEIGHT,
  },
  children: [callPill],
};

/** The model the selected card is of — the inspector's whole subject, named once. */
const CARD_TYPE = 'routeStore.params.cardType';

/**
 * The fields with something in them, as details — the rows the panel is mostly made of.
 *
 * `role == 'detail'` because the title and the summary are already drawn, as the heading and the
 * line under it; without the filter they appeared a second time as captioned rows, so every record
 * showed its own name twice.
 */
const SET_DETAILS = "local.display.fields.filter(f, f.role == 'detail' && f.kind != 'relation' && row[f.name])";

/** The same, as controls: everything set, title and summary included, since editing them is the point. */
const SET_FIELDS = "local.display.fields.filter(f, f.kind != 'relation' && row[f.name])";

/**
 * The fields holding nothing — what the disclosure offers.
 *
 * Images, files and JSON are excluded along with relations: `fieldEditor` draws no control for any
 * of them (a picture is uploaded, not typed), so counting them would promise rows that expanding
 * does not produce.
 */
const EMPTY_FIELDS =
  "local.display.fields.filter(f, !(f.kind in ['relation', 'image', 'file', 'json']) && !row[f.name])";

const EMPTY_COUNT = `count(${EMPTY_FIELDS})`;

/**
 * Whether this MODEL has any field the panel could edit — asked of the declaration rather than of
 * the record, because the header is outside the `$each` and has no row in scope.
 *
 * What the pencil is gated on. A composed document declares no fields at all (see
 * `CollectionBlock`'s manifest entry), so unlocking editing on a note produced a mode with nothing
 * in it: the same empty panel this whole piece of work started from, one press further in.
 */
const HAS_EDITABLE_FIELDS = `count(recordStore.displays[${CARD_TYPE}].fields.filter(f, !(f.kind in ['relation', 'image', 'file', 'json'])))`;

/** Whether the selected thing is a drawn connection rather than a card. */
const IS_RELATIONSHIP = `${CARD_TYPE} == 'Relationship'`;

/** The kind record this connection names, or undefined — a dotted read off it is undefined too. */
const KIND_OF_LINK = 'find(local.relationshipKinds, { id: row.relationshipTypeId })';

/**
 * Which kind of connection a line is — the one field the generated panel cannot draw.
 *
 * `Relationship.relationshipTypeId` holds the **id of a record** and is declared as an ordinary
 * string, so the two halves of this panel both get it wrong on their own. `displays` derives its
 * field list from `display.fields ?? authoring.fields`, and `Relationship.authoring.fields` is
 * `['label', 'description']` — deliberately, since the kinds are a list to pick from rather than
 * something to type — so the field is simply absent from the read rows and from `fieldEditor`. Put
 * *in* that list it would be worse than absent: a text box showing a raw `we://…` id, and a caption
 * reading "Relationship Type Id".
 *
 * So it is drawn here by hand, which is the same answer `recordForm` reaches for the create modal
 * and `EdgeDetail` for the knowledge map — three surfaces, one shape, and the generic path unable to
 * serve any of them. What would retire all three is `recordDisplay` learning a kind for "a string
 * that references a record of a named model"; `Signal.signalTypeId` is the second instance of it, so
 * the case is close to made. It is not made *here*: a new `DisplayKind` is a change to every surface
 * that switches on one, and this branch has enough in it.
 *
 * Reading and editing, in one node, because both are one row in the same column and splitting them
 * would put the kind in two places that have to agree about where it sits.
 */
const relationshipKind: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: IS_RELATIONSHIP },
    then: {
      type: '$if',
      props: {
        condition: { $: 'local.editing' },
        /*
          Editing: the community's kinds, and a way back out of having picked one.

          Offered only where the community has named a kind. A space that has named none still
          connects things — the label carries the meaning until a vocabulary exists, which is how one
          gets discovered — and a picker with nothing in it would ask a question with no answers.

          No "unnamed" entry among the options, and this is the trap worth naming: a schema cannot
          prepend to a list, and the interpolation that looks like it can — `` `${[…]}${list.map(…)}` ``
          — evaluates to a *string*, so `options` receives "[object Object]" and the select renders
          empty. That spelling was live in `recordForm` and is gone. The unset state is the
          placeholder; getting back to it is the button.
        */
        then: {
          type: '$if',
          props: {
            condition: { $: 'count(local.relationshipKinds)' },
            then: {
              type: 'we-form-field',
              props: { label: 'Kind', size: 'sm', width: '100%' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '200', ay: 'center', width: '100%' },
                  children: [
                    {
                      type: 'we-select',
                      props: {
                        size: 'sm',
                        flex: '1',
                        minWidth: '0',
                        placeholder: 'Unnamed kind',
                        options: {
                          $: 'local.relationshipKinds.map(item, { label: item.name, value: item.id, icon: item.icon })',
                        },
                        value: { $: 'row.relationshipTypeId' },
                        // The same writer every other control in edit mode uses — one action, named
                        // field, value coerced by the field's declared kind. `relationshipTypeId` is
                        // a plain string property, so nothing special happens to it on the way.
                        onChange: {
                          $action: 'recordStore.updateRecordField',
                          args: [
                            'Relationship',
                            { $: 'routeStore.params.card' },
                            'relationshipTypeId',
                            {
                              $: 'event.detail',
                            },
                          ],
                        },
                      },
                    },
                    {
                      type: '$if',
                      props: {
                        condition: { $: 'row.relationshipTypeId' },
                        then: {
                          type: 'we-tooltip',
                          props: { content: 'Leave the kind unnamed' },
                          children: [
                            {
                              type: 'we-button',
                              props: {
                                size: 'sm',
                                variant: 'ghost',
                                square: true,
                                label: 'Leave the kind unnamed',
                                flexShrink: '0',
                                // An empty string, which the AD4M adapter reads as "clear this
                                // property" — see `clearOnEmpty`. Not null or undefined: those still
                                // skip, so that an ordinary partial save is not data loss.
                                onClick: {
                                  $action: 'recordStore.updateRecordField',
                                  args: ['Relationship', { $: 'routeStore.params.card' }, 'relationshipTypeId', ''],
                                },
                              },
                              children: [{ type: 'we-icon', props: { name: 'x' } }],
                            },
                          ],
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
        /*
          Reading: the kind's own name and glyph, drawn as one more detail row.

          Only when one is set and still resolves. A kind the community has since deleted reads as
          nothing rather than as its bare id — the same choice the detail rows make for an empty
          field, and for the same reason: a row showing a `we://` string is a row that looks like
          something failing to load.
        */
        else: {
          type: '$if',
          props: {
            condition: { $: KIND_OF_LINK },
            then: {
              type: 'Column',
              props: { gap: '050', py: '100', borderTop: '1px solid border' },
              children: [
                { type: 'we-text', props: { variant: 'footnote', color: 'text-faint' }, children: ['Kind'] },
                {
                  type: 'Row',
                  props: { gap: '200', ay: 'center' },
                  children: [
                    {
                      type: '$if',
                      props: {
                        condition: { $: `${KIND_OF_LINK}.icon` },
                        then: {
                          type: 'we-icon',
                          props: { name: { $: `${KIND_OF_LINK}.icon` }, size: 'xs', color: 'text-muted' },
                        },
                      },
                    },
                    { type: 'we-text', props: { variant: 'footnote' }, children: [{ $: `${KIND_OF_LINK}.name` }] },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  },
};

/**
 * Whether this record is a composed document rather than a filled-in form.
 *
 * The value, not the model's name: a `CollectionBlock` is both things depending on what made it.
 * A note has an `editorState` and its substance is in there; a call record, or a board column, is
 * the same class with none, and reads as its fields exactly as a task does.
 */
const COMPOSED = 'row.editorState';

/**
 * A note's actual content, drawn the way the cards route draws a post.
 *
 * The panel is derived from `recordStore.displays`, which is a list of *properties* — and a
 * composed document has none worth reading: its title is usually empty and its text lives in
 * `editorState`, a blob no field row can render. So the panel that had just learned to say
 * "Note" went on to say "Untitled" over nothing at all, about a sticky note with three paragraphs
 * visible on the canvas behind it.
 *
 * `BlockRenderer` is the same component the post card mounts, so a note reads here as it does
 * everywhere else. On a `surface` with a border, for the same reason the card route puts one there
 * and not a sunken well: the panel's frame paints the page, and a well belongs *in* a surface rather
 * than on the ground — what is wanted here is a card, since the strip above is a description of the
 * record and this is the record itself.
 *
 * The composer beside it is the other half: with the content on screen, the pencil in the header —
 * which edits declared fields, and for a note means its title and description — is the wrong tool
 * for the thing somebody is now looking at. Its own button, attached to the content, opening the
 * same composer the canvas's double-click does and saving through the same reconcile.
 */
const composedContent: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: COMPOSED },
    then: {
      type: 'Column',
      props: { gap: '200', width: '100%' },
      children: [
        {
          type: 'Column',
          props: {
            width: '100%',
            bg: 'surface',
            border: '1px solid border',
            r: 'surface',
            p: '300',
            overflow: 'hidden',
          },
          children: [{ type: 'BlockRenderer', props: { editorState: { $: COMPOSED } } }],
        },
        {
          type: 'Row',
          props: { ax: 'start' },
          children: [
            {
              type: 'we-button',
              props: { size: 'sm', variant: 'ghost', gap: '200', onClick: { $setLocal: 'noteOpen', value: true } },
              children: [
                { type: 'we-icon', props: { name: 'pencil-simple' } },
                { type: 'we-text', props: { variant: 'footnote' }, children: ['Edit note'] },
              ],
            },
          ],
        },
        // No `$if` of its own: the fragment mounts only while `noteOpen` is set, which is what
        // resets the editor between one note and the next.
        composerModal({
          openLocal: 'noteOpen',
          title: 'Note',
          saveLabel: 'Save',
          editorState: { $: COMPOSED },
          // `arg` second: `updatePost(postId, json)`.
          saveAction: { $action: 'spaceStore.updatePost', args: [{ $: 'row.id' }, { $: 'arg' }] },
        }),
      ],
    },
  },
};

/**
 * The fields this record has nothing in, behind one collapsed row.
 *
 * Controls rather than captions, in both modes: the question somebody has when they open this is
 * "can I put something here", and a read-only list of blanks answers it with no. It is also why the
 * row is at the foot of the panel and shut by default — a model with twelve properties and three
 * filled in should read as three facts, not as nine gaps.
 *
 * `$animate` rather than `$if`, so closing it does not unmount a control somebody is halfway through
 * typing into — `fieldEditor` writes on change, so an unmount mid-edit would drop what was typed.
 */
const emptyFields: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: EMPTY_COUNT },
    then: {
      type: 'Column',
      props: { gap: '200', pt: '200', borderTop: '1px solid border' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'bare',
            width: '100%',
            ax: 'start',
            gap: '200',
            onClick: { $toggleLocal: 'showEmpty' },
          },
          children: [
            {
              type: 'we-icon',
              props: {
                size: 'xs',
                color: 'text-faint',
                name: { $: "local.showEmpty ? 'caret-down' : 'caret-right'" },
              },
            },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-faint' },
              children: [{ $: `${EMPTY_COUNT} + ' empty ' + plural(${EMPTY_COUNT}, 'field', 'fields')` }],
            },
          ],
        },
        {
          type: '$animate',
          props: {
            condition: { $: 'local.showEmpty' },
            enterTransition: [
              { type: 'reveal', duration: 200 },
              { type: 'fade', duration: 150 },
            ],
          },
          children: [
            {
              type: 'Column',
              props: { gap: '300', pb: '100' },
              children: [fieldEditor({ $: CARD_TYPE }, { $: 'routeStore.params.card' }, EMPTY_FIELDS)],
            },
          ],
        },
      ],
    },
  },
};

/**
 * One card, opened out — its type and its properties, beside the arrangement it is part of.
 *
 * ## Why a panel and not the record page
 *
 * There is a record page already, at `/record/:entity?id=`: the host appends it to every template's
 * route table, self-routing ones included, and it is the better surface for reading one thing
 * properly. A button here used to link to it and does not currently — see the note where it was.
 *
 * It is the wrong surface for the question a canvas asks. Navigating away to read a card loses the
 * arrangement the card is *in* — which is the whole reason the thing is on a canvas rather than in a
 * list — so the two are different acts, and this template is the one that argues for the panel:
 * every other surface here is already beside the content rather than instead of it.
 *
 * ## Nothing here names a property of anything
 *
 * Which is the point, and the case that prompted it: a community defines a model, extraction writes
 * one, and it appears on the canvas as a card nobody can look inside. `recordStore.displays` is
 * derived from the model's own declaration, so the fields, their labels and their kinds all arrive
 * from the same place the create form gets them. A model adopted this morning renders here with
 * nothing written for it.
 *
 * ## What is set, and what is not
 *
 * Two lists out of one declaration. A field holding something is a row; a field holding nothing is
 * behind a disclosure at the foot of the panel, as a *control*, so opening it is how something gets
 * added rather than a longer list of blanks to read past. That split is why the panel does not grow
 * a row per property the moment a model declares one, and why "add a due date" is reachable without
 * first deciding to edit.
 *
 * A model that declares no fields has neither list, and that is the ordinary case rather than a
 * degenerate one: a note is composed, so its content is a document and not a set of properties —
 * see `composedContent`, and `CollectionBlock`'s own manifest entry for why it declares roles and
 * no field list. Nothing here offers to name a sticky note.
 *
 * Relations — `comments`, `signals`, `mentions`, a collection's `children` — are in neither, and
 * that is deliberate rather than an omission. `displayFor` lists them now, and they arrived here as
 * captioned blank space: the panel's query hydrates no relation (an `include` names its relations
 * literally, and this query's entity is an expression), so a relation reads as an empty list
 * whatever it holds, and there is no picker to write one with either. A row that can neither show a
 * value nor take one is a label with nothing behind it. Answering "what is this connected to"
 * properly means hydrating the declared half and reading `Relationship` records for the
 * community-named half, which is its own piece of work.
 */
const inspectorPanel: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%', p: '300', gap: '300', overflow: 'hidden' },
  /*
    Whether the fields are controls or values — the pencil in the header. Ephemeral and per panel:
    it is a mode of looking, not a fact about the record, and it drops when the panel is rebuilt.
  */
  $localState: { editing: { type: 'boolean', initial: false } },
  $queries: {
    /*
      The record itself, by id. `limit: 1` because an id names one thing — the list is the shape a
      query answers in, not a set worth iterating.

      `entity` as an expression is what makes this work for a model this template was not written
      for; the cost is that the validator cannot check the name, and a name that has not arrived yet
      reads as "not ready" rather than as an error, which is the right way round while a route is
      settling.
    */
    card: {
      entity: { $: 'routeStore.params.cardType' },
      where: { id: { $: 'routeStore.params.card' } },
      limit: 1,
      /*
        Not until there is an id to ask about — which is what kept the panel showing a record
        nobody had selected.

        An unresolved operand in `where` is *pruned*, and pruning means "do not narrow". For an
        optional filter that is the right reading; for the id that says which record this is, it is
        the worst one available: with `?cardType=TaskBlock` in the address and no `card` — a shared
        link, or a selection cleared while the type lingered — the clause was dropped, `limit: 1`
        answered with whichever task the backend returned first, and the inspector opened out a
        card the canvas was not showing as selected. An untitled one read as "Untitled" in
        heading type, which is what made it look like a panel failing rather than a panel
        answering the wrong question.

        `when` is the distinction the pruner cannot draw: the id is not an optional narrowing, it
        is the whole query. Until it arrives there is nothing to ask, so nothing is asked and the
        panel says what it says when nothing is selected.
      */
      when: { $: 'routeStore.params.card' },
    },
    /*
      The kinds of connection this community has named — see `relationshipKind`.

      Unconditional rather than gated on the selection being a line. It is one subscription over a
      list a space has a handful of, and `when`-ing it on the card's type would tear the
      subscription down and set it up again on every click between a card and a line, to save
      nothing. Hoisted here so the row below reads one answer rather than one per render.
    */
    relationshipKinds: { entity: 'RelationshipType', order: { name: 'asc' } },
  },
  children: [
    panelHeader({
      title: 'Inspector',
      /*
        Unlock editing, in the header where a mode belongs. The inspector already shows every value
        a record has, so it is the surface that edits them; a separate form would show the same
        fields a second time. Offered only while a record is loaded and its model has a field worth
        editing — a note's content is not one, and is edited where it is shown. Lit while it is on.
      */
      aside: {
        type: 'Row',
        props: { gap: '100', ay: 'center' },
        children: [
          {
            type: '$if',
            props: {
              condition: { $: `count(local.card) && ${HAS_EDITABLE_FIELDS}` },
              then: {
                type: 'we-tooltip',
                props: { content: { $: "local.editing ? 'Done editing' : 'Edit this record'" } },
                children: [
                  {
                    type: 'we-button',
                    props: {
                      size: 'sm',
                      square: true,
                      variant: { $: "local.editing ? 'secondary' : 'ghost'" },
                      onClick: { $toggleLocal: 'editing' },
                    },
                    children: [
                      { type: 'we-icon', props: { name: { $: "local.editing ? 'check' : 'pencil-simple'" } } },
                    ],
                  },
                ],
              },
            },
          },
          /*
            Delete, beside the pencil — and the one control here that works for a *line*.

            This panel is the only surface the canvas has that opens a card and a connection with the
            same two locals, which is what makes it the right home for a delete that has to cover
            both: a card already has a bin on its own bar, and a line had nowhere at all. Without one,
            immediate connection (see `onEdgeCreate`) would make every mis-drop permanent — the
            modal's Cancel was the only way out of a line drawn by accident, and it is gone.

            No `edgeActions` to mirror the card's bar. A card is a box with a free top edge; a
            selected line's whole length is already committed to the handles that bend it, and for a
            straight two-point route the midpoint — where a bar would go — is exactly where the
            "drag to bend the line here" grip sits. The symmetry is only ever an appearance.

            Gated on the record being loaded rather than on it being editable: a `CollectionBlock` has
            no field the generated editor will touch, so the pencil is hidden for a note, and a note
            is certainly deletable.

            `record.delete` rather than a store action, for `nodeActions`' reason — the host's own
            confirmation stands in front of it, so a template arriving from a stranger does not get
            to decide whether deleting asks first.
          */
          {
            type: '$if',
            props: {
              condition: { $: 'count(local.card)' },
              then: {
                type: 'we-tooltip',
                props: { content: 'Delete this record' },
                children: [
                  {
                    type: 'we-button',
                    props: {
                      size: 'sm',
                      square: true,
                      variant: 'ghost',
                      color: 'danger-text',
                      label: 'Delete this record',
                      /*
                        No `onSuccess` clearing the address, and the reason is worth writing down.

                        The obvious version clears `card`/`cardType` once the delete lands, so the
                        panel is not left pointing at a record that is gone. It cannot: the host's
                        guard wraps a destructive action as
                        `(await guard(…)) ? bound(…) : undefined` — so **refusing the confirmation
                        resolves**, exactly as accepting it does, and an `onSuccess` would fire on
                        Cancel and empty the panel over a record nobody deleted.

                        Nothing is needed anyway. The panel's `card` query is subscribed, so the
                        delete empties it and the empty state takes over on its own; a cancel leaves
                        everything where it was. The cost is a stale parameter in the URL, which the
                        query's own `when` and `limit: 1` already answer honestly. `nodeActions`'
                        delete makes the same non-choice, one surface along.
                      */
                      onClick: {
                        $action: 'record.delete',
                        args: [{ $: CARD_TYPE }, { $: 'routeStore.params.card' }],
                      },
                    },
                    children: [{ type: 'we-icon', props: { name: 'trash' } }],
                  },
                ],
              },
            },
          },
        ],
      },
    }),
    {
      type: '$if',
      props: {
        condition: { $: 'count(local.card)' },
        then: panelScroll({
          children: [
            {
              type: '$each',
              props: { items: { $: 'local.card' }, as: 'row' },
              children: [
                {
                  type: 'Column',
                  props: { gap: '300' },
                  /*
                    The model's own declaration, held for the subtree rather than read at each use.

                    An object local rather than five reads of `recordStore.displays[…]`: the fields
                    below index into it repeatedly, and one name is easier to follow than the same
                    expression written out six times.
                  */
                  $localState: {
                    display: { type: 'object', initial: { $: `recordStore.displays[${CARD_TYPE}]` } },
                    /*
                      Whether the empty fields are showing. Per record, because it is declared inside
                      the `$each` — selecting another card closes it again, which is right: it was
                      opened to add something to *this* one.
                    */
                    showEmpty: { type: 'boolean', initial: false },
                    /** The composer, open on this note's own document — see `composedContent`. */
                    noteOpen: { type: 'boolean', initial: false },
                  },
                  children: [
                    /*
                      What kind of thing this is — the same words and glyph the key uses.

                      Through `kindLabel`/`kindIcon` rather than `local.display` directly, so the two
                      panels sitting on the same edge cannot call one card two different things: a
                      note is a "Note" in both. They also fall back to the model's own name where
                      nothing has a display for it, which is what the panel showed instead of a blank
                      strip for a `CollectionBlock` before one existed.
                    */
                    {
                      type: 'Row',
                      props: { gap: '200', ay: 'center' },
                      children: [
                        {
                          type: '$if',
                          props: {
                            condition: { $: kindIcon(CARD_TYPE) },
                            then: {
                              type: 'we-icon',
                              props: { name: { $: kindIcon(CARD_TYPE) }, color: 'accent-text' },
                            },
                          },
                        },
                        {
                          // `fontSize` rather than the `footnote` variant: this names what is
                          // selected, and at 100 it read as a caption on the thing above it.
                          type: 'we-text',
                          props: { fontSize: '400', color: 'text-muted' },
                          children: [{ $: kindLabel(CARD_TYPE) }],
                        },
                      ],
                    },
                    /*
                      Reading, or editing — the same fields, as values or as controls.

                      Editing draws the fields that hold something as controls by their kind and
                      writes each change as it is committed; see `fieldEditor`. Reading is what was
                      always here. A `$if` rather than a per-field toggle, so the two modes cannot
                      be half on. Either way the *empty* fields are one disclosure below, shared by
                      both — see `emptyFields`.
                    */
                    {
                      type: '$if',
                      props: {
                        condition: { $: 'local.editing' },
                        then: fieldEditor({ $: CARD_TYPE }, { $: 'routeStore.params.card' }, SET_FIELDS),
                        else: {
                          type: 'Column',
                          props: { gap: '300' },
                          children: [
                            {
                              type: '$if',
                              props: {
                                condition: { $: 'row[local.display.title]' },
                                then: {
                                  type: 'we-text',
                                  props: { variant: 'heading-sm' },
                                  children: [{ $: 'row[local.display.title]' }],
                                },
                              },
                            },
                            /*
                              No "Untitled". There was one here, in heading type, for a record with
                              neither a name nor a document — on the argument that a record with no
                              name otherwise reads as one still loading.

                              That argument was answered before it was made: the kind strip above is
                              unconditional, so a nameless card is already headed "Task" or "Note"
                              and nothing about the panel looks unfinished. What the word added was
                              a heading asserting the record is *called* something it is not, and
                              naming it is one of the fields the disclosure below offers — so the
                              panel was arguing with its own control.
                            */
                            composedContent,
                            {
                              type: '$if',
                              props: {
                                condition: { $: 'row[local.display.summary]' },
                                then: {
                                  type: 'we-text',
                                  props: { color: 'text-muted' },
                                  children: [{ $: 'row[local.display.summary]' }],
                                },
                              },
                            },
                            /*
                              What this record actually says, each drawn by its kind.

                              The same switch the record page makes, and the same reason: `kind` is
                              resolved once in the store so a template branches on one word rather
                              than knowing what a property is. A date wants a timestamp, a boolean a
                              badge, and everything else reads as text.

                              The list is filtered rather than every field guarded row by row — see
                              `SET_DETAILS`. A field with nothing in it is not a row here at all: an
                              empty label over blank space reads as something failing to load, and
                              the ones with nothing in them are offered as controls below.
                            */
                            {
                              type: '$each',
                              props: { items: { $: SET_DETAILS }, as: 'field' },
                              children: [
                                {
                                  type: 'Column',
                                  props: { gap: '050', py: '100', borderTop: '1px solid border' },
                                  children: [
                                    {
                                      type: 'we-text',
                                      props: { variant: 'footnote', color: 'text-faint' },
                                      children: [{ $: 'field.label' }],
                                    },
                                    {
                                      type: '$if',
                                      props: {
                                        condition: { $: "field.kind == 'datetime' || field.kind == 'date'" },
                                        then: {
                                          type: 'we-timestamp',
                                          props: { value: { $: 'row[field.name]' }, relative: true },
                                        },
                                        else: {
                                          type: '$if',
                                          props: {
                                            condition: { $: "field.kind == 'boolean'" },
                                            then: {
                                              type: 'we-badge',
                                              props: { size: 'xs' },
                                              children: [{ $: "row[field.name] ? 'Yes' : 'No'" }],
                                            },
                                            else: {
                                              type: 'we-text',
                                              props: { variant: 'footnote' },
                                              children: [{ $: 'row[field.name]' }],
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
                      },
                    },
                    /*
                      After the fields and before the disclosure, in both modes — which is where it
                      belongs in each. Reading, it is one more detail row under the label and the
                      description; editing, it is one more control under theirs. Above the
                      disclosure because the disclosure is for what is *not* set, and this is.
                    */
                    relationshipKind,
                    emptyFields,
                    /*
                      No "Open full record". There was a ghost button here that navigated to
                      `<space>/record/<type>?id=<id>` — the record page the host appends to every
                      template's route table — and it did not arrive anywhere usable.

                      Out until it does. A control that looks like every other control in the panel
                      and does not work costs more than the reading it was offering: this panel's
                      case for existing is that it opens a card *without* leaving the arrangement
                      the card is in, so the link out was the convenience, not the feature. The
                      panel docblock above still makes the argument, and the button comes back when
                      the page it points at holds up.
                    */
                  ],
                },
              ],
            },
          ],
        }),
        /*
          A sentence, because `label` alone builds the wrong one.

          `emptyState` composes its default from the label — "This space doesn't have any <label>."
          — which is right for a plural noun naming what a list would have held, and this is not a
          list. With `label: 'a card selected'` the panel read "This space doesn't have any a card
          selected.", in the panel this template opens by default, on the first screen anybody sees
          of it. The label stays as what a reader of the schema sees the panel is *for*; `message`
          says the true thing on screen.
        */
        else: emptyState({
          icon: 'cursor-click',
          label: 'a card selected',
          message: 'Click a card on the canvas to look inside it, or double-click the canvas to add one.',
        }),
      },
    },
  ],
};

/**
 * The calls, as a panel — how you change which call every other surface is about.
 *
 * The same list the `/calls` route draws, without the transcripts: choosing is a two-second act and
 * a panel that made you scroll past a meeting to reach the one below it would not be a switcher.
 *
 * Declared with no `route`, so it is reachable from the kanban as well. Selection is a
 * *navigation* — `./canvas/<id>` — which is what makes it survive a reload and paste into a message.
 */
const callsPanel: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%', p: '300', gap: '300', overflow: 'hidden' },
  /*
    Whether the call being deleted is the one every other surface is reading, captured on the click
    rather than asked for afterwards.

    By the time the delete resolves its row is gone from the query and the record it named no longer
    exists, so an `onSuccess` asking "was that the call on screen?" would be comparing against
    something already deleted. A row cannot hold the answer either — `$localState` names are fixed
    when the template is written and the rows come from a query — so it lives on the panel, written
    by whichever row was clicked.
  */
  $localState: {
    deletingIsCurrent: { type: 'boolean', initial: false },
  },
  $queries: {
    calls: { entity: 'CollectionBlock', where: { kind: 'call' }, order: { createdAt: 'desc' }, limit: 30 },
  },
  children: [
    panelHeader({ title: 'Calls', aside: startCallButton('sm') }),
    {
      type: '$if',
      props: {
        condition: { $: 'count(local.calls)' },
        then: panelScroll({
          children: [
            {
              // No gap: each row carries its own vertical padding now, so the rows meet flush and
              // the selected fill reads as a band in a list rather than a chip floating in one.
              type: 'Column',
              children: [
                {
                  type: '$each',
                  props: { items: { $: 'local.calls' }, as: 'call' },
                  children: [
                    {
                      // Two verbs, side by side rather than nested: looking at a call and recording
                      // into it are different weights, and a button inside a button is not a thing.
                      type: 'Row',
                      props: {
                        width: '100%',
                        ay: 'center',
                        gap: '100',
                        /*
                          The row knows whether the pointer is on it, so its trash can keep out of
                          the way until it is wanted. Held by the row rather than the button, for the
                          reason the transcript's pencil is: `hoverProps` answers for the element it
                          is on, and there is no way to say "when my parent is hovered" in props.
                        */
                        onMouseEnter: { $setLocal: 'pointerOnRow', value: true },
                        onMouseLeave: { $setLocal: 'pointerOnRow', value: false },
                      },
                      // Per row: `$localState` on a node inside `$each` is created per mount.
                      $localState: { pointerOnRow: { type: 'boolean', initial: false } },
                      children: [
                        {
                          type: 'we-button',
                          props: {
                            variant: { $: `call.id == (${CALL_EXPR}) ? 'secondary' : 'ghost'` },
                            flex: '1',
                            ax: 'start',
                            gap: '200',
                            /*
                              Two lines — the name and when — and a button's size pins its height to
                              the one-line control height, so the selected row's fill was shorter
                              than its own label and the icon sat on the edge of it. `auto` lets the
                              content set the height; the vertical padding is what the fill then
                              keeps clear above and below it. Horizontal matches it: a list row in
                              a `sm` panel, not a standalone control, and the icon is its own inset.
                            */
                            height: 'auto',
                            py: '200',
                            px: '200',
                            /*
                              The whole of choosing: the id goes in the address, and every surface
                              follows. Nothing is joined, claimed or written.

                              Clicking the row you are already on lets go of it instead — the same
                              navigation naming no call, which is what every other surface reads as
                              "the one being recorded, if any". A selected row is the only control
                              here with nothing to do on a second press, and a list you can only add
                              to is one you have to leave to undo.

                              `$if` in a handler position, which runs one side when the event fires
                              rather than choosing at render time — the one place `$if` is a token
                              rather than a node.
                            */
                            onClick: {
                              $if: {
                                condition: { $: `call.id == (${CALL_EXPR})` },
                                then: openLiveCall,
                                else: openCall('call.id'),
                              },
                            },
                          },
                          children: [
                            {
                              type: 'we-icon',
                              props: {
                                name: 'phone-call',
                                // The fill role, for the reason the record icon above uses it: a
                                // live-call marker is a signal rather than a sentence, and the
                                // derived foreground goes pale in a dark theme.
                                color: {
                                  $: "call.id == modules.call.callRecordId ? 'danger' : 'text-faint'",
                                },
                              },
                            },
                            {
                              /*
                                What it was called, and when — in that order, because a list of
                                meetings told apart only by date is a list you read by elimination.

                                The fallback is the same word the card in the Cards view falls back
                                to, and for the same reason its edit form has no `required` rule on
                                the title: clearing a name has to be allowed, and what it returns to
                                is the plain "Call" it started as.
                              */
                              type: 'Column',
                              props: { flex: '1', minWidth: '0', gap: '0', ax: 'start' },
                              children: [
                                {
                                  type: 'we-text',
                                  props: { truncate: true, width: '100%', textAlign: 'left' },
                                  children: [{ $: "call.title ? call.title : 'Call'" }],
                                },
                                {
                                  type: 'we-timestamp',
                                  // No `truncate`: a timestamp is one short token and the primitive has
                                  // no such prop. It went unnoticed because a panel's node was never
                                  // walked by the validator until sections were.
                                  props: {
                                    value: { $: 'call.createdAt' },
                                    relative: true,
                                    relativeStyle: 'narrow',
                                    fontSize: '100',
                                    color: 'text-faint',
                                  },
                                },
                              ],
                            },
                          ],
                        },
                        {
                          type: 'we-tooltip',
                          props: { content: 'Delete this call', placement: 'top' },
                          children: [
                            {
                              type: 'we-button',
                              props: {
                                variant: 'ghost',
                                size: 'sm',
                                square: true,
                                color: 'text-faint',
                                hoverProps: { color: 'danger-text' },
                                /*
                                  Out of the way until the row is pointed at, and always there on
                                  the selected row.

                                  A trash can on every row is furniture on the ordinary case, which
                                  is choosing a call — and thirty of them in a column read as a
                                  warning rather than an affordance. Faded rather than unmounted, so
                                  the row keeps its width as the pointer crosses it and the button
                                  keeps its place in the tab order.

                                  The selected row keeps its visible because hovering is not a thing
                                  on a touchscreen: choose a call, then delete it is a path that
                                  works everywhere, and one trash can beside the row that is lit
                                  reads as belonging to it rather than as repetition.

                                  `focusProps` is the half that stops this being a mouse-only
                                  affordance: it fires on `:focus-visible`, so tabbing to the button
                                  brings it back even though nothing is hovering the row.
                                */
                                opacity: { $: `local.pointerOnRow || call.id == (${CALL_EXPR}) ? 1 : 0` },
                                focusProps: { opacity: 1 },
                                transition: 'opacity 200 ease-in-out',
                                /*
                                  No `confirmModal`: the host raises its own in front of every
                                  destructive store action, and a panel is guarded like any other
                                  part of the template. Grants — and the guard with them — follow
                                  *authorship*, not render site: `TemplatePanelBody` draws this
                                  content with the space bag inside a chrome-authored frame. A
                                  dialog here would be the second question about one click.
                                  See DestructivePrompt.schema.ts.
                                */
                                onClick: [
                                  { $setLocal: 'deletingIsCurrent', value: { $: `call.id == (${CALL_EXPR})` } },
                                  {
                                    $action: 'spaceStore.deleteCollection',
                                    args: [{ $: 'call.id' }],
                                    // Only when the record just deleted is the one every other
                                    // surface is reading. Deleting some other call must not move you
                                    // off the one you are looking at.
                                    onSuccess: [
                                      { $if: { condition: { $: 'local.deletingIsCurrent' }, then: openLiveCall } },
                                    ],
                                  },
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
        }),
        else: emptyState({ icon: 'archive', label: 'recorded calls' }),
      },
    },
  ],
};

/**
 * The canvas — what the call produced, arranged.
 *
 * The `canvas` seed over the call's own collection: its contents at the positions somebody put them.
 * `contains` narrows it to what extraction makes, because the collection's children are *also* every
 * utterance, and a canvas of six hundred transcript fragments is not a canvas.
 *
 * `manual` layout parks anything without a placement in a grid, which is what makes a freshly
 * extracted record appear somewhere sensible rather than stacked at the origin. Dragging pins it and
 * `onNodeDragEnd` writes that back — without which the canvas is a layout that forgets, silently,
 * until the next reload.
 */
const canvas: SchemaNode = {
  type: 'GraphView',
  props: {
    seeds: {
      source: 'canvas',
      /*
        `pending` is what makes a suggestion look like one.

        An extraction pass can stage a *whole* record rather than writing it, and a staged record is
        in the graph: it answers the canvas's query exactly as an accepted one does, so until now a
        card nobody had agreed to was indistinguishable from a card somebody had. The proposal list
        is the only thing that knows the difference, and its `id` is the record's own — so handing
        the ids over is the whole of the connection.
      */
      options: {
        canvas: CALL,
        contains: EXTRACTED,
        connections: 'Relationship',
        // How this canvas draws those connections: which side of a card each line attaches to, and
        // any points somebody bent it through. Per canvas, like a placement — the same claim shown
        // elsewhere keeps its own shape there.
        routes: 'EdgeRoute',
        /*
          Whether anybody has agreed to a record yet — which is a fact about the record, not about
          the call being looked at.

          It read a flat list that was really the live call's, so after a restart it marked nothing
          at all and every suggestion came back looking already accepted. Keying it per call fixed
          that and introduced a smaller version of the same lie: the outgoing call's cards stay on
          the board for the moment its replacement is being queried, and against the incoming call's
          list — empty, nothing having fetched it yet — every one of them flashed as settled.

          `pendingIds` is the union, and asks the question the marker actually means. The panel's
          review list stays keyed, because "which decisions am I being asked for" *is* about a
          conversation.
        */
        pending: { $: 'modules.transcribe.pendingIds' },
      },
    },
    // Nothing opens automatically: a card's own blocks are fragments of it, not more cards.
    expansion: { defaultDepth: 0 },
    layout: { type: 'manual' },
    nodeStyle: [
      {
        /*
          Plain, and a role rather than a scale position.

          `primary-50` is a step on a ramp, and the ramp flips with the theme's polarity: the pale
          tint it names in a light theme is a near-black in a dark one, and there is no number that
          is right in both. A role is the thing a theme redefines, and the tinted panels the key
          draws with are the ones the design system already maintains for exactly this — legible in
          either polarity, with a foreground corrected against them.

          `PLAIN_FILL` is what a card is when nothing colours it — which, with both lenses off and
          no colour of its own, is the honest answer; see `WorkshopKey` for why it is a neutral step.
          The per-kind tints that used to sit here are the kind lens's defaults now, in
          `KIND_DEFAULTS`, so the key can show them beside each name.

          It is the floor rather than the last word: the first rule `lensNodeRules` contributes is
          the community's own plain colour, which is this one where nobody has chosen another.
        */
        style: {
          shape: 'card',
          width: 180,
          content: 'block',
          contentMinZoom: 0.5,
          color: PLAIN_FILL,
          // No `labelColor`: left unset, the graph inks a card black or white by the lightness of
          // its fill, which is the only answer that survives a post-it in a dark theme.
        },
      },
      /*
        The key: by kind, by state, or the card's own colour, read from the address and the space —
        see `WorkshopKey`. Rules built from data, in the place static ones would go, so the graph's
        cascade is unchanged: what is on contributes, what is off contributes nothing.
      */
      ...lensNodeRules(),
      // The card's own size, always — a box somebody dragged out is a fact about the card whatever
      // lens is on. Its colour is above, where the lenses decide whether it shows.
      {
        style: {
          width: { from: 'data.canvasWidth' },
          height: { from: 'data.canvasHeight' },
          // The card's own outline and how large its content is drawn — set from its header, kept
          // on its placement, and shown whatever lens is on: neither is a colour.
          cardShape: { from: 'data.canvasCardShape' },
          contentScale: { from: 'data.canvasContentScale' },
        },
      },
      /*
        Last, so it survives the card's own colour: a suggestion is faded whatever shade it is.

        Faded rather than hidden. The cards are worth seeing as they arrive — that is the point of a
        canvas beside a live call — and half opacity says "this is not settled yet" without asking
        anybody to go and look somewhere else first. What it is *not* is a decision: that is on the
        card, in `nodeActions` below.

        `data.pending`, with the prefix. A bare key reads a node's *own* field — `type`, `label` —
        and anything a seed put in the node's data bag is behind `data.`. Written without it this
        matched nothing at all, silently, which is the failure mode a match clause has: no card
        faded and no card offered the decision, on a canvas full of suggestions.
      */
      { when: { 'data.pending': true }, style: { opacity: 0.5 } },
    ],
    /*
      No `connect-nodes`. Connecting is a handle on the card now, not a mode.

      That behaviour claims a press *anywhere on a node*, so it has to be armed — a switch somebody
      turns on to connect and off again to move cards, which is a thing to remember and a thing to
      forget, and forgetting it either way is a gesture doing something nobody asked for. The dots
      off a selected card's edges need no arming, because the target is what makes the gesture
      unambiguous. Nothing else changes: they end in the same `edgeCreate`, so `onEdgeCreate` below
      is unchanged.
    */
    behaviours: [
      // The two halves of a double-click: on a note it opens, on empty canvas it asks what to make.
      'node-double-click',
      'canvas-double-click',
      'select',
      { type: 'drag-node', options: { pin: true } },
      // Last, because it is the background fallback — listed earlier it claims the press `select`
      // needs to see, and clicking empty canvas silently stops clearing the selection.
      'pan-zoom',
    ],
    /*
      The lines, in the colour the community set — the key's third canvas row.

      `LINK_FILL` answers the graph's own default where nobody has chosen anything, so a canvas
      nobody has touched is unchanged. The arrowhead follows the line: the renderer emits a head per
      colour actually asked for, since an SVG marker paints in its own right rather than inheriting
      from the path that references it.
    */
    edgeStyle: [{ style: { curve: 'smooth', arrow: 'target', width: 2, showLabel: true, color: { $: LINK_FILL } } }],
    controls: ['zoom-in', 'zoom-out', 'fit', 'lock'],
    height: '100%',
    /*
      The ground the cards sit on, as the community set it — the key's second row.

      The graph's own default is the `page` role, which is what this answers with when nobody has
      chosen anything, so a canvas nobody has touched is unchanged. A CSS value rather than a token
      name because that is what the picker emits and what the graph's `color()` passes through
      untouched; `CANVAS_FILL` spells its fallback the same way for the same reason.
    */
    bg: { $: CANVAS_FILL },
    /*
      The canvas's own words for an empty canvas, in the canvas.

      One expression rather than two branches, which is what lets one surface answer both states: no
      call to be about, and a call that has not produced anything yet. The generic
      "Nothing to show yet." is right for a graph whose host has no opinion and wrong here, where
      there is something to do about it.
    */
    empty: {
      $: `${CALL_EXPR} ? 'Nothing from this call yet. Tasks and events appear here as the conversation produces them — drag them into an arrangement and join them up.' : 'Start or choose a call. What it produces appears here as cards you can move and join up.'`,
    },
    /*
      And drawn as an invitation, which is what both of those sentences are — the same gradient the
      other two routes' gates carry, so the three pages of this template answer an empty address in
      one voice. Neither state is a dead end: one is waiting for a call to be started or chosen, the
      other for the conversation to produce something.
    */
    emptyGradient: 'primary',
    /*
      The graph's own status strip, on.

      Every read a seed makes is caught and reported through `context.warn` rather than thrown — a
      canvas that cannot read one of its types keeps the rest — and with no strip there is nowhere for
      that report to land. A canvas that silently draws nothing is then indistinguishable from a call
      that produced nothing, which is exactly the state this template spent three sittings in.
    */
    showStatus: true,
    /*
      The line, drawn — and written on the spot, with nothing filled in.

      `connectNodesNow` rather than `connectNodes`, which is the knowledge map's answer and stays it:
      there, a claim two things are related is what the map is *for*, and the form is where somebody
      says what they mean by it. Here the arrangement is the work. Drawing the line **is** the
      assertion, and a modal per line is a mode change in the middle of a spatial gesture — on the one
      surface where every other gesture writes silently, `onEdgeRetarget` included, which changes what
      an existing line *says* with no dialog at all. Asking on the cheaper act and not on the dearer
      one is the wrong way round.

      Nothing is deferred that was ever enforced: the form saved with both fields empty, so an
      unlabelled connection was always reachable and this only stops charging a modal for it. The
      words are added where the line is read — click it, and the inspector has its label, its
      description and the community's kinds.

      Which is why the `onSuccess` matters as much as the call. A line that appears with nothing
      selected teaches nobody that it is a record with an author and a thread; opening the inspector
      on it puts the fields in front of the person who just drew it, in the same beat. Empty on a
      failure, which clears the panel rather than leaving the last card in it — the same honesty
      `onEdgeClick` keeps for a line with nothing behind it.
    */
    onEdgeCreate: {
      $action: 'recordStore.connectNodesNow',
      args: [{ $: 'event' }],
      onSuccess: [
        { $setLocal: 'inspecting', value: { $: 'result' } },
        { $setLocal: 'inspectingType', value: { $: "result ? 'Relationship' : ''" } },
      ],
    },
    /*
      The drop, written back — an upsert against the *canvas* rather than an update of the record.

      A coordinate is a fact about the pair, so the same task can sit on two canvases in two places and
      the record never learns it was on one. `recordId`/`recordType` rather than the node's address:
      the graph names a node `we-graph://entity/<dataset>/<type>/<id>` and a template has no operator
      that could take that apart.
    */
    onNodeDragEnd: {
      $action: 'recordStore.placeOnCanvas',
      args: [CALL, { $: 'event.recordId' }, { $: 'event.recordType' }, { $: 'event.x' }, { $: 'event.y' }],
    },
    onNodeResize: { $action: 'recordStore.resizeOnCanvas', args: [CALL, { $: 'event' }] },
    /*
      Routing a line by hand, written back — and binding these is what puts the handles on one.

      Two gestures over one record: `onEdgeAnchor` pins which side of a card an end attaches to,
      dragged around the card's rim; `onEdgeReroute` carries the points the line is bent through, so
      a connection can be taken round a card sitting between its two ends. Both land on an
      `EdgeRoute` parented to this canvas rather than on the `Relationship` — how a claim is *drawn*
      is a fact about a view, and the same claim on another canvas is untouched.
    */
    onEdgeAnchor: { $action: 'recordStore.anchorOnCanvas', args: [CALL, { $: 'event' }] },
    onEdgeReroute: { $action: 'recordStore.rerouteOnCanvas', args: [CALL, { $: 'event' }] },
    /*
      And the same handle dropped on a *different* card, which re-attaches the connection.

      The one gesture here that edits the claim rather than the view: an anchor and a bend are how
      this canvas draws the line, and this is what the line *says* — so it changes wherever the
      relationship is shown. That end's anchor is cleared with it, a side pinned against the card
      that used to be there deciding nothing about the one that arrived.
    */
    onEdgeRetarget: { $action: 'recordStore.retargetOnCanvas', args: [CALL, { $: 'event' }] },
    /*
      What is selected, in the address — because the inspector is a *panel*.

      A panel is not inside this route's tree, so the two cannot share a `$localState`: the canvas
      would be writing a name the inspector has no way to read. The address is the one thing both
      can see, and it is what this template already uses to say which call it is about — with the
      same benefits, that a reload comes back to the same card and the link can be sent.

      Two parameters rather than one, because a schema cannot ask what type an id is: `$query` needs
      an entity, and so does `recordStore.displays`. The graph carries both on the payload, which is
      the reason `recordType` is on a single click at all.
    */
    onNodeClick: [
      { $setLocal: 'inspecting', value: { $: 'event.recordId' } },
      { $setLocal: 'inspectingType', value: { $: 'event.recordType' } },
    ],
    /*
      Double-click opens a note in the composer. The first click has already selected it, so the
      modal reads the selection — see `editNoteModal`. A record that is not a note has no document
      to compose; its fields are in the inspector, where the pencil unlocks them.
    */
    onNodeDoubleClick: {
      $if: {
        condition: { $: "event.recordType == 'CollectionBlock'" },
        then: { $setLocal: 'noteOpen', value: true },
      },
    },
    // Double-click empty canvas to make something there — see `newThingChooser`.
    onCanvasDoubleClick: askWhatGoesHere,
    /*
      Something dragged in from the Pocket, or from anywhere else, lands where it was dropped.

      A placement is the canvas's membership, so the store's one action is enough — and it refuses
      a record from another space, which this canvas could not draw, with a sentence saying so.
    */
    onDrop: { $action: 'recordStore.dropOnCanvas', args: [CALL, { $: 'event' }] },
    /*
      A line is a record here too, so clicking one inspects it.

      The canvas draws its connections from `Relationship`, a reified entity — which means each line
      *stands for* something with an author, a label and a description, and the inspector was the
      one surface that could not show it. `recordId` is absent on an ordinary edge, which stands for
      a declared relation and has no record of its own; setting both from an empty value clears the
      panel rather than leaving the last card in it, which is the honest answer for a line there is
      nothing to say about.
    */
    onEdgeClick: [
      { $setLocal: 'inspecting', value: { $: 'event.recordId' } },
      { $setLocal: 'inspectingType', value: { $: 'event.recordType' } },
    ],
    /*
      Delete, on whatever is selected — a card or a line, the same key for both.

      An accelerator, not the only path: a card's own bar carries a bin (see `nodeActions`), and the
      inspector carries one for whichever of the two is open. A key that was the sole way to remove
      something would be a way nobody discovers. What it buys is the case where reaching for either
      of those is disproportionate — tidying up a canvas, where the answer to "this line is wrong" is
      wanted in the same beat as noticing it.

      Guarded on `event.recordId`, which the graph fills only for a selection of exactly one record.
      That is the whole of the multi-select story here and it is deliberately small: `record.delete`
      raises the host's own confirmation, so firing it per member of a selection would stack a dialog
      per card. A batch confirmation is a thing to design rather than to arrive at by looping.

      Through `record.delete` for `nodeActions`' reason — it is guarded by the host, so a keystroke
      asks before it destroys anything. Which is also what makes the key safe to offer at all: there
      is no undo behind it.
    */
    onDeleteSelection: {
      $if: {
        condition: { $: 'event.recordId' },
        then: { $action: 'record.delete', args: [{ $: 'event.recordType' }, { $: 'event.recordId' }] },
      },
    },
    /*
      Clearing on a background click, and only then.

      `select` emits this on every selection change, so an unguarded clear would race the click that
      set it — which of the two won would depend on the order the behaviour happens to emit them in.
      The empty list is the state actually worth acting on: nothing is selected, so there is nothing
      to inspect.
    */
    onSelectionChange: {
      $if: {
        condition: { $: '!count(arg)' },
        then: [
          { $setLocal: 'inspecting', value: '' },
          { $setLocal: 'inspectingType', value: '' },
        ],
      },
    },
    /*
      The decision, on the card that raised it.

      A suggestion is resolvable from the extraction panel too, and that is the right surface for
      working through a backlog. It is the wrong one when the thing you are looking at is in front
      of you: the card is what asked the question, so finding its line in a list somewhere else and
      matching the two up by reading is work the canvas created and should absorb.

      `when` is the style rules' own match clause against the same node data, so the tick and the
      cross appear on exactly the cards the rule above faded — one fact, read twice, which is what
      stops the two from ever disagreeing. `data.` prefix included: see the note up there.

      Delete appears once a card is settled, and not before. On a suggestion it would be a second
      button that looks like it does the same thing as the cross — and it is not the same thing:
      discarding resolves the suggestion, where deleting only removes the record and leaves the
      staged overlay behind it, so the extraction panel would go on offering a decision about
      something that no longer exists. Two buttons, one of them subtly wrong, is worse than one.

      `{ exists: false }` rather than `{ not: true }`, because the seed writes the flag only on the
      cards it applies to — "not pending" is the absence of the field, which is what this asks.

      It is still offered on everything else. Extraction proposes things that are simply wrong about
      a conversation, and until now the only way to remove one that had been accepted was to find it
      in another view.
    */
    nodeActions: [
      { id: 'accept', icon: 'check', title: 'Keep this', when: { 'data.pending': true }, tone: 'positive' },
      { id: 'reject', icon: 'x', title: 'Discard this', when: { 'data.pending': true }, tone: 'danger' },
      /*
        How this card looks, on the card — colour, shape, and how large its content is drawn.

        Presentation per placement, and it lives in the header with the other things you do *to* a
        card rather than in the inspector, which is about what the record says. Host controls named
        by `control`, so this stays JSON; each reads its value off the placement's data and reports
        through `onNodeAction` with a `value`. Not on a suggestion: a card nobody has agreed to
        offers the decision and nothing else.
      */
      {
        id: 'color',
        control: 'color',
        title: 'Colour',
        value: { from: 'data.canvasColor' },
        when: { 'data.pending': { exists: false } },
      },
      {
        id: 'cardShape',
        control: 'shape',
        title: 'Shape',
        value: { from: 'data.canvasCardShape' },
        when: { 'data.pending': { exists: false } },
      },
      {
        id: 'contentScale',
        control: 'scale',
        title: 'Content size',
        value: { from: 'data.canvasContentScale' },
        when: { 'data.pending': { exists: false } },
      },
      {
        id: 'delete',
        icon: 'trash',
        title: 'Delete',
        when: { 'data.pending': { exists: false } },
        tone: 'danger',
      },
    ],
    /*
      One handler, branching on which was pressed — the shape a handler array is for.

      Delete goes through `record.delete` rather than a store action, so it is guarded by the host's
      own confirmation like every destructive call a template can name. The other two need none:
      discarding a suggestion removes something nobody has agreed to, and a second dialog in front of
      that is a question about a question.
    */
    onNodeAction: [
      {
        $if: {
          condition: { $: "event.action == 'accept'" },
          then: { $action: 'modules.transcribe.acceptProposal', args: [{ $: 'event.recordId' }] },
        },
      },
      {
        $if: {
          condition: { $: "event.action == 'reject'" },
          then: { $action: 'modules.transcribe.rejectProposal', args: [{ $: 'event.recordId' }] },
        },
      },
      {
        $if: {
          condition: { $: "event.action == 'delete'" },
          then: { $action: 'record.delete', args: [{ $: 'event.recordType' }, { $: 'event.recordId' }] },
        },
      },
      /*
        The three presentation controls, through one action that takes the field name — the action's
        id IS the placement field. A moving control previews without writing, so a slider shows its
        result before the drag ends and the card never jumps; a settled one writes.
      */
      {
        $if: {
          condition: { $: "event.action in ['color', 'cardShape', 'contentScale'] && event.preview" },
          then: {
            $action: 'recordStore.previewCardStyle',
            args: [{ $: 'event.recordId' }, { $: 'event.action' }, { $: 'event.value' }],
          },
        },
      },
      {
        $if: {
          condition: { $: "event.action in ['color', 'cardShape', 'contentScale'] && !event.preview" },
          then: {
            $action: 'recordStore.setCardStyle',
            args: [CALL, { $: 'event.recordId' }, { $: 'event.action' }, { $: 'event.value' }],
          },
        },
      },
      /*
        Picking a colour turns the lenses off.

        A card's own colour is hidden while a lens is on, so a picker whose result stayed invisible
        would read as broken. Choosing one is a statement that this card's colour matters more than
        the reading right now; the key is one click away for whoever wants the reading back.
      */
      {
        $if: {
          condition: { $: `event.action == 'color' && !event.preview && !(${NO_LENS})` },
          then: { $action: 'routeStore.setParam', args: [LENS_PARAM, 'none'] },
        },
      },
    ],
  },
  /*
    The way in, under the canvas's own sentence.

    This is the landing route, so it is the screen on which "there is no call yet" is most often
    read — and until now the only door out of it was a button in the corner and a panel somebody can
    close. The other two routes put one under their gate; the canvas could not, because its
    placeholder is drawn by `GraphView` from a string rather than by a node this template owns.

    A slot is how a node hands a component something rendered: the renderer resolves it and spreads
    it onto the component's props, so the button lands *inside* the graph's own centred box. Which is
    the point — it stays under the sentence at every size, through every panel opening and closing,
    with nothing here positioning anything. A button floated over the canvas would have to be lined
    up against a box it cannot measure, and would be the second thing over the canvas besides.

    Gated, because that box answers two questions. `empty` says one sentence when there is no call
    and another when a call has produced nothing yet, and only the first is an invitation to start
    one — offering a new call to somebody already reading one is answering a question they did not
    ask. The same condition the other two routes gate their gates on, so all three agree.
  */
  slots: {
    emptyAction: {
      type: '$if',
      props: { condition: { $: `!(${CALL_EXPR})` }, then: startCallButton('md') },
    },
  },
};

/**
 * The canvas's body. One route, whichever call it is about: the id is a query parameter, so the path
 * is the same for the live call and for one somebody chose — see `CALL`.
 */
const canvasBody: Omit<RouteSchema, 'path'> = {
  type: 'Column',
  /*
    `flex: 1`, not `height: '100%'` — and the difference is the whole canvas.

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
  /*
    `syncParam`, so the inspector panel can read what the canvas selected — see `onNodeClick`.

    View state rather than a preference: if this address is sent to somebody, they should arrive
    looking at the same card. `push: false` (the default) because moving between cards is not
    something to walk back through with the Back button — the call, which *is* a place, keeps its
    own entry.
  */
  $localState: {
    inspecting: { type: 'string', initial: '', syncParam: 'card' },
    inspectingType: { type: 'string', initial: '', syncParam: 'cardType' },
    // Making things and opening notes — see `WorkshopCards`.
    ...CARD_LOCALS,
  },
  /*
    The space's key, which the canvas builds its colour rules from — see `lensNodeRules`.

    On the route rather than the template root: local scope resets at a route boundary, since each
    route is rendered through its own pass with nothing inherited, so a query hoisted to the root
    would validate and then resolve to nothing here. Each of the three pages declares its own.
  */
  $queries: { typeStyles: TYPE_STYLES_QUERY },
  /*
    The canvas itself, always — never a placeholder standing in front of it.

    There were two, and they swapped. This route gated on `CALL` and drew its own prompt when there
    was none; the graph drew its own "Nothing to show yet." once mounted with no nodes. So the first
    words a call showed were replaced, a second or two in, by weaker ones on a different background —
    two surfaces disagreeing about the same emptiness, which is what having two placeholders always
    comes to.

    One now, inside the canvas, saying whichever of the two things is true. The graph's `canvas` seed
    loads nothing until it is given a canvas, so mounting it with no call costs a read of nothing and
    keeps the surface constant from the first frame.
  */
  children: [
    canvas,
    /*
      Where a connection is actually written down.

      Drawing a line between two cards sets `recordStore.pendingLink` and opens the record form on a
      `Relationship` — and a form whose non-nullness mounts a modal needs something to mount it.
      Nothing here did: the modal is placed by the *default* template's graph view, and this template
      supplies its own canvas. So the drag completed, the store opened a draft, and the screen showed
      nothing at all — the connection gesture looked like it had silently failed when what had
      failed was the surface that asks about it.

      Above the canvas rather than inside it, for the reason the graph view gives: a graph is a
      transformed, zoomable surface and text entry on one is its own project, while what is being
      authored is a record and has nothing to do with where it will land.

      No `onCreated`. The default's graph bumps a `revision` to force a reload; this canvas watches
      the entity it draws connections from, so a new `Relationship` arrives on its own.
    */
    recordFormModal(),
    // What goes here, a new note, and the selected note opened — see `WorkshopCards`.
    newThingChooser(CALL),
    newNoteModal(CALL),
    editNoteModal,
  ],
};

const canvasRoute: RouteSchema = { path: '/canvas', ...canvasBody };

/**
 * The work this call produced, on a board of its own.
 *
 * ## The board belongs to the call
 *
 * Every other surface of this template is about the call the address names — the canvas draws that
 * call's records, the transcript is that call's, the nav carries `?call=` from page to page — so this
 * is too. `taskBoard` is the same fragment the Boards view renders, given this call's board rather
 * than one picked from a list, and scoped so the cards are the ones the conversation produced.
 *
 * The space-wide reading is not lost; it is the **Everything** board in the Boards view, which is a
 * click away and unscoped.
 *
 * ## Made on a press, once
 *
 * A call gets no board until somebody wants one, and then it gets a real one — columns and all — so
 * cards can be ordered inside a column from the first drag. Making it is a click rather than a side
 * effect of opening the route: this is a shared space, and every member who opened the tab would
 * otherwise race to create the same board.
 */
/**
 * What a route shows when it has nothing to be about.
 *
 * Two situations, and they are not the same one: nobody has chosen a call, or this call has not been
 * given whatever the page draws. Each says its own sentence, and only the second offers a button.
 *
 * Neither is a dead end, which is why the icon is gradient in both. The usual rule — gradient where
 * there is something to do, flat where there is not — turns on whether the reader can get out of the
 * state, not on whether this page happens to carry the control: a call is chosen in the calls panel,
 * from every route, so "choose a call" is an invitation with its affordance one panel away rather
 * than a wall. Drawn flat it read as a failure, on the one screen every reader of this template sees
 * first.
 *
 * `flex: '1'` is what centres it. The gate is the whole page when it shows, so it takes the height
 * the route was given and sits in the middle of it — a placeholder pinned under the nav pill with a
 * screen of nothing below reads as content that failed to load. Every box between here and the root
 * passes the height down the same way; see the routes.
 *
 * Distinct from `emptyState`, which is the answer to "this list is empty": that sentence is about
 * content, this one is about the *address*, and a page with no subject has not asked a question yet.
 * Both routes that hang off a call need it — the kanban, and now the calendar — so the icon is a
 * parameter and the shape is shared. Kept local to this template rather than lifted into the kit: it
 * has two callers in one file, and the extraction threshold is three.
 */
function callGate(icon: string, message: string, action?: SchemaNode): SchemaNode {
  return {
    type: 'Column',
    props: { width: '100%', flex: '1', ax: 'center', ay: 'center', gap: '400', p: '600' },
    children: [
      {
        type: 'we-icon',
        props: { name: icon, size: 'xl', gradient: 'primary' },
      },
      {
        type: 'we-text',
        props: { variant: 'body', textAlign: 'center', maxWidth: 'var(--we-layout-xs)', color: 'text-muted' },
        children: [message],
      },
      ...(action ? [action] : []),
    ],
  };
}

/**
 * Room for the nav pill above the content, and room to breathe below it.
 *
 * On the branch that draws content, and not on the route, which is what makes the three pages line
 * up. A gate centres itself in the box it is given, so vertical padding on the route moved its
 * midpoint down by half the difference between the two — 16px, against a canvas whose placeholder
 * centres in the whole route because the canvas has no padding to speak of. Small enough to look
 * like nothing in a screenshot and exactly big enough to read as a jump when somebody clicks
 * between Canvas, Kanban and Calendar.
 *
 * Horizontal padding stays on the route, where it applies to both branches: it shifts nothing
 * vertically, and outside the measure column is where it belongs, so the content is the full
 * measure wide rather than the measure less its gutters.
 *
 * The top is the bar's own bottom edge plus a gap, not a token that comes close to it. It was
 * `pt: '900'` — 64px, against pills that end at 68 — so the kanban's first column and the calendar's
 * month header both started *under* the chrome they were meant to clear, by four pixels and by more
 * under a theme that adds to control heights. See `CHROME_BOTTOM`, which is where that arithmetic
 * now lives.
 *
 * The gap over it is `500` rather than the `300` `chromeReserve` adds for panels, and the difference
 * is deliberate. A panel snapped to the top is a floating card with an edge and a shadow of its own,
 * and twelve pixels of daylight reads as one object clearing another; a route's content *is* the
 * page, so at the same distance the kanban's first column and the calendar's month header looked
 * tucked under the pills rather than starting below them. Content wants more room from chrome than
 * chrome wants from chrome.
 */
const ROUTE_BAND = { pt: `calc(${CHROME_BOTTOM} + var(--we-space-500))`, pb: '600' } as const;

const kanbanRoute: RouteSchema = {
  path: '/kanban',
  type: 'Column',
  props: { width: '100%', minHeight: '100%', ax: 'center', px: '400' },
  children: [
    {
      type: 'Column',
      /*
        `flex: '1'`, so the measure column is as tall as the route rather than as tall as what is in
        it. It costs the board nothing — a Column's children stack from the top whatever height the
        box has — and it is the link that lets `callGate` centre itself, which it cannot do inside a
        box that shrink-wraps an icon and a sentence.

        And no `maxWidth`, which is the one place this route parts company with the calendar beside
        it. A measure is for prose and for grids that reflow: cap them and a wide window gets a
        comfortable column instead of a stretched one. A board does neither. Its columns are a fixed
        300px each by design — a kanban column is a fixed width everywhere it appears, and a column
        that grew to a sixth of a 2560px screen would be a card gallery, not a column — so the cap
        was not deciding how wide a column is, only how many of them fit. `var(--we-layout-lg)` is
        1200px, which is three columns and the edge of a fourth, on a screen with room for six; the
        rest were reachable only through the board's own horizontal scroll, with the space they
        wanted sitting empty on either side of the page.

        So the board takes the width the route was given and `overflowX` on its own row stays the
        answer for the case that actually needs it — more columns than any screen holds. `px` on the
        route still keeps it off the window edges, and the gate inside centres itself whatever the
        box is, so the empty state is unchanged.
      */
      props: { width: '100%', flex: '1', gap: '400' },
      children: [
        {
          type: '$if',
          props: {
            /*
              Nothing is asked about a call until there is one, and that gate is load-bearing.

              `pruneUnresolvedWhere` drops a `where` operand that is `undefined`, and
              `modules.call.callRecordId` deliberately answers `''` rather than undefined so that every
              surface reading it gets a string. So an ungated `where: { id: '' }` survived pruning and
              was sent, and the backend built its `VALUES` clause with that one id dropped for not
              being an IRI — leaving the clause empty, which is not parseable SPARQL: *Query is not
              valid read-only SPARQL … expected UNDEF*.

              Teaching the pruner to drop `''` would have silenced that and been the wrong repair. An
              absent operand means "do not narrow", so the query would have answered with an
              *arbitrary* collection and this route would have drawn some other call's board with
              nothing on screen saying so — the same hazard the Boards view guards its `anchorRow`
              against. `scopeIsAnchored` can read `''` as absent precisely because widening a scope is
              what an unanchored view wants; widening an identity is never what anybody wants.
            */
            condition: CALL,
            then: {
              type: 'Column',
              props: { width: '100%', gap: '400', ...ROUTE_BAND },
              /*
                Which board this call calls its own, if any — its `board` relation rather than "the
                first board parented to it". A call may hold several; one of them is the one
                extraction lands on, and only the call can say which. Its own query rather than the
                fragment's, because the choice between "open it" and "make one" is made out here,
                before there is an id to render.
              */
              $queries: {
                callRow: { entity: 'CollectionBlock', where: { id: CALL }, include: { board: true }, limit: 1 },
              },
              children: [
                {
                  type: '$if',
                  props: {
                    condition: { $: 'first(local.callRow).board.id' },
                    then: taskBoard({
                      // The call's own board, which gathers from the call — a fact the board carries,
                      // so nothing here has to say so.
                      boardId: { $: 'first(local.callRow).board.id' },
                      /*
                        No `bg`, so a card is `surface` — and the key's lenses stop at the canvas.

                        This route used to pass `recordFill`, on the argument that three pages about
                        one call should never disagree about what a colour means. The argument was
                        sound and its premise was not: neither lens says anything here.

                        **Kind** is a *constant* on a board. `recordFill` takes the kind as a literal
                        and a board holds only tasks, so the expression answered the same colour for
                        every card on the page — a tint over the whole board rather than a key, and
                        the default lens besides, so this is what the route looked like out of the
                        box. **State** is the column: a bound column IS its state, so colouring by it
                        restates the heading in a second alphabet. Its residual case — a lane and the
                        Unplaced column, where the column says nothing — is real and is not worth a
                        mechanism, since the card already carries a state badge there (`showState`).

                        A card somebody coloured on the canvas loses that colour here, which is the
                        one thing given up. It was already invisible: `recordFill` read the freeform
                        colour only with both lenses off, and the lens defaults to kind. Nothing on
                        screen changes for a reader who never touched the key.

                        If per-card colour is wanted on a board later it needs a picker *here* —
                        colouring is a `nodeActions` affordance on a graph node, so a card that never
                        reached the canvas has no placement and no way to be given one. That is the
                        work, not this expression.
                      */
                      // Who ran the pass that wrote it — the provenance question this template is
                      // built around, and the reason its cards carry a byline where a space's board
                      // does not.
                      byline: true,
                      empty: emptyState({
                        icon: 'check-square',
                        label: 'work',
                        message:
                          'Nothing from this call yet. Cards appear here as the conversation commits to things — or add one to a column.',
                      }),
                    }),
                    /*
                      "No board yet" is an answer, and it is only given once the call record has
                      answered. Before that the same spinner the board itself shows holds the place,
                      so the route reads as one wait rather than a claim that turns out to be false.
                    */
                    else: {
                      type: '$if',
                      props: {
                        condition: { $: 'local.callRowLoaded' },
                        then: callGate(
                          'kanban',
                          'This call has no board yet. Making one arranges the work it produced — it never moves anything.',
                          {
                            type: 'we-button',
                            props: { onClick: { $action: 'spaceStore.openBoardFor', args: [CALL, 'This call'] } },
                            children: ['Make a board for this call'],
                          },
                        ),
                        else: taskBoardLoading,
                      },
                    },
                  },
                },
              ],
            },
            else: callGate(
              'kanban',
              'Start or choose a call. The work it commits to appears here as cards on a board.',
              startCallButton('md'),
            ),
          },
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
  // On this node rather than on the route, so the flag sits with the button and the modal that use
  // it. `day` and `events` are declared above and still read through — an inner declaration merges
  // with the outer one rather than replacing it.
  $localState: { newEventOpen: { type: 'boolean', initial: false } },
  children: [
    {
      type: 'Row',
      props: { width: '100%', ay: 'center', gap: '300' },
      children: [
        /*
          The heading, and the one thing it must not be: the key the grid matches on.

          A cell's date is `YYYY-MM-DD` because `startsWith` needs it to be, and printing that
          straight out made the list under the calendar announce itself as "2026-09-11" —
          machine-readable, and the only place in the route where a reader is asked to parse one.
          `we-timestamp` says the same day in their own language. Year omitted: the grid directly
          above is already headed with the month and year, and a heading that repeats its parent is
          noise.

          `+ 'T00:00'` is not decoration. A bare `YYYY-MM-DD` is parsed as UTC midnight, so west of
          Greenwich it formats as the day BEFORE the one that was clicked — the heading and the rows
          under it would disagree about which day this is. The suffix makes it a local time, which is
          what a calendar cell means by a date, and what `startDate` already is.

          The typography props rather than `we-text`'s `variant`/`uppercase` shorthands, which are
          that element's own and not part of the DS layers a timestamp inherits — `label` is
          fontSize 200 at medium.
        */
        {
          type: '$if',
          props: {
            condition: { $: 'local.day' },
            then: {
              type: 'we-timestamp',
              props: {
                value: { $: "local.day + 'T00:00'" },
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                fontSize: '200',
                fontWeight: 'medium',
                color: 'text-muted',
                textTransform: 'uppercase',
                letterSpacing: 'wide',
              },
            },
            else: {
              type: 'we-text',
              props: {
                variant: 'label',
                color: 'text-muted',
                textTransform: 'uppercase',
                letterSpacing: 'wide',
                text: 'Coming up',
              },
            },
          },
        },
        /*
          Adding one by hand, which is the other way an event gets here.

          Only with a day chosen, and that is the whole design rather than a restriction: the day
          IS the date, so the form asks for a time and never for a date somebody has already
          picked. Unanchored — "Coming up" — there would be nothing to create against, and a
          button that opened a form asking for the full date would be a second, differently-shaped
          composer for the same record.

          `ml: 'auto'` rather than `ax: 'between'` on the row: the heading changes width as the
          date does, and `between` would walk the button a few pixels left and right from one day
          to the next.
        */
        {
          type: '$if',
          props: {
            condition: { $: 'local.day' },
            then: {
              type: 'we-button',
              props: {
                size: 'sm',
                variant: 'secondary',
                ml: 'auto',
                onClick: { $setLocal: 'newEventOpen', value: true },
              },
              children: [{ type: 'we-icon', props: { name: 'plus' } }, 'Add event'],
            },
          },
        },
      ],
    },
    /*
      The composer.

      `record.create` rather than the block composer, for the reason the other bare-record forms
      here give: an event is a title, a time and a line of context, so putting it through a block
      editor would ask for a document nobody wants to write.

      Parented to the call, which is the part that cannot be left out. Every surface of this
      template reads its records through `anchorScope(CALL)` — `CollectionBlock` → `children` —
      so an event created unparented is written into the space and then shows up on no screen in
      this template, including the calendar it was just added from. `we://children` is that
      relation's predicate.

      The drafts are declared on the modal, so closing discards them; a draft declared on the page
      would have to be cleared by hand on every exit, and the one somebody forgets is the one that
      re-opens holding last time's title.
    */
    formModal({
      open: { $: 'local.newEventOpen' },
      close: { $setLocal: 'newEventOpen', value: false },
      title: 'New event',
      size: 'sm',
      localState: {
        draftTitle: { type: 'string', initial: '' },
        // A default, so the form is submittable the moment a title is typed. Mid-morning rather
        // than midnight: an event with no time said is a daytime one, and `00:00` reads as a
        // mistake somebody has to correct rather than as an answer.
        draftTime: { type: 'string', initial: '09:00' },
        draftDescription: { type: 'string', initial: '' },
      },
      children: [
        {
          // Which day this is going on, since the form never asks. Same formatting as the heading
          // it was opened from, including the `T00:00` that keeps it off the day before.
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'calendar', size: 'xs', color: 'text-muted' } },
            {
              type: 'we-timestamp',
              props: {
                value: { $: "local.day + 'T00:00'" },
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                fontSize: '200',
                color: 'text-muted',
              },
            },
          ],
        },
        field({ name: 'draftTitle', label: 'What is it?', placeholder: 'Design review', props: { autofocus: true } }),
        field({ name: 'draftTime', label: 'Time', props: { type: 'time' } }),
        field({
          name: 'draftDescription',
          label: 'Notes',
          control: 'textarea',
          placeholder: 'Optional — what it is for, what to bring',
        }),
      ],
      // What the model requires, less the date the day already answers. A precondition rather than
      // validation rules: nothing about a title or a time is judgeable here beyond being there.
      disabled: { $: '!local.draftTitle || !local.draftTime' },
      // The time is deliberately absent: it arrives already filled in, so including it would make
      // the guard fire on a form nobody has touched — which is the failure mode that teaches people
      // to click through the dialog.
      discardWhen: { $: 'local.draftTitle || local.draftDescription' },
      submitLabel: 'Add event',
      submit: {
        $action: 'record.create',
        args: [
          'EventBlock',
          {
            title: { $: 'local.draftTitle' },
            // The chosen day and the typed time, assembled into the `YYYY-MM-DDTHH:mm` that
            // extraction also writes — which is what lets the grid's `startsWith` match both.
            startDate: { $: "local.day + 'T' + local.draftTime" },
            description: { $: 'local.draftDescription' },
          },
          { parent: { id: CALL, predicate: 'we://children' } },
        ],
      },
    }),
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
                    /*
                      `surface`, and no lens — see the board's card for the argument, which lands
                      harder here.

                      Kind is a constant on a calendar for the same reason it is on a board: every row
                      is an `EventBlock`, so colouring by kind painted the whole list one tint. State
                      is worse than redundant. An event has no status, so `recordFill` was called
                      without one and the state lens fell through to plain — meaning turning it on
                      *removed* what colour the rows had and greyed every one of them. A lens that
                      only ever subtracts is not a reading.
                    */
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
                            // The place's name, not the place. Hydrated by the `include` on the
                            // query above; tested on the name rather than the record, since a
                            // location that has arrived without one has nothing to print.
                            condition: { $: 'event.location.name' },
                            then: {
                              type: 'Row',
                              props: { gap: '100', ay: 'center' },
                              children: [
                                { type: 'we-icon', props: { size: 'xs', name: 'map-pin', color: 'text-faint' } },
                                {
                                  type: 'we-text',
                                  props: {
                                    variant: 'footnote',
                                    color: 'text-muted',
                                    truncate: true,
                                    text: { $: 'event.location.name' },
                                  },
                                },
                              ],
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
                        /*
                          What the heading does not already say.

                          On a chosen day the date IS the heading a reader arrived through, so
                          repeating it on every row underneath says nothing — the row is only asked
                          when in the day. "Coming up" spans weeks, though, and there the time alone
                          is unreadable: three rows saying 14:00 are three different afternoons with
                          no way to tell which is tomorrow. So the date parts appear exactly when the
                          heading stops carrying them.

                          An empty string rather than a ternary to nothing: `we-timestamp` assembles
                          its `Intl` options by truthiness, so a blank part is simply left out.
                        */
                        weekday: { $: "local.day ? '' : 'short'" },
                        day: { $: "local.day ? '' : 'numeric'" },
                        month: { $: "local.day ? '' : 'short'" },
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
          /*
            `message` rather than `label`, because the default sentence is about the wrong subject
            twice over.

            "This space doesn't have any events." says *space* about a list scoped to one call — the
            calendar was space-wide once and the phrasing outlived the scoping. And this branch is
            also what a day with nothing on it shows, where the sentence is wrong a second way: a
            call with a full month in it says it has no events because a reader clicked a quiet
            Tuesday. Two situations, so two sentences.
          */
          message: {
            $: "local.day ? 'Nothing on this day.' : 'Nothing from this call yet. Events appear here as the conversation settles on dates.'",
          },
        }),
      },
    },
  ],
};

/**
 * The events, as a month.
 *
 * The counterpart to the kanban, and the same argument: a conversation produces two kinds of
 * commitment, one with a date on it and one without, and neither stops mattering because the meeting
 * ended. So this is one call's events, scoped and gated exactly as the board is — the whole point of
 * this template being that every surface answers about the call the address names.
 *
 * This paragraph used to argue the opposite, that a calendar asks "what is coming" and so belongs to
 * the community rather than to a recording. That reading is a good one and it has a home: the Calendar
 * section, which is unscoped and a click away. What it cannot be is *this* page, sharing a nav strip
 * and a `?call=` with three surfaces that mean something narrower — the argument survived the
 * scoping and outlived it by long enough to make an ungated month look deliberate.
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
const calendarRoute: RouteSchema = {
  path: '/calendar',
  type: 'Column',
  props: { width: '100%', minHeight: '100%', ax: 'center', px: '400' },
  children: [
    {
      type: 'Column',
      // `flex: '1'` for the same reason it is on the kanban route's measure column — see there.
      props: { width: '100%', maxWidth: 'var(--we-layout-lg)', flex: '1', gap: '400' },
      children: [
        {
          type: '$if',
          props: {
            /*
              No call, no calendar — the same gate the kanban keeps, and it was missing here.

              A scope whose anchor does not resolve is DROPPED rather than refused, and pruning
              WIDENS: with nothing selected this route quietly asked for every `EventBlock` in the
              space and drew them all, on a page whose every other surface is about one call. Nothing
              on screen said the reading had changed, which is the failure worth naming — a month full
              of somebody else's meetings looks exactly like a month full of this call's.

              The gate is outside the node that declares the query, so the question is never asked
              rather than asked and discarded. The space-wide reading is not lost: it is the Calendar
              section, a click away and unscoped, exactly as the space-wide board is.
            */
            condition: CALL,
            then: {
              type: 'Column',
              props: { width: '100%', gap: '400', ...ROUTE_BAND },
              $localState: {
                // Paging is arithmetic on an offset, so every source reads the same offset and the template
                // only ever adds to it.
                monthOffset: { type: 'number', initial: 0 },
                // The day a reader has picked, as `YYYY-MM-DD`, or empty for the whole month.
                day: { type: 'string', initial: '' },
              },
              $queries: {
                /*
                  Scoped to the call this workshop is about, exactly as the kanban is — and for the
                  reason given there: every other surface of this template answers about the call the
                  address names, so a list that quietly widened to the whole space was the odd one out.
                  The `$if` above is what makes the scope trustworthy: an anchor that does not resolve is
                  dropped rather than refused, so without the gate this read the whole space.

                  `include` on the place, because it is a record now rather than a word. `location` was a
                  string and is a `HasOne → LocationBlock`, so the row below reads `event.location.name`.
                  Without hydrating it the relation arrives as a URI and the row would print nothing at
                  all — the silent half of that change, and the reason the query moved rather than only
                  the row.
                */
                events: {
                  entity: 'EventBlock',
                  scope: anchorScope(CALL),
                  order: { startDate: 'asc' },
                  limit: 200,
                  include: { location: true },
                },
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
                      props: {
                        variant: 'heading-sm',
                        flex: '1',
                        text: { $: 'monthLabel({ offset: local.monthOffset })' },
                      },
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
                                        color: {
                                          $: "cell.isToday ? 'on-accent' : cell.inMonth ? 'text' : 'text-faint'",
                                        },
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
            else: callGate(
              'calendar',
              'Start or choose a call. The dates it settles on appear here as a month.',
              startCallButton('md'),
            ),
          },
        },
      ],
    },
  ],
};

export const workshopTemplate: TemplateSchema = {
  meta: {
    name: 'Workshop',
    description: 'A call, its transcript, and what came out of it — as a canvas, a task list and a record.',
    icon: 'compass-tool',
    /*
      The band the two floating pills occupy, so panels clear them.

      Written as the arithmetic rather than as a number, because it is a number that has already
      gone stale once: the pills grew from `sm` controls to `md` and this stayed at the old 64,
      which is four pixels less than they now occupy — so a panel snapped to the top opened
      underneath the bar it was supposed to clear.

        12   the pills' own offset from the top (`top: '300'`)
      + 40   the tallest thing in either — a control at the default height
      + 16   the pill's padding, 8 above and 8 below (`p: '200'`)
      + 12   clearance, so a panel meets the bar rather than touching it
      ────
        80

      Both pills come to the same height, which is not a coincidence: each is a padded row whose
      tallest child is one control, and that is what makes one band cover both. `top` stacks across
      every contributor and spans the full width, so the left-hand pill needs no term of its own.

      The same sum the routes clear the bar with, and the only reason it is spelt twice: the shell
      wants a number here, so the theme's control-height offset — which `CHROME_BOTTOM` carries and
      a number cannot — is the term this one is missing. It rounds up rather than down, which is the
      right direction for a reservation.

      The width describes the *centred* bar alone — it is what decides whether the module rail has
      to drop below it, and the rail is a column at top right that a left-hand pill cannot reach.
      Generous on purpose: over-reporting costs a rail that moves earlier than it had to, and
      under-reporting puts two things on top of each other.

      Unchanged when the left-hand corner gained a second child. It contributes no width term for the
      reason above, and the height is still one control in a padded row: the button beside the pill
      is a `sm` control, which is shorter than the pill's own.
    */
    chromeReserve: { top: 80, width: 520 },
    /*
      The layout, and none of it is scoped to a route.

      It was: the transcript and the readout were declared `route: 'canvas'`, on the argument that a
      task list does not need a transcript beside it. True, and beside the point — crossing to the
      kanban *unregistered* both panels, so their scroll position, their subscriptions and
      wherever they had been dragged were destroyed and rebuilt on the way back. Panels that survive
      navigation is the whole difference between a panel and a region of a page; scoping them by
      route gave that up to save a column of context nobody minded.

      Left standing, they cost nothing to switch between: the declaration is unchanged across a route
      change, so nothing is announced and nothing re-registers.

      The call is placed on every route and opened by none of them — see `open` in `TemplatePanel`.
    */
    panels: [
      /*
        The transcribe module's panel, placed. Nothing else — no body of our own.

        There was one, for one reason: the module's panel read `modules.transcribe.collectionId`,
        the call being *recorded into*, and the call on screen here is whatever the path names, so
        placing it would have put one surface about a different call beside three about this one.
        Supplying a body bought that at the price of a second copy of the header, the feed and the
        gating — and the copy drifted exactly as a copy does. It never gained the module's coverage
        readout or its capture status, so this template silently said less about a failing
        microphone than the default one did, and a fix to the transcript's scrolling landed on one
        of the two.

        The answer was never a second panel. "Show the call the address names, else the live one" is
        what a transcript panel should do everywhere, so it moved into the module — see `SUBJECT` in
        its `Panel.schema.ts` — and this went back to being what a template's panel entry is for:
        where the thing goes.

        `dock` still names which of the module's two panels this is. It is no longer load-bearing —
        without a `node` there is nothing to supply — but it is what says the entry means the
        transcript rather than the extraction readout, and the entry below is its pair.
      */
      {
        id: 'transcript',
        module: 'transcribe',
        dock: 'transcript',
        snap: 'left',
        /*
          One sidebar cut in two, rather than two cards over the canvas.

          `displace` with a shared `band`: the transcript and the extraction readout are one lane
          down the left, meeting flush and costing the canvas their width once, with the boundary
          between them draggable. Floating, they covered the canvas's own edge and each kept its own
          width; the arrangement wanted here is a sidebar, and this is how a template says so.
        */
        displace: true,
        band: 0,
        order: 0,
        size: 'sm',
        // A transcript is readable narrower than a call stage; below this it wraps into a column
        // of single words.
        min: { width: 260 },
        /*
          Two shares against one, so the transcript takes about two thirds of the column.

          It was `1` against a `0`, which does not mean "most of it" — it means *all* the spare room,
          because a member with no grow keeps its base and nothing else. On a tall window that left
          the extraction panel at its minimum with a transcript towering over it. Grow is a ratio of
          the *slack*, so this is approximate rather than exactly two thirds, and the taller the
          column the closer it gets.
        */
        grow: 2,
      },
      {
        id: 'extraction',
        /*
          The module's extraction panel, placed — the twin of `transcript` above, and gone the same
          way for the same reasons.

          There was a body here too, and its own list of what a pass had found was the half of it
          worth keeping; the module's panel draws that now. What it did not have was the module's
          collapsing history, its per-pass prompt and response, the record button's three status
          lines or the watch's failure — so a failed pass was silent here and a settled one showed a
          green tick whether it had succeeded, found nothing or failed.

          It was also wrong in a way nothing surfaced: the chips and the Extract button asked about
          the *live* call while the results below them were the addressed one's, so a past call's
          list sat under another call's targets and the button that would have worked on it was
          hidden by a guard about the wrong record. The store answers per call now — see
          `extractionFor` — which is what let the panel move.
        */
        module: 'transcribe',
        dock: 'extraction',
        snap: 'left',
        // The same lane as the transcript — see there.
        displace: true,
        band: 0,
        order: 1,
        size: 'sm',
        // One share to the transcript's two. Not `0`, which pins it to its base and gives the
        // transcript every pixel of the slack — a column that reads as one panel and one strip.
        grow: 1,
      },
      /*
        The inspector, open by default and on the edge the canvas's own controls are not.

        Open, because a panel that has to be found before it can explain a card is a panel nobody
        discovers — and its empty state is a sentence rather than a blank box, so an unused one says
        what it is for.
      */
      { id: 'inspector', node: inspectorPanel, title: 'Inspector', snap: 'right', order: 0, size: 'sm', grow: 1 },
      /*
        No `open` here, though it stood as `open: false` for a long time and read as "placed, not
        shown". Nothing has ever honoured that on an authored panel — `open` suppresses a *module*
        launcher, and this panel has none — so the flag described a behaviour this template did not
        have, which is why the validator now says so.

        Open is also what it should be. This list is the only way to choose a call that has finished:
        the corner names the current one and the page gates start a new one, and neither picks from
        the archive. A panel carrying the one act nothing else offers should not begin hidden.
      */
      { id: 'calls', node: callsPanel, title: 'Calls', snap: 'right', order: 1, size: 'sm' },
      /*
        The key, open and in its own seat.

        Open, for the inspector's reason: a lens somebody has to find before the colours mean
        anything is a lens nobody turns on. Its own seat rather than a tab behind Calls, because a
        space template cannot bring a tab forward — `raiseDock` is host layout — so a key stacked
        behind the calls list would be one nobody could get back to from inside the template. Closed,
        it comes back with the picker's "Reset layout", like every authored panel.
      */
      {
        id: 'key',
        node: keyPanel({ call: CALL, callExpr: CALL_EXPR, extracted: EXTRACTED.$ }),
        title: 'Key',
        snap: 'right',
        order: 2,
        size: 'sm',
        grow: 1,
      },
      { id: 'call', module: 'call', snap: 'right', order: 3, size: 'sm', open: false },
    ],
  },
  type: 'Column',
  /*
    A **definite** height, which is the one thing a full-bleed route needs from its root.

    This was `minHeight: '100%'`, so that a route taller than the viewport grew rather than clipped.
    It does grow — and the box growing is not the same as the height being *definite*. A flex item's
    post-flex main size counts as definite only where its container's main size is, and `height:
    auto` with a min-height clamp is not: so the canvas route stretched down the screen while the
    canvas inside it resolved `height: 100%` against an indefinite height, got `auto`, and measured
    zero. The canvas grew; the percentage inside it did not.

    Nothing is lost by pinning it. The hazard `minHeight` was avoiding — this node's background
    stopping at the fold under a long task list — belongs to the scroll container above, which paints
    `page` across its whole scrollable area and says so. A tall route overflows this box, is not
    clipped (no `overflow` here), and scrolls in that container exactly as before.
  */
  props: { bg: 'page', width: '100%', height: '100%' },
  children: [callChrome, switcher, { type: '$routes' }],
  routes: [
    /*
      Relative, because the parent path this now sits under carries a parameter: an absolute target
      is joined to the *pattern*, so `/canvas` became a literal `/space/:spaceId/canvas`. Relative
      resolves against the address actually on screen.
    */
    { path: '/', redirect: './canvas' },
    canvasRoute,
    kanbanRoute,
    calendarRoute,
    {
      path: '*',
      type: 'Column',
      props: { flex: '1', ax: 'center', ay: 'center', p: '600' },
      children: [{ type: 'we-text', props: { color: 'text-faint' }, children: ['No such page.'] }],
    },
  ],
};
