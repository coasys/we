import type { AvatarTone } from '@we/tokens';

/**
 * Ring colour, named rather than spelled out, so themes stay in control.
 *
 * Re-exported rather than declared: the vocabulary is the token layer's, shared with the schema
 * kit's `badgedAvatar` so a tone means one colour wherever it is written. See `avatarToneRing`.
 */
export type { AvatarTone };

export interface AvatarInfo {
  image?: string;
  hash?: string;
  initials?: string;
  icon?: string;
  /**
   * Per-avatar ring colour. Overrides the stack-level `ring`.
   *
   * Colour rather than opacity is the only workable per-avatar signal here: avatars in a stack
   * overlap, so a translucent one shows the avatar behind it through itself. The ring is opaque
   * precisely to prevent that, which is why it is recoloured and never removed.
   */
  tone?: AvatarTone;
}

export interface AvatarStackProps {
  avatars: AvatarInfo[];
  max?: number;
  size?: 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
  overlap?: number;
  /**
   * Ring for every avatar, as a `box-shadow` value. A per-avatar `tone` takes precedence.
   *
   * Unset means no ring. Pass one where the avatars overlap and the surface behind them needs to
   * show between faces — `'0 0 0 2px var(--we-ring-color)'` is the idiom the templates use, since
   * that variable is the theme's and follows it.
   */
  ring?: string;
  styles?: Record<string, string | number>;
}
