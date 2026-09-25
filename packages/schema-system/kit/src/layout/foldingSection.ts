import type { ExpressionToken, SchemaNode } from '@we/schema-shared';

import { sectionLabel } from './panelShell.ts';

/**
 * Carets are a size below the glyphs they sit beside.
 *
 * A disclosure arrow is punctuation, not content: at a status glyph's 24px it reads as another
 * thing to look at rather than as a hint about where the row goes.
 */
export const CARET_SIZE = 'xs';

/**
 * Where a section keeps whether it is open.
 *
 * Two shapes, because the sections in this app come from two places and a fragment that knew only
 * the first would leave half of them out. A panel's own sections are fixed when the template is
 * written, so each gets a boolean. Sections that come from DATA — one per extraction pass, one per
 * type on a graph's key, one per reaction — cannot: a `$localState` field name is fixed and the
 * rows are not, so the open ones are held as a set of ids and asked about with `in`.
 */
export interface FoldState {
  /** The `$localState` field holding it: a `boolean`, or an `array` when `value` is given. */
  field: string;
  /**
   * The id of THIS section, when one field holds the open ones for many.
   *
   * A plain string is a literal id (`'prompt'`); a token is an expression naming the row
   * (`{ $: 'pass.passId' }`), which is what a section inside an `$each` wants.
   */
  value?: string | ExpressionToken;
}

/** The expression that answers whether this section is open. */
export function isOpen(open: FoldState): string {
  if (open.value === undefined) return `local.${open.field}`;
  const id = typeof open.value === 'string' ? `'${open.value.replace(/'/g, "\\'")}'` : open.value.$;
  return `${id} in local.${open.field}`;
}

/** The handler that folds it — one of the two toggles, matching the two shapes of state. */
function fold(open: FoldState): Record<string, unknown> {
  return open.value === undefined ? { $toggleLocal: open.field } : { $toggleLocalIn: open.field, value: open.value };
}

export interface FoldingSectionLabelOptions {
  /** What the region below is. An expression where it depends on what is being shown. */
  label: string | ExpressionToken;
  /** Where the open/closed state lives. */
  open: FoldState;
  /**
   * How much is under it, as an expression — `count(local.passes)`.
   *
   * What tells somebody whether folding is worth it, and the reason a fold is offered at all.
   * Omit it where the size is not a number worth showing; the caret is drawn either way.
   */
  count?: string;
  /**
   * `neutral` for a section that is not a verdict.
   *
   * The other two mean something: amber is work waiting on a person, green is work that landed. A
   * log is neither — it counts how many times something has been read, which is no more a status
   * than a timestamp is, and spending a status colour on it would say the readings are themselves
   * either pending or good.
   */
  tone?: 'neutral' | 'warning' | 'success';
  /**
   * A control about the whole section — an export, a picker — drawn between the name and the count.
   *
   * The heading is a `<button>`, and a button inside a button is invalid markup that would also
   * toggle the section on the way past. So with an action the heading splits in two: the name, and
   * the count with its caret, each its own bare button folding the same section, with the action in
   * the gap between them.
   */
  action?: SchemaNode;
  /** How the region works, behind an info glyph beside the label. As on `sectionLabel`. */
  help?: string | ExpressionToken;
}

/**
 * A section's name, the size of what is under it, and the control that folds it — one row.
 *
 * ## Why this is shared rather than written per panel
 *
 * It was written four times in one panel, and then differently in six other places: the rail, the
 * graph's key, the extraction log's panes, a reply thread, a reactions list. Between them they
 * disagreed about the letter-spacing (five values), about how to spell the caps (`textTransform`
 * versus `we-text`'s own shorthand), and about which way the caret points. None of that is a
 * decision anybody made twice; it is the same decision made once and then copied imperfectly.
 *
 * ## The whole row is the button, not the caret
 *
 * It was the caret alone, on the reasoning that `sectionLabel` draws a label and a label is not a
 * control. That is true of the fragment and does not decide this: the label stays a label, and a
 * *control wraps it*. What the narrow reading cost was a hit target the size of a glyph at the far
 * end of a row whose obvious target is the word naming the thing — and headings where the caret
 * moved and the words did not, which reads as two different kinds of row.
 *
 * `bare` is the appearance-free clickable — a real `<button>`, with the keyboard activation and the
 * role that a `Row` carrying an `onClick` silently loses — so the heading looks exactly as it did.
 * The hover band is the affordance the caret's own darkening used to be, and it is the row's own
 * box: no padding is added, so the name stays aligned with the cards underneath it.
 *
 * ## What names it, and what says it is open
 *
 * Nothing names it explicitly: the accessible name comes from the contents, so it is "Logs 3" — the
 * section and its size, which is what the ARIA disclosure pattern asks a disclosure button to be
 * called. An icon-only caret had to be named by hand only because it had nothing to take a name
 * from.
 *
 * Whether it is *open* is `we-button`'s `expanded`, which is the prop this fragment was the reason
 * for: a schema assigns props as DOM properties, so until the primitive declared one there was no
 * way for any of these rows to say so, and the caret said it only to people who could see it.
 */
export function foldingSectionLabel(opts: FoldingSectionLabelOptions): SchemaNode {
  const open = isOpen(opts.open);
  const toggle = (children: SchemaNode[], extra: Record<string, unknown> = {}): SchemaNode => ({
    type: 'we-button',
    props: {
      variant: 'bare',
      // Nothing paints on hover: the pointer is the affordance, and a band the width of the panel
      // lighting up under the cursor is a lot of movement for a heading somebody is passing over on
      // the way to the cards. The radius is for the focus ring, which `we-button` draws itself and
      // which `bare` would otherwise take around a square-cornered full-width row.
      r: '200',
      expanded: { $: open },
      onClick: fold(opts.open),
      ...extra,
    },
    children,
  });

  const labelOptions = opts.help === undefined ? { label: opts.label } : { label: opts.label, help: opts.help };

  if (!opts.action) {
    return toggle([sectionLabel({ ...labelOptions, aside: foldingCount(opts) })], { width: '100%' });
  }
  return {
    type: 'Row',
    props: { ay: 'center', gap: '200', width: '100%' },
    children: [
      toggle([sectionLabel(labelOptions)], { flex: '1', minWidth: '0' }),
      opts.action,
      // Named for what it does: its contents are a number and a caret, which say nothing read aloud.
      toggle([foldingCount(opts)], { label: `Show or hide ${String(nameOf(opts.label)).toLowerCase()}` }),
    ],
  };
}

/** The words of a label, for naming a control after it — an expression has none to give. */
function nameOf(label: string | ExpressionToken): string {
  return typeof label === 'string' ? label : 'this section';
}

/** The count and the caret at the end of a folding heading. */
function foldingCount(opts: FoldingSectionLabelOptions): SchemaNode {
  return {
    // `200`, where the label sits `200` from the badge: the caret is a separate thing from the
    // count, and at `100` the two read as one object with a number in it.
    type: 'Row',
    props: { ay: 'center', gap: '200' },
    children: [
      ...(opts.count
        ? [
            {
              type: 'we-badge',
              props: {
                size: 'xs',
                variant: opts.tone ?? 'neutral',
                appearance: 'solid',
                /*
                  Square at its narrowest, and wider only when the number needs it.

                  A badge is sized by its content, so `3` came out as a squat lozenge and `12` as a
                  wider one — every section's chip a different shape, and none of them the round-ish
                  counter a count wants to be. The floor is the badge's own height, written as the
                  same expression `SIZE_DEFAULTS` gives it so a theme's `control-height-offset` moves
                  both together and it cannot go oblong the moment a theme changes density.

                  Only a floor: two digits are wider than 24px with the padding an `xs` badge carries,
                  so they grow, which is the half a fixed width would have lost.
                */
                minWidth: 'calc(var(--we-component-height-xs) + var(--we-theme-control-height-offset, 0px))',
              },
              children: [{ $: opts.count }],
            } as SchemaNode,
          ]
        : []),
      /*
        A plain icon, not a button: the heading around it is a `<button>`, and a button inside a
        button is invalid markup — it would also take the press on the way past and toggle twice.
      */
      {
        type: 'we-icon',
        props: {
          size: CARET_SIZE,
          color: 'text-faint',
          name: { $: `${isOpen(opts.open)} ? 'caret-up' : 'caret-down'` },
        },
      },
    ],
  };
}

export interface FoldingBodyOptions {
  /** The same state the heading folds. */
  open: FoldState;
  /** What is under the heading. */
  children: SchemaNode[];
  /**
   * Keep the content mounted while it is folded away.
   *
   * Off by default, and the default is the right one for a list: the point of folding a list is
   * that it has got large, so leaving a screenful of cards rendered would be folding away the only
   * thing it cost.
   *
   * On where unmounting would throw something away that cannot be rebuilt from a store — a
   * half-typed reply, a scroll position somebody is coming back to.
   */
  keepMounted?: boolean;
}

/**
 * What folds away under the heading.
 *
 * `reveal` alone, which is the one place this departs from the general advice to pair it with a
 * fade. A fade is there to stop a box appearing fully opaque on its first frame, and that reads as
 * a jump when something arrives *over* the page — a popover, a sheet. A section opening in place
 * pushes what is below it down, and the movement is itself the announcement; a fade on top of that
 * reads as the rows arriving twice.
 *
 * Exit is quicker than entry. Closing is an act somebody just took and is already sure about, where
 * opening is a reveal they are waiting to read.
 */
export function foldingBody(opts: FoldingBodyOptions): SchemaNode {
  const transitions = {
    enterTransition: { type: 'reveal', duration: 200 },
    exitTransition: { type: 'reveal', duration: 160 },
  };
  const body: SchemaNode =
    opts.children.length === 1
      ? opts.children[0]
      : { type: 'Column', props: { width: '100%' }, children: opts.children };

  return opts.keepMounted
    ? { type: '$animate', props: { condition: { $: isOpen(opts.open) }, ...transitions }, children: [body] }
    : { type: '$if', props: { condition: { $: isOpen(opts.open) }, ...transitions, then: body } };
}
