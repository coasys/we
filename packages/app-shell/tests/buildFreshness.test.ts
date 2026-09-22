/**
 * Recovering from a build that moved on underneath an open tab.
 *
 * Both behaviours here are ones nobody sees working and everybody sees failing. A reload that fires
 * on an ordinary network blip throws away whatever was on screen to fix nothing; a reload that fires
 * twice for one cause is a page that reloads itself forever. So the tests are mostly about when
 * *not* to act, which is the half that cannot be checked by opening the app.
 */
import { buildIdIn, installStaleBuildReload, newerBuild, watchForNewBuild } from '@shared/buildFreshness';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** A document served by a build — the entry script is the only part that matters. */
const served = (entry: string) =>
  new DOMParser().parseFromString(
    `<!doctype html><html><head><script type="module" src="${entry}"></script></head><body></body></html>`,
    'text/html',
  );

/** A `fetch` that answers with one build's `index.html`, however it is asked. */
const serving = (entry: string) =>
  vi.fn(
    async () =>
      new Response(`<script type="module" src="${entry}"></script>`, { headers: { 'content-type': 'text/html' } }),
  );

/** A session store, without the browser's habit of throwing. */
function memoryStorage() {
  const held = new Map<string, string>();
  return { getItem: (k: string) => held.get(k) ?? null, setItem: (k: string, v: string) => void held.set(k, v) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()?.();
  vi.restoreAllMocks();
});

describe('which build a tab is running', () => {
  it('is the entry module the document was served with', () => {
    expect(buildIdIn(served('/assets/index-WE5LIqBK.js'))).toBe('/assets/index-WE5LIqBK.js');
  });

  it('is nothing at all for a document with no module entry', () => {
    // A page the shell was mounted into rather than one Vite built. Everything downstream treats
    // this as "cannot tell" and stays quiet, which is why it is a null rather than a throw.
    expect(buildIdIn(new DOMParser().parseFromString('<html><body></body></html>', 'text/html'))).toBeNull();
  });
});

describe('noticing a deploy', () => {
  it('says nothing while the server serves the same build', async () => {
    const deps = { doc: served('/assets/index-A.js'), fetch: serving('/assets/index-A.js') };

    expect(await newerBuild(deps)).toBeNull();
  });

  it('names the new build when the entry has changed', async () => {
    const deps = { doc: served('/assets/index-A.js'), fetch: serving('/assets/index-B.js') };

    expect(await newerBuild(deps)).toBe('/assets/index-B.js');
  });

  it('treats a question it could not ask as no news', async () => {
    // Offline, a captive portal, a host hiccup. None of them is evidence that this tab is stale, and
    // acting on them would reload a working page for nothing.
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    expect(await newerBuild({ doc: served('/assets/index-A.js'), fetch: offline })).toBeNull();
  });

  it('treats an error page as no news', async () => {
    const down = vi.fn(async () => new Response('bad gateway', { status: 502 }));

    expect(await newerBuild({ doc: served('/assets/index-A.js'), fetch: down })).toBeNull();
  });
});

describe('a lazy chunk that will not load', () => {
  const preloadError = () => window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));

  it('reloads once when the site has been deployed since this tab loaded', async () => {
    const reload = vi.fn();
    teardown.push(
      installStaleBuildReload({
        doc: served('/assets/index-A.js'),
        fetch: serving('/assets/index-B.js'),
        storage: memoryStorage(),
        reload,
      }),
    );

    preloadError();

    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('leaves a tab alone when the build has not moved', async () => {
    // The other reason this event fires: the chunk is still on the server and the network dropped it.
    // Reloading loses the person's work and finds the same chunk, so the error goes to the boundary.
    const reload = vi.fn();
    teardown.push(
      installStaleBuildReload({
        doc: served('/assets/index-A.js'),
        fetch: serving('/assets/index-A.js'),
        storage: memoryStorage(),
        reload,
      }),
    );

    preloadError();
    await flush();

    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload a second time for the same build', async () => {
    // A reload that did not fix it will not fix it twice, and the loop is worse than the error.
    const reload = vi.fn();
    const storage = memoryStorage();
    storage.setItem('we.reloaded-from-build', '/assets/index-A.js');
    teardown.push(
      installStaleBuildReload({
        doc: served('/assets/index-A.js'),
        fetch: serving('/assets/index-B.js'),
        storage,
        reload,
      }),
    );

    preloadError();
    await flush();

    expect(reload).not.toHaveBeenCalled();
  });

  it('asks once when a whole lane of panels fails together', async () => {
    const reload = vi.fn();
    const fetchIndex = serving('/assets/index-B.js');
    teardown.push(
      installStaleBuildReload({
        doc: served('/assets/index-A.js'),
        fetch: fetchIndex,
        storage: memoryStorage(),
        reload,
      }),
    );

    preloadError();
    preloadError();
    preloadError();

    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(fetchIndex).toHaveBeenCalledTimes(1);
  });
});

describe('watching for a deploy', () => {
  /** The watcher reads its own build from the live document, so the entry has to be in it. */
  function runningBuild(entry: string) {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = entry;
    document.head.appendChild(script);
    teardown.push(() => script.remove());
  }

  it('tells the app once, when the tab comes back to the front', async () => {
    runningBuild('/assets/index-A.js');
    const told = vi.fn();
    teardown.push(
      watchForNewBuild(told, { fetch: serving('/assets/index-B.js'), intervalMs: 60_000_000, minGapMs: 0 }),
    );

    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(told).toHaveBeenCalledWith('/assets/index-B.js'));

    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(told).toHaveBeenCalledTimes(1);
  });

  it('does not ask again inside its minimum gap', async () => {
    runningBuild('/assets/index-A.js');
    const fetchIndex = serving('/assets/index-A.js');
    teardown.push(watchForNewBuild(vi.fn(), { fetch: fetchIndex, intervalMs: 60_000_000, minGapMs: 60_000 }));

    // Somebody flicking between tabs. The clock starts at boot — when the tab is by definition
    // running the current build — so all of these fall inside the gap and none reaches the network.
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();

    expect(fetchIndex).not.toHaveBeenCalled();
  });

  it('stays out of a host that has no build to compare', () => {
    // Dev has an entry that never changes, and a page with none is not something Vite built.
    // `watchForNewBuild` returning a no-op is what keeps this off in both.
    const told = vi.fn();
    const stop = watchForNewBuild(told, { fetch: serving('/assets/index-B.js'), minGapMs: 0 });

    document.dispatchEvent(new Event('visibilitychange'));
    stop();

    expect(told).not.toHaveBeenCalled();
  });
});
