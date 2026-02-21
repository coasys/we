import { createContext, useContext } from 'react';
import type { PerspectiveProxy } from '@coasys/ad4m';

export const PerspectiveContext = createContext<PerspectiveProxy | null>(null);

export function usePerspective(): PerspectiveProxy {
  const p = useContext(PerspectiveContext);
  if (!p) throw new Error('usePerspective must be used within PerspectiveContext.Provider');
  return p;
}
