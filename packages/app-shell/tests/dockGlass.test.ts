/**
 * A floating panel is glass; a displacing or maximised one is not.
 *
 * Asserted against the schema and against `resolveDock`'s own output, because the two halves fail
 * independently and both fail quietly. The frame's half is a condition on a store path — get the
 * path wrong and `$store` resolves to undefined, which is falsy, so every panel stays opaque and
 * looks exactly like a panel nobody had got round to styling. The geometry's half is the flag that
 * condition reads: `maximised` was added for this, and if it stops being set, a full-screen panel
 * turns translucent and blurs the whole window behind itself.
 *
 * Neither is covered anywhere else — `dockRegistry` is not under the schema validator's walk, which
 * only reaches `.schema.ts` files and what they import.
 */
import { describe, expect, it } from 'vitest';

import { resolveDock } from '../src/shared/dockGeometry';
import type { DockEntry } from '../src/shared/registries/dockRegistry';
import { dockFrame } from '../src/shared/registries/dockRegistry';

const entry = { id: 'call:0', moduleId: 'call', edge: 'bottom', aspect: 'dockAspect', close: 'closeStage' };
const viewport = { width: 1440, height: 900 };

/** A parked card, for the placements below to vary one field of. */
const card = { snap: 'bottom' as const, x: 400, y: 500, w: 640, h: 360 };

/** Every prop object in the tree, flattened, so a prop can be found without naming its depth. */
function allProps(node: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const item of node) allProps(item, found);
    return found;
  }
  if (!node || typeof node !== 'object') return found;
  const record = node as Record<string, unknown>;
  if (record.props && typeof record.props === 'object') found.push(record.props as Record<string, unknown>);
  for (const value of Object.values(record)) if (value && typeof value === 'object') allProps(value, found);
  return found;
}

/** The `$if` a prop is gated behind, if it is gated at all. */
type Gated = { $if: { condition: unknown; then?: unknown; else?: unknown } };
const gateOf = (value: unknown): Gated['$if'] | undefined =>
  value && typeof value === 'object' && '$if' in value ? (value as Gated).$if : undefined;

describe('a floating panel is glass', () => {
  const frame = dockFrame(entry as DockEntry, { type: 'Column' });
  const props = allProps(frame);

  /** The panel body: the one box carrying both a background and a backdrop-filter. */
  const surface = props.find((p) => p.bg !== undefined && p.styles !== undefined);

  it('makes the panel body translucent and blurred, both behind the same condition', () => {
    expect(surface).toBeDefined();
    const bg = gateOf(surface!.bg);
    const styles = gateOf(surface!.styles);

    expect(bg?.then).toContain('color-mix');
    expect(bg?.else).toBe('surface-sunken');
    expect(styles?.then).toEqual({ 'backdrop-filter': expect.stringContaining('blur(') });
    expect(styles?.else).toEqual({});

    // The blur must go exactly when the transparency does — over an opaque background it costs a
    // stacking context and a containing block for nothing anyone can see.
    expect(styles?.condition).toEqual(bg?.condition);
  });

  it('reads floating AND not maximised, off paths the geometry actually publishes', () => {
    const condition = gateOf(surface!.bg)?.condition as { $and: [{ $store: string }, { $not: { $store: string } }] };

    expect(condition.$and[0].$store).toBe('shellStore.dockGeometry.call:0.floating');
    expect(condition.$and[1].$not.$store).toBe('shellStore.dockGeometry.call:0.maximised');
  });

  it('carries the titlebar with it, so the card is one piece of glass', () => {
    // The titlebar is the box with a bottom border and a move handle under it.
    const bar = props.find((p) => p.borderBottom === '1px solid border' && p.bg !== undefined);
    expect(gateOf(bar!.bg)?.then).toContain('color-mix');
    expect(gateOf(bar!.bg)?.else).toBe('page');
  });
});

describe('the flag the frame reads', () => {
  it('is set for a maximised panel, which is floating but is not a card', () => {
    const geo = resolveDock(
      {
        id: 'call:0',
        edge: 'bottom',
        size: 'md',
        float: false,
        placement: { ...card, displace: false, maximised: true },
      },
      viewport,
    );
    expect(geo.floating).toBe(true);
    expect(geo.maximised).toBe(true);
  });

  it('is absent for an ordinary floating panel', () => {
    const geo = resolveDock(
      { id: 'call:0', edge: 'bottom', size: 'md', float: false, placement: { ...card, displace: false } },
      viewport,
    );
    expect(geo.floating).toBe(true);
    expect(geo.maximised).toBeFalsy();
  });

  it('is absent for a displacing panel, which is not floating either', () => {
    const geo = resolveDock(
      { id: 'call:0', edge: 'bottom', size: 'md', float: false, placement: { ...card, displace: true } },
      viewport,
    );
    expect(geo.floating).toBe(false);
    expect(geo.maximised).toBeFalsy();
  });
});
