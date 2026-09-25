/**
 * A grip that straddles a panel has to be told which layer to paint at.
 *
 * Both grips drawn from *outside* a panel's frame — the seam between two lane-mates, and the lane's
 * own outer edge — overlap the panels they belong to, because a displacing lane has no gap and the
 * line is centred on the boundary. So half of each lies over a panel, and panels carry their own
 * z-index steps above `PANEL_LAYER_BASE` so that clicking one brings it forward.
 *
 * A layer *name* therefore cannot work, and the failure is silent and visual: `sticky` is `200`,
 * which is `PANEL_LAYER_BASE` exactly, so the grip falls under every panel that has ever been
 * raised, its inboard half is painted over, and the line comes out at about half the thickness of
 * every other grip in the app. That is how it was noticed — as "is this one 2px?" — rather than as
 * anything failing.
 *
 * `seamLayer` documents the rule and the lane grip repeated the mistake anyway, so it is pinned here
 * for both rather than left to the docblock.
 *
 * Asserted against the schema, like the titlebar and layering tests: what is being protected is what
 * each grip is *bound to*, not how it draws.
 */
import { describe, expect, it } from 'vitest';

import type { DockEntry } from '../src/shared/registries/dockRegistry';
import { dockFrame } from '../src/shared/registries/dockRegistry';

const entry = { id: 'transcribe:transcript', moduleId: 'transcribe', edge: 'left' } as DockEntry;

/** Every `we-resize-handle` in the frame, as its props. */
function grips(node: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const item of node) grips(item, found);
    return found;
  }
  if (!node || typeof node !== 'object') return found;
  const record = node as Record<string, unknown>;
  if (record.type === 'we-resize-handle') found.push((record.props ?? {}) as Record<string, unknown>);
  for (const value of Object.values(record)) grips(value, found);
  return found;
}

const frame = dockFrame(entry, { type: 'Column' });
const all = grips(frame);

/** The store path a prop reads, or `''` for a literal. */
const path = (value: unknown): string =>
  value && typeof value === 'object' && '$' in value ? (value as { $: string }).$ : '';

describe('the grips a panel frame draws', () => {
  it('finds all of them, so nothing below is vacuous', () => {
    // One per side of the panel, plus the two drawn from outside it: the seam to its lane-mate and
    // the lane's own outer edge. The corner grips are `we-move-handle` and are not counted.
    expect(all.length).toBe(6);
  });

  it('draws every one at the same thickness', () => {
    /*
      One number, in one place each, and they were already agreed — the lane grip only *looked*
      thinner. Pinned anyway: three call sites spelling a literal is exactly how the letter-spacing
      on the panel headers ended up with three different values.
    */
    const thicknesses = new Set(
      all.map((props) => (props.styles as Record<string, string> | undefined)?.['--we-resize-handle-thickness']),
    );

    expect([...thicknesses]).toEqual(['3px']);
  });

  it('paints a grip drawn from outside a panel above the panels it crosses', () => {
    // Bound to a published layer rather than a name. See the file docblock for what a name does.
    const straddling = all.filter((props) => props.position === 'fixed');

    expect(straddling.length).toBe(2);
    for (const props of straddling) {
      expect(path(props.zIndex)).toMatch(/Layer$/);
      expect(props.zIndex).not.toBe('sticky');
    }
  });

  it('leaves the panel’s own edge grips inside its frame, where a name is right', () => {
    // Absolutely positioned within the frame's own stacking context, flush with its border rather
    // than straddling it — so there is nothing of another panel for it to fall under.
    const inside = all.filter((props) => props.position === 'absolute');

    expect(inside.length).toBeGreaterThan(0);
    for (const props of inside) expect(props.zIndex).toBe('sticky');
  });
});
