/**
 * The precision a token table records its computed numbers at — what makes `tokens/<theme>.json`
 * a function of the themes rather than of the Chrome that recorded it.
 *
 * Chrome serialises a computed number to six significant digits, and the last of them is not
 * stable across versions: the same theme computed `oklab(0.97725 0.0000485216 -0.00277974)` in one
 * and `…0.0000485202…` in another, `color(srgb 0.270313 …)` in one and `0.270312` in the next.
 * Those are float noise in a colour-space conversion, not a different colour.
 *
 * So every number in a colour, length or number token is rounded to **four decimal places**, half
 * away from zero on the decimal text, trailing zeros trimmed, `-0` written `0`, never in exponent
 * form:
 *
 * - The disagreements seen sit at the fifth decimal and below; four drops them.
 * - It loses nothing anyone can see. Colour channels live in 0–1 (OKLab/OKLCH lightness, sRGB),
 *   0–0.4 (chroma) or 0–360 (hue): 0.0001 is twenty times under the ~0.002 OKLab difference a
 *   viewer can notice, and a ten-thousandth of a degree of hue. A length is px, where 0.0001px is
 *   no device pixel.
 * - Fewer places would merge values the themes mean to keep apart — the lightness ramp steps by
 *   0.0202 at the dark end (`oklch(0.2202 …)`, `oklch(0.2404 …)`), and a 0.01 step would sit two
 *   places from a rounding boundary.
 *
 * Text that is not a number keeps its spelling: `oklch`, `srgb`, `display-p3`, units, `%`, `none`.
 */

/**
 * A CSS number token: optional sign, digits with an optional fraction (or a bare fraction), an
 * optional exponent. The lookbehind keeps it out of identifiers, so `display-p3` and `--we-x2` are
 * left alone while the `-0.5` in `oklab(0.5 -0.5 0)` is read whole.
 */
const NUMBER = /(?<![\w.-])-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi;

export const TOKEN_DECIMALS = 4;

/**
 * One number at the recorded precision: `0.270313` → `"0.2703"`, `-0.00001` → `"0"`.
 *
 * Rounded on the decimal text, half away from zero, rather than through `toFixed`: the binary
 * double nearest `0.97725` is a hair under it, so `toFixed(4)` gives `0.9772` where the written
 * number — the one another implementation reads — rounds to `0.9773`.
 */
export function roundTokenNumber(text: string | number): string {
  let s = typeof text === 'number' ? String(text) : text.trim();
  // Exponent form (`4.85216e-05`) is written out first, to more places than the rounding reads.
  if (/e/i.test(s)) s = Number(s).toFixed(TOKEN_DECIMALS + 4);
  const negative = s.startsWith('-');
  const [int = '0', frac = ''] = s.replace(/^[-+]/, '').split('.');
  const digits = frac.padEnd(TOKEN_DECIMALS + 1, '0');
  let scaled = BigInt((int || '0') + digits.slice(0, TOKEN_DECIMALS));
  if (digits[TOKEN_DECIMALS] >= '5') scaled += 1n;
  if (scaled === 0n) return '0';
  const unit = 10n ** BigInt(TOKEN_DECIMALS);
  const kept = (scaled % unit).toString().padStart(TOKEN_DECIMALS, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${scaled / unit}${kept ? `.${kept}` : ''}`;
}

/** Every number inside a computed colour, length or number value, at the recorded precision. */
export function normaliseTokenNumbers(value: string): string {
  return value.replace(NUMBER, (m) => roundTokenNumber(m));
}
