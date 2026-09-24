/**
 * Everything this module puts on screen.
 *
 * A `.schema.ts` file rather than nodes inside `index.ts`, and the reason is that the validator walks
 * for exactly this name: `pnpm --filter @we/schema-shared validate` covers `module-system/`, so a
 * fragment here is checked for unknown components, misspelled props and orphan expressions, and the
 * same fragment declared in `index.ts` is checked by nothing at all. Every other module's chrome lives
 * in one of these for the same reason.
 */
import { expr, type SchemaNode } from '@we/schema-shared';

/**
 * Somebody else has the wheel, and it is not this agent.
 *
 * Read from the store rather than assembled in the schema because "who is driving" is a comparison
 * across every peer's activity, and an expression cannot make one.
 */
const SOMEBODY_DRIVING = { $: 'modules.live.driverName' };

/**
 * The cursor switch, for the call bar and for the rail.
 *
 * A toggle that says what pressing it would *do* rather than what is true — "Share your pointer" while
 * off — because an icon-only control has no other way to say what it does, and a cursor glyph is
 * genuinely ambiguous about whether it reports a state or offers one. The same rule the call bar's own
 * toggles follow.
 */
export const cursorToggle: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'modules.live.canShareCursors' },
    then: {
      type: 'we-tooltip',
      props: {
        content: expr`modules.live.cursorsOn
          ? 'Stop sharing your pointer'
          : 'Share your pointer, and see other people’s'`,
        placement: 'bottom',
      },
      children: [
        {
          type: 'we-button',
          props: {
            square: true,
            variant: expr`modules.live.cursorsOn ? 'secondary' : 'ghost'`,
            onClick: { $action: 'modules.live.toggleCursors' },
          },
          children: [{ type: 'we-icon', props: { name: 'cursor-click' } }],
        },
      ],
    },
  },
};

/**
 * Take the wheel, or give it up.
 *
 * Offered even while somebody else has it: taking over is a real thing to want, and the tie-break is
 * deterministic — see `takeWheel`, where the earliest claim wins, so a second person pressing this
 * does not silently produce two drivers on different screens.
 */
export const wheelButton: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'modules.live.canDrive' },
    then: {
      type: 'we-tooltip',
      props: {
        content: expr`modules.live.driving ? 'Give up the wheel' : 'Take the wheel — everyone following sees your screen'`,
        placement: 'bottom',
      },
      children: [
        {
          type: 'we-button',
          props: {
            square: true,
            variant: expr`modules.live.driving ? 'secondary' : 'ghost'`,
            /*
              One action for both states, because only the store can ask which state it is in at the
              moment of the click.

              A ternary cannot do this: `$action` is a *token*, and an expression resolves to a value.
              Written as `expr`…` ? tokenA : tokenB` it typechecks, validates and renders — and then
              always takes the first branch, because the tag returns an object and every object is
              truthy. The call module's `goToCall` carries the same note for the same reason.
            */
            onClick: { $action: 'modules.live.toggleWheel' },
          },
          children: [{ type: 'we-icon', props: { name: 'signpost' } }],
        },
      ],
    },
  },
};

/**
 * What is happening with the wheel, as a sentence — the reporting half.
 *
 * In the call's `call-status` anchor rather than its control bar, which is the distinction that anchor
 * exists for: the bar is a row of things you press, and anything with a sentence to say has nowhere to
 * go in it. Three states, and each one names the move that is available rather than only the fact.
 */
export const driverStrip: SchemaNode = {
  type: '$if',
  props: {
    // Nothing at all unless somebody has the wheel or this agent has it. A strip that was always
    // present would be a permanent line of chrome about a feature nobody had switched on.
    condition: expr`modules.live.driving || ${SOMEBODY_DRIVING}`,
    then: {
      type: 'Row',
      props: {
        gap: '200',
        ay: 'center',
        px: '300',
        py: '100',
        r: 'control',
        bg: 'page',
        border: '1px solid border',
        shadow: 'md',
        // Switched back on: the strip the anchor sits in passes pointer events through, because it
        // spans the whole edge of the content — see the call module's `contentCentred`.
        pointerEvents: 'auto',
      },
      children: [
        { type: 'we-icon', props: { name: 'signpost', size: 'xs', color: 'accent-text' } },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text' },
          children: [
            expr`modules.live.driving
              ? 'You have the wheel'
              : modules.live.following
                ? 'Following ' + modules.live.followingName
                : ${SOMEBODY_DRIVING} + ' is driving'`,
          ],
        },
        {
          /*
            The move that is available, as a branch rather than a conditional handler.

            Two nodes rather than one button with a ternary on its `onClick`, because a handler is a
            token and cannot be the result of an expression — see `wheelButton`. The label differs as
            well, so there is nothing to be gained by sharing the node.
          */
          type: '$if',
          props: {
            condition: { $: 'modules.live.driving' },
            then: {
              type: 'we-button',
              props: { size: 'xs', variant: 'secondary', onClick: { $action: 'modules.live.releaseWheel' } },
              children: [{ type: 'we-text', props: { variant: 'footnote' }, children: ['Give up'] }],
            },
            else: {
              type: '$if',
              props: {
                condition: { $: 'modules.live.following' },
                then: {
                  type: 'we-button',
                  props: { size: 'xs', variant: 'ghost', onClick: { $action: 'modules.live.unfollow' } },
                  children: [{ type: 'we-text', props: { variant: 'footnote' }, children: ['Stop'] }],
                },
                else: {
                  type: 'we-button',
                  props: { size: 'xs', variant: 'secondary', onClick: { $action: 'modules.live.follow' } },
                  children: [{ type: 'we-text', props: { variant: 'footnote' }, children: ['Follow'] }],
                },
              },
            },
          },
        },
      ],
    },
  },
};

/** Why something could not be done. Dismissible, and absent the rest of the time. */
export const problemStrip: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'modules.live.problem' },
    then: {
      type: 'we-alert',
      props: {
        variant: 'warning',
        dismissible: true,
        pointerEvents: 'auto',
        onClose: { $action: 'modules.live.dismissProblem' },
      },
      children: [{ type: 'we-text', props: { variant: 'footnote' }, children: [{ $: 'modules.live.problem' }] }],
    },
  },
};

/**
 * `−  N  +` — how many synthetic cursors are on screen.
 *
 * In the bar rather than behind a console incantation, for the reason the call module's fake
 * participants are: what this is for is changing the count and watching several eased marks travel at
 * once, and leaving the app to set a `localStorage` key breaks exactly that loop. Being on screen is
 * also what stops it being silently left on.
 *
 * Contributed only in a development build, by a conditional spread at the definition rather than a
 * `$if` here, so the node does not exist in a production bundle rather than merely rendering nothing in
 * one.
 */
export const fakeCursorControls: SchemaNode = {
  type: 'Row',
  props: { gap: '100', ay: 'center', pointerEvents: 'auto' },
  children: [
    /*
      The glyph is what makes this readable, and it carries the triple's own tooltip.

      Two `−  N  +` triples sit side by side in the bar — this one and the call module's fake
      participants — and until each carried an icon they were indistinguishable. The icon is what tells
      them apart, so the icon is what a pointer looking for an explanation lands on. It used to be on
      the number, which is the one part somebody is *reading* rather than interrogating, and a tooltip
      over it covers the value it is explaining.

      No rule here, and none inside the other triple either: the region they sit in draws its own
      separators, so neither has to know whether it happens to be first.
    */
    {
      type: 'we-tooltip',
      props: { content: 'Synthetic cursors — development only', placement: 'bottom' },
      children: [{ type: 'we-icon', props: { name: 'cursor-click', size: 'sm', color: 'text-faint' } }],
    },
    {
      type: 'we-tooltip',
      props: { content: 'One fewer synthetic cursor', placement: 'bottom' },
      children: [
        {
          type: 'we-button',
          props: {
            square: true,
            size: 'sm',
            variant: 'ghost',
            disabled: { $: '!modules.live.fakeCursorCount' },
            // Zero-argument: the schema layer has no arithmetic, so "the count minus one" is the
            // store's to work out.
            onClick: { $action: 'modules.live.removeFakeCursor' },
          },
          children: [{ type: 'we-icon', props: { name: 'minus' } }],
        },
      ],
    },
    {
      type: 'we-text',
      props: { variant: 'label', color: 'text-muted', minWidth: '12px', textAlign: 'center' },
      children: [{ type: 'we-number', props: { value: { $: 'modules.live.fakeCursorCount' } } }],
    },
    {
      type: 'we-tooltip',
      props: { content: 'One more synthetic cursor', placement: 'bottom' },
      children: [
        {
          type: 'we-button',
          props: { square: true, size: 'sm', variant: 'ghost', onClick: { $action: 'modules.live.addFakeCursor' } },
          children: [{ type: 'we-icon', props: { name: 'plus' } }],
        },
      ],
    },
  ],
};
