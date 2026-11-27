/**
 * BootController — the Solid app's composition root.
 *
 * The stores are composed by `composeStores` (`shared/composeStores.ts`), which every host shares;
 * this passes it Solid's reactivity port, the platform and backend the app supplied, and the app's
 * one copy of each piece of host state, then provides the registry components reach through
 * `useStore(key)`. A host on another framework calls the same composition and writes its own hook
 * over the result.
 */
import { composeStores } from '@shared/composeStores';
import { toastService } from '@we/components/solid';
import { solidReactivity } from '@we/reactivity-solid';
import type { ParentProps } from 'solid-js';

import { credential } from '../credential';
import { firstScreen } from '../firstScreen';
import { startAppBridge } from '../services/appBridge';
import { shellHost, spaceHost } from '../stores/hostState';
import { solidLiveTemplates } from '../stores/liveTemplate';
import { StoreRegistryContext } from '../stores/useStore';
import { EditorHostAdapter } from './EditorHostAdapter';
import { useBackend, usePlatform } from './PlatformProvider';

export function BootController(props: ParentProps) {
  const platform = usePlatform();
  const stores = composeStores({
    reactivity: solidReactivity,
    platform,
    backend: useBackend(),
    toasts: toastService,
    firstScreen,
    credential,
    liveTemplates: solidLiveTemplates,
    shellHost,
    spaceHost,
  });

  /*
    The bridge that hands embedded apps (e.g. Flux) their credentials, started synchronously and
    before any async boot work, so a REQUEST_AD4M_CONFIG is never dropped — including during the
    connector's auth flow on first load, where auth can take many seconds and the embedded app's
    30-second timeout would otherwise expire. Composing the stores runs nothing asynchronous before
    it returns, and nothing embedded has mounted yet, so starting it here is still before any request.
    The session is usable once the post-unlock load finishes, which is 'finishing' on a first run and
    'ready' on every other boot.
  */
  const { sessionStore } = stores;
  startAppBridge({
    isDesktop: platform.isDesktop,
    port: sessionStore.port,
    token: sessionStore.token,
    serverUrl: sessionStore.serverUrl,
    agentUnlocked: () => sessionStore.bootState() === 'ready' || sessionStore.bootState() === 'finishing',
  });

  return (
    <StoreRegistryContext.Provider value={stores}>
      {/* The editor's host port is built from every store above, so it sits inside the registry.
          It provides only a context, so a deployment that ships no editing surface pays a context
          and nothing else. */}
      <EditorHostAdapter>{props.children}</EditorHostAdapter>
    </StoreRegistryContext.Provider>
  );
}
