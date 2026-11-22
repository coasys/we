import { type Ad4mModel, LinkQuery, type PerspectiveProxy, SHACLShape } from '@coasys/ad4m';
import { ModuleSchemasRefused } from '@we/backend-shared';
import { getEntityTargetClass } from '@we/entities';

import { classNameOf } from './className';
import {
  AgentSettings,
  Amendment,
  AudioBlock,
  CalloutBlock,
  CodeBlock,
  CollectionBlock,
  DividerBlock,
  EdgeRoute,
  EmbedBlock,
  EventBlock,
  FileBlock,
  ImageBlock,
  Involvement,
  InvolvementType,
  LinkBlock,
  LocationBlock,
  ModelRun,
  MutedAgent,
  Placement,
  Policy,
  ReadMarker,
  Relationship,
  RelationshipType,
  Role,
  RoleGrant,
  Shape,
  Signal,
  SignalType,
  Space,
  SpaceLandmark,
  SpacePreference,
  SpaceTemplatePreference,
  TagBlock,
  TaskBlock,
  TaskState,
  Template,
  TextBlock,
  Theme,
  Topic,
  TypeStyle,
  VideoBlock,
  WeNode,
} from './entities';
import { sharedInFlight } from './inFlight';
import { moduleOfModel } from './manifestCompiler';
import { entityNameOfClass } from './recordTypes';
import { rpcStatus } from './rpcStatus';

export { classNameOf };

/**
 * All SDNA models that belong to the we-root system perspective.
 * Centralised here so both AdamStore branches (create vs restore) always
 * register the same complete set.
 */
export const ROOT_MODELS = [
  AgentSettings,
  SpacePreference,
  SpaceTemplatePreference,
  Template,
  Theme,
  LocationBlock,
  // Per-agent private state. Root-dataset models by definition — written into a space they would
  // sync one agent's read positions, and their mute list, to every member of that community.
  ReadMarker,
  MutedAgent,
  // What a model was asked to do about a root record, such as a template, and what it wrote.
  ModelRun,
  // The editor's chats: a `CollectionBlock` of kind `chat`, its messages `TextBlock`s.
  CollectionBlock,
  TextBlock,
] as const;

/** Marker on the shape node: this shape's hints were tuned by the space and must not be reverted. */
export const HINTS_CUSTOMIZED_PREDICATE = 'we://interpretation_customized';

/**
 * The stored shape of the class `targetClass`, as the executor reads it, or `null` when it has none.
 * Asked by the target class: `shapes()` takes one as well as a name, and a name can be two classes'.
 */
export async function storedShapeOf(p: PerspectiveProxy, targetClass: string): Promise<SHACLShape | null> {
  const found = await p.shapes([targetClass]);
  return found.find((record) => record.shape.targetClass === targetClass)?.shape ?? null;
}

/** A model's declared shape, as `Ad4mModel.registerAll` sends it. */
function declaredShapeOf(model: typeof Ad4mModel): SHACLShape {
  const { shape } = model.generateSHACL() as { shape: SHACLShape | null };
  if (!shape) throw new Error(`Class ${model.name} has no shape: declare it with @Model.`);
  return shape;
}

/**
 * The declared shape with the hints a space tuned put in.
 *
 * Structure comes from the model, as on every registration. Hints come from the stored shape: the
 * class hint, and each property's hint by property name. A property the stored shape does not have
 * keeps its declared hint, because nobody tuned it.
 */
export function withTunedHints(declared: SHACLShape, stored: SHACLShape): SHACLShape {
  const merged = SHACLShape.fromJSON(declared.toJSON());
  if (stored.interpretationHint) merged.interpretationHint = stored.interpretationHint;
  else delete merged.interpretationHint;
  const storedByName = new Map(stored.properties.filter((p) => p.name).map((p) => [p.name!, p]));
  for (const property of merged.properties) {
    const tuned = property.name ? storedByName.get(property.name) : undefined;
    if (!tuned) continue;
    if (tuned.interpretationHint) property.interpretationHint = tuned.interpretationHint;
    else delete property.interpretationHint;
  }
  return merged;
}

/**
 * Which declared-shape sets a `registerShapes` call has already carried into a perspective,
 * remembered so a repeat ask is not paid for twice.
 *
 * The executor's diff makes a repeat registration correct but not cheap: the marker read plus the
 * call is a couple of round trips, and the boot and every space switch were waiting on them even
 * when every shape came back unchanged. Two tiers of memo say "this perspective already holds the
 * outcome of registering this set", both keyed by the perspective's uuid — a registered shape is
 * the perspective's, not the agent's, so the uuid alone identifies the confirmation:
 *
 * - **In-session** — this map. A call for a confirmed set answers `[]` at once and sends nothing,
 *   not even the marker read. The shape could only have drifted within the session if a peer
 *   rewrote it, which the device tier's background re-check is for; a query straight after has the
 *   shapes the confirmation left.
 * - **On-device** — `localStorage`, written only once `registerShapes` resolves. A hit answers `[]`
 *   at once too, but then runs the full registration in the background, once per session: the memo
 *   could be stale across sessions (another peer on another build rewrote a shape), so the call
 *   goes out anyway, off the caller's wait, and anything it writes is logged. Where there is no
 *   `localStorage` — Node, a test, a browser blocking site data — the session tier alone applies.
 *
 * A shape set this device has *not* confirmed — the first boot, a build that changed a model or
 * added one, a module enabled since — has a new {@link fingerprintOf} and waits for the executor
 * exactly as before: a model with no stored shape fails every query until then, and a write drops
 * a property the stored shape does not know. That wait is the one the memos must never skip. A
 * rejected registration clears both tiers, so the next call waits rather than trusting a
 * confirmation that never completed; and calls for one set in flight together share the one
 * request (`sharedInFlight`), so a boot and a switch racing send a single `registerShapes`.
 */

/**
 * One shape set's place in the memo: `slot` names the set (its target classes), `print` its content.
 * A slot holds one print, so a build that changes a set replaces its entry instead of adding one.
 */
interface Memo {
  slot: string;
  print: string;
}

/** The print this session has confirmed for each slot, by perspective uuid. */
const confirmed = new Map<string, Map<string, string>>();

const sessionHas = (uuid: string, memo: Memo) => confirmed.get(uuid)?.get(memo.slot) === memo.print;

const sessionConfirm = (uuid: string, memo: Memo) => {
  const slots = confirmed.get(uuid) ?? new Map<string, string>();
  slots.set(memo.slot, memo.print);
  confirmed.set(uuid, slots);
};

/**
 * `localStorage` is not merely absent in some contexts — it **throws**: a private window, blocked
 * site data, an opaque origin. A memo that cannot persist degrades to the session tier, never to a
 * failed registration.
 */
function deviceStore(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const DEVICE_KEY = 'we.sdna:';

/** The print this device has confirmed for each slot in `uuid`; empty where there is no device store. */
function deviceSlots(uuid: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(deviceStore()?.getItem(DEVICE_KEY + uuid) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

const deviceHas = (uuid: string, memo: Memo) => deviceSlots(uuid)[memo.slot] === memo.print;

/** Set a slot's print on this device, or drop the slot when `print` is null. */
function deviceWrite(uuid: string, slot: string, print: string | null): void {
  try {
    const slots = deviceSlots(uuid);
    if (print === null) delete slots[slot];
    else slots[slot] = print;
    deviceStore()?.setItem(DEVICE_KEY + uuid, JSON.stringify(slots));
  } catch {
    // Quota or a blocked write: the session memo still stands, the next boot just re-registers.
  }
}

/** Drop a slot from both tiers — a rejected registration confirmed nothing. */
function forgetConfirmed(uuid: string, memo: Memo): void {
  confirmed.get(uuid)?.delete(memo.slot);
  deviceWrite(uuid, memo.slot, null);
}

/**
 * Forget every confirmed registration for this perspective.
 *
 * Called where stored shapes change outside `registerModels` — a space tuning its hints writes
 * them straight, and a reset of those hints must send the declared shape again. Either invalidates
 * "already registered" for every set here, so the next registration looks again.
 */
export function forgetRegisteredShapes(p: PerspectiveProxy): void {
  confirmed.delete(p.uuid);
  try {
    deviceStore()?.removeItem(DEVICE_KEY + p.uuid);
  } catch {
    // As `deviceWrite`.
  }
}

/** cyrb53's mixing in 32-bit arithmetic: short, the same on every engine. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`;
}

/**
 * The memo entry for the declared shapes a call would send — before the tuned-hints merge, so it
 * costs no reads — sorted by target class, the key the executor registers under. One build
 * serializes a shape the same way every time; a build that serializes it differently costs one
 * awaited registration, which is also all a hash collision costs.
 */
function fingerprintOf(declared: readonly SHACLShape[]): Memo {
  const sorted = [...declared].sort((a, b) => String(a.targetClass).localeCompare(String(b.targetClass)));
  return {
    slot: hash(sorted.map((shape) => shape.targetClass ?? '').join(' ')),
    print: hash(JSON.stringify(sorted.map((shape) => shape.toJSON()))),
  };
}

/**
 * Register these models' shapes in one `registerShapes` call, and answer the entities it wrote.
 *
 * The executor compares each shape with the one it stores and writes only the differences, so this
 * is safe to call on every start and on every space switch, from any number of peers. It answers
 * once the executor reads the new shapes, so a query can run straight after.
 *
 * Which of the three ways a call goes out — or does not — is the memo's, above: confirmed in this
 * session, send nothing; confirmed on this device, answer now and re-check in the background;
 * unconfirmed, run the full registration awaited, deduplicated with any caller already asking.
 *
 * **Tuned hints.** The executor counts `ad4m://interpretation_hint` as part of a shape. A space that
 * tuned its hints (the `we://interpretation_customized` marker on the shape node) would lose them to
 * the declared shape's hints on the next switch. So the marker is read first. In the common case
 * there is none, and the declared shapes go as they are. A marked shape goes with its stored hints
 * put in: see {@link withTunedHints}. The marker is a link of WE's own, which the executor keeps
 * when it rewrites a shape.
 */
async function registerModels(p: PerspectiveProxy, models: readonly (typeof Ad4mModel)[]): Promise<string[]> {
  const declared = models
    .filter((model) => !Object.prototype.hasOwnProperty.call(model, 'builtinUri'))
    .map((model) => declaredShapeOf(model));
  if (declared.length === 0) return [];

  const memo = fingerprintOf(declared);
  if (sessionHas(p.uuid, memo)) return [];
  if (deviceHas(p.uuid, memo)) {
    // Confirmed on this device already: the caller gets its answer now, and the registration that
    // proves the memo is still true runs in the background — once per session, which marking the
    // session tier before it starts is what guarantees.
    sessionConfirm(p.uuid, memo);
    void sharedInFlight(p, `sdna:${memo.slot}:${memo.print}`, () => registerDeclared(p, declared, memo)).then(
      (written) => {
        if (written.length) console.info(`ad4m: stored shapes had drifted; re-registered ${written.join(', ')}`);
      },
      // `registerDeclared` has already cleared both memo tiers, so the next call waits again.
      (error: unknown) => {
        if (rpcStatus(error) === 400) console.warn('ad4m: background shape registration refused', error);
        else console.error('ad4m: background shape registration failed', error);
      },
    );
    return [];
  }
  return sharedInFlight(p, `sdna:${memo.slot}:${memo.print}`, () => registerDeclared(p, declared, memo));
}

/** The registration itself: the marker read, the tuned-hints merge, the call, and the memo write. */
async function registerDeclared(p: PerspectiveProxy, declared: SHACLShape[], memo: Memo): Promise<string[]> {
  try {
    const marked = new Set(
      (await p.get(new LinkQuery({ predicate: HINTS_CUSTOMIZED_PREDICATE }))).map((link) => link.data.source),
    );
    let shapes = declared;
    if (marked.size > 0) {
      const stored = await p.shapes([
        ...new Set(declared.flatMap((shape) => (shape.targetClass ? [shape.targetClass] : []))),
      ]);
      const tuned = new Map(
        stored
          .filter((record) => marked.has(record.shape.nodeShapeUri) && record.shape.targetClass)
          .map((record) => [record.shape.targetClass!, record.shape]),
      );
      shapes = declared.map((shape) => {
        const storedShape = shape.targetClass ? tuned.get(shape.targetClass) : undefined;
        return storedShape ? withTunedHints(shape, storedShape) : shape;
      });
    }

    // The executor names each class it wrote by its target class IRI (two classes may share a name).
    // The port answers entity names: the name the class is registered under in WE, or, for a class not
    // registered yet (the registry fills when the backend's ports are made), the name of the class it
    // sent. An executor that answered names passes through as it is.
    const { written } = await p.registerShapes(shapes);
    sessionConfirm(p.uuid, memo);
    deviceWrite(p.uuid, memo.slot, memo.print);
    const sent = new Set(declared.map((shape) => shape.targetClass));
    return written.map((key) => {
      const name = entityNameOfClass(key, p);
      return name === key && sent.has(key) ? classNameOf(key) : name;
    });
  } catch (error) {
    forgetConfirmed(p.uuid, memo);
    throw error;
  }
}

/**
 * Whether a model's class is registered in the perspective, with a shape the executor can read. A
 * read; it writes nothing.
 *
 * Asked through `shapes()`, the same registry every model query resolves its class from, so "yes"
 * here means a query for the model can run.
 */
export async function isEntityRegistered(p: PerspectiveProxy, model: typeof Ad4mModel): Promise<boolean> {
  const targetClass = getEntityTargetClass(model);
  return targetClass ? (await storedShapeOf(p, targetClass)) !== null : false;
}

/** Register one model. See {@link registerModels}. */
export async function ensureEntityRegistered(p: PerspectiveProxy, model: typeof Ad4mModel): Promise<void> {
  await registerModels(p, [model]);
}

/**
 * Registers all root SDNA models on the given perspective. Safe to call on every boot: an unchanged
 * shape writes nothing, and a set this device already registered is confirmed rather than sent —
 * the memo in {@link registerModels} answers at once and re-checks in the background.
 */
export async function installRootSdna(p: PerspectiveProxy): Promise<void> {
  // Configuration only. Agent-scoped module entities install into the personal space, beside the
  // content they belong with — see `SYSTEM_DATASET_NAMES` in the app shell.
  await registerModels(p, [...ROOT_MODELS]);
}

/**
 * All SDNA models that belong to a WE space perspective.
 * Centralised here so both SpaceStore and AdamStore can reference the same
 * list without creating a circular dependency.
 */
export const SPACE_MODELS = [
  Space,
  // The shape *catalogue* — Shape records are how a space carries its own content models, so the
  // entity that holds them installs into every space alongside Space itself.
  Shape,
  // Connections members draw between records. A space model rather than a root one: a relationship
  // is a claim made *to* a community, argued with in its comments and weighted by its signals, and
  // one held privately would be a note to self wearing the shape of a shared statement.
  Relationship,
  // The kinds of connection this community makes — its own vocabulary, alongside SignalType, which
  // is the same idea for reactions.
  RelationshipType,
  /*
    And the subjects it talks about — the third member of that family, and it was missing.

    Declared in the manifest, generated as a class, exported, listed in the core manifest, rendered
    by a section of space settings, and never registered here — so `getEntity('Topic')` threw and
    every visit to Vocabulary raised "Model Topic is not available in this perspective". The section
    was complete and the model it queries did not exist as far as the renderer was concerned.

    A space model rather than a root one, for `RelationshipType`'s reason: what a community is about
    is a claim made *to* that community, and one held privately would be a note to self wearing the
    shape of a shared term.
  */
  Topic,
  // Where things sit on a board. Shared for the same reason: a board everyone sees arranged
  // differently is not a board, it is everyone's own sketch of one.
  Placement,
  // And how a board draws each kind of thing — the board's own vocabulary of colour, which is
  // shared for exactly the reason its arrangement is.
  TypeStyle,
  // Which record plays which part in this space — its canvas, say. Shared: a role is how every
  // member's template finds the same record, so one held privately would point each member at a
  // different canvas.
  SpaceLandmark,
  // How a board draws its connections. Shared with the arrangement it is part of: a line somebody
  // routed clear of the cards is tidying everyone can see, and a board where each member's
  // connectors take a different path is the same non-board as one where the cards move per member.
  EdgeRoute,
  /*
    That a call was read, and how it went.

    Shared, because the reading is the community's: a pass any member starts spends the node's
    budget and writes into everyone's space, so "this was read twice and failed once" is a fact
    about the call rather than about whoever happened to be watching. Private, it would answer
    differently for every member, and for most of them not at all.
  */
  ModelRun,
  /*
    A change a pass suggested to a record that already existed, and somebody kept.

    Shared for the same reason the pass is, and one step more so: an amendment is the record of a
    *decision*, and the decision was taken on everyone's behalf — the value it applied is in the
    space for every member to read, so the account of where that value came from has to be too.
    Private, a member would see the record change with no explanation that anybody else could see
    either.
  */
  Amendment,
  Template,
  Theme,
  WeNode,
  AudioBlock,
  CalloutBlock,
  CodeBlock,
  CollectionBlock,
  DividerBlock,
  EmbedBlock,
  EventBlock,
  FileBlock,
  ImageBlock,
  LinkBlock,
  LocationBlock,
  Signal,
  SignalType,
  TagBlock,
  TaskBlock,
  TaskState,
  TextBlock,
  VideoBlock,
  /*
    A person's part in a record, and the community's words for the kinds of part there are.

    Shared, both of them, for `Relationship`'s reason: "Sarah is reviewing this" is a claim made to
    the community, and an RSVP held privately would be a note to self about an event everyone else
    is planning around.
  */
  Involvement,
  InvolvementType,
  /*
    The standings people hold across the space, and who holds them. Shared: a moderator is a fact
    about the community, and a grant held privately would make nobody one.
  */
  Role,
  RoleGrant,
  /*
    The space's rules, a version per record. Shared, for the same reason: rules one member kept to
    themselves would govern nobody.
  */
  Policy,
] as const;

/**
 * Registers all space SDNA models on the given perspective, then the modules' models. Safe to call
 * on every join, and from many peers on one shared perspective: an unchanged shape writes nothing,
 * and a set this device already confirmed answers at once — see {@link registerModels}.
 */
export async function installSpaceSdna(p: PerspectiveProxy, moduleEntities: readonly unknown[] = []): Promise<void> {
  await registerModels(p, SPACE_MODELS);
  await installModuleSdna(p, moduleEntities);
}

/**
 * Install the shapes of every registered feature module into a perspective.
 *
 * Separate from `installSpaceSdna` because the two have different lifetimes. WE's own models are
 * installed once, when a space is created or first joined — after which `switchPerspective` skips
 * reinstalling them (it only installs into a perspective with *no* SDNA at all, so a foreign
 * perspective is never silently converted into a WE space).
 *
 * A module's shapes cannot follow that rule, because a module can be enabled **after** a space
 * already exists. So this runs on every switch into a WE space. Without it, enabling a module leaves
 * every existing space unable to query its entities: "No SHACL shape stored for class X", from a
 * perspective that looks healthy. The executor writes nothing for a shape it already holds — and
 * the memo in {@link registerModels} spares the switch even that call once this device has
 * confirmed the set, re-checking it in the background instead.
 *
 * **One `registerShapes` call per module**, and none shared with WE's own models. The executor
 * refuses a whole call — writing nothing from it — when one shape in it is refused: two shapes for
 * one target class, or a shape URI another class already holds. (A class whose name another app's
 * class has is not refused: the executor addresses each by its target class.) In one call, a single
 * module doing that would leave every module, and WE's models, unregistered. Each module is tried,
 * and when some were refused this rejects afterwards with {@link ModuleSchemasRefused} naming them;
 * the others are in. A class not compiled from a module manifest (one written by hand) counts as a
 * module of its own, under its class name.
 *
 * **Only a confirmed refusal counts as refused.** The executor answers a refused batch as a 400
 * (`WsRpcError::bad_request` wraps every error `register_shapes` returns). Anything else — the
 * marker read timing out, a lost registration response — is the install failing, not the schema
 * being refused: whether it wrote anything is unknown, and saying "refused, wrote nothing" would be
 * a claim nobody made. So a non-400 error propagates at once, and the handlers that log a
 * `ModuleSchemasRefused` and continue rethrow it instead.
 *
 * The models arrive as an argument rather than being read from the module registry. The registry is
 * the host's, and a backend adapter reaching up into it would be the one edge that inverts this
 * package's dependency direction — everything else here is imported *by* the shell, not from it.
 * The caller already holds the registry, so passing `moduleRegistry.models()` costs nothing.
 */
export async function installModuleSdna(p: PerspectiveProxy, moduleEntities: readonly unknown[] = []): Promise<void> {
  const byModule = new Map<string, (typeof Ad4mModel)[]>();
  for (const model of moduleEntities as (typeof Ad4mModel)[]) {
    const id = moduleOfModel(model) ?? model.name;
    byModule.set(id, [...(byModule.get(id) ?? []), model]);
  }
  const refused: { moduleId: string; reason: string }[] = [];
  for (const [moduleId, models] of byModule) {
    try {
      await registerModels(p, models);
    } catch (error) {
      // A 400 is the executor's answer to the batch itself — the only failure that is certainly a
      // refusal. The reads before it fail 500-or-worse, and an unanswered call is 408 or 503.
      if (rpcStatus(error) !== 400) throw error;
      refused.push({ moduleId, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  if (refused.length) throw new ModuleSchemasRefused(refused);
}

/**
 * Bring an existing WE space's stored core shapes up to date with the models this build declares.
 *
 * Needed because `installSpaceSdna` does not run on a space that already has WE's SDNA — that skip
 * is what stops a foreign dataset being silently converted into a WE space. Without this, a change
 * to WE's own models would reach newly created spaces only: a *property* added to a model would drop
 * its writes, and a *model* added outright would fail every query with "No SHACL shape stored for
 * class X".
 *
 * One `registerShapes` call when one is needed. The executor decides what changed and writes only
 * that; a space this device already confirmed costs no call at all — this answers `[]` at once and
 * the re-check runs in the background, its writes logged where they land (see {@link registerModels}).
 *
 * Returns the classes it wrote, for logging, by entity name (`registerModels` maps the target class
 * IRIs the executor answers with). An early `[]` means nothing this call sent — a background
 * re-check may still write, and names what it did.
 */
export async function refreshSpaceSdna(p: PerspectiveProxy): Promise<string[]> {
  return registerModels(p, SPACE_MODELS);
}
