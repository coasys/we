/**
 * What a reload draws first: the app somebody is in, the bundle it came in, and the theme those name
 * — kept per agent, and refused when it is not something this build wrote.
 */
import { readBootSnapshot, selectBootSnapshot, writeBootSnapshot } from '@shared/bundles/bootSnapshot';
import type { ThemeData } from '@we/entities';
import type { TemplateSchema } from '@we/schema-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const template = (id: string, extra: Partial<TemplateSchema> = {}): TemplateSchema =>
  ({ id, type: 'Column', meta: { name: id, description: '', icon: 'x' }, ...extra }) as TemplateSchema;
const fromBundle = (id: string, themeId?: string, role?: string) =>
  template(id, {
    meta: { name: id, description: '', icon: 'x', ...(themeId ? { themeId } : {}), ...(role ? { role } : {}) },
    source: { bundle: 'field-guide', version: '1.0.0', piece: id },
  } as Partial<TemplateSchema>);
const theme = (id: string): ThemeData => ({
  id,
  slug: id,
  name: id,
  icon: 'palette',
  origin: 'custom',
  version: 1,
  css: null,
  overrides: null,
});

const library = [
  fromBundle('field-guide--app', undefined, 'app'),
  fromBundle('field-guide--field-guide', 'ad4m://moss'),
  fromBundle('field-guide--species', undefined, 'view'),
  template('someone-elses'),
  { ...fromBundle('field-guide--copy'), _fromSpace: true },
];

describe('selectBootSnapshot', () => {
  it('keeps the app in use, the rest of its bundle, and the themes they name', () => {
    const snapshot = selectBootSnapshot({
      appTemplateId: 'field-guide--app',
      installedBundles: '[]',
      library,
      installedThemes: [theme('ad4m://moss'), theme('ad4m://other')],
    });
    expect(snapshot.templates.map((t) => t.id)).toEqual([
      'field-guide--app',
      'field-guide--field-guide',
      'field-guide--species',
    ]);
    expect(snapshot.themes.map((t) => t.id)).toEqual(['ad4m://moss']);
  });

  it('keeps no templates for WE’s own app, which is built in', () => {
    const snapshot = selectBootSnapshot({ appTemplateId: '', installedBundles: '', library, installedThemes: [] });
    expect(snapshot.templates).toEqual([]);
  });

  it('keeps an app of the agent’s own that came in no bundle, and nothing else', () => {
    const own = template('my-app', { meta: { name: 'Mine', description: '', icon: 'x', role: 'app' } });
    const snapshot = selectBootSnapshot({
      appTemplateId: 'my-app',
      installedBundles: '',
      library: [...library, own],
      installedThemes: [],
    });
    expect(snapshot.templates.map((t) => t.id)).toEqual(['my-app']);
  });
});

describe('reading and writing it', () => {
  // These tests run in Node, which has no storage; a Map is all the module asks of one.
  beforeEach(() => {
    const items = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    });
  });

  const kept = selectBootSnapshot({
    appTemplateId: 'field-guide--app',
    installedBundles: '[]',
    library,
    installedThemes: [theme('ad4m://moss')],
  });

  it('reads back what was written, for the same agent only', () => {
    writeBootSnapshot('did:key:anna', kept);
    expect(readBootSnapshot('did:key:anna')).toEqual(kept);
    expect(readBootSnapshot('did:key:ben')).toBeNull();
    expect(readBootSnapshot(undefined)).toBeNull();
  });

  it('refuses something it did not write', () => {
    localStorage.setItem('we:boot-snapshot:did:key:anna', JSON.stringify({ ...kept, v: 99 }));
    expect(readBootSnapshot('did:key:anna')).toBeNull();
    localStorage.setItem('we:boot-snapshot:did:key:anna', '{not json');
    expect(readBootSnapshot('did:key:anna')).toBeNull();
    localStorage.setItem('we:boot-snapshot:did:key:anna', JSON.stringify({ ...kept, templates: 'x' }));
    expect(readBootSnapshot('did:key:anna')).toBeNull();
  });

  it('forgets it once the agent is back in WE’s own app', () => {
    writeBootSnapshot('did:key:anna', kept);
    writeBootSnapshot(
      'did:key:anna',
      selectBootSnapshot({ appTemplateId: '', installedBundles: '[]', library, installedThemes: [] }),
    );
    expect(readBootSnapshot('did:key:anna')).toBeNull();
  });
});
