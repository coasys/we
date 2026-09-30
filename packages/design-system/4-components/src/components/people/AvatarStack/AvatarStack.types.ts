import type { AvatarTone } from '@we/tokens';

/**
 * Ring colour, named rather than spelled out, so themes stay in control.
 *
 * Re-exported rather than declared: the vocabulary is the token layer's, shared with the schema
 * kit's `badgedAvatar` so a tone means one colour wherever it is written. See `ringColor` on `we-avatar`.
 */
export type { AvatarTone };

export interface AvatarInfo {
  image?: string;
  hash?: string;
  initials?: string;
  icon?: string;
  /**
   * A ring on this face, in a tone — drawn inside the face, so a ringed face is the size of the rest.
   * Empty for none.
   *
   * Colour rather than opacity is the only workable per-avatar signal here: avatars in a stack
   * overlap, so a translucent one shows the avatar behind it through itself.
   */
  tone?: AvatarTone | '';
}

export interface AvatarStackProps {
  avatars: AvatarInfo[];
  max?: number;
  size?: 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
  overlap?: number;
  /**
   * The colour behind the stack, drawn as a thin band just inside each face's edge — how
   * overlapping faces stay apart. A CSS colour or role variable: `var(--we-role-surface)` on a card.
   *
   * Unset means none, and it has to be named rather than defaulted, because only the caller knows
   * what the stack is sitting on: a band in the wrong colour reads as a border. This replaced `ring`,
   * a `box-shadow` string most callers filled with `var(--we-ring-color)` — the theme's *focus*
   * colour — so every stack in the app wore a permanent accent ring nobody chose, and it was drawn
   * outside the faces, making them look bigger than their size.
   */
  edge?: string;
  /** How thick each face's tone ring is — any CSS length. Unset for the size's own default. */
  ringWidth?: string;
  styles?: Record<string, string | number>;
}
