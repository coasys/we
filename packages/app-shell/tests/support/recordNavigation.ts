/**
 * Records navigation vectors: runs a scripted sequence of route operations against a mounted
 * RouteStore over a real jsdom `window.history`, and reports what the address bar, the page
 * identity and the history stack looked like after every step.
 *
 * Lives in app-shell — not in the conformance package — because it needs jsdom, the browser build
 * of solid-js and the store's own provider. `@we/template-conformance` calls `runNavigationScript`
 * from its `solid` vitest project; nothing here is reachable from the plain node project.
 *
 * The router itself is mocked: `routeStore.navigate` hands its target to whatever function was
 * lent through `setNavigateFunction`, so the script's own mirror applies it to `window.history`
 * the way @solidjs/router would (push unless `replace`), then reports the location back through
 * `setCurrentPath` — the same call TemplateLayout's router effect makes.
 */
import { render } from '@solidjs/testing-library';
import { createComponent } from 'solid-js';

import RouteStoreProvider, { type RouteStore, useRouteStore } from '../../src/frameworks/solid/stores/RouteStore';

/** One step of a navigation script. `args` are decoded JSON — see the ops below. */
export interface NavigationStep {
  op: string;
  args?: Record<string, unknown>;
}

/** The state worth asserting after one step. */
export interface NavigationExpect {
  /** `pathname + search + hash` — the address bar as a user would copy it. */
  href: string;
  /** `routeStore.page()` — path plus `?id=`, the identity presence and queries key on. */
  pageIdentity: string;
  /** Entries in the script's own history stack, 1-based from the script's `start`. */
  depth: number;
  /** Position in that stack, 0-based — where Back would leave from. */
  index: number;
  /** For `local_read`: the initial value the field's precedence rules resolve. */
  resolved?: unknown;
}

export interface NavigationScript {
  id: string;
  /** The URL the script's history stack opens on. */
  start: string;
  steps: NavigationStep[];
}

const href = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

/** Wait one popstate: jsdom dispatches it on a task, not synchronously. */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('popstate', finish);
      resolve();
    };
    window.addEventListener('popstate', finish);
    // No event ever arrives for a traversal that hit the stack's end — do not hang on it.
    setTimeout(finish, 0);
    setTimeout(finish, 10);
  });
}

/**
 * Run `script` against a freshly mounted store and return the expected state after each step.
 *
 * `depth`/`index` are kept as the script's own stack rather than `history.length` because jsdom's
 * session history is shared across every script in a run — a `back()` past the script's first
 * entry would land inside the previous script's, which the vector must not depend on.
 */
export async function runNavigationScript(script: NavigationScript): Promise<NavigationExpect[]> {
  window.localStorage.clear();
  window.history.replaceState(null, '', script.start);

  // The script's own history stack mirror (see above). `window.history` stays authoritative for
  // the address itself — the store reads `window.location` directly.
  let entries = [href()];
  let index = 0;
  const pushState = window.history.pushState.bind(window.history);
  const replaceState = window.history.replaceState.bind(window.history);
  window.history.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
    pushState(data, unused, url);
    entries = entries.slice(0, index + 1);
    entries.push(href());
    index++;
  };
  window.history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
    replaceState(data, unused, url);
    entries[index] = href();
  };
  const onPopState = () => {
    const here = href();
    if (index > 0 && entries[index - 1] === here) index--;
    else if (index < entries.length - 1 && entries[index + 1] === here) index++;
    else {
      const at = entries.lastIndexOf(here);
      if (at >= 0) index = at;
    }
  };
  window.addEventListener('popstate', onPopState);

  let store!: RouteStore;
  const issued: { to: string; options?: Record<string, unknown> }[] = [];
  // Render mounts once and is left to the test environment's cleanup — same convention as the
  // app-shell suite (each script's store is a fresh mount whose signals stay private).
  render(() =>
    createComponent(RouteStoreProvider, {
      get children() {
        return createComponent(function Grab() {
          store = useRouteStore();
          return null;
        }, {});
      },
    }),
  );
  store.setNavigateFunction(((to: string | number, options?: Record<string, unknown>) => {
    issued.push({ to: String(to), options });
  }) as Parameters<RouteStore['setNavigateFunction']>[0]);
  // The store opened on `start`: report the location as the router would after first paint.
  store.setCurrentPath(window.location.pathname, window.location.search);

  /** Apply what the route store asked the router for, as the real router would. */
  const applyRouter = () => {
    while (issued.length) {
      const call = issued.shift()!;
      const url = new URL(call.to, window.location.href);
      const target = `${url.pathname}${url.search}${url.hash}`;
      if (call.options?.replace) window.history.replaceState(null, '', target);
      else window.history.pushState(null, '', target);
      store.setCurrentPath(url.pathname, url.search);
    }
  };

  const expect: NavigationExpect[] = [];
  try {
    for (const step of script.steps) {
      const args = step.args ?? {};
      let resolved: unknown;
      switch (step.op) {
        case 'open': {
          // A cold load or an address-bar jump: replace the current entry, no stack growth.
          window.history.replaceState(null, '', args.href as string);
          store.setCurrentPath(window.location.pathname, window.location.search);
          break;
        }
        case 'navigate':
          store.navigate(args.to as string, args.options as Record<string, unknown> | undefined);
          applyRouter();
          break;
        case 'set_param':
          store.setParam(args.name as string, args.value as string | null, {
            push: args.push === true,
          });
          break;
        case 'sync_param': {
          // The $localState write path: strings raw, everything else JSON, and a value back at the
          // declared initial clears the param instead of writing it.
          if (typeof args.persist === 'string') {
            try {
              window.localStorage.setItem(`we-local:${args.persist}`, JSON.stringify(args.value));
            } catch {
              /* quota — the in-memory value still applies */
            }
          }
          const text =
            JSON.stringify(args.value) === JSON.stringify(args.initial)
              ? null
              : args.type === 'string'
                ? String(args.value)
                : JSON.stringify(args.value);
          store.setParam(args.name as string, text ?? null, { push: args.push === true });
          break;
        }
        case 'local_read': {
          // The mount-time precedence: URL param > persisted value > declared initial.
          const type = args.type === 'string' ? 'string' : 'json';
          const decode = (raw: string) => {
            if (type === 'string') return raw;
            try {
              return JSON.parse(raw);
            } catch {
              return raw;
            }
          };
          const fromUrl = store.params()[args.name as string];
          const persistedRaw =
            typeof args.persist === 'string' ? window.localStorage.getItem(`we-local:${args.persist}`) : null;
          let persisted: unknown;
          if (persistedRaw !== null) {
            try {
              persisted = JSON.parse(persistedRaw);
            } catch {
              persisted = undefined;
            }
          }
          resolved = fromUrl !== undefined ? decode(fromUrl) : persisted !== undefined ? persisted : args.initial;
          break;
        }
        case 'back':
          store.back();
          await settle();
          applyRouter();
          store.setCurrentPath(window.location.pathname, window.location.search);
          break;
        case 'forward':
          window.history.forward();
          await settle();
          applyRouter();
          store.setCurrentPath(window.location.pathname, window.location.search);
          break;
        default:
          throw new Error(`recordNavigation: unknown op "${step.op}" in ${script.id}`);
      }
      applyRouter();
      const entry: NavigationExpect = {
        href: href(),
        pageIdentity: store.page(),
        depth: entries.length,
        index,
      };
      if (resolved !== undefined) entry.resolved = resolved;
      expect.push(entry);
    }
  } finally {
    window.history.pushState = pushState;
    window.history.replaceState = replaceState;
    window.removeEventListener('popstate', onPopState);
    window.localStorage.clear();
  }
  return expect;
}
