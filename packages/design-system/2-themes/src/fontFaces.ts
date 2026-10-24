/**
 * A theme's own typefaces, carried in the theme rather than fetched.
 *
 * A face is a `data:` URL of the font file and the name it is used under. Carried, because a theme
 * comes from other people: a face fetched from a URL would tell a third party who opened the space,
 * from where and when — the reason `sanitiseCss` drops `@import` and `url()` from every theme. And
 * registered through the FontFace API rather than written as an `@font-face` rule, so nothing a theme
 * supplies is ever parsed as CSS.
 *
 * Faces are registered on the document, as every `@font-face` is — a shadow root cannot hold one — so
 * a face a space's theme brings is nameable anywhere while that theme is on screen, and is withdrawn
 * when no theme on screen carries it.
 */
import type { ThemeOverrides } from './overrides';

export interface FontFaceSetting {
  /** The name the face is used under: `fontFamily: "'VT323', monospace"`. */
  family: string;
  /** The font file as a `data:` URL — woff2, woff, ttf or otf. */
  src: string;
  /** `400`, `700`, or a range for a variable font: `100 900`. */
  weight?: string;
  style?: 'normal' | 'italic';
  /** Which characters the file covers, as `@font-face`'s `unicode-range` reads it. */
  unicodeRange?: string;
}

/** A face larger than this is refused: a theme is synced to everybody who opens the space. */
export const MAX_FONT_FACE_BYTES = 2 * 1024 * 1024;

const FONT_DATA_URL =
  /^data:(font\/(woff2|woff|ttf|otf)|application\/(font-woff2?|x-font-(ttf|otf)|octet-stream));base64,[A-Za-z0-9+/=]+$/;
const FAMILY_NAME = /^[\p{L}\p{N} _-]{1,64}$/u;

/** Why a face cannot be used, or null when it can. */
export function fontFaceProblem(face: FontFaceSetting): string | null {
  if (!FAMILY_NAME.test(face.family)) return 'a family name is letters, numbers, spaces and hyphens';
  if (!FONT_DATA_URL.test(face.src)) return 'a face is a font file as a base64 data: URL';
  if (face.src.length * 0.75 > MAX_FONT_FACE_BYTES) return 'a face is at most 2 MB';
  return null;
}

/** The faces each root's theme carries, so a face is withdrawn when nothing on screen does. */
const facesByRoot = new WeakMap<HTMLElement, FontFace[]>();
const inUse = new Map<FontFace, number>();
const registered = new Map<string, FontFace>();

const keyOf = (face: FontFaceSetting) =>
  `${face.family}|${face.weight ?? ''}|${face.style ?? ''}|${face.src.length}|${face.src.slice(-32)}`;

/** Register the faces `theme` carries for `root`, and withdraw the ones its last theme carried. */
export function applyFontFaces(root: HTMLElement, theme: ThemeOverrides): void {
  const doc = root.ownerDocument;
  if (!doc?.fonts || typeof FontFace !== 'function') return;
  const next: FontFace[] = [];
  for (const face of theme.fontFaces ?? []) {
    if (fontFaceProblem(face)) continue;
    const key = keyOf(face);
    let loaded = registered.get(key);
    if (!loaded) {
      loaded = new FontFace(face.family, `url(${face.src})`, {
        weight: face.weight ?? 'normal',
        style: face.style ?? 'normal',
        ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
      });
      registered.set(key, loaded);
      doc.fonts.add(loaded);
      void loaded.load().catch(() => {});
    }
    next.push(loaded);
    inUse.set(loaded, (inUse.get(loaded) ?? 0) + 1);
  }
  for (const previous of facesByRoot.get(root) ?? []) {
    const count = (inUse.get(previous) ?? 1) - 1;
    if (count > 0) {
      inUse.set(previous, count);
      continue;
    }
    inUse.delete(previous);
    doc.fonts.delete(previous);
    for (const [key, face] of registered) if (face === previous) registered.delete(key);
  }
  facesByRoot.set(root, next);
}

/** The families a theme carries, for a font picker to offer beside the built-in ones. */
export function fontFaceFamilies(theme: ThemeOverrides): string[] {
  return [...new Set((theme.fontFaces ?? []).filter((face) => !fontFaceProblem(face)).map((face) => face.family))];
}
