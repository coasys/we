export type * from './AvatarStack.types';

import { tokenVar } from '@we/design-utils';
import { avatarToneRing } from '@we/tokens';
import { createMemo, For, Show } from 'solid-js';

import type { AvatarInfo, AvatarStackProps } from './AvatarStack.types';

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
/*
  The tone → ring map used to live here, as five hand-written box-shadows. It is the token layer's
  now, because it was never only this component's: the rail draws the same kind of ring around the
  same kind of face, and the two spellings had already diverged — scale positions here, role names
  there — so the same word meant two colours depending on which grammar you wrote it in.

  Why the colours stay scale positions rather than becoming roles is argued at `avatarToneRing`.
*/
function ringFor(avatar: AvatarInfo, fallback?: string): string | undefined {
  return avatar.tone ? avatarToneRing(avatar.tone) : fallback;
}

/**
 * Who an entry is, for the purpose of "have we already drawn them".
 *
 * `hash` first because that is the identity: callers seed it with a DID precisely so the generated
 * avatar is stable per agent. The rest are fallbacks for stacks built from something other than
 * agents, and an entry with none of them is treated as its own person rather than folded in with
 * every other blank — a stack of unidentified faces should still show how many there are.
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
              ring={ringFor(avatar, props.ring)}
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
            'box-shadow': props.ring ?? '',
          }}
        >
          +{hidden()}
        </div>
      </Show>
    </div>
  );
}
