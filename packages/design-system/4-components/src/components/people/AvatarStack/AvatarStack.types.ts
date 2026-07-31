/** Ring colour, as a semantic token rather than a CSS value, so themes stay in control. */
export type AvatarTone = 'success' | 'warning' | 'danger' | 'primary' | 'neutral';

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
  /** Ring for every avatar. A per-avatar `tone` takes precedence. */
  ring?: string;
  styles?: Record<string, string | number>;
}
