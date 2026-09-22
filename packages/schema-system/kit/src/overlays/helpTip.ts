import type { ExpressionToken, SchemaNode } from '@we/schema-shared';

export interface HelpTipOptions {
  /**
   * What it says. Two to four sentences at most: a tooltip is read during a hover, not studied,
   * and a paragraph that needs scrolling has stopped being one.
   */
  text: string | ExpressionToken;
  /** The trigger's accessible name — what a screen reader calls the glyph. */
  label?: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

/**
 * An info glyph that explains how something works when pointed at.
 *
 * ## Why this exists
 *
 * The extraction panel explained itself in its own body: a lead-in above the chips, a footnote
 * under the button, and a sub-heading naming a box inside a panel already named the same thing.
 * Every sentence was true and every one was read once — after which it was furniture, taking room
 * from the controls it was about, in a docked panel that has none to spare. A newcomer needs the
 * explanation and everyone else needs it gone, and a tooltip is the one surface that is both.
 *
 * A fragment rather than a call-site pattern because three things about it are easy to get wrong
 * and invisible when they are:
 *
 * - **The bubble is `white-space: nowrap`**, sized to its content, and `white-space` inherits into
 *   slotted content. A paragraph dropped into the `content` slot renders as one line the width of
 *   the paragraph. The inner box below sets it back to normal and caps the measure.
 * - **A native `div` has to carry the slot.** `slot` is spread onto whatever a node renders; a
 *   layer-4 component such as `Column` is a Solid function that drops it, and the content then lands
 *   in the tooltip's *default* slot as permanently visible chrome. Same lesson as `peopleTooltip`.
 * - **The trigger is a button, not an icon.** The tooltip opens on focus as well as hover and wires
 *   `aria-describedby` to whatever is focusable inside it, so a button is what makes the text
 *   reachable from a keyboard and readable by a screen reader. A bare `we-icon` would be hover-only
 *   and nameless. On a touchscreen, where hovering is not a thing, tapping the button focuses it,
 *   which is the same door.
 *
 * ## What it is not for
 *
 * A tooltip has `role="tooltip"`, which promises the reader there is nothing inside it to operate.
 * Keep the text to prose: a "learn more" link wants a popover, which is a different primitive with
 * its own opening and closing rules.
 */
export function helpTip(opts: HelpTipOptions): SchemaNode {
  return {
    type: 'we-tooltip',
    props: { placement: opts.placement ?? 'bottom' },
    children: [
      {
        type: 'div',
        slot: 'content',
        children: [
          {
            type: 'Column',
            /*
              A readable measure, and prose rather than a phrase.

              `maxWidth` is what lets the `max-content` bubble wrap at all: a child with a maximum
              width contributes that width to its parent's intrinsic size, so the bubble is as wide
              as the paragraph up to here and no wider. Left-aligned because a tooltip centres its
              one-line phrases, and centred prose is a poster.
            */
            props: { maxWidth: '280px', whiteSpace: 'normal', textAlign: 'left' },
            children: [
              {
                type: 'we-text',
                // The bubble sets weight 500 for the phrases it usually holds; four sentences at
                // that weight are a wall.
                props: { fontWeight: 'regular', lineHeight: 'normal' },
                children: [opts.text],
              },
            ],
          },
        ],
      },
      {
        type: 'we-button',
        props: {
          variant: 'bare',
          size: 'sm',
          label: opts.label ?? 'How this works',
          // Quieter than the label it sits beside: an affordance for the curious, not a warning.
          color: 'text-faint',
          hoverProps: { color: 'text-muted' },
        },
        children: [{ type: 'we-icon', props: { name: 'info' } }],
      },
    ],
  };
}
