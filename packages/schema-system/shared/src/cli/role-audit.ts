#!/usr/bin/env node
/**
 * Which colours in the composed templates are scale positions where a role belongs?
 *
 * A scale position is not frozen — it is computed from the theme's neutral hue, saturation, floor,
 * ceiling and polarity, so it moves when any of those move and it inverts with the ramp. What it
 * does not follow is what the theme *decides*. A theme pins roles, not steps: `channels` sets its
 * surface equal to its page and `timeline` sets its to pure white, and a node naming a step cannot
 * hear either. In `channels`, `neutral-100` measures [7,8,11] against a surface of [26,28,33].
 *
 * The second half matters more and is quieter: the measure-and-correct pass at apply time operates
 * on roles. A label coloured `neutral-600` is never measured against what is behind it, never walked
 * toward legibility, and never appears in the theme editor's audit either. It is invisible to the
 * whole contrast layer.
 *
 * So this reports every `bg`, `color` and border colour that names a scale position, having imported
 * and walked the real composed tree — the same approach `surface-audit` takes, and for the same
 * reason: a `sectionCard()` from another package contributes nodes that no grep over source will
 * attribute to the route rendering it.
 *
 * **Not every one is a defect.** A palette is a legitimate use — a graph's node colours by category,
 * a chart series, a swatch somebody picked. Those are reported separately rather than counted as
 * findings, on the file they live in, because the judgement is "is this a meaning or a palette" and
 * only a person can make it.
 */
import { readdir, stat } from 'node:fs/promises';
import { register } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

register('./assetHooks.mjs', import.meta.url);

interface Node {
  type?: string;
  props?: Record<string, unknown>;
  children?: unknown;
  routes?: unknown;
  slots?: Record<string, unknown>;
  [k: string]: unknown;
}

const isNode = (v: unknown): v is Node => !!v && typeof v === 'object' && !Array.isArray(v);

/** A scale position: `<family>-<step>`, the shape `--we-color-*` is built from. */
const SCALE = /^(neutral|primary|success|warning|danger)-(0|25|50|75|100|200|300|400|500|600|700|800|900|1000)$/;

/**
 * Files whose colours are palettes rather than meanings.
 *
 * Named rather than inferred: a palette is a *decision*, and there is nothing in a node that
 * distinguishes "this category is blue" from "this card forgot to say surface". Listing them here
 * makes the exemption reviewable, which a heuristic would not be.
 */
const PALETTES = [/GraphRoute\/Palette\./, /GraphRoute\/Board\./, /\/fixtures\//];

/** Every child position a node can hold — children, routes, slots, and nodes hiding inside props. */
function descend(node: Node): Node[] {
  const out: Node[] = [];
  const push = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(push);
    else if (isNode(v)) out.push(v);
  };
  push(node.children);
  push(node.routes);
  if (node.slots) Object.values(node.slots).forEach(push);
  if (node.props) {
    for (const [k, v] of Object.entries(node.props)) {
      if (k === 'styles') continue;
      push(v);
    }
  }
  return out;
}

/** The colour a border shorthand names, if it names a token rather than a raw CSS colour. */
function borderColorOf(props: Record<string, unknown>): string | undefined {
  const explicit = props.borderColor;
  if (typeof explicit === 'string' && explicit) return explicit;
  const shorthand = props.border;
  if (typeof shorthand !== 'string') return undefined;
  const last = shorthand.trim().split(/\s+/).pop();
  return last && /^[a-z][a-z0-9-]*$/.test(last) ? last : undefined;
}

const findings: { file: string; path: string; prop: string; value: string; type: string }[] = [];

function walk(node: Node, file: string, path: string[]) {
  const here = [...path, node.type ?? '?'];
  const props = node.props ?? {};
  const candidates: [string, unknown][] = [
    ['bg', props.bg],
    ['color', props.color],
    ['border', borderColorOf(props)],
  ];
  for (const [prop, value] of candidates) {
    if (typeof value === 'string' && SCALE.test(value)) {
      findings.push({ file, path: here.slice(-4).join(' > '), prop, value, type: node.type ?? '?' });
    }
  }
  for (const child of descend(node)) walk(child, file, here);
}

async function walkDir(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkDir(full)));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts'))
      out.push(full);
  }
  return out;
}

const roots = process.argv.slice(2).map((a) => resolve(a));
const files: string[] = [];
for (const root of roots) {
  const s = await stat(root).catch(() => null);
  if (!s) continue;
  files.push(...(s.isDirectory() ? await walkDir(root) : [root]));
}

for (const file of files.sort()) {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  } catch {
    continue; // Not every file in a template package is a schema.
  }
  for (const value of Object.values(mod)) if (isNode(value)) walk(value, file, []);
}

const palette = findings.filter((f) => PALETTES.some((p) => p.test(f.file)));
const defects = findings.filter((f) => !PALETTES.some((p) => p.test(f.file)));

const byFile = new Map<string, typeof defects>();
for (const f of defects) {
  const key = relative(process.cwd(), f.file);
  if (!byFile.has(key)) byFile.set(key, []);
  byFile.get(key)!.push(f);
}

for (const [file, list] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${file}  (${list.length})`);
  for (const f of list) console.log(`   ${f.prop}="${f.value}"  ${f.path}`);
}

console.log(`\n${defects.length} scale positions where a role probably belongs.`);
console.log(`${palette.length} in files declared to be palettes, not counted.`);
process.exit(defects.length ? 1 : 0);
