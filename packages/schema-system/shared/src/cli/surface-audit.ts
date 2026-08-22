#!/usr/bin/env node
/**
 * What is each `surface-sunken` actually sitting on?
 *
 * `surface-sunken` means a well recessed *into* a surface — an input trough, an inset box. It is
 * not what a card sitting on the page is, and the two were indistinguishable in the source WE
 * migrated from: the pre-role templates wrote one grey (`neutral-100`) for both, because against a
 * `neutral-50` page that grey happened to look right either way. Migrating by value therefore
 * preserved every appearance and got a chunk of the *meanings* wrong — which shows up the first
 * time somebody drags the "Sunken" slider and watches the page header move.
 *
 * The discriminator is the nearest painted ancestor, so this imports each schema and walks the real
 * composed tree — the one a `sectionCard()` or a `cardShell()` from another package contributes to.
 * A node whose nearest painted ancestor is `page` is a surface, whatever colour it happens to be.
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
  // A prop can hold a node ($if branches, modal content). Skip `props.styles`, which is CSS.
  if (node.props) {
    for (const [k, v] of Object.entries(node.props)) {
      if (k === 'styles') continue;
      push(v);
    }
  }
  return out;
}

/** The role a node paints its background with, if it names one. */
function bgOf(node: Node): string | null {
  const bg = node.props?.bg;
  return typeof bg === 'string' && bg ? bg : null;
}

const findings: { file: string; path: string; on: string; type: string }[] = [];

function walk(node: Node, file: string, ancestorBg: string, path: string[]) {
  const bg = bgOf(node);
  const here = [...path, node.type ?? '?'];
  if (bg === 'surface-sunken') {
    findings.push({ file, path: here.slice(-4).join(' > '), on: ancestorBg, type: node.type ?? '?' });
  }
  const nextBg = bg ?? ancestorBg;
  for (const child of descend(node)) walk(child, file, nextBg, here);
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
  for (const value of Object.values(mod)) {
    // A root node with no `bg` of its own is assumed to be on the page — which is what a template
    // root is, and what a fragment exported on its own has no way to contradict.
    if (isNode(value)) walk(value, file, 'page', []);
  }
}

const byParent = new Map<string, typeof findings>();
for (const f of findings) {
  if (!byParent.has(f.on)) byParent.set(f.on, []);
  byParent.get(f.on)!.push(f);
}

for (const [parent, list] of [...byParent.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const verdict = parent === 'page' ? '  ← MISCLASSIFIED: on the page, so it is a surface' : '';
  console.log(`\non ${parent}: ${list.length}${verdict}`);
  for (const f of list) console.log(`   ${relative(process.cwd(), f.file)}  ${f.path}`);
}
console.log(`\n${findings.length} sunken nodes reached.`);
