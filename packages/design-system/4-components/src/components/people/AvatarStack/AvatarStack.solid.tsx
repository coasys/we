export type * from './AvatarStack.types';

import { createMemo, For } from 'solid-js';

import type { AvatarStackProps } from './AvatarStack.types';

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
              ring={props.ring ?? '0 0 0 2px var(--we-color-neutral-0, white)'}
            />
          </div>
        )}
      </For>
    </div>
  );
}
