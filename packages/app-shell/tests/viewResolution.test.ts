/**
 * Section resolution — the three layers, and what each of them does to the list.
 *
 * Worth testing away from a render because none of it is visible in one. A list that drops an id,
 * loses its order, or hands two sections the same segment produces a page that looks entirely
 * correct and navigates wrongly.
 */
import type { TemplateSchema } from '@we/schema-shared';
import { describe, expect, it, vi } from 'vitest';

import { parseIdList, resolveEnabledViews, resolveSections, viewSettings } from '../src/shared/viewResolution';

const view = (id: string, segment?: string, name?: string): TemplateSchema => ({
  id,
  meta: {
    name: name ?? id,
    description: `the ${id} section`,
    icon: 'square',
    role: 'view',
    ...(segment ? { segment } : {}),
  },
  type: 'Column',
});

const available = (...ids: string[]) => new Map(ids.map((id) => [id, view(id)]));
const FALLBACK = ['about', 'cards', 'graph'];

describe('resolveEnabledViews', () => {
  const known = (id: string) => FALLBACK.includes(id);

  it('falls back to the bundled set when nothing has been decided', () => {
    // The rule every existing space depends on: unset is "not decided", not "none". Reading it as
    // "none" would land as every space losing every tab the moment this shipped.
    expect(resolveEnabledViews(undefined, known, FALLBACK)).toEqual(FALLBACK);
    expect(resolveEnabledViews('', known, FALLBACK)).toEqual(FALLBACK);
  });

  it('falls back and warns on a malformed value rather than resolving to nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(resolveEnabledViews('{not json', known, FALLBACK)).toEqual(FALLBACK);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  it('preserves the stored order, because the order is the nav order', () => {
    expect(resolveEnabledViews('["graph","about"]', known, FALLBACK)).toEqual(['graph', 'about']);
  });

  it('honours an explicit empty list as a real decision', () => {
    // Distinct from unset: somebody turned every section off, which is legal.
    expect(resolveEnabledViews('[]', known, FALLBACK)).toEqual([]);
  });

  it('drops ids this build does not have, without disturbing the rest', () => {
    expect(resolveEnabledViews('["about","globe","cards"]', known, FALLBACK)).toEqual(['about', 'cards']);
  });

  it('ignores non-string entries', () => {
    expect(resolveEnabledViews('["about",42,null,"cards"]', known, FALLBACK)).toEqual(['about', 'cards']);
  });
});

describe('parseIdList', () => {
  it('reads a list, and treats absent or malformed as excluding nothing', () => {
    expect(parseIdList('["a","b"]')).toEqual(['a', 'b']);
    expect(parseIdList(undefined)).toEqual([]);
    expect(parseIdList('')).toEqual([]);
    expect(parseIdList('{')).toEqual([]);
    expect(parseIdList('"a string"')).toEqual([]);
  });
});

describe('resolveSections', () => {
  it('pairs each enabled section with its segment, in order', () => {
    const sections = resolveSections({
      enabledRaw: '["cards","about"]',
      hidden: [],
      available: available('about', 'cards'),
      fallbackOrder: FALLBACK,
    });

    expect(sections.map((s) => [s.id, s.segment])).toEqual([
      ['cards', 'cards'],
      ['about', 'about'],
    ]);
  });

  it("takes the segment from the view's own meta when it has one", () => {
    const map = new Map([['feed', view('feed', 'posts')]]);
    const sections = resolveSections({ enabledRaw: '["feed"]', hidden: [], available: map, fallbackOrder: [] });

    expect(sections[0].segment).toBe('posts');
  });

  it('gives a duplicate segment to the first section and falls the second back to its id', () => {
    // A duplicate path makes the router match whichever route it reaches first, so one of the two
    // would be silently unreachable. Renaming is visible; unreachable is not.
    const map = new Map([
      ['cards', view('cards', 'cards')],
      ['feed', view('feed', 'cards')],
    ]);
    const sections = resolveSections({ enabledRaw: '["cards","feed"]', hidden: [], available: map, fallbackOrder: [] });

    expect(sections.map((s) => s.segment)).toEqual(['cards', 'feed']);
  });

  it("removes an agent's hidden sections without touching the order of the rest", () => {
    const sections = resolveSections({
      enabledRaw: '["about","cards","graph"]',
      hidden: ['cards'],
      available: available('about', 'cards', 'graph'),
      fallbackOrder: FALLBACK,
    });

    expect(sections.map((s) => s.id)).toEqual(['about', 'graph']);
  });

  it('does not intersect an installed-by-me layer the way modules do', () => {
    // A section is part of what the space *is*. If a missing personal install could remove one, two
    // members opening the same URL would disagree about whether it exists.
    const sections = resolveSections({
      enabledRaw: '["about"]',
      hidden: [],
      available: available('about'),
      fallbackOrder: [],
    });

    expect(sections).toHaveLength(1);
  });

  it('carries the view schema through, since the host builds routes out of it', () => {
    const sections = resolveSections({
      enabledRaw: '["about"]',
      hidden: [],
      available: available('about'),
      fallbackOrder: [],
    });

    expect(sections[0].schema.type).toBe('Column');
  });
});

describe('viewSettings', () => {
  const opts = {
    available: available('about', 'cards', 'graph'),
    fallbackOrder: FALLBACK,
    isBuiltIn: (id: string) => id !== 'graph',
  };

  it('lists every available section, including the ones this space has turned off', () => {
    // The settings page must show what is absent — that is the whole point of it.
    const settings = viewSettings({ ...opts, enabledRaw: '["about"]', hidden: [] });

    expect(settings.map((s) => s.id)).toEqual(['about', 'cards', 'graph']);
    expect(settings.map((s) => s.enabled)).toEqual([true, false, false]);
  });

  it('reports the two layers separately, so a row can say which one is off', () => {
    const settings = viewSettings({ ...opts, enabledRaw: '["about","cards"]', hidden: ['cards'] });
    const byId = Object.fromEntries(settings.map((s) => [s.id, s]));

    expect(byId.about).toMatchObject({ enabled: true, visible: true });
    // In the space, hidden by me — a different situation from the one below, with a different fix.
    expect(byId.cards).toMatchObject({ enabled: true, visible: false });
    // Not in the space at all.
    expect(byId.graph).toMatchObject({ enabled: false, visible: true });
  });

  it('marks which sections came from the bundle', () => {
    const settings = viewSettings({ ...opts, enabledRaw: undefined, hidden: [] });

    expect(settings.find((s) => s.id === 'graph')?.builtIn).toBe(false);
    expect(settings.find((s) => s.id === 'about')?.builtIn).toBe(true);
  });

  it('carries each section its own name, description and icon for the row to render', () => {
    const settings = viewSettings({ ...opts, enabledRaw: undefined, hidden: [] });

    expect(settings[0]).toMatchObject({ name: 'about', description: 'the about section', icon: 'square' });
  });
});
