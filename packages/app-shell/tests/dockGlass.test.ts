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

/** The ternary a prop is gated behind, if it is gated at all: `condition ? then : else`. */
const gateOf = (value: unknown): { condition: string; then: string; else: string } | undefined => {
  if (!value || typeof value !== 'object' || !('$' in value)) return undefined;
  const match = /^(.*?) \? (.*) : ([^:]*)$/.exec((value as { $: string }).$);
  return match ? { condition: match[1], then: match[2], else: match[3] } : undefined;
};

describe('a floating panel is glass', () => {
  const frame = dockFrame(entry as DockEntry, { type: 'Column' });
  const props = allProps(frame);

  /** The panel body: the one box carrying both a background and a backdrop-filter. */
  const surface = props.find((p) => p.bg !== undefined && p.styles !== undefined);

  it('makes the panel body translucent and blurred, both behind the same condition', () => {
    expect(surface).toBeDefined();
    const bg = gateOf(surface!.bg);
    const styles = gateOf((surface!.styles as Record<string, unknown>)['backdrop-filter']);

    expect(bg?.then).toContain('color-mix');
    expect(styles?.then).toContain('blur(');
    expect(styles?.else).toBe("'none'");

    /*
      Both halves come from the theme, not from numbers written here.

      This is the assertion with a story: the first version of this hardcoded 50% and 12px, so a
      theme setting `surfaceOpacity` or `surfaceBlur` would have restyled every Card and every
      modal — which read the same two variables — and left the panels alone, silently. The panel is
      the one surface in the app that would have disagreed with the theme.
    */
    expect(bg?.then).toContain('var(--we-theme-surface-opacity');
    expect(styles?.then).toContain('var(--we-theme-surface-blur');
    // `in srgb`, as Card and overlay-element spell it — the mix space is part of the shared idiom.
    expect(bg?.then).toContain('in srgb');

    // The blur must go exactly when the transparency does — over an opaque background it costs a
    // stacking context and a containing block for nothing anyone can see.
    expect(styles?.condition).toEqual(bg?.condition);
  });

  it('reads floating AND not maximised, off paths the geometry actually publishes', () => {
    const condition = gateOf(surface!.bg)?.condition;

    expect(condition).toBe(
      "shellStore.dockGeometry['call:0'].floating && !shellStore.dockGeometry['call:0'].maximised",
    );
  });

  /**
   * A panel is the app's own ground, extended — not a hole in it and not a card on it.
   *
   * It was `surface-sunken`, which is `page` *minus* lightness: the role for a well recessed into a
   * surface, so every docked panel came out darker than the page beside it. `surface` and
   * `surface-raised` are the other error, `page` *plus* lightness — the relationship a card wants
   * when the page is still visible around it, which for a panel that abuts or covers the content it
   * never is. Nothing failed in either direction, because a role that resolves is a role that
   * paints; this is the assertion instead.
   */
  it('paints the page, not a well and not a card', () => {
    const bg = (surface!.bg as { $: string }).$;

    // The *roles* named, not the string: the glass branch legitimately reads the theme's
    // `--we-theme-surface-opacity`, which is a knob rather than a surface.
    expect(bg).not.toContain('--we-role-surface');
    expect(bg).not.toMatch(/'surface(-\w+)?'/);
    expect(bg).toContain('--we-role-page');
    expect(bg).toContain("'page'");
  });

  it('carries the titlebar with it, so the card is one piece of glass', () => {
    // The titlebar is the box with a bottom border and a move handle under it.
    const bar = props.find((p) => p.borderBottom === '1px solid border' && p.bg !== undefined);
    expect(gateOf(bar!.bg)?.then).toContain('color-mix');
    expect(gateOf(bar!.bg)?.else).toBe("'page'");
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
