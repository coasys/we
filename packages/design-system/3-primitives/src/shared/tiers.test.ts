/**
 * Breakpoint tiers on the Lit primitives.
 *
 * The interesting property is that these rules live *inside* the primitive's own adopted
 * stylesheet, several shadow boundaries below the `$surface` they query. That works because
 * container selection walks the flat tree — a rule authored in a shadow root matches a container
 * declared outside it — which was checked against Chrome 150 and Firefox 152 rather than inferred.
 */
import { designSystemKeys, filterProps, getKeysForLayers, tierKeys } from '@we/design-utils';
import { describe, expect, it } from 'vitest';

import { getStaticDSStyles, TIERS_ATTR } from './helpers';

describe('getStaticDSStyles — tier queries', () => {
  const button = getStaticDSStyles('button');

  it('emits one layer per tier, each with a query for the host and for [part=base]', () => {
    expect(button.match(/@container we-surface/g)?.length).toBe(3);
    expect(button).toContain(`@layer we-tier-md { @container we-surface (min-width: 900px) { :host([${TIERS_ATTR}]) {`);
    expect(button).toContain(`:host([${TIERS_ATTR}]) [part='base'] {`);
  });

  it('has a tier name only what it sets, and roll back to the tier beneath for the rest', () => {
    // Cascade-through: something set only in smUpProps still applies at lg, because lg reverts to md,
    // md to sm, and sm to the base rule — which keeps the component's own token fallback, so an
    // lgUpProps mentioning one prop cannot blank the rest.
    expect(button).toContain('gap: var(--we-button-lg-gap, revert-layer);');
    expect(button).toContain('gap: var(--we-button-sm-gap, revert-layer);');
    expect(button).not.toContain('var(--we-button-lg-gap, var(--we-button-md-gap');
  });

  it('puts every state above every tier, with no copy of a state inside a breakpoint', () => {
    /*
      A state rule used to fall back to the base value for what it did not set, and outranked the
      tier rules: a label hidden until mdUpProps showed it vanished under the pointer, which ended the
      hover and brought it back — flashing. It was held off by emitting every state again inside every
      breakpoint. Layers make that unnecessary: a hover with nothing to say about `display` reverts
      through the tier layers, which is where mdUpProps is.
    */
    const lines = button.split('\n');
    const lastTier = lines.findIndex((line) => line.startsWith('@layer we-tier-lg'));
    const firstState = lines.findIndex((line) => line.startsWith('@layer we-state-'));
    expect(lastTier).toBeGreaterThan(-1);
    expect(firstState).toBeGreaterThan(lastTier);
    expect(lines.filter((line) => line.includes('@container') && line.includes(':where('))).toEqual([]);
  });

  it('matches tier rules only on an element that carries breakpoint props', () => {
    for (const line of button.split('\n').filter((l) => l.startsWith('@layer we-tier-'))) {
      expect(line).not.toMatch(/\{ \[part='base'\] \{/);
      expect(line).toContain(`[${TIERS_ATTR}]`);
    }
  });

  it('offers a layout-only element its layout props and nothing else', () => {
    // A `we-icon` never accepted visual or typography props; a breakpoint does not change that.
    const icon = getStaticDSStyles('icon', ['layout']);
    expect(icon).toContain(`@container we-surface (min-width: 640px) { :host([${TIERS_ATTR}])`);
    expect(icon).not.toContain("[part='base'] { background");
  });

  it('gives a stateless element tiers anyway', () => {
    // Tiers are not gated on the `state` layer — an element with no hover behaviour can still be
    // laid out differently at a different width.
    const layoutOnly = getStaticDSStyles('divider', ['layout']);
    expect(layoutOnly).toContain('@container we-surface');
    expect(layoutOnly).not.toContain('@layer we-state-');
  });
});

describe('tier props on an element', () => {
  /*
    The static sheet was never the problem. `getKeysForLayers` — which `DesignSystemMixin` derives
    both its reactive-property registration and its `filterProps` from — added `styles` and stopped
    there, so on every `we-*` element `mdUpProps` was not a reactive property and was filtered away
    before `updateAllCustomVars` saw it. No `--we-<name>-md-*` variable was written and the
    `@container` rules above read nothing, on all 51 primitives, silently: the validator accepts a
    tier bag on any component, so a template using one validated clean and did nothing.

    Nothing above catches that, because the sheet is correct in both worlds. So these assert the
    other half — the keys a mixed class actually accepts.
  */
  it('accepts a tier bag as a key, alongside styles', () => {
    const keys = getKeysForLayers(['layout', 'visual', 'flex', 'typography', 'state']);
    for (const key of tierKeys) expect(keys).toContain(key);
    expect(keys).toContain('styles');
  });

  it('accepts one on a layout-only element too — a tier is a condition, not a kind of prop', () => {
    // `we-icon` takes layout and nothing else, and still deserves to be a different size on a
    // wide surface. Gating tiers on a layer would make responsiveness opt-in per element.
    expect(getKeysForLayers(['layout'])).toContain('mdUpProps');
  });

  it('lets a tier bag through filterProps, which is what the vars are written from', () => {
    const element = { mdUpProps: { gap: '500' }, gap: '300', notAProp: 1 } as Record<string, unknown>;
    const kept = filterProps(element, getKeysForLayers(['layout', 'flex']));
    expect(kept.mdUpProps).toEqual({ gap: '500' });
    expect('notAProp' in kept).toBe(false);
  });

  it('agrees with `designSystemKeys`, which the Solid components use', () => {
    // The divergence is what made this survivable in the repo: layout components read
    // `designSystemKeys` (which has always had tiers), primitives read `getKeysForLayers` (which
    // had not), so the single real usage happened to be on a layout node and happened to work.
    const fromLayers = new Set(getKeysForLayers(['layout', 'visual', 'flex', 'typography', 'state']));
    for (const key of designSystemKeys) expect(fromLayers.has(key)).toBe(true);
  });
});
