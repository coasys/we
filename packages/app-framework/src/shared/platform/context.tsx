import { createContext, ParentComponent, useContext } from 'solid-js';

import { PlatformAdapter } from './types';

const PlatformContext = createContext<PlatformAdapter>();

export const PlatformProvider: ParentComponent<{ adapter: PlatformAdapter }> = (props) => {
  return <PlatformContext.Provider value={props.adapter}>{props.children}</PlatformContext.Provider>;
};

export function usePlatform(): PlatformAdapter {
  const context = useContext(PlatformContext);
  if (!context) {
    throw new Error('usePlatform must be used within PlatformProvider');
  }
  return context;
}
