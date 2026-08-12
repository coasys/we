/**
 * Every selector a theme writes must resolve against a real element, part and attribute.
 *
 * CSS fails silently. A rule targeting `we-toggle` when the element is `we-switch` does not warn,
 * does not throw and does not show up in a build — it simply never applies, and the theme looks
 * *almost* right in a way nobody can attribute to anything. Retro and cyberpunk had accumulated
 * thirteen such rules between them, which is most of what those two themes thought they were doing.
 *
 * The three failure modes, all found in the wild here:
 *
 * - **Wrong tag** — `we-toggle` (it is `we-switch`), `we-tab-item` (`we-tab`), `we-menu-group-item`
 *   (`we-menu-group`).
 * - **Wrong part** — `we-modal::part(modal)` (the part is `base`), `we-input::part(input-wrapper)`
 *   (that part is on `we-select`; input's is `base`).
 * - **Wrong attribute** — `we-button[circle]` (the prop is `square`).
 *
 * Tags and attributes come from the generated `custom-elements.json`. Parts are not in the manifest,
 * so they are read from the primitives' source — both the `part="x"` a template renders and the
 * `[part='x']` its own stylesheet targets, since a part can be introduced by either.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const primitivesRoot = join(here, '..', '..', '3-primitives');

/** Selectors that intentionally name something outside the primitives' vocabulary. */
const IGNORED_TAGS = new Set<string>([]);

interface ElementInfo {
  attributes: Set<string>;
  parts: Set<string>;
}

/** Tags and attributes from the generated manifest; parts from source (the manifest omits them). */
function readElements(): Map<string, ElementInfo> {
  const cem = JSON.parse(readFileSync(join(primitivesRoot, 'custom-elements.json'), 'utf8')) as {
    modules?: Array<{ declarations?: Array<{ tagName?: string; attributes?: Array<{ name: string }> }> }>;
  };

  const elements = new Map<string, ElementInfo>();
  for (const module of cem.modules ?? []) {
    for (const declaration of module.declarations ?? []) {
      if (!declaration.tagName) continue;
      elements.set(declaration.tagName, {
        attributes: new Set((declaration.attributes ?? []).map((a) => a.name)),
        parts: new Set<string>(),
      });
    }
  }

  const primitivesDir = join(primitivesRoot, 'src', 'primitives');
  for (const file of readdirSync(primitivesDir)) {
    if (!file.endsWith('.ts')) continue;
    const source = readFileSync(join(primitivesDir, file), 'utf8');
    const tag = /@customElement\('(we-[a-z0-9-]+)'\)/.exec(source)?.[1];
    if (!tag) continue;
    const info = elements.get(tag);
    if (!info) continue;

    // `part="a b"` in a rendered template, and `[part='a']` in the element's own styles.
    for (const [, names] of source.matchAll(/\bpart="([a-z0-9 _-]+)"/g)) {
      for (const name of names.split(/\s+/)) if (name) info.parts.add(name);
    }
    for (const [, name] of source.matchAll(/\[part=['"]([a-z0-9_-]+)['"]\]/g)) info.parts.add(name);
  }

  return elements;
}

interface Usage {
  file: string;
  tag: string;
  attributes: string[];
  part?: string;
}

/** Every `we-*` selector in the theme stylesheets, with its attribute filters and `::part()`. */
function readThemeUsages(): Usage[] {
  const cssRoot = join(here);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (entry.name.endsWith('.css')) files.push(join(dir, entry.name));
    }
  };
  walk(cssRoot);

  // Lookbehind rejects custom properties and data attributes: `--we-color-*`, `data-we-theme`.
  const selector = /(?<![-\w])(we-[a-z][a-z0-9-]*)((?:\[[^\]]*\])*)(?:::part\(\s*([a-z0-9_-]+)\s*\))?/g;
  const attribute = /\[\s*([a-zA-Z][\w-]*)/g;

  const usages: Usage[] = [];
  for (const file of files) {
    const css = readFileSync(file, 'utf8');
    for (const [, tag, attrs, part] of css.matchAll(selector)) {
      usages.push({
        file: file.slice(cssRoot.length + 1),
        tag,
        attributes: [...(attrs ?? '').matchAll(attribute)].map(([, name]) => name),
        ...(part ? { part } : {}),
      });
    }
  }
  return usages;
}

const elements = readElements();
const usages = readThemeUsages().filter((u) => !IGNORED_TAGS.has(u.tag));

describe('theme selectors resolve', () => {
  it('reads a non-trivial element vocabulary and a non-trivial set of theme usages', () => {
    // Guards the guard: a broken path or a changed decorator would otherwise make everything below
    // pass by finding nothing at all.
    expect(elements.size).toBeGreaterThan(40);
    expect(elements.get('we-button')?.parts.has('base')).toBe(true);
    expect(usages.length).toBeGreaterThan(20);
  });

  it('names only elements that exist', () => {
    const unknown = usages.filter((u) => !elements.has(u.tag)).map((u) => `${u.file}: <${u.tag}>`);
    expect([...new Set(unknown)]).toEqual([]);
  });

  it('names only parts the element actually exposes', () => {
    const unknown = usages
      .filter((u) => u.part && elements.has(u.tag) && !elements.get(u.tag)!.parts.has(u.part))
      .map((u) => `${u.file}: ${u.tag}::part(${u.part}) — has: ${[...elements.get(u.tag)!.parts].sort().join(', ')}`);
    expect([...new Set(unknown)]).toEqual([]);
  });

  it('names only attributes the element actually declares', () => {
    const unknown = usages
      .filter((u) => elements.has(u.tag))
      .flatMap((u) =>
        u.attributes
          .filter((name) => !elements.get(u.tag)!.attributes.has(name))
          .map((name) => `${u.file}: ${u.tag}[${name}]`),
      );
    expect([...new Set(unknown)]).toEqual([]);
  });
});
