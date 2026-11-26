/**
 * The specs and their suites cite each other, and a citation nobody checks goes stale silently: a
 * case renamed, a test file moved, a section added with nothing pinning it. This reads every spec
 * under `docs/spec/` (the template format, operations, profiles) and holds them to three things:
 *
 * - every case id a footer cites exists in some vector file (a `*` in an id matches any run of
 *   characters, and at least one case must match);
 * - every file a footer links to exists;
 * - every normative section is covered by a footer — its own, or the one that closes the run of
 *   sections it belongs to (the operations spec closes each file with one).
 *
 * A footer is the `Implemented by:` and `Pinned by:` paragraphs after a section's `---`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SPECS = ['template', 'operations', 'profiles'].map((dir) => join(ROOT, 'docs', 'spec', dir));

/** Sections that say what the spec is or is not yet, rather than a rule anything implements. */
const NOT_NORMATIVE = new Set([
  'Contents',
  'Terms',
  'Planned',
  'What the vectors do not yet carry',
  'What a vector does not carry',
]);

/** Generated member lists: each member's footer is its row, and the generator is pinned by its own test. */
const GENERATED = new Set([join(ROOT, 'docs', 'spec', 'profiles', 'members.md')]);

function walk(dir: string, accept: (path: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, accept, out);
    else if (accept(path)) out.push(path);
  }
  return out;
}

/** Every case id in every vector file in the repository. */
const CASE_IDS: string[] = walk(join(ROOT, 'packages'), (path) => /\/vectors\/.+\.json$/.test(path)).flatMap((path) => {
  const file = JSON.parse(readFileSync(path, 'utf8')) as { cases?: { id?: unknown }[] };
  return (file.cases ?? []).map((c) => c.id).filter((id): id is string => typeof id === 'string');
});
/** A cited name is a case id when it starts the way some case id does. */
const FAMILIES = new Set(CASE_IDS.map((id) => id.split('.')[0]));

interface Section {
  file: string;
  heading: string;
  footer: string;
}

function sections(file: string): Section[] {
  const out: Section[] = [];
  let current: Section | undefined;
  let inFooter = false;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      current = { file, heading: heading[1].trim(), footer: '' };
      out.push(current);
      inFooter = false;
      continue;
    }
    if (/^(Implemented by|Pinned by)/.test(line)) inFooter = true;
    else if (line.trim() === '' || line.startsWith('#') || line.startsWith('>')) inFooter = false;
    if (inFooter && current) current.footer += `${line}\n`;
  }
  return out;
}

const FILES = SPECS.flatMap((dir) => walk(dir, (path) => path.endsWith('.md')));
const ALL = FILES.flatMap(sections);
const where = (s: Section) => `${relative(ROOT, s.file)} § ${s.heading}`;

describe('spec ↔ suite links', () => {
  it('reads the specs and the vectors', () => {
    expect(FILES.length).toBeGreaterThan(15);
    expect(CASE_IDS.length).toBeGreaterThan(1000);
  });

  it('every case id a footer cites exists', () => {
    const missing: string[] = [];
    let cited = 0;
    for (const section of ALL) {
      for (const [, name] of section.footer.matchAll(/`([^`\s]+)`/g)) {
        if (!/^[a-z][\w-]*(\.[\w$*-]+)+$/.test(name) || !FAMILIES.has(name.split('.')[0])) continue;
        // A path or a file name in backticks is not an id.
        if (/\.(ts|tsx|md|json|mjs)$/.test(name)) continue;
        cited++;
        const pattern = new RegExp(`^${name.replace(/[.$]/g, '\\$&').replace(/\*/g, '.*')}$`);
        if (!CASE_IDS.some((id) => pattern.test(id))) missing.push(`${where(section)}: ${name}`);
      }
    }
    expect(missing).toEqual([]);
    // The check is only as good as what it reads: a footer format it stopped recognising would pass.
    expect(cited).toBeGreaterThan(100);
  });

  it('every file a footer links to exists', () => {
    const missing: string[] = [];
    let linked = 0;
    for (const section of ALL) {
      for (const [, target] of section.footer.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
        if (/^[a-z]+:/.test(target)) continue;
        linked++;
        if (!existsSync(resolve(dirname(section.file), target))) missing.push(`${where(section)}: ${target}`);
      }
    }
    expect(missing).toEqual([]);
    expect(linked).toBeGreaterThan(100);
  });

  it('every normative section is covered by a footer', () => {
    const uncovered: string[] = [];
    for (const file of FILES) {
      if (GENERATED.has(file)) continue;
      let pending: Section[] = [];
      for (const section of sections(file)) {
        if (!NOT_NORMATIVE.has(section.heading)) pending.push(section);
        // A footer closes its own section and the run of sections above it that had none.
        if (/Pinned by/.test(section.footer)) pending = [];
      }
      uncovered.push(...pending.map(where));
    }
    expect(uncovered).toEqual([]);
  });
});
