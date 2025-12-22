import { createContext, ParentComponent, useContext } from 'solid-js';

import { PlatformAdapter } from './types';
import { initializeIntegrations } from '../initializeIntegrations';

const PlatformContext = createContext<PlatformAdapter>();

export const PlatformProvider: ParentComponent<{ adapter: PlatformAdapter }> = (props) => {
  // Initialize integrations with platform adapter BEFORE rendering children
  // This must run synchronously so the launcher template is ready when TemplateStoreProvider reads the registry
  initializeIntegrations(props.adapter);

  return <PlatformContext.Provider value={props.adapter}>{props.children}</PlatformContext.Provider>;
};

export function usePlatform(): PlatformAdapter {
  const context = useContext(PlatformContext);
  if (!context) {
    throw new Error('usePlatform must be used within PlatformProvider');
  }
  return context;
}

