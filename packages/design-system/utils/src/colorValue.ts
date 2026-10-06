/**
 * A colour as a style rule or a theme value writes it, turned into CSS a browser can paint.
 *
 * Moved here from the graph's Solid adapter so the globe resolves the same values the same way: both
 * read style rules in one dialect, and a role, a scale position or a blend of two must mean the same
 * colour on a card and on a pin.
 */
import { ROLE_NAMES } from './index';

/**
 * A **role** first, then a scale position, then raw CSS.
 *
 * The same precedence the design system's own resolver uses, and it was missing here — every colour
 * in a graph resolved to `--we-color-<token>`, so a style rule could only ever name a scale
 * position. That is the one thing a scale position cannot do: it is a step on a ramp that flips with
 * the theme's polarity, so cards picked to look like pale tints in a light theme came out as deep
 * ones in a dark theme, and no choice of number fixes both. A role is what a theme *redefines*.
 *
 * Scale positions stay, and stay right for what they are for: a palette, where the colours mean
 * "different from each other" rather than "this kind of thing".
 *
 * Unknown names fall through to `--we-color-<token>` exactly as before, so nothing that worked
 * stops — including a name this build's role list has not heard of.
 */
/** One colour inside a `color-mix`: a role or a scale position resolved, anything else left as CSS. */
function mixStop(stop: string): string {
  if (ROLE_NAMES.has(stop)) return `var(--we-role-${stop})`;
  if (/^(neutral|primary|success|warning|danger)-\d+$/.test(stop)) return `var(--we-color-${stop})`;
  // A nested mix gets the same treatment; a CSS colour, a function or a name is CSS already.
  return /^color-mix\(/i.test(stop) ? colorValueCss(stop, '') : stop;
}

/** Split on commas that are not inside brackets — the arguments of a CSS function. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (text[i] === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

export function colorValueCss(value: string | undefined, fallback: string): string {
  /*
    `||`, not `??`: an empty value means "nothing chosen" and should reach the fallback, where `??`
    took it as a choice and returned it. And the fallback is resolved by the same rules rather than
    returned raw — every caller passes a role name (`page`), so returning it untouched produced
    `background: page`, which is not a colour. Unreachable while every caller also passes a value,
    which is the kind of trap that waits for the caller that does not.
  */
  const token = value || fallback;
  if (!token) return '';
  /*
    A CSS colour, passed through untouched.

    The modern functions were missing — `oklch()`, `oklab()`, `lab()`, `lch()`, `hwb()`, `color()` —
    so a card fill written in one became `var(--we-color-oklch(90% 0.06 150))`, which is not a
    variable and paints nothing. Silent, and reachable by a person rather than only by an author:
    `we-color-picker` emits **oklch** as one of its four formats, so picking a colour for a card in
    that format left the card uncoloured with nothing to say why.
  */
  if (/^#/.test(token)) return token;
  /*
    A mix, with its colours resolved by these same rules — a heat scale blends between two stops a reader
    picked, and those may be tokens or roles that only mean anything here. Passed through whole, as it
    used to be, `color-mix(in oklch, accent 40%, primary-100)` names two colours CSS has never heard of.
    Each argument after the colour space is a colour with an optional share. Only a role or a scale
    position is resolved inside one: a bare word there may equally be a CSS colour name (`red`), and a
    mix written in plain CSS has to come out exactly as it went in.
  */
  const mix = /^color-mix\(\s*(in [^,]+),(.*)\)$/i.exec(token);
  if (mix) {
    const parts = splitTopLevel(mix[2]).map((part) => {
      const piece = /^(.*?)(\s+[\d.]+%)?$/.exec(part.trim());
      const [, stop = '', share = ''] = piece ?? [];
      return `${mixStop(stop.trim())}${share}`;
    });
    return `color-mix(${mix[1].trim()}, ${parts.join(', ')})`;
  }
  if (/^(rgba?|hsla?|oklch|oklab|lch|lab|hwb|color|var)\(/i.test(token)) return token;
  if (/^(transparent|currentcolor)$/i.test(token)) return token;
  if (ROLE_NAMES.has(token)) return `var(--we-role-${token})`;
  return `var(--we-color-${token})`;
}
