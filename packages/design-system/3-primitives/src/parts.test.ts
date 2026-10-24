/**
 * The public parts list, held to the source and to the themes that use it.
 *
 * `PUBLIC_PARTS` is an API: a theme's CSS points at these names. So it has to say exactly what the
 * primitives draw — no part listed that no longer exists, and no part drawn that is neither listed nor
 * named internal — and the built-in themes have to stay inside it, since they are the examples every
 * other theme is written from.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { INTERNAL_PARTS, PUBLIC_PARTS } from './parts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PRIMITIVES = join(HERE, 'primitives');
const THEMES = join(HERE, '..', '..', '2-themes', 'src');

/** Every element's parts, as its source draws them. */
function drawnParts(): Map<string, Set<string>> {
  const drawn = new Map<string, Set<string>>();
  for (const file of readdirSync(PRIMITIVES)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    const source = readFileSync(join(PRIMITIVES, file), 'utf8');
    // A file can hold more than one element (`we-tree` and `we-tree-item`); each owns the source from
    // its decorator to the next one. Styles above the first decorator belong to the first element.
    const tags = [...source.matchAll(/@customElement\('([a-z-]+)'\)/g)];
    tags.forEach((match, i) => {
      const start = i === 0 ? 0 : match.index;
      const end = tags[i + 1]?.index ?? source.length;
      const parts = new Set([...source.slice(start, end).matchAll(/part=["']([a-z-]+)["']/g)].map((m) => m[1]));
      drawn.set(match[1], parts);
    });
  }
  return drawn;
}

describe('the public parts', () => {
  const drawn = drawnParts();

  it('are all drawn by the element that lists them', () => {
    for (const [tag, parts] of Object.entries(PUBLIC_PARTS)) {
      for (const part of parts) expect(drawn.get(tag)?.has(part), `${tag}::part(${part})`).toBe(true);
    }
  });

  it('leave nothing an element draws unaccounted for', () => {
    for (const [tag, parts] of drawn) {
      for (const part of parts) {
        const known = PUBLIC_PARTS[tag]?.includes(part) || part in INTERNAL_PARTS;
        expect(known, `${tag} draws part "${part}", which is neither public nor named internal`).toBe(true);
      }
    }
  });

  it('name nothing internal that no element draws as internal', () => {
    const internalSomewhere = new Set<string>();
    for (const [tag, parts] of drawn) {
      for (const part of parts) if (!PUBLIC_PARTS[tag]?.includes(part)) internalSomewhere.add(part);
    }
    expect(Object.keys(INTERNAL_PARTS).filter((part) => !internalSomewhere.has(part))).toEqual([]);
  });
});

describe('the built-in themes', () => {
  const themeCss = readdirSync(THEMES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((dir) => {
      try {
        return [[dir.name, readFileSync(join(THEMES, dir.name, 'index.css'), 'utf8')] as const];
      } catch {
        return [];
      }
    });

  it('style only public parts', () => {
    for (const [theme, css] of themeCss) {
      for (const match of css.matchAll(/(we-[a-z-]+)(?:\[[^\]]*\])*::part\(([a-z-]+)\)/g)) {
        const [, tag, part] = match;
        expect(PUBLIC_PARTS[tag]?.includes(part), `${theme} styles ${tag}::part(${part})`).toBe(true);
      }
    }
  });
});
