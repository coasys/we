import { LinkQuery } from '@coasys/ad4m';
import { AgentProfile, Signal, SignalType, Space } from '@we/models';
import { Accessor, createContext, createEffect, createMemo, createSignal, ParentProps, useContext } from 'solid-js';

import { useAdamStore } from './AdamStore';

/** A globe pin derived from a Space + its LocationBlocks. */
export interface SpacePin {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  signalEnergy?: number;
}

/** A globe pin derived from an AgentProfile + its location LocationBlock. */
export interface AgentPin {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  signalEnergy?: number;
}

/** Plain-object representation of the entity currently selected on the discovery globe. */
export type SelectedGlobalEntity =
  | { kind: 'space'; nodeId: string; uuid: string; url?: string; name: string; description: string; thumbnail?: string }
  | {
      kind: 'agent';
      nodeId: string;
      handle: string;
      firstName: string;
      lastName: string;
      bio: string;
      profileImage?: string;
      coverImage?: string;
    };

/** Per-signal-type aggregate row for the selected entity's react bar. */
export interface EntitySignalData {
  /** The AD4M node ID of the target entity in the global perspective. */
  nodeId: string;
  signalType: SignalType;
  /** Aggregate value (count, sum, or mean depending on SignalType.aggregate). */
  totalValue: number;
  /** The current user's signal value for this type (0 = not signaled). */
  myValue: number;
}

export interface GlobalStore {
  publicSpaces: Accessor<Space[]>;
  publicAgents: Accessor<AgentProfile[]>;
  spaceLocationPins: Accessor<SpacePin[]>;
  agentLocationPins: Accessor<AgentPin[]>;
  globalSignalTypes: Accessor<SignalType[]>;
  selectedGlobalEntity: Accessor<SelectedGlobalEntity | null>;
  selectedEntitySignalData: Accessor<EntitySignalData[]>;
  setSelectedSpaceById: (uuid: string) => void;
  setSelectedAgentById: (handle: string) => void;
  clearSelectedEntity: () => void;
  upsertGlobalSignal: (nodeId: string, signalTypeId: string, value: number) => Promise<void>;
  refresh: () => Promise<void>;
}

const GlobalContext = createContext<GlobalStore>();

export function GlobalStoreProvider(props: ParentProps) {
  const adamStore = useAdamStore();

  const [publicSpaces, setPublicSpaces] = createSignal<Space[]>([]);
  const [publicAgents, setPublicAgents] = createSignal<AgentProfile[]>([]);
  const [spaceLocationPins, setSpaceLocationPins] = createSignal<SpacePin[]>([]);
  const [agentLocationPins, setAgentLocationPins] = createSignal<AgentPin[]>([]);
  const [globalSignalTypes, setGlobalSignalTypes] = createSignal<SignalType[]>([]);
  const [selectedGlobalEntity, setSelectedGlobalEntity] = createSignal<SelectedGlobalEntity | null>(null);
  const [selectedEntitySignalData, setSelectedEntitySignalData] = createSignal<EntitySignalData[]>([]);

  async function loadEntitySignalData(
    entity: SelectedGlobalEntity | null,
    stypes: SignalType[],
    myDid?: string,
  ): Promise<void> {
    const globalP = adamStore.globalPerspective();
    if (!entity || !globalP || !stypes.length) {
      setSelectedEntitySignalData([]);
      return;
    }
    const nodeId = entity.nodeId;
    const links = await globalP.get(new LinkQuery({ source: nodeId, predicate: 'we://has_signals' }));
    const signalsByType: Record<string, { count: number; sum: number; myValue: number }> = {};
    for (const link of links) {
      const sigs = await Signal.findAll(globalP, { where: { id: link.data.target } });
      const sig = sigs[0];
      if (!sig) continue;
      const entry = signalsByType[sig.signalTypeId] ?? { count: 0, sum: 0, myValue: 0 };
      entry.count++;
      entry.sum += sig.value;
      if (link.author === myDid) entry.myValue = sig.value;
      signalsByType[sig.signalTypeId] = entry;
    }
    const rows: EntitySignalData[] = stypes.map((st) => {
      const entry = signalsByType[st.id] ?? { count: 0, sum: 0, myValue: 0 };
      let totalValue = 0;
      if (st.aggregate === 'count') totalValue = entry.count;
      else if (st.aggregate === 'sum') totalValue = entry.sum;
      else if (st.aggregate === 'mean') totalValue = entry.count ? entry.sum / entry.count : 0;
      return { nodeId, signalType: st, totalValue, myValue: entry.myValue };
    });
    setSelectedEntitySignalData(rows);
  }

  async function upsertGlobalSignal(nodeId: string, signalTypeId: string, value: number): Promise<void> {
    const globalP = adamStore.globalPerspective();
    const myDid = adamStore.me()?.did;
    if (!globalP || !myDid) return;

    const nodeLinks = await globalP.get(new LinkQuery({ source: nodeId, predicate: 'we://has_signals' }));
    const myLinks = nodeLinks.filter((l) => l.author === myDid);
    for (const link of myLinks) {
      const [existing] = await Signal.findAll(globalP, { where: { id: link.data.target, signalTypeId } });
      if (existing) {
        if (value === 0) {
          await globalP.remove(link);
          await existing.delete();
        } else {
          existing.value = value;
          await existing.save();
        }
        void loadEntitySignalData(selectedGlobalEntity(), globalSignalTypes(), myDid);
        return;
      }
    }
    if (value === 0) return;
    await Signal.create(globalP, { signalTypeId, value }, { parent: { id: nodeId, predicate: 'we://has_signals' } });
    void loadEntitySignalData(selectedGlobalEntity(), globalSignalTypes(), myDid);
  }

  async function refresh(): Promise<void> {
    const p = adamStore.globalPerspective();
    if (!p) return;

    const [spaces, agents, signalTypes] = await Promise.all([
      Space.findAll(p),
      AgentProfile.findAll(p),
      SignalType.findAll(p),
    ]);
    setGlobalSignalTypes(signalTypes);

    // Compute signal energy per node (number of has_signals links on each entity)
    const allSignalLinks = await p.get(new LinkQuery({ predicate: 'we://has_signals' }));
    const energyByNode: Record<string, number> = {};
    for (const link of allSignalLinks) {
      energyByNode[link.data.source] = (energyByNode[link.data.source] ?? 0) + 1;
    }

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
            signalEnergy: energyByNode[space.id] ?? 0,
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
          signalEnergy: energyByNode[agent.id] ?? 0,
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

  // Reload signal data whenever the selected entity or signal types change
  createEffect(() => {
    const entity = selectedGlobalEntity();
    const stypes = globalSignalTypes();
    const myDid = adamStore.me()?.did;
    void loadEntitySignalData(entity, stypes, myDid);
  });

  function setSelectedSpaceById(uuid: string): void {
    const space = publicSpaces().find((s) => s.uuid === uuid);
    if (!space) return;
    setSelectedGlobalEntity({
      kind: 'space',
      nodeId: space.id,
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
      nodeId: agent.id,
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
    globalSignalTypes,
    selectedGlobalEntity,
    selectedEntitySignalData,
    setSelectedSpaceById,
    setSelectedAgentById,
    clearSelectedEntity,
    upsertGlobalSignal,
    refresh,
  };

  return <GlobalContext.Provider value={store}>{props.children}</GlobalContext.Provider>;
}

export function useGlobalStore(): GlobalStore {
  const context = useContext(GlobalContext);
  if (!context) throw new Error('useGlobalStore must be used within a GlobalStoreProvider');
  return context;
}
