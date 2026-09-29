/**
 * A `--we-ds-*` var belongs to one element, and must not reach its descendants.
 *
 * The design system's state and tier props work by moving an element's ordinary props out of its
 * inline style into custom properties, which a generated stylesheet then reads back. Custom
 * properties inherit, so before `@property … inherits: false` every interactive descendant read its
 * ancestor's values for everything it did not set itself.
 *
 * It cost a byline: a row with `width: '100%'` and a `hoverProps` passed that width down to the pair
 * of icon buttons inside it, which have a `focusProps` of their own and no width. They took the
 * whole line, overflowed it, and left the face, name and time beside them squeezed to min-content —
 * so the name broke one word per line at every width, and the buttons sat over the avatar.
 *
 * Nothing about that is visible in jsdom, and nothing about it is visible in the markup either: both
 * rows' declarations are correct, and the leak is in the cascade between them.
 */
export const name = 'ds vars do not inherit';
export const scenario = 'ds:nested-interactive';
export const widths = [320];

export async function check({ measureAll }) {
  const problems = [];

  // Document order: the outer row, then the pair of buttons inside it.
  const [outer, inner] = await measureAll('[data-we-interactive]');
  if (!outer || !inner) return ['expected two interactive rows, found ' + (outer ? 1 : 0)];

  if (inner.w >= outer.w) {
    problems.push(
      `the inner row is ${inner.w}px inside a ${outer.w}px row — it has no width of its own, so it ` +
        `has inherited --we-ds-width from its ancestor`,
    );
  }
  // And the thing that leak actually breaks: the item beside it loses the whole line.
  const text = (await measureAll('we-text')).find((b) => b.w && b.h);
  if (text && text.h > 24) problems.push(`the text beside it is ${text.h}px tall — wrapped`);

  return problems;
}
