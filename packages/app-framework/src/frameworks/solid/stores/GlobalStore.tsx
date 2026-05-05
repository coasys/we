import { AgentProfile, Space } from '@we/models';
import { Accessor, createContext, createEffect, createSignal, ParentProps, useContext } from 'solid-js';

import { useAdamStore } from './AdamStore';

export type GlobalEntity = { kind: 'space'; entity: Space } | { kind: 'agent'; entity: AgentProfile };

export interface GlobalStore {
  publicSpaces: Accessor<Space[]>;
  publicAgents: Accessor<AgentProfile[]>;
  selectedGlobalEntity: Accessor<GlobalEntity | null>;
  setSelectedGlobalEntity: (entity: GlobalEntity | null) => void;
  refresh: () => Promise<void>;
}

const GlobalContext = createContext<GlobalStore>();

export function GlobalStoreProvider(props: ParentProps) {
  const adamStore = useAdamStore();

  const [publicSpaces, setPublicSpaces] = createSignal<Space[]>([]);
  const [publicAgents, setPublicAgents] = createSignal<AgentProfile[]>([]);
  const [selectedGlobalEntity, setSelectedGlobalEntity] = createSignal<GlobalEntity | null>(null);

  async function refresh(): Promise<void> {
    const p = adamStore.globalPerspective();
    if (!p) return;
    const [spaces, agents] = await Promise.all([Space.findAll(p), AgentProfile.findAll(p)]);
    setPublicSpaces(spaces);
    setPublicAgents(agents);
  }

  // Hydrate whenever the global perspective becomes available (or changes)
  createEffect(() => {
    const p = adamStore.globalPerspective();
    if (p) refresh().catch(console.error);
  });

  const store: GlobalStore = {
    publicSpaces,
    publicAgents,
    selectedGlobalEntity,
    setSelectedGlobalEntity,
    refresh,
  };

  return <GlobalContext.Provider value={store}>{props.children}</GlobalContext.Provider>;
}

export function useGlobalStore(): GlobalStore {
  const context = useContext(GlobalContext);
  if (!context) throw new Error('useGlobalStore must be used within a GlobalStoreProvider');
  return context;
}
