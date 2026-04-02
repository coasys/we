import { describe, expect, it } from 'vitest';

import { computeSectionIndex } from '../src/indexer';
import { createStoredTemplate, getSection, listSections, updateSection } from '../src/sections';
import type { TemplateSchema } from '../src/types';

// ---------------------------------------------------------------------------
// Fixture: minimal template with two routes
// ---------------------------------------------------------------------------
const fixture: TemplateSchema = {
  type: 'AppShell',
  meta: { name: 'Test', description: '', icon: '' },
  children: [
    {
      type: 'CollapsibleSidebar',
      props: { side: 'left' },
      children: [{ type: 'NavItem', props: { label: 'Home' }, children: [] }],
    },
    { type: 'Outlet', children: [] },
  ],
  routes: [
    { path: '/', type: 'Page', children: [{ type: 'Heading', props: { text: 'Home' }, children: [] }] },
    { path: '/settings', type: 'Page', children: [{ type: 'Form', props: {}, children: [] }] },
  ],
  slots: {},
};

// ---------------------------------------------------------------------------
// createStoredTemplate
// ---------------------------------------------------------------------------
describe('createStoredTemplate', () => {
  it('wraps schema with computed sections', () => {
    const stored = createStoredTemplate(fixture);
    expect(stored.schema).toEqual(fixture);
    expect(stored.sections.length).toBeGreaterThan(0);
    expect(stored.sections).toEqual(computeSectionIndex(fixture));
  });
});

// ---------------------------------------------------------------------------
// listSections
// ---------------------------------------------------------------------------
describe('listSections', () => {
  it('returns the sections array', () => {
    const stored = createStoredTemplate(fixture);
    const sections = listSections(stored);
    expect(sections).toBe(stored.sections); // same reference
    expect(sections.some((s) => s.key === 'root')).toBe(true);
    expect(sections.some((s) => s.key === 'route:/')).toBe(true);
    expect(sections.some((s) => s.key === 'navigation:left')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getSection
// ---------------------------------------------------------------------------
describe('getSection', () => {
  const stored = createStoredTemplate(fixture);

  it('gets root section', () => {
    const root = getSection(stored, 'root');
    expect(root).toEqual(fixture);
  });

  it('gets a route by key', () => {
    const route = getSection(stored, 'route:/');
    expect(route).toBeDefined();
    expect(route!.type).toBe('Page');
    expect(route!.children![0]).toMatchObject({ type: 'Heading' });
  });

  it('gets a navigation section', () => {
    const nav = getSection(stored, 'navigation:left');
    expect(nav).toBeDefined();
    expect(nav!.type).toBe('CollapsibleSidebar');
  });

  it('returns null for unknown key', () => {
    expect(getSection(stored, 'route:/nonexistent')).toBeNull();
  });

  it('returns null for empty key', () => {
    expect(getSection(stored, '')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateSection
// ---------------------------------------------------------------------------
describe('updateSection', () => {
  it('replaces a route section and re-indexes', () => {
    const stored = createStoredTemplate(fixture);
    const newPage = {
      path: '/',
      type: 'Page',
      children: [{ type: 'Text', props: { value: 'Updated' }, children: [] }],
    };

    const updated = updateSection(stored, 'route:/', newPage);

    // Schema is updated
    const route = getSection(updated, 'route:/');
    expect(route).toBeDefined();
    expect(route!.children![0]).toMatchObject({ type: 'Text', props: { value: 'Updated' } });

    // Other sections are unaffected
    const settings = getSection(updated, 'route:/settings');
    expect(settings).toBeDefined();
    expect(settings!.type).toBe('Page');

    // Sections were recomputed
    expect(updated.sections).toEqual(computeSectionIndex(updated.schema));
  });

  it('replaces navigation section', () => {
    const stored = createStoredTemplate(fixture);
    const newNav = {
      type: 'CollapsibleSidebar',
      props: { side: 'left' },
      children: [
        { type: 'NavItem', props: { label: 'Dashboard' }, children: [] },
        { type: 'NavItem', props: { label: 'Profile' }, children: [] },
      ],
    };

    const updated = updateSection(stored, 'navigation:left', newNav);
    const nav = getSection(updated, 'navigation:left');
    expect(nav!.children).toHaveLength(2);
    expect(nav!.children![1]).toMatchObject({ type: 'NavItem', props: { label: 'Profile' } });
  });

  it('skips re-indexing when reindex=false', () => {
    const stored = createStoredTemplate(fixture);
    const tweaked = { ...structuredClone(fixture.routes![0]), props: { bg: 'red' } };

    const updated = updateSection(stored, 'route:/', tweaked, false);

    // Sections preserved (not recomputed) — same keys
    expect(updated.sections.map((s) => s.key)).toEqual(stored.sections.map((s) => s.key));
    // But size estimate updated for the changed section
    const entry = updated.sections.find((s) => s.key === 'route:/');
    expect(entry!.sizeEstimate).toBe(JSON.stringify(tweaked).length);
  });

  it('throws for unknown section key', () => {
    const stored = createStoredTemplate(fixture);
    expect(() => updateSection(stored, 'route:/nope', { type: 'X', children: [] })).toThrow(
      'Section "route:/nope" not found',
    );
  });

  it('does not mutate the original', () => {
    const stored = createStoredTemplate(fixture);
    const originalSchema = structuredClone(stored.schema);

    updateSection(stored, 'route:/', { type: 'Page', children: [] });

    expect(stored.schema).toEqual(originalSchema);
  });
});
