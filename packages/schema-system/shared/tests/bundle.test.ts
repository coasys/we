import { describe, expect, it } from 'vitest';

import { bundlePieceId, bundleThemes, readBundle, svgProblem } from '../src/bundle';

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

describe('the themes a bundle offers', () => {
  const two = [
    { id: 'flat', name: 'Flat', overrides: {} },
    { id: 'glow', name: 'Glow', overrides: {} },
  ];

  it('reads a list of themes, or one theme, the same way', () => {
    const { theme: _theme, ...rest } = minimal();
    expect(paths({ ...rest, themes: two })).toEqual([]);
    expect(bundleThemes({ themes: two }).map((t) => t.id)).toEqual(['flat', 'glow']);
    expect(bundleThemes(minimal() as never).map((t) => t.id)).toEqual(['moss']);
  });

  it('refuses both at once, a theme id used twice, and a theme with no overrides', () => {
    expect(paths({ ...minimal(), themes: two })).toContain('themes');
    const { theme: _theme, ...rest } = minimal();
    expect(paths({ ...rest, themes: [two[0], two[0]] })).toContain('themes.1.id');
    expect(paths({ ...rest, themes: [{ id: 'flat', name: 'Flat' }] })).toContain('themes.0.overrides');
  });

  it('counts a list of themes as something to install', () => {
    const { app: _app, templates: _templates, theme: _theme, display: _display, ...empty } = minimal();
    expect(paths({ ...empty, themes: two })).toEqual([]);
  });
});

describe('a brand', () => {
  const mark = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>';

  it('reads a name, a mark, a wordmark and an About page', () => {
    expect(paths({ ...minimal(), brand: { name: 'Coasys', mark, wordmark: mark, about: '# About' } })).toEqual([]);
  });

  it('needs a name', () => {
    expect(paths({ ...minimal(), brand: { mark } })).toContain('brand.name');
  });

  it('refuses a mark that would do more than draw', () => {
    expect(paths({ ...minimal(), brand: { name: 'X', mark: '<p>not svg</p>' } })).toContain('brand.mark');
    expect(svgProblem('<svg><script>alert(1)</script></svg>')).toMatch(/script/);
    expect(svgProblem('<svg onload="x()"></svg>')).toMatch(/event handler/);
    expect(svgProblem('<svg><foreignObject/></svg>')).toMatch(/foreign/);
    expect(svgProblem('<svg><script/></svg>')).toMatch(/script/);
    expect(svgProblem('<svg><image href="https://example.com/a.png"/></svg>')).toMatch(/outside/);
    expect(svgProblem('<svg><rect fill="url(#g)"/><image href="data:image/png;base64,AA"/></svg>')).toBeNull();
    expect(svgProblem('<?xml version="1.0"?>\n<!-- made by hand -->\n<svg></svg>')).toBeNull();
  });
});

describe('pages of the app’s own', () => {
  const about = { id: 'about', type: 'Column', meta: meta('page') };

  it('reads a page, and a brand whose About is one', () => {
    expect(paths({ ...minimal(), pages: [about], brand: { name: 'X', aboutPage: 'about' } })).toEqual([]);
  });

  it('keeps pages and templates apart', () => {
    expect(paths({ ...minimal(), pages: [{ ...about, meta: meta() }] })).toContain('pages.0.meta.role');
    expect(paths({ ...minimal(), templates: [about], display: undefined })).toContain('templates.0.meta.role');
  });

  it('refuses an About page the bundle does not have', () => {
    expect(paths({ ...minimal(), brand: { name: 'X', aboutPage: 'about' } })).toContain('brand.aboutPage');
    expect(paths({ ...minimal(), pages: [about, about] })).toContain('pages.1.id');
  });

  it('counts a page as something to install', () => {
    const { app: _app, templates: _templates, theme: _theme, display: _display, ...empty } = minimal();
    expect(paths({ ...empty, pages: [about] })).toEqual([]);
  });
});

describe('a sign-in screen', () => {
  it('is a node, and nothing else', () => {
    expect(paths({ ...minimal(), bootScreen: { type: 'Column' } })).toEqual([]);
    expect(paths({ ...minimal(), bootScreen: 'Column' })).toContain('bootScreen');
  });
});

describe('the id a piece installs under', () => {
  it('is the bundle’s id and the piece’s, which no id of either can contain', () => {
    expect(bundlePieceId('field-guide', 'species')).toBe('field-guide--species');
    expect(paths({ ...minimal(), id: 'field--guide' })).toContain('id');
  });
});
