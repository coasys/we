import type { BackendConnector } from '@shared/backend/types';
import { initializeIntegrations } from '@shared/initializeIntegrations';
import { PlatformAdapter } from '@shared/platform/types';
import { createModuleStoreDeps } from '@shared/registries/moduleHostServices';
import { moduleRegistry } from '@shared/registries/moduleRegistry';
import { provideFileSaver } from '@we/design-utils';
import { createContext, createEffect, createSignal, onCleanup, ParentComponent, untrack, useContext } from 'solid-js';

import type { WeSeedFile } from '../../../types/seed';
import { registerModuleComponents } from '../registries/componentRegistry';
import { moduleHostComponents } from '../registries/moduleComponents';

const PlatformContext = createContext<PlatformAdapter>();
const BackendContext = createContext<BackendConnector>();

/**
 * Mounts both host contracts.
 *
 * One provider rather than two nested ones because they are supplied together at exactly one place
 * — the app's entry point — and nesting would add a level to every host for no gain. What matters
 * is that the *contracts* are separate: `usePlatform()` never surfaces a way to reach the data
 * layer, and `useBackend()` never surfaces where the app is running.
 */
export const PlatformProvider: ParentComponent<{
  platform: PlatformAdapter;
  backend: BackendConnector;
  /** The deployment seed. Supplied by the app because a seed *describes* a deployment, and the
   *  apps are the deployments — the shell has no business knowing where one lives on disk. */
  seed: WeSeedFile;
}> = (props) => {
  // The host contracts and the seed are handed over once, at the app's entry point, and never
  // replaced: integrations are initialised from them a single time, so they are read once here.
  const platform = untrack(() => props.platform);
  const backend = untrack(() => props.backend);
  const seed = untrack(() => props.seed);

  // Initialize integrations with platform adapter BEFORE rendering children
  // This must run synchronously so the launcher template is ready when TemplateStoreProvider reads the registry
  // Components are handed over here, where the framework is known — `initializeIntegrations` itself
  // stays framework-neutral.
  initializeIntegrations(platform, seed, {
    // The framework halves of the modules that have one, lent so their packages never import Solid.
    components: moduleHostComponents,
    // Reactivity lent to module stores. Solid's primitives already have the shapes the port asks
    // for, so a module store gets reactivity without importing a framework. The remaining deps
    // (transport, presence, the current dataset) are bound late — the stores that own them mount
    // below this provider. See moduleHostServices.ts.
    storeDeps: createModuleStoreDeps({
      signal: <T,>(initial: T) => createSignal(initial) as [() => T, (next: T) => void],
      effect: (fn) => createEffect(fn),
    }),
    host: { backend: backend.id ?? 'ad4m', framework: 'solid' },
  });
  // What the modules contributed becomes vocabulary a template may name — one list, from the
  // registry, rather than a second hand-kept in the component registry.
  registerModuleComponents(moduleRegistry.components());

  // Every download in the app goes through `saveFile`; a host with its own save dialog lends it here,
  // once, rather than to each of the packages that offer a download.
  if (platform.saveFile) onCleanup(provideFileSaver(platform.saveFile));

  return (
    <PlatformContext.Provider value={platform}>
      <BackendContext.Provider value={backend}>{props.children}</BackendContext.Provider>
    </PlatformContext.Provider>
  );
};

export function usePlatform(): PlatformAdapter {
  const context = useContext(PlatformContext);
  if (!context) {
    throw new Error('usePlatform must be used within PlatformProvider');
  }
  return context;
}

export function useBackend(): BackendConnector {
  const context = useContext(BackendContext);
  if (!context) {
    throw new Error('useBackend must be used within PlatformProvider');
  }
  return context;
}
