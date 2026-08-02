import type { BackendConnector } from '@shared/backend/types';
import { initializeIntegrations } from '@shared/initializeIntegrations';
import { PlatformAdapter } from '@shared/platform/types';
import { createModuleStoreDeps } from '@shared/registries/moduleHostServices';
import { createContext, createEffect, createSignal, ParentComponent, useContext } from 'solid-js';

import { componentRegistry } from '../registries/componentRegistry';

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
export const PlatformProvider: ParentComponent<{ platform: PlatformAdapter; backend: BackendConnector }> = (props) => {
  // Initialize integrations with platform adapter BEFORE rendering children
  // This must run synchronously so the launcher template is ready when TemplateStoreProvider reads the registry
  // Components are handed over here, where the framework is known — `initializeIntegrations` itself
  // stays framework-neutral.
  initializeIntegrations(props.platform, {
    components: { CesiumGlobe: componentRegistry.CesiumGlobe },
    // Reactivity lent to module stores. Solid's primitives already have the shapes the port asks
    // for, so a module store gets reactivity without importing a framework. The remaining deps
    // (transport, presence, the current dataset) are bound late — the stores that own them mount
    // below this provider. See moduleHostServices.ts.
    storeDeps: createModuleStoreDeps({
      signal: <T,>(initial: T) => createSignal(initial) as [() => T, (next: T) => void],
      effect: (fn) => createEffect(fn),
    }),
  });

  return (
    <PlatformContext.Provider value={props.platform}>
      <BackendContext.Provider value={props.backend}>{props.children}</BackendContext.Provider>
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
