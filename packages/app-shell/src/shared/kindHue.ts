import { PALETTE_HUES, type PaletteHue } from '@we/tokens';

/**
 * The palette hue each core kind is drawn in, where the community has not chosen one — beside the
 * glyph in `BLOCK_ICONS`, because a kind's colour is part of how it is shown, like its icon.
 *
 * Palette hues rather than colours: the theme designs its palette to stay apart as categories, and
 * tunes it — a pastel theme draws pastel kinds, a dark one keeps them readable. A hex chosen against
 * one theme is a hole in the next. Chosen by what each kind is, and shared where kinds belong
 * together (video and audio); with more kinds than hues some must repeat, and the glyph is what
 * tells them apart. Anything not listed takes a hue from its name — see `kindHue`.
 */
export const BLOCK_HUES: Record<string, PaletteHue> = {
  AudioBlock: 'purple',
  CalloutBlock: 'yellow',
  CodeBlock: 'green',
  // The post-it.
  CollectionBlock: 'yellow',
  EmbedBlock: 'teal',
  EventBlock: 'pink',
  FileBlock: 'teal',
  ImageBlock: 'green',
  LinkBlock: 'cyan',
  LocationBlock: 'lime',
  TagBlock: 'red',
  TaskBlock: 'blue',
  TextBlock: 'orange',
  VideoBlock: 'purple',
};

/**
 * The hue a kind is drawn in: its own where it has one, else one taken from its name — the same on
 * every device and every load, so a community's newest model is coloured the moment it exists and
 * stays that colour, with nobody choosing.
 */
export function kindHue(kind: string): PaletteHue {
  const own = BLOCK_HUES[kind];
  if (own) return own;
  let hash = 0;
  for (const char of kind) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE_HUES[hash % PALETTE_HUES.length];
}
