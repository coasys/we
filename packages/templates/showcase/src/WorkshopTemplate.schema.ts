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
 * - **`open: false`** on the call, because the stage is a window onto a call and there is none on
 *   entering the space: opening it would put an empty panel over the canvas. Placed, opened by the
 *   call itself.
 */
import type { RouteSchema, SchemaNode, SchemaProp, TemplateSchema } from '@we/schema-shared';
// `field` and `formModal` through the template kit rather than `@we/schema-kit`: this package
// depends on the former, which re-exports them, and on the latter not at all.
import {
  anchorScope,
  answerButton,
  CHANGED,
  composerModal,
  discussionSection,
  emptyNote,
  emptyState,
  field,
  foldingBody,
  foldingSectionLabel,
  formModal,
  linkedRecords,
  newSignalTypeButton,
  panelHeader,
  panelScroll,
  peopleFilter,
  peopleRow,
  recordFormModal,
  signalDisplay,
  suggestedChanges,
  SUGGESTIONS_HIDDEN,
  suggestionsToggle,
  taskBoard,
  taskBoardLoading,
  UNCONFIRMED,
  withoutHiddenSuggestions,
} from '@we/template-kit';

import {
  askWhatGoesHere,
  BACK_TO_CHOOSER,
  CARD_LOCALS,
  editNoteModal,
  fieldEditor,
  newNoteModal,
  newThingChooser,
} from './WorkshopCards.ts';
import {
  CANVAS_FILL,
  FOLD_FROM_GRAPH,
  FOLD_QUERY,
  FOLDED_CARDS,
  HIDDEN_KINDS,
  keyPanel,
  kindFill,
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
  args: [{ $: `\`\${spaceStore.spacePath}/\${${PAGE_EXPR}}?call=\${${callExpr}}${LENS_QUERY}${FOLD_QUERY}\`` }],
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
  $: `\`\${spaceStore.spacePath}/\${nav.segment}?call=\${routeStore.params.call ?? ''}${LENS_QUERY}${FOLD_QUERY}\``,
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
 * A call is running **in this space**, whoever is in it.
 *
 * It was `modules.call.active || count(modules.call.liveCalls)`, and the first half of that is a
 * different question: `active` is true of a call in *any* space. So standing in a space with no call
 * at all, while in one somewhere else, every door this template has read "Go to the call" and led out
 * of the space you were looking at — there was no way to start one where you were standing.
 *
 * `liveCalls` is the space on screen, and it includes this agent's own call when that call is here,
 * so it answers both halves of what the old expression was reaching for. Being in a call elsewhere
 * is a separate fact, and it already has its own control: the call bar's "Back to the call in …",
 * which is the module's to draw and not this template's to duplicate.
 */
const CALL_RUNNING_HERE = 'count(modules.call.liveCalls)';

/**
 * This agent is in a call, and it is a call in this space — so "go to it" means bringing it up
 * rather than travelling.
 *
 * `active` alone would be true of a call in another space, where the honest offer is not "go to the
 * call" but "join the one here" or "start one".
 */
const IN_A_CALL_HERE = 'modules.call.active && !modules.call.elsewhere';

/**
 * Start a call about nothing in particular.
 *
 * `args: ['']` rather than no args, and the empty string is the point. A handler with no `args` does
 * not call the method with none — it forwards the handler's own arguments, so a click passes the
 * PointerEvent as the first parameter. `startCall` takes an optional anchor id, so it received the
 * event and the backend refused the write: "invalid type: map, expected a string". `args: []` does
 * not help either; an empty list reads as "no args given" and forwards the event too.
 *
 * `''` is falsy, which is how `startCall` already spells "no anchor" — a call about the space rather
 * than about some node in it.
 */
const NEW_CALL_ACTION: SchemaProp = { $action: 'modules.call.startCall', args: [''] };

/**
 * Start a second call, beside the one already running here.
 *
 * Only while there *is* one — otherwise the primary button beside it already says "New call", and
 * two controls doing the same thing is worse than one.
 *
 * ## What it costs, said in the tooltip
 *
 * This agent can be in one call at a time: `join` tears the current one down before the new one
 * starts. Pressing this while in a call therefore leaves that call, and the tooltip says so rather
 * than letting "New call" imply two at once. Everybody else stays where they are — what ends is your
 * part in it, which is why this is not a destructive-looking control.
 *
 * Ghost, and secondary in both senses: the common act on arriving at a space with a conversation in
 * it is joining that conversation, and a breakout is the deliberate minority case.
 */
const newCallButton = (size: 'sm' | 'md'): SchemaNode => ({
  type: '$if',
  props: {
    condition: { $: CALL_RUNNING_HERE },
    then: {
      type: 'we-tooltip',
      props: {
        content: {
          $: "modules.call.active ? 'Leave your call and start a new one' : 'Start a new call beside the one running'",
        },
      },
      children: [
        {
          type: 'we-button',
          props: {
            size,
            variant: 'ghost',
            gap: '200',
            /*
              Icon-only in the panel header, where the row is a title and a control and a word would
              crowd it; worded under a route's sentence, where a bare `+` beside "Join the call" is a
              glyph nobody has a reason to hover.

              `label` only on the square one, because that is the half with no visible word to serve
              as its accessible name — and a tooltip is not one.
            */
            ...(size === 'sm' ? { square: true, label: 'New call' } : {}),
            onClick: [NEW_CALL_ACTION, openLiveCall],
          },
          children: [
            { type: 'we-icon', props: { name: 'plus' } },
            ...(size === 'md' ? [{ type: 'we-text', children: ['New call'] }] : []),
          ],
        },
      ],
    },
  },
});

/**
 * The way into a call: go to yours, join the one running here, or start one — and, beside it, always
 * a way to start a *new* one.
 *
 * Takes its size because it is placed at two scales. `md` on a page with no call to be about —
 * under the sentence each of the three routes shows there, which is the template's main way in and
 * wants the default control height. `sm` in the calls panel header, where `panelShell` reserves the
 * height of a small control and a default one would make that header taller than every other
 * panel's.
 *
 * It used to sit in the corner beside the pill as well. That placement showed on the same condition
 * the page gates do and did the same thing, so it was the same door drawn twice — see `callChrome`.
 *
 * Gated on `canCall`, which is "this space can hold a call at all" — a personal space cannot, and an
 * offer to start one there fails at the point of pressing.
 *
 * ## Both halves stop naming a call
 *
 * `openLiveCall` after each of them, or a new call opens behind the *old* one: the address still
 * named whichever call you had been looking at, and `CALL` prefers what the address names, so the
 * transcript and the readout went on showing a finished meeting while a new one was being recorded
 * beside them. Nothing said which was which.
 *
 * Right for the other branches too. "Go to the call" and "Join the call" both mean one that is
 * running now, and that is exactly what naming none of them resolves to.
 *
 * ## Why it is two buttons
 *
 * It was one, branching three ways, and the branch that starts a call was the one that got shadowed:
 * the moment anybody in the space was in a call the button read "Join the call" everywhere this
 * template puts it — the panel header and all three route gates — and there was no start left
 * anywhere in the template. Somebody wanting a second conversation had to leave the first.
 *
 * That narrowing was right when it was made and it predates calls being plural. `liveCalls` is a
 * list; the call module offers a `+` beside its own join prompt for exactly this reason. So the
 * contextual verb keeps the primary, which is what somebody arriving almost always wants, and
 * starting a new one stands beside it whenever the primary is not itself a start.
 */
const startCallButton = (size: 'sm' | 'md'): SchemaNode => ({
  type: '$if',
  props: {
    condition: { $: 'modules.call.canCall' },
    then: {
      type: 'Row',
      props: {
        gap: '200',
        ay: 'center',
        // Its words are fixed, so it is the wrong half of the pair to shorten — see `callPill`.
        flexShrink: '0',
        /*
          Room above it, in the placement that sits under a sentence.

          `md` is always that one — the gate on each of the three routes — where the placeholder's
          own `gap` alone reads as too tight: an icon, a line of prose and a button spaced identically
          make three items in a list rather than a statement and the thing to do about it. `sm` is the
          calls panel header, where a top margin would push the control out of a band whose height
          `panelShell` has already reserved.

          On the row rather than on the button, so the pair moves together.
        */
        ...(size === 'md' ? { mt: '400' } : {}),
      },
      children: [
        {
          type: 'we-button',
          props: {
            size,
            gap: '200',
            variant: { $: `${IN_A_CALL_HERE} ? 'secondary' : 'primary'` },
            /*
              Three branches, flat, and read at the press.

              `goToCall` used to be the whole of this button, and it has a branch that continues the
              call *in the address* when nothing is running — right for the module rail, where it is
              how you pick up the meeting you are reading, and wrong here: with a call selected in
              the list below, pressing "New call" reopened the selected one.

              `joinCall` rather than `goToCall` for the middle branch, because `goToCall` answers
              "bring me to my call" and this button is asking about *this space*. In a call elsewhere
              with one running here, `goToCall` navigates you away — while the button plainly says
              "Join the call". `joinCall` names the call it means and leaves whatever you were in,
              which is what the word promises.

              Flat `$if` entries rather than nesting, so each condition is one sentence and the
              handler array resolves them lazily — the state at the press, not at the paint that
              happened to be current when the panel opened.
            */
            onClick: [
              { $if: { condition: { $: IN_A_CALL_HERE }, then: { $action: 'modules.call.goToCall' } } },
              {
                $if: {
                  condition: { $: `!(${IN_A_CALL_HERE}) && ${CALL_RUNNING_HERE}` },
                  // The first of them, which is the whole of what a singular button can mean. Which
                  // call, where there are several, is the list's question — see `callsPanel`.
                  then: {
                    $action: 'modules.call.joinCall',
                    args: [{ $: 'first(modules.call.liveCalls).id' }],
                  },
                },
              },
              {
                $if: {
                  condition: { $: `!(${IN_A_CALL_HERE}) && !(${CALL_RUNNING_HERE})` },
                  then: NEW_CALL_ACTION,
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
                  $: `${IN_A_CALL_HERE} ? 'Go to the call' : ${CALL_RUNNING_HERE} ? 'Join the call' : 'New call'`,
                },
              ],
            },
          ],
        },
        newCallButton(size),
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
/**
 * The kinds of part the selected record's entity is offered — a task's Assigned and Reviewing, an
 * event's answers. Declared here, ahead of the field lists that read it.
 */
const PEOPLE_KINDS = `spaceStore.offeredInvolvementTypes.filter(k, ${CARD_TYPE} in k.appliesTo || !count(k.appliesTo))`;

/**
 * Whether a field is one the People section already answers. `assignee` is the name an extraction
 * pass writes because a model cannot know a DID; where the entity has parts people can hold, People
 * shows who is actually on it and quotes that name when nobody is, so the free-text field beside it
 * is the same fact twice — and, empty, an input nobody should type into.
 */
const NOT_PEOPLE_FIELD = `(f.name != 'assignee' || !count(${PEOPLE_KINDS}))`;

const SET_DETAILS = `local.display.fields.filter(f, f.role == 'detail' && f.kind != 'relation' && row[f.name] && ${NOT_PEOPLE_FIELD})`;

/** The same, as controls: everything set, title and summary included, since editing them is the point. */
/**
 * The relations holding something — a sighting's photos, the site it was seen at.
 *
 * Drawn as what they point at rather than as ids (see `linkedRecords`). A to-many holding an empty
 * list is not a row, which is why `many` decides between counting and testing: an empty list is
 * truthy. `WeNode`'s own relations — comments, signals — are not in `display.fields` at all.
 */
const SET_RELATIONS = `local.display.fields.filter(f, f.kind == 'relation' && f.target && (f.many ? count(row[f.name]) : row[f.name]))`;

const SET_FIELDS = `local.display.fields.filter(f, f.kind != 'relation' && row[f.name] && ${NOT_PEOPLE_FIELD})`;

/**
 * The fields holding nothing — what the disclosure offers.
 *
 * Images, files and JSON are excluded along with relations: `fieldEditor` draws no control for any
 * of them (a picture is uploaded, not typed), so counting them would promise rows that expanding
 * does not produce.
 */
const EMPTY_FIELDS = `local.display.fields.filter(f, !(f.kind in ['relation', 'image', 'file', 'json']) && !row[f.name] && ${NOT_PEOPLE_FIELD})`;

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

/**
 * Whether the selected RECORD is a composed document — the header's reading of {@link COMPOSED}.
 *
 * The same question one scope up: `COMPOSED` asks it of the `$each`'s row, and the header has no
 * row, so it asks the query. Both exist because editing a note and editing a task are one control
 * in the header and two different actions underneath — a note's substance is a document and opens
 * in the composer, where a task's is a set of fields and unlocks in place.
 */
const COMPOSED_CARD = 'first(local.card).editorState';

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
              props: { py: '100', borderTop: '1px solid border' },
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
 * The composer below it is opened from the HEADER'S pencil, like every other kind of record — see
 * the note on `aside` in `inspectorPanel`. It used to have a button of its own down here, on the
 * grounds that the header's pencil meant "unlock the declared fields" and a note has none; the cost
 * was that "how do I change this" had two answers depending on what was selected, and the one in
 * the corner was where people looked. It is the same composer the canvas's double-click opens, and
 * it saves through the same reconcile.
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
 * `keepMounted`, so closing it does not unmount a control somebody is halfway through typing into —
 * `fieldEditor` writes on change, so an unmount mid-edit would drop what was typed. Every other
 * folding section here drops its contents, which is the right default and the wrong one for this.
 *
 * The heading is the same row the other sections use, which is a change from the sentence it was:
 * "3 empty fields" said the count in words and left the section unnamed, so the one row in the
 * panel that folded looked unlike the four that now do.
 */
const emptyFields: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: EMPTY_COUNT },
    then: {
      type: 'Column',
      props: { gap: '200' },
      children: [
        foldingSectionLabel({ label: 'Empty fields', count: EMPTY_COUNT, open: { field: 'showEmpty' } }),
        foldingBody({
          open: { field: 'showEmpty' },
          keepMounted: true,
          children: [
            {
              type: 'Column',
              props: { gap: '300', pb: '100' },
              children: [fieldEditor({ $: CARD_TYPE }, { $: 'routeStore.params.card' }, EMPTY_FIELDS)],
            },
          ],
        }),
      ],
    },
  },
};

/** The selected record's id — what the connection queries ask about. */
const CARD_ID = 'routeStore.params.card';

/**
 * What to call the record at one end of a connection, as an expression over that end and its type.
 *
 * The same chain the rest of the panel uses, in the order it can fail. An end that is gone — a card
 * deleted after the line was drawn — reads as that, rather than as a type name that implies there is
 * something to open. Then the model's own title property, then a note's text (a note is a
 * `CollectionBlock` whose substance is its content, so its title is usually empty and three
 * connections to "Note" would say nothing), then the kind's own name as the floor.
 */
function endName(end: string, type: string): string {
  const title = `${end}[recordStore.displays[${type}].title]`;
  return `(!${end} ? 'Removed' : ${title} ? ${title} : ${end}.textContent ? ${end}.textContent : ${kindLabel(type)})`;
}

/**
 * The type of the record at one end: the one stored on the connection, else the one the end reports.
 *
 * Stored first because a writer that recorded it meant it — see `reifiedEdgeFrom`. The fallback is
 * for connections an extraction pass wrote without `sourceType`/`targetType`: the end then arrives
 * hydrated and classified, carrying `__subjectClass`, which is the key the executor writes and the
 * graph reads (`NODE_TYPE_KEY`).
 */
function endType(stored: string, end: string): string {
  return `(${stored} ? ${stored} : ${end}.__subjectClass)`;
}

/**
 * A card's connections, as rows ready to draw — one `map` per step, so each step names what it adds.
 *
 * Chained rather than written as one object, because a comprehension binds one name and every field
 * after the first needs the ones before it: which end is *this* card decides which is the other, and
 * the other decides the name, the icon and where a click goes. A literal inlining all of that would
 * repeat the direction test a dozen times.
 *
 * - **Direction** compares the source end with the selected id. An end arrives as a hydrated record
 *   or as a bare id depending on what the backend could hydrate, so it reads `.id` and falls back to
 *   the value itself — the same tolerance `reverseLookup` has. The parentheses matter: `??` binds more
 *   loosely than `==`.
 * - **The verb** reads from this card's side. Outgoing is the kind's name; incoming is its
 *   `inverseName` where the community gave one — "is blocked by" rather than "blocks" pointing the
 *   wrong way — and a label-only connection, which has no inverse to offer, shows its label and lets
 *   the arrow carry the direction.
 * - **The arrow** is `↔` for a kind declared undirected, and otherwise which way the line runs.
 */
const CONNECTION_ROWS = [
  'local.connections',
  `.map(link, { link: link, out: (link.source.id ?? link.source) == ${CARD_ID} })`,
  '.map(c, { link: c.link, out: c.out, other: c.out ? c.link.target : c.link.source, stored: c.out ? c.link.targetType : c.link.sourceType, kind: find(local.relationshipKinds, { id: c.link.relationshipTypeId }) })',
  `.map(c, { link: c.link, out: c.out, other: c.other, kind: c.kind, type: ${endType('c.stored', 'c.other')} })`,
  [
    '.map(c, { ',
    'id: c.link.id, ',
    'otherId: c.other.id ?? c.other, ',
    'otherType: c.type, ',
    `name: ${endName('c.other', 'c.type')}, `,
    `icon: ${kindIcon('c.type')}, `,
    'verb: c.out ? (c.kind.name ? c.kind.name : c.link.label) : (c.kind.inverseName ? c.kind.inverseName : c.kind.name ? c.kind.name : c.link.label), ',
    "arrow: c.kind.directed == false ? 'arrows-left-right' : c.out ? 'arrow-right' : 'arrow-left', ",
    'tint: c.kind.color',
    ' })',
  ].join(''),
].join('');

/**
 * The two ends of a selected line, as the same kind of row — "From" and "To".
 *
 * Empty until the line's own query answers, so nothing is drawn for a frame from an absent record.
 */
const LINK_END_ROWS = [
  "count(local.link) ? [{ role: 'From', end: first(local.link).source, stored: first(local.link).sourceType }, { role: 'To', end: first(local.link).target, stored: first(local.link).targetType }]",
  `.map(e, { role: e.role, end: e.end, type: ${endType('e.stored', 'e.end')} })`,
  `.map(e, { role: e.role, id: e.end.id ?? e.end, type: e.type, name: ${endName('e.end', 'e.type')}, icon: ${kindIcon('e.type')} })`,
  ' : []',
].join('');

/**
 * Open a record in this panel — by writing the address, which is also what the canvas follows.
 *
 * The parameters rather than a `$setLocal`, because a panel is not inside the route's tree and
 * cannot reach the canvas's locals — the reason the selection travels in the address at all. And
 * writing them is the whole of it: the canvas binds `focus` to the same parameter, so it selects the
 * record and brings it into view, or clears its selection when the record lives somewhere else.
 *
 * Type before id. The panel's query is keyed on both, and each write re-asks it; the order only
 * decides which half-changed pair is asked about for the instant between them, and neither answers.
 */
function openRecord(id: string, type: SchemaProp): SchemaProp[] {
  return [
    { $action: 'routeStore.setParam', args: ['cardType', type] },
    { $action: 'routeStore.setParam', args: ['card', { $: id }] },
  ];
}

/**
 * The part of a row that names the other end and opens it: its kind's glyph and its name.
 *
 * Disabled when the end is gone, which is the one case where there is nothing to open — the row
 * still says the connection exists, and that the thing it pointed at does not.
 */
function endButton(opts: { id: string; type: string; icon: string; name: string; lead: SchemaNode[] }): SchemaNode {
  return {
    type: 'we-button',
    props: {
      variant: 'ghost',
      size: 'sm',
      flex: '1',
      minWidth: '0',
      ax: 'start',
      gap: '200',
      disabled: { $: `!${opts.id}` },
      label: { $: `'Open ' + ${opts.name}` },
      onClick: openRecord(opts.id, { $: opts.type }),
    },
    children: [
      ...opts.lead,
      {
        type: '$if',
        props: {
          condition: { $: opts.icon },
          then: { type: 'we-icon', props: { name: { $: opts.icon }, size: 'xs', color: 'text-muted' } },
        },
      },
      { type: 'we-text', props: { variant: 'footnote', truncate: true, minWidth: '0' }, children: [{ $: opts.name }] },
    ],
  };
}

/**
 * Everything this card is connected to — including what this canvas cannot draw.
 *
 * The canvas draws a line only when both of its ends are placed on it (see the `canvas` seed), which
 * is right for a drawing and leaves the drawing silent about the rest: a task tied to a decision on
 * another call's canvas, or to a record nobody placed, looks unconnected here. This list is the one
 * place on this surface those connections are visible.
 *
 * One query, native on AD4M: a relation key in a `where` compiles to a triple pattern on that
 * relation's predicate, and an `OR` of two such arms to a SPARQL `UNION` — so a card's connections
 * are found by asking, not by reading every connection in the space and filtering. The `include`
 * brings both ends back hydrated, which is where the names and icons come from.
 *
 * Each row opens the other end; the button at its end opens the connection itself, for its label and
 * kind. No delete here — the connection's own panel has one, and so does the delete key.
 */
const cardConnections: SchemaNode = {
  type: 'Column',
  props: { gap: '100' },
  children: [
    foldingSectionLabel({
      label: 'Connections',
      count: 'count(local.connections)',
      open: { field: 'connectionsOpen' },
    }),
    foldingBody({
      open: { field: 'connectionsOpen' },
      children: [
        {
          /*
        Waiting, then counted — the same gate the thread below uses, and for the same reason: an
        unanswered query and an empty one are both `count() == 0`, so a section that tests the count
        alone declares itself empty on its first frame and fills a moment later. The connections
        arrive after the card does, so that frame is visible.
      */
          type: '$if',
          props: {
            condition: { $: 'local.connectionsLoaded' },
            else: {
              type: 'Column',
              props: { gap: '200', py: '100' },
              children: [1, 2].map(() => ({
                type: 'Row',
                props: { gap: '200', ay: 'center' },
                children: [
                  { type: 'we-skeleton', props: { width: '16px', height: '16px', bg: 'control-surface' } },
                  { type: 'we-skeleton', props: { width: '60%', height: '12px', bg: 'control-surface' } },
                ],
              })),
            },
            then: {
              type: '$if',
              props: {
                condition: { $: 'count(local.connections)' },
                then: {
                  type: '$each',
                  props: { items: { $: CONNECTION_ROWS }, as: 'conn' },
                  children: [
                    {
                      type: 'Row',
                      props: { gap: '100', ay: 'center', width: '100%' },
                      children: [
                        endButton({
                          id: 'conn.otherId',
                          type: 'conn.otherType',
                          icon: 'conn.icon',
                          name: 'conn.name',
                          lead: [
                            {
                              type: 'we-icon',
                              props: {
                                name: { $: 'conn.arrow' },
                                size: 'xs',
                                // The kind's own colour, where the community chose one — the same colour its
                                // lines are drawn in on the knowledge map.
                                color: { $: "conn.tint ? conn.tint : 'text-faint'" },
                              },
                            },
                            {
                              type: 'we-text',
                              props: {
                                variant: 'footnote',
                                flexShrink: '0',
                                color: { $: "conn.verb ? 'text-muted' : 'text-faint'" },
                              },
                              children: [{ $: "conn.verb ? conn.verb : 'connected to'" }],
                            },
                          ],
                        }),
                        {
                          type: 'we-tooltip',
                          props: { content: 'Open this connection' },
                          children: [
                            {
                              type: 'we-button',
                              props: {
                                variant: 'ghost',
                                size: 'sm',
                                square: true,
                                flexShrink: '0',
                                label: 'Open this connection',
                                onClick: openRecord('conn.id', 'Relationship'),
                              },
                              children: [{ type: 'we-icon', props: { name: 'line-segment', color: 'text-faint' } }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                /*
          Nothing yet — and said as what to do.

          The connect handles appear on a selected card's edges and nowhere else, so the gesture is
          easy to miss; this is the moment somebody is looking at a selected card and wondering.

          No `Loaded` check of its own any more: the gate above only reaches here once the query has
          answered, where before this was the only thing standing between a card and the claim that
          it was connected to nothing.
        */
                else: {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-faint' },
                  children: ['Not connected to anything yet. Drag from one of its edges to another card.'],
                },
              },
            },
          },
        },
      ],
    }),
  ],
};

/**
 * What a selected line joins — its two ends, each opening that record.
 *
 * The create modal used to say "Post → Sighting" above the label field; with connections written on
 * the drop, the inspector is where a line is read, and it said what the line *was* without saying
 * what it connected.
 */
const linkEnds: SchemaNode = {
  type: 'Column',
  props: { gap: '100' },
  children: [
    foldingSectionLabel({ label: 'Connects', open: { field: 'connectsOpen' } }),
    foldingBody({
      open: { field: 'connectsOpen' },
      children: [
        {
          type: '$each',
          props: { items: { $: LINK_END_ROWS }, as: 'end' },
          children: [
            endButton({
              id: 'end.id',
              type: 'end.type',
              icon: 'end.icon',
              name: 'end.name',
              lead: [
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-faint', flexShrink: '0', minWidth: '2.5em' },
                  children: [{ $: 'end.role' }],
                },
              ],
            }),
          ],
        },
      ],
    }),
  ],
};

/** Who is on the record in the inspector — the `involvement` host function over the panel's own query. */
const ON_ROW =
  'involvement({ rows: local.involvements, types: spaceStore.involvementTypes, me: me.did }).byNode[row.id]';

/** The kinds of part this record's entity is offered — a task's Assigned and Reviewing, an event's answers. */
const ROW_KINDS = PEOPLE_KINDS;

/**
 * Everyone on the selected record, by part, by name — the detail view a card's faces stand in for.
 *
 * A card has room for three faces and a hovercard; this is where every part is read at once and each
 * person is named without hovering. Grouped by kind in the community's words, each person with the
 * face and ring the card gives them. The picker is the card's own (`involvementMenu`), so the two
 * cannot offer different choices; an × takes somebody off a part anybody may give, and your own
 * answer to an event is withdrawn the same way — nobody else's.
 *
 * Shown only for an entity somebody can be on, which is every entity a kind applies to. Where the
 * record came from is not here — see `originLine`, which is about the record rather than its people.
 */
const peopleSection: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: `!(${IS_RELATIONSHIP}) && count(${ROW_KINDS})` },
    then: {
      type: 'Column',
      // The same gap under the caption as Connections has; the parts below keep a wider one.
      props: { gap: '100' },
      children: [
        foldingSectionLabel({
          label: 'People',
          count: `count(${ON_ROW}.people)`,
          open: { field: 'peopleOpen' },
          /*
            `xs`, which is the size a section heading's aside is.

            It was `sm` — the size of the pencil and the bin in the panel's header — and a heading
            is not the header: the kit reserves `--we-component-height-xs` for a heading's aside
            precisely because they are the small end of the set, an xs button, a switch, a badge. At
            `sm` this row came out 32px against everything else's 24, and since the row centres its
            contents, "People" sat lower than the four names around it.

            It used to wear a `height: '1lh'` wrapper meant to stop exactly that, and the wrapper
            did not work: the button overflowed it and the row grew anyway. Measured, not guessed —
            see the `section headings agree` case.
          */
          action: {
            type: '$if',
            props: {
              // An event's answers have their own buttons on the calendar; the picker is for parts
              // one member gives another, and an entity with none of those has nothing to pick.
              condition: { $: `count(${ROW_KINDS}.filter(k, !k.reflexive))` },
              then: {
                type: 'DropdownMenu',
                props: {
                  triggerIcon: 'user-plus',
                  triggerTitle: 'Who is on this',
                  triggerVariant: 'ghost',
                  size: 'xs',
                  itemSize: 'sm',
                  placement: 'bottom-end',
                  searchable: true,
                  searchPlaceholder: 'Find a member',
                  items: {
                    $: `involvementMenu({ node: row.id, entity: ${CARD_TYPE}, rows: local.involvements, types: spaceStore.offeredInvolvementTypes, members: spaceStore.members, profiles: profileStore.profiles, me: me.did, said: row.assignee })`,
                  },
                  onSelect: {
                    $action: 'spaceStore.setInvolvement',
                    args: [{ $: 'row.id' }, { $: 'arg.id' }, { $: 'arg.kind' }, { $: '!arg.checked' }],
                  },
                },
              },
            },
          },
        }),
        foldingBody({
          open: { field: 'peopleOpen' },
          children: [
            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                {
                  type: '$each',
                  props: {
                    items: { $: `${ROW_KINDS}.filter(k, count(${ON_ROW}.people.filter(p, p.kind == k.slug)))` },
                    as: 'part',
                  },
                  children: [
                    {
                      type: 'Column',
                      props: { gap: '100' },
                      children: [
                        {
                          type: 'we-text',
                          props: { variant: 'footnote', color: 'text-muted', text: { $: 'part.name' } },
                        },
                        {
                          type: '$each',
                          props: { items: { $: `${ON_ROW}.people.filter(p, p.kind == part.slug)` }, as: 'holder' },
                          children: [
                            {
                              type: 'Row',
                              props: { gap: '200', ay: 'center', width: '100%' },
                              children: [
                                {
                                  type: 'AvatarStack',
                                  props: {
                                    size: 'xs',
                                    avatars: {
                                      $: '[{ image: find(profileStore.profiles, { did: holder.did }).avatar, hash: holder.did, tone: holder.tone }]',
                                    },
                                  },
                                },
                                {
                                  type: 'we-text',
                                  props: {
                                    fontSize: '200',
                                    flex: '1',
                                    minWidth: '0',
                                    truncate: true,
                                    text: {
                                      $: "holder.did == me.did ? find(profileStore.profiles, { did: holder.did }).name + ' (you)' : find(profileStore.profiles, { did: holder.did }).name",
                                    },
                                  },
                                },
                                {
                                  type: '$if',
                                  props: {
                                    // Anybody may take somebody off an assignment; only you may withdraw your own answer.
                                    condition: { $: '!holder.reflexive || holder.did == me.did' },
                                    then: {
                                      type: 'we-tooltip',
                                      props: {
                                        content: {
                                          $: "holder.reflexive ? 'Withdraw your answer' : 'Take them off this'",
                                        },
                                      },
                                      children: [
                                        {
                                          type: 'we-button',
                                          props: {
                                            variant: 'ghost',
                                            size: 'xs',
                                            square: true,
                                            label: {
                                              $: "holder.reflexive ? 'Withdraw your answer' : 'Take them off this'",
                                            },
                                            onClick: {
                                              $if: {
                                                condition: { $: 'holder.reflexive' },
                                                then: { $action: 'spaceStore.respondTo', args: [{ $: 'row.id' }, ''] },
                                                else: {
                                                  $action: 'spaceStore.setInvolvement',
                                                  args: [
                                                    { $: 'row.id' },
                                                    { $: 'holder.did' },
                                                    { $: 'holder.kind' },
                                                    false,
                                                  ],
                                                },
                                              },
                                            },
                                          },
                                          children: [{ type: 'we-icon', props: { name: 'x', color: 'text-faint' } }],
                                        },
                                      ],
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
                {
                  type: '$if',
                  props: {
                    condition: { $: `!count(${ON_ROW}.people)` },
                    then: {
                      type: 'we-text',
                      props: {
                        variant: 'footnote',
                        color: 'text-faint',
                        text: {
                          $: "row.assignee ? `Nobody yet — the conversation named “${row.assignee}”.` : 'Nobody is on this yet.'",
                        },
                      },
                    },
                  },
                },
              ],
            },
          ],
        }),
      ],
    },
  },
};

/**
 * Where the selected record came from — extracted from the conversation, and on whose node, or added
 * by somebody — and when.
 *
 * Straight under the title and the description, and not the last line of People: it is about the
 * record, not about who is on it, and on a card it lives on the extracted mark for the same reason.
 * Near the top because it is the context the rest of the panel is read in. A line joining two cards
 * has no origin worth a sentence, so it is not asked.
 */
const originLine: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: `!(${IS_RELATIONSHIP})` },
    then: {
      /*
        The panel's width, stated. Without it this shrink-wraps, and the sentence — `flex: 1`, so a
        basis of zero — is sized to its narrowest unbreakable piece, which is the timestamp: "Added
        by you ·" fitted in that and the time went to a line of its own however wide the panel was.
      */
      type: 'Column',
      props: { width: '100%' },
      children: [
        {
          type: '$agent',
          props: { did: { $: 'row.author' }, as: 'author' },
          children: [
            /*
              The glyph beside one run of text, which wraps at words.

              It was three flex items in a wrapping row — the glyph, the whole sentence, the time — so
              a narrow panel wrapped *items*: the sentence dropped under the glyph as one block, and
              the time under that. One text holding the time inline lets the browser break between
              words, and the glyph sits in a box one line tall so it centres on the first line
              whatever the theme's type scale is.
            */
            {
              type: 'Row',
              props: { gap: '100', ay: 'start', width: '100%' },
              children: [
                {
                  type: 'Row',
                  props: { fontSize: '100', height: '1lh', ay: 'center', flexShrink: '0' },
                  children: [
                    {
                      type: 'we-icon',
                      props: {
                        name: {
                          $: "row.id in first(local.inspectedCall).extracted ? 'sparkle' : 'pencil-simple-line'",
                        },
                        size: 'xs',
                        color: 'text-faint',
                      },
                    },
                  ],
                },
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-faint', flex: '1', minWidth: '0' },
                  children: [
                    {
                      $: "row.id in first(local.inspectedCall).extracted ? `Extracted from the conversation · run by ${author.name} · ` : `Added by ${author.did == me.did ? 'you' : author.name} · `",
                    },
                    { type: 'we-timestamp', props: { value: { $: 'row.createdAt' }, relative: true, fontSize: '100' } },
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
 * Whether a reply here may itself be replied to — the community's answer, in Settings → Features.
 *
 * Anything but the stored `'flat'` reads as branching, so a space that predates the setting behaves
 * exactly as it did. The test is on the value rather than on its absence because `!=` over an
 * unbound value is the trap this codebase keeps rediscovering; here it is client-side and safe, and
 * written positively so the reading is the same either way.
 */
const FRACTAL_THREADS = "spaceStore.currentSpace.threadMode != 'flat'";

/** The connection section for whatever is selected — a card's connections, or a line's two ends. */
const connectionsSection: SchemaNode = {
  type: '$if',
  props: { condition: { $: IS_RELATIONSHIP }, then: linkEnds, else: cardConnections },
};

/**
 * What people make of the selected record — its reactions, and the conversation about it.
 *
 * ## Why here rather than on the cards
 *
 * Because a canvas card is clipped and a board card is dragged. Both are previews the size of a
 * postcard, and a row of controls on each is furniture competing with the gesture the card exists
 * for — so the cards carry counts (`signalDisplay` at `compact`) and the panel carries the controls,
 * is the whole reason this panel is worth opening: it already shows every field a record holds, and
 * what the community *thinks* of the record is the part it was missing.
 *
 * ## A line gets both, exactly as a card does
 *
 * A `Relationship` is a `WeNode`, so nothing here is written twice: the same section reacts to a
 * task and to the claim that the task blocks another one. `EdgeDetail` in the views package is the
 * older surface for that and keeps its own modal; this is the canvas's answer, where opening a line
 * must not take you off the arrangement it is part of.
 */
const reactionsSection: SchemaNode = {
  type: 'Column',
  /*
    More room under this heading than the others have.

    A section whose body is prose or a list of rows starts below its heading and reads as one
    block. This one starts with a CONTROL, and a control sitting a hundred under a heading reads as
    belonging to it — as though the heading were its label rather than the section's name.
  */
  props: { gap: '300', width: '100%' },
  children: [
    foldingSectionLabel({
      label: 'Signals',
      count: 'signalTally({ signals: row.signals })',
      open: { field: 'reactionsOpen' },
      /*
        The plus goes here, beside the count, where every other per-section control in this panel
        sits — not at the foot of the list as a full-width button.

        A reaction type is a thing about the SECTION rather than about any reaction in it, and a
        button under the last type reads as belonging to that type. The list keeps rendering the
        form, from the flag declared on the panel; this only opens it.
      */
      action: newSignalTypeButton({ open: 'newSignalTypeOpen' }),
    }),
    foldingBody({
      open: { field: 'reactionsOpen' },
      children: [
        signalDisplay({
          record: 'row',
          /*
            The middle step.

            `md` is the size a control is on a page rather than in a 320px column; `xs` is the size
            it is on a card, among a row of marks, and in a panel somebody opened deliberately it
            read as too small to aim at. At `sm` every mode comes out one line tall — a toggle, a
            rating, a vote and a slider all 24px — which is also what lets each control sit on the
            same line as the name beside it.
          */
          size: 'sm',
          // The plus is in the section's heading, so the list draws none of its own. The form is
          // still this fragment's, bound to the flag the panel declares.
          newTypeOpen: 'newSignalTypeOpen',
          /*
        A space arrives with no reactions at all — nothing seeds a heart on a community's behalf, and
        that is the design rather than an omission. Without this the section was a caption over empty
        space, which reads as something failing to load; the line is also the only place anybody
        would learn that a space names its own.
      */
          empty: emptyNote('No reactions here yet — a space names its own in Settings → Vocabulary.'),
        }),
      ],
    }),
  ],
};

/**
 * The whole conversation, counted — not the top of it.
 *
 * `count(row.comments)` is the first level only: a thread of one reply carrying nine answers reads
 * "1", and a caption over a conversation should count the conversation.
 *
 * This used to add up the three levels the panel draws, by hand, because a subtree could not be
 * walked — each level was another hop, so a true descendant total was not expressible at any price
 * and the number was right only as far down as it had been written. `$descendants` is a transitive
 * count projection: one number, every level, no extra query. It falls back to the record's own
 * count where the backend cannot walk a path, which reads low rather than wrong.
 */
const REPLY_TOTAL = 'first(local.card).$descendants ?? count(row.comments)';

/** The thread, and the way into it. */
const discussion: SchemaNode = {
  type: 'Column',
  props: { gap: '200', width: '100%' },
  children: [
    foldingSectionLabel({ label: 'Discussion', count: REPLY_TOTAL, open: { field: 'discussionOpen' } }),
    foldingBody({
      open: { field: 'discussionOpen' },
      children: [
        /*
      No depth or breadth of its own: the kit's [10, 5, 3] at three levels.

      Three is right for THIS surface and the reason is arithmetic. Each level costs the gutter and
      its gap — 32px — and the panel is 320px wide, so six levels would spend nearly two thirds of
      the width on indent before a word is drawn. Depth past three is reached by re-rooting, which
      gives the branch the top level's whole budget and is a better place to read it from anyway.

      Said by saying nothing, so the number lives in one place. A template that restates a default
      is a template that stops following it.
    */
        discussionSection({ record: 'row', fractal: FRACTAL_THREADS }),
      ],
    }),
  ],
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
 * A relation that holds something is a row of its own, after the fields: the photos a sighting was
 * given, the site it names — drawn as what they point at by `linkedRecords`, which looks the records
 * up by the ids the relation holds. `WeNode`'s own relations (comments, signals, mentions) are not
 * fields of anything and are not listed; nor is an untyped one like a collection's `children`,
 * which says no model to look its members up as. Relations are read-only here: writing one is the
 * create form's, and what a card is *connected* to by a drawn line is the connections section.
 */
const inspectorPanel: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%', p: '300', gap: '300', overflow: 'hidden' },
  /*
    Whether the fields are controls or values — the pencil in the header. Ephemeral and per panel:
    it is a mode of looking, not a fact about the record, and it drops when the panel is rebuilt.

    `noteOpen` is the other half of that same pencil, for a record whose substance is a document.
    Declared HERE rather than inside the `$each` — where it used to sit, with the button that opened
    it — because the header is outside the loop and a `$setLocal` only reaches a field an ancestor
    of the BUTTON declared. It loses the per-record reset the inner scope gave it, which costs
    nothing: the composer is modal, so the selection cannot change under it, and every way out of it
    sets the flag false.
  */
  $localState: {
    editing: { type: 'boolean', initial: false },
    noteOpen: { type: 'boolean', initial: false },
    /*
      Which sections are open — kept on the device, not in the URL.

      A preference rather than view state: somebody who works from Connections and never opens
      Discussion should find it that way tomorrow, and a link they send should not impose their
      folding on the person who opens it. The extraction panel keeps its sections the same way.

      Per panel rather than per record, which is the same decision: it is a way of working, not a
      fact about the card.

      CLOSED to begin with. The fields are the record, and the five sections are all things *about*
      it — who is on it, what it is joined to, what people made of it, what was said. Opened, they
      push the record's own properties off a 320px panel before a reader has decided they want any
      of them; closed, each is one line saying what is there and how much, which is the question
      most visits are answering.

      The keys carry `Section` because an earlier version of this defaulted them open, and anybody
      who has looked at the panel since then has `true` sitting in their device storage: a stored
      preference outranks the declaration, so keeping the old keys would mean shipping a default
      nobody who had already opened the inspector would ever see.
    */
    // Opened from the Signals heading, and read by the form `signalDisplay` renders — so it is
    // declared above both of them.
    newSignalTypeOpen: { type: 'boolean', initial: false },
    connectionsOpen: { type: 'boolean', initial: false, persist: 'inspector.connectionsSection' },
    connectsOpen: { type: 'boolean', initial: false, persist: 'inspector.connectsSection' },
    peopleOpen: { type: 'boolean', initial: false, persist: 'inspector.peopleSection' },
    reactionsOpen: { type: 'boolean', initial: false, persist: 'inspector.reactionsSection' },
    discussionOpen: { type: 'boolean', initial: false, persist: 'inspector.discussionSection' },
  },
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
        The reactions, hydrated — what `signalDisplay` filters by type.

        Safe for a type this template was not written for, which is the question worth asking of an
        `include` on a query whose entity is an expression: every model a community defines extends
        `WeNode` (see `shapeDraft`), so `signals` is declared on all of them. A model made before
        that was true declares no such relation and the query would be refused outright rather than
        answering without it — it becomes a node again the next time it is edited.
      */
      include: {
        signals: true,
        /*
          The whole conversation under this card, as one number.

          A count projection is already asked of every row at once and already grouped per row, so
          `transitive` costs one character in the emitted path and no extra round trip. Without it
          this is the direct replies only, which is not what a reader takes "42 replies" to mean.
        */
        $descendants: { from: 'comments', count: true, transitive: true },
      },
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
    /*
      Every connection this card is at either end of — see `cardConnections`.

      Gated on the selection being a card: a line's own connections are a different question, and
      `link` below answers the one that matters for a line. Ordered by when each was made, which is
      the one order the backend can give that stays still as connections are added.
    */
    connections: {
      entity: 'Relationship',
      where: { OR: [{ source: { $: CARD_ID } }, { target: { $: CARD_ID } }] },
      include: { source: true, target: true },
      order: { createdAt: 'asc' },
      limit: 50,
      when: { $: `${CARD_ID} && !(${IS_RELATIONSHIP})` },
    },
    /*
      The selected line with its two ends hydrated — see `linkEnds`.

      Its own query rather than an `include` on `card`, because `card` asks for whatever type is
      selected and an `include` naming `source` on a task would name a relation tasks do not have.
    */
    link: {
      entity: 'Relationship',
      where: { id: { $: CARD_ID } },
      include: { source: true, target: true },
      limit: 1,
      when: { $: `${CARD_ID} && ${IS_RELATIONSHIP}` },
    },
    /*
      Who is on the selected record — see `peopleSection`. Space-wide, for the board's reason: an
      involvement is not a child of anything. Not asked for a line, which has nobody on it.
    */
    involvements: { entity: 'Involvement', when: { $: `${CARD_ID} && !(${IS_RELATIONSHIP})` } },
    // The call's own record, for which of its records a model proposed — see `peopleSection`.
    inspectedCall: { entity: 'CollectionBlock', where: { id: CALL }, limit: 1, when: CALL },
    /*
      What this community reacts with — one subscription for the panel, read by the controls below
      and by the counts on every reply in the thread.

      Unconditional, like `relationshipKinds` and for the same reason: a space has a handful of
      these, and gating it on something about the selection would tear the subscription down and set
      it up again on every click to save nothing.
    */
    signalTypes: { entity: 'SignalType', subscribe: true },
  },
  children: [
    panelHeader({
      title: 'Inspector',
      /*
        Edit, in the header where a mode belongs, for every kind of record the panel can open.

        One control, two things underneath, and that is the point. A record whose substance is a set
        of FIELDS unlocks in place: the inspector already shows every value it has, so it is the
        surface that edits them and a separate form would show the same rows a second time. A
        composed document — a note — has no fields to unlock; its substance is a document, and it
        opens in the composer.

        It used to be one control and a half. The pencil was gated on the model declaring an
        editable field, so a note never had one, and its own "Edit note" button sat under the
        content instead — which meant "how do I change this" had two answers depending on what you
        had selected, and the one in the corner was the one people looked for first. A note is now
        edited from the same place as everything else, and the button below it is gone.

        Lit while the field mode is on; a note's press opens a modal, so there is no lasting state
        for it to show.
      */
      aside: {
        type: 'Row',
        props: { gap: '100', ay: 'center' },
        children: [
          {
            type: '$if',
            props: {
              condition: { $: `count(local.card) && (${HAS_EDITABLE_FIELDS} || ${COMPOSED_CARD})` },
              then: {
                type: 'we-tooltip',
                props: {
                  content: {
                    $: `${COMPOSED_CARD} ? 'Edit this note' : (local.editing ? 'Done editing' : 'Edit this record')`,
                  },
                },
                children: [
                  {
                    type: 'we-button',
                    props: {
                      size: 'sm',
                      square: true,
                      variant: { $: `!(${COMPOSED_CARD}) && local.editing ? 'secondary' : 'ghost'` },
                      onClick: {
                        $if: {
                          condition: { $: COMPOSED_CARD },
                          then: { $setLocal: 'noteOpen', value: true },
                          else: { $toggleLocal: 'editing' },
                        },
                      },
                    },
                    children: [
                      {
                        type: 'we-icon',
                        props: { name: { $: `!(${COMPOSED_CARD}) && local.editing ? 'check' : 'pencil-simple'` } },
                      },
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
                  /*
                    The gap the extraction panel sets its sections apart with, and no rules between
                    them.

                    Each section drew a line above itself, which was the separation when a heading
                    was a caption and a section was a caption with rows under it. They fold now, so
                    every one already has a heading that reads as a heading — and six rules on a
                    panel 320px wide is a lot of horizontal ink for a job the space between them
                    does.
                  */
                  props: { gap: '400' },
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
                      What extraction is waiting on for this record, above what the record says.

                      A draft — a record a pass made — is answered with Keep or Discard, as on its
                      card. An agreed record with a change suggested is answered here field by field,
                      old → new: the canvas card is a clipped preview with no room to read a change,
                      so its "Review suggested change" opens this. Nothing at all for a record with
                      nothing staged.
                    */
                    {
                      type: '$if',
                      props: {
                        condition: { $: `row.id in ${UNCONFIRMED}` },
                        then: {
                          type: 'Row',
                          props: {
                            gap: '200',
                            ay: 'center',
                            width: '100%',
                            p: '200',
                            r: '300',
                            border: '1px dashed border-strong',
                          },
                          children: [
                            {
                              type: 'we-text',
                              props: { fontSize: '200', color: 'text-muted', flex: '1', minWidth: '0' },
                              children: ['Extraction proposed this — pending acceptance.'],
                            },
                            answerButton({
                              tone: 'success',
                              label: 'Accept',
                              onClick: { $action: 'modules.transcribe.acceptProposal', args: [{ $: 'row.id' }] },
                            }),
                            answerButton({
                              tone: 'danger',
                              label: 'Reject — removes it',
                              onClick: { $action: 'modules.transcribe.rejectProposal', args: [{ $: 'row.id' }] },
                            }),
                          ],
                        },
                      },
                    },
                    suggestedChanges({ record: 'row', collapseAfter: 6 }),
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
                            // Where it came from, straight under what it is — see `originLine`.
                            originLine,
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
                                  props: { py: '100', borderTop: '1px solid border' },
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
                            {
                              type: '$each',
                              props: { items: { $: SET_RELATIONS }, as: 'field' },
                              children: [
                                {
                                  type: 'Column',
                                  props: { gap: '100', py: '100', borderTop: '1px solid border', width: '100%' },
                                  children: [
                                    {
                                      type: 'we-text',
                                      props: { variant: 'footnote', color: 'text-faint' },
                                      children: [{ $: 'field.label' }],
                                    },
                                    linkedRecords({ record: 'row', field: 'field' }),
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
                    // After the record's own fields and before its connections: who is on this record
                    // is about the record, and connections are about other records.
                    peopleSection,
                    // After the disclosure: that is about this record's own fields, and connections
                    // are about other records.
                    connectionsSection,
                    // Last, and in this order: what the record *is* comes first, then who is on it
                    // and what it is joined to, then what people make of it. The thread is last
                    // because it is the only section with no ceiling on its height.
                    reactionsSection,
                    discussion,
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
 * The live call one row of the calls list *is*, or nothing — that row's own entry in `liveCalls`.
 *
 * By `recordId`, because that is what a row is: a call's record. `liveCalls` is keyed by call id,
 * which is derived from the record rather than equal to it.
 */
const ROW_LIVE_CALL = 'find(modules.call.liveCalls, { recordId: call.id })';

/** That row is the call this agent is in. */
const ROW_IS_MINE = 'call.id == modules.call.callRecordId';

/**
 * The calls, as a panel — how you change which call every other surface is about.
 *
 * The same list the `/calls` route draws, without the transcripts: choosing is a two-second act and
 * a panel that made you scroll past a meeting to reach the one below it would not be a switcher.
 *
 * Declared with no `route`, so it is reachable from the kanban as well. Selection is a
 * *navigation* — `./canvas/<id>` — which is what makes it survive a reload and paste into a message.
 *
 * ## It says which of them are happening now
 *
 * The list is a query over `CollectionBlock` — the archive — and for a while that was all it was, so
 * a meeting three people were sitting in looked exactly like one from last Tuesday. That is a gap
 * the header's single button cannot cover: with two calls running, "Join the call" joins whichever
 * `liveCalls` happens to list first, and nothing on screen says there was a choice.
 *
 * So a row that is live says so and carries its own Join. The header keeps the one-press default for
 * the ordinary case — one conversation, join it — and the list is where "which one" is answered,
 * which is the same argument the call module makes for listing a row per call in its own join bar.
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
                                /*
                                  The fill role, for the reason the record icon above uses it: a
                                  live-call marker is a signal rather than a sentence, and the
                                  derived foreground goes pale in a dark theme.

                                  Red for any call that is happening, not only this agent's. It was
                                  `callRecordId`, which marked the one call you were in and left a
                                  meeting two colleagues were sitting in looking like last Tuesday's.
                                  Which of them is *yours* is said twice over beside it — the row's
                                  selected fill, and a button that says "Go to" rather than "Join".
                                */
                                color: { $: `${ROW_LIVE_CALL} ? 'danger' : 'text-faint'` },
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
                          /*
                            Who is in this call, and the way in — on the rows where there is one.

                            The panel's whole job is choosing which call every other surface is
                            about, and until now choosing was all it could do: a live meeting was
                            selectable and not joinable, so the only way in was the header's button,
                            which is singular and therefore a guess the moment two calls are running.
                            A row names the call it means, which is what makes this the right place
                            for the choice rather than a second copy of the header.

                            Absent rather than disabled on a finished call: there is nothing to join,
                            and picking one back up is what the pill's `call.continueCallButton` is
                            for — a different act, with a different warning attached to it.
                          */
                          type: '$if',
                          props: {
                            condition: { $: ROW_LIVE_CALL },
                            then: {
                              type: 'Row',
                              props: { gap: '100', ay: 'center', flexShrink: '0' },
                              children: [
                                {
                                  // Faces rather than a count: three avatars say "a meeting is
                                  // happening and these are the people in it" in the width a number
                                  // and a noun would take. The stack carries its own "+N" past `max`.
                                  type: 'AvatarStack',
                                  props: { avatars: { $: `${ROW_LIVE_CALL}.faces` }, size: 'xs', max: 3 },
                                },
                                {
                                  type: 'we-tooltip',
                                  props: {
                                    content: {
                                      $:
                                        `${ROW_IS_MINE} ? 'Go to this call' : ` +
                                        `modules.call.active ? 'Leave your call and join this one' : 'Join this call'`,
                                    },
                                    placement: 'top',
                                  },
                                  children: [
                                    {
                                      type: 'we-button',
                                      props: {
                                        size: 'sm',
                                        variant: { $: `${ROW_IS_MINE} ? 'secondary' : 'primary'` },
                                        /*
                                          Branched at the press, and `joinCall` rather than
                                          `goToCall` for the row that is not yours.

                                          `goToCall` means "bring me to my call", so pressed on
                                          somebody else's row while in a call of your own it would
                                          take you to *yours* — a button beside one conversation
                                          doing something about another. `joinCall` names the id the
                                          row carries and leaves whatever you were in, which is what
                                          the word on it promises.
                                        */
                                        onClick: [
                                          {
                                            $if: {
                                              condition: { $: ROW_IS_MINE },
                                              then: { $action: 'modules.call.goToCall' },
                                            },
                                          },
                                          {
                                            $if: {
                                              condition: { $: `!(${ROW_IS_MINE})` },
                                              then: {
                                                $action: 'modules.call.joinCall',
                                                args: [{ $: `${ROW_LIVE_CALL}.id` }],
                                              },
                                            },
                                          },
                                          // And point every other surface at it, which is what
                                          // clicking the row itself would have done.
                                          openCall('call.id'),
                                        ],
                                      },
                                      children: [{ $: `${ROW_IS_MINE} ? 'Go to' : 'Join'` }],
                                    },
                                  ],
                                },
                              ],
                            },
                          },
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

          The store's lists are unions across calls, and ask the question the marker actually means. The panel's
          review list stays keyed, because "which decisions am I being asked for" *is* about a
          conversation.
        */
        pending: { $: UNCONFIRMED },
        /*
          The two kinds of suggestion, told apart — see `suggestions.ts` in the template kit. `pending`
          is a record a pass made and nobody has kept, which is provisional and faded; `changed` is an
          agreed record carrying a suggested edit, which is settled and only marked. They were one
          list, so an agreed card a pass had an opinion about was faded like a draft.
        */
        changed: { $: CHANGED },
        // Put away while the reader hides suggestions — the switch in the key, shared with the board
        // and the calendar through the address. Changed records are never hidden.
        hidden: { $: `(${SUGGESTIONS_HIDDEN}) ? ${UNCONFIRMED} : []` },
        // Kinds the reader put away from the key's eye — every card of each, and the lines to them.
        hiddenTypes: { $: HIDDEN_KINDS },
        /*
          How many reactions and replies each card has collected, as two numbers on its footer.

          The counts ride in the reads the seed already makes — one projection each, no extra round
          trip and no subscription per card, which is what a canvas of three hundred things needs.
          The breakdown by type and the controls are the inspector's, one press away: a card here is
          a preview inside an arrangement, and what it owes the reader is that there is something to
          open.
        */
        counts: ['signals', 'comments'],
      },
    },
    // Nothing opens automatically: a card's own blocks are fragments of it, not more cards.
    expansion: { defaultDepth: 0 },
    /*
      A card's size, so a card nobody has placed is parked in a slot it fits — the default slot was
      narrower than a card, which is why new suggestions arrived overlapping — and clear of the cards
      already on the canvas, including one somebody resized.
    */
    layout: {
      type: 'manual',
      options: { size: { width: 180, height: 135 }, widthField: 'canvasWidth', heightField: 'canvasHeight' },
    },
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
          // `record` rather than `block`: a note draws its document either way, and a task, an event
          // or a community's own model draws what kind of thing it is and every value it holds,
          // where `block` drew only its name — a canvas beside a live call is read card by card.
          content: 'record',
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
          // Which card is in front where two overlap — a fact about the arrangement, like its size.
          z: { from: 'data.canvasZ' },
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
      // Dashed as well as faded, as a draft is on the board and in the key: the fade alone read as a
      // card with a pale colour rather than as one waiting on somebody.
      {
        when: { 'data.pending': true },
        style: { opacity: 0.5, borderStyle: 'dashed', borderColor: 'border-strong', borderWidth: 2 },
      },
      /*
        An agreed card with a change suggested: full strength, and an amber edge. Not faded — the
        record is not in doubt, only the change is, and the change is read in the inspector. Amber
        rather than the accent, which is what a *selected* card wears: the two would be one outline.
      */
      { when: { 'data.changed': true }, style: { borderColor: 'warning-text', borderWidth: 2 } },
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
    edgeStyle: [
      { style: { curve: 'smooth', arrow: 'target', width: 2, showLabel: true, color: { $: LINK_FILL } } },
      /*
        The line a fold leaves behind, where what it hid was connected to something still on screen.

        Dashed and thicker, with the count it stands for as its label — the graph mints one per
        surviving neighbour and labels it with the weight. It has to look unlike a connection
        somebody drew, because it is not one: it summarises several, nothing opens when it is
        clicked, and drawing it in the same ink would make the canvas assert a relationship nobody
        asserted. Same colour, so it still reads as part of this canvas's vocabulary.
      */
      {
        when: { type: 'fold-bundle' },
        style: { curve: 'straight', arrow: 'target', width: 3, dashed: true, showLabel: true, color: { $: LINK_FILL } },
      },
    ],
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

      `CALL_EXPR` parenthesised, because it is a ternary itself and a ternary binds to the right:
      pasted in bare, a chosen call short-circuited the whole thing and the canvas "said" the call's
      `ad4m://` id. And naming both ways a card arrives, because a past call is read here too — one
      whose conversation is over, where "as the conversation produces them" is only half the answer.
    */
    empty: {
      $: `(${CALL_EXPR}) ? 'Nothing on this canvas yet. Double-click anywhere to add a card, or give extraction a moment — what the conversation commits to appears here on its own.' : 'Start or choose a call. What it produces appears here as cards you can move and join up.'`,
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
      The selection, followed — so the canvas agrees with the inspector about what is open.

      A click on the canvas writes `card`; so does a row in the inspector's connections, a line just
      drawn, and a link somebody sent. Before this only the first moved the canvas, so the panel could
      open a card while the canvas went on ringing a different one somewhere off screen. Bound to the
      address rather than to `local.inspecting` because the panel writes the address and cannot reach
      the local — see `openRecord`.

      Safe to bind to the value a click just wrote: the graph leaves an already-selected card alone
      and only moves the camera for something out of view, so clicking a card you can see does
      nothing more than it did. A record not on this canvas clears the selection rather than leaving
      the last one lit.
    */
    focus: { $: 'routeStore.params.card' },
    /*
      The folded cards, from the address — and the press that folds one, back into it.

      A fold takes everything connected out from a card off the canvas: a call's board produces a
      task with three notes hanging off it and six related tasks, and after twenty minutes of
      conversation the arrangement is unreadable without being able to put a cluster away. Held in
      the address rather than on the placement, and that is the decision worth knowing: a fold is
      *this reader's* view of a shared canvas, so folding is not something you do to everybody in the
      call — and it travels in a link, so the canvas somebody sent you arrives tidied the way they
      tidied it. See `FOLD_PARAM`.

      The count stays on the card, and the key carries the total with a way to undo all of it, since
      a canvas pans and the fold holding what you are looking for is routinely off screen.
    */
    folded: { $: FOLDED_CARDS },
    onNodeFold: FOLD_FROM_GRAPH,
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
      `onEdgeClick` keeps for a line with nothing behind it. And through `focus` below, the line is
      selected on the canvas too, as soon as the canvas has re-read and drawn it.
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
    /*
      `dragOnCanvas` rather than `placeOnCanvas`, because a fold travels with its contents.

      The whole payload rather than four values picked out of it: a folded card arrives carrying a
      placement for each card hidden under it, and a schema cannot loop over a list whose length it
      does not know — `$action` calls a method once. Without it, folding a cluster and carrying it
      into a corner would scatter everything back where it was the moment you unfolded, which makes
      a fold a way of hiding things rather than of tidying them.
    */
    onNodeDragEnd: { $action: 'recordStore.dragOnCanvas', args: [CALL, { $: 'event' }] },
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
    onCanvasDoubleClick: askWhatGoesHere(CALL),
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
      { id: 'accept', icon: 'check', title: 'Accept', when: { 'data.pending': true }, tone: 'positive' },
      { id: 'reject', icon: 'x', title: 'Reject', when: { 'data.pending': true }, tone: 'danger' },
      /*
        A suggested change is answered in the inspector, where there is room to read old → new — a card
        on a canvas is a clipped preview. This opens it on the card.
      */
      { id: 'review', icon: 'pencil-simple-line', title: 'Review pending change', when: { 'data.changed': true } },
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
          condition: { $: "event.action == 'review'" },
          then: [
            { $setLocal: 'inspecting', value: { $: 'event.recordId' } },
            { $setLocal: 'inspectingType', value: { $: 'event.recordType' } },
          ],
        },
      },
      {
        $if: {
          condition: { $: "event.action == 'accept'" },
          /*
            Kept, and pinned where it is drawn. A suggestion is parked rather than placed — a placement
            is shared, and nobody had agreed to the record — so without one a kept card went on being
            parked, somewhere new on every reload. Keeping it is the moment it joins the arrangement.
          */
          then: [
            { $action: 'modules.transcribe.acceptProposal', args: [{ $: 'event.recordId' }] },
            {
              $action: 'recordStore.placeOnCanvas',
              args: [CALL, { $: 'event.recordId' }, { $: 'event.recordType' }, { $: 'event.x' }, { $: 'event.y' }],
            },
          ],
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
  // `relative` so the hidden-suggestions chip can sit over the canvas's corner.
  props: { width: '100%', flex: '1', minHeight: '0', overflow: 'hidden', position: 'relative' },
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
      That drafts are hidden, said on the canvas itself.

      The switch lives in the key, which is a panel and can be closed — and cards missing with nothing
      on screen to say why is how a person comes to think extraction lost them. So while they are
      hidden, a chip in the corner says so and brings them back. No count: the store's list spans every
      call asked about, and a number that is not this canvas's would be worse than none.
    */
    {
      type: '$if',
      props: {
        condition: { $: `(${CALL_EXPR}) && ${SUGGESTIONS_HIDDEN}` },
        then: {
          type: 'Row',
          props: {
            position: 'absolute',
            left: '400',
            bottom: '400',
            gap: '200',
            ay: 'center',
            pl: '300',
            pr: '100',
            py: '100',
            r: 'pill',
            bg: 'surface-raised',
            border: '1px solid border',
            shadow: 'sm',
          },
          children: [
            { type: 'we-icon', props: { name: 'eye-slash', size: 'xs', color: 'text-muted' } },
            {
              type: 'we-text',
              props: { fontSize: '200', color: 'text-muted' },
              children: ['Pending acceptance hidden'],
            },
            {
              type: 'we-button',
              props: {
                size: 'xs',
                variant: 'ghost',
                onClick: { $action: 'routeStore.setParam', args: ['suggestions', null] },
              },
              children: ['Show'],
            },
          ],
        },
      },
    },
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
    // Back goes to the chooser a record was picked from; a drawn connection gets no Back button.
    // No model picker: the kind was just chosen on the screen before. The header's disc takes the
    // kind's colour, as the chooser's card did — `kindFill` reads the route's `typeStyles`.
    recordFormModal({ back: BACK_TO_CHOOSER, entityPicker: false, iconColor: kindFill }),
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
  /*
    A press anywhere on the page lets go of the selected card — unless it was a press on a card.

    A press on a card reaches here too, after the card has selected itself, so the card marks the
    press as its own and this reads the mark rather than second-guessing the event. The inspector is a
    panel outside this tree, so working in it never deselects what it is showing.

    Both parameters, not only the card. A type left behind with no card is the state that once opened
    an arbitrary task in the inspector — see the `when` on its query — and a selection that is gone
    should leave nothing to be misread.
  */
  $localState: { pressedCard: { type: 'boolean', initial: false } },
  props: {
    width: '100%',
    minHeight: '100%',
    ax: 'center',
    px: '400',
    onClick: [
      {
        $if: {
          condition: { $: 'local.pressedCard' },
          then: { $setLocal: 'pressedCard', value: false },
          else: {
            $if: {
              condition: { $: 'routeStore.params.card' },
              then: [
                { $action: 'routeStore.setParam', args: ['card', null] },
                { $action: 'routeStore.setParam', args: ['cardType', null] },
              ],
            },
          },
        },
      },
    ],
  },
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
              /*
                `flex: '1'` and no `ROUTE_BAND`, for the same reason as the route above: the "no board
                yet" gate below centres in this box, and it should land exactly where the "no call"
                gate does. The band goes on the branches that draw from the top — the board and its
                spinner.
              */
              props: { width: '100%', flex: '1' },
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
                    then: {
                      type: 'Column',
                      props: { width: '100%', ...ROUTE_BAND },
                      children: [
                        taskBoard({
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
                          /*
                        Which cards a model proposed from the conversation — the provenance question
                        this template is built around. A mark on the card and a line in its people
                        hovercard, rather than the author's name in heading type: on an extracted task
                        the author is whichever member's node ran the pass, not who proposed the work.
                        The call's own `extracted` relation says which, and arrives as ids on the row.
                      */
                          extracted: 'card.id in first(local.callRow).extracted',
                          /*
                            And who is doing it — the other half of the same question. A call commits
                            people to things as often as it commits to things, and a board that could
                            only say what was agreed and not by whom was half an answer. The filter above
                            it rides in `?who=` beside `?call=`, so a link to this page can be "what Ana
                            took on in this call".
                          */
                          people: true,
                          /*
                            And what people have made of each card — reactions and replies, as
                            counts. The inspector is where either is given; a card says only that
                            there is something to open, which is what a preview owes a reader.
                          */
                          social: true,
                          // Put away what extraction made and nobody has kept — shared with the canvas and calendar.
                          suggestions: true,
                          /*
                            Pressing a card selects it, the way pressing one on the canvas does: the
                            same two parameters, so the inspector opens it and the canvas focuses it if
                            you go there. Editing is the inspector's — its pencil unlocks the fields —
                            rather than a second editor on the card.

                            A press only ever selects. It used to let go of a card already selected, and
                            a press on the faces or the move menu is a press on the card too, so opening
                            either deselected the card behind the menu. Letting go is a press anywhere
                            else on the page — see `pressedCard` on the route.

                            The type first, and only then the card, so the inspector's query never asks
                            about a card under the wrong type for the instant between the two writes.
                          */
                          select: {
                            selected: 'routeStore.params.card',
                            onSelect: [
                              { $setLocal: 'pressedCard', value: true },
                              { $action: 'routeStore.setParam', args: ['cardType', 'TaskBlock'] },
                              { $action: 'routeStore.setParam', args: ['card', { $: 'card.id' }] },
                            ],
                          },
                          empty: emptyState({
                            icon: 'check-square',
                            label: 'work',
                            message:
                              'Nothing from this call yet. Cards appear here as the conversation commits to things — or add one to a column.',
                          }),
                        }),
                      ],
                    },
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
                          // Dressed like `startCallButton('md')`, the control the other gate carries.
                          {
                            type: 'we-button',
                            props: {
                              gap: '200',
                              mt: '400',
                              onClick: { $action: 'spaceStore.openBoardFor', args: [CALL, 'This call'] },
                            },
                            children: [{ type: 'we-icon', props: { name: 'kanban' } }, 'Make a board for this call'],
                          },
                        ),
                        else: { type: 'Column', props: { width: '100%', ...ROUTE_BAND }, children: [taskBoardLoading] },
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
 * Who is on each event — the same host function the board's cards read, over the calendar's own
 * involvement query.
 */
const ON_EVENTS = 'involvement({ rows: local.involvements, types: spaceStore.involvementTypes, me: me.did })';

/** Whether anybody chosen in the people filter is going to, or might go to, the event named. */
const MATCHES = (as: string) => `${ON_EVENTS}.byNode[${as}.id].dids.exists(d, d in local.calendarPeople)`;

/** Somebody is chosen, so the calendar is being read by people at all. */
const FILTERING = 'count(local.calendarPeople)';

/**
 * The events to draw: all of them, or — hiding — only the ones somebody chosen is on. Less, either
 * way, what a pass made and nobody has kept while the reader has put suggestions away.
 *
 * Every list and every cell reads this rather than `local.events`, so the grid and the list under it
 * cannot disagree about what is on a day. Dimming leaves the list whole and fades rows instead, which
 * is what keeps a busy week looking busy.
 */
const VISIBLE_EVENTS = `(${FILTERING} && local.calendarShow == 'hide') ? ${withoutHiddenSuggestions('local.events')}.filter(e, ${MATCHES('e')}) : ${withoutHiddenSuggestions('local.events')}`;

/** An event a pass made that nobody has kept — drawn provisional, and put away with the board's switch. */
const UNCONFIRMED_EVENT = (as: string) => `${as}.id in ${UNCONFIRMED}`;

/** The event the inspector is open on — the same address the canvas and the board write. */
const SELECTED_EVENT = "event.id == routeStore.params.card && routeStore.params.cardType == 'EventBlock'";

/** Faded, for an event nobody chosen is on while the filter dims. */
const DIMMED = (as: string) => `${FILTERING} && local.calendarShow == 'dim' && !(${MATCHES(as)})`;

/**
 * The answers somebody can give to an event — going, maybe, not going, and whatever this community
 * has added — as the space names them.
 */
const ANSWERS = `spaceStore.offeredInvolvementTypes.filter(k, k.reflexive && ('EventBlock' in k.appliesTo || !count(k.appliesTo)))`;

/**
 * Answering an invitation, and who else has.
 *
 * One button per answer, the chosen one filled; pressing it again takes the answer back, which is
 * the first thing anybody tries. Only ever this agent's own answer — `respondTo` writes nobody
 * else's — and one per event, so pressing Maybe after Going replaces it.
 *
 * The roster is who said they are coming, and a count of who might. Not `participants`, which is a
 * different fact: who was in a call is something a machine saw, and who said they would come is
 * something a person stated. Reading one as the other would tell somebody a meeting they skipped was
 * one they attended.
 */
const rsvp: SchemaNode = {
  type: 'Row',
  props: { width: '100%', gap: '300', ay: 'center', wrap: true },
  children: [
    {
      type: 'Row',
      props: { gap: '100', ay: 'center' },
      children: [
        {
          type: '$each',
          props: { items: { $: ANSWERS }, as: 'answer' },
          children: [
            {
              type: 'we-button',
              props: {
                size: 'xs',
                variant: { $: `${ON_EVENTS}.answers[event.id] == answer.slug ? 'secondary' : 'ghost'` },
                onClick: {
                  $action: 'spaceStore.respondTo',
                  args: [{ $: 'event.id' }, { $: `${ON_EVENTS}.answers[event.id] == answer.slug ? '' : answer.slug` }],
                },
              },
              children: [
                {
                  type: '$if',
                  props: {
                    condition: { $: 'answer.icon' },
                    then: { type: 'we-icon', props: { name: { $: 'answer.icon' } } },
                  },
                },
                { $: 'answer.name' },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'Row',
      props: { gap: '300', ay: 'center', ml: 'auto' },
      children: [
        {
          type: '$if',
          props: {
            condition: { $: `count(${ON_EVENTS}.byNode[event.id].committed)` },
            then: peopleRow({
              items: { $: `${ON_EVENTS}.byNode[event.id].committed` },
              dids: true,
              noun: 'going',
              nounPlural: 'going',
              max: 5,
              size: 'xs',
              minHeight: '24px',
            }),
          },
        },
        {
          type: '$if',
          props: {
            condition: { $: `count(${ON_EVENTS}.byNode[event.id].interested)` },
            then: {
              type: 'we-text',
              props: {
                variant: 'footnote',
                color: 'text-muted',
                whiteSpace: 'nowrap',
                text: { $: `\`\${count(${ON_EVENTS}.byNode[event.id].interested)} maybe\`` },
              },
            },
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
 * and each member's own answer — going, maybe, not going — is how anybody responds to it afterwards.
 * See `rsvp` for why that is an involvement and not `participants`.
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
          $: `count(local.day ? filter(${VISIBLE_EVENTS}, { startDate: { startsWith: local.day } }) : ${VISIBLE_EVENTS})`,
        },
        then: {
          type: 'Column',
          props: { width: '100%', gap: '300' },
          children: [
            {
              type: '$each',
              props: {
                items: {
                  $: `local.day ? filter(${VISIBLE_EVENTS}, { startDate: { startsWith: local.day } }) : ${VISIBLE_EVENTS}`,
                },
                as: 'event',
              },
              children: [
                {
                  type: 'Column',
                  props: {
                    width: '100%',
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
                    /*
                      A draft looks like one, as on the board: dashed, and a little faded. A selected
                      event takes the accent and a one-pixel ring outside it — the board card's
                      treatment, because it is the same act on a different surface.
                    */
                    border: {
                      $: `(${SELECTED_EVENT}) ? '1px solid accent' : (${UNCONFIRMED_EVENT('event')}) ? '1px dashed border-strong' : '1px solid border'`,
                    },
                    ring: { $: `(${SELECTED_EVENT}) ? '0 0 0 1px var(--we-role-accent)' : ''` },
                    p: '400',
                    opacity: { $: `(${DIMMED('event')}) ? 0.35 : (${UNCONFIRMED_EVENT('event')}) ? 0.75 : 1` },
                    transition: 'opacity 200 ease-in-out',
                    /*
                      Pressing an event opens it in the inspector, exactly as pressing a card on the
                      canvas or the board does — the same two parameters, so the panel that was
                      already on screen answers about the event and a link to this page carries the
                      selection with it.

                      This was the one surface of the four with no selection at all, which is why the
                      inspector could say nothing about an event: there was no way to tell it about
                      one. The type first and only then the id, so its query is never asked about an
                      event under the wrong type for the instant between the two writes.
                    */
                    cursor: 'pointer',
                    onClick: [{ $setLocal: 'pressedCard', value: true }, ...openRecord('event.id', 'EventBlock')],
                  },
                  children: [
                    {
                      type: 'Row',
                      props: { width: '100%', ay: 'center', gap: '300' },
                      children: [
                        { type: 'we-icon', props: { name: 'calendar', color: 'accent-text' } },
                        {
                          type: 'Column',
                          props: { flex: '1', gap: '100' },
                          children: [
                            {
                              type: 'Row',
                              props: { gap: '200', ay: 'center', wrap: true },
                              children: [
                                { type: 'we-text', props: { fontWeight: 'semibold', text: { $: 'event.title' } } },
                                {
                                  type: '$if',
                                  props: {
                                    condition: { $: UNCONFIRMED_EVENT('event') },
                                    then: {
                                      type: 'we-tooltip',
                                      props: { content: 'Extraction proposed this — pending acceptance' },
                                      children: [
                                        {
                                          type: 'we-badge',
                                          props: { size: 'xs', variant: 'warning', appearance: 'solid' },
                                          children: ['suggested'],
                                        },
                                      ],
                                    },
                                  },
                                },
                              ],
                            },
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
                        // Keep or discard a draft where it is — the board's pair, behind the same actions.
                        {
                          type: '$if',
                          props: {
                            condition: { $: UNCONFIRMED_EVENT('event') },
                            then: {
                              type: 'Row',
                              props: { gap: '100', ay: 'center' },
                              children: [
                                answerButton({
                                  tone: 'success',
                                  label: 'Accept',
                                  onClick: { $action: 'modules.transcribe.acceptProposal', args: [{ $: 'event.id' }] },
                                }),
                                answerButton({
                                  tone: 'danger',
                                  label: 'Reject — removes it',
                                  onClick: { $action: 'modules.transcribe.rejectProposal', args: [{ $: 'event.id' }] },
                                }),
                              ],
                            },
                          },
                        },
                      ],
                    },
                    rsvp,
                    /*
                      What people have made of this event — the board card's line, on the surface
                      that shares its records. Counts only: pressing the row opens the event in the
                      inspector, which is where a reaction is given and the thread is read.
                    */
                    signalDisplay({ record: 'event', mode: 'compact', size: 'xs', readOnly: true, inline: true }),
                    // What a pass suggests changing about an agreed event, as old → new.
                    suggestedChanges({ record: 'event', collapseAfter: 3 }),
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
            $: `(${FILTERING} && count(local.events)) ? 'Nobody chosen is going to anything here.' : local.day ? 'Nothing on this day.' : 'Nothing from this call yet. Events appear here as the conversation settles on dates.'`,
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
  // A press anywhere on the page lets go of the selected event — unless it was a press on one. The
  // kanban route's pattern, arriving here with the selection it exists to release; see there for why
  // the card marks its own press rather than this second-guessing the event.
  $localState: { pressedCard: { type: 'boolean', initial: false } },
  props: {
    width: '100%',
    minHeight: '100%',
    ax: 'center',
    px: '400',
    onClick: [
      {
        $if: {
          condition: { $: 'local.pressedCard' },
          then: { $setLocal: 'pressedCard', value: false },
          else: {
            $if: {
              condition: { $: 'routeStore.params.card' },
              then: [
                { $action: 'routeStore.setParam', args: ['card', null] },
                { $action: 'routeStore.setParam', args: ['cardType', null] },
              ],
            },
          },
        },
      },
    ],
  },
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
                /*
                  The people filter's two halves, split the way the board splits them: who is chosen
                  rides in the address, since "what Ana is going to" is a thing a link can point at,
                  and whether the rest are dimmed or hidden stays on this device.
                */
                calendarPeople: { type: 'array', initial: [], syncParam: 'who' },
                calendarShow: { type: 'string', initial: 'dim', persist: 'calendar.show' },
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
                  // The place, and the reactions the row's counts read. `comments` needs no include —
                  // a relation's own ids arrive anyway, which is what makes a reply count free.
                  include: { location: true, signals: true },
                },
                // What this community reacts with, for those counts — one subscription for the month.
                signalTypes: { entity: 'SignalType', subscribe: true },
                // Who said they are coming to what. Space-wide, for the board's reason: an answer is
                // not a child of anything, and there are as many as people have given.
                involvements: { entity: 'Involvement' },
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

                // ── Whose calendar this is being read as, and whether suggestions show ──
                // The board's header, in the board's order: who, then the switch.
                {
                  type: 'Row',
                  props: { gap: '500', ay: 'center', wrap: true, width: '100%' },
                  children: [
                    peopleFilter({
                      people: 'calendarPeople',
                      show: 'calendarShow',
                      // Whoever has answered an event this call produced, the viewer first.
                      faces: {
                        $: 'involvement({ rows: local.involvements, types: spaceStore.involvementTypes, me: me.did, nodes: local.events.map(e, e.id) }).dids',
                      },
                      matched: { $: `count(local.events.filter(e, ${MATCHES('e')}))` },
                      total: { $: 'count(local.events)' },
                      noun: 'event',
                    }),
                    suggestionsToggle({ count: `count(local.events.filter(e, ${UNCONFIRMED_EVENT('e')}))` }),
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
                                    items: {
                                      $: `filter(${VISIBLE_EVENTS}, { startDate: { startsWith: cell.date } }, 2)`,
                                    },
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
                                        /*
                                          Too small for the card's full treatment, so each kind of
                                          suggestion gets the one cue that fits: a draft is dashed and
                                          faded, as on the board; an agreed event with a change
                                          suggested keeps its fill and leads with a pencil.
                                        */
                                        text: { $: `(mark.id in ${CHANGED} ? '✎ ' : '') + mark.title` },
                                        // Faded for the neighbouring months, so a busy 1st of next month
                                        // does not read as part of the month being looked at.
                                        bg: { $: "cell.inMonth ? 'accent-muted' : 'surface-sunken'" },
                                        color: { $: "cell.inMonth ? 'accent-text' : 'text-muted'" },
                                        border: {
                                          $: `(${UNCONFIRMED_EVENT('mark')}) ? '1px dashed accent-text' : '1px solid transparent'`,
                                        },
                                        opacity: {
                                          $: `(${DIMMED('mark')}) ? 0.35 : (${UNCONFIRMED_EVENT('mark')}) ? 0.7 : 1`,
                                        },
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
                                      $: `count(filter(${VISIBLE_EVENTS}, { startDate: { startsWith: cell.date } })) > 2`,
                                    },
                                    then: {
                                      type: 'we-text',
                                      props: {
                                        variant: 'footnote',
                                        color: 'text-faint',
                                        px: '100',
                                        text: {
                                          $: `\`+\${count(filter(${VISIBLE_EVENTS}, { startDate: { startsWith: cell.date } })) - 2} more\``,
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
      This interface is built around two modules and says so. It reads `modules.call.*` and
      `modules.transcribe.*` throughout, places both transcribe panels in `panels` below, and puts a
      call part on its own pages — none of which the host can see by walking component types. With
      the declaration, a deployment that omits either module sees the reason in `missingModules`
      rather than a canvas with a dead call button and two empty panels.
    */
    requires: { modules: ['call', 'transcribe'] },
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
          Half the column each, and exactly half: the two share a base (both `sm`) and a grow, and
          a lane divides base-plus-slack, so equal bases with equal shares come out equal.

          It was two shares against one, for a transcript that took about two thirds. That starved
          the readout, which is where a pass's findings, its failures and the Extract button all
          live — the half of the column somebody acts on, where the transcript is the half they
          glance at.

          Written rather than left to the default of 1, because the pair is the point and a bare
          entry would not say so. Before that it was `1` against a `0`, which does not mean "most of
          it" — it means *all* the spare room, since a member with no grow keeps its base and
          nothing else.
        */
        grow: 1,
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
        // The transcript's equal — see there. Not `0`, which pins it to its base and gives the
        // transcript every pixel of the slack: a column that reads as one panel and one strip.
        grow: 1,
      },
      /*
        The inspector, open by default and on the edge the canvas's own controls are not.

        Open, because a panel that has to be found before it can explain a card is a panel nobody
        discovers — and its empty state is a sentence rather than a blank box, so an unused one says
        what it is for.
      */
      /*
        Above the calls list, the two of them one sidebar down the right — the mirror of the
        transcript and the readout on the left.

        Displacing, with a shared `band`, for the left lane's reason: they meet flush, cost the
        canvas their width once, and stop covering its right-hand edge. Floating, they sat over the
        canvas's own cards, and the key in the corner then sat over them.

        Half the column each, and exactly half: equal bases (both `sm`) and equal grows. That only
        holds while these two are the lane. The key and the call window were in it too, which made
        it four-way and put a short inspector over a long list.
      */
      {
        id: 'inspector',
        node: inspectorPanel,
        title: 'Inspector',
        snap: 'right',
        displace: true,
        band: 0,
        order: 0,
        size: 'sm',
        grow: 1,
      },
      /*
        No `open` here, though it stood as `open: false` for a long time and read as "placed, not
        shown". Nothing has ever honoured that on an authored panel — `open` suppresses a *module*
        launcher, and this panel has none — so the flag described a behaviour this template did not
        have, which is why the validator now says so.

        Open is also what it should be. This list is the only way to choose a call that has finished:
        the corner names the current one and the page gates start a new one, and neither picks from
        the archive. A panel carrying the one act nothing else offers should not begin hidden.
      */
      // The inspector's lane-mate — see there.
      {
        id: 'calls',
        node: callsPanel,
        title: 'Calls',
        snap: 'right',
        displace: true,
        band: 0,
        order: 1,
        size: 'sm',
        grow: 1,
      },
      /*
        The key, open, floating in the top-right corner on its own.

        Open, for the inspector's reason: a lens somebody has to find before the colours mean
        anything is a lens nobody turns on. Not a tab behind Calls, because a space template cannot
        bring a tab forward — `raiseDock` is host layout — so a key stacked behind the calls list
        would be one nobody could get back to from inside the template. Closed, it comes back with
        the picker's "Reset layout", like every authored panel.

        A corner rather than a third seat in the right-hand column. It is a legend: glanced at while
        the canvas is being read, the way a map's key sits over the map, and not a peer of the two
        panels somebody works in. In the column it also took a third of the height from both.

        `box` because no named size is this shape — a `sm` is 16:9, and a list of kinds is tall and
        narrow. 250 × 510 of content, plus the host's frame: 2px of border across, and a 33px
        titlebar with the border down. The corner clears `chromeReserve`, which is centred.
      */
      {
        id: 'key',
        node: keyPanel({ call: CALL, callExpr: CALL_EXPR, extracted: EXTRACTED.$ }),
        title: 'Key',
        snap: 'top-right',
        box: { width: 252, height: 545 },
      },
      /*
        The call window: placed, not opened, bottom-centre when a call opens it.

        `open: false` because the stage is opened by the call — `join` raises the module's own
        `stageOpen` — and an empty stage on entering the space would be a window over nothing.
        Where it lands is still this entry's to say, because a declaration outranks the module's
        own opening bid whenever the module does open it: at the start of a call.

        Along the bottom as a strip, rather than beside the column it was in, because a row of faces
        is wide and low and every other panel here is tall. 860 × 176 of stage, plus the same frame
        as the key. A floating panel alone on an edge is not divided, so it keeps this width rather
        than stretching along the bottom.
      */
      { id: 'call', module: 'call', snap: 'bottom', box: { width: 862, height: 211 }, open: false },
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
    /*
      An address this template has no screen for goes to the canvas, rather than saying so.

      This drew "No such page." and stopped there, which is a dead end with no way out of it but the
      switcher — and the addresses that land here are not typos. They are a section's address under a
      template that has no sections (`/space/<id>/about`, from a link sent before the space switched
      to this template, or from anywhere in the app that still names one), and the host's redirect
      deliberately leaves a self-routing template's addresses alone, so nothing else was going to move
      them.

      Relative, like the index redirect above and for the same reason — and it resolves against the
      space, not against the unmatched address, however many segments that address has.
    */
    { path: '*', redirect: './canvas' },
  ],
};
