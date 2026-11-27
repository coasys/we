/**
 * Runs one capability-profile vector against WE's real stores: every store composed by
 * `composeStores`, as the app composes them, on the in-memory backend, booted for real, with the
 * world the vector describes written into that backend first.
 *
 * The stores run on whatever a {@link ProfileHostKit} supplies: an engine, a platform and the host
 * state. {@link neutralProfileHost} is the test port and the test platform, with no framework and no
 * DOM; `profileHostSolid.ts` is the app's own (Solid, the browser platform, jsdom). The same file
 * passing on both says the profiles are the stores' behaviour, not Solid's or the browser's.
 *
 * Lives in app-shell, not in the conformance package, for the reason `recordNavigation.ts` does: it
 * needs the stores themselves. `@we/template-conformance` calls {@link runProfileCase}, to record the
 * vectors and to check that they still say what WE does.
 *
 * What a vector says is only profile members and plain values. Everything that turns those into WE
 * — dataset ids, the Space record's link to its dataset, the router, the presence channel, a module
 * that declares settings — is done here, so none of it is in the file. The rules a second host needs
 * to run the same file are in `docs/spec/profiles/README.md`.
 *
 * The router is a stand-in, as in `recordNavigation.ts`: `navigate` writes the platform's history and
 * reports the location back through `setCurrentPath`, and Back reports it from `popstate`, which is
 * what the app's router does with both.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { getEntity } from '@we/entities';
import { CORE_MANIFEST } from '@we/entities/manifest';
import type { ReactivityPort } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { CAPABILITY_PROFILES } from '@we/schema-shared';

import { composeStores, type StoreCompositionDeps } from '../../src/shared/composeStores';
import { createCredential } from '../../src/shared/credential';
import { createFirstScreen, type FirstScreen } from '../../src/shared/firstScreen';
import { plainLiveTemplates } from '../../src/shared/liveTemplate';
import { createTestPlatform } from '../../src/shared/platform/testPlatform';
import type { PlatformAdapter } from '../../src/shared/platform/types';
import { createAppFrame } from '../../src/shared/registries/appFrame';
import { createLaneFrames } from '../../src/shared/registries/homeLanes';
import { moduleRegistry } from '../../src/shared/registries/moduleRegistry';
import { createPanelInstances } from '../../src/shared/registries/panelInstances';
import { setTemplatePanels } from '../../src/shared/registries/templatePanels';
import { provideSeed } from '../../src/shared/seedRegistry';
import { signalOrder } from '../../src/shared/signalOrder';
import { createTaskWorkflowLive } from '../../src/shared/taskWorkflowLive';

provideSeed({ name: 'profile-vectors', modules: [] } as never);

/** A record the world holds, in the operations vectors' shape. */
export interface WorldRecord {
  entity: string;
  id: string;
  fields: Record<string, unknown>;
  relations?: Record<string, string[]>;
}

/** A person's published profile: what they said about themselves. */
export interface WorldProfile {
  did: string;
  firstName?: string;
  lastName?: string;
  handle?: string;
  bio?: string;
}

export interface WorldSpace {
  /** The space's id: what its address names (`/space/<id>`), and what records name it by. */
  id: string;
  name: string;
  /** Shared with others, so it has people in it and presence. A personal space has neither. */
  shared?: boolean;
  /** Who is in it besides the viewing person. */
  members?: string[];
  /** The records it holds. Its Space record is the one describing the space itself. */
  records?: WorldRecord[];
}

/** Somebody else present in a space, as their own presence says. */
export interface WorldPeer {
  did: string;
  availability: 'available' | 'busy' | 'away';
  focus: { space: string; path: string };
  activities?: Record<string, unknown>[];
}

/** A capability the host offers that declares settings, by its declaration alone. */
export interface WorldModule {
  id: string;
  name: string;
  settings: Record<string, unknown>[];
}

/** Everything a case's host starts with. */
export interface ProfileWorld {
  /** The viewing person. */
  me: string;
  profiles?: WorldProfile[];
  spaces?: WorldSpace[];
  /** The viewing person's own records, which follow them into every space and nobody else sees. */
  own?: WorldRecord[];
  peers?: WorldPeer[];
  modules?: WorldModule[];
  /** The panels the template on screen declares, as its `meta.panels` does. */
  panels?: Record<string, unknown>[];
}

/** A call of a profile action: the member and its arguments, as JSON. */
export interface ProfileCall {
  action: string;
  args: unknown[];
}

/**
 * What a case asks: where the host starts, anything done first, then one action — or, for a case
 * about what the host reads out of its world, no action at all.
 */
export interface ProfileCaseInput extends Partial<ProfileCall> {
  id: string;
  world: ProfileWorld;
  /** The address the host opens on. */
  address: string;
  /** Addresses visited before it, oldest first, so Back has somewhere to go. */
  history?: string[];
  /** Actions taken before the state is first read, to reach the state the case starts from. */
  setup?: ProfileCall[];
  /** The members whose values the case records, before and after. */
  observe: string[];
}

/** What a host produced for a case: what it read, or what an action changed. */
export type ProfileOutcome =
  | { state: Record<string, unknown> }
  | {
      before: Record<string, unknown>;
      after: Record<string, unknown>;
      /** Per profile, the events the action caused, in the order the profile lists them. */
      events: Record<string, string[]>;
    };

/**
 * The record types a world names, as the file carries them: each property's type and the default a
 * record reads back with when it has no value. Enough to make the records a world lists, which is
 * all a case needs of them.
 */
export function worldEntities(names: readonly string[]): Record<string, { properties: Record<string, unknown> }> {
  return Object.fromEntries(
    names.map((name) => {
      const schema = CORE_MANIFEST.entities[name];
      if (!schema) throw new Error(`A world holds a "${name}", which WE's core manifest does not declare`);
      const properties = Object.fromEntries(
        Object.keys(schema.properties)
          .sort()
          .map((key) => {
            const { type, default: fallback } = schema.properties[key];
            return [key, { type, ...(fallback !== undefined ? { default: fallback } : {}) }];
          }),
      );
      return [name, { properties }];
    }),
  );
}

/** Every state member of every profile, with the profile and events naming it. */
const STATE_MEMBERS = CAPABILITY_PROFILES.flatMap((profile) =>
  profile.members.filter((member) => member.kind === 'state').map((member) => member.path),
);
const STATE_SET = new Set(STATE_MEMBERS);
const ACTION_SET = new Set(
  CAPABILITY_PROFILES.flatMap((p) => p.members.filter((m) => m.kind === 'action').map((m) => m.path)),
);

// ── Values as the file holds them ────────────────────────────────────────────

/** A stored image, whatever the host made of it, as the file shows it. */
const IMAGE = { $image: true };

/**
 * A value made plain: keys in code-point order, the backend's own write stamps left out (each backend
 * stamps its own), and a stored image shown as {@link IMAGE}, since its bytes are what this host's
 * encoder made of the picture.
 */
function plain(value: unknown): unknown {
  if (typeof value === 'string') return value.startsWith('data:image/') ? IMAGE : value;
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (key === 'createdAt' || key === 'updatedAt' || key.startsWith('__')) continue;
      const v = plain((value as Record<string, unknown>)[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  return value;
}

const pick = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  if (!value || typeof value !== 'object') return out;
  for (const key of keys) {
    const v = (value as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = v;
  }
  return out;
};

const PEER_KEYS = ['did', 'name', 'avatar', 'tone', 'activities', 'availability'] as const;
// `atLabel` is the moment in the host's own words and language, so it is not compared.
const CLOCK_KEYS = ['at', 'atIso', 'from', 'to', 'progress', 'playing', 'speed', 'loop', 'canPlay'] as const;
const SPACE_KEYS = [
  'id',
  'name',
  'description',
  'avatar',
  'coverImage',
  'defaultTemplateId',
  'defaultThemeId',
  'enabledModules',
  'enabledViews',
  'moduleSettings',
] as const;
const PROFILE_KEYS = [
  'did',
  'name',
  'firstName',
  'lastName',
  'handle',
  'bio',
  'avatar',
  'coverImage',
  'location',
] as const;

/**
 * Each member's value as the profile's shape describes it: the fields the shape names and no
 * others. A store row carries more than the profile promises, and what it does not promise is not
 * compared — another host's row need not have it.
 */
function projected(path: string, value: unknown): unknown {
  switch (path) {
    case 'presenceStore.peers':
    case 'presenceStore.online':
    case 'presenceStore.onlineHere':
      return (value as Record<string, unknown>[]).map((peer) => ({
        ...pick(peer, PEER_KEYS),
        focus: { path: (peer.focus as { path?: string } | undefined)?.path ?? '' },
      }));
    case 'clockStore.clocks':
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, view]) => [name, pick(view, CLOCK_KEYS)]),
      );
    case 'spaceStore.viewNav':
      // A section's label and icon are the host's names for it; what the profile fixes is which
      // sections there are, in which order, and where each goes.
      return (value as Record<string, unknown>[]).map((row) => pick(row, ['id', 'segment', 'path']));
    case 'spaceStore.currentSpace': {
      if (!value) return null;
      const space = pick(value, SPACE_KEYS);
      // What the host stored for an image is its own encoding of it; that one is set is the fact.
      for (const field of ['avatar', 'coverImage']) if (space[field]) space[field] = IMAGE;
      return space;
    }
    case 'spaceStore.mySpaces':
      return (value as Record<string, unknown>[])
        .map((space) => pick(space, ['id', 'name']))
        .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
    case 'profileStore.ownProfile':
      return value ? pick(value, PROFILE_KEYS) : null;
    case 'profileStore.profiles':
      return (value as Record<string, unknown>[])
        .map((profile) => pick(profile, PROFILE_KEYS))
        .sort((a, b) => (String(a.did) < String(b.did) ? -1 : 1));
    case 'spaceStore.myModuleSettings':
      return (value as Record<string, unknown>[]).map((row) =>
        pick(row, ['group', 'key', 'type', 'value', 'source', 'set', 'locked', 'lockedBy']),
      );
    case 'shellStore.panelInstances':
      // An instance's id is the host's to mint; a case that needs one reads it (see `decodeArg`).
      return (value as Record<string, unknown>[]).map((instance) => pick(instance, ['panel', 'inputs', 'title']));
    default:
      return value;
  }
}

/**
 * An argument as the store takes it. Two kinds are not plain JSON: a file (`{ $file }`), which
 * becomes a File, and a value read from the host's own state (`{ $read: [member, ...path] }`), for an
 * argument only the host can know — the id it gave a panel instance it opened.
 */
function decodeArg(host: Host, value: unknown): unknown {
  if (value && typeof value === 'object' && '$read' in value) {
    const [member, ...path] = (value as { $read: [string, ...(string | number)[]] }).$read;
    return path.reduce<unknown>(
      (at, key) => (at as Record<string | number, unknown> | undefined)?.[key],
      host.untrack(() => read(host.stores, member)),
    );
  }
  if (value && typeof value === 'object' && '$file' in value) {
    const { name, type, base64 } = (value as { $file: { name: string; type: string; base64: string } }).$file;
    return new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name, { type });
  }
  return value;
}

// ── The host ─────────────────────────────────────────────────────────────────

type Stores = Record<string, Record<string, unknown>>;

/** The composed stores, and the engine they run on. */
interface Host {
  stores: Stores;
  untrack: ReactivityPort['untrack'];
}

function read(stores: Stores, path: string): unknown {
  const [store, member] = path.split('.');
  const value = stores[store]?.[member];
  if (value === undefined) throw new Error(`${path} is not a member this host provides`);
  return typeof value === 'function' ? (value as () => unknown)() : value;
}

const snapshot = (host: Host, path: string): string =>
  JSON.stringify(
    plain(
      projected(
        path,
        host.untrack(() => read(host.stores, path)),
      ),
    ),
  );

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait until nothing any profile reads has changed for a while: the host has finished answering.
 * A store's write lands on its own time — a backend round trip, a live query pushing — so there is
 * no promise to wait on that means "done", only the state staying where it is.
 */
async function settle(host: Host, quietMs = 400, ceilingMs = 8000): Promise<void> {
  let last = STATE_MEMBERS.map((path) => snapshot(host, path)).join('\n');
  let quietSince = Date.now();
  const started = Date.now();
  while (Date.now() - quietSince < quietMs) {
    if (Date.now() - started > ceilingMs) return;
    await tick(25);
    const now = STATE_MEMBERS.map((path) => snapshot(host, path)).join('\n');
    if (now !== last) {
      last = now;
      quietSince = Date.now();
    }
  }
}

/**
 * What a host runs the stores on for one case: everything `composeStores` takes but the backend,
 * on a platform already holding the case's history, and how to put the environment back after.
 */
export interface ProfileHostEnvironment extends Omit<StoreCompositionDeps, 'backend'> {
  firstScreen: FirstScreen;
  close(): void;
}

/** A way of hosting the stores: Solid in a browser, or no framework and no DOM. */
export interface ProfileHostKit {
  /** The environment for a case whose history is `entries`, the last being where it opens. */
  open(entries: readonly string[]): ProfileHostEnvironment;
}

/** The deployment's platform answers the stores read beyond the port. */
export const asAdapter = <T extends object>(platform: T): PlatformAdapter =>
  ({ ...platform, isDesktop: false, isDevelopment: true }) as unknown as PlatformAdapter;

/**
 * The stores on the test port and the test platform: no framework, no DOM, no window. Toasts are
 * dropped — no profile member reads them.
 *
 * Time does not pass in a case, so a playing clock is read before it has moved: the app's clocks
 * play on the platform's frames, and nothing here runs the test platform's.
 */
export const neutralProfileHost: ProfileHostKit = {
  open(entries) {
    const reactivity = createTestReactivity();
    const [first, ...rest] = entries;
    const platform = createTestPlatform({ url: first });
    for (const entry of rest) platform.history.push(entry);
    const { appFrame, appEdgeFrames } = createAppFrame(reactivity);
    const { laneFrames } = createLaneFrames(reactivity);
    const { publishPanelInstances } = createPanelInstances(reactivity);
    const ignore = () => {};
    return {
      reactivity,
      platform: asAdapter(platform),
      toasts: { info: ignore, success: ignore, warning: ignore, error: ignore },
      firstScreen: createFirstScreen({ signal: reactivity.signal }),
      credential: createCredential(reactivity),
      liveTemplates: plainLiveTemplates(reactivity),
      shellHost: { appFrame, appEdgeFrames, laneFrames, publishPanelInstances },
      spaceHost: { signalOrder, taskWorkflowLive: createTaskWorkflowLive(reactivity.signal) },
      close: () => {},
    };
  },
};

/** Write the world into a fresh in-memory backend. */
async function backendFor(world: ProfileWorld) {
  const spaces = world.spaces ?? [];
  const ports = createInMemoryBackendPorts(
    { selfId: () => world.me },
    {
      agent: { id: world.me, unlocked: true },
      datasets: [
        // The viewing person's own dataset, which the host keeps their own records in.
        { id: 'own', name: 'we-root' },
        ...spaces.map((space) => ({
          id: space.id,
          name: space.name,
          ...(space.shared ? { sharedUri: `inmemory://${space.id}` } : {}),
        })),
      ],
      profiles: (world.profiles ?? []).map((p) => ({
        did: p.did,
        firstName: p.firstName ?? '',
        lastName: p.lastName ?? '',
        handle: p.handle ?? '',
        bio: p.bio ?? '',
      })),
      presence: (world.peers ?? []).map((peer) => ({
        did: peer.did,
        availability: peer.availability,
        focus: { datasetUri: `inmemory://${peer.focus.space}`, path: peer.focus.path },
        activities: (peer.activities ?? []) as never,
      })),
    },
  );
  const members = new Map(spaces.map((space) => [space.id, space.members ?? []]));
  ports.lifecycle.members = (id: string) => Promise.resolve(members.get(id) ?? []);

  const write = async (datasetId: string, records: readonly WorldRecord[], space?: WorldSpace) => {
    const handle = (await ports.lifecycle.get(datasetId))!.handle;
    await ports.schemas.installSpace(handle, []);
    for (const record of records) {
      // A Space record is linked to the space it describes the way this host links them: by the
      // dataset's id, and for a shared space by its shared id too.
      const link =
        record.entity === 'Space' && space ? { uuid: space.id, ...(space.shared ? { url: space.id } : {}) } : {};
      await getEntity(record.entity).create(handle, { ...record.fields, ...link } as never, { id: record.id } as never);
    }
    for (const record of records) {
      for (const [relation, ids] of Object.entries(record.relations ?? {})) {
        await (
          getEntity(record.entity) as unknown as {
            setRelation(h: unknown, id: string, r: string, ids: string[]): Promise<void>;
          }
        ).setRelation(handle, record.id, relation, ids);
      }
    }
  };
  await write('own', world.own ?? []);
  for (const space of spaces) await write(space.id, space.records ?? [], space);
  return ports;
}

function compose(
  env: ProfileHostEnvironment,
  ports: ReturnType<typeof createInMemoryBackendPorts>,
): { host: Host; dispose: () => void } {
  const { reactivity, platform } = env;
  let stores!: Stores;
  let stopListening = () => {};
  const disposeRoot = reactivity.root(() => {
    const backend = { initialize: () => Promise.resolve({ client: {}, ports }) } as never;
    const registry = composeStores({ ...env, backend });
    const { routeStore } = registry;
    const report = () => routeStore.setCurrentPath(platform.location().pathname, platform.location().search);
    routeStore.setNavigateFunction((to, options) => {
      if (to === -1) return platform.history.back();
      if (typeof to === 'number') throw new Error(`The vector host goes back one entry at a time, not ${to}`);
      if (options?.replace) platform.history.replace(to);
      else platform.history.push(to);
      report();
    });
    stopListening = platform.listen('popstate', report);
    report();
    stores = registry as unknown as Stores;
  });
  return {
    host: { stores, untrack: reactivity.untrack },
    dispose: () => {
      stopListening();
      disposeRoot();
    },
  };
}

async function call(host: Host, { action, args }: ProfileCall): Promise<void> {
  if (!ACTION_SET.has(action)) throw new Error(`${action} is not an action of any profile`);
  const [store, member] = action.split('.');
  const fn = host.stores[store]?.[member];
  if (typeof fn !== 'function') throw new Error(`${action} is not an action this host provides`);
  await (fn as (...a: unknown[]) => unknown)(...args.map((arg) => decodeArg(host, arg)));
}

/**
 * Wait for the peers the world puts in the space on screen to have said they are there. A peer's
 * presence arrives on its own heartbeat, after the host starts listening, so without this a case
 * would read the roster at whatever moment the first beat happened to land.
 */
async function peersArrived(host: Host, input: ProfileCaseInput): Promise<void> {
  const here = (read(host.stores, 'spaceStore.spacePath') as string).split('/')[2];
  const expected = (input.world.peers ?? []).filter((peer) => peer.focus.space === here).map((peer) => peer.did);
  const started = Date.now();
  while (Date.now() - started < 4000) {
    const seen = (host.untrack(() => read(host.stores, 'presenceStore.peers')) as { did: string }[]).map(
      (peer) => peer.did,
    );
    if (expected.every((did) => seen.includes(did))) return;
    await tick(50);
  }
  throw new Error(`${input.id}: the world's peers never arrived`);
}

/** Run one case: build its world, open the host where it says, act, and report what changed. */
export async function runProfileCase(input: ProfileCaseInput, kit: ProfileHostKit): Promise<ProfileOutcome> {
  for (const path of input.observe) {
    if (!STATE_SET.has(path)) throw new Error(`${input.id}: ${path} is not a state member of any profile`);
  }
  setTemplatePanels(input.world.panels as never, input.world.panels ? `vectors:${input.id}` : '');
  const registered = (input.world.modules ?? []).map((module) => {
    moduleRegistry.register(
      {
        manifest: { id: module.id, name: module.name, scope: 'agent' },
        contributes: { settings: module.settings },
      } as never,
      { backend: 'inmemory', framework: 'solid' },
    );
    return module.id;
  });

  const env = kit.open([...(input.history ?? []), input.address]);
  const ports = await backendFor(input.world);
  const { host, dispose } = compose(env, ports);
  try {
    const session = host.stores.sessionStore as { bootState: () => string };
    const started = Date.now();
    while (session.bootState() !== 'ready') {
      if (Date.now() - started > 8000) throw new Error(`${input.id}: the host never finished booting`);
      await tick(20);
    }
    env.firstScreen.answered();
    env.firstScreen.drawn();
    await settle(host);
    await peersArrived(host, input);
    await settle(host);
    for (const step of input.setup ?? []) {
      await call(host, step);
      await settle(host);
    }

    const observed = () =>
      Object.fromEntries(input.observe.map((path) => [path, JSON.parse(snapshot(host, path)) as unknown]));
    const before = observed();
    if (!input.action) return { state: before };

    /*
      Which members told their readers they changed. Each member is watched the way a template
      reads it, through the reactive graph: a value that moved without anybody being told is a value
      no template redraws for, so it is not an event, however different it reads afterwards.
    */
    const changed = new Set<string>();
    const stopWatching = env.reactivity.root(() => {
      for (const path of STATE_MEMBERS) {
        let last = snapshot(host, path);
        env.reactivity.effect(() => {
          const now = JSON.stringify(plain(projected(path, read(host.stores, path))));
          if (now !== last) changed.add(path);
          last = now;
        });
      }
    });
    try {
      await call(host, { action: input.action, args: input.args ?? [] });
      await settle(host);
    } finally {
      stopWatching();
    }
    const after = observed();

    const events: Record<string, string[]> = {};
    for (const profile of CAPABILITY_PROFILES) {
      const fired = profile.events.filter((event) => event.changes.some((path) => changed.has(path)));
      if (fired.length) events[profile.id] = fired.map((event) => event.name);
    }
    return { before, after, events };
  } finally {
    dispose();
    for (const id of registered) moduleRegistry.unregister(id);
    setTemplatePanels(undefined);
    env.close();
    await tick(50);
  }
}
