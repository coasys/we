import type { SchemaNode, SchemaProp } from '@we/schema-shared';

export interface IconDiscOptions {
  /** The glyph's name. */
  icon: SchemaProp;
  /** The glyph's colour — a kind's colour, where it has one. Defaults to the ordinary text colour. */
  color?: SchemaProp;
  /**
   * The disc's ground, as a role. Pick the one a step off whatever it sits on: a card on a sunken
   * ground takes `surface-raised`, a modal's header on `surface` takes `surface-sunken`.
   */
  bg?: string;
  /** Diameter. Defaults to 48px: room around a glyph at its ordinary size, so it reads as a mark. */
  size?: string;
}

/**
 * A glyph in a round disc — how a *kind* of thing is marked wherever one is chosen or made.
 *
 * One fragment, so the card that offers a type and the form that creates one draw it the same way:
 * seeing the same disc on both sides of the click is what says "this is the thing you picked".
 */
export function iconDisc(opts: IconDiscOptions): SchemaNode {
  const size = opts.size ?? '48px';
  return {
    type: 'Column',
    props: {
      width: size,
      height: size,
      flexShrink: '0',
      r: 'full',
      ax: 'center',
      ay: 'center',
      bg: opts.bg ?? 'surface-sunken',
    },
    children: [{ type: 'we-icon', props: { name: opts.icon, color: opts.color ?? 'text' } }],
  };
}
