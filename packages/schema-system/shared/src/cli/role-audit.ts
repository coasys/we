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
 * So this reports every `bg`, `color` and border colour that names a scale position — including one
 * written inside an expression, which is where a conditional colour hides — having imported
 * and walked the real composed tree — the same approach `surface-audit` takes, and for the same
 * reason: a `sectionCard()` from another package contributes nodes that no grep over source will
 * attribute to the route rendering it.
 *
 * **Not every one is a defect.** A palette is a legitimate use — a graph's node colours by category,
 * a chart series, a swatch somebody picked. Those are reported separately rather than counted as
 * findings, on the file they live in, because the judgement is "is this a meaning or a palette" and
 * only a person can make it.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { register } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROLE_NAMES } from '@we/design-utils';

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
 *
 * These said `GraphRoute/` until the directory was renamed to `GraphView/`, so both matched nothing
 * — an exemption that had quietly stopped exempting. Nobody noticed because the colours it was
 * meant to cover are written as expressions, which this script did not read either, so the two
 * faults cancelled into a clean run. A path in a regex is a reference nothing typechecks; if these
 * files move again, that is the failure mode to expect.
 */
const PALETTES = [/GraphView\/Palette\./, /GraphView\/Board\./, /\/fixtures\//];

/**
 * ## The code half
 *
 * Everything above walks composed schema trees, so it structurally cannot see a colour written in
 * TypeScript or SCSS — and the components, panels and overlays every template is rendered *through*
 * are exactly that. `4-components` has had its own check since the theme-reach work
 * (`themeReach.test.ts`, which is where the `CodeEditor` and `AudioVisualiser` palette exemptions
 * were argued); a vitest suite can only see its own package, so the editor, the graph engine and the
 * app shell had nothing looking at them at all.
 *
 * This pass is textual because there is nothing to walk: a scale position in a `style={{}}` object,
 * a `.scss` rule or a CodeMirror theme is a string in a file. Paths after `--code` on the command
 * line are scanned rather than imported.
 */
const CODE_FILE = /\.(ts|tsx|scss|css)$/;

/**
 * A scale position, in either spelling code uses: the custom property it compiles to, or the
 * `tokenVar('color', …)` call that builds one.
 *
 * The second alternative is not a nicety. `tokenVar` is what `dev-patterns` tells a component author
 * to reach for, so it is the *recommended* way to name a colour in TypeScript — and a scale position
 * passed to it is exactly as invisible to the contrast layer as the raw variable, while looking more
 * correct at the call site than the thing it expands to.
 */
const CODE_SCALE =
  /(?:var\(--we-color-|tokenVar\(\s*['"]color['"]\s*,\s*['"])(neutral|primary|success|warning|danger)-(?:0|25|50|75|100|[2-9]00|1000)/g;

/**
 * A colour that is not even a token — a hex literal or an `rgb()`/`hsl()` call in a style position.
 *
 * Worse than a scale position rather than merely different: a step at least follows the theme's hue,
 * saturation and polarity, where `#3b82f6` follows nothing and is the same blue in a black theme as
 * in a white one. Matched only next to a CSS property that paints, so a hex in a comment, an id or a
 * data string is not a finding.
 */
const CODE_LITERAL =
  /\b(background|background-color|backgroundColor|color|border|borderColor|border-color|fill|stroke|outline|box-shadow|boxShadow)\b\s*:\s*[^;,\n]*?(#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\()/g;

/**
 * Code whose colours are a palette, an engine's own drawing, or a last resort — with the reason.
 *
 * The same contract as `PALETTES`: a decision, listed so it is reviewable, never a heuristic. The
 * reasons print on every run so they get re-read rather than accumulated, which is the convention
 * `query-audit`'s `DELIBERATE` established.
 */
const CODE_PALETTES: { path: RegExp; why: string }[] = [
  {
    path: /CodeEditor/,
    why: 'syntax highlighting: a theme pinning dangerText means its error messages, not every string literal',
  },
  { path: /AudioVisualiser/, why: 'a waveform’s bars are a category, not a status' },
  { path: /\/3d\//, why: 'WebGL materials — lit in a scene, not painted on a surface the theme owns' },
  { path: /AppFailure/, why: 'the screen shown when the app did not start, so it cannot assume a stylesheet loaded' },
  { path: /\/fixtures\//, why: 'fixtures' },
];

/**
 * A palette that is one line rather than one file, marked where it is.
 *
 * `ThemePanel` is the case that needed it: a hue swatch is a *preview of a hue the user is choosing*,
 * so it has to be `hsl()` — and the rest of that file paints ordinary chrome that should be roles.
 * Exempting the file would have exempted the chrome too, which is the failure mode a coarse
 * exemption has and the reason `PALETTES` says a palette is a decision rather than a heuristic.
 *
 * The marker sits on the line or the one above it, with its reason, so the judgement is read where
 * the colour is instead of in a list somebody has to go and find.
 */
const LINE_EXEMPTION = /role-audit:\s*palette\b/;

/** Every `tokenVar('color', '…')` in a line, whatever it names. */
const TOKEN_VAR = /tokenVar\(\s*['"]color['"]\s*,\s*['"]([^'"]+)['"]/g;

/**
 * A name handed to `tokenVar('color', …)` that is neither a role nor a step on a real ramp.
 *
 * This is a worse failure than either thing the audit was built for, and a silent one. `tokenVar`
 * warns in development and then returns `var(--we-color-<name>)` regardless, so an unknown family
 * compiles to a variable nothing declares, the declaration is dropped, and the element paints
 * nothing — a border that is simply absent, which reads as a design decision rather than a bug.
 *
 * Four dividers in the editor were `ui-200`. There is no `ui` ramp; there never has been.
 */
const HUES = ['neutral', 'primary', 'success', 'warning', 'danger'];
const isKnownColour = (name: string) =>
  ROLE_NAMES.has(name) ||
  name === 'white' ||
  name === 'black' ||
  HUES.some((hue) => SCALE.test(name) && name.startsWith(`${hue}-`));

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

/** Every string literal inside an expression: `"a ? 'success-500' : 'surface'"` yields both. */
const EXPRESSION_LITERAL = /'([^']*)'|"([^"]*)"/g;

/**
 * The colours one prop could paint — one for a plain string, one per literal for an expression.
 *
 * The expression half is the half that was missing, and it hid a real defect for as long as this
 * script has existed: the transcribe panel's level meter wrote
 * `bg: { $: "speaking ? 'success-500' : 'surface-active'" }`, which is a scale position beside a
 * role in the same ternary. A conditional colour is the *commonest* place a scale position survives
 * a review — the eye reads the branch, not the value — and testing `typeof value === 'string'`
 * skipped every one of them while reporting a clean run.
 *
 * Literals that are not colours are harmless here: a finding must also match `SCALE`, which is five
 * known hue names and a step, and nothing else in a `bg` or `color` looks like that.
 */
function colorValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (isNode(value) && typeof (value as { $?: unknown }).$ === 'string')
    return [...(value as { $: string }).$.matchAll(EXPRESSION_LITERAL)].map((m) => m[1] ?? m[2] ?? '');
  return [];
}

/** The colours a border names, if it names tokens rather than raw CSS colours. */
function borderColorsOf(props: Record<string, unknown>): string[] {
  const explicit = colorValues(props.borderColor).filter(Boolean);
  if (explicit.length) return explicit;
  return colorValues(props.border)
    .map((shorthand) => shorthand.trim().split(/\s+/).pop())
    .filter((last): last is string => !!last && /^[a-z][a-z0-9-]*$/.test(last));
}

const findings: { file: string; path: string; prop: string; value: string; type: string }[] = [];

function walk(node: Node, file: string, path: string[]) {
  const here = [...path, node.type ?? '?'];
  const props = node.props ?? {};
  const candidates: [string, string[]][] = [
    ['bg', colorValues(props.bg)],
    ['color', colorValues(props.color)],
    ['border', borderColorsOf(props)],
  ];
  for (const [prop, values] of candidates) {
    for (const value of values) {
      if (SCALE.test(value)) {
        findings.push({ file, path: here.slice(-4).join(' > '), prop, value, type: node.type ?? '?' });
      }
    }
  }
  for (const child of descend(node)) walk(child, file, here);
}

async function walkDir(dir: string, match: RegExp): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkDir(full, match)));
    else if (match.test(entry.name) && !entry.name.includes('.test.') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

async function filesUnder(paths: string[], match: RegExp): Promise<string[]> {
  const out: string[] = [];
  for (const root of paths) {
    const s = await stat(root).catch(() => null);
    if (!s) continue;
    out.push(...(s.isDirectory() ? await walkDir(root, match) : [root]));
  }
  return out.sort();
}

const argv = process.argv.slice(2);
const split = argv.indexOf('--code');
const schemaRoots = (split === -1 ? argv : argv.slice(0, split)).map((a) => resolve(a));
const codeRoots = (split === -1 ? [] : argv.slice(split + 1)).map((a) => resolve(a));

const files = await filesUnder(schemaRoots, /\.ts$/);

for (const file of files) {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  } catch {
    continue; // Not every file in a template package is a schema.
  }
  for (const value of Object.values(mod)) if (isNode(value)) walk(value, file, []);
}

/**
 * Declarations only — several of these files discuss the very colours being asserted about.
 *
 * Line count is preserved, which is not incidental: a block comment replaced by nothing shifts every
 * line after it, so the numbers in the report point at the wrong place and the in-place exemption
 * looks for its marker on a line that has moved. A multi-line comment becomes the same number of
 * blank lines instead.
 */
const declarations = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => '\n'.repeat((block.match(/\n/g) ?? []).length))
    .split('\n')
    .map((line) => (line.trim().startsWith('//') ? '' : line))
    .join('\n');

const codeFindings: { file: string; line: number; kind: 'scale' | 'literal' | 'unknown'; text: string }[] = [];

let lineExemptions = 0;

for (const file of await filesUnder(codeRoots, CODE_FILE)) {
  const raw = (await readFile(file, 'utf-8')).split('\n');
  // The marker lives in a comment, which `declarations` strips — so it is read from the raw text and
  // the findings from the stripped text, by line number.
  // On the line itself, or anywhere in the comment block immediately above it — a reason worth
  // writing rarely fits on one line, and an exemption that only works when it does would be an
  // exemption that rewards terseness.
  const exempt = (i: number) => {
    if (LINE_EXEMPTION.test(raw[i] ?? '')) return true;
    for (let j = i - 1; j >= 0 && /^\s*(\/\/|\*|\/\*)/.test(raw[j] ?? ''); j -= 1) {
      if (LINE_EXEMPTION.test(raw[j]!)) return true;
    }
    return false;
  };
  const lines = declarations(raw.join('\n')).split('\n');
  lines.forEach((line, i) => {
    // `test` on a `/g` regex advances `lastIndex`, so each is reset before it is asked.
    const matches = (re: RegExp) => {
      re.lastIndex = 0;
      return re.test(line);
    };
    const unknown = [...line.matchAll(TOKEN_VAR)].map((m) => m[1]!).filter((name) => !isKnownColour(name));

    for (const [kind, hit] of [
      ['scale', matches(CODE_SCALE)],
      ['literal', matches(CODE_LITERAL)],
      ['unknown', unknown.length > 0],
    ] as const) {
      if (!hit) continue;
      if (exempt(i)) {
        lineExemptions += 1;
        continue;
      }
      codeFindings.push({ file, line: i + 1, kind, text: line.trim().slice(0, 110) });
    }
  });
}

const codePalette = codeFindings.filter((f) => CODE_PALETTES.some((p) => p.path.test(f.file)));
const codeDefects = codeFindings.filter((f) => !CODE_PALETTES.some((p) => p.path.test(f.file)));

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

if (codeRoots.length) {
  const byCodeFile = new Map<string, typeof codeDefects>();
  for (const f of codeDefects) {
    const key = relative(process.cwd(), f.file);
    if (!byCodeFile.has(key)) byCodeFile.set(key, []);
    byCodeFile.get(key)!.push(f);
  }
  for (const [file, list] of [...byCodeFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${file}  (${list.length})`);
    for (const f of list) console.log(`   ${f.line}: ${f.text}`);
  }

  const count = (kind: (typeof codeDefects)[number]['kind']) => codeDefects.filter((f) => f.kind === kind).length;
  console.log(
    `\n${count('scale')} scale positions, ${count('literal')} raw colours and ` +
      `${count('unknown')} names that are not colours at all, in code.`,
  );
  console.log(
    `${codePalette.length} in code declared to be a palette, and ${lineExemptions} marked in place, not counted:`,
  );
  for (const p of CODE_PALETTES) console.log(`   ${p.path.source} — ${p.why}`);
}

process.exit(defects.length + codeDefects.length ? 1 : 0);
