#!/usr/bin/env node
/**
 * Which nodes ask the *browser* for a tooltip instead of using `we-tooltip`?
 *
 * `title` is a global HTML attribute, so any element can be given one and the browser will draw its
 * own bubble: unstyled, about a second late, truncated, absent on a touchscreen, and inconsistently
 * announced by screen readers. Two of them next to each other is how this was noticed — `we-tooltip`
 * used to *reflect* a `title` prop, so it painted the styled bubble and the browser painted a second
 * one over the top. That collision is fixed by the rename to `content`; this exists for the half a
 * rename cannot fix, which is a `title` written by hand on some other element.
 *
 * ## Why a script rather than the validator
 *
 * The validator will not catch it, and cannot reasonably be made to: `title` is a legitimate global
 * attribute, allowlisted alongside `id` and `role`, so a schema naming it is *valid*. The mistake is
 * a design decision, not a malformed node — exactly the shape `role-audit` exists for one concept
 * along, and the reason both are scripts that walk the composed tree rather than rules in the
 * schema layer.
 *
 * ## What is a finding and what is not
 *
 * A finding is `title` on a node whose type **declares no `title` prop** — because that is exactly
 * when the value falls through to the global HTML attribute and the browser draws a bubble. Where a
 * component does declare one (`TaskDisplay` takes the task's title, `we-iframe` the name of the
 * embedded document) the value is content, never reaches the host as an attribute, and is not a
 * finding. That question is asked of the component registry rather than a list kept here — see
 * `declaresTitle`.
 *
 * Everything reported gets the same advice: the *hint* belongs in a `we-tooltip` wrapper, and the
 * *accessible name* — which `title` was often quietly doing double duty as, on an icon-only button
 * — belongs in `label`, which `we-button` maps to `aria-label`. Swapping one for the other without
 * adding the name is a silent regression, so both halves are named in the output.
 */
import { readdir, stat } from 'node:fs/promises';
import { register } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { getComponentMeta } from '../componentMeta';
import { contextData } from '../generated/contextData';

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

/**
 * Whether `title` on this node is a declared prop rather than the native attribute.
 *
 * Asked of the component registry rather than a list kept here, because the answer is already
 * written down: `TaskDisplay` takes the task's title, `VideoDisplay` the video's, `we-iframe` the
 * name of the embedded document. Those are *content*, they never reach the host as an attribute,
 * and the browser draws nothing. A hand-maintained exemption list would have had to name all of
 * them and would have gone stale the first time somebody added a component with a title.
 *
 * A node whose type declares no `title` is the finding: there the value falls through to the global
 * HTML attribute, which is the browser's tooltip and nothing else.
 *
 * `we-tooltip` is the one deliberate exception in the other direction — it no longer declares
 * `title`, so it lands here on its own, which is what should happen. See its `content`.
 */
const declaresTitle = (type: string): boolean =>
  (getComponentMeta(type, contextData)?.props ?? []).some((p) => p.name === 'title');

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

/** What the `title` says, as far as a static read can tell — a literal, or the expression source. */
function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  if (isNode(value) && typeof (value as { $?: unknown }).$ === 'string') return `{ $: ${(value as { $: string }).$} }`;
  return String(value);
}

const findings: { file: string; path: string; type: string; value: string }[] = [];

function walk(node: Node, file: string, path: string[]) {
  const here = [...path, node.type ?? '?'];
  const type = node.type ?? '?';
  const title = node.props?.title;
  if (title !== undefined && !declaresTitle(type)) {
    findings.push({ file, path: here.slice(-4).join(' > '), type, value: describe(title) });
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

const byFile = new Map<string, typeof findings>();
for (const f of findings) {
  const key = relative(process.cwd(), f.file);
  if (!byFile.has(key)) byFile.set(key, []);
  byFile.get(key)!.push(f);
}

for (const [file, list] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${file}  (${list.length})`);
  for (const f of list) console.log(`   <${f.type}> title="${f.value}"  ${f.path}`);
}

if (findings.length) {
  console.log(`\n${findings.length} nodes asking the browser for a tooltip.`);
  console.log(`Wrap the node in { type: 'we-tooltip', props: { content: … } } for the hint —`);
  console.log(`and where the control has no visible text, give it \`label\` too, or it loses its`);
  console.log(`accessible name along with the attribute.`);
} else {
  console.log('\nNo node asks the browser for a tooltip.');
}
process.exit(findings.length ? 1 : 0);
