/**
 * Breakpoint tiers on the Lit primitives.
 *
 * The interesting property is that these rules live *inside* the primitive's own adopted
 * stylesheet, several shadow boundaries below the `$surface` they query. That works because
 * container selection walks the flat tree — a rule authored in a shadow root matches a container
 * declared outside it — which was checked against Chrome 150 and Firefox 152 rather than inferred.
 */
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
