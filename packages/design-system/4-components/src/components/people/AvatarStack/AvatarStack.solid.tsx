export type * from './AvatarStack.types';

import { tokenVar } from '@we/design-utils';
import { createMemo, For, Show } from 'solid-js';

import type { AvatarInfo, AvatarStackProps } from './AvatarStack.types';

/*
  A face's ring is `we-avatar`'s own now — a tone drawn inside the face — rather than a box-shadow
  this component assembled and painted outside it. See `ringColor` on the primitive.
*/

function identityOf(avatar: AvatarInfo, index: number): string {
  return avatar.hash || avatar.image || avatar.initials || avatar.icon || `#${index}`;
}

export function AvatarStack(props: AvatarStackProps) {
  /**
   * One entry per person, in order, however many times the source repeated them.
   *
   * Deduped here rather than expected of the caller because the lists this renders come from
   * add-only relations, where a repeat is normal and means nothing: a call's `participants` is
   * appended to by every agent transcribing it, with no coordination between them, so a two-person
   * call routinely carries each of them several times over. That is the right way to write the data
   * — a read-modify-write would drop whoever lost the race — and the wrong thing to draw.
   */
  const everyone = createMemo(() => {
    const seen = new Set<string>();
    const unique: AvatarInfo[] = [];
    (props.avatars ?? []).forEach((avatar, index) => {
      const identity = identityOf(avatar, index);
      if (seen.has(identity)) return;
      seen.add(identity);
      unique.push(avatar);
    });
    return unique;
  });

  /** The faces that fit. Capped after the dedupe, so `max` counts people rather than links. */
  const visible = createMemo(() => everyone().slice(0, props.max ?? 5));
  /** How many people the cap is hiding — the number the chip exists to stop swallowing. */
  const hidden = createMemo(() => everyone().length - visible().length);
  const overlapPx = () => `${-(props.overlap ?? 8)}px`;
  const sizeVar = () => `var(--we-avatar-size-${props.size ?? 'xs'})`;

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
              prop:ringColor={avatar.tone || ''}
              prop:ringWidth={props.ringWidth ?? ''}
              prop:edgeColor={props.edge ?? ''}
            />
          </div>
        )}
      </For>
      {/*
        The overflow count.

        Not decoration: `max` used to drop everyone past it in silence, so a twelve-person call drew
        five faces and read as a five-person call. A stack that cannot show everyone should at least
        not misreport how many there are.

        Sized off the avatar token rather than a fixed px so it stays a circle beside the faces at
        every size, and carrying the same ring, so it reads as part of the row rather than after it.
      */}
      <Show when={hidden() > 0}>
        <div
          style={{
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'margin-left': visible().length > 0 ? overlapPx() : '0',
            'flex-shrink': '0',
            width: sizeVar(),
            height: sizeVar(),
            // The avatar group, not a literal circle: this chip sits in the row *as* one of the
            // faces, so a theme that squares them off has to square this too or the row ends in an
            // odd one out. Safe as a percentage for the same reason the avatars are — it is square.
            'border-radius': tokenVar('radius', 'avatar'),
            background: 'var(--we-role-control-surface)',
            color: 'var(--we-role-text)',
            'font-size': 'var(--we-font-size-100)',
            'font-weight': '600',
            // The same band the faces carry, drawn the same way — inside — so the chip is their size.
            'box-shadow': props.edge ? `inset 0 0 0 1.5px ${props.edge}` : '',
          }}
        >
          +{hidden()}
        </div>
      </Show>
    </div>
  );
}
