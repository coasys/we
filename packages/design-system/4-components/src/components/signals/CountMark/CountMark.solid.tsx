export type * from './CountMark.types';

import { Row } from '../../../frameworks/solid';
import type { CountMarkProps } from './CountMark.types';

/**
 * A filled glyph and how many, coloured by whether the viewer is one of them.
 *
 * ## Why this is a component and not three nodes in a template
 *
 * Because it is drawn in two languages and they drifted. `SignalControl` draws a heart and a like
 * count in TSX; the cards feed draws a speech bubble and a comment count in a schema, beside it, on
 * the same row — and the pair came out at different sizes, in different colours, responding to the
 * pointer differently. Twice. The kit's rule is that three uses justify an extraction *or* one
 * divergence that is already a bug, and this is the second kind.
 *
 * It is not merely that they were written twice. A schema **cannot** say what this says: the resting
 * colour is a scale position, because `text-faint` — the quietest foreground the system has — is
 * still too loud for a filled 16px glyph, which is solid ink where the role was tuned for the
 * strokes of text. `role-audit` refuses a scale position in a template, rightly, since it freezes a
 * colour into one theme's idea of which greys are quiet. So the choice was between a schema that
 * could not match and a component that both can name. This is that component.
 *
 * ## The colour, and the one thing it means
 *
 * Quiet at rest, one step MORE present under the pointer — more, not less: a lower scale position
 * is nearer the background whichever way the ramp runs, because the background moves with it, so a
 * pair written the other way round recedes from the pointer in every theme.
 *
 * Accent when it is `mine`, at the saturated step rather than at `accent-text`, which is tuned for
 * legible prose and reads thin as a glyph. One meaning on the channel: not whether a panel is open,
 * not whether anybody else has been here.
 *
 * ## The colour is on the ROW
 *
 * The digits sit outside the button — they are not part of the target — so a colour on the control
 * leaves them at the inherited near-black beside a faint grey mark, and a hover lights one of the
 * two. `bare` is the appearance-free variant and inherits its colour, so the pair set here reaches
 * the glyph, the number and both states from one place. Hovering anywhere on the row lights both,
 * which is also the truer reading: a mark and its tally are one thing to look at.
 */
export function CountMark(props: CountMarkProps) {
  const size = () => props.size ?? 'md';
  /** Closed up as the control shrinks: at a thread's weight, a wide gap reads as two things. */
  const gap = () => (size() === 'md' ? '300' : '100');
  /**
   * Stated rather than inherited from the button below `md`.
   *
   * A `we-icon` nested in a sized primitive takes `--we-context-icon-size`, which is 12px at `xs` —
   * right for an icon that labels a button, too small for a mark that IS the control. At `md` the
   * button is big enough for that rule to be right, so nothing is said and it inherits.
   */
  const glyph = () => ({ xs: '16px', sm: '18px', md: '' })[size()];
  /** One step behind the glyph, as a caption is. Empty at `md`, where the inherited size is right. */
  const digits = () => ({ xs: '100', sm: '200', md: '' })[size()];

  return (
    <Row
      class={`count-mark ${props.class || ''}`}
      styles={props.styles}
      ay="center"
      gap={gap()}
      color={props.mine ? 'primary-500' : 'neutral-300'}
      hoverProps={{ color: props.mine ? 'primary-500' : 'neutral-400' }}
    >
      <we-button
        variant="bare"
        size={size()}
        p="0"
        disabled={props.disabled ?? false}
        label={props.label || ''}
        onClick={() => props.onPress?.()}
      >
        {/*
          Filled at both states, and coloured rather than outlined-then-filled: an outline that
          becomes a fill changes the SHAPE on press, which reads as the glyph being swapped. The
          colour carries "mine", and the shape stays put.
        */}
        <we-icon name={props.icon} weight="fill" size={glyph()} />
      </we-button>
      {/*
        `prop:fontSize`, not `fontSize`. A camelCase prop with a computed value on a `we-*` element
        compiles to a lowercased property assignment Lit never reads — see `check:we-props`.
      */}
      <we-number class="count-mark__count" prop:fontSize={digits()} value={props.count ?? 0} shorten />
    </Row>
  );
}
