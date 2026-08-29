import { describe, expect, it } from 'vitest';

import { getStaticDSStyles } from '../shared/helpers';
import DropZone from './drop-zone';

/**
 * Why the drop zone declares `--we-drop-zone-position` instead of writing `position: relative`.
 *
 * Every DS element adopts a *generated* stylesheet after its own Lit styles — last wins — and that
 * sheet sets every host-layout property from a custom property, `position` among them. So a
 * `position: relative` written in the component's own `css` block is overruled, the var is empty,
 * the declaration is invalid at computed-value time, and the host computes to `static`.
 *
 * The consequence was invisible in the right way: the ring below is `position: absolute; inset: 0`,
 * so with a static host it laid itself out against the nearest positioned ancestor — the docked
 * panel's frame. Every zone in a panel drew its feedback over the whole panel, and hovering a folder
 * tinted the entire Pocket, which reads exactly like the folder not being a drop target at all.
 *
 * These two assertions are the halves of that coupling. Either one alone looks like a detail.
 */
/**
 * The declarations only — comments stripped.
 *
 * Half of this file's prose discusses the very properties being asserted about, and a test that
 * cannot tell an explanation from a declaration is answered by rewording rather than by fixing
 * anything. The same reason the kit's store-naming check strips them.
 */
const cssTextOf = (ctor: unknown): string => {
  const styles = (ctor as { styles?: { cssText?: string }[] }).styles ?? [];
  return styles
    .map((s) => s.cssText ?? '')
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
};

describe('the ring needs a positioned host', () => {
  it('gets one through the property the generated sheet actually reads', () => {
    expect(cssTextOf(DropZone)).toContain('--we-drop-zone-position: relative');
  });

  it('and the generated sheet does read that property for position', () => {
    // If this stops being true, the line above becomes dead and the ring silently escapes its zone
    // again — with nothing on screen to say so except feedback in the wrong place.
    expect(getStaticDSStyles('drop-zone', ['layout'])).toContain('position: var(--we-drop-zone-position');
  });

  it('draws the ring inside its own bounds, where nothing can clip it', () => {
    const css = cssTextOf(DropZone);
    expect(css).toContain('inset: 0');
    // An outline with a positive offset is what this replaced: it draws outside the box, and every
    // zone that matters sits in something that clips.
    expect(css).not.toContain('outline-offset');
  });

  it('rings both states at the same weight', () => {
    // The fill already tells the two apart, and it is the louder signal; growing the ring as well
    // said it twice, and left the armed state a hairline that reads as an artefact at panel size.
    const rings = cssTextOf(DropZone).match(/inset 0 0 0 [^;]+/g) ?? [];
    expect(rings).toHaveLength(2);
    expect(new Set(rings.map((r) => r.split(' ')[4])).size).toBe(1);
  });
});
