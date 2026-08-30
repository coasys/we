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

import { getStaticDSStyles } from './helpers';

describe('getStaticDSStyles — tier queries', () => {
  const button = getStaticDSStyles('button');

  it('emits one query per tier, for the host and for [part=base]', () => {
    expect(button.match(/@container we-surface/g)?.length).toBe(6);
    expect(button).toContain("@container we-surface (min-width: 900px) { [part='base']");
    expect(button).toContain('@container we-surface (min-width: 900px) { :host');
  });

  it('falls back down through the tiers beneath, then to the component default', () => {
    // Cascade-through: something set only in smUpProps still applies at lg. And the base arm keeps
    // the component's own token fallback, or an lgUpProps mentioning one prop would blank the rest.
    expect(button).toContain('gap: var(--we-button-lg-gap, var(--we-button-md-gap, var(--we-button-sm-gap,');
  });

  it('comes after the state selectors, so a tier wins over a hover at equal specificity', () => {
    // Container queries add no specificity, so this ordering *is* the precedence. A hover is a
    // state everywhere; a tier is a different layout, and a layout that only half-applies is worse.
    expect(button.indexOf('@container')).toBeGreaterThan(button.indexOf(':host(:hover)'));
  });

  it('offers a layout-only element its layout props and nothing else', () => {
    // A `we-icon` never accepted visual or typography props; a breakpoint does not change that.
    const icon = getStaticDSStyles('icon', ['layout']);
    expect(icon).toContain('@container we-surface (min-width: 640px) { :host');
    expect(icon).not.toContain("[part='base'] { background");
  });

  it('gives a stateless element tiers anyway', () => {
    // Tiers are not gated on the `state` layer — an element with no hover behaviour can still be
    // laid out differently at a different width.
    const layoutOnly = getStaticDSStyles('divider', ['layout']);
    expect(layoutOnly).toContain('@container we-surface');
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
