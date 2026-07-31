export type * from './AvatarStack.types';

import { createMemo, For } from 'solid-js';

import type { AvatarEmphasis, AvatarInfo, AvatarStackProps, AvatarTone } from './AvatarStack.types';

/**
 * The default ring is not decoration — it is what separates overlapping avatars in the stack. So a
 * toned avatar swaps the ring's *colour* and never removes it; dropping it would let faces merge.
 */
const DEFAULT_RING = '0 0 0 2px var(--we-color-neutral-0, white)';

const TONE_RING: Record<AvatarTone, string> = {
  success: '0 0 0 2px var(--we-color-success-500)',
  warning: '0 0 0 2px var(--we-color-warning-500)',
  danger: '0 0 0 2px var(--we-color-danger-500)',
  primary: '0 0 0 2px var(--we-color-primary-500)',
  neutral: DEFAULT_RING,
};

const EMPHASIS_OPACITY: Record<AvatarEmphasis, string> = {
  full: '1',
  muted: '0.65',
  faded: '0.35',
};

function ringFor(avatar: AvatarInfo, fallback?: string): string {
  return avatar.tone ? TONE_RING[avatar.tone] : (fallback ?? DEFAULT_RING);
}

export function AvatarStack(props: AvatarStackProps) {
  const visible = createMemo(() => (props.avatars ?? []).slice(0, props.max ?? 5));
  const overlapPx = () => `${-(props.overlap ?? 8)}px`;

  return (
    <div style={{ display: 'flex', 'align-items': 'center', ...props.styles }}>
      <For each={visible()}>
        {(avatar, i) => (
          <div
            style={{
              display: 'flex',
              'margin-left': i() > 0 ? overlapPx() : '0',
              'flex-shrink': '0',
              opacity: EMPHASIS_OPACITY[avatar.emphasis ?? 'full'],
              // Fade rather than snap: emphasis tracks a decaying signal, so a step change reads as
              // a glitch where a fade reads as "we're losing them".
              transition: 'opacity var(--we-transition-400, 500ms) ease',
            }}
          >
            <we-avatar
              image={avatar.image ?? ''}
              hash={avatar.hash ?? ''}
              initials={avatar.initials ?? ''}
              icon={avatar.icon ?? ''}
              size={props.size ?? 'xs'}
              ring={ringFor(avatar, props.ring)}
            />
          </div>
        )}
      </For>
    </div>
  );
}
