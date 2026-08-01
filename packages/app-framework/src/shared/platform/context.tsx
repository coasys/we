import { componentRegistry } from '@solid/registries/componentRegistry';
import { createContext, createSignal, ParentComponent, useContext } from 'solid-js';

import { initializeIntegrations } from '../initializeIntegrations';
import { PlatformAdapter } from './types';

const PlatformContext = createContext<PlatformAdapter>();

export const PlatformProvider: ParentComponent<{ adapter: PlatformAdapter }> = (props) => {
  // Initialize integrations with platform adapter BEFORE rendering children
  // This must run synchronously so the launcher template is ready when TemplateStoreProvider reads the registry
  // Components are handed over here, where the framework is known — `initializeIntegrations` itself
  // stays framework-neutral.
  initializeIntegrations(props.adapter, {
    components: { CesiumGlobe: componentRegistry.CesiumGlobe },
    // Reactivity lent to module stores. Solid's createSignal already has the [read, write] shape the
    // port asks for, so a module store gets reactivity without importing a framework.
    storeDeps: { signal: <T,>(initial: T) => createSignal(initial) as [() => T, (next: T) => void] },
  });

  return <PlatformContext.Provider value={props.adapter}>{props.children}</PlatformContext.Provider>;
};

export function usePlatform(): PlatformAdapter {
  const context = useContext(PlatformContext);
  if (!context) {
    throw new Error('usePlatform must be used within PlatformProvider');
  }
  return context;
}
