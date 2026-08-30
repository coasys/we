import { buildGuestLink } from '@shared/guestLink';
import { containmentPredicate, gatherTranscriptTurns, type TurnRecord } from '@shared/interpretation/transcriptTurns';
import { resolveRecordRef } from '@shared/recordNavigation';
import { provideModuleHostServices } from '@shared/registries/moduleHostServices';
import { moduleRegistry, moduleStores, type ModuleSurface, moduleSurface } from '@shared/registries/moduleRegistry';
import { defaultViewOrder, viewRegistry } from '@shared/registries/viewRegistry';
import {
  isSpaceSelf,
  type LocationData,
  removeSpaceFromParent,
  spaceSelfWhere,
  syncSpaceToParent,
} from '@shared/spaceSync';
import { resolveSpaceTheme, type ThemeResolutionInput } from '@shared/themeResolution';
import { copyText, deriveSlug } from '@shared/utils';
import type { ViewSetting } from '@shared/viewResolution';
import {
  activeSections,
  parseIdList,
  preserveUnknownViews,
  resolveEnabledViews,
  routableSections,
  viewSettings,
} from '@shared/viewResolution';
import type { AgentProfileSummary, DatasetRef } from '@we/backend-shared';
import { displayName, trace } from '@we/backend-shared';
import type { ContentInput } from '@we/block-shared';
import {
  contentHash,
  createBlocks,
  decodeEditorState,
  deleteBlocks,
  isContentDocument,
  reconcileBlocks,
} from '@we/block-shared';
import { toastService } from '@we/components/solid';
import {
  AGENT_DEFAULT,
  CallExtraction,
  CollectionBlock,
  compressImageToFileData,
  type DatasetProxy,
  dataURIToFileData,
  type FileData,
  FOLLOW_SPACE,
  getEntitiesForPerspective,
  LocationBlock,
  MutedAgent,
  PREDICATES,
  ReadMarker,
  RelationshipType,
  Signal,
  SignalType,
  Space,
  SpacePreference,
} from '@we/entities';
import type { ResolvedView, TemplateSchema } from '@we/schema-shared';
import { hasViewsMarker } from '@we/schema-shared';
import {
  Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  ParentProps,
  untrack,
  useContext,
} from 'solid-js';

import { useAppStore } from './AppStore';
import { type AppDataset, canonicalSpaceId, useDatasetStore } from './DatasetStore';
import { useProfileStore } from './ProfileStore';
import { useRouteStore } from './RouteStore';
import { useSessionStore } from './SessionStore';
import { useShapeStore } from './ShapeStore';
import { useShellStore } from './ShellStore';
import { useTemplateStore } from './TemplateStore';
import { useThemeStore } from './ThemeStore';

/**
 * One row of the spaces list — every joined dataset the agent can act on, space or not.
 *
 * Built over datasets rather than over `mySpaces` because a dataset that is *not* yet a WE space
 * still belongs in the list: a community synced in from another app is a thing you have joined and
 * can act on (by initializing it), and the only place it was previously visible was a raw id in the
 * diagnostics list. A space you cannot see is a space you cannot leave.
 *
 * `kind` replaces what used to be three separate sections. Shared and personal differ by exactly one
 * field on the same model, which is a badge, not a heading — and splitting them gave the page two
 * "none yet" empty states for what is one list.
 */
export interface SpaceListEntry {
  /** The dataset id — stable whether or not a Space record exists, so it keys navigation and settings. */
  uuid: string;
  name: string;
  description: string;
  avatar: string;
  kind: 'shared' | 'personal' | 'foreign';
  /** False for a joined dataset with no WE Space record — the "initialize" state. */
  isWeSpace: boolean;
  /** Whether this agent may change what everyone here sees. See {@link SpaceStore.canAdministerSpace}. */
  canAdminister: boolean;
  /**
   * This space's module settings, carried on the row rather than fetched per space.
   *
   * A store read resolves a literal path, so a settings page rendered for one row of a list cannot ask
   * for `moduleSettingsFor(<that row's uuid>)` — the same constraint that made `launchModule` take
   * an id. Precomputing puts the answer where the row's context already reaches it.
   */
  modules: ModuleSetting[];
  /**
   * This space's sections, with both layers' answers — the community's and this agent's.
   *
   * On the row for the same reason `modules` is: a store read resolves a literal path, so a settings
   * page rendered per row cannot ask for the sections of "that row's space".
   */
  views: ViewSetting[];
  /**
   * Whether the interface this agent sees here has sections at all.
   *
   * False for a shell with a route table of its own and no `$views` marker — a showcase template,
   * say. The settings page reads it so it can explain rather than offer switches nothing reads.
   */
  usesSections: boolean;
  /** `'listed'` or `'hidden'` — whether this space appears on the global discovery globe. */
  discovery: string;
  /**
   * Where this space says it is, hydrated, or null.
   *
   * On the row rather than read from `currentSpace` because the settings page edits whichever space
   * was clicked. `loadSpaces` includes the relation for the same reason.
   */
  location: { latitude?: number; longitude?: number; city?: string; country?: string; countryCode?: string } | null;
  /** What the community set, so a picker can label the "follow the space" option with it. */
  defaultTemplateId: string;
  defaultThemeId: string;
  /** This agent's override: FOLLOW_SPACE, AGENT_DEFAULT, or a concrete id. Private to this agent. */
  templateOverride: string;
  themeOverride: string;
  /**
   * A link that gets someone else into this space, or `''` when there is nothing to share.
   *
   * Empty for a personal space: it has no global id, so no link could reach it. On the web this is
   * an ordinary URL someone can click; anywhere else it is the `neighbourhood://` URI, because a
   * desktop build has no origin worth putting in front of a path and no address bar to paste one
   * into. Both are accepted by `joinSpace`, so whichever a recipient has, it works.
   */
  shareLink: string;
  /**
   * A guest invite link that bypasses auth UI entirely.
   *
   * Empty when the session has no server URL (local executor — unreachable from outside) or when
   * the space has no shared id. The link encodes both the space and the host, so a guest clicking
   * it connects to the right node and joins the right space with no choices to make.
   */
  guestLink: string;
}

/**
 * Which modules a space has on, from its stored value.
 *
 * An unset field means "not decided", never "none" — see `Space.enabledModules`. Falling back to the
 * registered set is what stops this being a silent regression that strips every existing space of
 * its chrome. A malformed value is a corrupt setting, not a decision to disable everything.
 *
 * A plain function over the stored string rather than a memo over the current space, because the
 * settings page answers this for spaces the agent is not standing in.
 */
/**
 * What a space extracts before anybody decides — the two classes that were hardcoded until this
 * setting existed.
 *
 * A migration floor, not a default anybody chose. `Space.extractionTargets` follows the
 * `enabledModules` rule that empty means "not decided", and reading it as "none" would make every
 * space that predates the field silently stop extracting with nothing on screen to say why. The
 * first toggle writes the resolved list and the community owns it from then on.
 */
const LEGACY_EXTRACTION_TARGETS = ['TaskBlock', 'EventBlock'];

/** A JSON array of entity names as stored on `Space.extractionTargets` / `CallExtraction.entities`. */
function parseEntityList(raw: string | undefined): string[] | null {
  if (raw === undefined || raw === '') return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === 'string') : null;
  } catch {
    console.warn('extraction targets are not valid JSON; falling back');
    return null;
  }
}

function resolveEnabledModules(raw: string | undefined): string[] {
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string');
    } catch {
      console.warn('space.enabledModules is not valid JSON; falling back to the registered set');
    }
  }
  return moduleRegistry.all().map((entry) => entry.definition.id);
}

/**
 * Every registered module, with each layer's answer for one space — the shape a settings list renders.
 *
 * All three answers travel together because the settings page has to explain *why* a module is not
 * showing. "Enabled by the community but not installed by you" and "installed but the community has
 * it off" are different situations with different remedies, and a single boolean cannot tell them
 * apart — it would leave a toggle that is on next to a module that is not there.
 */
function moduleSettingsFrom(raw: string | undefined, installed: Set<string>, muted: Set<string>): ModuleSetting[] {
  const on = new Set(resolveEnabledModules(raw));
  return (
    moduleRegistry
      .all()
      // Chrome only. A contribution is gated where it renders, and chrome is the only surface that
      // renders inside a space — an app switcher is shell-level, and a capability is mounted by
      // whatever template asks for it. Neither is a community's decision. See `moduleSurface`.
      .filter(({ definition }) => moduleSurface(definition) === 'chrome')
      .map(({ definition }) => {
        const enabled = on.has(definition.id);
        const isInstalled = installed.has(definition.id);
        const isMuted = muted.has(definition.id);
        return {
          id: definition.id,
          name: definition.name,
          description: definition.description ?? '',
          icon: definition.icon ?? 'puzzle-piece',
          enabled,
          installed: isInstalled,
          visible: !isMuted,
          active: enabled && isInstalled && !isMuted,
        };
      })
  );
}

export interface ModuleSetting {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** The community's decision for this space — shared with every member. */
  enabled: boolean;
  /** This agent's decision, everywhere. */
  installed: boolean;
  /** This agent's decision, here. Private. Positively phrased so a switch binds to it directly. */
  visible: boolean;
  /** All of the above agreeing — whether it actually renders here for this agent. */
  active: boolean;
}

export interface SpaceMetaUpdate {
  name?: string;
  description?: string;
  discovery?: 'listed' | 'hidden';
  location?: LocationData | null;
}

/**
 * Where a composed artifact lands, for `createPost`.
 *
 * Flat scalars rather than a nested `anchor` object because these come from a template: a schema
 * writes `args` as JSON, and `parentId` reading `"$channel.id"` is a plain context substitution
 * where a nested object would need the author to know the resolver descends into it.
 */
export interface CreatePostOptions {
  /** Free label for what this is. Defaults to `'post'`. */
  kind?: string;
  /** Id of the node to attach to. Omit for a post, which sits in the space unattached. */
  parentId?: string;
  /**
   * How it attaches. Defaults to `we://children` — containment, which is what a channel message
   * wants. Pass `we://comment` for a reply, which hangs off a node rather than sitting inside it.
   */
  predicate?: string;
}

export interface FluxSubgroupMessage {
  id: string;
  author: string;
  timestamp: string;
  body: string;
}

// Space.avatar/coverImage are typed as string (resolved data URI on read) but accept FileData on write.
// This input type reflects the actual write-path contract.
type SpaceInput = Omit<Partial<Space>, 'avatar' | 'coverImage'> & {
  avatar?: FileData | string;
  coverImage?: FileData | string;
};

/**
 * The three forms a space can be handed to {@link SpaceStore.joinSpace} in, reduced to the one they
 * share.
 *
 * A share link is an ordinary URL on the web, the backend's own URI everywhere else (see
 * `SpaceListEntry.shareLink`), and what a join gate reads off the route is the bare id sitting
 * inside both. Nothing can ask "is this the space I am already joining?" — or "is this the space
 * that just arrived?" — until they collapse to one value, because comparing the raw strings makes a
 * link and the id inside it two different spaces.
 *
 * Scheme-agnostic on purpose: `neighbourhood://` is AD4M's spelling, and this store is not supposed
 * to know that. Any `<scheme>://` prefix that is not the web's own is the backend's, and the id is
 * what follows it.
 */
function sharedIdOf(input: string): string {
  const raw = input.trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) {
    const scheme = raw.indexOf('://');
    return scheme === -1 ? raw : raw.slice(scheme + 3);
  }
  try {
    const segments = new URL(raw).pathname.split('/').filter(Boolean);
    const marker = segments.indexOf('space');
    return (marker === -1 ? segments[segments.length - 1] : segments[marker + 1]) ?? '';
  } catch {
    return raw;
  }
}

/**
 * What to hand the backend, given what the caller had.
 *
 * Everything but a web URL passes through untouched — the adapter already accepts its own URI or a
 * bare id, and normalizing further would only invent a form it has to undo. A web link is the one
 * shape no backend can read, so it is unwrapped here, where the fact that WE serves spaces at
 * `/space/<id>` is already known.
 */
const joinTargetOf = (input: string): string => (/^https?:\/\//i.test(input.trim()) ? sharedIdOf(input) : input.trim());

/** Does this dataset answer to the id a caller asked to join, in whichever form they had it? */
function datasetAnswersTo(ds: { id: string; sharedId?: string; sharedUri?: string }, input: string): boolean {
  const target = input.trim();
  const id = sharedIdOf(target);
  return ds.id === target || ds.id === id || ds.sharedId === id || ds.sharedUri === target;
}

/**
 * How long a join keeps looking for a dataset after the call to make it has already failed.
 *
 * Joining is a long-running backend operation wearing a request/response call's clothes: the
 * executor has to fetch the neighbourhood expression and install its link language before the
 * dataset exists at all, and only creates it at the very end. The transport gives up well before
 * that on a first join — AD4M's client applies one flat 30s timeout to every call it makes — and
 * the resulting 408 says nothing whatsoever about whether the join is still running. It usually is.
 *
 * So a failed call is not a failed join, and the honest response to one is to keep watching for a
 * while. Five minutes is past the point where a join that is going to work has worked, and the
 * backoff keeps a remote host from being asked a hundred times to find out.
 */
const JOIN_RECOVERY_WINDOW_MS = 5 * 60_000;
const JOIN_RECOVERY_FIRST_POLL_MS = 2_000;
const JOIN_RECOVERY_MAX_POLL_MS = 15_000;

/** When a join stops looking instant, so the UI can say so instead of spinning in silence. */
const JOIN_SLOW_AFTER_MS = 8_000;

/**
 * Did the *call* give up, or did the backend answer?
 *
 * Only the first is worth waiting out. A timeout or a dropped socket says nothing about whether the
 * join is still running, so the question is simply unanswered and worth asking again. Anything else
 * is the backend having looked and told us: a URL that resolves to no space does not become one by
 * being asked about for another five minutes, and treating the two alike would leave someone who
 * pasted a bad link watching a spinner until the recovery window ran out.
 */
function transportGaveUp(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error);
  return /timed out|timeout|\b408\b|\b503\b|websocket|network error|failed to fetch|fetch failed/i.test(raw);
}

/**
 * What to tell someone whose join did not work.
 *
 * The two cases stay separate even here, past the end of the recovery window: a join that outlasted
 * the window may still be running (it is a budget, not a guarantee), which makes "try again" better
 * advice than it sounds — a second attempt is cheap once the dataset exists, because the backend
 * hands back the one it already made rather than making another.
 */
const joinErrorMessage = (error: unknown): string =>
  transportGaveUp(error)
    ? 'This is taking longer than expected. The space may still be joining in the background — try again in a minute.'
    : "Couldn't join this space. Check the link and try again.";

export interface SpaceStore {
  // State
  memberDids: Accessor<string[]>;
  members: Accessor<AgentProfileSummary[]>;
  spaceDefaultTemplateId: Accessor<string>;
  spaceDefaultThemeId: Accessor<string>;
  currentSpace: Accessor<Space | null>;
  /** All Space models the agent holds, across every joined dataset. */
  mySpaces: Accessor<Space[]>;
  personalSpaces: Accessor<Space[]>;
  sharedSpaces: Accessor<Space[]>;
  /** Every joined dataset the agent can act on, space or not — the spaces list. See {@link SpaceListEntry}. */
  spaceList: Accessor<SpaceListEntry[]>;
  /**
   * The route points at a space the agent has not joined — settled, not merely unresolved.
   *
   * What a join gate should read. `currentDataset` being null is also true for the first frames of
   * a refresh, so gating on that flashes "Join this Space" at someone already inside.
   */
  routeSpaceUnjoined: Accessor<boolean>;
  /** `/space/<segment>` for the space on screen, or empty outside one. */
  spacePath: Accessor<string>;
  creatingSpace: Accessor<boolean>;
  /**
   * The space a join is running for right now — its shared id — or `''` when none is.
   *
   * The id rather than a boolean, so a list of spaces can put the spinner on the row being joined
   * instead of on all of them. A gate, which only ever concerns one space, compares it against its
   * own route segment.
   */
  joiningSpace: Accessor<string>;
  /** That join has outlasted {@link JOIN_SLOW_AFTER_MS} and is still going — say so rather than spin. */
  joinSlow: Accessor<boolean>;
  /**
   * The last join failure — which space it was about, and what to say — or null.
   *
   * Carries the space rather than just the message so a gate can tell whether the failure is *its*
   * failure. A bare message follows the user to the next unjoined space they open and reports a
   * problem there that happened somewhere else.
   */
  joinError: Accessor<{ spaceId: string; message: string } | null>;
  /** Sidebar entries in user-defined order — datasets decorated with Space name/avatar when
   * available, plus a virtual pre-join entry for the configured global space. */
  orderedSidebarItems: Accessor<
    { uuid: string; name: string; avatar?: string; spaceId: string; isGlobalPreJoin?: boolean }[]
  >;
  /** Name/description/avatar detected from a foreign app's own model (e.g. Flux's Community),
   * for prefilling the "Initialize as WE space" gate. Null once the dataset is a WE space,
   * or if no recognized foreign model is found. */
  foreignSpacePrefill: Accessor<{ name: string; description: string; avatar: string | null } | null>;
  /** Feature modules this *space* has turned on — the community's decision, shared with every
   *  member. Falls back to everything the seed activated when the space has never decided, so
   *  spaces that predate the setting keep the chrome they had. */
  enabledModules: Accessor<string[]>;
  /** Options for the per-space template override picker, including a "follow the space" entry. */
  templateOverrideOptions: Accessor<{ label: string; value: string }[]>;
  /** Options for the per-space theme override picker, including a "follow the space" entry. */
  themeOverrideOptions: Accessor<{ label: string; value: string }[]>;
  /**
   * Has this agent pinned a theme for the space on screen that diverges from what would otherwise
   * apply — is there anything for a "reset" to undo? False outside a space.
   */
  spaceThemePinned: Accessor<boolean>;
  /** Feature modules this *agent* wants available anywhere. Personal; see AgentSettings.installedModules. */
  installedModules: Accessor<string[]>;
  /** Module ids the template on screen mounts components from — derived from the schema, not declared. */
  requiredModules: Accessor<string[]>;
  /** Of those, the ones this agent has not installed. Empty in the ordinary case. */
  missingModules: Accessor<string[]>;
  /** What actually renders here for this agent: registered ∩ installed ∩ enabled, less personal mutes. */
  activeModules: Accessor<string[]>;
  /** Every registered module and whether this agent wants it available anywhere — the global list. */
  /**
   * Every registered module and whether this agent wants it available anywhere — the global list.
   *
   * Includes capability-only modules, flagged `switchable: false`: they are part of what the agent
   * has, but not yet something to decide about. See `moduleSurface`.
   */
  moduleInstallSettings: Accessor<
    {
      id: string;
      name: string;
      description: string;
      icon: string;
      installed: boolean;
      surface: ModuleSurface;
      switchable: boolean;
    }[]
  >;
  /** Launchers for the modules enabled here — what the module rail renders. */
  moduleLaunchers: Accessor<{ id: string; icon: string; label: string; active: boolean }[]>;
  /**
   * This space's sections, resolved: which view renders at which segment, in the space's own order.
   *
   * Carries the view schemas, because the host builds the route tree out of them. What a template
   * renders a nav strip from is `viewNav`, which is this without the payload.
   */
  spaceViews: Accessor<ResolvedView[]>;
  /**
   * Every view that *could* render here, at its permanent segment — what the host builds routes from.
   *
   * Separate from {@link spaceViews} because the two change on completely different clocks: this one
   * when a view is installed, that one whenever somebody flicks a switch. Building the route table
   * from the switch was what made toggling a section rebuild the whole application.
   */
  routableViews: Accessor<ResolvedView[]>;
  /**
   * Ids of the sections the community has in this space — what a route body is gated on.
   *
   * Not the nav list: that also drops this agent's hidden ones, and hiding a section for yourself
   * must not make its URL refuse you. See `ViewGate`.
   */
  enabledViewIds: Accessor<string[]>;
  /** The same list as a nav strip reads it — one source, so routes and nav cannot disagree. */
  viewNav: Accessor<{ id: string; segment: string; label: string; icon: string; path: string }[]>;

  // Actions
  createSpace: (
    name: string,
    description: string,
    access: 'personal' | 'shared',
    discovery: 'hidden' | 'listed',
    avatarFile?: File,
    coverImageFile?: File,
    location?: LocationData | null,
  ) => Promise<void>;
  /**
   * Join a shared dataset. `focus` defaults to true; pass false to join without navigating to it.
   *
   * Rejects when the join could not be completed, so a caller's `onSuccess` means what it says.
   */
  joinSpace: (id: string, focus?: boolean) => Promise<void>;
  initializeAsWeSpace: (name: string, description: string, avatarValue?: File | string | null) => Promise<Space>;
  /** Remove a space: clears its global-discovery listing (when authored by this agent) and
   * removes the backing dataset. */
  removeSpace: (uuid: string) => Promise<void>;
  /**
   * Create a composed artifact from editor state — a post, a channel message, a reply.
   *
   * One action for all three because they differ only in `kind` and where they attach; the
   * composer, the blob, the search index and the mention edges are identical. See
   * {@link CreatePostOptions}. Keeps its name because a post is the default and renaming it would
   * churn every existing template for no gain.
   */
  /**
   * Create a composed artifact, and return its id.
   *
   * The id is what makes "and then do something with it" possible from a schema — placing a new card
   * where somebody double-clicked, scrolling to it, selecting it — since `$action`'s `onSuccess`
   * reads the resolved value as `$result`. `createBlocks` has always returned the model; this simply
   * stopped throwing the id away.
   */
  createPost: (json: unknown, options?: CreatePostOptions) => Promise<string | undefined>;
  updatePost: (postId: string, json: unknown) => Promise<void>;
  /**
   * Move a child between two collections — a card between kanban columns. A relink of the two
   * `we://children` edges; the child itself is untouched.
   */
  moveChild: (childId: string, fromId: string, toId: string) => Promise<void>;
  /**
   * Join or leave a node's participant roster — an RSVP. Writes only this agent's own entry, which
   * is what keeps the roster conflict-free without coordination.
   */
  setAttending: (nodeId: string, attending: boolean) => Promise<void>;
  /**
   * DIDs this agent has muted, everywhere. Private, held in the root dataset.
   *
   * A feed filters on this before rendering — `{ $: '!(post.author in spaceStore.mutedDids)' }`. Hiding on
   * this agent's screen only: an AD4M neighbourhood is writable by every member, so nothing here
   * removes anything for anyone else.
   */
  mutedDids: Accessor<string[]>;
  /** Full mute records, for a settings list that wants the note as well as the DID. */
  mutedAgents: Accessor<MutedAgent[]>;
  /** Mute or unmute an agent. Positively phrased so a switch can pass `$event.detail` bare. */
  setAgentMuted: (did: string, muted: boolean, description?: string) => Promise<void>;
  /**
   * When this agent last read each node, as `{ nodeId, lastReadAt }` rows.
   *
   * An unread indicator is "latest child newer than this" — the seen-half of the standing-query
   * pattern notifications will generalise. No row means never read, so everything is unread.
   *
   * Read it with `find()` on `nodeId`; a keyed map would not be indexable by a row.
   */
  readMarkers: Accessor<{ nodeId: string; lastReadAt: string }[]>;
  /** Mark a node read as of now. Silent on failure — a lost marker is a stale dot, not an error. */
  markRead: (nodeId: string, spaceUuid?: string) => Promise<void>;
  /**
   * Which containers in this space hold something newer than this agent's marker for them.
   *
   * The read side of `ReadMarker`, which every template that lists channels, boards or topics was
   * recomputing inline — a `$latestChild` projection, a `find()` over the markers and a comparison on two
   * ISO strings, repeated in each one. Written once here it is a `$in` in the template, and the
   * comparison rule (lexicographic order is chronological, and *no marker* means unread rather than
   * read) lives in one place instead of being restated correctly-or-not per template.
   *
   * Ids of unread containers rather than counts: a count needs every child's timestamp, which is a
   * second query per container, and no template has yet wanted the number rather than the dot.
   */
  unreadNodeIds: Accessor<string[]>;
  /**
   * Nodes in this space that name this agent — the read side of `WeNode.mentions`.
   *
   * Mentions have been *written* since the composer learned to parse them, and never read: the
   * model's own docstring says the edge exists precisely so that "posts mentioning me" can be a
   * query, and no query existed. This is that query.
   *
   * Filtered here rather than pushed down, and that is a real limit worth naming: matching on the
   * contents of a to-many relation is a relation filter, which both adapters declare they cannot do
   * (`AdapterCapabilities.relationFilters`). So this reads the space's nodes and filters them, which
   * is fine for a space and wrong for an inbox spanning many. Pushdown is the fix, not pagination.
   */
  /** `createdAt` is the backend's comparable timestamp (epoch millis in the AD4M lane). */
  myMentions: Accessor<{ id: string; author: string; createdAt: number }[]>;
  /**
   * Put a file somewhere the space can reference, and return the URL that points at it.
   *
   * The generic form of what the profile and space-image paths do privately. Without it a template
   * doing its own media UI — a camera-first photo template, a file drop zone — had no way to get a
   * file into the space at all: the composer could, and nothing else, so any layout that was not the
   * block composer simply could not accept an upload.
   */
  uploadFile: (file: File, name?: string) => Promise<string | null>;
  /**
   * Delete a `CollectionBlock` and everything inside it, recursively.
   *
   * Named for the collection rather than the post because the operation never knew the difference:
   * it is `deleteBlocks` on a root id, and a call record, a notes collection and a post are the same
   * shape. It was `deletePost`, which meant a second surface wanting this had to either call an
   * action named for somebody else's noun or duplicate it.
   */
  deleteCollection: (collectionId: string) => Promise<void>;
  /** Every space-scoped write takes an optional target uuid; omitted means the space on screen. */
  updateSpaceImage: (field: 'avatar' | 'coverImage', imageFile: File, spaceUuid?: string) => Promise<void>;
  updateSpaceMeta: (updates: SpaceMetaUpdate, spaceUuid?: string) => Promise<void>;
  setSpaceDefaultTemplate: (templateId: string, spaceUuid?: string) => Promise<void>;
  setSpaceDefaultTheme: (themeId: string, spaceUuid?: string) => Promise<void>;
  setModuleEnabled: (moduleId: string, enabled: boolean, spaceUuid?: string) => Promise<void>;
  /** Whether this space has calls interpreted as they happen. A community decision; defaults off. */
  autoInterpret: Accessor<boolean>;
  setAutoInterpret: (enabled: boolean, spaceUuid?: string) => Promise<void>;
  /**
   * Whether extraction passes in this space broadcast their prompt and response to every member.
   *
   * A community decision rather than a personal one: "I share and you do not" is an asymmetry with
   * no use, and the reason to turn it on — this space is working on extraction and wants to see
   * what it is doing — is about the space. Defaults off; see the model for why.
   */
  shareExtractionDetail: Accessor<boolean>;
  setShareExtractionDetail: (enabled: boolean, spaceUuid?: string) => Promise<void>;
  /**
   * Which models this community's calls start out extracting.
   *
   * The middle of three layers: the codebase says what is a *candidate*
   * (`shapeStore.extractionCandidates`), this says which of them a call here begins with, and a
   * call's participants may add or remove for themselves. Always intersected with the candidates,
   * so a model since deleted cannot reach a pass and fail it.
   *
   * A community decision, readable by every member; writing it is space-settings. Unset falls back
   * to the two classes that were hardcoded before the setting existed, so nothing regresses.
   */
  extractionTargets: Accessor<string[]>;
  setExtractionTarget: (entity: string, on: boolean, spaceUuid?: string) => Promise<void>;
  /** Turn a module on or off for this agent everywhere. */
  setModuleInstalled: (moduleId: string, installed: boolean) => Promise<void>;
  /** Show or hide a module for this agent in one space. Private to this agent. */
  setModuleVisible: (moduleId: string, visible: boolean, spaceUuid?: string) => Promise<void>;
  /** Add or remove a section from a space. The community's decision — every member sees it. */
  setViewEnabled: (viewId: string, enabled: boolean, spaceUuid?: string) => Promise<void>;
  /** Set the whole section order at once — what a drag-reorder writes. */
  reorderViews: (viewIds: string[], spaceUuid?: string) => Promise<void>;
  /** Show or hide a section for this agent in one space. Private to this agent. */
  setViewVisible: (viewId: string, visible: boolean, spaceUuid?: string) => Promise<void>;
  /** Override the template this agent sees in one space; FOLLOW_SPACE follows its default. Private. */
  setSpaceTemplateOverride: (templateId: string, spaceUuid?: string) => Promise<void>;
  /** Override the theme this agent sees in one space; FOLLOW_SPACE follows its default. Private. */
  setSpaceThemeOverride: (themeId: string, spaceUuid?: string) => Promise<void>;
  /**
   * Apply a theme where the agent is: pinned to the space on screen, or their global default when
   * there is no space. What the rail's theme picker calls.
   */
  applyTheme: (themeId: string) => Promise<void>;
  /** Drop the theme pin for the space on screen, returning it to whatever would otherwise apply. */
  clearSpaceThemePin: () => Promise<void>;
  launchModule: (moduleId: string) => void;
  createSignalType: (config: Partial<SignalType>) => Promise<void>;
  /**
   * Name a kind of connection this community makes — "contradicts", "came out of".
   *
   * The counterpart to `createSignalType`, and the middle tier between a free-text label and a
   * relation declared on a model. A record rather than a schema change, so any member can propose
   * the vocabulary; identified, so a query can filter on it and an edge style can key on it.
   */
  createRelationshipType: (config: Partial<RelationshipType>) => Promise<void>;
  /** Withdraw a signal type from use, or bring it back. Never removes the signals given with it. */
  setSignalTypeRetired: (signalTypeId: string, retired: boolean) => Promise<void>;
  upsertSignal: (nodeId: string, signalTypeId: string, value: number) => Promise<void>;
  navigateToSpace: (spaceId: string, view?: string) => Promise<void>;
  openRecordRef: (ref: string) => Promise<void>;
  /** Whether this agent may change what every member of that space sees. */
  canAdministerSpace: (uuid: string) => boolean;
  /** The same, about the space on screen, as something an expression can read. */
  canAdministerCurrentSpace: Accessor<boolean>;
  /** Copy a space's share link to the clipboard. No-op for a space that has none. */
  copyShareLink: (uuid: string) => Promise<void>;
  /** Copy a guest invite link — auto-creates account, auto-joins the space. No-op without a host. */
  copyGuestLink: (uuid: string) => Promise<void>;
  getSubgroupMessages: (subgroupId: string) => Promise<FluxSubgroupMessage[]>;
  /**
   * Write a call's transcript to a `.txt` file and download it.
   *
   * One line per utterance: `name, ISO timestamp: text`, where the name is the speaker's display
   * name and their DID when they have none. Read-only and client-side — it builds the blob and
   * triggers a download rather than writing anywhere the space can see, which is why it is an
   * imperative action instead of something a template can express.
   */
  exportCallTranscript: (callId: string) => Promise<void>;
  removeSpaceFromGlobal: (spaceUuid: string) => Promise<void>;
  updateSpaceInCache: (dataset: AppDataset, updates: Partial<Space>) => void;

  // Boot wiring (used by the boot controller, not by schemas)
  loadSpaces: () => Promise<void>;

  // Testing
}

const SpaceContext = createContext<SpaceStore>();

/**
 * Longest edge of a space avatar, in px. The counterpart to `PROFILE_AVATAR_PX` in ProfileStore,
 * for the same reason: `compressImageToFileData` scales to a proportion of the original, which is
 * no bound at all, and a space avatar renders in the sidebar and headers at a few dozen pixels.
 *
 * Cover images are deliberately left uncapped — they render full-bleed, so a ceiling sized for an
 * avatar would visibly soften them.
 */
const SPACE_AVATAR_PX = 512;

export function SpaceStoreProvider(props: ParentProps) {
  const session = useSessionStore();
  const datasetStore = useDatasetStore();
  const shapeStore = useShapeStore();
  const profileStore = useProfileStore();
  const routeStore = useRouteStore();
  const templateStore = useTemplateStore();
  const appStore = useAppStore();
  const themeStore = useThemeStore();
  const shellStore = useShellStore();

  const [mySpaces, setMySpaces] = createSignal<Space[]>([]);
  const [creatingSpace, setCreatingSpace] = createSignal(false);

  const [joiningSpace, setJoiningSpace] = createSignal('');
  const [joinSlow, setJoinSlow] = createSignal(false);
  const [joinError, setJoinError] = createSignal<{ spaceId: string; message: string } | null>(null);

  /**
   * Joins running right now, keyed by shared id.
   *
   * Two clicks on the same space must not become two joins. The backend deduplicates by looking for
   * a dataset it has already made for that address — which is no help at all while the first join is
   * still *making* one, the window where a second attempt is most likely: it is exactly when the
   * first is slow enough to look stuck. Two joins racing that far apart fork the address into two
   * datasets, and nothing afterwards can tell which one the space is in.
   */
  const joinsInFlight = new Map<string, Promise<void>>();

  // Derived: personal and shared spaces.
  //
  // Shared-ness is read from `url` — the space's global (shared) id, set when its dataset is
  // published — not from the stored `Space.access` field, which records the same fact a second
  // time and can only ever agree or be wrong. `url` is also the fact every backend has, however
  // it implements sharing (a neighbourhood, a published branch, an `is_public` row).
  const personalSpaces = createMemo(() => mySpaces().filter((s) => !s.url));
  const sharedSpaces = createMemo(() => mySpaces().filter((s) => !!s.url));

  /**
   * Whether this agent may change what every member of a space sees.
   *
   * **A UI affordance, not enforcement.** A shared space is a neighbourhood every member can write
   * links to; nothing stops another member's client writing `we://name`. This decides whether to
   * *offer* the controls, which is worth doing — an owner should see what is theirs to manage — but
   * it must never be described to the user as protection.
   *
   * A predicate rather than an inline `author === me` in each template, because creator-only is
   * today's answer and not the last one: multiple admins, roles, or an SDNA-level constraint all
   * change what "may administer" means. Templates asking the question by name keep working; templates
   * that had compared two DIDs would all need editing.
   */
  /**
   * The same question about the space on screen, as a value a schema can read.
   *
   * `canAdministerSpace` is an action, and an expression cannot call one — so every template that
   * wanted to gate a control on "may I change what everyone here sees?" wrote
   * `x.author == me.did` instead. That is a *different* question: it asks who made the row, not who
   * runs the space, and it is why a template installed into a space by one member could not be
   * removed by anybody else, the space's own author included. Asked here, the answer can grow
   * (several admins, roles) without every template being rewritten.
   */
  // A plain accessor rather than a memo: it reads its signals when called, so it is reactive either
  // way — and a memo here runs eagerly at creation, before `currentSpace` further down the file
  // exists. Cheap enough that memoising buys nothing.
  const canAdministerCurrentSpace = (): boolean => {
    const uuid = currentSpace()?.uuid;
    return uuid ? canAdministerSpace(uuid) : false;
  };

  function canAdministerSpace(uuid: string): boolean {
    const space = mySpaces().find((s) => s.uuid === uuid);
    if (!space) return false;
    // A personal space has no one else to answer to.
    if (!space.url) return true;
    const me = session.me()?.did;
    return Boolean(me && space.author === me);
  }

  /**
   * The middle layer: which modules this agent wants available to them at all, anywhere.
   *
   * Read from the root dataset, so it is personal — turning one off here changes nothing another
   * member sees. Unset means "not decided" and falls back to everything registered, so an agent who
   * never opens the setting keeps what they had.
   */
  const installedModules = createMemo<string[]>(() =>
    resolveEnabledModules(datasetStore.agentSettings()?.installedModules),
  );

  /** This agent's personal choices per space, from the root dataset. See `SpacePreference`. */
  const [spacePreferences, setSpacePreferences] = createSignal<SpacePreference[]>([]);
  const [readMarkers, setReadMarkers] = createSignal<ReadMarker[]>([]);
  const [mutedAgents, setMutedAgents] = createSignal<MutedAgent[]>([]);

  const preferenceFor = (spaceUuid: string | undefined): SpacePreference | undefined =>
    spaceUuid ? spacePreferences().find((p) => p.spaceUuid === spaceUuid) : undefined;

  const mutedModulesFor = (spaceUuid: string | undefined): string[] => {
    const raw = preferenceFor(spaceUuid)?.mutedModules;
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  };

  /**
   * Sections this agent has hidden in one space — the private half of the section list.
   *
   * Exclusions, like `mutedModulesFor`: a section the community adds later shows up, because silence
   * about a view is "no opinion" rather than "no".
   */
  const hiddenViewsFor = (spaceUuid: string | undefined): string[] =>
    parseIdList(preferenceFor(spaceUuid)?.hiddenViews);

  /**
   * This agent's template/theme override for a space, normalised to one of the three values a
   * picker offers.
   *
   * Anything falsy becomes {@link FOLLOW_SPACE} here rather than at each call site: a record written
   * before these fields existed has no value, and the picker still needs a matching option to select
   * — bound to `''`, it would show blank and could never be set back.
   */
  const templateOverrideFor = (spaceUuid: string | undefined): string =>
    preferenceFor(spaceUuid)?.templateId || FOLLOW_SPACE;
  const themeOverrideFor = (spaceUuid: string | undefined): string => preferenceFor(spaceUuid)?.themeId || FOLLOW_SPACE;

  /**
   * The link that reaches a space from outside — see {@link SpaceListEntry.shareLink}.
   *
   * Built from the dataset's own `sharedId`/`sharedUri` rather than from `Space.url`, so it is right
   * for a joined-but-foreign dataset too, and needs no Space record to exist.
   */
  const shareLinkFor = (ds: AppDataset): string => {
    if (!ds.sharedId) return '';
    const onWeb = typeof window !== 'undefined' && window.location.protocol.startsWith('http');
    return onWeb ? `${window.location.origin}/space/${ds.sharedId}` : (ds.sharedUri ?? ds.sharedId);
  };

  /**
   * A guest invite link: `/join/<sharedId>?host=<serverUrl>`.
   *
   * The rule itself is `buildGuestLink`, which the web entry point's parser is the inverse of — a
   * link this app offers has to be one this app would accept. Both halves have to be reachable by
   * whoever *receives* it, which is more than "has a server URL": `session.serverUrl()` is set from
   * the connection for every connector, a local executor included, so the earlier check let a
   * desktop-shaped deployment publish `http://localhost:12000` as an invitation.
   */
  const guestLinkFor = (ds: AppDataset): string => {
    const onWeb = typeof window !== 'undefined' && window.location.protocol.startsWith('http');
    if (!onWeb) return '';
    return buildGuestLink({ origin: window.location.origin, serverUrl: session.serverUrl(), sharedId: ds.sharedId });
  };

  /** The Space model behind a dataset id, for resolving what an override falls back to. */
  const spaceForUuid = (uuid: string): Space | undefined => {
    const ds = datasetStore.datasets().find((d) => d.id === uuid);
    return ds ? mySpaces().find((s) => isSpaceSelf(s, ds)) : undefined;
  };

  /**
   * Option lists for the per-space override pickers, with "follow the space" as a real entry.
   *
   * Built here rather than in the schema because the leading entry cannot be expressed there — the
   * schema can `$map` a store array into options, but has no way to prepend one. And it has to
   * exist: without it, overriding is one-way, since a picker offering only concrete templates gives
   * someone no way back to the space's own choice.
   *
   * `createMemo` runs its body immediately, so everything these read must already be declared above
   * them — a `const` referenced from an eagerly-run memo is a TDZ crash at provider construction,
   * not a lazy failure later.
   */

  /** Name the thing an option resolves to, so "the space's default" is not a guess. */
  const withResolved = (label: string, name: string | undefined) => (name ? `${label} (${name})` : label);

  const templateOverrideOptions = createMemo(() => {
    const byId = (id: string) => templateStore.allTemplates().find((t) => t.id === id)?.meta?.name;
    const spaceDefault = spaceForUuid(datasetStore.currentDataset()?.id ?? '')?.defaultTemplateId;
    return [
      { label: withResolved("Use the space's default", byId(spaceDefault ?? '')), value: FOLLOW_SPACE },
      { label: withResolved('Use my default', byId(templateStore.defaultTemplateId())), value: AGENT_DEFAULT },
      ...templateStore.allTemplates().map((t) => ({ label: t.meta?.name || t.id || '', value: t.id || '' })),
    ];
  });

  const themeOverrideOptions = createMemo(() => {
    const byId = (id: string) => themeStore.allThemes().find((t) => t.id === id)?.name;
    const spaceDefault = spaceForUuid(datasetStore.currentDataset()?.id ?? '')?.defaultThemeId;
    return [
      { label: withResolved("Use the space's default", byId(spaceDefault ?? '')), value: FOLLOW_SPACE },
      { label: withResolved('Use my default', byId(themeStore.defaultThemeId())), value: AGENT_DEFAULT },
      ...themeStore.allThemes().map((t) => ({ label: t.name || t.id, value: t.id })),
    ];
  });

  /**
   * Every view this agent could put in a space: the ones compiled in, plus the ones installed.
   *
   * A view installed at runtime is an ordinary `Template` record whose `meta.role` is `'view'` —
   * the same record a shell is stored as, which is what lets one marketplace, one install flow and
   * one publish path serve both. The registry is consulted first so a built-in id keeps meaning the
   * built-in view even if somebody installs a template sharing its id.
   */
  const availableViews = createMemo<Map<string, TemplateSchema>>(() => {
    const out = new Map<string, TemplateSchema>(Object.entries(viewRegistry));
    for (const template of templateStore.allTemplates()) {
      if (template.meta?.role !== 'view' || !template.id) continue;
      /*
        A saved view sharing a built-in's id is refused *audibly*.

        The registry wins, and that is right — a stranger's template must not be able to replace
        "About" by naming itself `about`. What was wrong is that it won in silence: the view was
        installed, appeared in nobody's list, rendered nowhere, and the only symptom was a section
        that did not exist. Every shell in the world says something when a name is taken.

        Warned rather than surfaced as a toast, because this is not an act anybody is watching: the
        collision is discovered while resolving a space's views, which happens on entry and on every
        template load, so a toast would fire repeatedly and at no useful moment. The install flow is
        where a person could act on it.
      */
      if (out.has(template.id)) {
        if (Object.prototype.hasOwnProperty.call(viewRegistry, template.id)) {
          console.warn(
            `view "${template.id}" shares its id with a built-in section and will not be used. Rename it to install it.`,
          );
        }
        continue;
      }
      out.set(template.id, template);
    }
    return out;
  });

  /**
   * Every available view with both layers' answers, for one space — what a settings list renders.
   *
   * Both answers travel together for the reason `moduleSettingsFrom` explains: "the community
   * turned this off" and "you hid this for yourself" are different situations with different
   * remedies, and one boolean cannot tell them apart.
   */
  const viewSettingsFor = (spaceUuid: string | undefined, raw: string | undefined): ViewSetting[] =>
    viewSettings({
      enabledRaw: raw,
      hidden: hiddenViewsFor(spaceUuid),
      available: availableViews(),
      fallbackOrder: defaultViewOrder(),
      isBuiltIn: (id) => id in viewRegistry,
    });

  /**
   * Turn a stored override into the id that actually applies.
   *
   * `''` defers to the community's choice; {@link AGENT_DEFAULT} defers to this agent's global one,
   * read live so it tracks a later change rather than freezing today's answer.
   */
  const resolveTemplateFor = (uuid: string): string => {
    const override = templateOverrideFor(uuid);
    if (override === AGENT_DEFAULT) return templateStore.defaultTemplateId();
    if (override === FOLLOW_SPACE) return spaceForUuid(uuid)?.defaultTemplateId || '';
    return override;
  };

  /**
   * Does the interface this agent would see in that space have sections at all?
   *
   * Not every shell does. The showcase templates have route tables of their own and no `$views`
   * marker anywhere in them — a Discord-shaped space has channels, not sections, and that is a
   * legitimate design rather than an omission.
   *
   * Carried on the row so the settings page can say so instead of showing a Sections card whose
   * switches would write a setting nothing reads. A control that does nothing is worse than an
   * absent one: it teaches the reader something false about the space.
   */
  const usesSectionsFor = (uuid: string): boolean => {
    const schema = templateStore.allTemplates().find((t) => t.id === resolveTemplateFor(uuid));
    return hasViewsMarker(schema?.routes);
  };

  /** `installedModules` as a set — the shape both the list and the intersection want. */
  const installedSet = createMemo(() => new Set(installedModules()));

  /*
    Row identity, held stable while a row's *content* is unchanged.

    `<For>` — which is what `$each` renders through — keys by reference, so handing it a fresh
    object for every row on every recompute destroys and rebuilds the whole subtree. That is not a
    render-cost point: everything below it loses its `$localState`, so toggling any one setting in
    the space-settings panel reset the open tab and threw away a half-typed name and description.
    The query path solved this long ago with `reconcile({ key: 'id' })`; a store-backed list has no
    such protection, so it is done here.

    `location` is compared by reference because `updateSpaceInCache` clones the space and carries it
    through untouched; everything else is plain data and compares as JSON. A row whose content
    genuinely changed still gets a new object, and still remounts — which is correct, and why the
    settings panel also holds its open tab *above* the `$each`.
  */
  const rowCache = new Map<string, { signature: string; location: unknown; row: SpaceListEntry }>();
  const stableRow = (row: SpaceListEntry): SpaceListEntry => {
    const { location, ...rest } = row;
    const signature = JSON.stringify(rest);
    const cached = rowCache.get(row.uuid);
    if (cached && cached.signature === signature && cached.location === location) return cached.row;
    rowCache.set(row.uuid, { signature, location, row });
    return row;
  };

  /**
   * The spaces list: one row per joined dataset the agent can act on.
   *
   * Ordered by `orderedDatasets`, which already applies the user's sidebar order and drops the
   * system datasets — those belong in the advanced section, where the subject is datasets rather
   * than spaces.
   */
  const spaceList = createMemo<SpaceListEntry[]>(() =>
    datasetStore.orderedDatasets().map((ds) => {
      const space = mySpaces().find((s) => isSpaceSelf(s, ds));
      return stableRow({
        uuid: ds.id,
        // A foreign dataset has no Space record to name it, so the dataset's own name stands in.
        name: space?.name || ds.name,
        description: space?.description ?? '',
        avatar: space?.avatar ?? '',
        kind: !space ? 'foreign' : space.url ? 'shared' : 'personal',
        isWeSpace: Boolean(space),
        canAdminister: space ? canAdministerSpace(space.uuid) : false,
        modules: space ? moduleSettingsFrom(space.enabledModules, installedSet(), new Set(mutedModulesFor(ds.id))) : [],
        // Per row rather than a "current space" memo, for the reason this whole page exists: it
        // configures whichever space you clicked, which is usually not the one you are standing in.
        views: space ? viewSettingsFor(ds.id, space.enabledViews) : [],
        usesSections: usesSectionsFor(ds.id),
        discovery: space?.discovery ?? 'hidden',
        location: (space?.location as SpaceListEntry['location']) ?? null,
        defaultTemplateId: space?.defaultTemplateId ?? '',
        defaultThemeId: space?.defaultThemeId ?? '',
        templateOverride: templateOverrideFor(ds.id),
        themeOverride: themeOverrideFor(ds.id),
        shareLink: shareLinkFor(ds),
        guestLink: guestLinkFor(ds),
      });
    }),
  );

  // TemplateStore mounts above this store and cannot read it directly — hand it the space lookup
  // it needs to resolve a space's default template (see TemplateStore.provideSpaceLookup).
  templateStore.provideSpaceLookup(mySpaces);

  /**
   * Modules that asked to hear about a removal — see `ModuleDatasetAccess.onRemoved`.
   *
   * A plain set rather than a signal: nothing renders from it, and it is read once per removal.
   */
  const datasetRemovalListeners = new Set<(uuid: string) => void>();

  // A dataset removed from any client takes its Space entry with it — and anything a module is
  // holding on its behalf. A call in a space that has just been deleted keeps its camera open and
  // its presence lease heartbeating into a perspective that no longer exists, and only the module
  // can end that.
  onCleanup(
    datasetStore.onDatasetRemoved((uuid) => {
      setMySpaces((prev) => prev.filter((s) => s.uuid !== uuid));
      // Copied first: a module is allowed to forget itself in response, and mutating the set
      // mid-iteration would skip whichever listener came next.
      for (const listener of [...datasetRemovalListeners]) {
        try {
          listener(uuid);
        } catch (error) {
          // One module's failure must not stop the next module hearing about it.
          console.error('SpaceStore: a module threw on dataset removal', error);
        }
      }
    }),
  );

  // Locking the agent clears the loaded spaces along with the session.
  createEffect(() => {
    if (session.bootState() === 'login') setMySpaces([]);
  });

  // Derived: all non-system datasets with Space avatar/name when available, plain dataset data
  // otherwise. Prepends a virtual pre-join entry for the global space when it is configured but
  // the user hasn't joined yet.
  /*
    Lend modules the ability to name a space and to go to one.

    Published from here because this is the store that holds both halves — the names and pictures the
    sidebar renders, and `navigateToSpace`. A module needs them now that its state can outlive the
    space on screen: a call the user has walked away from has to be able to say which space it is in
    and offer the way back, and before that "the space" was always the one being looked at.

    Keyed by uri and normalised through `sharedIdOf`, so a module holding `neighbourhood://<cid>` and
    a sidebar row holding the bare cid are the same space — the comparison this store already has to
    make everywhere else.
  */
  onCleanup(
    provideModuleHostServices({
      datasets: {
        get: (uri: string) => {
          const id = sharedIdOf(uri);
          if (!id) return undefined;
          const item = orderedSidebarItems().find((row) => row.spaceId === id || row.uuid === id);
          return item ? { name: item.name, avatar: item.avatar } : undefined;
        },
        open: (uri: string) => {
          const id = sharedIdOf(uri);
          if (id) void navigateToSpace(id);
        },
        /*
          Removal, as an event, so a module can end what belongs to a dataset that is gone.

          Translated from the dataset id `onDatasetRemoved` reports into the uri a module actually
          holds — a call anchors on `Focus.datasetUri`, and the two are different strings for the same
          space. Resolved before the removal lands, because afterwards there is nothing left to
          resolve it from.
        */
        onRemoved: (cb: (datasetUri: string) => void) => {
          const listener = (uuid: string) => {
            /*
              The uri, from whatever still remembers it.

              `onDatasetRemoved` reports the dataset id; a module holds `Focus.datasetUri`, and for a
              shared space those are different strings for the same thing. `mySpaces` is filtered by
              the handler above, which runs first, so the Space record is already gone — the sidebar
              list is not, and it carries the shared id. A personal space has no uri and no module
              anchors to one, so answering nothing for it is right rather than a gap.
            */
            const row = orderedSidebarItems().find((item) => item.uuid === uuid);
            const uri = row?.spaceId ? `neighbourhood://${row.spaceId}` : undefined;
            if (uri) cb(uri);
          };
          datasetRemovalListeners.add(listener);
          return () => datasetRemovalListeners.delete(listener);
        },
        // The host parses the reference and knows where a record's page is; a module holding one
        // should not have to restate either. See `ModuleDatasetAccess.openRef`.
        openRef: (ref: string) => void openRecordRef(ref),
      },
    }),
  );

  const orderedSidebarItems = createMemo(() => {
    // For joined spaces, s.uuid is the creator's local UUID which never matches the
    // joiner's p.uuid. Space.url stores only the CID (no neighbourhood:// prefix) to
    // avoid URI resolution in the triple store; strip the prefix when looking up.
    const spaceByUuid = new Map(mySpaces().map((s) => [s.uuid, s]));
    const spaceByUrl = new Map(
      mySpaces()
        .filter((s) => s.url)
        .map((s) => [s.url!, s]),
    );
    const items: { uuid: string; name: string; avatar?: string; spaceId: string; isGlobalPreJoin?: boolean }[] =
      datasetStore.orderedDatasets().map((d) => {
        const s = (d.sharedId ? spaceByUrl.get(d.sharedId) : undefined) ?? spaceByUuid.get(d.id);
        return {
          uuid: d.id,
          name: s?.name ?? d.name,
          avatar: typeof s?.avatar === 'string' ? s.avatar : undefined,
          spaceId: d.sharedId ?? d.id,
        };
      });

    const globalId = datasetStore.globalSpaceId();
    const alreadyJoined = globalId ? items.some((item) => item.spaceId === globalId) : true;
    if (globalId && !alreadyJoined) {
      items.unshift({ uuid: 'global-pre-join', name: 'WE Discovery', spaceId: globalId, isGlobalPreJoin: true });
    }

    const mktId = datasetStore.marketplaceId();

    return mktId ? items.filter((item) => item.spaceId !== mktId) : items;
  });

  /** Load the Space model from every candidate dataset. Runs after DatasetStore.loadDatasets. */
  async function loadSpaces(): Promise<void> {
    try {
      // we-root and we-test are system datasets that never have Space SDNA installed —
      // calling Space.findOne on them produces an RPC 500 "No SHACL shape" error.
      const SYSTEM_PERSPECTIVES = ['we-root', 'we-test'];
      const candidates = datasetStore.datasets().filter((d) => !SYSTEM_PERSPECTIVES.includes(d.name));
      // Any other joined dataset without Space SDNA installed (e.g. a Flux
      // neighbourhood) would throw the same "No SHACL shape" error. Since these run in a
      // Promise.all, one rejection would otherwise abort the whole batch and hide every
      // real space's data (including avatars) until each is visited individually. Catch
      // per-dataset so one bad dataset can't poison the rest.
      const spaces = await Promise.all(
        candidates.map(
          async (ds) =>
            await Space.findOne(ds.handle, { where: spaceSelfWhere(ds), include: { location: true } }).catch(
              () => null,
            ),
        ),
      );
      const filteredSpaces = spaces
        .filter((s): s is Space => !!s)
        .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
      setMySpaces(filteredSpaces);
    } catch (error) {
      console.error('SpaceStore: loadSpaces error', error);
    }
  }

  async function addSpaceToDataset(
    dataset: DatasetProxy,
    space: SpaceInput,
    location?: Partial<LocationBlock>,
  ): Promise<Space> {
    const spaceRecord = await Space.create(dataset, space as Partial<Space>);
    if (location) {
      const locationRecord = await LocationBlock.create(dataset, location);
      await spaceRecord.setLocation(locationRecord);
    }
    return spaceRecord;
  }

  async function createSpace(
    name: string,
    description: string,
    access: 'personal' | 'shared',
    discovery: 'hidden' | 'listed',
    avatarFile?: File,
    coverImageFile?: File,
    location?: LocationData | null,
  ): Promise<void> {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return;
    setCreatingSpace(true);

    try {
      // Create the dataset
      const spaceRef = await lifecycle.create(name);
      const spaceHandle = spaceRef.handle as DatasetProxy;
      let publishedSharedId: string | undefined;

      // Register SDNA models (full set, same as switchDataset uses)
      const schemas = session.backendPorts()!.schemas;
      await schemas.installSpace(spaceHandle, moduleRegistry.moduleSchemas(schemas));

      // If shared, publish — capture the returned URL so it can be stored on the Space model
      // (the dataset handle's own sharedUrl is not updated in-place).
      if (access === 'shared') {
        if (!lifecycle.publish) throw new Error('This backend cannot publish shared datasets.');
        const published = await lifecycle.publish(spaceRef.id);
        publishedSharedId = published.sharedId;
        // Patch the ref so trackDataset sees the sharedId — the proxy's sharedUrl is not
        // updated in-place by publish, so the ref captured at create time would otherwise
        // stay empty and shareLinkFor / guestLinkFor would return ''.
        spaceRef.sharedId = published.sharedId;
        spaceRef.sharedUri = published.uri;
      }

      // Process avatar image if provided
      const avatarData = avatarFile
        ? await compressImageToFileData(avatarFile, 'space-avatar', SPACE_AVATAR_PX)
        : undefined;

      // Process cover image if provided
      const coverImageData = coverImageFile ? await compressImageToFileData(coverImageFile, 'space-cover') : undefined;

      // Assemble Space + optional location data — used for both own and parent datasets
      const spaceData = {
        uuid: spaceRef.id,
        url: publishedSharedId,
        name,
        description,
        discovery,
        defaultTemplateId: 'default',
        defaultThemeId: 'dark',
        ...(avatarData && { avatar: avatarData }),
        ...(coverImageData && { coverImage: coverImageData }),
      };
      const locationData = location ?? undefined;

      // Write to own dataset
      const spaceRecord = await addSpaceToDataset(spaceHandle, spaceData, locationData);
      trace('space', 'created', { id: spaceRecord.id });

      // Sync to global discovery space when the user opted in.
      // Space.create returns relations unhydrated, so we pass avatarData, coverImageData,
      // and locationData directly rather than reading them back from spaceRecord.
      if (discovery === 'listed') {
        const globalDs = datasetStore.globalDataset();
        if (globalDs) {
          await syncSpaceToParent(spaceRecord, globalDs.handle, session.backendPorts()!.schemas, {
            locationData,
            avatarData,
            coverImageData,
          }).catch((err) => console.error('SpaceStore: sync space to global failed', err));
        }
      }

      // Track locally so the sidebar updates with the action rather than with the backend's
      // change event (which may lag, or on web may not fire at all).
      await datasetStore.trackDataset(spaceRef);
      setMySpaces((prev) => [...prev, spaceRecord]);
    } catch (error) {
      console.error('SpaceStore: createSpace error', error);
      toastService.error('Could not create the space.');
      // The clearest case of the whole class: the create modal chains `onSuccess` to close itself
      // and navigate into the new space, so a swallowed failure closed the form, threw away what
      // the user had typed, and navigated to a space that does not exist.
      throw error;
    } finally {
      setCreatingSpace(false);
    }
  }

  /**
   * Turns the currently-viewed dataset — which already has some other app's
   * SDNA installed (e.g. a Flux Community) but not WE's — into a WE space in place.
   * Unlike createSpace, this never creates a new dataset or publishes a new
   * neighbourhood: the dataset is already a joined, published neighbourhood
   * (that's the only way it could be showing in the sidebar), so access is always
   * 'shared' here, not a real user choice.
   */
  async function initializeAsWeSpace(
    name: string,
    description: string,
    avatarValue?: File | string | null,
  ): Promise<Space> {
    const ds = datasetStore.currentDataset();
    if (!ds) throw new Error('SpaceStore: initializeAsWeSpace called with no active dataset');

    // Additive/idempotent — does not remove or touch the dataset's existing foreign SDNA.
    const initSchemas = session.backendPorts()!.schemas;
    await initSchemas.installSpace(ds.handle, moduleRegistry.moduleSchemas(initSchemas));

    let avatarData: FileData | undefined;
    if (avatarValue instanceof File) {
      avatarData = await compressImageToFileData(avatarValue, 'space-avatar', SPACE_AVATAR_PX);
    } else if (typeof avatarValue === 'string' && avatarValue) {
      // Untouched prefill from the foreign app's own resolved (data-URI) image value —
      // round-tripped back through FILE_STORAGE_LANGUAGE rather than re-compressed.
      avatarData = dataURIToFileData(avatarValue, 'space-avatar');
    }

    const spaceData: SpaceInput = {
      uuid: ds.id,
      url: ds.sharedId,
      name,
      description,
      discovery: 'hidden',
      defaultTemplateId: 'default',
      defaultThemeId: 'dark',
      ...(avatarData && { avatar: avatarData }),
    };

    const spaceRecord = await addSpaceToDataset(ds.handle, spaceData);

    if (!mySpaces().some((s) => s.uuid === spaceRecord.uuid)) {
      setMySpaces((prev) => [...prev, spaceRecord]);
    }

    // Re-run switchDataset on the same uuid rather than hand-duplicating its
    // classes/registerDynamicEntities/manifest refresh: this atomically flips isWeSpace,
    // refreshes the dynamic model registry, and hands this store a new dataset handle
    // so its currentSpace effect re-fires now that a Space instance exists.
    await datasetStore.switchDataset(ds.id);

    return spaceRecord;
  }

  /**
   * Join a shared dataset, and by default go to it.
   *
   * `focus: false` joins without moving — for a caller that only needs the dataset present, not
   * open. The marketplace is that case: its routes name `datasetStore.marketplaceDataset` directly,
   * so it reads fine from wherever you are, and focusing dragged you out of the space you were in
   * while still looking like an overlay above it. Every shell overlay stays a layer over the space
   * underneath; that property is what lets one host space-scoped things at all.
   */
  async function joinSpace(id: string, focus: boolean = true): Promise<void> {
    const lifecycle = session.lifecycle();
    if (!lifecycle?.join) return;
    if (!id || typeof id !== 'string') {
      console.warn('SpaceStore: joinSpace called with invalid id', id);
      return;
    }

    // If already joined locally (by local id, shared id, or full URI), just focus the dataset.
    const existing = datasetStore.datasets().find((d) => datasetAnswersTo(d, id));
    if (existing) {
      if (focus) await datasetStore.switchDataset(existing.id);
      return;
    }

    // Already joining this one — wait on that rather than starting a second. `focus` is answered
    // here rather than shared with the first caller, because the two can disagree: the marketplace
    // joins without moving you, and a gate for the same space would still owe you the move.
    const key = sharedIdOf(id);
    const inFlight = joinsInFlight.get(key);
    if (inFlight) {
      await inFlight;
      if (focus) {
        const joined = datasetStore.datasets().find((d) => datasetAnswersTo(d, id));
        if (joined) await datasetStore.switchDataset(joined.id);
      }
      return;
    }

    const run = runJoin(id, key, focus).finally(() => joinsInFlight.delete(key));
    joinsInFlight.set(key, run);
    return run;
  }

  /**
   * Everything a join is for, once the dataset itself exists.
   *
   * Split out because the dataset can arrive two ways — the join call returning it, or the backend
   * finishing a join this client already stopped waiting for — and both owe the app the same work.
   * It used to live inline after the call, which is why a transport timeout skipped all of it: the
   * space was joined, and none of the things that make a joined space usable had happened.
   */
  async function finishJoin(joinedRef: DatasetRef, focus: boolean): Promise<void> {
    const joinedHandle = joinedRef.handle as DatasetProxy;

    // Install WE SDNA so Space, SignalType, CollectionBlock etc. are queryable
    // immediately. installSpace diffs against the dataset's actual state before writing,
    // so this is safe to call unconditionally even when the space's creator or an earlier
    // joiner already installed it — it won't write a duplicate copy.
    const joinSchemas = session.backendPorts()!.schemas;
    await joinSchemas.installSpace(joinedHandle, moduleRegistry.moduleSchemas(joinSchemas));

    // Track locally so gates derived from the dataset list (marketplaceJoined, the sidebar,
    // the seed-configured global/marketplace slots) update with the join.
    await datasetStore.trackDataset(joinedRef);

    // Load the Space model and push into mySpaces so the sidebar shows the correct
    // name immediately, without requiring a reboot.
    const joinedSpaceRecord = joinedRef.sharedId
      ? await Space.findOne(joinedHandle, { where: { url: joinedRef.sharedId } }).catch(() => null)
      : null;
    if (joinedSpaceRecord && !mySpaces().some((s) => s.url === joinedSpaceRecord.url)) {
      setMySpaces((prev) => [...prev, joinedSpaceRecord]);
    }

    if (focus) await datasetStore.switchDataset(joinedRef.id);
    trace('space', 'joined', { id: joinedRef.id });
  }

  /**
   * Keep asking the backend whether the dataset turned up, for as long as it is worth asking.
   *
   * The recovery half of a join: see {@link JOIN_RECOVERY_WINDOW_MS} for why a failed call is not a
   * failed join. Asks the backend rather than watching this store's own dataset list, because the
   * list is fed by a change event and the whole point here is to not depend on any one message
   * arriving — polling and the event both end at the same place, and either one alone is enough.
   */
  async function waitForJoinedDataset(id: string): Promise<DatasetRef | null> {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return null;

    const deadline = Date.now() + JOIN_RECOVERY_WINDOW_MS;
    let wait = JOIN_RECOVERY_FIRST_POLL_MS;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      wait = Math.min(Math.round(wait * 1.5), JOIN_RECOVERY_MAX_POLL_MS);

      const refs = await lifecycle.list().catch(() => null);
      const match = refs?.find((ref) => datasetAnswersTo(ref, id));
      if (match) return match;
    }
    return null;
  }

  /** One join attempt, start to finish. Owns the state a UI watches while it runs. */
  async function runJoin(id: string, key: string, focus: boolean): Promise<void> {
    const lifecycle = session.lifecycle()!;
    setJoinError(null);
    setJoiningSpace(key);
    setJoinSlow(false);
    const slowTimer = setTimeout(() => setJoinSlow(true), JOIN_SLOW_AFTER_MS);

    trace('space', 'join:start', { id });
    try {
      // Ask the backend what it already has before asking it for more. The caller checked this
      // store's dataset list, which is a boot-time snapshot plus whatever change events have landed
      // since — and the case that matters here is the one where neither covers it: a join this
      // client abandoned, finished by the backend while the page was reloading. Joining again there
      // is how one space becomes two.
      const alreadyJoined = (await lifecycle.list().catch(() => null))?.find((ref) => datasetAnswersTo(ref, id));
      if (alreadyJoined) {
        trace('space', 'join:already', { id: alreadyJoined.id });
        await finishJoin(alreadyJoined, focus);
        return;
      }

      let joinedRef: DatasetRef | null = null;
      try {
        // The adapter normalizes bare shared ids to its own URI scheme.
        joinedRef = await lifecycle.join!(joinTargetOf(id));
      } catch (error) {
        // A backend that answered has been believed. Only a call that gave up leaves the question
        // open, and only then is it worth watching for the join to land without us.
        if (!transportGaveUp(error)) throw error;
        joinedRef = await waitForJoinedDataset(id);
        if (!joinedRef) throw error;
        console.warn('SpaceStore: the join call gave up but the backend finished the join anyway', error);
      }
      await finishJoin(joinedRef, focus);
    } catch (error) {
      console.error('SpaceStore: joinSpace error', error);
      setJoinError({ spaceId: key, message: joinErrorMessage(error) });
      // Rethrown rather than swallowed: every caller has an `onSuccess` that navigates somewhere or
      // clears an input, and a swallowed failure fired all of them as though the join had worked.
      throw error;
    } finally {
      clearTimeout(slowTimer);
      setJoiningSpace('');
      setJoinSlow(false);
    }
  }

  async function removeSpaceFromGlobal(spaceUuid: string): Promise<void> {
    const globalDs = datasetStore.globalDataset();
    if (!globalDs) return;
    return removeSpaceFromParent(spaceUuid, globalDs.handle);
  }

  async function removeSpace(uuid: string): Promise<void> {
    try {
      const globalDs = datasetStore.globalDataset();
      const myDid = session.me()?.did;
      if (globalDs && myDid) {
        // Only remove from global discovery if the current user is the author of that
        // space entry — a peer who joined and later deletes their local copy should not
        // affect the global listing.
        const spaceInGlobal = await Space.findOne(globalDs.handle, { where: { uuid } }).catch(() => null);
        if (spaceInGlobal && spaceInGlobal.author === myDid) {
          await removeSpaceFromParent(uuid, globalDs.handle).catch((err) =>
            console.error('SpaceStore: removeSpaceFromParent on delete error', err),
          );
        }
      }
      // Prunes mySpaces via the onDatasetRemoved callback.
      await datasetStore.removeDataset(uuid);
    } catch (error) {
      console.error('SpaceStore: removeSpace error', error);
      toastService.error('Could not remove this space.');
      // Rethrown, for the reason `joinSpace` rethrows: callers chain `onSuccess` off this to close a
      // confirmation and navigate away, and a swallowed failure ran all of it — leaving the user
      // somewhere else, told the space was gone, while it was still there.
      throw error;
    }
  }

  function updateSpaceInCache(dataset: AppDataset, updates: Partial<Space>): void {
    setMySpaces((prev) =>
      prev.map((s) =>
        isSpaceSelf(s, dataset) ? Object.assign(Object.create(Object.getPrototypeOf(s)), s, updates) : s,
      ),
    );
  }

  // Backfill mySpaces when switching to a shared dataset whose Space record wasn't cached at
  // join time (joinSpace's Space.findOne may have returned null if the creator's record hadn't
  // propagated from Holochain yet). Re-runs on every dataset switch.
  createEffect(() => {
    const ds = datasetStore.currentDataset();
    if (!ds?.sharedId) return;
    const sharedCid = ds.sharedId;
    if (untrack(mySpaces).some((s) => s.url === sharedCid)) return;
    void (async () => {
      const spaceRecord = await Space.findOne(ds.handle, { where: { url: sharedCid } }).catch(() => null);
      if (spaceRecord && !untrack(mySpaces).some((s) => s.url === spaceRecord.url)) {
        setMySpaces((prev) => [...prev, spaceRecord]);
      }
    })();
  });

  async function createPost(json: unknown, options: CreatePostOptions = {}): Promise<string | undefined> {
    const p = datasetStore.currentDataset()?.handle;
    if (!p) return;

    // `kind` is written alongside the `type: 'root'` that already identifies a post, not instead of
    // it: reads still key on `type`, so existing posts stay in the feed and nothing needs
    // backfilling. See `createBlocks`.
    //
    // The anchor is what makes one action serve every composed artifact. A post has none — it sits
    // in the space. A message names its channel through `we://children`; a reply names whatever it
    // answers through `we://comment`. Both arrive from a schema as ids, which is all a template
    // has, and both are `$each`/route values rather than anything the store could derive.
    const { kind = 'post', parentId, predicate = PREDICATES.CHILDREN } = options;

    // The action arrives from a schema as unknown; the composer produced it, so it is a content document.
    const root = await createBlocks(p, json as ContentInput, {
      kind,
      ...(parentId && { anchor: { id: parentId, predicate } }),
    });
    return root?.id;
  }

  async function updatePost(postId: string, json: unknown): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    if (!p) return;
    const existingRoot = await CollectionBlock.findOne(p, { where: { id: postId } });
    if (!existingRoot) return;
    const document = json as ContentInput;

    // Somebody else may have saved this post while it was open here. A peer-to-peer store cannot
    // refuse the second writer — a write that has not arrived is invisible — so what it can do is
    // notice: the document carries a hash of the content as loaded, and the stored blob says what
    // is there now. Their blocks survive the save either way (reconcileBlocks keeps what the author
    // never loaded); a paragraph both agents edited resolves to whichever write is later, and that
    // is the one thing worth saying out loud.
    const loadedHash = isContentDocument(document) ? document.baseHash : undefined;
    const storedHash = loadedHash ? contentHash(decodeEditorState(existingRoot.editorState) ?? []) : undefined;
    const changedMeanwhile = !!loadedHash && !!storedHash && loadedHash !== storedHash;

    await reconcileBlocks(p, existingRoot, document);

    if (changedMeanwhile) {
      toastService.warning(
        'This post was changed by someone else while you were editing. Your version of anything you both changed was kept.',
        8000,
      );
    }
  }

  /**
   * Move a child from one collection to another — a kanban card between columns, a post between
   * channels.
   *
   * A relink, not an edit: the child is untouched and only the two `we://children` edges change.
   * That is what makes containment a usable way to express status (see the `kanbanBoard`
   * fragment) — the card carries no column field that could disagree with where it actually is.
   *
   * Add before remove, deliberately. Both writes are separate round trips, so a failure between
   * them leaves the card in **two** columns rather than in none — visible and fixable by moving it
   * again, where the other order loses it somewhere no view lists. Not atomic: `Ad4mModel`'s batch
   * covers a transaction on one model's own writes, and this touches two.
   *
   * A no-op when the source and target are the same, so a menu listing every column including the
   * current one cannot remove a card by "moving" it where it already is.
   */
  async function moveChild(childId: string, fromId: string, toId: string): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    if (!p || !childId || !fromId || !toId || fromId === toId) return;
    try {
      const [from, to] = await Promise.all([
        CollectionBlock.findOne(p, { where: { id: fromId } }),
        CollectionBlock.findOne(p, { where: { id: toId } }),
      ]);
      if (!from || !to) return;
      await to.addChildren(childId);
      await from.removeChildren(childId);
    } catch (error) {
      console.error('SpaceStore: could not move child between collections', error);
      toastService.error('Could not move that item');
    }
  }

  /**
   * Join or leave a node's participant roster — an event RSVP, a document's co-editor list.
   *
   * **Writes only this agent's own entry, ever.** That is not a convenience, it is what keeps
   * `participants` conflict-free: it is a bag of links with no way to refuse a duplicate, so it
   * behaves as a set exactly as long as each agent writes itself and nobody else. A caller that
   * appended every member it could see is what turned the transcribe module's roster into a
   * multiset that grew each session — see the note on `WeNode.participants`.
   *
   * No read-modify-write for the same reason: `addParticipants` and `removeParticipants` are single
   * link operations, so two agents RSVPing at the same moment cannot drop each other.
   */
  async function setAttending(nodeId: string, attending: boolean): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    const me = session.me()?.did;
    if (!p || !nodeId || !me) return;
    try {
      const node = await CollectionBlock.findOne(p, { where: { id: nodeId } });
      if (!node) return;
      if (attending) await node.addParticipants(me);
      else await node.removeParticipants(me);
    } catch (error) {
      console.error('SpaceStore: could not update attendance', error);
      toastService.error('Could not update your RSVP');
    }
  }

  async function deleteCollection(collectionId: string): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    if (!p) return;
    await deleteBlocks(p, collectionId);
  }

  async function navigateToSpace(spaceId: string, view?: string): Promise<void> {
    // spaceId may be a local id or a shared id — no shape-guessing needed with refs.
    const ds = datasetStore.datasets().find((d) => d.id === spaceId || d.sharedId === spaceId);

    /*
      Switching only when the space is actually changing — the same guard the route effect below
      carries, and missing here.

      Clicking the space you are already in is ordinary: it is how you get back from the settings
      overlay, which leaves the route where it was. Re-switching to it costs a `hasCoreSchema`, an
      `installModules` and a `refreshSpace` round trip, and republishes the dataset — which used to
      rebuild presence and drop any call running in it.

      The signal now refuses an equivalent value (see `DatasetStore`), so the drop is fixed either
      way; this stops the pointless round trips as well, and keeps the two navigation paths saying
      the same thing.
    */
    if (ds && datasetStore.currentDataset()?.id !== ds.id) {
      // Pre-load space templates before switching so the template and data arrive together
      await templateStore.preloadSpaceTemplates(ds);
      await datasetStore.switchDataset(ds.id);
    }
    // If no dataset found, route change alone will show the join gate

    const segs = routeStore.segments();
    const currentView = view ?? (segs[0] === 'space' && segs[2] ? segs[2] : 'about');
    /*
      The canonical segment, not the one the caller happened to hold. `spaceId` here may be either
      form — a sidebar row passes the local id, a share link the shared one — and both resolve, so
      without this one space ended up with two addresses depending on how you reached it.
    */
    const targetPath = '/space/' + (ds ? canonicalSpaceId(ds) : spaceId) + '/' + currentView;
    shellStore.closeShellView();
    routeStore.navigate(targetPath);
    // Notify embedded app iframes (e.g. Flux) after the dataset has switched
    broadcastPerspectiveNavigation(spaceId);
  }

  /**
   * Go to whatever a record reference names.
   *
   * One implementation behind three surfaces — this store member, `ModuleDatasetAccess.openRef` for
   * a feature module, and `BlockHostValue.openRef` for an embed inside a composition. All three are
   * the same question, and answering it three times is how the route and the link came to disagree
   * before `RECORD_ROUTE_PATH` was one literal.
   *
   * Four cases, and each is a decision rather than a fallthrough:
   *
   * - **A record** — the space, and its page within it.
   * - **A dataset alone** — the space itself. What a gathered space is: its identity *is* its
   *   dataset, so there is no record to open.
   * - **Relative (`we:./…`)** — resolved against the space on screen, which is what "the dataset
   *   this reference is read in" means. The segment comes off the route rather than from the
   *   dataset, so following an embed cannot silently rewrite a shared space's URL from its CID to
   *   its local id.
   * - **A person** — nothing. An agent has no page yet; a profile route would be a real feature and
   *   is not this one, and navigating somewhere arbitrary would be worse than staying put.
   */
  async function openRecordRef(ref: string): Promise<void> {
    const segs = routeStore.segments();
    const here = segs[0] === 'space' ? (segs[1] ?? '') : '';
    const destination = resolveRecordRef(ref, here);
    if (!destination) return;
    return navigateToSpace(destination.datasetId, destination.view);
  }

  function broadcastPerspectiveNavigation(communityId: string): void {
    const iframes = document.querySelectorAll('we-iframe') as NodeListOf<
      HTMLElement & { postMessage: (data: unknown, origin: string) => void }
    >;
    iframes.forEach((el) => {
      if (typeof el.postMessage === 'function') {
        el.postMessage({ type: 'NAVIGATE_PERSPECTIVE', communityId }, '*');
      }
    });
  }

  /**
   * The dataset a space-scoped write targets: a named space, or the one being viewed.
   *
   * Space settings are reached from the spaces list, so the space being configured is usually not
   * the one you are standing in — navigating to it would close the settings overlay
   * (`navigateToSpace` calls `closeShellView`), which is the whole reason the list carries the
   * settings entry point rather than a "current space" page doing it.
   *
   * Omitting the argument keeps the previous meaning, so in-space callers are unchanged.
   */
  function targetDataset(spaceUuid?: string): AppDataset | null {
    if (!spaceUuid) return datasetStore.currentDataset();
    return datasetStore.datasets().find((d) => d.id === spaceUuid) ?? null;
  }

  /** Whether a write is aimed at the space currently on screen — live UI switches only apply then. */
  const isCurrent = (ds: AppDataset) => datasetStore.currentDataset()?.id === ds.id;

  async function updateSpaceImage(field: 'avatar' | 'coverImage', imageFile: File, spaceUuid?: string): Promise<void> {
    const ds = targetDataset(spaceUuid);
    if (!ds) return;
    const fileData = await compressImageToFileData(
      imageFile,
      field === 'avatar' ? 'space-image' : 'space-cover',
      field === 'avatar' ? SPACE_AVATAR_PX : undefined,
    );
    const [spaceRecord] = await Space.findAll(ds.handle, { where: spaceSelfWhere(ds) });
    if (!spaceRecord) return;
    await Space.update(ds.handle, spaceRecord.id, { [field]: fileData });
    // Only the current space has a live subscription refreshing it; every other row in the spaces
    // list is served from this cache, so without it the change would not appear until a reload.
    updateSpaceInCache(ds, { [field]: fileData } as never);
    if (spaceRecord.discovery === 'listed') {
      const globalDs = datasetStore.globalDataset();
      if (globalDs) {
        const imageOpt = field === 'avatar' ? { avatarData: fileData } : { coverImageData: fileData };
        await syncSpaceToParent(spaceRecord, globalDs.handle, session.backendPorts()!.schemas, imageOpt).catch((err) =>
          console.error('SpaceStore: sync image to global failed', err),
        );
      }
    }
  }

  async function updateSpaceMeta(updates: SpaceMetaUpdate, spaceUuid?: string): Promise<void> {
    const ds = targetDataset(spaceUuid);
    if (!ds) return;
    const currentDataset = ds.handle;

    const [spaceRecord] = await Space.findAll(currentDataset, {
      where: spaceSelfWhere(ds),
      include: { location: true },
    });
    if (!spaceRecord) return;

    const previousDiscovery = spaceRecord.discovery;

    if (updates.name !== undefined) spaceRecord.name = updates.name;
    if (updates.description !== undefined) spaceRecord.description = updates.description;
    if (updates.discovery !== undefined) spaceRecord.discovery = updates.discovery;
    await spaceRecord.save();
    // See updateSpaceImage — only the current space is refreshed by a live subscription.
    const { location: _location, ...scalars } = updates;
    updateSpaceInCache(ds, scalars as never);

    if (updates.location !== undefined) {
      if (updates.location === null) {
        const [existingLoc] = await LocationBlock.findAll(currentDataset);
        if (existingLoc) {
          try {
            await existingLoc.delete();
          } catch (err) {
            console.error('[SpaceStore] location delete failed:', err);
          }
        }
      } else {
        const loc = updates.location;
        // Always delete + recreate so setLocation updates the Space's we://location triple,
        // which triggers the reactive currentSpace subscription to re-query with fresh data.
        // LocationBlock.update only changes nested triples and doesn't trigger the Space query.
        const [existingLoc] = await LocationBlock.findAll(currentDataset);
        if (existingLoc) await existingLoc.delete();
        await session.backendPorts()!.schemas.ensure(currentDataset, LocationBlock);
        const newLoc = await LocationBlock.create(currentDataset, {
          latitude: loc.latitude,
          longitude: loc.longitude,
          ...(loc.name && { name: loc.name }),
          ...(loc.city && { city: loc.city }),
          ...(loc.country && { country: loc.country }),
          ...(loc.countryCode && { countryCode: loc.countryCode }),
        });
        await spaceRecord.setLocation(newLoc);
      }
      /*
        The cached row carries the location now, and the write above deliberately excluded it from
        `updateSpaceInCache` (a relation is not a scalar). Only the space *on screen* is refreshed by
        the live subscription, so without this the settings page would show the old place — or "Not
        set" — immediately after saving a space the agent is not standing in.
      */
      updateSpaceInCache(ds, { location: updates.location } as never);
    }

    const globalDs = datasetStore.globalDataset();
    if (!globalDs) return;

    const effectiveDiscovery = updates.discovery ?? previousDiscovery;
    if (effectiveDiscovery === 'listed') {
      // Pass locationData explicitly when location changed — the included spaceRecord.location
      // snapshot is stale after our delete+recreate. null signals explicit removal to syncSpaceToParent.
      const syncOpts = updates.location !== undefined ? { locationData: updates.location } : {};
      await syncSpaceToParent(spaceRecord, globalDs.handle, session.backendPorts()!.schemas, syncOpts).catch((err) =>
        console.error('SpaceStore: sync meta to global failed', err),
      );
    } else if (previousDiscovery === 'listed') {
      await removeSpaceFromParent(spaceRecord.uuid, globalDs.handle).catch((err) =>
        console.error('SpaceStore: remove from global failed', err),
      );
    }
  }

  async function createSignalType(config: Partial<SignalType>): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    if (!p) return;
    // Fixed ranges for modes where the user doesn't configure them
    const rangeOverrides: Record<string, { rangeMin: number; rangeMax: number }> = {
      toggle: { rangeMin: 0, rangeMax: 1 },
      vote: { rangeMin: -1, rangeMax: 1 },
    };
    const slugFromName = config.name ? deriveSlug(config.name) : '';
    const effectiveSlug = config.slug ? config.slug : slugFromName;
    const withSlug = { ...config, slug: effectiveSlug };
    const normalised =
      withSlug.mode && rangeOverrides[withSlug.mode] ? { ...withSlug, ...rangeOverrides[withSlug.mode] } : withSlug;
    await SignalType.create(p, normalised);
  }

  /**
   * Withdraw a signal type from use, or bring it back — without touching what people gave.
   *
   * ## Why this is not a delete
   *
   * A `Signal` names its type by **record id** (`signalTypeId`), not by slug, while every template
   * resolves the type by slug at render time — `find(local.signalTypes, { slug: 'like' }).id`.
   * Three things follow, and they decide the whole design:
   *
   * - Deleting the type removes nothing. Every reaction ever given stays in the perspective, now
   *   naming an id nothing resolves, counted by no projection and rendered by nothing.
   * - Re-creating a type with the same slug does not bring them back either. AD4M mints a fresh
   *   record id, so the old rows still name the dead one. "Delete it and add it back" loses the
   *   history permanently, which is exactly the thing a person would expect to be safe.
   * - Cascading the delete instead — sweeping up every `Signal` with that id — is worse than it
   *   looks. It is thousands of sequential link removals in an established space; it destroys
   *   *other members'* expressions on one person's click, in a neighbourhood every member can write
   *   to; it cannot be undone; and it cannot even be guaranteed, since a peer who was offline
   *   during the sweep, or who reacted concurrently, re-orphans immediately.
   *
   * So the reversible option is the right one, and it is the one this codebase already chose one
   * layer up: `shapeStore.deleteShape` removes a model definition and says plainly that "records
   * already created keep their data — only the definition goes". A signal type is the same kind of
   * thing, and deserves the same answer.
   *
   * Retired, the type stops being offered anywhere a reaction can be given. The signals stay,
   * `find()` by slug still resolves it so existing counts keep working, and un-retiring restores
   * every reaction exactly as it was — because nothing was ever removed.
   *
   * Positively phrased so a switch can pass `event.detail` bare, matching `setAgentMuted` and
   * `setViewVisible`.
   */
  async function setSignalTypeRetired(signalTypeId: string, retired: boolean): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    if (!p) return;

    try {
      await SignalType.update(p, signalTypeId, { retired });
    } catch (error) {
      console.error('SpaceStore: could not change whether a signal type is retired', error);
      toastService.error(retired ? 'Could not retire that reaction' : 'Could not restore that reaction');
    }
  }

  /**
   * Name a kind of connection, deriving its slug the way a signal type derives one.
   *
   * The slug is what a template refers to when it cares about a specific kind — "draw
   * contradictions in red" — because the display name belongs to the community and may change,
   * where an identifier does not.
   */
  async function createRelationshipType(config: Partial<RelationshipType>): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    if (!p) return;
    const slug = config.slug || (config.name ? deriveSlug(config.name) : '');
    await RelationshipType.create(p, { ...config, slug });
  }

  async function upsertSignal(nodeId: string, signalTypeId: string, value: number): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    const myDid = session.me()?.did;
    if (!p || !myDid) return;

    const existing = await Signal.findOne(p, {
      parent: { id: nodeId, predicate: 'we://signal' },
      where: { signalTypeId, author: myDid },
    });

    if (existing) await existing.delete();
    if (value === 0) return;
    await Signal.create(p, { signalTypeId, value }, { parent: { id: nodeId, predicate: 'we://signal' } });
  }

  // Ecosystem dialect, feature-detected through the connector's interop surface — a backend
  // without it simply returns nothing.
  async function getSubgroupMessages(subgroupId: string): Promise<FluxSubgroupMessage[]> {
    const ds = datasetStore.currentDataset();
    const fetchMessages = session.backendPorts()?.interop?.fluxSubgroupMessages;
    if (!ds || !fetchMessages) return [];
    try {
      return await fetchMessages(ds.handle, subgroupId);
    } catch (err) {
      console.error('SpaceStore: getSubgroupMessages failed', err);
      return [];
    }
  }

  async function exportCallTranscript(callId: string): Promise<void> {
    const dataset = datasetStore.currentDataset();
    if (!dataset) return;
    const p = dataset.handle;
    try {
      // The same gather extraction runs on, rather than a second reading of the same shape. What a
      // turn is — which entities can be one, which rows are too broken to keep, and the ordering
      // that makes a transcript a transcript rather than a bag of sentences — is one decision, and
      // an export that answered it differently would disagree with what the model was shown.
      const modelFor = (entity: string) => getEntitiesForPerspective(entity, p);
      const predicate = containmentPredicate(modelFor, datasetStore.currentDatasetEntities());
      const turns = predicate
        ? await gatherTranscriptTurns(
            {
              modelFor: (entity) => modelFor(entity) as TurnRecord | undefined,
              handle: p,
              containmentPredicate: predicate,
            },
            callId,
          )
        : [];

      // Ask for the speakers this transcript actually names before labelling any of them. The cache
      // is populated as a side effect of rendering people — members, peers, bylines — so relying on
      // it alone exports whoever happens to be on screen by name and everybody else as a raw DID.
      // `fetchProfile` no-ops on a profile it already holds and dedupes concurrent calls, so asking
      // for all of them costs a round trip only for the ones genuinely missing.
      const speakers = [...new Set(turns.map((turn) => turn.speaker))];
      await Promise.all(speakers.map((did) => profileStore.fetchProfile(did).catch(() => undefined)));

      // A speaker's label the way the byline renders it: their display name, else their DID. The
      // cache is keyed on the bare DID — `fetchProfile` strips the scheme on the way in — so a
      // prefixed author has to be stripped here too or it would never match what was just fetched.
      //
      // Re-derived with the DID as the fallback rather than reading the cache's own `name`, which
      // falls back to "Anonymous". That is right on screen, where a face sits beside the label and
      // tells one unnamed peer from another — and wrong in a text file, where it is all there is:
      // three unnamed speakers would come out as three identical "Anonymous" lines, and a
      // transcript that cannot tell its speakers apart is not a transcript.
      const nameFor = (did: string): string => {
        const profile = profileStore.profiles().find((entry) => entry.did === did.replace('did://', ''));
        return profile ? displayName(profile, did) : did;
      };

      const lines = turns.map((turn) => `${nameFor(turn.speaker)}, ${turn.timestamp}: ${turn.text}`);

      if (!lines.length) {
        toastService.warning('This call has no transcript to export.');
        return;
      }

      // Name the file after the call, falling back to a generic name, then stamp it with the export
      // time so successive exports of the same call don't overwrite each other.
      const call = await CollectionBlock.findOne(p, { where: { id: callId } });
      const rawName = (call?.title ?? '').trim();
      const slug =
        rawName
          .replace(/[^\p{L}\p{N}\-_ ]/gu, '')
          .trim()
          .replace(/\s+/g, '-') || 'call-transcript';
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${slug}-${stamp}.txt`;

      const blob = new Blob([`${lines.join('\n')}\n`], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      toastService.success('Transcript exported.');
    } catch (error) {
      console.error('SpaceStore: exportCallTranscript failed', error);
      toastService.error('Could not export the transcript.');
    }
  }

  const [currentSpace, setCurrentSpace] = createSignal<Space | null>(null);

  /**
   * Which modules this space has on.
   *
   * An unset field means "not decided", never "none" — see `Space.enabledModules`. Falling back to
   * the registered set is what stops this shipping as a silent regression that strips every existing
   * space of its chrome.
   */
  const enabledModules = createMemo<string[]>(() => resolveEnabledModules(currentSpace()?.enabledModules));

  /*
    Does this space want its calls interpreted as they happen.

    Read off the space rather than stored here, so it answers for whichever space is on screen, and
    handed down to DatasetStore — which owns the watch registration and sits below this store, so it
    cannot reach a `Space` itself. Absent space reads false: a decision nobody has made is not a
    decision to spend somebody's LLM budget.
  */
  const autoInterpret = createMemo<boolean>(() => currentSpace()?.autoInterpret === true);
  const shareExtractionDetail = createMemo<boolean>(() => currentSpace()?.shareExtractionDetail === true);
  onCleanup(datasetStore.provideAutoInterpretGate(() => autoInterpret()));

  /*
    Which candidates this space's calls start with.

    Intersected with the candidates rather than trusted as stored, and that is load bearing: a name
    the perspective has no shape for fails `assertShapesInstalled` and takes the whole pass down, so
    a list naming a model since deleted — or one whose `extractable` was withdrawn in a release —
    has to narrow quietly instead of breaking extraction for the space.

    Order follows the candidates, so a settings list reads the same way every time rather than in
    whatever order somebody happened to tick things.
  */
  const extractionTargets = createMemo<string[]>(() => {
    const candidates = shapeStore.extractionCandidates();
    const chosen = parseEntityList(currentSpace()?.extractionTargets) ?? LEGACY_EXTRACTION_TARGETS;
    return candidates.filter((entity) => chosen.includes(entity));
  });

  /**
   * What one call extracts, where its participants asked for something other than the default.
   *
   * One subscription for the space rather than a read per call: a list of calls asks this question
   * once per card, and the records are few — one per call that has been customised. Same shape as
   * `readMarkers`.
   */
  const [callExtractions, setCallExtractions] = createSignal<CallExtraction[]>([]);

  createEffect(() => {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !datasetStore.isWeSpace()) {
      setCallExtractions([]);
      return;
    }
    void CallExtraction.findAll(dataset.handle)
      .then(setCallExtractions)
      .catch(() => setCallExtractions([]));
  });

  /**
   * The models one call extracts: its own list if it has one, else the space's default.
   *
   * A record with `entities: '[]'` is a group that turned everything off, and answers `[]`. A call
   * with no record has not been touched and answers the space's list — which is exactly the
   * distinction the record exists to make, and why this cannot be a set of links.
   */
  const extractionTargetsForCall = (collectionId: string): string[] => {
    const candidates = shapeStore.extractionCandidates();
    const own = parseEntityList(callExtractions().find((row) => row.callId === collectionId)?.entities);
    if (!own) return extractionTargets();
    return candidates.filter((entity) => own.includes(entity));
  };

  /**
   * Add or remove one model from what a call extracts, for everyone in it.
   *
   * Writes the *resolved* list rather than a diff, so the first toggle also pins whatever the space
   * default was at that moment — a model added to the space's defaults later does not silently join
   * a call whose participants have already decided. The same rule `setModuleEnabled` follows.
   */
  async function setCallExtractionTarget(collectionId: string, entity: string, on: boolean): Promise<void> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !collectionId) return;
    const next = new Set(extractionTargetsForCall(collectionId));
    if (on) next.add(entity);
    else next.delete(entity);
    const entities = JSON.stringify([...next]);
    const existing = callExtractions().find((row) => row.callId === collectionId);
    try {
      if (existing) await CallExtraction.update(dataset.handle, existing.id, { entities });
      else await CallExtraction.create(dataset.handle, { callId: collectionId, entities });
      setCallExtractions(await CallExtraction.findAll(dataset.handle));
    } catch (error) {
      console.error('SpaceStore: could not save what this call extracts', error);
      toastService.error('Could not save what this call extracts.');
      throw error;
    }
  }

  /*
    ShapeStore already lends the candidates downward — this store passed the very same accessor a
    second time, so which of the two won was decided by mount order and nothing else. Harmless while
    they agreed, and a coin toss the day they stop; the one that owns the value is the one that
    lends it.
  */
  onCleanup(
    datasetStore.provideCallExtraction({
      forCall: extractionTargetsForCall,
      setForCall: setCallExtractionTarget,
    }),
  );
  /*
    Ticking "let AI create these" in the model wizard is this space saying yes — see
    `ShapeStore.provideExtractionEnroller`. Handed upward because ShapeStore mounts above this one
    and cannot reach a `Space`, the mirror of how `autoInterpret` is handed down.
  */
  onCleanup(shapeStore.provideExtractionEnroller((entity) => setExtractionTarget(entity, true)));

  /**
   * What actually renders here, for this agent: the three layers intersected, minus personal mutes.
   *
   * Registered ∩ installed ∩ enabled, less muted. The layers answer different questions and none
   * substitutes for another — the deployment says what exists, I say what I want anywhere, the
   * community says what it runs, and I say what I want *here*. A module has to survive all four.
   *
   * This is what the chrome gate and the launcher rail read. `enabledModules` stays the community's
   * decision alone, because that is what the space settings edit and what other members share.
   *
   * A module declaring `scope: 'agent'` skips the community layer entirely — see below.
   */
  const activeModules = createMemo<string[]>(() => {
    const installed = installedSet();
    const muted = new Set(mutedModulesFor(datasetStore.currentDataset()?.id));
    const bySpace = enabledModules().filter((id) => installed.has(id) && !muted.has(id));
    /*
      Agent-scoped modules are active wherever this agent is, including outside a space entirely.
      There is no community whose decision could apply to a panel that gathers things from *across*
      spaces, and intersecting it with `enabledModules` would make it — and whatever it is holding —
      disappear the moment somebody walked out of a space that happened to have it on.

      Still gated on `installed`: Settings → Modules is the person's own switch, and this widens who
      decides rather than removing the decision.
    */
    const byAgent = moduleRegistry
      .all()
      .filter(({ definition }) => definition.scope === 'agent' && installed.has(definition.id))
      .map(({ definition }) => definition.id);
    return [...new Set([...bySpace, ...byAgent])];
  });

  /**
   * The space's sections, resolved: which view renders, at which segment, in which order.
   *
   * Community layer minus personal layer — `Space.enabledViews` says what the space *has*, and this
   * agent's `hiddenViews` says which of those they bother to see. Deliberately **not** intersected
   * with an "installed by me" layer the way `activeModules` is: a module is a capability an agent
   * chooses to run, while a section is part of what the space *is*, and letting a missing personal
   * install silently remove a tab would mean two members reading the same URL and one of them
   * getting a 404.
   *
   * The segment comes from the view's own `meta.segment`, falling back to its id. It is resolved
   * here rather than read at the render site so the routes and the nav strip cannot disagree about
   * where a section lives — which is the drift this whole mechanism exists to end.
   */
  /**
   * Every view that could render here, each at the segment it will always be at.
   *
   * What the route table is built from — see `routableSections` for why that is deliberately *not*
   * the enabled list. It changes when a view is installed or uninstalled and at no other time, so
   * flicking a section on or off no longer rebuilds the Router and everything mounted under it.
   */
  const routableViews = createMemo<ResolvedView[]>(() => routableSections(availableViews(), defaultViewOrder()));

  const spaceViews = createMemo<ResolvedView[]>(() =>
    activeSections({
      routable: routableViews(),
      enabledRaw: currentSpace()?.enabledViews,
      hidden: hiddenViewsFor(datasetStore.currentDataset()?.id),
      fallbackOrder: defaultViewOrder(),
    }),
  );

  /**
   * The ids of the sections **the community** has in this space — what a route body is gated on.
   *
   * Deliberately *not* the nav list. The two differ by this agent's hidden set, and those mean
   * different things: the community removing a section takes it out of the space, while hiding one
   * for yourself takes it out of your nav. Gating on the nav list would turn a personal tidy-up into
   * a block — follow a link to something you had merely hidden and be told it is "not in this
   * space", which is both a refusal you did not ask for and a lie about why.
   *
   * A bare id list rather than resolved views, because `$in` is what reads it and a schema cannot
   * pluck a field out of each entry to compare against.
   */
  const enabledViewIds = createMemo<string[]>(() =>
    activeSections({
      routable: routableViews(),
      enabledRaw: currentSpace()?.enabledViews,
      hidden: [],
      fallbackOrder: defaultViewOrder(),
    }).map((view) => view.id),
  );

  /**
   * The same list, as the nav strip reads it.
   *
   * A projection rather than a second source, which is the point: the header and the sidebar used to
   * hold literal arrays of their own and had already drifted apart from each other and from the
   * routes. Anything rendering a section list reads this, so there is one answer to what a space
   * contains.
   *
   * `path` is relative (`./cards`) because a section is always addressed from inside its space.
   */
  const viewNav = createMemo(() =>
    spaceViews().map((view) => ({
      id: view.id,
      segment: view.segment,
      label: view.schema.meta?.name ?? view.id,
      icon: view.schema.meta?.icon || 'square',
      path: `./${view.segment}`,
    })),
  );

  // AppStore mounts above this one, so it is handed the set rather than reaching for it — the same
  // arrangement as `templateStore.provideSpaceLookup`. The *installed* set, not the active one: an
  // app switcher renders in the shell, so it is gated at the agent layer. See `moduleSurface`.
  appStore.provideInstalledModules(installedModules);

  /**
   * The agent layer as a settings list — every registered module and whether this agent wants it.
   *
   * Space-independent by design: this is the page you reach without being in a space, and the
   * decision it edits applies everywhere. Its per-space counterpart travels on each spaces-list row.
   */
  const moduleInstallSettings = createMemo(() => {
    const installed = installedSet();
    return moduleRegistry.all().map(({ definition }) => {
      const surface = moduleSurface(definition);
      return {
        id: definition.id,
        name: definition.name,
        description: definition.description ?? '',
        icon: definition.icon ?? 'puzzle-piece',
        installed: installed.has(definition.id),
        surface,
        /**
         * A capability module is listed but not switchable.
         *
         * Uninstalling one would take a component out from under whatever template uses it — the
         * globe route would simply stop rendering, with nothing to explain why. What would make it
         * safe is templates declaring which modules they need, so the choice could be refused or
         * warned about. Until that exists, showing the module without a switch is the honest
         * position: it is part of what you have, and not yet something to decide about.
         */
        switchable: surface !== 'capability',
      };
    });
  });

  /**
   * What the module rail renders: one entry per enabled module that declares a launcher.
   *
   * Reads `moduleStores` so `active` tracks the module's own state — the notes tab highlights while
   * its panel is open, the call tab while you are in a call. A module with no `activeWhen` is simply
   * never highlighted.
   */
  /** Read a boolean off a module's own store, unwrapping the accessor a module store exposes. */
  const read = (moduleId: string, key: string | undefined, fallback: boolean): boolean => {
    if (!key) return fallback;
    const value = (moduleStores[moduleId] as Record<string, unknown> | undefined)?.[key];
    return typeof value === 'function' ? Boolean((value as () => unknown)()) : Boolean(value);
  };

  // Personal per-space choices live in the root dataset, so they load with it rather than with any
  // space — and stay readable for every space at once, which the settings list needs.
  createEffect(() => {
    const root = datasetStore.rootDataset();
    if (!root) {
      setSpacePreferences([]);
      return;
    }
    void SpacePreference.findAll(root.handle)
      .then(setSpacePreferences)
      .catch(() => setSpacePreferences([]));
  });

  // Per-agent private state, loaded from the root dataset alongside space preferences and for the
  // same reason: it is not any one space's, and a feed has to filter on the mute list before it can
  // render a single row.
  createEffect(() => {
    const root = datasetStore.rootDataset();
    if (!root) {
      setReadMarkers([]);
      setMutedAgents([]);
      return;
    }
    void ReadMarker.findAll(root.handle)
      .then(setReadMarkers)
      .catch(() => setReadMarkers([]));
    void MutedAgent.findAll(root.handle)
      .then(setMutedAgents)
      .catch(() => setMutedAgents([]));
  });

  /**
   * Mark a node read, as of now.
   *
   * Upsert on `nodeId` — one marker per node, moved forward rather than accumulated. Called on
   * opening a channel, so it runs often and stays silent on failure: a lost marker shows a stale
   * unread dot, which is not worth a toast interrupting what the user opened the channel to do.
   */
  async function markRead(nodeId: string, spaceUuid?: string): Promise<void> {
    const root = datasetStore.rootDataset();
    const uuid = spaceUuid ?? datasetStore.currentDataset()?.id;
    if (!root || !nodeId || !uuid) return;
    // ISO-8601 UTC: the marker is compared against `createdAt` as a string, so the format has to be
    // the one whose lexicographic order is chronological. See `ReadMarker.lastReadAt`.
    const lastReadAt = new Date().toISOString();
    try {
      const existing = readMarkers().find((m) => m.nodeId === nodeId);
      if (existing) await ReadMarker.update(root.handle, existing.id, { lastReadAt });
      else await ReadMarker.create(root.handle, { nodeId, spaceUuid: uuid, lastReadAt });
      setReadMarkers(await ReadMarker.findAll(root.handle));
    } catch (error) {
      console.error('SpaceStore: could not write read marker', error);
    }
  }

  /**
   * Containers holding something newer than this agent's marker for them.
   *
   * One subscription for the whole space rather than a projection per row: the rail asked the same
   * question for every channel, so a space with thirty channels opened thirty of them.
   *
   * A container with *no* marker counts as unread — it has never been opened, so everything in it is
   * new. That case has to be written down rather than falling out of the comparison, because `>`
   * against `undefined` is false and would have read as "nothing new here".
   */
  const [unreadNodeIds, setUnreadNodeIds] = createSignal<string[]>([]);

  createEffect(() => {
    const ds = datasetStore.currentDataset();
    const markers = readMarkers();
    if (!ds) {
      setUnreadNodeIds([]);
      return;
    }

    void (async () => {
      try {
        const containers = await CollectionBlock.findAll(ds.handle, {
          include: { $latestChild: { from: 'children', order: { createdAt: 'DESC' }, limit: 1 } },
        });
        const lastReadOf = new Map(markers.map((m) => [m.nodeId, m.lastReadAt]));
        setUnreadNodeIds(
          containers
            .filter((container) => {
              const latest = (container as unknown as { $latestChild?: { createdAt?: string } }).$latestChild;
              if (!latest?.createdAt) return false;
              const marker = lastReadOf.get(container.id);
              // ISO-8601 UTC compares lexicographically in chronological order — see ReadMarker.
              return marker === undefined || latest.createdAt > marker;
            })
            .map((container) => container.id),
        );
      } catch (error) {
        console.error('SpaceStore: could not compute unread state', error);
        setUnreadNodeIds([]);
      }
    })();
  });

  /** Nodes in this space naming this agent. See the interface for why the filter is not pushed down. */
  // Typed number because that is what hydration actually returns — the old `string` here was
  // only ever satisfied by `any` flowing through untyped model fields.
  const [myMentions, setMyMentions] = createSignal<{ id: string; author: string; createdAt: number }[]>([]);

  createEffect(() => {
    const ds = datasetStore.currentDataset();
    const did = session.me()?.did;
    if (!ds || !did) {
      setMyMentions([]);
      return;
    }

    void (async () => {
      try {
        const nodes = await CollectionBlock.findAll(ds.handle, { include: { mentions: true } });
        setMyMentions(
          nodes
            .filter((node) => (Array.isArray(node.mentions) ? node.mentions : []).includes(did))
            // The contract keeps timestamps' representation the backend's business; comparison is
            // the consumer's, made explicit here.
            .map((node) => ({ id: node.id, author: node.author, createdAt: Number(node.createdAt) }))
            .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
        );
      } catch (error) {
        console.error('SpaceStore: could not read mentions', error);
        setMyMentions([]);
      }
    })();
  });

  /**
   * Store a file and return the URL that points at it.
   *
   * Images are compressed on the way through, for the reason the profile and space-image paths
   * already do it: a phone photo is several megabytes, and a space's content syncs to every member.
   * Anything else is stored as-is.
   */
  const readAsDataURI = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  async function uploadFile(file: File, name?: string): Promise<string | null> {
    const profiles = session.backendPorts()?.profiles;
    if (!profiles) return null;
    try {
      const fileData = file.type.startsWith('image/')
        ? await compressImageToFileData(file, name ?? file.name)
        : // Non-images go through unchanged. `dataURIToFileData` is the same decode the image path
          // ends with, so both arrive at the port in one shape.
          dataURIToFileData(await readAsDataURI(file), name ?? file.name);
      return await profiles.uploadFile(JSON.stringify(fileData));
    } catch (error) {
      console.error('SpaceStore: upload failed', error);
      toastService.error('Could not upload that file.');
      return null;
    }
  }

  /**
   * Mute or unmute an agent for this agent, everywhere.
   *
   * Phrased positively — `muted: boolean` — so a switch can pass `$event.detail` bare; the same
   * constraint `setModuleVisible` documents.
   *
   * Reports failure, unlike `markRead`: this one was asked for deliberately, and someone who thinks
   * they have muted an account and has not is worse off than someone who knows it did not work.
   */
  /** Just the DIDs — what a feed filter wants, without every consumer mapping the records. */
  const mutedDids = createMemo(() => mutedAgents().map((m) => m.did));

  /**
   * Markers as `{ nodeId, lastReadAt }` rows.
   *
   * An array rather than a map keyed by node id, because **a schema cannot index a map
   * dynamically**: a store read resolves a static dot path, so `spaceStore.readMarkers.<some context
   * ref>` is not expressible — the path would be taken literally. The read is always "this row's
   * marker" from inside a `$each`, which means `find()` over an array with a context ref in `where`,
   * the only form the resolver supports. Linear per rendered row, over a list the size of the
   * channels one agent has opened.
   */
  const readMarkerRows = createMemo(() => readMarkers().map((m) => ({ nodeId: m.nodeId, lastReadAt: m.lastReadAt })));

  async function setAgentMuted(did: string, muted: boolean, description = ''): Promise<void> {
    const root = datasetStore.rootDataset();
    if (!root || !did) return;
    try {
      const existing = mutedAgents().find((m) => m.did === did);
      if (muted && !existing) await MutedAgent.create(root.handle, { did, description });
      else if (!muted && existing) await MutedAgent.delete(root.handle, existing.id);
      setMutedAgents(await MutedAgent.findAll(root.handle));
    } catch (error) {
      console.error('SpaceStore: could not update mute list', error);
      toastService.error(muted ? 'Could not mute that account' : 'Could not unmute that account');
    }
  }

  /** Turn a module on or off for this agent everywhere. See `AgentSettings.installedModules`. */
  /**
   * Put a space's share link on the clipboard.
   *
   * Here rather than in a schema because clipboard access is a browser API, and because the failure
   * is worth reporting: a denied clipboard permission is silent otherwise, and the user would be
   * left pasting whatever they had before.
   */
  async function copyShareLink(uuid: string): Promise<void> {
    const link = spaceList().find((s) => s.uuid === uuid)?.shareLink;
    if (!link) return;
    if (await copyText(link)) toastService.success('Link copied');
    else toastService.error('Could not copy the link');
  }

  /**
   * Copy the guest invite link — the zero-friction entry for someone without an account.
   *
   * The guest link encodes both the space and the host URL, so clicking it connects the guest
   * to the right node and auto-joins the space with no auth UI. Empty when there is no reachable
   * server URL (local executor).
   */
  async function copyGuestLink(uuid: string): Promise<void> {
    const link = spaceList().find((s) => s.uuid === uuid)?.guestLink;
    if (!link) {
      toastService.error('Guest links require a hosted node');
      return;
    }
    if (await copyText(link)) toastService.success('Guest invite link copied');
    else toastService.error('Could not copy the link');
  }

  /**
   * Modules the template currently on screen needs in order to render.
   *
   * Derived from the components the schema actually mounts, so it is right without any template
   * author declaring anything — see `moduleRegistry.requiredBy`.
   */
  /**
   * Modules the interface on screen mounts components from — the shell *and* its sections.
   *
   * The sections have to be walked separately now that they are not part of the shell's own schema.
   * Missing them would break two things quietly: `missingModules` would stop reporting a real gap,
   * and — worse — the guard in `setModuleInstalled` would stop refusing. Uninstalling the globe
   * module while a space has the globe section enabled would then succeed, and that section would
   * render nothing with nothing to say why, which is exactly the failure the guard exists for.
   */
  const requiredModules = createMemo<string[]>(() => {
    const required = new Set(moduleRegistry.requiredBy(templateStore.currentTemplate));
    for (const view of spaceViews()) {
      for (const id of moduleRegistry.requiredBy(view.schema)) required.add(id);
    }
    return [...required];
  });

  /**
   * Modules this template needs that the agent has not installed.
   *
   * The state that had no name before: a template mounting a component no installed module provides
   * renders nothing where that component should be, with nothing to say why. Naming it is what makes
   * a "you need this module" prompt possible.
   */
  const missingModules = createMemo<string[]>(() => {
    const installed = installedSet();
    return requiredModules().filter((id) => !installed.has(id));
  });

  /** Turn a module on or off for this agent everywhere. See `AgentSettings.installedModules`. */
  async function setModuleInstalled(moduleId: string, installed: boolean): Promise<void> {
    // Refused rather than warned: uninstalling a module the visible template mounts takes the
    // component out from under it, and the route stops rendering with nothing to explain why. This
    // guard is what makes a capability module safe to offer a switch for at all.
    if (!installed && requiredModules().includes(moduleId)) {
      const name = moduleRegistry.get(moduleId)?.definition.name ?? moduleId;
      const template = templateStore.currentTemplate.meta?.name ?? 'current';
      toastService.error(`${name} can't be turned off — the ${template} template uses it`);
      return;
    }
    const next = new Set(installedModules());
    if (installed) next.add(moduleId);
    else next.delete(moduleId);
    // Writes the resolved list, so the first toggle pins whatever was on by fallback — the same
    // reason `setModuleEnabled` does, and the same consequence: a module added to the seed later
    // will not silently appear for an agent who has already decided.
    await datasetStore.updateAgentSettings({ installedModules: JSON.stringify([...next]) });
  }

  /**
   * Write one agent-private choice about one space, creating the record if it is the first.
   *
   * Always the root dataset, never the space — these are mine, and putting them in the shared
   * perspective would tell every other member which modules I muted and which theme I use.
   */
  async function updateSpacePreference(uuid: string, updates: Partial<SpacePreference>): Promise<void> {
    const root = datasetStore.rootDataset();
    if (!root) return;
    try {
      const existing = preferenceFor(uuid);
      if (existing) await SpacePreference.update(root.handle, existing.id, updates);
      else await SpacePreference.create(root.handle, { spaceUuid: uuid, ...updates });
      setSpacePreferences(await SpacePreference.findAll(root.handle));
    } catch (error) {
      console.error('SpaceStore: could not persist space preference', error);
    }
  }

  /**
   * Show or hide a module for this agent in one space.
   *
   * Phrased as *visible* rather than *muted* so it takes what a switch emits directly —
   * `{ $: 'event.detail' }` bare — and a template never has to invert a boolean to say what it
   * means. Storage stays a list of exclusions; the inversion happens here, where it can be seen.
   */
  async function setModuleVisible(moduleId: string, visible: boolean, spaceUuid?: string): Promise<void> {
    const uuid = spaceUuid ?? datasetStore.currentDataset()?.id;
    if (!uuid) return;
    const next = new Set(mutedModulesFor(uuid));
    if (visible) next.delete(moduleId);
    else next.add(moduleId);
    await updateSpacePreference(uuid, { mutedModules: JSON.stringify([...next]) } as Partial<SpacePreference>);
  }

  /**
   * The theme a template asks to be seen in, if this agent allows it and actually has that theme.
   *
   * A suggestion resolved live, never written — which is what makes template switching
   * non-destructive: switching away and back restores the previous look by recomputation, and
   * nobody's stored choice is touched on the way.
   *
   * A suggestion naming a theme this agent has not installed resolves to nothing rather than
   * failing, mirroring how `?theme=` in a share link degrades. The caller reports it once.
   */
  /**
   * The suggestion, read off the template **actually rendering**.
   *
   * `templateStore.currentTemplate` rather than `resolveTemplateFor(uuid)`, because those disagree
   * on the path people actually use: the switcher calls `templateStore.switchTemplate`, which
   * writes `AgentSettings.currentTemplateId` and leaves `SpacePreference.templateId` alone. Reading
   * the preference meant the suggestion was computed from the space's default template while the
   * agent was looking at the one they had just picked — so applying a template changed nothing.
   *
   * Only meaningful for the space on screen; `currentTemplate` is a single global. For any other
   * space this returns nothing, which is right rather than merely safe: the only caller that passes
   * a different uuid is `setSpaceThemeOverride`, which is writing a pin that outranks the
   * suggestion anyway.
   */
  const templateThemeFor = (uuid: string): string => {
    if (!themeStore.useTemplateTheme()) return '';
    if (datasetStore.currentDataset()?.id !== uuid) return '';
    const suggested = templateStore.currentTemplate?.meta?.themeId;
    if (!suggested) return '';
    return themeStore.allThemes().some((t) => t.id === suggested) ? suggested : '';
  };

  /**
   * Everything the precedence rule needs for one space, read off the signals.
   *
   * Split out from `resolveThemeFor` so the same inputs can be asked a second question with one
   * field changed — see `unpinnedThemeFor`.
   */
  const themeResolutionInput = (uuid: string): ThemeResolutionInput => {
    const current = datasetStore.currentDataset()?.id === uuid ? templateStore.currentTemplate?.id : undefined;
    const spaceDefault = spaceForUuid(uuid)?.defaultTemplateId || '';
    return {
      themeOverride: themeOverrideFor(uuid),
      // For a space that is not on screen there is no rendering template to compare, so fall back
      // to what the preferences say would apply there.
      templateIsSpaceDefault:
        current !== undefined ? current === spaceDefault : templateOverrideFor(uuid) === FOLLOW_SPACE,
      spaceTheme: spaceForUuid(uuid)?.defaultThemeId || '',
      templateTheme: templateThemeFor(uuid),
      agentTheme: themeStore.defaultThemeId(),
      agentDefaultSentinel: AGENT_DEFAULT,
      followSpaceSentinel: FOLLOW_SPACE,
    };
  };

  /**
   * Which theme this agent sees in one space.
   *
   * The precedence itself lives in `resolveSpaceTheme` — a pure function, because the rule is the
   * feature and it was designed wrong once. This reads the signals it needs and hands them over.
   */
  const resolveThemeFor = (uuid: string): string => resolveSpaceTheme(themeResolutionInput(uuid));

  /**
   * What the space would show if this agent had not pinned a theme here.
   *
   * Only used to decide whether a pin is worth *mentioning*: one that happens to name what would
   * have applied anyway is overriding nothing, and saying so would put a "reset" control in front
   * of someone with nothing to reset. Asks the rule rather than comparing against the space default
   * by hand, so it stays right as the precedence grows.
   */
  const unpinnedThemeFor = (uuid: string): string =>
    resolveSpaceTheme({ ...themeResolutionInput(uuid), themeOverride: FOLLOW_SPACE });

  /**
   * Is this agent's theme for the space on screen a pin that diverges from what would otherwise
   * apply — i.e. is there something for a "reset" to actually undo?
   *
   * False outside a space, false for the two sentinels (neither is a pin), and false for a pin that
   * agrees with the resolution. Note it can become true later without anyone touching it: an
   * administrator changing the space's default is exactly when a pin starts mattering, and that is
   * exactly when it should start being visible.
   */
  const spaceThemePinned = createMemo<boolean>(() => {
    const uuid = datasetStore.currentDataset()?.id;
    if (!uuid) return false;
    const pin = themeOverrideFor(uuid);
    if (pin === FOLLOW_SPACE || pin === AGENT_DEFAULT) return false;
    return pin !== unpinnedThemeFor(uuid);
  });

  /**
   * Override the template this agent sees in one space. {@link FOLLOW_SPACE} returns to its default.
   *
   * Applied immediately when the space is the one on screen, so the choice is visible where it was
   * made; otherwise it takes effect next time that space is opened.
   */
  async function setSpaceTemplateOverride(templateId: string, spaceUuid?: string): Promise<void> {
    const uuid = spaceUuid ?? datasetStore.currentDataset()?.id;
    if (!uuid) return;
    await updateSpacePreference(uuid, { templateId } as Partial<SpacePreference>);
    if (datasetStore.currentDataset()?.id !== uuid) return;
    const template = templateStore.allTemplates().find((t) => t.id === resolveTemplateFor(uuid));
    if (template) templateStore.replaceTemplate(template);
  }

  /** Override the theme this agent sees in one space. {@link FOLLOW_SPACE} returns to its default. */
  async function setSpaceThemeOverride(themeId: string, spaceUuid?: string): Promise<void> {
    const uuid = spaceUuid ?? datasetStore.currentDataset()?.id;
    if (!uuid) return;
    await updateSpacePreference(uuid, { themeId } as Partial<SpacePreference>);
    if (datasetStore.currentDataset()?.id !== uuid) return;
    const effective = resolveThemeFor(uuid);
    // Explicit: this is only reached by someone choosing a theme, so it outranks an editing
    // session on a different one. The recompute-on-entering-a-space path deliberately does not.
    if (effective) themeStore.replaceTheme(effective, { explicit: true });
    else themeStore.clearSpaceTheme();
  }

  /**
   * Apply a theme *where the agent is* — what the rail's theme picker does.
   *
   * In a space this pins it there; outside one it sets their global default. The picker is a
   * contextual control in contextual chrome, so "here" is the only reading of a click in it that
   * does not surprise: the alternative — rewriting the global default from inside a space — makes
   * per-space themes reachable only from Settings, which is backwards for the commonest act there is.
   *
   * A store method rather than a `$if` in the schema because `$if` inside an action's args resolves
   * at render time, so it would freeze whichever branch happened to be true when the picker painted.
   * Only the store can ask "where am I" at the moment of the click.
   *
   * Persisting at all is the point. This used to call `themeStore.setCurrentTheme`, which sets a
   * signal and writes nothing — so the choice survived exactly until something recomputed the space
   * theme, and `AgentSettings.currentThemeId` sat in the model unwritten while its twin
   * `currentTemplateId` was persisted by the template picker sitting beside it.
   */
  async function applyTheme(themeId: string): Promise<void> {
    const uuid = datasetStore.currentDataset()?.id;
    if (uuid) await setSpaceThemeOverride(themeId, uuid);
    else themeStore.setDefaultTheme(themeId);
  }

  /**
   * Drop this agent's theme pin for the space on screen, returning it to whatever would otherwise
   * apply — the way back out of {@link applyTheme}.
   *
   * Exists so the picker can offer the escape hatch without naming {@link FOLLOW_SPACE}: a sentinel
   * spelled into a schema is a literal that no longer moves when the constant does.
   */
  async function clearSpaceThemePin(): Promise<void> {
    const uuid = datasetStore.currentDataset()?.id;
    if (uuid) await setSpaceThemeOverride(FOLLOW_SPACE, uuid);
  }

  /*
    Tell the shell which modules' chrome is live here.

    The same predicate `gateOnSpace` wraps every module slot in — enabled here, *or* the module says
    it is holding on regardless (`holdsWhen`, which is how a call keeps its bar in a space that
    never enabled calls). Only this store can answer it, and `ShellStore` mounts above this one, so
    it is injected rather than read.

    Without it, a dock's frame unmounted on a space switch and its *request* did not, so
    `contentInset` went on reserving room for a panel that was no longer there — with the close
    button inside the frame that had gone. See `ShellStore.moduleGate`.
  */
  createEffect(() => {
    const on = new Set(activeModules());
    shellStore.provideModuleGate((moduleId: string) => {
      if (on.has(moduleId)) return true;
      const definition = moduleRegistry.all().find((m) => m.definition.id === moduleId)?.definition;
      // `holdsWhen` is a full store path (`modules.call.active`); only its final key is a store member.
      const key = definition?.holdsWhen?.split('.').pop();
      return read(moduleId, key, false);
    });
  });

  const moduleLaunchers = createMemo(() => {
    const on = new Set(activeModules());
    return moduleRegistry
      .all()
      .filter(({ definition }) => definition.launcher && on.has(definition.id))
      .filter(({ definition }) => read(definition.id, definition.launcher!.availableWhen, true))
      .map(({ definition }) => {
        const launcher = definition.launcher!;
        const active = read(definition.id, launcher.activeWhen, false);
        return {
          id: definition.id,
          icon: launcher.icon,
          // The active label where there is one, so a tooltip cannot describe an act the button has
          // stopped performing. Most launchers declare none and this is `label` in both states.
          label: (active && launcher.activeLabel) || launcher.label,
          active,
        };
      });
  });

  /**
   * Invoke a module's launcher.
   *
   * Here rather than in the schema because `$action` resolves a *literal* path, so a rail iterating
   * over modules cannot build `modules.<id>.<method>` per entry. The rail passes the id instead and
   * this dereferences it.
   */
  function launchModule(moduleId: string) {
    const definition = moduleRegistry.get(moduleId)?.definition;
    const action = definition?.launcher?.action;
    if (!action) return;
    const store = moduleStores[moduleId] as Record<string, unknown> | undefined;
    const fn = store?.[action];
    if (typeof fn === 'function') (fn as () => void)();
    else console.warn(`module "${moduleId}" declares launcher action "${action}" but its store has no such method`);
  }

  /**
   * Turn automatic extraction on or off for a space.
   *
   * Takes the value rather than toggling, so a `we-switch` can pass `$event.detail` straight
   * through — the same reason `setThemeScopeGlobal` does. Same failure handling as
   * `setModuleEnabled`: a switch that reports success without persisting is worse than one that
   * fails visibly, because the next member to open the page sees the old decision.
   */
  async function setAutoInterpret(enabled: boolean, spaceUuid?: string) {
    const ds = targetDataset(spaceUuid);
    const space = ds ? mySpaces().find((s) => isSpaceSelf(s, ds)) : undefined;
    if (!ds || !space) return;
    try {
      await Space.update(ds.handle, space.id, { autoInterpret: enabled });
    } catch (error) {
      console.error('SpaceStore: could not persist autoInterpret', error);
      toastService.error('Could not save this change for the space.');
      throw error;
    }
    updateSpaceInCache(ds, { autoInterpret: enabled } as never);
    if (!isCurrent(ds)) return;
    setCurrentSpace((prev) =>
      prev
        ? (Object.assign(Object.create(Object.getPrototypeOf(prev)), prev, { autoInterpret: enabled }) as Space)
        : prev,
    );
  }

  /**
   * Turn extraction diagnostics on or off for the space.
   *
   * Same shape and same failure handling as `setAutoInterpret`, which is the setting it sits beside
   * — a switch that reports success without persisting is worse than one that fails visibly,
   * because the next member to open the page sees the old decision.
   */
  async function setShareExtractionDetail(enabled: boolean, spaceUuid?: string) {
    const ds = targetDataset(spaceUuid);
    const space = ds ? mySpaces().find((s) => isSpaceSelf(s, ds)) : undefined;
    if (!ds || !space) return;
    try {
      await Space.update(ds.handle, space.id, { shareExtractionDetail: enabled });
    } catch (error) {
      console.error('SpaceStore: could not persist shareExtractionDetail', error);
      toastService.error('Could not save this change for the space.');
      throw error;
    }
    updateSpaceInCache(ds, { shareExtractionDetail: enabled } as never);
    if (!isCurrent(ds)) return;
    setCurrentSpace((prev) =>
      prev
        ? (Object.assign(Object.create(Object.getPrototypeOf(prev)), prev, {
            shareExtractionDetail: enabled,
          }) as Space)
        : prev,
    );
  }

  /**
   * Add or remove one model from what this community's calls start out extracting.
   *
   * Writes the resolved list, exactly as `setModuleEnabled` does and for the same two reasons: the
   * first toggle pins whatever was on by fallback — so a space that had never touched the setting
   * keeps `TaskBlock` and `EventBlock` rather than being reduced to the one thing just ticked — and
   * a model that becomes a candidate in a later release does not silently join a space that has
   * already decided.
   */
  async function setExtractionTarget(entity: string, on: boolean, spaceUuid?: string) {
    const ds = targetDataset(spaceUuid);
    const space = ds ? mySpaces().find((s) => isSpaceSelf(s, ds)) : undefined;
    if (!ds || !space) return;
    const current = parseEntityList(space.extractionTargets) ?? LEGACY_EXTRACTION_TARGETS;
    const next = new Set(current);
    if (on) next.add(entity);
    else next.delete(entity);
    const extractionTargetsJson = JSON.stringify([...next]);
    try {
      await Space.update(ds.handle, space.id, { extractionTargets: extractionTargetsJson });
    } catch (error) {
      console.error('SpaceStore: could not persist extractionTargets', error);
      toastService.error('Could not save this change for the space.');
      throw error;
    }
    updateSpaceInCache(ds, { extractionTargets: extractionTargetsJson } as never);
    if (!isCurrent(ds)) return;
    // Republished as a *new* instance, the `setModuleEnabled` idiom: `currentSpace` is a plain
    // signal and Solid dedupes on `===`, so handing back the object just written through notifies
    // nothing — and the settings list, and every call's resolved target list, would keep reading the
    // previous value until something else refetched the space.
    setCurrentSpace((prev) =>
      prev
        ? (Object.assign(Object.create(Object.getPrototypeOf(prev)), prev, {
            extractionTargets: extractionTargetsJson,
          }) as Space)
        : prev,
    );
  }

  async function setModuleEnabled(moduleId: string, enabled: boolean, spaceUuid?: string) {
    const ds = targetDataset(spaceUuid);
    // Read the space from the cache rather than `currentSpace`, so this answers for a space being
    // configured from the spaces list as readily as for the one on screen.
    const space = ds ? mySpaces().find((s) => isSpaceSelf(s, ds)) : undefined;
    if (!ds || !space) return;
    const next = new Set(resolveEnabledModules(space.enabledModules));
    if (enabled) next.add(moduleId);
    else next.delete(moduleId);
    // Writes the resolved list, not a diff — so the first toggle also pins everything that was on by
    // fallback, and a module added to the seed later doesn't silently appear in a space that had
    // already made a decision.
    const enabledModulesJson = JSON.stringify([...next]);
    try {
      await Space.update(ds.handle, space.id, { enabledModules: enabledModulesJson });
    } catch (error) {
      console.error('SpaceStore: could not persist enabledModules', error);
      toastService.error('Could not save this change for the space.');
      // A switch that reports success and does not persist is worse than one that fails visibly:
      // the setting is a community decision, and the next member to open the page sees the old one.
      throw error;
    }
    updateSpaceInCache(ds, { enabledModules: enabledModulesJson } as never);
    if (!isCurrent(ds)) return;
    // Republished as a *new* instance rather than the one just written through. `currentSpace` is a
    // plain signal, so Solid dedupes on `===` — handing back the same object (which is what mutating
    // it in place and re-setting it amounts to) notifies nothing, and the module rail would keep
    // rendering the previous set until something else happened to refetch the space. Same clone
    // idiom as `updateSpaceInCache`.
    setCurrentSpace((prev) =>
      prev
        ? (Object.assign(Object.create(Object.getPrototypeOf(prev)), prev, {
            enabledModules: enabledModulesJson,
          }) as Space)
        : prev,
    );
  }

  /**
   * Add or remove a section from a space — the community's decision, shared with every member.
   *
   * The same shape as `setModuleEnabled`, including writing the *resolved* list rather than a diff,
   * so the first toggle also pins whatever was on by fallback and a view added to a later build does
   * not silently appear in a space that had already decided.
   *
   * Enabling appends. A section arriving at the end is the only placement that is obviously not a
   * claim about importance — inserting it at a remembered index would be one, and there is nothing
   * to remember for a view being turned on for the first time. Reordering is `reorderViews`.
   */
  async function setViewEnabled(viewId: string, enabled: boolean, spaceUuid?: string) {
    const ds = targetDataset(spaceUuid);
    const space = ds ? mySpaces().find((s) => isSpaceSelf(s, ds)) : undefined;
    if (!ds || !space) return;
    const available = availableViews();
    const current = resolveEnabledViews(space.enabledViews, (id) => available.has(id), defaultViewOrder());
    const next = enabled
      ? current.includes(viewId)
        ? current
        : [...current, viewId]
      : current.filter((id) => id !== viewId);
    await writeEnabledViews(ds, space, next);
  }

  /**
   * Set the whole section list at once — what a drag-reorder writes.
   *
   * Takes the order rather than a moved id, because `we-sortable` reports the resulting arrangement
   * and re-deriving it from a move would be a second implementation of the same decision.
   */
  async function reorderViews(viewIds: string[], spaceUuid?: string) {
    const ds = targetDataset(spaceUuid);
    const space = ds ? mySpaces().find((s) => isSpaceSelf(s, ds)) : undefined;
    if (!ds || !space) return;
    /*
      A reorder may only *reorder*. Intersecting with what is already enabled is what stops a drag
      from turning sections on: the settings list holds every available section, so a drag handed
      back the disabled ones too, and writing them wholesale enabled every one of them at a stroke.

      The drag zone now holds only the enabled rows, so this is belt and braces — but it is the half
      that cannot be undone by someone rearranging the schema later.
    */
    const enabled = new Set(
      resolveEnabledViews(space.enabledViews, (id) => availableViews().has(id), defaultViewOrder()),
    );
    await writeEnabledViews(
      ds,
      space,
      viewIds.filter((id) => enabled.has(id)),
    );
  }

  /** The write half both of the above share — persist, cache, and republish the space on screen. */
  async function writeEnabledViews(ds: AppDataset, space: Space, viewIds: string[]) {
    /*
      Sections this build has never heard of go back in, where they were.

      Both callers start from the *resolved* list, which is right — it is what the person acted on —
      and resolving drops ids naming a view this build does not have. Writing that straight back
      persisted the pruning, so one member on an older build flicking one switch removed every
      section their build lacked, for the whole community, with no way back. See
      `preserveUnknownViews`.
    */
    const available = availableViews();
    const merged = preserveUnknownViews(viewIds, parseIdList(space.enabledViews), (id) => available.has(id));
    const enabledViewsJson = JSON.stringify(merged);
    try {
      await Space.update(ds.handle, space.id, { enabledViews: enabledViewsJson });
    } catch (error) {
      console.error('SpaceStore: could not persist enabledViews', error);
      toastService.error('Could not save this change for the space.');
      throw error;
    }
    updateSpaceInCache(ds, { enabledViews: enabledViewsJson } as never);
    if (!isCurrent(ds)) return;
    // A new instance, for the reason `setModuleEnabled` spells out: `currentSpace` dedupes on `===`,
    // so re-setting a mutated object notifies nothing and the nav strip keeps its old sections.
    setCurrentSpace((prev) =>
      prev
        ? (Object.assign(Object.create(Object.getPrototypeOf(prev)), prev, {
            enabledViews: enabledViewsJson,
          }) as Space)
        : prev,
    );
  }

  /**
   * Show or hide a section for **this agent only**, in one space.
   *
   * Private — written to the root dataset, never to the space, so hiding a tab for yourself cannot
   * remove it for anybody else. Phrased positively so a `we-switch` can pass `$event.detail` bare;
   * wrapping it in another token would evaluate at render time and send a constant.
   */
  async function setViewVisible(viewId: string, visible: boolean, spaceUuid?: string): Promise<void> {
    const uuid = spaceUuid ?? datasetStore.currentDataset()?.id;
    if (!uuid) return;
    const next = new Set(hiddenViewsFor(uuid));
    if (visible) next.delete(viewId);
    else next.add(viewId);
    await updateSpacePreference(uuid, { hiddenViews: JSON.stringify([...next]) } as Partial<SpacePreference>);
  }

  // Subscribe to current space data reactively whenever the dataset changes.
  // include: { location: true } so AboutRoute can access location without a separate query.
  createEffect(() => {
    const ds = datasetStore.currentDataset();
    if (!ds || !datasetStore.isWeSpace()) {
      setCurrentSpace(null);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder = (Space as any).query(ds.handle, { where: spaceSelfWhere(ds), include: { location: true } }) as {
      subscribe: (cb: (results: Space[]) => void) => Promise<Space[]>;
      dispose: () => void;
    };
    const handleResult = (results: Space[]) => setCurrentSpace(results[0] ?? null);
    builder
      .subscribe(handleResult)
      .then(handleResult)
      .catch(() => setCurrentSpace(null));
    onCleanup(() => builder.dispose());
  });

  const [memberDids, setMemberDids] = createSignal<string[]>([]);
  const [spaceDefaultTemplateId, setSpaceDefaultTemplateId] = createSignal<string>('');
  const [spaceDefaultThemeId, setSpaceDefaultThemeId] = createSignal<string>('');

  // Derive from currentSpace; signals remain writable for optimistic updates
  createEffect(() => setSpaceDefaultTemplateId(currentSpace()?.defaultTemplateId ?? ''));
  createEffect(() => setSpaceDefaultThemeId(currentSpace()?.defaultThemeId ?? ''));

  /**
   * The answer the theme effect below acts on: which theme applies where the agent is, and the
   * identity of the place it applies to.
   *
   * A memo with an explicit `equals` rather than the resolution inline in the effect, and that is
   * the whole fix for a class of bug rather than a tidy-up. `resolveThemeFor` reaches through
   * several stores, and any raw `agentSettings()` read anywhere down that path made this effect a
   * subscriber to *every* agent-settings write — and `agentSettings` is deliberately
   * `{ equals: false }`, so it notifies on every write whether or not anything changed. Toggling
   * the theme scope switch, turning a module on, switching a template: each re-ran the resolution
   * and pushed its answer over whatever the agent had actually chosen. Guarding on the resolved
   * *value* fixes that for good, where a hand-maintained dependency list would only fix today's
   * path and drift the first time the precedence grows a new input.
   *
   * Space identity is part of the value rather than merely tracked, because moving between two
   * spaces that resolve to the same theme must still re-apply it: something else may have set the
   * theme out of band in the meantime (a `?theme=` link, a theme being deleted), and arriving
   * somewhere new is when that should be corrected.
   */
  const resolvedSpaceTheme = createMemo(
    (): { datasetId: string; spaceUuid: string; themeId: string } => {
      // This agent's own choice for this space wins over the community's default — that is what an
      // override is for. `''` means they have not overridden it, so the space's default stands.
      const datasetId = datasetStore.currentDataset()?.id ?? '';
      return {
        datasetId,
        spaceUuid: currentSpace()?.uuid ?? '',
        themeId: datasetId ? resolveThemeFor(datasetId) : spaceDefaultThemeId(),
      };
    },
    undefined,
    { equals: (a, b) => a.datasetId === b.datasetId && a.spaceUuid === b.spaceUuid && a.themeId === b.themeId },
  );

  // Apply the space's default theme when entering a space, restore personal theme when leaving.
  // Only restore when there's genuinely no current dataset — not during the transient null
  // window while switching between spaces (currentSpace loads async after the dataset changes).
  createEffect(() => {
    const { datasetId, themeId } = resolvedSpaceTheme();
    if (themeId) {
      themeStore.replaceTheme(themeId);
    } else if (!datasetId) {
      themeStore.restorePersonalTheme();
    } else {
      // In a space with no default theme — clear any previously scoped space theme.
      themeStore.clearSpaceTheme();
    }
  });

  /**
   * Say once when a template asks for a theme this agent does not have.
   *
   * Separate from the effect that applies the theme, because that one runs on every space switch
   * and every preference write — a toast in there would repeat. Reported per theme id, matching how
   * `TemplateProvider` handles a `?theme=` suggestion it cannot honour: the intent is degraded
   * rather than silently dropped, and said no more than once.
   *
   * Gated on `allThemes()` being populated so the boot frame, where nothing is loaded yet, does not
   * read as "you don't have it".
   */
  const reportedMissingThemes = new Set<string>();
  createEffect(() => {
    if (!themeStore.useTemplateTheme()) return;
    const uuid = datasetStore.currentDataset()?.id;
    if (!uuid) return;
    const themes = themeStore.allThemes();
    if (!themes.length) return;

    const suggested = templateStore.currentTemplate?.meta?.themeId;
    if (!suggested || themes.some((t) => t.id === suggested)) return;
    if (reportedMissingThemes.has(suggested)) return;

    reportedMissingThemes.add(suggested);
    toastService.warning(`This template suggests a theme ("${suggested}") you don't have — using your own.`);
  });

  async function setSpaceDefaultTemplate(templateId: string, spaceUuid?: string): Promise<void> {
    const ds = targetDataset(spaceUuid);
    if (!ds) return;
    // Switching what is on screen is only right when the space being configured is the one on
    // screen. Setting another space's default from the spaces list must not repaint the app.
    if (isCurrent(ds)) {
      setSpaceDefaultTemplateId(templateId);
      const template = templateStore.allTemplates().find((t) => t.id === templateId);
      if (template) templateStore.replaceTemplate(template);
    }
    // Keep mySpaces cache in sync so template pre-loading uses the fresh defaultTemplateId
    updateSpaceInCache(ds, { defaultTemplateId: templateId } as never);
    const [space] = await Space.findAll(ds.handle, { where: spaceSelfWhere(ds) });
    if (space) await Space.update(ds.handle, space.id, { defaultTemplateId: templateId });
  }

  async function setSpaceDefaultTheme(themeId: string, spaceUuid?: string): Promise<void> {
    const ds = targetDataset(spaceUuid);
    if (!ds) return;
    if (isCurrent(ds)) setSpaceDefaultThemeId(themeId);
    updateSpaceInCache(ds, { defaultThemeId: themeId } as never);
    const [space] = await Space.findAll(ds.handle, { where: spaceSelfWhere(ds) });
    if (space) await Space.update(ds.handle, space.id, { defaultThemeId: themeId });
  }

  // Load neighbourhood members whenever the current dataset changes
  createEffect(() => {
    const ds = datasetStore.currentDataset();
    const lifecycle = session.lifecycle();
    const myDid = session.me()?.did;
    if (!ds || !lifecycle?.members) {
      setMemberDids(myDid ? [myDid] : []);
      return;
    }
    lifecycle
      .members(ds.id)
      .then((dids: string[]) => {
        const allDids = myDid ? [...new Set([myDid, ...dids])] : dids;
        setMemberDids(allDids);
        for (const did of allDids) {
          profileStore.fetchProfile(did);
        }
      })
      .catch(() => {
        setMemberDids(myDid ? [myDid] : []);
      });
  });

  // Map memberDids to cached AgentProfileSummary entries
  const members = createMemo<AgentProfileSummary[]>(() => {
    const cached = profileStore.profiles();
    return memberDids()
      .map((did) => cached.find((a) => a.did === did))
      .filter((a): a is AgentProfileSummary => a != null);
  });

  /**
   * The space this route points at is one the agent has not joined — as a settled fact, not a
   * momentary absence.
   *
   * A join gate cannot key off `currentDataset` being null, because that is also true for the first
   * frames of a refresh: the dataset list is still arriving, and then the switch to the matching
   * dataset is itself async. Someone reloading a space they are already in got "Join this Space"
   * flashed at them in the gap.
   *
   * So this is false while the answer is unknown, and a gate reading it renders nothing until there
   * is something true to say. Both halves matter — the list having arrived, and no dataset in it
   * matching the route — because a matching dataset that has not been switched to yet is also not
   * grounds for asking someone to join.
   */
  /**
   * The path a space's own pages hang off — `/space/<segment>`, or empty outside a space.
   *
   * Exists because a template cannot build one. A link to a record has to be absolute (a browser
   * resolves a relative `href` against the current *URL*, which is wrong the moment a section has
   * sub-routes of its own), and the space's segment is not a value a schema can reach: for a shared
   * space it is the neighbourhood CID, for a personal one the dataset id, and only the URL says
   * which this is.
   *
   * The segment as it currently appears rather than one recomputed from the dataset, so a link
   * built here lands in the same space the reader is already looking at — following the shape
   * `TemplateProvider` itself uses when it redirects to a space's first section.
   */
  const spacePath = createMemo<string>(() => {
    const segs = routeStore.segments();
    return segs[0] === 'space' && segs[1] ? `/space/${segs[1]}` : '';
  });

  const routeSpaceUnjoined = createMemo<boolean>(() => {
    const segs = routeStore.segments();
    if (segs[0] !== 'space' || !segs[1]) return false;
    if (!datasetStore.datasetsLoaded()) return false;
    return !datasetStore.datasets().some((d) => d.id === segs[1] || d.sharedId === segs[1]);
  });

  // Resolve the route segment to a local dataset whenever the route changes.
  // Handles deep links, page refresh, and browser back/forward navigation.
  // For intentional navigation via navigateToSpace, this becomes a no-op
  // (dataset already switched; guard prevents double-call).
  createEffect(() => {
    const segs = routeStore.segments();
    if (segs[0] !== 'space' || !segs[1]) return;
    const seg = segs[1];

    const ds = datasetStore.datasets().find((d) => d.id === seg || d.sharedId === seg);
    if (!ds) {
      // Routing policy, not backend dialect: a segment that isn't a local id is treated as a
      // shared link the agent hasn't joined — clear the current dataset so the join gate shows.
      // Local ids (UUIDs, with hyphens) may just be momentarily missing; leave the view alone.
      if (!seg.includes('-')) datasetStore.clearCurrentDataset();
      return;
    }
    const current = untrack(datasetStore.currentDataset);
    if (current?.id === ds.id) return;
    void (async () => {
      await templateStore.preloadSpaceTemplates(ds);
      await datasetStore.switchDataset(ds.id);
    })();
  });

  // Prefill data for the "Initialize as WE space" gate — detected from a foreign app's own
  // model (currently just Flux's Community) when the current dataset isn't a WE space yet.
  const [foreignSpacePrefill, setForeignSpacePrefill] = createSignal<{
    name: string;
    description: string;
    avatar: string | null;
  } | null>(null);

  createEffect(() => {
    const ds = datasetStore.currentDataset();
    const weSpace = datasetStore.isWeSpace();
    // Force a re-run once the dataset's foreign schemas have been registered — that happens in
    // switchDataset's background pass, strictly before currentDatasetEntities is set, so tracking
    // it here guarantees a second run right when model resolution is ready.
    void datasetStore.currentDatasetEntities();

    if (!ds || weSpace) {
      setForeignSpacePrefill(null);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const CommunityClass = getEntitiesForPerspective('Community', ds.handle) as any;
    if (!CommunityClass) {
      setForeignSpacePrefill(null);
      return;
    }

    CommunityClass.findOne(ds.handle, {})
      .then((instance: { name?: string; description?: string; thumbnail?: string } | null) => {
        if (!instance || untrack(datasetStore.currentDataset)?.id !== ds.id) return;
        setForeignSpacePrefill({
          name: instance.name ?? '',
          description: instance.description ?? '',
          avatar: instance.thumbnail ?? null,
        });
      })
      .catch(() => setForeignSpacePrefill(null));
  });

  const store: SpaceStore = {
    // State
    memberDids,
    members,
    spaceDefaultTemplateId,
    spaceDefaultThemeId,
    currentSpace,
    mySpaces,
    personalSpaces,
    sharedSpaces,
    spaceList,
    routeSpaceUnjoined,
    spacePath,
    creatingSpace,
    joiningSpace,
    joinSlow,
    joinError,
    orderedSidebarItems,
    enabledModules,
    installedModules,
    requiredModules,
    missingModules,
    activeModules,
    templateOverrideOptions,
    themeOverrideOptions,
    spaceThemePinned,
    moduleInstallSettings,
    moduleLaunchers,
    spaceViews,
    routableViews,
    enabledViewIds,
    viewNav,
    foreignSpacePrefill,

    // Actions
    createSpace,
    joinSpace,
    initializeAsWeSpace,
    removeSpace,
    createPost,
    updatePost,
    moveChild,
    setAttending,
    mutedDids,
    mutedAgents,
    setAgentMuted,
    readMarkers: readMarkerRows,
    markRead,
    unreadNodeIds,
    myMentions,
    uploadFile,
    deleteCollection,
    updateSpaceImage,
    updateSpaceMeta,
    setSpaceDefaultTemplate,
    setSpaceDefaultTheme,
    setModuleEnabled,
    autoInterpret,
    setAutoInterpret,
    shareExtractionDetail,
    setShareExtractionDetail,
    extractionTargets,
    setExtractionTarget,
    setModuleInstalled,
    setModuleVisible,
    setViewEnabled,
    setViewVisible,
    reorderViews,
    setSpaceTemplateOverride,
    setSpaceThemeOverride,
    applyTheme,
    clearSpaceThemePin,
    launchModule,
    createSignalType,
    createRelationshipType,
    setSignalTypeRetired,
    upsertSignal,
    navigateToSpace,
    openRecordRef,
    canAdministerSpace,
    canAdministerCurrentSpace,
    copyShareLink,
    copyGuestLink,
    getSubgroupMessages,
    exportCallTranscript,
    removeSpaceFromGlobal,
    updateSpaceInCache,

    loadSpaces,
  };

  return <SpaceContext.Provider value={store}>{props.children}</SpaceContext.Provider>;
}

export function useSpaceStore(): SpaceStore {
  const context = useContext(SpaceContext);
  if (!context) throw new Error('useSpaceStore must be used within a SpaceProvider');
  return context;
}

export default SpaceStoreProvider;
