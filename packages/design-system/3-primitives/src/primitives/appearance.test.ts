import { role } from '@we/tokens';
import { describe, expect, it } from 'vitest';

import { ALERT_APPEARANCE_DEFAULTS, ALERT_VARIANT_FILL } from './alert';
import { BADGE_APPEARANCE_DEFAULTS } from './badge';

/**
 * What an appearance is allowed to paint.
 *
 * `variant` says which meaning a badge or an alert carries; `appearance` says how loud it is. The
 * pair is easy to extend and easy to get wrong in one specific way, which is what this guards.
 *
 * **A fill's label is not a colour anybody may choose.** `on-success` and friends look like fixed
 * white in `@we/tokens` — `oklch(100% 0 …)` — and they are not: `FILL_LABELS` in `@we/themes`
 * corrects every one of them at apply time against wherever its fill actually landed. `success`
 * sits at lightness 75 and `warning` at 76, so a hand-written white label on either is unreadable
 * in the light themes and nothing measures it. Naming the `on<Fill>` role is what opts a solid
 * badge into that correction; naming `white`, `text`, or `success-text` opts out of it silently.
 *
 * So the rule asserted below is structural rather than a snapshot of today's values: in a solid
 * appearance, the label must be the `on-` form of the fill underneath it. A new variant cannot
 * satisfy that by accident.
 */

/** The kebab spelling a schema writes, for every role that exists. */
const ROLE_NAMES = new Set(Object.keys(role).map((k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)));

const colorsOf = (table: Record<string, Record<string, unknown>>) =>
  Object.entries(table).flatMap(([appearance, variants]) =>
    Object.entries(variants).flatMap(([variant, props]) =>
      Object.entries(props as Record<string, string>).map(([prop, value]) => ({
        where: `${appearance}/${variant}.${prop}`,
        value,
      })),
    ),
  );

describe('badge and alert appearances', () => {
  it('paint only colours that are roles', () => {
    // A scale position here would be invisible to the contrast layer, which operates on roles: it
    // is never measured against what is behind it and never appears in the theme editor's audit.
    // `role-audit` cannot see these — it walks composed schemas, and these are in DS source.
    for (const table of [BADGE_APPEARANCE_DEFAULTS, ALERT_APPEARANCE_DEFAULTS]) {
      for (const { where, value } of colorsOf(table)) {
        expect(ROLE_NAMES, `${where} paints "${value}"`).toContain(value);
      }
    }
  });

  it('label every solid badge fill with that fill’s own corrected label', () => {
    for (const [variant, props] of Object.entries(BADGE_APPEARANCE_DEFAULTS.solid)) {
      // `neutral` is the exception, and the only one: there is no `on-control-surface`, because a
      // neutral fill is not a hue whose lightness moves with a theme parameter — it is a step on
      // the ramp, which `text` is already measured against.
      if (variant === 'neutral') {
        expect(props).toEqual({ bg: 'control-surface', color: 'text' });
        continue;
      }
      expect(props.color, `solid/${variant} label`).toBe(`on-${props.bg}`);
    }
  });

  it('keeps every appearance covering exactly the same variants', () => {
    // A variant missing from one appearance falls through to `{}`, so the badge would paint its
    // DEFAULT_PROPS — a neutral chip where a danger one was asked for. Silent, and the wrong colour
    // is a plausible one, so it survives a glance.
    for (const table of [BADGE_APPEARANCE_DEFAULTS, ALERT_APPEARANCE_DEFAULTS]) {
      const [first, ...rest] = Object.values(table).map((v) => Object.keys(v).sort());
      for (const keys of rest) expect(keys).toEqual(first);
    }
  });

  it('leaves the soft appearance as the tinted pair both components already had', () => {
    // The default, so this is the assertion that nothing already on screen moved. Both tables are
    // asserted because the two drifting apart is exactly what happened to the field family.
    for (const table of [BADGE_APPEARANCE_DEFAULTS.soft, ALERT_APPEARANCE_DEFAULTS.soft]) {
      expect(table.success).toMatchObject({ bg: 'success-surface', color: 'success-text' });
      expect(table.warning).toMatchObject({ bg: 'warning-surface', color: 'warning-text' });
      expect(table.danger).toMatchObject({ bg: 'danger-surface', color: 'danger-text' });
    }
  });

  it('draws an accent alert’s edge in a fill, never in a text or surface role', () => {
    // The point of the appearance: the edge is the whole signal, so it takes the status at full
    // strength. A `*-text` role here would be the pale-in-dark mistake the transcribe panel's
    // record icon had, and a `*-surface` one would be the tint this exists to replace.
    for (const [variant, fill] of Object.entries(ALERT_VARIANT_FILL)) {
      expect(ROLE_NAMES, `${variant} edge`).toContain(fill);
      expect(fill, `${variant} edge`).not.toMatch(/-text$|-surface$|-muted$/);
    }
  });

  it('gives an accent alert ordinary body text', () => {
    // Colouring the words as well would leave a paragraph of `warning-text` on a plain surface,
    // which is less legible than either the tint or the edge alone.
    for (const props of Object.values(ALERT_APPEARANCE_DEFAULTS.accent)) {
      expect(props).toEqual({ bg: 'surface', color: 'text' });
    }
  });
});
