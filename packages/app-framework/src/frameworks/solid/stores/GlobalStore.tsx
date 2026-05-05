import { AgentProfile, Space } from '@we/models';
import { Accessor, createContext, createEffect, createMemo, createSignal, ParentProps, useContext } from 'solid-js';

import { useAdamStore } from './AdamStore';

/** A globe pin derived from a Space + its LocationBlocks. */
export interface SpacePin {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

/** A globe pin derived from an AgentProfile + its location LocationBlock. */
export interface AgentPin {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

/** Plain-object representation of the entity currently selected on the discovery globe. */
export type SelectedGlobalEntity =
  | { kind: 'space'; uuid: string; url?: string; name: string; description: string; thumbnail?: string }
  | {
      kind: 'agent';
      handle: string;
      firstName: string;
      lastName: string;
      bio: string;
      profileImage?: string;
      coverImage?: string;
    };

export interface GlobalStore {
  publicSpaces: Accessor<Space[]>;
  publicAgents: Accessor<AgentProfile[]>;
  spaceLocationPins: Accessor<SpacePin[]>;
  agentLocationPins: Accessor<AgentPin[]>;
  selectedGlobalEntity: Accessor<SelectedGlobalEntity | null>;
  setSelectedSpaceById: (uuid: string) => void;
  setSelectedAgentById: (handle: string) => void;
  clearSelectedEntity: () => void;
  refresh: () => Promise<void>;
}

const GlobalContext = createContext<GlobalStore>();

export function GlobalStoreProvider(props: ParentProps) {
  const adamStore = useAdamStore();

  const [publicSpaces, setPublicSpaces] = createSignal<Space[]>([]);
  const [publicAgents, setPublicAgents] = createSignal<AgentProfile[]>([]);
  const [spaceLocationPins, setSpaceLocationPins] = createSignal<SpacePin[]>([]);
  const [agentLocationPins, setAgentLocationPins] = createSignal<AgentPin[]>([]);
  const [selectedGlobalEntity, setSelectedGlobalEntity] = createSignal<SelectedGlobalEntity | null>(null);

  async function refresh(): Promise<void> {
    const p = adamStore.globalPerspective();
    if (!p) return;

    const [spaces, agents] = await Promise.all([Space.findAll(p), AgentProfile.findAll(p)]);

    // Build space pins from each space's hydrated locations array
    const spacePins: SpacePin[] = [];
    for (const space of spaces) {
      for (const loc of space.locations ?? []) {
        if (loc.latitude != null && loc.longitude != null) {
          spacePins.push({
            // id is the space.uuid so setSelectedSpaceById can look up by uuid directly
            id: space.uuid,
            name: space.name,
            latitude: loc.latitude,
            longitude: loc.longitude,
          });
        }
      }
    }

    // Build agent pins via the HasOne location property (populated by findAll when present)
    const agentPins: AgentPin[] = [];
    for (const agent of agents) {
      const loc = agent.location;
      if (loc?.latitude != null && loc?.longitude != null) {
        agentPins.push({
          id: agent.handle || String((agent as { id?: string }).id ?? agent.handle),
          name: [agent.firstName, agent.lastName].filter(Boolean).join(' ') || agent.handle,
          latitude: loc.latitude,
          longitude: loc.longitude,
        });
      }
    }

    setPublicSpaces(spaces);
    setPublicAgents(agents);
    setSpaceLocationPins(spacePins);
    setAgentLocationPins(agentPins);
  }

  // Hydrate whenever the global perspective becomes available (or changes)
  createEffect(() => {
    const p = adamStore.globalPerspective();
    if (p) refresh().catch(console.error);
  });

  function setSelectedSpaceById(uuid: string): void {
    const space = publicSpaces().find((s) => s.uuid === uuid);
    if (!space) return;
    setSelectedGlobalEntity({
      kind: 'space',
      uuid: space.uuid,
      url: space.url,
      name: space.name,
      description: space.description,
      thumbnail: typeof space.thumbnail === 'string' ? space.thumbnail : undefined,
    });
  }

  function setSelectedAgentById(handle: string): void {
    const agent = publicAgents().find((a) => a.handle === handle);
    if (!agent) return;
    setSelectedGlobalEntity({
      kind: 'agent',
      handle: agent.handle,
      firstName: agent.firstName,
      lastName: agent.lastName,
      bio: agent.bio,
      profileImage: typeof agent.profileImage === 'string' ? agent.profileImage : undefined,
      coverImage: typeof agent.coverImage === 'string' ? agent.coverImage : undefined,
    });
  }

  function clearSelectedEntity(): void {
    setSelectedGlobalEntity(null);
  }

  // Derive memos for the pin arrays (no-op here — already signals — exposed as memos for consistency)
  const spaceLocationPinsMemo = createMemo(() => spaceLocationPins());
  const agentLocationPinsMemo = createMemo(() => agentLocationPins());

  const store: GlobalStore = {
    publicSpaces,
    publicAgents,
    spaceLocationPins: spaceLocationPinsMemo,
    agentLocationPins: agentLocationPinsMemo,
    selectedGlobalEntity,
    setSelectedSpaceById,
    setSelectedAgentById,
    clearSelectedEntity,
    refresh,
  };

  return <GlobalContext.Provider value={store}>{props.children}</GlobalContext.Provider>;
}

export function useGlobalStore(): GlobalStore {
  const context = useContext(GlobalContext);
  if (!context) throw new Error('useGlobalStore must be used within a GlobalStoreProvider');
  return context;
}
