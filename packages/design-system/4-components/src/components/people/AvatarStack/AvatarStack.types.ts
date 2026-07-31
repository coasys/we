/** Ring colour, as a semantic token rather than a CSS value, so themes stay in control. */
export type AvatarTone = 'success' | 'warning' | 'danger' | 'primary' | 'neutral';

/**
 * How prominent an avatar is. Separate from {@link AvatarTone} on purpose: an avatar can carry a
 * status *and* be de-emphasised, and callers routinely need both at once (e.g. "on Do Not Disturb,
 * and we are losing contact"). Folding them together would force a false choice.
 */
export type AvatarEmphasis = 'full' | 'muted' | 'faded';

export interface AvatarInfo {
  image?: string;
  hash?: string;
  initials?: string;
  icon?: string;
  /** Per-avatar ring colour. Overrides the stack-level `ring`. */
  tone?: AvatarTone;
  /** Per-avatar prominence. Defaults to `full`. */
  emphasis?: AvatarEmphasis;
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
