/**
 * Whether the build this tab is running is still the one the server is serving.
 *
 * ## The failure this exists for
 *
 * WE is loaded once and left open. Its panel bodies, its editor and its heavier viewers are behind
 * `lazy(() => import(...))`, so their code is fetched the first time somebody opens them — which can
 * be hours after the page booted, and by then the site may have been deployed over twice. A hashed
 * chunk from the build a tab is running does not exist in the build the server now publishes, so the
 * import 404s and the panel shows `Failed to fetch dynamically imported module: …TemplatePanelBody-Cb6Ya6b5.js`,
 * which is what somebody reported and is not a sentence anybody can act on.
 *
 * Worse, on Netlify it does not 404 at all. The SPA rule in `apps/we-web/public/_redirects` catches
 * the miss and answers `200 text/html` with `index.html`, so the browser rejects a *document* where
 * it wanted a module, nothing appears in the host's 404 log, and no retry can ever succeed because
 * the URL keeps answering. (That rule is now scoped so `/assets/*` 404s honestly — but a tab loaded
 * before that change still meets the old behaviour, and any other static host may do the same.)
 *
 * ## What "the build" is, without a build step
 *
 * The entry module's hashed filename. Vite rewrites `index.html` on every build to point at
 * `/assets/index-<hash>.js`, so the served document already carries a fingerprint of the whole
 * asset graph — no injected version constant, no extra file to deploy, and nothing to keep in sync.
 * Comparing this tab's entry against the one the server hands out now answers exactly the question
 * that matters: *are my chunk URLs still real?*
 *
 * It self-limits where it should. In dev the entry is `/src/index.tsx`, a name that never changes,
 * so this reports "same build" forever and stays quiet. Under `file://` (packaged Electron) there is
 * nothing to fetch and assets ship with the app, so the watcher does not start.
 */

/** The module script a built `index.html` boots from. Vite emits exactly one. */
const ENTRY_SELECTOR = 'script[type="module"][src]';

/**
 * Where to ask what the current build is.
 *
 * The site root rather than the current URL: a deep link (`/join/<id>?host=…`) only answers with
 * `index.html` by way of the SPA fallback, and this should not depend on the same rule whose
 * over-reach it exists to survive. WE is published at the domain root — if it is ever served from a
 * sub-path, this becomes the host's `BASE_URL` and is passed in.
 */
const INDEX_PATH = '/';

/**
 * Which build we already reloaded away from, so a tab reloads at most once per build.
 *
 * `sessionStorage`, not `localStorage`: the guard is about this tab's module graph, and a second tab
 * on an older build has its own reload to do. It is cleared by the reload only in the sense that the
 * value is then a *past* build — the new page writes nothing, and its own id will not match.
 */
const RELOADED_FROM = 'we.reloaded-from-build';

export interface BuildFreshnessDeps {
  doc?: Document;
  fetch?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  reload?: () => void;
  indexPath?: string;
}

/** A session store that is allowed not to be there — private windows and blocked site data throw. */
function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** The build a document was served as, or `null` if it has no module entry (a test page, a shell). */
export function buildIdIn(doc: Document): string | null {
  return doc.querySelector(ENTRY_SELECTOR)?.getAttribute('src') ?? null;
}

/**
 * The build the server is serving now, or `null` if it could not be established.
 *
 * `DOMParser` rather than a regex over the HTML: it reads the served document with the same selector
 * used on our own, so the two answers are comparable by construction. Parsing does not run scripts
 * or fetch subresources — it builds an inert document.
 */
export async function deployedBuildId(deps: BuildFreshnessDeps = {}): Promise<string | null> {
  const get = deps.fetch ?? fetch;
  // `no-store` because the whole question is what the origin has, and a tab that has been open for a
  // day is exactly the tab with a cached copy of the answer.
  const response = await get(deps.indexPath ?? INDEX_PATH, { cache: 'no-store', headers: { accept: 'text/html' } });
  if (!response.ok) return null;
  return buildIdIn(new DOMParser().parseFromString(await response.text(), 'text/html'));
}

/**
 * The deployed build id when it differs from this tab's, `null` otherwise — including when the
 * question cannot be answered.
 *
 * Failing quiet is deliberate: offline, a flaky connection and a host hiccup all land here, and none
 * of them is evidence that this tab is stale. The caller's job is to act on a *confirmed* new build,
 * so the honest answer to "I could not tell" is the same as "nothing has changed".
 */
export async function newerBuild(deps: BuildFreshnessDeps = {}): Promise<string | null> {
  const mine = buildIdIn(deps.doc ?? document);
  if (!mine) return null;

  try {
    const live = await deployedBuildId(deps);
    return live && live !== mine ? live : null;
  } catch {
    return null;
  }
}

/**
 * Reload when a lazy chunk is missing *because the build moved on* — and only then.
 *
 * Vite's preload helper dispatches `vite:preloadError` and, if nothing calls `preventDefault`,
 * rethrows. Nothing here does: the error still reaches `TemplateBoundary`, so a failure this cannot
 * fix stays visible instead of being swallowed by a handler that decided not to act.
 *
 * Reloading is only right for one of the two things that raise this event. A chunk that is *gone*
 * cannot be recovered in this page — the code that would render the panel does not exist any more,
 * and every retry fetches the same absence. A chunk that merely failed to arrive — a dropped
 * connection, a proxy, a tunnel between the laptop and the CDN — is still there, and reloading
 * throws away everything the person had on screen to discover that it is still there. So this asks
 * the server which case it is, and acts only on the first.
 *
 * Two guards against a loop. Once per build: if a reload did not fix it, the second attempt will not
 * either, and a page that reloads itself forever is worse than the error it was hiding. And once at
 * a time: opening a lane raises this event per lazy panel in it, which is several questions to the
 * server and several calls to `reload()` for one cause.
 */
export function installStaleBuildReload(deps: BuildFreshnessDeps = {}): () => void {
  const storage = deps.storage ?? safeStorage();
  const reload = deps.reload ?? (() => window.location.reload());
  let asking = false;

  const onPreloadError = (event: Event) => {
    void (async () => {
      if (asking) return;
      const mine = buildIdIn(deps.doc ?? document);
      if (!mine) return;

      try {
        if (storage?.getItem(RELOADED_FROM) === mine) return;
      } catch {
        // A storage that throws on read is a storage we cannot use as a guard, and without the guard
        // a reload could loop. Leave the error to the boundary.
        return;
      }

      asking = true;
      try {
        if (!(await newerBuild(deps))) return;
        console.warn('[we] a lazy chunk is missing and the site has been deployed since this tab loaded — reloading', {
          build: mine,
          error: (event as Event & { payload?: unknown }).payload,
        });
        try {
          storage?.setItem(RELOADED_FROM, mine);
        } catch {
          // Nothing to do, and nothing worth failing the reload over: the reload is still the right
          // move, it just gets to happen once more if the same build breaks again.
        }
        reload();
      } finally {
        asking = false;
      }
    })();
  };

  window.addEventListener('vite:preloadError', onPreloadError);
  return () => window.removeEventListener('vite:preloadError', onPreloadError);
}

export interface NewBuildWatchOptions extends BuildFreshnessDeps {
  /** How often to ask, while the tab is visible. */
  intervalMs?: number;
  /** The shortest gap between two questions, whatever prompts them. */
  minGapMs?: number;
}

/**
 * Notice a deploy before somebody trips over it, and say so once.
 *
 * The point is to move the discovery off the panel that breaks. Left alone, the first thing a person
 * learns about a deploy is an error message inside a surface they just opened; with this, they are
 * told plainly, while everything still works, and choose when to take the reload — which matters
 * because they may be mid-sentence in something unsaved.
 *
 * Checks on a timer and whenever the tab comes back to the front, which is when a long-idle tab is
 * most likely to be behind and least likely to be in the middle of something. Both go through the
 * same minimum gap, so a person flicking between tabs does not turn this into a poll.
 *
 * Fires at most once: the answer does not change with repetition, and a message that cannot be got
 * rid of is a message people learn to ignore.
 */
export function watchForNewBuild(
  onNewBuild: (buildId: string) => void,
  options: NewBuildWatchOptions = {},
): () => void {
  const doc = options.doc ?? document;
  const intervalMs = options.intervalMs ?? 15 * 60 * 1000;
  const minGapMs = options.minGapMs ?? 60 * 1000;

  // Nothing to compare (dev, or a host that mounts us into a page it built itself) and nothing to
  // fetch from (`file://`, where the assets are on disk and cannot go stale under the app).
  if (!buildIdIn(doc) || !location.protocol.startsWith('http')) return () => {};

  // Starts at boot rather than at zero: the page has just been served, so it is current by
  // construction and the first useful moment to ask is a gap from now.
  let lastAsked = Date.now();
  let stopped = false;

  const check = async () => {
    if (stopped || Date.now() - lastAsked < minGapMs) return;
    lastAsked = Date.now();

    const build = await newerBuild(options);
    if (!build || stopped) return;

    stop();
    onNewBuild(build);
  };

  const onVisible = () => {
    if (doc.visibilityState === 'visible') void check();
  };

  const timer = setInterval(() => void check(), intervalMs);
  doc.addEventListener('visibilitychange', onVisible);

  function stop() {
    stopped = true;
    clearInterval(timer);
    doc.removeEventListener('visibilitychange', onVisible);
  }

  return stop;
}
