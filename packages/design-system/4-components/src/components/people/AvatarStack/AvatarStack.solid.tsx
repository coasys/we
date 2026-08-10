export type * from './AvatarStack.types';

import { createMemo, For } from 'solid-js';

import type { AvatarInfo, AvatarStackProps, AvatarTone } from './AvatarStack.types';

/**
 * There is no default ring. A ring reads as a deliberate mark — selection, presence, a tone — so a
 * stack that paints one nobody asked for is making a claim about the avatars it does not have.
 *
 * It once defaulted to `neutral-0`, on the reasoning that overlapping faces need separating. That
 * colour is only the surface colour on a surface that happens to be `neutral-0`; on any other card
 * it is a visible band, and because the neutral scale inverts under the dark themes it landed at 8%
 * lightness there — a black ring around every stacked avatar. Separation is the caller's call to
 * make against the surface they know they are on: pass `ring`, or set `overlap: 0`.
 */
const TONE_RING: Record<AvatarTone, string> = {
  success: '0 0 0 2px var(--we-color-success-500)',
  warning: '0 0 0 2px var(--we-color-warning-500)',
  danger: '0 0 0 2px var(--we-color-danger-500)',
  primary: '0 0 0 2px var(--we-color-primary-500)',
  neutral: '0 0 0 2px var(--we-color-neutral-500)',
};

function ringFor(avatar: AvatarInfo, fallback?: string): string | undefined {
  return avatar.tone ? TONE_RING[avatar.tone] : fallback;
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
