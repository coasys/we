/**
 * The record of what each installed app wrote: replaced whole by a later install of the same app,
 * and the source of the app's display policy.
 */
import { bundlePieces } from '@shared/bundles/bundlePieces';
import { appSpaceTemplate } from '@shared/bundles/display';
import {
  displaySourceOf,
  installedEntry,
  installedThemes,
  readInstalledBundles,
  withInstalled,
  withoutInstalled,
} from '@shared/bundles/installedBundles';
import type { Bundle } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

const meta = (name: string, role?: string) => ({ name, description: '', icon: 'x', ...(role ? { role } : {}) });
const bundle = (version: string) =>
  ({
    format: 'we-bundle',
    formatVersion: 1,
    id: 'field-guide',
    version,
    name: 'Field guide',
    description: '',
    icon: 'binoculars',
    app: { id: 'app', type: 'Column', meta: meta('App', 'app') },
    templates: [
      { id: 'shell', type: 'Column', meta: meta('Shell') },
      { id: 'species', type: 'Column', meta: meta('Species', 'view') },
    ],
    theme: { id: 'moss', name: 'Moss', overrides: {} },
    recordTypes: [{ name: 'Species', manifest: { version: '1', entities: { Species: {} } } }],
    display: { spaces: 'ours', template: 'shell' },
  }) as unknown as Bundle;

const entry = (version: string) =>
  installedEntry(bundlePieces(bundle(version)), {
    name: 'Field guide',
    icon: 'binoculars',
    at: '2026-10-13T00:00:00Z',
  });

describe('the record of an install', () => {
  it('names every piece it wrote, under the ids they were written under', () => {
    expect(entry('1.0.0')).toMatchObject({
      id: 'field-guide',
      app: 'field-guide--app',
      templates: ['field-guide--shell', 'field-guide--species'],
      sections: ['field-guide--species'],
      themes: ['field-guide--moss'],
      recordTypes: [{ name: 'Species' }],
      display: { spaces: 'ours', template: 'field-guide--shell' },
    });
  });

  it('is replaced whole by a later version of the same app, and removed by id', () => {
    const list = withInstalled(withInstalled([], entry('1.0.0')), entry('1.1.0'));
    expect(list.map((e) => e.version)).toEqual(['1.1.0']);
    expect(withoutInstalled(list, 'field-guide')).toEqual([]);
  });

  it('survives a round trip through the setting, and reads nothing from a broken one', () => {
    const list = [entry('1.0.0')];
    expect(readInstalledBundles(JSON.stringify(list))).toEqual(list);
    expect(readInstalledBundles('not json')).toEqual([]);
    expect(readInstalledBundles('')).toEqual([]);
  });

  it('reads the themes an install wrote, including one recorded before there could be several', () => {
    expect(installedThemes(entry('1.0.0'))).toEqual(['field-guide--moss']);
    expect(installedThemes({ theme: 'old--theme' })).toEqual(['old--theme']);
    expect(installedThemes({})).toEqual([]);
  });

  it('carries the display policy of the app it installed', () => {
    expect(appSpaceTemplate('field-guide--app', [displaySourceOf(entry('1.0.0'))])).toBe('field-guide--shell');
  });
});
