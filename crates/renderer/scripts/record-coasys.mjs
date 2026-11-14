#!/usr/bin/env node
/**
 * Record the Coasys space from the real web renderer.
 *
 * Boots `apps/we-preview` (the whole WE app over `@we/backend-inmemory`) with the Coasys bundle and
 * `crates/renderer/fixtures/coasys/fixture.json`, under `?record=1` — the flag that mounts the
 * recorder bridge (`apps/we-preview/src/RecorderBridge.tsx`) and the connector's members/workflows
 * seeding. For each route the script then:
 *
 * - navigates the page there,
 * - evaluates every store-member path the bundle's mounted surfaces reference, through the space-tier
 *   filtered bag (and again unfiltered, to tell "absent by the tier" from "undefined"),
 * - resolves every `$queries` descriptor through the same path the renderer uses
 *   (`resolveProp`/`deepUnwrap` → `pruneUnresolvedWhere`/`scopeIsAnchored` → `routeQuery` on the
 *   backend's own adapter → `Model.findAll`), and
 * - photographs the route under each of the six themes at 1280×800.
 *
 * Output:
 * - `fixtures/coasys/snapshot.json` — `{ stores, queries, invokes, routes }` in the shape
 *   `we-app/tests/data/tree-snapshot.json` established, extended with `routes` (per-route params,
 *   member values, query rows and diagnostics) — see `fixtures/coasys/README.md`.
 * - `target/coasys-web/<route>-<theme>.png` — one per route × theme.
 *
 * Usage:
 *   node record-coasys.mjs [--base <url>] [--wait <ms>]
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

const require = createRequire('/home/data/.nvm/versions/node/v24.20.0/lib/node_modules/openclaw/package.json');
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
    else if (flag === '--routes') args.routes = consume(); // comma list of route ids
  }
  return args;
}
const args = parseArgs(process.argv.slice(2));

const THEMES = ['light', 'dark', 'black', 'retro', 'glow', 'cyberpunk'];

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
 * Walk one schema surface collecting everything the capture needs:
 * `{ $ }` expression strings (member paths), `$invoke` targets, `$queries` maps and `$agent` uses.
 */
function scanSurface(node, bag, surface) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const item of node) scanSurface(item, bag, surface);
    return;
  }
  if (typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key === '$queries' && value && typeof value === 'object') {
      for (const [name, descriptor] of Object.entries(value)) bag.queries.set(name, descriptor);
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
    scanSurface(value, bag, surface);
  }
}

/** The bundle's surfaces keyed the way the route table names them. */
function surfacesOf(bundle) {
  const out = new Map();
  const space = bundle.templates?.find((t) => (t.meta?.role ?? 'shell') !== 'view') ?? bundle.templates?.[0];
  // The template object IS the root schema node ({type, props, children} at top level).
  out.set('root', space);
  for (const panel of space?.meta?.panels ?? []) out.set(`panel:${panel.id}`, panel.node ?? panel);
  for (const route of space?.routes ?? []) out.set(`route:${route.path}`, route);
  for (const [key, view] of Object.entries(space?.meta?.recordViews ?? {})) out.set(`recordView:${key}`, view);
  for (const page of bundle.pages ?? []) out.set(`page:${page.id}`, page);
  if (bundle.app) {
    out.set('app', bundle.app);
    for (const panel of bundle.app.meta?.panels ?? []) out.set(`panel:app:${panel.id}`, panel.node ?? panel);
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
    for (const surface of surfaceFor(surfaces, name)) scanSurface(surface, bag, name);
  }
  wanted.set(route.id, bag);
}

console.log(`routes: ${[...wanted.keys()].join(', ')}`);
for (const [id, bag] of wanted) {
  console.log(
    `  ${id}: ${bag.members.size} member refs, ${bag.queries.size} queries, ${bag.invokes.size} invoke targets`,
  );
}

// ─── Drive the page ───────────────────────────────────────────────────────────
const fixtureUrl = `/@fs${FIXTURE}`;
const appUrl = `${base}/?fixtureUrl=${encodeURIComponent(fixtureUrl)}&record=1`;
const browser = await chromium.launch({ channel: 'chrome' });

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

const snapshot = { stores: {}, queries: {}, invokes: {}, routes: {} };
const notCaptured = new Map(); // member → {reason, routes}
const queriesFromSkip = new Set(); // snapshot query names whose table came from a skipped run
const report = new Map(); // route id → report row

const settle = async (ms = args.wait) => page.waitForTimeout(ms);

// Every bridge call goes through here: a cold vite can reload the page mid-boot (dependency
// re-optimisation), dropping `window.__weRecord` for a beat — wait for it rather than racing it.
const ev = async (fn, arg) => {
  await page.waitForFunction(() => window.__weRecord !== undefined, { timeout: 90_000 });
  return page.evaluate(fn, arg);
};

for (const route of ROUTES) {
  const bag = wanted.get(route.id);
  if (!bag) continue;
  const started = Date.now();

  if (route.overlay) {
    // An overlay opens over whatever page is mounted — here, the feed.
    await ev((p) => window.__weRecord.navigate(p), route.web);
    await settle();
    await ev((v) => window.__weRecord.openShellView(v), route.overlay);
    await settle(400);
  } else {
    await ev((p) => window.__weRecord.navigate(p), route.web);
    await settle();
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

  // Queries — each descriptor run the way the renderer would run it now. A skipped descriptor
  // (`when` false / unanchored scope) writes an empty table but stays replaceable: a later route
  // where the descriptor actually runs overwrites it.
  const queries = {};
  const skippedHere = new Set();
  const queryNotes = [];
  for (const [name, descriptor] of [...bag.queries].sort(([a], [b]) => a.localeCompare(b))) {
    const result = await ev((d) => window.__weRecord.runQuery(d), descriptor);
    if (result.ok && !result.skipped) {
      queries[name] = result.rows;
    } else if (result.ok && result.skipped) {
      queries[name] = [];
      skippedHere.add(name);
      queryNotes.push({ name, note: `skipped:${result.skipped}` });
    } else {
      queryNotes.push({ name, note: `failed:${result.reason}` });
      notCaptured.set(`$queries.${name}`, { reason: result.reason, routes: [route.id] });
    }
  }

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
    members,
    queries,
    ...(queryNotes.length ? { queryNotes } : {}),
    ...(agent ? { agents: { [route.agentDid]: agent } } : {}),
    ...(absent.length ? { absent } : {}),
    invokeTargets: [...bag.invokes].sort(),
  });

  // Merge into the flat tables — first route wins on conflict (the feed is the honest default).
  // `routeStore` is route state, though: the flat table must be *one* route's truth — the landing
  // route's — not a union of every page's params. Per-route values live in `routes.<id>`.
  for (const member of [...bag.members.keys()].sort()) {
    if (member.startsWith('routeStore.') && route.id !== ROUTES[0].id) continue;
    const value = member.split('.').reduce((o, k) => o?.[k], members);
    if (value === undefined) continue;
    if (member.split('.').reduce((o, k) => o?.[k], snapshot.stores) === undefined)
      setNested(snapshot.stores, member, value);
  }
  for (const [name, rows] of Object.entries(queries)) {
    if (!(name in snapshot.queries)) {
      snapshot.queries[name] = rows;
      if (skippedHere.has(name)) queriesFromSkip.add(name);
    } else if (queriesFromSkip.has(name) && !skippedHere.has(name)) {
      snapshot.queries[name] = rows; // a real execution replaces the skipped placeholder
      queriesFromSkip.delete(name);
    }
  }

  report.set(route.id, {
    route: route.id,
    membersRead: bag.members.size - absent.length,
    absent: absent.length,
    queries: Object.entries(queries)
      .map(([n, r]) => `${n}(${Array.isArray(r) ? r.length : '?'})`)
      .join(', '),
    ms: Date.now() - started,
  });

  // The screenshots — every theme, same page state.
  for (const theme of THEMES) {
    await ev((t) => window.__weRecord.setTheme(t), theme);
    await settle(350);
    const path = resolve(args.shots ?? SHOTS, `${route.id}-${theme}.png`);
    await page.screenshot({ path });
  }
  if (route.overlay) await ev((v) => window.__weRecord.closeShellView(v), route.overlay);
  console.log(`  ${route.id}: captured in ${report.get(route.id).ms}ms, ${THEMES.length} shots`);
}

snapshot.stores = canon(snapshot.stores);
snapshot.queries = canon(snapshot.queries);
snapshot.invokes = canon(
  Object.fromEntries([...new Set([...wanted.values()].flatMap((b) => [...b.invokes]))].sort().map((t) => [t, null])),
);

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
