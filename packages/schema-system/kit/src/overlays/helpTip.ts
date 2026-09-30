import type { ExpressionToken, SchemaNode } from '@we/schema-shared';

export interface HelpTipOptions {
  /**
   * What it says. Two to four sentences at most: a tooltip is read during a hover, not studied,
   * and a paragraph that needs scrolling has stopped being one.
   */
  text: string | ExpressionToken;
  /**
   * A line above the text — a glyph and a name, where the thing being explained has both.
   *
   * A reaction's tip is the case: the list it sits in draws a heart and the word beside it, and a
   * bubble that opened with prose alone made the reader carry the association across the gap
   * themselves. Anything legal in a `children` position; keep it to one line.
   */
  heading?: SchemaNode;
  /** The trigger's accessible name — what a screen reader calls the glyph. */
  label?: string;
  /**
   * How big the trigger is. `sm` by default, which is the size a label's companion is on a page.
   *
   * `xs` where it sits in a dense row: a control's height sets its row's height, so an `sm` glyph
   * beside an `xs` name makes that row taller than the rows around it — which is exactly how the
   * People heading came to sit lower than its neighbours.
   */
  size?: 'xs' | 'sm';
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
            props: { maxWidth: '280px', whiteSpace: 'normal', textAlign: 'left', gap: '100' },
            children: [
              ...(opts.heading ? [opts.heading] : []),
              {
                type: 'we-text',
                // The bubble sets weight 500 for the phrases it usually holds; four sentences at
                // that weight are a wall.
                /*
                  A step behind a heading, where there is one.

                  A tooltip paints on `surface-inverse`, whose one foreground role holds a fixed
                  lightness and has no muted counterpart — so "quieter than the line above" cannot
                  be named here the way it can on a page. With no heading there is nothing for the
                  prose to be quieter THAN, and it stays full strength.
                */
                props: { fontWeight: 'regular', lineHeight: 'normal', ...(opts.heading && { opacity: 0.8 }) },
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
          size: opts.size ?? 'sm',
          label: opts.label ?? 'How this works',
          // Quieter than the label it sits beside: an affordance for the curious, not a warning.
          color: 'text-faint',
          hoverProps: { color: 'text-muted' },
        },
        /*
          Sized, not inherited, on the small trigger.

          A `we-icon` inside a sized primitive takes `--we-context-icon-size`, which is 12px at
          `xs` — right for a glyph labelling a button and too small for one that IS the affordance,
          where it reads as a speck beside the word it belongs to. `xs` on the icon's own scale is
          16px, which is the same glyph a size up without making the button taller than the row.
        */
        children: [{ type: 'we-icon', props: { name: 'info', ...(opts.size === 'xs' && { size: 'xs' }) } }],
      },
    ],
  };
}
