import type { SchemaNode, SchemaProp } from '@we/schema-shared';
import { avatarSize, type AvatarTone, avatarToneColor, avatarToneRing } from '@we/tokens';

/**
 * A face, optionally ringed, optionally marked in the corner — "something is true of this person
 * or place".
 *
 * ## Why this is a fragment and not a prop on `we-avatar`
 *
 * Because it is arrangement: a box, an offset, a colour and a glyph, with no measurement, no focus
 * management and no browser API anywhere in it. `we-avatar` did once carry two marks of its own —
 * a `selected` ring and an `online` dot — and they are the argument against the shape: each was one
 * fixed colour in one fixed position, neither could be extended from a template, and the corner one
 * had already made a *third* kind of mark impossible to express without avoiding it. An open
 * vocabulary of tones and glyphs costs nothing and answers the next case too.
 *
 * The primitive also has no `<slot>`, so a mark could never have been projected into it regardless.
 *
 * ## The ring rides the avatar
 *
 * It is the avatar's own `ring` prop — a `box-shadow` — rather than a border on a box around it.
 * Three things fall out of that, all of which the wrapper version got wrong: a box-shadow takes no
 * part in layout, so ringing a face never changes the height of the row it sits in; it follows the
 * avatar's `border-radius`, so a theme that squares avatars off gets a squared-off ring instead of
 * a circle cutting the corners; and it is the same mechanism `AvatarStack` rings with, in the same
 * tone vocabulary, so the two agree by construction.
 *
 * ## Everything is derived from `size`
 *
 * The badge's diameter, its padding, its glyph and its offset are all fractions of the avatar,
 * expressed as `calc()` over the size token so they stay right if the token moves. The fractions
 * are the ones the rail arrived at for a 32px face — an 18px disc, its centre on the circumference
 * — and they now hold at every size. Written as literals they held at exactly one: the same
 * `-4px` that puts the disc on the rim of an `sm` avatar leaves it 1.5px short of an `xs` one,
 * silently, with nothing to say so.
 */
export interface BadgedAvatarOptions {
  /** What the face is built from. `name` seeds both the initials and the generated identicon. */
  avatar: { src?: SchemaProp; name?: SchemaProp; icon?: SchemaProp };
  /** Avatar size — a token, or any CSS length. Everything else here is derived from it. */
  size?: string;
  /** Ring the face in a tone. Omitted, there is no ring. */
  ring?: AvatarTone;
  /** A glyph in a disc on the face's bottom-right edge. Omitted, the face renders bare. */
  badge?: { icon: SchemaProp; tone?: AvatarTone };
}

/*
  The badge, as fractions of the face. From the rail's 32px case: a 4px pad around a 10px glyph.
*/
const DISC_PAD = 4 / 32;
const DISC_GLYPH = 10 / 32;
const DISC = DISC_PAD * 2 + DISC_GLYPH;

/*
  The offset that lands the disc's centre on the circumference at 45°.

  A circle's corner is not on the circle, which is the whole reason this is not zero: flush with the
  face's box, the disc sits well inside the rim and reads as sitting *on* the face rather than at
  its edge. `(1 − 1/√2) / 2` is how far in from the corner the circumference is; half the disc backs
  it off again so the disc is centred there rather than starting there.
*/
const EDGE = ((1 - Math.SQRT1_2) / 2 - DISC / 2).toFixed(4);

const SIZE_TOKENS = new Set(Object.keys(avatarSize));

/** The face's diameter as a CSS length, whether it was named as a token or given outright. */
const dimensionOf = (size: string): string => (SIZE_TOKENS.has(size) ? `var(--we-avatar-size-${size})` : size);

export function badgedAvatar(opts: BadgedAvatarOptions): SchemaNode {
  const size = opts.size ?? 'sm';
  const dim = dimensionOf(size);

  const face: SchemaNode = {
    type: 'we-avatar',
    props: {
      ...(opts.avatar.src !== undefined && { image: opts.avatar.src }),
      ...(opts.avatar.name !== undefined && { initials: opts.avatar.name, hash: opts.avatar.name }),
      ...(opts.avatar.icon !== undefined && { icon: opts.avatar.icon }),
      size,
      ...(opts.ring && { ring: avatarToneRing(opts.ring) }),
    },
  };

  // No badge, no box: a ring needs nothing around it, so the fragment costs a wrapper only when
  // there is something to position inside one.
  if (!opts.badge) return face;

  return {
    type: 'Column',
    props: {
      position: 'relative',
      // The wrapper stands in for the avatar wherever the avatar would have gone, and `we-avatar`
      // defaults to `flex: '0 0 auto'`. Without this the mark is shrinkable where the bare face was
      // not, so a long name beside it in a row would squash it.
      flex: '0 0 auto',
    },
    children: [
      face,
      {
        /*
          The disc is a wrapper, not the icon: `we-icon` takes layout props only, so `bg`, `r` and
          `p` on it resolve to nothing and the badge is a bare glyph on the avatar's edge. The
          validator catches this, which is how it was found.
        */
        type: 'Column',
        props: {
          position: 'absolute',
          bottom: `calc(${dim} * ${EDGE})`,
          right: `calc(${dim} * ${EDGE})`,
          bg: avatarToneColor(opts.badge.tone ?? 'success'),
          r: 'full',
          p: `calc(${dim} * ${DISC_PAD})`,
          ax: 'center',
          ay: 'center',
        },
        children: [
          {
            type: 'we-icon',
            props: { name: opts.badge.icon, size: `calc(${dim} * ${DISC_GLYPH})`, color: 'on-accent' },
          },
        ],
      },
    ],
  };
}
