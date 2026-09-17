import { installStaleBuildReload, watchForNewBuild } from '@shared/buildFreshness';
import StoreProvider from '@solid/providers/StoreProvider';
import TemplateProvider from '@solid/providers/TemplateProvider';
import { ToastContainer, toastService } from '@we/components/solid';
import { ErrorBoundary, onCleanup, onMount } from 'solid-js';

import { AppFailure } from './components/AppFailure';
import { injectDSInteropStyles } from './dsInterop';

injectDSInteropStyles();

/*
  Before anything mounts, because the chunk it recovers from can be wanted by the first panel the
  shell draws. A listener, not a check — it costs nothing until a lazy import actually fails.
*/
installStaleBuildReload();

/**
 * The outermost boundary — the last resort, and deliberately the plainest thing in the app.
 *
 * Reaching this means the shell itself failed: not a template, which `TemplateBoundary` catches
 * inside the chrome, but the stores or the chrome that would have rendered the recovery. So the
 * fallback uses no store, no theme token that a broken theme could have removed, and no component
 * that could be the thing that broke. It offers a reload, because there is nothing else honest to
 * offer.
 *
 * It lives here rather than in each host's `index.tsx` so all four hosts get it from one place.
 */
export default function App() {
  /*
    Say a deploy happened, rather than letting a panel be the thing that discovers it. The toast does
    not auto-dismiss (`0`) and offers the reload instead of taking it: whoever is looking at this may
    be in the middle of writing something, and a page that reloads itself under them to deliver an
    improvement has made things worse. The forced version of this — `installStaleBuildReload` above —
    is for when the code is already gone and there is nothing left to protect.
  */
  onMount(() => {
    const stop = watchForNewBuild(() =>
      toastService.info('A new version of WE is available.', 0, {
        label: 'Reload',
        run: () => window.location.reload(),
      }),
    );
    onCleanup(stop);
  });

  return (
    <ErrorBoundary fallback={(error) => <AppFailure error={error} />}>
      <StoreProvider>
        <TemplateProvider />
        <ToastContainer />
      </StoreProvider>
    </ErrorBoundary>
  );
}
