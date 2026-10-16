import { describe, expect, it } from 'vitest';

import { bundlePieceId, readBundle } from '../src/bundle';

const meta = (role?: string) => ({ name: 'X', description: '', icon: 'x', ...(role ? { role } : {}) });

const minimal = () => ({
  format: 'we-bundle',
  formatVersion: 1,
  id: 'field-guide',
  version: '1.0.0',
  name: 'Field guide',
  description: 'Species and sightings',
  icon: 'binoculars',
  app: { id: 'app', type: 'Column', meta: meta('app') },
  templates: [
    { id: 'shell', type: 'Column', meta: meta() },
    { id: 'species', type: 'Column', meta: meta('view') },
  ],
  theme: { id: 'moss', name: 'Moss', overrides: {} },
  recordTypes: [{ name: 'Species', manifest: { version: '1', entities: { Species: {} } } }],
  display: { spaces: 'ours', template: 'shell' },
});

const paths = (input: unknown) => {
  const read = readBundle(input);
  return read.bundle ? [] : read.problems.map((p) => p.path);
};

describe('reading a bundle', () => {
  it('reads a well-formed bundle', () => {
    expect(readBundle(minimal())).toMatchObject({ bundle: { id: 'field-guide' }, problems: [] });
  });

  it('stops at once on a file that is not a bundle, or a format this build cannot read', () => {
    expect(paths({ format: 'something-else' })).toEqual(['format']);
    expect(paths({ ...minimal(), formatVersion: 2 })).toEqual(['formatVersion']);
    expect(paths(null)).toEqual(['']);
  });

  it('finds the mistakes an author makes by hand', () => {
    const bundle = minimal();
    bundle.templates[1].id = 'shell';
    expect(paths(bundle)).toContain('templates.1.id');
    expect(paths({ ...minimal(), id: 'Field Guide' })).toContain('id');
    expect(paths({ ...minimal(), app: { id: 'app', type: 'Column', meta: meta() } })).toContain('app.meta.role');
    expect(
      paths({ ...minimal(), templates: [{ id: 'x', type: 'Column', meta: meta('app') }], display: undefined }),
    ).toContain('templates.0.meta.role');
  });

  it('refuses a display naming a template the bundle does not have, or a section', () => {
    expect(paths({ ...minimal(), display: { spaces: 'ours', template: 'nope' } })).toContain('display.template');
    expect(paths({ ...minimal(), display: { spaces: 'ours', template: 'species' } })).toContain('display.template');
    expect(paths({ ...minimal(), display: { spaces: 'ours' } })).toContain('display.template');
    expect(paths({ ...minimal(), display: { spaces: 'theirs' } })).toEqual([]);
  });

  it('refuses a record type whose manifest defines something else', () => {
    const bundle = minimal();
    bundle.recordTypes[0].manifest.entities = { Sighting: {} } as never;
    expect(paths(bundle)).toContain('recordTypes.0.manifest');
    expect(
      paths({ ...minimal(), recordTypes: [{ name: 'species', manifest: { version: '1', entities: {} } }] }),
    ).toContain('recordTypes.0.name');
  });

  it('refuses a bundle with nothing to install', () => {
    const { app: _app, templates: _templates, theme: _theme, display: _display, ...empty } = minimal();
    expect(paths(empty)).toContain('');
  });
});

describe('the id a piece installs under', () => {
  it('is the bundle’s id and the piece’s, which no id of either can contain', () => {
    expect(bundlePieceId('field-guide', 'species')).toBe('field-guide--species');
    expect(paths({ ...minimal(), id: 'field--guide' })).toContain('id');
  });
});
