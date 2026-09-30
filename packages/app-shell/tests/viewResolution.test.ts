/**
 * Section resolution — the three layers, and what each of them does to the list.
 *
 * Worth testing away from a render because none of it is visible in one. A list that drops an id,
 * loses its order, or hands two sections the same segment produces a page that looks entirely
 * correct and navigates wrongly.
 */
import type { TemplateSchema } from '@we/schema-shared';
import { describe, expect, it, vi } from 'vitest';

import {
  activeSections,
  parseIdList,
  preserveUnknownViews,
  resolveEnabledViews,
  routableSections,
  viewSettings,
} from '../src/shared/viewResolution';

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

const available = (...ids: string[]) => new Map<string, TemplateSchema>(ids.map((id) => [id, view(id)]));
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

describe('routableSections', () => {
  it('includes every available view, whatever the space has enabled', () => {
    // The property the whole design rests on: the route table does not move when a switch does.
    const sections = routableSections(available('about', 'cards', 'graph'), FALLBACK);

    expect(sections.map((s) => s.id)).toEqual(['about', 'cards', 'graph']);
  });

  it('orders by the registry first, then anything installed beyond it', () => {
    const map = available('about', 'cards');
    map.set('zeta', view('zeta'));
    const sections = routableSections(map, FALLBACK);

    expect(sections.map((s) => s.id)).toEqual(['about', 'cards', 'zeta']);
  });

  it("takes each view's own segment when it has one", () => {
    const map = new Map([['feed', view('feed', 'posts')]]);

    expect(routableSections(map, []).map((s) => s.segment)).toEqual(['posts']);
  });

  it('gives a duplicate segment to the first and falls the second back to its id', () => {
    // A duplicate path makes the router match whichever route it reaches first, so one of the two
    // would be silently unreachable. Renaming is visible; unreachable is not.
    const map = new Map([
      ['cards', view('cards', 'cards')],
      ['feed', view('feed', 'cards')],
    ]);

    expect(routableSections(map, ['cards', 'feed']).map((s) => s.segment)).toEqual(['cards', 'feed']);
  });

  it('is identical whatever the space has enabled, hidden, or reordered', () => {
    /*
      The invariant the whole design rests on, stated where it can be checked.

      This list is what the route table is built from, and rebuilding that table remounts the Router
      — which mounts `TemplateLayout`, which mounts the shell overlay. If any of the three inputs
      below could move it, flicking a switch in a space's settings would rebuild the application
      underneath the person flicking it.

      The signature is most of the proof: `routableSections` is not given the enabled list at all.
      This pins the rest — that segment assignment is stable, so a shared link keeps working after
      the community reorganises.
    */
    const map = available('about', 'cards', 'graph');
    const table = routableSections(map, FALLBACK);

    for (const enabledRaw of [undefined, '[]', '["graph"]', '["graph","about","cards"]']) {
      for (const hidden of [[], ['about'], ['about', 'cards', 'graph']]) {
        activeSections({ routable: table, enabledRaw, hidden, fallbackOrder: FALLBACK });
        expect(routableSections(map, FALLBACK)).toEqual(table);
      }
    }
  });
});

describe('activeSections', () => {
  const routable = () => routableSections(available('about', 'cards', 'graph'), FALLBACK);

  it("keeps only the enabled sections, in the space's own order", () => {
    const sections = activeSections({
      routable: routable(),
      enabledRaw: '["cards","about"]',
      hidden: [],
      fallbackOrder: FALLBACK,
    });

    expect(sections.map((s) => s.id)).toEqual(['cards', 'about']);
  });

  it('takes segments from the routable list rather than re-deriving them', () => {
    // If these could disagree the nav would link somewhere the route table has no route for.
    const table = routable();
    const sections = activeSections({ routable: table, enabledRaw: undefined, hidden: [], fallbackOrder: FALLBACK });

    for (const section of sections) {
      expect(section.segment).toBe(table.find((r) => r.id === section.id)!.segment);
    }
  });

  it("removes an agent's hidden sections without disturbing the order of the rest", () => {
    const sections = activeSections({
      routable: routable(),
      enabledRaw: '["about","cards","graph"]',
      hidden: ['cards'],
      fallbackOrder: FALLBACK,
    });

    expect(sections.map((s) => s.id)).toEqual(['about', 'graph']);
  });

  it('does not intersect an installed-by-me layer the way modules do', () => {
    // A section is part of what the space *is*. If a missing personal install could remove one, two
    // members opening the same URL would disagree about whether it exists.
    const sections = activeSections({
      routable: routable(),
      enabledRaw: '["about"]',
      hidden: [],
      fallbackOrder: [],
    });

    expect(sections).toHaveLength(1);
  });

  it('carries the view schema through, since the host builds routes out of it', () => {
    const sections = activeSections({ routable: routable(), enabledRaw: '["about"]', hidden: [], fallbackOrder: [] });

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

  it("puts the space's own sections first, in the space's own order", () => {
    /*
      This used to iterate the available map — registry order — so the settings list and the nav
      strip showed two different orders and disagreed the moment anybody rearranged anything.

      It matters more than a mismatch: the list is what a drag reads its result from, so reordering
      against a list that was never showing the real order wrote an order nobody had arranged.
    */
    const settings = viewSettings({ ...opts, enabledRaw: '["graph","about"]', hidden: [] });

    expect(settings.map((s) => s.id)).toEqual(['graph', 'about', 'cards']);
  });

  it('groups the sections the space does not have after the ones it does', () => {
    // They have no position, so there is nothing to sort them by — and keeping them out of the
    // ordered run is what lets the drag zone hold only the rows that have an order.
    const settings = viewSettings({ ...opts, enabledRaw: '["cards"]', hidden: [] });

    expect(settings.map((s) => [s.id, s.enabled])).toEqual([
      ['cards', true],
      ['about', false],
      ['graph', false],
    ]);
  });

  it('keeps a drag from turning sections on', () => {
    /*
      The half that lives in the store, asserted here on the shape it depends on: a reorder writes
      the ids it was handed, and the settings list holds every available section. Before the drag
      zone was narrowed to the enabled rows, one drag handed the disabled ones back as part of the
      order — and writing that enabled every one of them at a stroke.

      What makes the write safe is that it can be intersected with the current enabled set, which
      requires the two groups to be distinguishable in the list. They are, by `enabled`.
    */
    const settings = viewSettings({ ...opts, enabledRaw: '["cards"]', hidden: [] });
    const draggable = settings.filter((s) => s.enabled).map((s) => s.id);

    expect(draggable).toEqual(['cards']);
  });

  it('orders by the space, not by which sections the agent has hidden', () => {
    // Hiding is personal and positionless; it must not move a row for everybody looking at it.
    const settings = viewSettings({ ...opts, enabledRaw: '["about","cards","graph"]', hidden: ['about'] });

    expect(settings.map((s) => s.id)).toEqual(['about', 'cards', 'graph']);
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

describe('preserveUnknownViews', () => {
  /*
    `resolveEnabledViews` promises that an id naming a view this build does not have is dropped from
    the resolved list and kept in the stored one — so a space configured where the globe ships,
    opened where it does not, is missing that section and nothing else. Both writers started from the
    resolved list and wrote it back, which persisted the pruning: one member on an older build
    toggling one section removed every section that build lacked, for everybody, permanently.
  */
  const known = (id: string) => id !== 'globe' && id !== 'flux';

  it('puts an unknown id back where it was stored', () => {
    expect(preserveUnknownViews(['about', 'cards'], ['about', 'globe', 'cards'], known)).toEqual([
      'about',
      'globe',
      'cards',
    ]);
  });

  it('keeps several, in their stored order', () => {
    expect(preserveUnknownViews(['about'], ['globe', 'about', 'flux'], known)).toEqual(['globe', 'about', 'flux']);
  });

  it('leaves a list with nothing unknown in it exactly as it is', () => {
    // Including a reorder, which is the whole point of `reorderViews`: this must not fight it.
    expect(preserveUnknownViews(['cards', 'about'], ['about', 'cards'], known)).toEqual(['cards', 'about']);
  });

  it('does not duplicate an id the caller kept', () => {
    // A build that *does* know the id resolves it into `next`; carrying it again would double the tab.
    expect(preserveUnknownViews(['about', 'globe'], ['about', 'globe'], known)).toEqual(['about', 'globe']);
  });

  it('appends rather than throwing when the stored index is past the end', () => {
    expect(preserveUnknownViews([], ['about', 'globe'], known)).toEqual(['globe']);
  });
});
