/**
 * No stray backticks inside a css template.
 *
 * A backtick in a CSS *comment* ends the template literal, and everything after it is then parsed
 * as TypeScript — so a note written in the house style, naming a property in backticks, breaks the
 * build somewhere else entirely. It happened four times while working on these components, always
 * the same way, and the error never points at the comment that caused it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ALERT_VARIANT_ICONS } from './primitives/alert';
import { componentCascadeFor, registerComponentCascade } from './shared/helpers';

const SRC = join(__dirname);

const sourceFiles = () =>
  (readdirSync(SRC, { recursive: true, encoding: 'utf8' }) as string[])
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => join(SRC, name));

describe('css templates', () => {
  it('contain no backticks, which would close them early', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles()) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/css`/g)) {
        const start = (match.index ?? 0) + match[0].length;
        const end = source.indexOf('`;', start);
        if (end === -1) continue;
        if (source.slice(start, end).includes('`')) offenders.push(file.replace(`${SRC}/`, ''));
      }
    }

    expect(offenders).toEqual([]);
  });
});

/**
 * An element carrying two part names must be styled with `~=`, not `=`.
 *
 * `part="swatch token"` does not match `[part='swatch']` — attribute selectors are exact-match — so
 * a rule written that way silently applies to nothing. It is a specific kind of invisible: the
 * element keeps its user-agent appearance, which for a `<button>` is a small grey-bordered box, and
 * the symptom reads as a layout problem rather than a selector that never fired. The colour picker's
 * token grid shipped like that.
 */
describe('multi-part elements', () => {
  const MULTI_PART = /part="([a-z-]+(?: [a-z-]+)+)"/g;

  it('are addressed with ~= wherever their parts are styled', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const src = readFileSync(file, 'utf8');
      const names = new Set<string>();
      for (const m of src.matchAll(MULTI_PART)) m[1].split(' ').forEach((n) => names.add(n));
      for (const name of names) {
        if (src.includes(`[part='${name}']`)) offenders.push(`${file.split('/').pop()}: [part='${name}']`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * The theme cascade, open to components the design system does not ship.
 *
 * WE's premise is that modules raise the ceiling on what templates can express, and until this was
 * open they could do that for layout and behaviour but not for theming: a module could read
 * `--we-theme-control-radius` and had no way to say "my surface is its own kind of thing, and here
 * is the group it follows". Its options were to borrow a core group whose meaning did not fit, or
 * to hardcode — and a hardcode is invisible to every theme anybody writes afterwards.
 */
describe('registerComponentCascade', () => {
  it('makes a component the core has never heard of follow a theme group', () => {
    registerComponentCascade('acme-timeline', { radiusGroup: '--we-theme-surface-radius' });
    expect(componentCascadeFor('acme-timeline')?.radiusGroup).toBe('--we-theme-surface-radius');
  });

  /*
    Replacement, not merge. A module reloading in development must not accumulate entries, and there
    is no meaningful middle between two answers to "which group does this follow".
  */
  it('replaces a previous registration rather than merging with it', () => {
    registerComponentCascade('acme-panel', {
      radiusGroup: '--we-theme-control-radius',
      gapGroup: '--we-theme-control-gap',
    });
    registerComponentCascade('acme-panel', { radiusGroup: '--we-theme-surface-radius' });

    expect(componentCascadeFor('acme-panel')).toEqual({ radiusGroup: '--we-theme-surface-radius' });
  });

  it('leaves the components that ship with the system alone', () => {
    // Registering next to `avatar` must not disturb the reason avatar has its own group at all.
    registerComponentCascade('acme-badge', { radiusGroup: '--we-theme-control-radius' });
    expect(componentCascadeFor('avatar')?.radiusGroup).toBe('--we-theme-avatar-radius');
  });

  it('reports nothing for a name that was never registered', () => {
    expect(componentCascadeFor('acme-never-registered')).toBeUndefined();
  });
});

/**
 * A status never travels as colour alone.
 *
 * The check the theme suite cannot make, and the one that matters. Red and green at the same
 * lightness *are* the same colour to about one man in twelve — deuteranopia removes the axis they
 * differ on — and no amount of hue-picking fixes that for a palette built on red and green. WCAG
 * 1.4.1 asks for redundancy rather than separability, and this is where the redundancy lives.
 */
describe('status variants carry a non-colour signal', () => {
  const STATUSES = ['danger', 'success', 'warning'] as const;

  it('gives each status its own icon', () => {
    // The three that mean something, not all five: `neutral` and `primary` share `info` on purpose —
    // they are informational rather than status, and nothing depends on telling them apart.
    const icons = STATUSES.map((s) => ALERT_VARIANT_ICONS[s]);
    expect(new Set(icons).size, 'two statuses share an icon, so colour is all that separates them').toBe(icons.length);
  });

  it('leaves none of them relying on colour', () => {
    for (const variant of STATUSES) {
      expect(ALERT_VARIANT_ICONS[variant], `${variant} has no icon`).toBeTruthy();
    }
  });
});
