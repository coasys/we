import { describe, expect, it } from 'vitest';

import DatePicker from '../primitives/date-picker';
import IconPicker from '../primitives/icon-picker';
import Input from '../primitives/input';
import LocationPicker from '../primitives/location-picker';
import NumberInput from '../primitives/number-input';
import Select from '../primitives/select';
import TextArea from '../primitives/textarea';
import { fieldSurface } from './field-surface';

/**
 * The field family agrees about what a field looks like.
 *
 * It stopped agreeing once already, and nothing said so. `we-select` was moved onto the recessed
 * fill and the ring; `we-location-picker`, `we-icon-picker` and `we-date-picker` kept the values
 * they had been copied with, and `we-number-input` kept the `page` fill the whole change had been
 * about. Each looked fine alone — a control is only obviously wrong beside the ones it is meant to
 * match, and the create-space modal is where that finally happened.
 *
 * So these assert the agreement rather than the appearance. A new field control that hardcodes its
 * own fill fails here on the day it is written, instead of on the day somebody opens a form holding
 * both.
 */

/** The declarations, comments stripped — half of this file's subject matter is discussed in prose. */
const declarations = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

const cssTextOf = (ctor: unknown): string => {
  const styles = (ctor as { styles?: ({ cssText?: string } | { cssText?: string }[])[] }).styles ?? [];
  return declarations(
    styles
      .flat()
      .map((s) => s.cssText ?? '')
      .join('\n'),
  );
};

/** The controls that paint a field on an inner shadow part, and the part each one paints. */
const PART_PAINTED: [string, unknown, string[]][] = [
  ['we-location-picker', LocationPicker, ["[part='trigger']"]],
  ['we-icon-picker', IconPicker, ["[part='trigger']", "[part='search']", "[part='emoji-input']"]],
  ['we-date-picker', DatePicker, ["[part='input-wrapper']", "input[part='time']"]],
  // The control the three rules were written on first and copied outward from. It is in this list
  // rather than asserted separately because "one definition" has to include the original — a
  // reference that merely happens to agree is how the family drifted the first time.
  ['we-select', Select, ["[part='input-wrapper']"]],
];

/** The controls that paint it on their own host, through DEFAULT_PROPS. */
const HOST_PAINTED: [string, unknown][] = [
  ['we-input', Input],
  ['we-textarea', TextArea],
  ['we-number-input', NumberInput],
];

const defaultsOf = (ctor: unknown) => (ctor as { getDefaultProps(): Record<string, unknown> }).getDefaultProps();

describe('fieldSurface is the one definition', () => {
  it.each(PART_PAINTED)('%s uses it for every field box it draws', (_name, ctor, parts) => {
    const css = cssTextOf(ctor);
    // The whole block, verbatim — Lit inlines an interpolated CSSResult's text, so a component that
    // called the function has it character for character, and one that reimplemented it does not.
    for (const part of parts) {
      const drawn = [fieldSurface(part), fieldSurface(part, ':focus-within')].map((r) => declarations(r.cssText));
      expect(drawn.some((text) => css.includes(text))).toBe(true);
    }
  });

  it.each(PART_PAINTED)('%s hardcodes no field fill of its own', (_name, ctor) => {
    // `surface` is the sheet a field sits ON. A field painted with it disappears into the modal or
    // the card behind it, which is exactly the bug this file exists for.
    expect(cssTextOf(ctor)).not.toMatch(/background:\s*var\(--we-role-surface\)/);
  });

  it.each(PART_PAINTED)('%s answers focus with the ring rather than an inset halo', (_name, ctor) => {
    // The old spelling: `2px solid accent-muted` inset by -1px, which read as a halo inside the edge
    // rather than as the edge thickening — and made these the controls answering focus differently.
    expect(cssTextOf(ctor)).not.toContain('outline-offset: -1px');
    expect(cssTextOf(ctor)).toContain('--we-ring-color');
  });
});

describe('the host-painted fields say the same thing in DS props', () => {
  it.each(HOST_PAINTED)('%s rests on the sunken well', (_name, ctor) => {
    expect(defaultsOf(ctor).bg).toBe('surface-sunken');
  });

  it.each(HOST_PAINTED)('%s marks keyboard focus', (_name, ctor) => {
    // we-number-input had no focus state at all, and its inner input is `all: unset` — so tabbing
    // into it put the caret somewhere with nothing on screen saying where. WCAG 2.4.7.
    expect(defaultsOf(ctor).focusProps).toMatchObject({ ring: '0 0 0 1px var(--we-ring-color)' });
  });

  it.each(HOST_PAINTED)('%s answers the pointer with the fill, not the edge alone', (_name, ctor) => {
    // The WELL's hover, not the surface's. `surface-hover` is measured for a row sitting ON a
    // surface, so on a recessed field it landed at about surface level and the recess vanished
    // under the pointer — see the role's own note.
    expect(defaultsOf(ctor).hoverProps).toMatchObject({ bg: 'surface-sunken-hover' });
  });
});

describe('every field answers the pointer', () => {
  // we-input's note argues for lifting the fill on hover by pointing at we-select's trigger — which
  // had no hover rule at all, leaving it the only field in the family that did not respond. The
  // claim and the code now agree.
  it.each(PART_PAINTED)('%s changes fill on hover, not the edge alone', (_name, ctor) => {
    expect(cssTextOf(ctor)).toContain('background: var(--we-role-surface-sunken-hover)');
  });
});
