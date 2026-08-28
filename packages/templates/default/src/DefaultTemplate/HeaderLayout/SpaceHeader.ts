import type { SchemaNode } from '@we/schema-shared';
import { peopleRow, peopleTooltip } from '@we/template-kit';

export const spaceHeader: SchemaNode = {
  type: 'Column',
  children: [
    // ─── Header ───────────────────────────────────────────────────────────────
    {
      type: 'Row',
      props: { bg: 'surface', ax: 'center' },
      children: [
        {
          type: 'Column',
          props: { width: '100%', maxWidth: 'var(--we-layout-lg)' },
          children: [
            // Cover image
            {
              type: 'EditableImage',
              props: {
                src: { $: 'spaceStore.currentSpace.coverImage' },
                alt: 'Cover image',
                fit: 'cover',
                width: '100%',
                height: '300px',
                rb: '600',
                aspect: 4 / 1,
                placeholderIcon: 'panorama',
                onImageChange: { $action: 'spaceStore.updateSpaceImage', args: ['coverImage', { $: 'arg' }] },
              },
            },
            {
              type: 'Row',
              props: { gap: '300', p: '400', mt: '400' },
              children: [
                // Profile picture
                {
                  type: 'EditableImage',
                  props: {
                    src: { $: 'spaceStore.currentSpace.avatar' },
                    alt: 'Profile picture',
                    fit: 'cover',
                    width: '120px',
                    height: '120px',
                    r: 'avatar',
                    ring: '0 0 0 2px var(--we-ring-color)',
                    placeholderIcon: 'users-three',
                    onImageChange: { $action: 'spaceStore.updateSpaceImage', args: ['avatar', { $: 'arg' }] },
                  },
                },
                // Space Details
                {
                  type: 'Column',
                  props: { p: '400', gap: '300', maxWidth: '700px' },
                  children: [
                    /*
                      `loading` rather than a placeholder beside the text: the element sizes its own
                      placeholder from the line it would occupy, so nothing here has to know the
                      height of a heading — a number no template can derive and which drifts the
                      moment a theme changes its type scale.

                      The description still waits on the space rather than reading through it. Its
                      inner condition tests `description`, which is falsy while unloaded, so without
                      the outer test it asserted "No description..." about a space it had not seen.
                    */
                    {
                      type: 'we-text',
                      props: {
                        variant: 'heading-md',
                        color: 'text',
                        loading: { $: '!spaceStore.currentSpace' },
                        loadingWidth: '220px',
                      },
                      children: [{ $: 'spaceStore.currentSpace.name' }],
                    },
                    {
                      type: '$if',
                      props: {
                        condition: { $: 'spaceStore.currentSpace' },
                        then: {
                          type: '$if',
                          props: {
                            condition: { $: 'spaceStore.currentSpace.description' },
                            then: {
                              type: 'we-text',
                              props: { truncate: true },
                              children: [{ $: 'spaceStore.currentSpace.description' }],
                            },
                            else: {
                              type: 'we-text',
                              props: { italic: true },
                              children: ['No description...'],
                            },
                          },
                        },
                        else: { type: 'we-text', props: { loading: true, loadingWidth: '320px' } },
                      },
                    },
                    // The faces and the count are one thing to a reader — "12 Members" — so the
                    // roster hangs off both rather than off the avatars alone. Hovering the words
                    // and getting nothing was the tell that the tooltip belonged out here.
                    peopleRow({
                      items: { $: 'spaceStore.members' },
                      noun: 'Member',
                      // Members resolve on their own path, later than the space itself, so without
                      // a floor this row collapsed and then pushed the header down a second time.
                      minHeight: '32px',
                      rowProps: { mt: '200' },
                    }),
                  ],
                },
              ],
            },
            // Sentinel — zero-height marker used by scrollPast in the sticky nav below
            {
              type: 'div',
              props: { id: 'space-header-sentinel' },
              styles: { height: '0px', pointerEvents: 'none' },
            },
          ],
        },
      ],
    },
  ],
};

/**
 * The sticky nav's height — a fact, not a guess.
 *
 * The content area below fills the viewport *minus this bar*, and it used to subtract a literal
 * `70px`: three short of what a `md` button inside `p: '400'` actually measures, and blind to a
 * theme's `--we-theme-control-height-offset`. Declaring it here in the same tokens the bar is
 * built from, and *setting* it on the bar, makes the two sides of that subtraction agree by
 * construction — and means the mini-profile opening beside the nav cannot change the bar's height
 * out from under the route below it.
 *
 * `--we-scrollbar-width` is in the sum because the views strip scrolls, and a scrollbar is drawn
 * *inside* the box it belongs to: without the allowance the bar would clip the bottom of every
 * button the moment a space had more views than fit. Reserved unconditionally, since nothing can
 * ask "is it overflowing right now?" — 6px of slack on a bar that is not scrolling is a far better
 * trade than a bar that clips when it is.
 */
export const NAV_BAR_HEIGHT =
  'calc(var(--we-component-height-md) + var(--we-theme-control-height-offset, 0px) + var(--we-scrollbar-width) + 2 * var(--we-space-400) + 1px)';

/** The height of a `md` control, as the primitives compute it — what the bar's buttons measure. */
const CONTROL_HEIGHT = 'calc(var(--we-component-height-md) + var(--we-theme-control-height-offset, 0px))';

/**
 * The views strip is always this tall: the buttons plus the room a horizontal scrollbar takes.
 *
 * `overflowX: 'auto'` shows the scrollbar only when the strip overflows, and a scrollbar takes its
 * room from *inside* the box — so the strip grew by the scrollbar's height the moment a space had
 * more views than fit, and everything centred on it (the presence beside it) dropped by half that.
 * `scrollbar-gutter` cannot reserve the room for a horizontal scrollbar, so the strip reserves it by
 * being the taller height always, with its buttons held at the top. Overflowing or not, nothing
 * moves.
 */
const STRIP_HEIGHT = `calc(${CONTROL_HEIGHT} + var(--we-scrollbar-width))`;

// Sticky navigation — exported separately so it can be placed as a sibling of
// both the header content and the $routes outlet, giving it a containing block
// that spans the full page height (required for position:sticky to work correctly).
export const spaceNavBar: SchemaNode = {
  type: 'Row',
  props: {
    bg: 'surface',
    position: 'sticky',
    zIndex: 'sticky',
    top: '0',
    left: '0',
    height: NAV_BAR_HEIGHT,
    borderBottom: '1px solid border',
  },
  children: [
    {
      /*
        Three tracks: the mini-profile at the screen's edge, the nav centred on the screen, and an
        empty track balancing the first.

        Two things have to be true at once — the mini-profile sits at the far left of the window,
        and it never draws over the view buttons on a narrow one — and each was true on its own
        before this. Absolutely positioned at `left: 16px` it was at the edge and, below a viewport
        wider than the column plus two gutters (every laptop), straight over the first buttons. In
        flow inside the centred column it never overlapped and was no longer at the edge.

        A grid holds both. The side tracks share what the centre does not take, so with room to
        spare they are equal and the nav is centred on the screen while the mini-profile lives in
        the left gutter. The left track's floor is its content — `minmax(max-content, 1fr)` — so on
        a narrow screen it keeps its width, the right track gives up its share, and the nav shifts
        right to clear the mini-profile rather than being drawn under it. While the mini-profile is
        closed its reveal track is zero wide and the two sides are symmetric again. Nothing measures
        anything; the browser does the arithmetic that the absolute version could not.
      */
      type: 'Grid',
      props: {
        // The right track's floor is the module rail's width: the rail is chrome floating over the
        // window's right edge, so on a narrow screen the centre track stops short of it rather than
        // putting presence underneath.
        template:
          'minmax(max-content, 1fr) minmax(0, var(--we-layout-lg)) minmax(var(--we-chrome-rail-width, 56px), 1fr)',
        width: '100%',
        height: '100%',
        // No gap: `Grid` defaults to one, and here it would be dead room beside the rail's reserve
        // on the right and beside the mini-profile's own padding on the left.
        gap: '0',
        minWidth: '0',
      },
      children: [
        /*
          Mini-profile — opens sideways once the header has scrolled behind the bar.

          `pl` is the gutter to the screen's edge and stays whether or not it is open; the `pr` on
          the row inside is the gap to the nav, and it opens and closes with the reveal so a closed
          mini-profile leaves nothing behind.
        */
        {
          type: 'Row',
          // Fills its track and centres inside it: a grid item with a fixed height sits at the top of
          // its track, whatever the grid is asked to align.
          props: { ay: 'center', pl: '400', height: '100%' },
          children: [
            {
              type: '$animate',
              props: {
                scrollPast: 'space-header-sentinel',
                enterTransition: [
                  { type: 'reveal', axis: 'inline', duration: 250 },
                  { type: 'fade', duration: 250 },
                ],
                exitTransition: [
                  { type: 'reveal', axis: 'inline', duration: 200 },
                  { type: 'fade', duration: 200 },
                ],
              },
              children: [
                {
                  type: 'Row',
                  props: { ay: 'center', gap: '300', pr: '400' },
                  children: [
                    {
                      type: 'we-avatar',
                      props: {
                        image: { $: 'spaceStore.currentSpace.avatar' },
                        initials: { $: 'spaceStore.currentSpace.name' },
                        // `md`, matching the buttons beside it: the bar is exactly one control
                        // tall, and an `lg` avatar is taller than that.
                        size: 'md',
                      },
                    },
                    {
                      // Capped, so a long space name cannot push the nav off to the right — the
                      // left track's floor is this row's width, and this is the one part of it
                      // that could grow without bound.
                      type: 'we-text',
                      props: { fontWeight: 'semibold', whiteSpace: 'nowrap', truncate: true, maxWidth: '240px' },
                      children: [{ $: 'spaceStore.currentSpace.name' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        // The centred column: the views strip and, at its right, presence.
        {
          type: 'Column',
          // `minWidth: '0'` for the same reason the views strip below carries one: this is a grid
          // item, and without it its automatic minimum size is its content, so the track's cap is
          // advisory.
          props: { width: '100%', minWidth: '0' },
          children: [
            {
              /*
                No `gap` and no `ax`. The views strip growing is what pushes presence to the right
                edge, so `ax: 'between'` would be describing a job already done.
              */
              type: 'Row',
              props: {
                // Top-aligned, with the padding split unevenly on purpose: the strip is a scrollbar's
                // height taller than its buttons (see STRIP_HEIGHT), so equal padding around the
                // *strip* leaves more room under the buttons than over them. Moving half the
                // scrollbar's height from the bottom to the top centres the buttons in the bar — and
                // the sum is unchanged, so NAV_BAR_HEIGHT still says what the bar measures.
                ay: 'start',
                px: '400',
                pt: 'calc(var(--we-space-400) + var(--we-scrollbar-width) / 2)',
                pb: 'calc(var(--we-space-400) - var(--we-scrollbar-width) / 2)',
                minWidth: '0',
              },
              children: [
                // Navigation
                {
                  /*
                The one item here that gives up space, and the only one that can.

                `we-button` sets `white-space: nowrap`, so a button's min-content width is its whole
                label and this strip's is the sum of all of them. A flex item's `min-width: auto`
                resolves to exactly that, so the strip refused every request to compress: a space
                with enough views pushed past the page's `maxWidth`, and since the template is
                mounted in an `overflow: auto` box the whole page — cover image and all — scrolled
                sideways. The presence beside it, being the only shrinkable thing in the row,
                absorbed the squeeze first and folded "1 online now" onto two lines.

                `minWidth: '0'` releases that minimum and `overflowX` gives the overflow somewhere
                to go, so every view stays reachable at any width and any count.

                No `scrollbarWidth` here, deliberately. Hiding it left the overflow reachable only
                by a horizontal gesture most mice cannot make, which is the same as unreachable —
                and the app already styles scrollbars globally to a themed 6px
                (`::-webkit-scrollbar` in app-shell's index.scss), so the bar this shows is the one
                every other scroll region in WE shows. Setting the standard `scrollbar-width`
                property instead would opt Chromium out of those pseudo-element rules and make this
                the one scrollbar in the app that looks different. The bar's height reserves the
                6px — see NAV_BAR_HEIGHT.
              */
                  type: 'Row',
                  props: {
                    gap: '200',
                    flex: '1 1 auto',
                    minWidth: '0',
                    overflowX: 'auto',
                    height: STRIP_HEIGHT,
                    ay: 'start',
                  },
                  children: [
                    {
                      // The space's own section list, not a literal one. This array used to be written
                      // out here and again in the sidebar layout, and the two had drifted: this one
                      // carried About and Settings with Flux commented out, the sidebar carried Flux and
                      // neither of the others. Both now read what the routes are built from.
                      type: '$each',
                      props: { items: { $: 'spaceStore.viewNav' }, as: 'view' },
                      children: [
                        {
                          type: 'we-button',
                          props: {
                            variant: { $: "routeStore.segments[2] == view.segment ? 'primary' : 'ghost'" },
                            onClick: { $action: 'routeStore.navigate', args: [{ $: 'view.path' }] },
                          },
                          children: [
                            { type: 'we-icon', props: { name: { $: 'view.icon' } } },
                            {
                              type: 'we-text',
                              children: [{ $: 'view.label' }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                // Live presence — who else is in this space right now. Hidden entirely in a personal
                // space (no neighbourhood, so `presenceStore.available` is false) and when nobody else
                // is around, rather than rendering "0 online now".
                //
                // `flex: '0 0 auto'` because this is an ornament, never the row's shock absorber. It was
                // the only shrinkable item here, so flexbox took the whole of the views strip's overflow
                // out of it before anything else moved — which is why a count and two words ended up on
                // two lines while the strip that caused it kept its full width.
                {
                  type: 'Row',
                  // As tall as a button and centred on it, as the mini-profile at the other end is.
                  props: { flex: '0 0 auto', ay: 'center', height: CONTROL_HEIGHT },
                  children: [
                    {
                      type: '$if',
                      props: {
                        condition: { $: 'count(presenceStore.online) > 0' },
                        // The count, the label and the faces are one statement, so the roster covers all
                        // three — "3 online now" is as much the hover target as the avatars are.
                        //
                        // Written out rather than built with `peopleRow`: this one puts the count first,
                        // carries a liveness `tone` per avatar and has no ring, so routing it through the
                        // fragment would mean three options serving one call site. Two instances of a
                        // shape is a coincidence; the members row above and the participant rows on cards
                        // are the three that made a fragment worth having.
                        then: peopleTooltip({
                          items: { $: 'presenceStore.online' },
                          image: { $: 'person.avatar' },
                          hash: { $: 'person.did' },
                          name: { $: 'person.name' },
                          children: [
                            {
                              type: 'Row',
                              // `pl` rather than a gap on the row above: the spacing belongs to the thing
                              // that is sometimes absent, so a space with nobody else in it leaves no gap
                              // hanging off the right of the bar.
                              props: { gap: '300', ay: 'center', pl: '400' },
                              children: [
                                {
                                  type: 'Row',
                                  props: { gap: '100', ay: 'center' },
                                  children: [
                                    {
                                      type: 'we-number',
                                      props: {
                                        value: { $: 'count(presenceStore.online)' },
                                        shorten: true,
                                      },
                                    },
                                    // "1 online / now" is never what this meant. The `flex: '0 0 auto'`
                                    // above stops the squeeze arriving; this makes the phrase refuse it
                                    // even if some future sibling starts one.
                                    {
                                      type: 'we-text',
                                      props: { color: 'text', whiteSpace: 'nowrap' },
                                      children: ['online now'],
                                    },
                                  ],
                                },
                                {
                                  type: 'AvatarStack',
                                  props: {
                                    avatars: {
                                      $: 'presenceStore.online.map(item, { image: item.avatar, hash: item.did, tone: item.tone })',
                                    },
                                    max: 5,
                                    size: 'sm',
                                  },
                                },
                              ],
                            },
                          ],
                        }),
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        // The balancing track — empty, so the centre track is centred while there is room.
        { type: 'div' },
      ],
    },
  ],
};
