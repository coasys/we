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
 *
 * ## Three things it used to get wrong, all of them inflating the count
 *
 * It reported 280 "misclassified", and a reader who checked a handful and found them all spurious
 * would stop reading the rest — which is the failure mode an audit cannot afford. The three causes:
 *
 * 1. **A package's `index.ts` re-exports its schemas**, so every node in `WorkshopTemplate.schema.ts`
 *    was walked twice and counted twice: 28 of the showcase findings were 28 duplicates of the other
 *    28. Nodes are deduplicated by identity now — the same object reached twice is one node.
 * 2. **Some primitives paint a background without a `bg` prop.** `we-modal` and `we-drawer` declare
 *    `bg: var(--we-role-surface)` in their own `DEFAULT_PROPS`, so a sunken box inside a modal is
 *    correctly sunken and was being reported as sitting on the page.
 * 3. **A fragment exported on its own has no ground**, and assuming `page` asserts something the
 *    file cannot know. A panel schema is mounted on a dock frame, a settings section inside a
 *    `chrome` overlay. Those are now reported separately as unknown rather than as findings: the
 *    honest answer to "what is this on?" is sometimes "this file does not say".
 *
 * A root counts as knowing its ground when it paints one itself, or when it is a template root
 * (it carries `meta`), which is mounted on the page by definition.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
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

/**
 * Primitives that paint a background with no `bg` prop, from their own `DEFAULT_PROPS`.
 *
 * Restated rather than imported: the primitives are Lit modules that register custom elements on
 * import, and the manifest the other extractors read does not carry default prop *values*. Kept to
 * the two that actually declare one, so the list is checkable by reading two files —
 * `primitives/modal.ts` and `primitives/drawer.ts`.
 *
 * `Card` is deliberately absent. It declares `family: 'surface'`, which is the radius, padding and
 * gap group — not a background. An unpainted Card shows whatever is behind it, so it passes its own
 * ancestor's ground down, which is what the walk already does.
 */
const PAINTS_BY_DEFAULT: Record<string, string> = {
  'we-modal': 'surface',
  'we-drawer': 'surface',
};

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

/** The role a node paints its background with — its own `bg`, else what its type paints by default. */
function bgOf(node: Node): string | null {
  const bg = node.props?.bg;
  if (typeof bg === 'string' && bg) return bg;
  return (typeof node.type === 'string' && PAINTS_BY_DEFAULT[node.type]) || null;
}

/** A template or view root, which the host mounts on the page. Anything else is a fragment. */
const isTemplateRoot = (node: Node) => !!node.meta && typeof node.meta === 'object';

/**
 * Schemas that exist to exercise the renderer rather than to be used.
 *
 * They deliberately paint every role in every arrangement, so they are the largest single source of
 * findings and none of them is a defect. Excluded by path rather than by a flag in the file: they
 * are already segregated into a `tests/` directory and a `SchemaTests` entry point.
 */
const FIXTURES = [/\/schemas\/shell\/tests\//, /SchemaTests\.schema\.ts$/];

/**
 * What a sunken box on each ground actually looks like, and therefore which grounds are defects.
 *
 * This table is the correction to what the script used to assert. It reported every sunken box on
 * `page` as misclassified, on the reasoning that sunken means "recessed into a *surface*" — which is
 * what the roles table says, and is not what the role is built from. `role.ts` derives it as
 * `oklch(from var(--we-role-page) calc(l - 0.035) c h)`, measured from the page **deliberately**,
 * because in a light theme `surface` is clamped at white and a step down from it lands above the
 * page. So a trough on the page is one clean step below its ground and correct by construction,
 * which is exactly what a board column is, and 31 of those were being reported as bugs.
 *
 * The grounds that are genuinely wrong are the two nobody was looking at. Lightness in L points,
 * from the dark pins in `surfacesForPolarity` and the parametric defaults in `role.ts`:
 *
 * | ground           | dark          | light         |
 * | ---------------- | ------------- | ------------- |
 * | `surface`        | 4.5 below     | 6.0 below     |
 * | `page`           | 2.0 below     | 3.5 below     |
 * | `chrome`         | **1.0 above** | **0.5 below** |
 * | `surface-sunken` | 0             | 0             |
 *
 * On `chrome` the box is not merely faint, it **inverts**: lighter than its ground in dark and
 * darker in light. That is the precise failure roles exist to prevent, and it is invisible in both
 * directions — the card is carried entirely by its border. On another `surface-sunken` there is no
 * difference at all.
 *
 * `surfaces.test.ts` asserts the stack's *order* and so passes on both: chrome and sunken are not
 * compared there, because nothing had noticed they needed to be.
 */
const VERDICTS: Record<string, { note: string; defect: true }> = {
  chrome: {
    note: 'DEFECT: 0.5 L below chrome in light and 1.0 above in dark — invisible, and inverts. Use `surface`.',
    defect: true,
  },
  'surface-sunken': {
    note: 'DEFECT: a well inside a well is the same colour as its ground. Use `surface`, or drop the bg.',
    defect: true,
  },
};

/**
 * One entry per sunken node, keyed by the node's own identity.
 *
 * Ground and attribution are worked out separately, because the file that *writes* a colour and the
 * file that *knows what it sits on* are routinely not the same one. `SpaceSettings.ts` exports the
 * settings sections and writes twelve sunken boxes; nothing in it says they are mounted inside an
 * overlay painted `chrome` — only `shell/index.ts`, which composes them, knows that, and it writes
 * no colour at all. Coupling the two (first walk wins, for both) meant choosing which half to get
 * wrong: attribute to the composer and the finding names a file with nothing to fix in it, or
 * attribute to the writer and every one of those twelve reports its ground as unknown.
 *
 * So every root is walked, each node collects every ground any walk reached it under, and the best
 * answer of each kind is taken at the end.
 */
const sunken = new Map<Node, { path: string; type: string; grounds: Set<string>; files: Set<string> }>();

/** Node identities already walked under a given ground — bounds the work on a shared fragment. */
const visited = new Map<Node, Set<string>>();

function walk(node: Node, file: string, ancestorBg: string | null, path: string[]) {
  const under = ancestorBg ?? '';
  const seenGrounds = visited.get(node) ?? new Set<string>();
  if (seenGrounds.has(under)) return;
  seenGrounds.add(under);
  visited.set(node, seenGrounds);

  const bg = bgOf(node);
  const here = [...path, node.type ?? '?'];
  if (bg === 'surface-sunken') {
    const entry = sunken.get(node) ?? {
      path: here.slice(-4).join(' > '),
      type: node.type ?? '?',
      grounds: new Set<string>(),
      files: new Set<string>(),
    };
    if (ancestorBg !== null) entry.grounds.add(ancestorBg);
    entry.files.add(file);
    sunken.set(node, entry);
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

/*
  Which of the files that reached a node gets named in its finding.

  A file that contains the word `surface-sunken` wins, because it is the file somebody would have to
  edit. Then the deepest path, then a named file over an `index.ts`. Each tier covers a barrel the
  others miss: `showcase/src/index.ts` re-exports its own siblings (same depth, beaten on name),
  `views/src/Views.schema.ts` exists purely to give the validator an entry point (beaten on depth),
  and `app-shell/.../schemas/shell/index.ts` is deeper than the shell templates it re-exports, so
  only the literal beats it — and attributing a colour to a barrel names the one file where it
  cannot be fixed.

  What this cannot attribute is a node built by a *function* — a `@we/template-kit` fragment exports
  helpers rather than nodes, so the walk never starts there and the finding lands on whichever
  template called it. That is the honest answer: the template chose to place it.
*/
const sources = new Map<string, string>();
for (const file of files) sources.set(file, await readFile(file, 'utf-8').catch(() => ''));

const depth = (f: string) => f.split('/').length;
const writesIt = (f: string) => Number(sources.get(f)?.includes('surface-sunken') ?? false);
const bestFile = (candidates: Iterable<string>) =>
  [...candidates].sort(
    (a, b) =>
      writesIt(b) - writesIt(a) ||
      depth(b) - depth(a) ||
      Number(a.endsWith('/index.ts')) - Number(b.endsWith('/index.ts')) ||
      a.localeCompare(b),
  )[0]!;

/**
 * The ground to report when several walks reached the same node under different ones.
 *
 * The most specific wins, and specificity here is "how much the composing file knew". A section is
 * reached both on its own (no ground) and through the shell that mounts it (`chrome`); the second
 * walk is the one that learned something. Where two real grounds disagree the node genuinely renders
 * on both — a fragment used in a modal and on a page — and the defect grounds are reported first,
 * because a box that is invisible in one of the two places it appears is still a box to fix.
 */
const groundRank = (g: string) => (VERDICTS[g] ? 0 : 1);
const bestGround = (grounds: Set<string>) => [...grounds].sort((a, b) => groundRank(a) - groundRank(b))[0];

for (const file of files) {
  if (FIXTURES.some((re) => re.test(file))) continue;
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  } catch {
    continue; // Not every file in a template package is a schema.
  }
  for (const value of Object.values(mod)) {
    if (!isNode(value)) continue;
    // A template root is on the page. A fragment that paints nothing cannot know, and says so.
    walk(value, file, isTemplateRoot(value) ? 'page' : bgOf(value), []);
  }
}

const byParent = new Map<string, { file: string; path: string }[]>();
const unknownGround: { file: string; path: string }[] = [];

for (const entry of sunken.values()) {
  const row = { file: relative(process.cwd(), bestFile(entry.files)), path: entry.path };
  const ground = bestGround(entry.grounds);
  if (ground === undefined) unknownGround.push(row);
  else (byParent.get(ground) ?? byParent.set(ground, []).get(ground)!).push(row);
}

const order = (g: string) => [groundRank(g), -(byParent.get(g)?.length ?? 0)] as const;
const grounds = [...byParent.keys()].sort((a, b) => order(a)[0] - order(b)[0] || order(a)[1] - order(b)[1]);

for (const ground of grounds) {
  const list = byParent.get(ground)!;
  const verdict = VERDICTS[ground];
  console.log(`\non ${ground}: ${list.length}${verdict ? `  ← ${verdict.note}` : ''}`);
  for (const f of list.sort((a, b) => a.file.localeCompare(b.file))) console.log(`   ${f.file}  ${f.path}`);
}

if (unknownGround.length) {
  console.log(`\nground not stated by any file that mounts it: ${unknownGround.length}`);
  for (const f of unknownGround.sort((a, b) => a.file.localeCompare(b.file))) console.log(`   ${f.file}  ${f.path}`);
}

console.log(`\n${sunken.size} sunken nodes reached.`);

/*
  Only a ground in VERDICTS fails the run, which is what lets this go in CI. `page` and `surface` are
  both correct grounds, and the unknown bucket is the audit declining to guess rather than a defect.
*/
const defects = Object.keys(VERDICTS).reduce((n, ground) => n + (byParent.get(ground)?.length ?? 0), 0);
if (defects > 0) {
  console.log(`\n${defects} sunken nodes are invisible against their ground.`);
  process.exitCode = 1;
}
