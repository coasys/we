import { role } from '@we/tokens';
import { describe, expect, it } from 'vitest';

import { ALERT_EDGE_FILL, ALERT_VARIANT_DEFAULTS } from './alert';
import { BADGE_VARIANT_DEFAULTS } from './badge';
import { TAG_VARIANT_DEFAULTS } from './tag';

/**
 * What a variant is allowed to paint.
 *
 * `tone` says which colour family a badge, a tag or an alert is in; `variant` says how loud it is.
 * A toned element draws with the accent's roles, which the tone re-points at its family, so each
 * table holds two rows — the neutral look and the toned one — rather than one per family. The pair
 * is easy to extend and easy to get wrong in one specific way, which is what this guards.
 *
 * **A fill's label is not a colour anybody may choose.** `on-accent` looks like fixed white in
 * `@we/tokens` — `oklch(100% 0 …)` — and it is not: `FILL_LABELS` in `@we/themes` corrects every
 * family's label at apply time against wherever its fill actually landed, and a tone hands the
 * element that family's corrected label. A yellow fill sits high enough that white on it is
 * unreadable, and nothing measures a label pinned here. Naming `on-accent` is what opts a solid
 * badge into that correction; naming `white`, `text`, or `accent-text` opts out of it silently.
 *
 * So the rule asserted below is structural rather than a snapshot of today's values: in a solid
 * variant, the toned label must be the `on-` form of the fill underneath it.
 */

/** The kebab spelling a schema writes, for every role that exists. */
const ROLE_NAMES = new Set(Object.keys(role).map((k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)));

const TABLES = { badge: BADGE_VARIANT_DEFAULTS, tag: TAG_VARIANT_DEFAULTS, alert: ALERT_VARIANT_DEFAULTS };

const colorsOf = (name: string, table: Record<string, Record<string, Record<string, unknown>>>) =>
  Object.entries(table).flatMap(([variant, looks]) =>
    Object.entries(looks).flatMap(([look, props]) =>
      Object.entries(props as Record<string, string>).map(([prop, value]) => ({
        where: `${name} ${variant}/${look}.${prop}`,
        value,
      })),
    ),
  );

describe('badge, tag and alert variants', () => {
  it('paint only colours that are roles', () => {
    // A scale position here would be invisible to the contrast layer, which operates on roles: it
    // is never measured against what is behind it and never appears in the theme editor's audit.
    // `role-audit` cannot see these — it walks composed schemas, and these are in DS source.
    for (const [name, table] of Object.entries(TABLES)) {
      for (const { where, value } of colorsOf(name, table)) {
        expect(ROLE_NAMES, `${where} paints "${value}"`).toContain(value);
      }
    }
  });

  it('label every toned solid fill with that fill’s own corrected label', () => {
    for (const table of [BADGE_VARIANT_DEFAULTS, TAG_VARIANT_DEFAULTS]) {
      const { bg, color } = table.solid.toned;
      expect(color).toBe(`on-${bg}`);
    }
  });

  it('draw a toned look from the accent’s roles alone', () => {
    // The tone re-points the accent. A toned look naming `success` or `danger` directly would paint
    // that family whatever the tone said — a `tone: 'teal'` badge drawn green.
    for (const [name, table] of Object.entries(TABLES)) {
      for (const [variant, looks] of Object.entries(table)) {
        for (const value of Object.values(looks.toned)) {
          if (value === 'surface' || value === 'text') continue;
          expect(String(value), `${name} ${variant}/toned`).toMatch(/accent/);
        }
      }
    }
  });

  it('leaves the soft variant as the tinted pair these components already had', () => {
    // The default, so this is the assertion that nothing already on screen moved.
    for (const table of [BADGE_VARIANT_DEFAULTS, TAG_VARIANT_DEFAULTS, ALERT_VARIANT_DEFAULTS]) {
      expect(table.soft.toned).toMatchObject({ bg: 'accent-soft', color: 'accent-text' });
    }
  });

  it('draws an alert’s edge in a fill, never in a text or surface role', () => {
    // The point of the variant: the edge is the whole signal, so it takes the family at full
    // strength. A `*-text` role here would be the pale-in-dark mistake the transcribe panel's
    // record icon had, and a `*-soft` one would be the tint this exists to replace.
    for (const [look, fill] of Object.entries(ALERT_EDGE_FILL)) {
      expect(ROLE_NAMES, `${look} edge`).toContain(fill);
      expect(fill, `${look} edge`).not.toMatch(/-text$|-soft$|-muted$/);
    }
  });

  it('gives an edge alert ordinary body text', () => {
    // Colouring the words as well would leave a paragraph of `warning-text` on a plain surface,
    // which is less legible than either the tint or the edge alone.
    for (const props of Object.values(ALERT_VARIANT_DEFAULTS.edge)) {
      expect(props).toEqual({ bg: 'surface', color: 'text' });
    }
  });
});
