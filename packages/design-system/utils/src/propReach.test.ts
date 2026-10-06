/**
 * Every layout prop reaches CSS on both paths.
 *
 * There are two implementations of "a DS prop becomes a style", and a prop added to `layoutKeys`
 * is only live if BOTH of them know about it:
 *
 * - **The Solid components** (`Column`/`Row`/`Grid`) go through `buildLayoutStyles`, which returns
 *   an object applied as inline style.
 * - **The Lit primitives** (`we-*`) set a custom property per prop and ship a generated stylesheet
 *   whose declarations read those properties. The declarations come from the `PropSpec` tables.
 *
 * `flexShrink` was in `layoutKeys` and in `buildLayoutStyles` and in neither of the primitives'
 * halves, so it worked on a `Column` and did nothing at all on a `we-icon` — 217 places across the
 * composed templates asked something not to shrink and were ignored. Nothing reported it: the prop
 * is declared, so it type-checks; it is a recognised key, so the schema validator accepts it; and
 * the component path works, so testing it on a `Row` proves nothing about a primitive.
 *
 * The point of this test is the silence, as it is for `offsets.test.ts` next door. It compares the
 * two implementations against each other rather than against a list of expected CSS, so it keeps
 * holding as props are added — which is the failure mode, since the hazard is a prop reaching one
 * path and not the other.
 */
import { describe, expect, it } from 'vitest';

import {
  BASE_FLEX_SPECS,
  BASE_LAYOUT_SPECS,
  BASE_TYPOGRAPHY_SPECS,
  BASE_VISUAL_SPECS,
  buildLayoutStyles,
  HOST_LAYOUT_SPECS,
  layoutKeys,
} from './index';

/** Every CSS property the primitives' generated stylesheet declares, from the spec tables. */
const DECLARED = new Set(
  [...HOST_LAYOUT_SPECS, ...BASE_LAYOUT_SPECS, ...BASE_FLEX_SPECS, ...BASE_TYPOGRAPHY_SPECS, ...BASE_VISUAL_SPECS].map(
    ([cssProp]) => cssProp,
  ),
);

/**
 * A value each layout prop can plausibly hold, so `buildLayoutStyles` emits something for it.
 *
 * Written out rather than generated: the point is to drive the real function with real values, and
 * a prop whose value shape is wrong here would be silently skipped — which is the bug this is
 * supposed to catch.
 */
const SAMPLE: Record<string, unknown> = {
  flex: '1',
  flexShrink: 0,
  alignSelf: 'center',
  width: '100px',
  height: '100px',
  minWidth: '0',
  minHeight: '0',
  maxWidth: '100px',
  maxHeight: '100px',
  position: 'absolute',
  top: '400',
  right: '400',
  bottom: '400',
  left: '400',
  zIndex: 'modal',
  // Not 'flex', which is what the baseline below already emits for a column — a sample equal to
  // the baseline value cannot show that the prop reached anything.
  display: 'grid',
  overflow: 'hidden',
  overflowX: 'auto',
  overflowY: 'auto',
  scrollbarWidth: 'none',
  scrollbarGutter: 'stable',
  m: '400',
  mx: '400',
  my: '400',
  mt: '400',
  mr: '400',
  mb: '400',
  ml: '400',
};

/*
  What `buildLayoutStyles` emits for no props at all — its own structural baseline for a flex
  container (`display`, `flex-direction`, `flex-wrap`).

  Compared by VALUE rather than subtracted by key, because `display` is both a baseline property
  and a prop in its own right: dropping it by name made the one prop that collides with the
  baseline look as though it reached nothing.
*/
const BASELINE: Record<string, unknown> = buildLayoutStyles({}, 'column');

describe('layout props reach CSS on both paths', () => {
  it('has a sample value for every layout key', () => {
    // Otherwise a key added to `layoutKeys` would be skipped below and the test would pass blind.
    expect(layoutKeys.filter((k) => !(k in SAMPLE))).toEqual([]);
  });

  for (const key of layoutKeys) {
    it(`${key} is emitted by the components path and declared for primitives`, () => {
      const styles = buildLayoutStyles({ [key]: SAMPLE[key] } as never, 'column') as Record<string, unknown>;
      const emitted = Object.keys(styles).filter((p) => styles[p] !== BASELINE[p]);

      expect(emitted, `buildLayoutStyles emits nothing for ${key}`).not.toEqual([]);
      for (const cssProp of emitted) {
        expect(DECLARED, `no PropSpec declares ${cssProp}, so ${key} does nothing on a we-* element`).toContain(
          cssProp,
        );
      }
    });
  }
});
