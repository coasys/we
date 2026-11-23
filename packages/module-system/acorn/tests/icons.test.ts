/**
 * Every icon the Acorn surface names must exist in the Phosphor set the app draws from.
 *
 * `we-icon` resolves a name from the bundled map or, failing that, the Phosphor CDN. A name that
 * is in neither renders nothing: the rail button for "Acorn projects" was there, clickable and
 * invisible, because `squirrel` is not a Phosphor icon.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../../..');
const PHOSPHOR = resolve(ROOT, 'packages/design-system/3-primitives/node_modules/@phosphor-icons/core/assets/regular');

/** The files that put an Acorn icon on screen: the module, its template, and the two rail entries. */
const SOURCES = [
  'packages/module-system/acorn/src/index.ts',
  'packages/templates/acorn/src/AcornTemplate.ts',
  'packages/templates/shell/src/Sidebar.schema.ts',
  'packages/templates/cartridges/src/coasys/app.ts',
];

/** The icon names on the lines that belong to Acorn — an `icon:` key or a `we-icon` name. */
function acornIcons(file: string): string[] {
  const text = readFileSync(resolve(ROOT, file), 'utf8');
  const whole = file.includes('/acorn/');
  const names: string[] = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const nearAcorn = whole || /acorn/i.test(lines.slice(Math.max(0, i - 1), i + 3).join('\n'));
    if (!nearAcorn) return;
    for (const m of line.matchAll(/(?:icon|name):\s*["\x27]([a-z][a-z0-9-]*)["\x27]/g)) {
      if (/icon:/.test(m[0]) || /we-icon/.test(line)) names.push(m[1]);
    }
  });
  return names;
}

describe('@we/module-acorn — icons', () => {
  it('has the Phosphor assets to check against', () => {
    expect(existsSync(PHOSPHOR)).toBe(true);
  });

  for (const file of SOURCES) {
    it(`${file} names only icons Phosphor has`, () => {
      const names = acornIcons(file);
      expect(names.length).toBeGreaterThan(0);
      const missing = names.filter((name) => !existsSync(resolve(PHOSPHOR, `${name}.svg`)));
      expect(missing).toEqual([]);
    });
  }
});
