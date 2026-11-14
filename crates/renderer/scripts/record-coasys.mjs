#!/usr/bin/env node
/**
 * Record the Coasys space from the real web renderer.
 *
 * Boots `apps/we-preview` (the whole WE app over `@we/backend-inmemory`) with the Coasys bundle and
 * `crates/renderer/fixtures/coasys/fixture.json`, under `?record=1` — the flag that mounts the
 * recorder bridge (`apps/we-preview/src/RecorderBridge.tsx`) and the connector's members/workflows
 * seeding, both gated on a dev build. The run is two passes:
 *
 * - **capture** — for each route: navigate, evaluate every store-member path the bundle's
 *   mounted surfaces reference (through the space-tier filtered bag, and again unfiltered to
 *   tell "absent by the tier" from "undefined"), and resolve every `$queries` descriptor through
 *   the same path the renderer uses (`resolveProp`/`deepUnwrap` → `pruneUnresolvedWhere`/
 *   `scopeIsAnchored` → `routeQuery` on the backend's own adapter → `Model.findAll`). The theme
 *   is never touched in this pass, and every route asserts it records under the same one.
 * - **photography** — the routes again under each theme at 1280×800. A screenshot label maps to
 *   its registered theme id (`glow` → `coasys--glow`, the way `themeRegistry` keys it), the
 *   applied theme is verified after every switch — a miss fails the run rather than writing a
 *   PNG of the wrong theme — and the capture theme is restored after each route.
 *
 * Output:
 * - `fixtures/coasys/snapshot.json` — `{ meta, stores, queries, invokes, routes }`. `routes.<id>`
 *   is the primary shape — per-route truth: params, member values, and one query capture per
 *   declaration, each carrying its `scope` (the `$queries` node's canonical path in the
 *   bundle), the resolved `dataset` it ran against, and the resolved `request` — or the
 *   authored `descriptor` for skipped/failed entries. The flat `stores`/`queries`/`invokes`
 *   tables are a lossy projection of the landing route's capture (`meta.flatScope`, `null`
 *   when it was not recorded), kept for consumers that only know the flat shape — see
 *   `fixtures/coasys/README.md`.
 * - `target/coasys-web/<route>-<theme>.png` — one per route × theme.
 *
 * Environment:
 * - `WE_RECORD_CHROME` — path to a Chrome/Chromium binary. Default: playwright's `chrome`
 *   channel (an installed Google Chrome).
 *
 * Usage:
 *   node record-coasys.mjs [--base <url>] [--wait <ms>] [--routes <csv>] [--themes <csv>]
 *   --base   use a preview already running there instead of starting one on :4317
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const FIXTURE = resolve(repoRoot, 'crates/renderer/fixtures/coasys/fixture.json');
const BUNDLE = resolve(repoRoot, 'bundles/coasys.bundle.json');
const OUT = resolve(repoRoot, 'crates/renderer/fixtures/coasys/snapshot.json');
const SHOTS = resolve(repoRoot, 'crates/renderer/target/coasys-web');

// `playwright-core` is a devDependency of `apps/we-preview` — resolved from the repo, so the
// recorder regenerates the snapshot on any checkout with the workspace installed, not just on
// the machine that first ran it.
const require = createRequire(resolve(repoRoot, 'apps/we-preview/package.json'));
const { chromium } = require('playwright-core');

function parseArgs(argv) {
  const args = { wait: 1200 };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inlineValue] = argv[i].split('=');
    const value = inlineValue ?? argv[i + 1];
    const consume = () => {
      if (inlineValue === undefined) i += 1;
      return value;
    };
    if (flag === '--base') args.base = consume();
    else if (flag === '--wait') args.wait = Number(consume());
    else if (flag === '--out') args.out = consume();
    else if (flag === '--shots') args.shots = consume();
    else if (flag === '--routes')
      args.routes = consume(); // comma list of route ids
    else if (flag === '--themes') args.themes = consume(); // comma list of theme labels
  }
  return args;
}
const args = parseArgs(process.argv.slice(2));

// Screenshot labels — what the PNG files are named, not necessarily the registered theme id.
// `--themes` reorders or subsets the photography without touching the captured data.
const THEMES = args.themes?.split(',') ?? ['light', 'dark', 'black', 'retro', 'glow', 'cyberpunk'];

/**
 * The routes the recorder photographs, and the surfaces each mounts for member/query collection.
 * `web` is the path handed to `routeStore.navigate`; `rust` is the `--route` the same route is
 * checked under on the Rust side. `overlay` is for pages that are shell views rather than routes —
 * About opens over whatever route is underneath.
 */
const ROUTES = [
  { id: 'index', web: '/space/preview-coasys', rust: '/space/preview-coasys', surfaces: ['root', 'panels', 'route:/'] },
  {
    id: 'workflows',
    web: '/space/preview-coasys/workflows',
    rust: '/space/preview-coasys/workflows',
    surfaces: ['root', 'panels', 'route:/workflows'],
  },
  {
    id: 'channels',
    web: '/space/preview-coasys/channels',
    rust: '/space/preview-coasys/channels',
    surfaces: ['root', 'panels', 'route:/channels'],
  },
  {
    id: 'channel-design',
    web: '/space/preview-coasys?channel=coasys-chan-design',
    rust: '/space/preview-coasys?channel=coasys-chan-design',
    surfaces: ['root', 'panels', 'route:/'],
  },
  {
    id: 'calls',
    web: '/space/preview-coasys/calls',
    rust: '/space/preview-coasys/calls',
    surfaces: ['root', 'panels', 'route:/calls'],
  },
  {
    id: 'call',
    web: '/space/preview-coasys/record/CollectionBlock?kind=call&id=coasys-call-weekly-sync',
    rust: '/space/preview-coasys/record/CollectionBlock?kind=call&id=coasys-call-weekly-sync',
    surfaces: ['root', 'panels', 'recordView:CollectionBlock:call'],
  },
  {
    id: 'people',
    web: '/space/preview-coasys/people',
    rust: '/space/preview-coasys/people',
    surfaces: ['root', 'panels', 'route:/people'],
  },
  {
    id: 'dna',
    web: '/space/preview-coasys/dna',
    rust: '/space/preview-coasys/dna',
    surfaces: ['root', 'panels', 'route:/dna'],
  },
  {
    id: 'person',
    web: '/space/preview-coasys/person?did=did:agent:mara',
    rust: '/space/preview-coasys/person?did=did:agent:mara',
    surfaces: ['root', 'panels', 'route:/person'],
    agentDid: 'did:agent:mara',
  },
  // `about` overlays wherever the user stands — `/workflows` here: a real page, and one with no
  // remembered query for `navigate` to resurrect (the route store restores a bare path's last search).
  {
    id: 'about',
    web: '/space/preview-coasys/workflows',
    rust: '/about',
    surfaces: ['page:about'],
    overlay: 'landing-page',
  },
];

/** The store roots a member path may hang off — everything else in an expression is scope or syntax. */
const STORE_ROOTS = new Set([
  'sessionStore',
  'accountStore',
  'runtimeStore',
  'datasetStore',
  'profileStore',
  'editorStore',
  'appStore',
  'spaceStore',
  'shapeStore',
  'recordStore',
  'themeStore',
  'templateStore',
  'routeStore',
  'shellStore',
  'chatStore',
  'presenceStore',
  'interpretationStore',
  'clockStore',
  'bundleStore',
  'workflowStore',
  'identityStore',
  'deviceStore',
  'consoleStore',
  'modules',
  'record',
  'clipboard',
  '$me',
]);

/**
 * Trailing segments an expression's method call leaves behind — `… .map(r, …)` on an accessor reads
 * `creatableEntities.map`, which is not a member; the member is `creatableEntities`.
 */
const METHOD_TAILS = new Set([
  'map',
  'filter',
  'find',
  'exists',
  'forEach',
  'reduce',
  'some',
  'every',
  'slice',
  'flatMap',
  'flat',
  'join',
  'concat',
  'includes',
  'indexOf',
  'sort',
  'reverse',
  'keys',
  'values',
  'entries',
  'at',
  'first',
  'last',
  'take',
  'drop',
  'count',
  'distinct',
  'push',
]);

function stripMethodTails(path) {
  const parts = path.split('.');
  while (parts.length > 1 && METHOD_TAILS.has(parts[parts.length - 1])) parts.pop();
  return parts.join('.');
}

/** Extract `store.member.path` references from an expression string into `out` (path → surfaces). */
function memberPaths(expr, out, surface) {
  if (typeof expr !== 'string') return;
  for (const match of expr.matchAll(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+/g)) {
    const path = stripMethodTails(match[0]);
    const root = path.split('.')[0];
    if (!STORE_ROOTS.has(root)) continue;
    const surfaces = out.get(path) ?? new Set();
    surfaces.add(surface);
    out.set(path, surfaces);
  }
}

/**
 * The path segment one array element occupies in the canonical scope path. An element that names
 * itself — a route's `path`, a panel's or page's `id` — names its segment (`routes[/calls]`,
 * `panels[inspector]`); anything else is positional (`children[3]`). Stable across runs because
 * the bundle is data; the id/path form also survives a sibling being inserted before it.
 */
function arraySegment(key, element, index) {
  if (element && typeof element === 'object' && !Array.isArray(element)) {
    if (typeof element.id === 'string') return `${key}[${element.id}]`;
    if (typeof element.path === 'string') return `${key}[${element.path}]`;
  }
  return `${key}[${index}]`;
}

/**
 * Walk one schema surface collecting everything the capture needs:
 * `{ $ }` expression strings (member paths), `$invoke` targets, `$queries` maps and `$agent` uses.
 *
 * `path` is the canonical declaration path of `node` inside the bundle — `template.meta.panels[…]`,
 * `template.routes[…]`, `pages[…]`, `app.…` — seeded so the same node gets the same scope id
 * whether the scan reached it through its own surface (`route:/calls`) or through the recursive
 * `root` walk that passes over it on the way past. A `$queries` entry's identity is that path;
 * `scope` on the capture records it so a consumer can bind each answer to its declaration.
 */
function scanSurface(node, bag, surface, path) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const item of node) scanSurface(item, bag, surface, path);
    return;
  }
  if (typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key === '$queries' && value && typeof value === 'object') {
      // Every descriptor per name — two surfaces ask `signalTypes` with different sorts, and a
      // name-keyed map silently kept the last. Identity is the declaration site (scope) plus the
      // resolved request, decided at run time; the scan keeps them all.
      const scope = path.join('.');
      for (const [name, descriptor] of Object.entries(value)) {
        const list = bag.queries.get(name) ?? [];
        list.push({ descriptor, surface, scope });
        bag.queries.set(name, list);
      }
      continue;
    }
    if (key === '$invoke') {
      if (typeof value === 'string') bag.invokes.add(value);
      continue;
    }
    if (key === '$') {
      memberPaths(value, bag.members, surface);
      continue;
    }
    if (node.type === '$agent') {
      if (node.props?.did)
        memberPaths(typeof node.props.did === 'string' ? node.props.did : node.props.did?.$, bag.members, surface);
      bag.agents.add(node.props?.as ?? 'agent');
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        scanSurface(value[i], bag, surface, [...path, arraySegment(key, value[i], i)]);
      }
    } else {
      scanSurface(value, bag, surface, [...path, key]);
    }
  }
}

/**
 * The bundle's surfaces keyed the way the route table names them, each with the canonical
 * scope path the scan seeds — the same path the recursive `root` walk computes for the same
 * node, so a declaration's identity does not depend on which surface discovered it.
 */
function surfacesOf(bundle) {
  const out = new Map();
  const space = bundle.templates?.find((t) => (t.meta?.role ?? 'shell') !== 'view') ?? bundle.templates?.[0];
  // The template object IS the root schema node ({type, props, children} at top level).
  out.set('root', { node: space, scope: ['template'] });
  for (const panel of space?.meta?.panels ?? []) {
    out.set(`panel:${panel.id}`, {
      node: panel.node ?? panel,
      scope: ['template', 'meta', `panels[${panel.id}]`, ...(panel.node ? ['node'] : [])],
    });
  }
  for (const route of space?.routes ?? []) {
    out.set(`route:${route.path}`, { node: route, scope: ['template', `routes[${route.path}]`] });
  }
  for (const [key, view] of Object.entries(space?.meta?.recordViews ?? {})) {
    out.set(`recordView:${key}`, { node: view, scope: ['template', 'meta', 'recordViews', key] });
  }
  for (const page of bundle.pages ?? []) out.set(`page:${page.id}`, { node: page, scope: [`pages[${page.id}]`] });
  if (bundle.app) {
    out.set('app', { node: bundle.app, scope: ['app'] });
    for (const panel of bundle.app.meta?.panels ?? []) {
      out.set(`panel:app:${panel.id}`, {
        node: panel.node ?? panel,
        scope: ['app', 'meta', `panels[${panel.id}]`, ...(panel.node ? ['node'] : [])],
      });
    }
  }
  return out;
}

function surfaceFor(surfaces, name) {
  if (name === 'panels') {
    // Every panel the shell declares — tree/inspector/settings mount on all space routes — plus the
    // app chrome, which is mounted everywhere a space route is.
    return [...surfaces.entries()].filter(([k]) => k.startsWith('panel:') || k === 'app').map(([, v]) => v);
  }
  return surfaces.get(name) ? [surfaces.get(name)] : [];
}

function setNested(target, path, value) {
  const parts = path.split('.');
  let at = target;
  for (const part of parts.slice(0, -1)) {
    if (typeof at[part] !== 'object' || at[part] === null) at[part] = {};
    at = at[part];
  }
  at[parts[parts.length - 1]] = value;
}

/** Deterministic JSON: sort object keys recursively, stable row order kept as returned. */
function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canon(value[k])]),
    );
  }
  return value;
}

// ─── Server ───────────────────────────────────────────────────────────────────
async function waitForServer(base, tries = 120) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`preview at ${base} did not come up`);
}

let serverProc;
if (!args.base) {
  serverProc = spawn('pnpm', ['exec', 'vite', '--port', '4317', '--strictPort'], {
    cwd: resolve(repoRoot, 'apps/we-preview'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
  process.on('exit', () => serverProc?.kill());
}
const base = args.base ?? 'http://localhost:4317';
await waitForServer(base);
console.log(`preview up at ${base}`);

// ─── Collect what to read ─────────────────────────────────────────────────────
const bundle = JSON.parse(await readFile(BUNDLE, 'utf8'));
const fixture = JSON.parse(await readFile(FIXTURE, 'utf8'));
const surfaces = surfacesOf(bundle);

const wanted = new Map(); // route id → scan bag
for (const route of ROUTES) {
  if (args.routes && !args.routes.split(',').includes(route.id)) continue;
  const bag = { members: new Map(), invokes: new Set(), queries: new Map(), agents: new Set() };
  for (const name of route.surfaces) {
    for (const surface of surfaceFor(surfaces, name)) scanSurface(surface.node, bag, name, surface.scope);
  }
  wanted.set(route.id, bag);
}

console.log(`routes: ${[...wanted.keys()].join(', ')}`);
for (const [id, bag] of wanted) {
  const descriptors = [...bag.queries.values()].reduce((n, list) => n + list.length, 0);
  console.log(
    `  ${id}: ${bag.members.size} member refs, ${descriptors} query descriptors, ${bag.invokes.size} invoke targets`,
  );
}

/*
 * The registered theme id a screenshot label resolves to — built the way `themeRegistry` is:
 * a theme the bundle owns lands under `<bundleId>--<themeId>` (see `bundlePieceId` and the
 * `themeRef` map in `bundlePieces`); every other label is already a registry id. Asking the
 * store for the bundle-local name (`glow`) misses the lookup and silently falls back — the bug
 * this mapping exists to prevent.
 */
const ownThemeIds = new Set((bundle.themes ?? (bundle.theme ? [bundle.theme] : [])).map((t) => t.id));
const registeredThemeId = (label) => (ownThemeIds.has(label) ? `${bundle.id}--${label}` : label);

// ─── Drive the page ───────────────────────────────────────────────────────────
const fixtureUrl = `/@fs${FIXTURE}`;
const appUrl = `${base}/?fixtureUrl=${encodeURIComponent(fixtureUrl)}&record=1`;

// `WE_RECORD_CHROME` names the binary; without it playwright resolves the installed Google
// Chrome channel — the same default the first recordings used.
const browser = await chromium.launch(
  process.env.WE_RECORD_CHROME ? { executablePath: process.env.WE_RECORD_CHROME } : { channel: 'chrome' },
);

// A cold vite re-bundles discovered dependencies once, mid-boot, reloading the page and dropping
// `window.__weRecord`. Burn that reload on a throwaway page so the recording page starts stable;
// a post-reload boot re-transforms the whole dep graph and can take a while.
{
  const warmup = await browser.newPage();
  await warmup.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await warmup.waitForFunction(() => window.__weRecord !== undefined, { timeout: 60_000 });
  await warmup.waitForTimeout(4000);
  await warmup.close();
}

const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
try {
  await page.waitForFunction(() => window.__wePreview !== undefined, { timeout: 60_000 });
  await page.waitForFunction(() => window.__weRecord !== undefined, { timeout: 90_000 });
} catch (error) {
  console.error(`boot wait failed: ${error instanceof Error ? error.message : error}`);
  console.error(`__wePreview: ${JSON.stringify(await page.evaluate(() => window.__wePreview).catch(() => null))}`);
  for (const p of [...new Set(problems)].slice(0, 30)) console.error(`  ${p.slice(0, 220)}`);
  throw error;
}
const info = await page.evaluate(() => window.__wePreview);
console.log(`fixture '${info.fixture}' template '${info.templateId}' dataset '${info.datasetId}'`);

await mkdir(args.shots ?? SHOTS, { recursive: true });

const snapshot = {
  meta: {
    format: 'we-snapshot@2',
    fixture: info.fixture,
    dataset: info.datasetId,
    /*
      `stores`/`queries`/`invokes` repeat this one route's capture — the landing route — for
      the consumers that only know the flat shape; `null` when a `--routes` subset left the
      landing route out, in which case the flat tables stay empty rather than name a scope
      they do not hold. Per-route truth lives in `routes.<id>`; read it there. `captureTheme`
      is set from the first route's applied theme, asserted equal on every route.
    */
    flatScope: null,
  },
  stores: {},
  queries: {},
  invokes: {},
  routes: {},
};
const notCaptured = new Map(); // member → {reason, routes}
const report = new Map(); // route id → report row

const settle = async (ms = args.wait) => page.waitForTimeout(ms);

// Every bridge call goes through here: a cold vite can reload the page mid-boot (dependency
// re-optimisation), dropping `window.__weRecord` for a beat — wait for it rather than racing it.
const ev = async (fn, arg) => {
  await page.waitForFunction(() => window.__weRecord !== undefined, { timeout: 90_000 });
  return page.evaluate(fn, arg);
};

// Both passes navigate the same way: a route, or a route plus the shell overlay opened over it.
// An open overlay survives navigation (it sits *over* whatever page mounts), so a plain route
// must close one explicitly — otherwise pass 1's `about` leaves `landing-page` covering every
// shot in pass 2.
const navigateTo = async (route) => {
  await ev((p) => window.__weRecord.navigate(p), route.web);
  if (route.overlay) {
    await settle();
    await ev((v) => window.__weRecord.openShellView(v), route.overlay);
    await settle(400);
  } else {
    await ev(() => window.__weRecord.closeShellView());
    await settle();
  }
};

// ─── Pass 1 — capture ─────────────────────────────────────────────────────────
// The theme is never touched here: every route records under the state the app chose, and the
// second pass's theme changes cannot leak into the data. `appliedTheme` is asserted identical
// on every route — drift would mean a capture under a different baseline, the contamination
// this separation exists to remove.
let baselineTheme;
for (const route of ROUTES) {
  const bag = wanted.get(route.id);
  if (!bag) continue;
  const started = Date.now();
  await navigateTo(route);

  const applied = await ev(() => window.__weRecord.appliedTheme());
  baselineTheme ??= applied;
  if (applied.resolved !== baselineTheme.resolved || applied.documentAttr !== applied.expectedAttr) {
    throw new Error(
      `route '${route.id}' under theme ${JSON.stringify(applied)} — the capture baseline is ${JSON.stringify(baselineTheme)}`,
    );
  }

  const params = await ev(() => window.__weRecord.params());
  const currentPath = await ev(() => window.__weRecord.path());

  // Member reads — every store path the mounted surfaces reference. A member read by a chrome
  // surface only (the app template's own chrome) is evaluated at chrome tier; a member any space
  // surface reads is evaluated at space tier, falling back to chrome so the report can say which.
  const members = {};
  const absent = [];
  for (const [member, fromSurfaces] of [...bag.members].sort(([a], [b]) => a.localeCompare(b))) {
    const chromeOnly = [...fromSurfaces].every((s) => s === 'panels');
    const filtered = await ev(
      ([m, chrome]) => (chrome ? window.__weRecord.evaluateChrome(m) : window.__weRecord.evaluate(m)),
      [member, chromeOnly],
    );
    if (filtered.ok) {
      setNested(members, member, filtered.value);
      continue;
    }
    const raw = await ev((m) => window.__weRecord.evaluateRaw(m), member);
    if (raw.ok) {
      absent.push({ member, reason: chromeOnly ? 'filtered-out-at-chrome-tier' : 'filtered-out-at-space-tier' });
      continue;
    }
    if (raw.reason === 'undefined') {
      // The member evaluated to nothing — what the template itself sees. Recorded, not a failure.
      absent.push({ member, reason: 'undefined' });
      continue;
    }
    absent.push({ member, reason: raw.reason });
    const seen = notCaptured.get(member) ?? { reason: raw.reason, routes: [] };
    seen.routes.push(route.id);
    notCaptured.set(member, seen);
  }

  /*
    Queries — every descriptor the surfaces declare, resolved the way `runQuery` resolves it now.

    A capture's identity is its declaration plus what the bridge resolved: `scope` — the
    canonical path of the `$queries` node in the bundle — the `dataset` the query ran
    against, and the resolved `request`. Not the local name: the tree's `signalTypes` sorts
    by name and the inspector's does not, and those are different answers to different
    questions. One capture per declaration per route — a same-named query under another
    declaration (`scope`), or against another dataset, is asked and recorded separately and
    never reuses these rows. `surfaces` says which of the route's scanned surfaces declare
    it — the static scan reaches a declaration both through its own surface and through the
    recursive `root` walk.

    A descriptor the renderer would not run — `when` false, unanchored scope — is recorded
    as `skipped`, never as an answered empty list; a real empty answer keeps `rows: []` and
    the two stay distinguishable. Skipped and failed captures keep the authored `descriptor`
    beside whatever of the `request` resolved, so the capture names the question even when
    there is no answer to bind.
  */
  const declared = new Map(); // `${scope}\n${name}` — one declaration → { descriptor, scope, name, surfaces }
  for (const [name, entries] of bag.queries) {
    for (const { descriptor, surface, scope } of entries) {
      const key = `${scope}\n${name}`;
      const entry = declared.get(key) ?? { descriptor, scope, name, surfaces: new Set() };
      entry.surfaces.add(surface);
      declared.set(key, entry);
    }
  }
  const queries = [];
  for (const { descriptor, scope, name, surfaces } of [...declared.values()].sort(
    (a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name),
  )) {
    const result = await ev((d) => window.__weRecord.runQuery(d), descriptor);
    const surfacesList = [...surfaces].sort();
    const identity = { name, scope, dataset: result.dataset ?? null };
    if (result.ok && !result.skipped) {
      queries.push({ ...identity, request: result.request, rows: result.rows, surfaces: surfacesList });
      continue;
    }
    if (result.ok) {
      queries.push({
        ...identity,
        skipped: result.skipped,
        ...(result.request !== undefined ? { request: result.request } : {}),
        descriptor,
        surfaces: surfacesList,
      });
      continue;
    }
    queries.push({
      ...identity,
      failed: result.reason,
      ...(result.request !== undefined ? { request: result.request } : {}),
      descriptor,
      surfaces: surfacesList,
    });
    const seen = notCaptured.get(`$queries.${name}`) ?? { reason: result.reason, routes: [] };
    seen.routes.push(route.id);
    notCaptured.set(`$queries.${name}`, seen);
  }
  queries.sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      a.scope.localeCompare(b.scope) ||
      JSON.stringify(canon(a.request ?? a.descriptor ?? null)).localeCompare(
        JSON.stringify(canon(b.request ?? b.descriptor ?? null)),
      ),
  );

  // $agent — the person page's profile load.
  let agent;
  if (route.agentDid) {
    const result = await ev((d) => window.__weRecord.agentProfile(d), route.agentDid);
    if (result.ok) agent = result.value;
    else notCaptured.set(`$agent:${route.agentDid}`, { reason: result.reason, routes: [route.id] });
  }

  snapshot.routes[route.id] = canon({
    web: route.web,
    rust: route.rust,
    ...(route.overlay ? { overlay: route.overlay } : {}),
    path: currentPath,
    params,
    theme: applied.resolved,
    members,
    queries,
    ...(agent ? { agents: { [route.agentDid]: agent } } : {}),
    ...(absent.length ? { absent } : {}),
    invokeTargets: [...bag.invokes].sort(),
  });

  report.set(route.id, {
    route: route.id,
    membersRead: bag.members.size - absent.length,
    absent: absent.length,
    queries: queries
      .map((c) => `${c.name}(${c.rows === undefined ? (c.skipped ?? `failed:${c.failed}`) : c.rows.length})`)
      .join(', '),
    ms: Date.now() - started,
  });
  console.log(`  ${route.id}: captured in ${report.get(route.id).ms}ms`);
}

/*
  The flat tables are a lossy projection of the landing route's capture alone — nothing merged
  across routes, no placeholders for questions a route never asked: `queries` keeps only the
  first answered request per name (a `{name: rows}` table cannot hold two answers honestly —
  part of why the real data lives in `routes`), `invokes` only the targets that one route
  declares. They exist for consumers that only know `{stores, queries, invokes}`;
  `meta.flatScope` says which route they repeat — `null` when a `--routes` subset left it
  out, and then the tables stay empty rather than claim a scope they do not hold.
*/
const landing = snapshot.routes.index;
snapshot.meta.flatScope = landing ? 'index' : null;
if (landing) {
  snapshot.stores = canon(landing.members);
  const flatQueries = {};
  for (const capture of landing.queries) {
    // First answered request per name wins — the projection cannot hold more than that.
    if (capture.rows === undefined || capture.name in flatQueries) continue;
    flatQueries[capture.name] = capture.rows;
  }
  snapshot.queries = canon(flatQueries);
  snapshot.invokes = canon(Object.fromEntries(landing.invokeTargets.map((t) => [t, null])));
}
snapshot.meta.captureTheme = baselineTheme?.resolved ?? null;

/*
  The contract a reader binds on: every capture — answered, skipped or failed — names its
  declaration (`scope`), the resolved `dataset`, and the question it answered or would have
  asked (`request`, or the authored `descriptor` where resolution could not finish). Checked
  before photography and writing, so a capture a consumer cannot bind fails the run rather
  than the snapshot.
*/
for (const [routeId, routeCapture] of Object.entries(snapshot.routes)) {
  for (const capture of routeCapture.queries ?? []) {
    const at = `routes.${routeId}.queries['${capture.name}']`;
    const states = ['rows', 'skipped', 'failed'].filter((k) => capture[k] !== undefined);
    if (typeof capture.scope !== 'string' || !capture.scope) throw new Error(`${at}: no declaration scope`);
    if (!('dataset' in capture)) throw new Error(`${at}: no resolved dataset`);
    if (states.length !== 1) {
      throw new Error(`${at}: exactly one of rows/skipped/failed — found ${states.join('+') || 'none'}`);
    }
    if (capture.rows !== undefined && capture.request === undefined) {
      throw new Error(`${at}: answered capture has no resolved request`);
    }
    if ((capture.skipped !== undefined || capture.failed !== undefined) && capture.descriptor === undefined) {
      throw new Error(`${at}: ${capture.skipped ?? 'failed'} capture has no authored descriptor`);
    }
    if (!Array.isArray(capture.surfaces)) throw new Error(`${at}: no surfaces`);
  }
}

// ─── Pass 2 — photography ─────────────────────────────────────────────────────
// The data is already recorded; themes may change freely here. After every switch the *applied*
// theme is checked against the registered id asked for — the store falls back rather than
// failing, and a PNG of the wrong theme is worse than none. The capture theme goes back on
// after each route's loop, so photography leaves the page the way capture found it.
const shotsDir = args.shots ?? SHOTS;
for (const route of ROUTES) {
  if (!wanted.has(route.id)) continue;
  await navigateTo(route);

  for (const label of THEMES) {
    const id = registeredThemeId(label);
    const wrote = await ev((t) => window.__weRecord.setTheme(t), id);
    if (wrote === false) throw new Error(`setTheme('${id}') — the settings write failed`);
    // Resolution is async — the theme record may still be arriving. Wait until what is applied
    // is what was asked, then read it back; the check below reports the state actually reached.
    await page
      .waitForFunction(
        (want) => {
          const a = window.__weRecord?.appliedTheme?.();
          return Boolean(a && a.resolved === want && a.documentAttr === a.expectedAttr);
        },
        id,
        { timeout: 15_000 },
      )
      .catch(() => {});
    const applied = await ev(() => window.__weRecord.appliedTheme());
    if (
      applied.resolved !== id ||
      applied.documentAttr !== applied.expectedAttr ||
      (applied.scopeAttr !== null && applied.scopeAttr !== applied.expectedAttr)
    ) {
      throw new Error(`theme '${label}' (${id}) did not apply: ${JSON.stringify(applied)}`);
    }
    await settle(350); // let the cross-fade finish before the exposure
    await page.screenshot({ path: resolve(shotsDir, `${route.id}-${label}.png`) });
  }
  if (route.overlay) await ev((v) => window.__weRecord.closeShellView(v), route.overlay);
  if (baselineTheme) {
    const restored = await ev((t) => window.__weRecord.setTheme(t), baselineTheme.resolved);
    if (restored === false) throw new Error(`restoring theme '${baselineTheme.resolved}' failed`);
  }
  console.log(`  ${route.id}: ${THEMES.length} shots`);
}

await writeFile(args.out ?? OUT, JSON.stringify(snapshot, null, 1) + '\n');
const hash = createHash('sha256')
  .update(await readFile(args.out ?? OUT))
  .digest('hex');

console.log(`\nsnapshot → ${args.out ?? OUT}`);
console.log(`sha256 ${hash}`);
console.log(`shots   → ${args.shots ?? SHOTS}`);
if (notCaptured.size) {
  console.log(`\nnot captured (${notCaptured.size}):`);
  for (const [member, { reason, routes }] of [...notCaptured].sort()) {
    console.log(`  ${member}  [${reason}]  on ${[...new Set(routes)].join(',')}`);
  }
}
if (problems.length) {
  console.log('\npage problems:');
  for (const p of [...new Set(problems)].slice(0, 20)) console.log(`  ${p.slice(0, 180)}`);
}

// The captured state is already on disk; do not let a wedged browser or vite hold the process.
await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 5000))]).catch(() => {});
serverProc?.kill('SIGKILL');
process.exit(0);
