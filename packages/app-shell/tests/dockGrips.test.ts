/**
 * The grips a panel's frame draws, and where the ones it does not draw went.
 *
 * A boundary several panels share — the seam between two lane-mates, a lane's inner edge — is no one
 * frame's to draw: two grips for one line, each resizing only its own panel, felt like neither. Those
 * are the lane's now (`EdgeLanes`), inside it, over its frames. What made that hard over the window
 * was layering — panels carry their own z-index steps above `PANEL_LAYER_BASE`, a grip bound to a
 * layer *name* fell under every panel ever raised, and its inboard half was painted over. In a lane
 * the frames stand down from layering altogether, and the lane's grips sit over them in its own
 * stacking context.
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
    // One per side of the panel. The corner grips are `we-move-handle` and are not counted, and the
    // boundaries a lane's panels share are drawn by the lane.
    expect(all.length).toBe(4);
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

  it('stands a frame in a lane down from layering, so the lane’s grips paint over it', () => {
    const box = (function find(node: unknown): Record<string, unknown> | undefined {
      if (Array.isArray(node)) return node.map(find).find(Boolean);
      if (!node || typeof node !== 'object') return undefined;
      const record = node as Record<string, unknown>;
      const props = record.props as Record<string, unknown> | undefined;
      if (props && 'data-we-dock-frame' in props) return props;
      return Object.values(record).map(find).find(Boolean);
    })(frame);

    expect(path(box?.zIndex)).toBe(
      "shellStore.dockGeometry['transcribe:transcript'].inLane || shellStore.dockGeometry['transcribe:transcript'].home ? null : shellStore.dockGeometry['transcribe:transcript'].layer",
    );
  });

  it('leaves the panel’s own edge grips inside its frame, where a name is right', () => {
    // Absolutely positioned within the frame's own stacking context, flush with its border rather
    // than straddling it — so there is nothing of another panel for it to fall under.
    const inside = all.filter((props) => props.position === 'absolute');

    expect(inside.length).toBeGreaterThan(0);
    for (const props of inside) expect(props.zIndex).toBe('sticky');
  });
});
