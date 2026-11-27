/**
 * What `spaceStore` offers a template: the spaces the agent holds, the one on screen and how to go to
 * one, what each space runs and shows, its task states, involvements, roles and policy, what it
 * extracts, what people make in it, and what is unread in it.
 *
 * Several jobs over one surface. Each is a part of its own under `space/`, a factory over the
 * reactivity port; this file is the surface they are composed into — which the generated context and
 * the template surface read every `*Store` interface from — and the composition, built once by
 * `composeStores`.
 */
import type { AgentProfileSummary } from '@we/backend-shared';
import type { FileData, InvolvementSemantic, MutedAgent, Space } from '@we/entities';
import type { Accessor, ReactivityPort } from '@we/reactivity';
import type { ResolvedView } from '@we/schema-shared';

import type { FirstScreen } from '../firstScreen';
import type { InvolvementTypeView } from '../involvements';
import type { SettingRow, SettingValue } from '../moduleSettings';
import type { ModuleSurface } from '../registries/moduleRegistry';
import type { SharingPickerOption } from '../sharingOptions';
import type { signalOrder } from '../signalOrder';
import type { SpaceAppearance } from '../spaceAppearance';
import type { PolicyPreset, SpacePolicyView } from '../spacePolicy';
import type { RoleView } from '../spaceRoles';
import type { LocationData } from '../spaceSync';
import type { TaskWorkflowLive } from '../taskWorkflowLive';
import type { Toasts } from '../toasts';
import type { AppDataset } from './DatasetStore';
import { createCallExports } from './space/callExports';
import { createSpaceContent, type SpaceContentDeps } from './space/content';
import { createSpaceContext, type SpaceContext, type SpaceDatasets, type SpaceSession } from './space/context';
import { createSpaceDetails, type SpaceDetailsDeps } from './space/details';
import { createSpaceExtraction, type SpaceExtractionDeps } from './space/extraction';
import { createSpaceInvolvements } from './space/involvements';
import { createSpaceModules, type SpaceModulesDeps } from './space/modules';
import { createSpaceNavigation, type SpaceNavigationDeps } from './space/navigation';
import { createSpaceOnScreen } from './space/onScreen';
import { createSpaceRoles } from './space/roles';
import { createSpaceList, type SpaceListDeps } from './space/spaces';
import { createSpaceTaskStates, type SpaceTaskStatesDeps } from './space/taskStates';
import type {
  CreatePostOptions,
  LauncherRow,
  SpaceListEntry,
  SpaceMetaUpdate,
  StarterOption,
  TaskStateView,
} from './space/types';
import { createSpaceUnread } from './space/unread';
import { createSpaceWrites } from './space/writes';

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
  /**
   * The states this community's work moves through: its `TaskState` records, which a new space's
   * starter writes. Ordered by the community's own order, else open, then active, then done. Includes withdrawn states, so a task sitting in
   * one still resolves; use `offeredTaskStates` for anything a person picks from.
   */
  taskStates: Accessor<TaskStateView[]>;
  /** The same list without the withdrawn ones — what a picker or a new column should offer. */
  offeredTaskStates: Accessor<TaskStateView[]>;
  /** The space has been asked for its states. An empty list is otherwise "not fetched yet". */
  taskStatesLoaded: Accessor<boolean>;
  /**
   * The kinds of part a person can have in a record — assigned, reviewing, going, maybe: the space's
   * `InvolvementType` records, which a new space's starter writes. Includes withdrawn kinds, so an
   * involvement somebody still holds resolves; offer `offeredInvolvementTypes` instead.
   */
  involvementTypes: Accessor<InvolvementTypeView[]>;
  /** The same list without the withdrawn ones — what an assign menu or an RSVP control offers. */
  offeredInvolvementTypes: Accessor<InvolvementTypeView[]>;
  /** The space has been asked for its kinds. */
  involvementTypesLoaded: Accessor<boolean>;
  /**
   * The standings people hold across the space — admin, moderator, whatever this community names —
   * each with the people holding it: `{ id, slug, name, description, holders }`. Admin first.
   *
   * The host's own view, behind `myRoles`, the policy and who administers the space. A template
   * reads the space's `Role` and `RoleGrant` records with a query.
   */
  roles: Accessor<RoleView[]>;
  /** The slugs of the roles the viewer holds here. */
  myRoles: Accessor<string[]>;
  /** The space has been asked for its roles. An empty list is otherwise "not fetched yet". */
  rolesLoaded: Accessor<boolean>;
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
  /**
   * Launchers for the modules enabled here — what the module rail renders.
   *
   * `concealed` is the launcher's panel being open and out of sight: a background tab of a stack,
   * folded to its bar, or in a lane collapsed to its edge. The rail lights a button only when it is
   * not, because a lit button says "pressing me puts this away" — and pressing one whose panel is
   * concealed brings the panel into sight instead. See `launchModule`.
   */
  moduleLaunchers: Accessor<LauncherRow[]>;
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
  /**
   * How a shared space can sync, as picker entries: label, icon and a description per template, and
   * for one syncing through a server, the servers to pick from.
   */
  sharingOptions: Accessor<SharingPickerOption[]>;
  /** The sharing option publishing uses when none is chosen — one of `sharingOptions`. */
  defaultSharing: Accessor<string>;

  /**
   * What a space made now can start with, the default first: the app's kit when the app in use
   * brings one, the deployment's own, and nothing. Each says what it writes (`includes`), counted
   * from its records. Pass a choice's `id` to `createSpace`; a space is the community's, so the
   * create dialog shows what it starts with rather than letting the app decide silently.
   */
  starterChoices: Accessor<StarterOption[]>;

  // Actions
  /**
   * Create a space and resolve with its id once the local space exists — sharing a shared one
   * follows on the network, reported on `spaceList`. It does not navigate: the create dialog goes
   * to the space with `navigateToSpace`, and a caller making one as part of something else need not.
   *
   * `server` is the http(s) address a server sharing option syncs through, '' or absent for its
   * default. One that is not an http(s) address rejects before anything is created.
   */
  createSpace: (
    name: string,
    description: string,
    access: 'personal' | 'shared',
    discovery: 'hidden' | 'listed',
    avatarFile?: File,
    coverImageFile?: File,
    location?: LocationData | null,
    sharing?: string,
    server?: string,
    starter?: string,
  ) => Promise<string | undefined>;
  /**
   * Share a space that is still local — what retries a share that failed. Uses the sharing option
   * and listing the failed attempt had. Watch `spaceList[].sharing` for how it is going.
   */
  shareSpace: (uuid: string) => Promise<void>;
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
   * where somebody double-clicked, scrolling to it, selecting it — since `$invoke`'s `onSuccess`
   * reads the resolved value as `$result`. Written by `core.createPost`, which answers with the post's
   * id; a reply is threaded in the same write.
   */
  createPost: (json: unknown, options?: CreatePostOptions) => Promise<string | undefined>;
  updatePost: (postId: string, json: unknown) => Promise<void>;
  /** The board for a container, or the space's own, making it if nobody has yet. Returns its id. */
  openBoardFor: (anchorId?: string, title?: string, dataset?: string) => Promise<string>;
  /** Make sure a container has a board, but only once it holds a task. What extraction calls. */
  ensureBoardFor: (collectionId: string, dataset?: string) => Promise<string>;
  /** Give the space's own board a column for a newly named state. Host wiring, called by createTaskState. */
  addStateToSpaceBoard: (slug: string, name: string) => Promise<void>;
  /** Take a column off a board. The column record only — never the work positioned in it. */
  removeBoardColumn: (boardId: string, columnId: string) => Promise<void>;
  /**
   * Move a card between columns — and write its state, when the column it joins names one. A store
   * action because a staged suggestion for the state is settled first and a workflow's state asks
   * rather than writes; see `shared/boards.ts`.
   */
  moveCardToColumn: (
    fromColumnId: string,
    toColumnId: string,
    cardId: string,
    orderedIds?: string[],
    columnOrder?: string[],
  ) => Promise<void>;
  /** Make a task straight into a column, parented to the board's anchor when there is one. */
  addTaskToColumn: (columnId: string, title: string, anchorId?: string) => Promise<void>;
  /**
   * Join or leave a node's participant roster — an RSVP. Writes only this agent's own entry, which
   * is what keeps the roster conflict-free without coordination.
   */
  setAttending: (nodeId: string, attending: boolean) => Promise<void>;
  /**
   * DIDs this agent has muted, everywhere. Private, held in the root dataset.
   *
   * A feed filters on this before rendering — `{ $: '!(post.author in identity.mutedDids)' }`. Hiding on
   * this agent's screen only: a shared space is writable by every member, so nothing here
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
   * Asked from the agent's end through the backend's references — one lookup, and it finds a
   * mention in a transcript line or a Feed message as well as in a post. Newest first, the fifty
   * most recent. A backend without references falls back to filtering the space's containers, which
   * misses lines.
   */
  /** `createdAt` is the backend's comparable timestamp, in epoch milliseconds. */
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
  /**
   * What the space's record stores for a picture the person chose, sized for the field; for
   * `ops.core.setSpaceImage` to write. Stores nothing itself.
   */
  prepareSpaceImage: (field: 'avatar' | 'coverImage', image: File) => Promise<FileData>;
  /** Every space-scoped write takes an optional target uuid; omitted means the space on screen. */
  updateSpaceMeta: (updates: SpaceMetaUpdate, spaceUuid?: string) => Promise<void>;
  setModuleEnabled: (moduleId: string, enabled: boolean, spaceUuid?: string) => Promise<void>;
  /**
   * What each capability that declares settings is currently set to **for this community**, as rows
   * a screen renders directly: the declaration, the resolved value, where it came from, and whether
   * something less specific has forced it.
   *
   * Built from what modules declare rather than from a list anyone maintains, so a module that adds
   * a setting gets a control with nothing to register — the step whose omission is otherwise silent.
   */
  spaceModuleSettings: Accessor<SettingRow[]>;
  /** The same, for this agent in this one space. Private, and the most specific level there is. */
  myModuleSettings: Accessor<SettingRow[]>;
  /** The same, for this agent in every space. Private, and the least specific of the personal two. */
  agentModuleSettings: Accessor<SettingRow[]>;
  /**
   * Set one of this space's module settings, for everyone. Omit `value` to withdraw the opinion.
   *
   * Clearing writes **silence**, not a value: a stored `false` that happens to equal the default
   * goes on overruling every less specific level while its control reads as untouched.
   */
  setSpaceModuleSetting: (group: string, key: string, value?: SettingValue, spaceUuid?: string) => Promise<void>;
  /** The same, for this agent here. Never written to the space, so no other member sees it. */
  setMyModuleSetting: (group: string, key: string, value?: SettingValue, spaceUuid?: string) => Promise<void>;
  /** The same, for this agent everywhere. */
  setAgentModuleSetting: (group: string, key: string, value?: SettingValue) => Promise<void>;
  /**
   * Whether a new collection here — a call, a channel — starts out interpreted as it grows. A
   * community default, copied onto each collection when it is made; see `autoInterpretFor` for the
   * answer that counts.
   */
  autoInterpret: Accessor<boolean>;
  /**
   * The id of this space's collection — the one everything top-level hangs off (`Space.root`). Empty
   * outside a space, and in a space made before spaces had one.
   */
  root: Accessor<string>;
  /**
   * The records this space names by landmark, as name → id: `landmarks.canvas` is the space's canvas. A landmark
   * the space never named is simply absent.
   *
   * The host's own read, for deciding where content made on the space's canvas lives. A template
   * reads the `SpaceLandmark` records with a query instead, which every host answers.
   */
  landmarks: Accessor<Record<string, string>>;
  /** The landmarks have answered for the space on screen: an absent one means "none" rather than "not yet". */
  landmarksLoaded: Accessor<boolean>;
  /**
   * `root` has answered for the space on screen — the collection's id, or '' for a space with none.
   * Until then an empty `root` means "not known yet". Gate anything that compares an address with
   * `root` on this: deciding before it is known chose the wrong branch, mounted it, sent its reads,
   * then tore it down and mounted the right one.
   */
  rootLoaded: Accessor<boolean>;
  /**
   * The first screen after boot is up — the Feed's first page drawn, or the screen drawn with no Feed
   * on it; see `shared/firstScreen.ts`. True from then on, and true from the start when nothing held
   * it. For a template's `when` on a read its first screen does not draw (a sidebar's list), so the
   * read starts once that screen is up rather than beside it.
   */
  firstScreenOpen: Accessor<boolean>;
  /**
   * Whether one collection — a call, a channel, the space's own — is interpreted as it grows: its own
   * answer, copied from the space's default when it was made. False until it has been read.
   */
  autoInterpretFor: (collectionId: string) => boolean;
  /**
   * Turn it on or off for one collection, for everyone in it. A call's participants decide for their
   * call; the space collection is the community's, so only somebody who administers the space can.
   */
  setAutoInterpretFor: (collectionId: string, on: boolean) => Promise<void>;
  /** Whether this agent may change what one collection extracts — see `setAutoInterpretFor`. */
  canSetInterpretationFor: (collectionId: string) => boolean;
  setAutoInterpret: (enabled: boolean, spaceUuid?: string) => Promise<void>;
  setThreadMode: (mode: string, spaceUuid?: string) => Promise<void>;
  /**
   * Which models a new collection here starts out extracting.
   *
   * The middle of three layers: the codebase says what is a *candidate*
   * (`shapeStore.interpretationCandidates`), this says which of them a new conversation begins with, and
   * each collection then holds its own list, which its participants change. Always intersected with
   * the candidates, so a model since deleted cannot reach a pass and fail it.
   *
   * A community decision, readable by every member; writing it is space-settings. Unset falls back
   * to the two classes that were hardcoded before the setting existed, so nothing regresses.
   */
  interpretationTargets: Accessor<string[]>;
  setInterpretationTarget: (entity: string, on: boolean, spaceUuid?: string) => Promise<void>;
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
  launchModule: (moduleId: string) => void;
  /** Withdraw a signal type from use, or bring it back. Never removes the signals given with it. */
  setSignalTypeRetired: (signalTypeId: string, retired: boolean) => Promise<void>;
  /**
   * Name a state this community's work moves through. Refused for a slug the space already has.
   * The space's own board gains a column for it.
   */
  createTaskState: (config: {
    name: string;
    semantic?: TaskStateView['semantic'];
    color?: string;
    icon?: string;
  }) => Promise<void>;
  /**
   * Change what a state is called, how it is drawn, or what it counts as — for everyone in the
   * space. By slug, which is the one thing it cannot change: tasks store it. An empty string clears
   * a field, so a colour or an icon can be taken back off.
   */
  updateTaskState: (
    slug: string,
    updates: {
      name?: string;
      icon?: string;
      color?: string;
      semantic?: TaskStateView['semantic'];
      approvals?: number;
      approverKind?: string;
      evidence?: { entity: string; where?: Record<string, string | number | boolean>; via?: string; min?: number }[];
    },
  ) => Promise<void>;
  /**
   * How a task may move between this space's states, in their order — `''` for anywhere, `next`, or
   * `next-and-back` (see `Space.taskWorkflowRule`). Only whoever administers the space; rejects otherwise.
   */
  setTaskWorkflowRule: (rule: '' | 'next' | 'next-and-back') => Promise<void>;
  /** Add something that must be there before a task enters this state — see `TaskState.evidence`. */
  addTaskStateEvidence: (slug: string, requirement: { entity: string; via?: string; min?: number }) => Promise<void>;
  /** Take away the state's evidence requirement at that position in its `evidence`. */
  removeTaskStateEvidence: (slug: string, index: number) => Promise<void>;
  /**
   * Whether this space's task states ask for agreement — some state needs more than one approval, or
   * names whose approval counts. Where they do, a card dragged into such a state waits rather than
   * moving, and the board shows what it is waiting on.
   */
  taskWorkflowEnabled: Accessor<boolean>;
  /** Agree with the move a task is waiting on — the same as dragging it there yourself. */
  approveTaskMove: (taskId: string) => Promise<void>;
  /** Take back this agent's own vote on the move a task is waiting on. Never touches anybody else's. */
  withdrawTaskMove: (taskId: string) => Promise<void>;
  /**
   * The workflows this space has put away, by name (`Space.archivedWorkflows`). An archived workflow keeps its
   * records, which still show and can still finish, but is not offered for starting on anything new.
   */
  archivedWorkflows: Accessor<string[]>;
  /** Put a workflow away, or bring it back. Only whoever administers the space; rejects otherwise. */
  setWorkflowArchived: (name: string, archived: boolean) => Promise<void>;
  /**
   * Withdraw a state from use, or bring it back. Never touches the work sitting in it. By slug, which
   * is what a task and a screen both hold.
   */
  setTaskStateRetired: (slug: string, retired: boolean) => Promise<void>;
  /**
   * Set the order this community reads its states in — the order of a board's columns. An ordered
   * relation, so two people reordering at once converge rather than one write discarding the other.
   * By slug, which is what a task and a screen both hold.
   */
  reorderTaskStates: (orderedSlugs: string[]) => Promise<void>;
  /**
   * Put somebody on a record, or take them off, as a kind one member says about another — assigning
   * a task. `on` is the state wanted rather than a toggle, so a menu passes the opposite of the tick
   * it shows. A reflexive kind is only ever the agent's own answer, and is refused for anybody else.
   */
  setInvolvement: (nodeId: string, agent: string, kind: string, on: boolean) => Promise<void>;
  /** Name a kind of part people can have. Refused for a slug the space already has. */
  createInvolvementType: (config: {
    name: string;
    semantic?: InvolvementSemantic;
    reflexive?: boolean;
    appliesTo?: string;
    icon?: string;
    color?: string;
  }) => Promise<void>;
  /** Change a kind's name, look or meaning. By slug, which it cannot change; an empty string clears. */
  updateInvolvementType: (
    slug: string,
    updates: { name?: string; icon?: string; color?: string; semantic?: InvolvementSemantic; appliesTo?: string },
  ) => Promise<void>;
  /** Withdraw a kind from use, or bring it back — never touching anybody who holds it. */
  setInvolvementTypeRetired: (slug: string, retired: boolean) => Promise<void>;
  navigateToSpace: (spaceId: string, view?: string) => Promise<void>;
  openRecordRef: (ref: string) => Promise<void>;
  /** Whether this agent may change what every member of that space sees. */
  canAdministerSpace: (uuid: string) => boolean;
  /** The same, about the space on screen, as something an expression can read. */
  canAdministerCurrentSpace: Accessor<boolean>;
  /** Name a role this community holds — "Moderator". Only whoever administers the space. */
  createRole: (config: { name: string; description?: string }) => Promise<void>;
  /** Rename a role or change what it says it means. Its slug, which grants hold, stays. */
  updateRole: (slug: string, updates: { name?: string; description?: string }) => Promise<void>;
  /** Give `agent` the role. Only whoever administers the space; holding it already is no change. */
  grantRole: (slug: string, agent: string) => Promise<void>;
  /** Take the role from `agent`. Refused for the last admin — see `cannotRevoke`. */
  revokeRole: (slug: string, agent: string) => Promise<void>;
  /**
   * The space's policy in force — who may do what to its records — as a template reads it:
   * `{ loaded, preset, permissions, frozen, me, roles, sentences }`. Pass it to `can()`.
   */
  policy: Accessor<SpacePolicyView>;
  /** Replace the space's policy with a preset: `open` or `community`. Only whoever may change the rules. */
  setPolicyPreset: (preset: PolicyPreset) => Promise<void>;
  /** Copy a space's share link to the clipboard. No-op for a space that has none. */
  copyShareLink: (uuid: string) => Promise<void>;
  /** Copy a guest invite link — auto-creates account, auto-joins the space. No-op without a host. */
  copyGuestLink: (uuid: string) => Promise<void>;
  /**
   * Write a call's transcript to a `.txt` file and download it.
   *
   * One line per utterance: `name, ISO timestamp: text`, where the name is the speaker's display
   * name and their DID when they have none. Read-only and client-side — it builds the blob and
   * triggers a download rather than writing anywhere the space can see, which is why it is an
   * imperative action instead of something a template can express.
   */
  exportCallTranscript: (callId: string) => Promise<void>;
  /**
   * Write everything interpretation did with a call to a Markdown file and download it: the settings it
   * ran under, the transcript once, every pass (every member's) with its prompt and response verbatim,
   * the records it wrote as they are stored now, and the suggestions still waiting on a decision.
   * Made to be handed to a person or a model investigating why a call extracted what it did.
   */
  exportInterpretationLog: (callId: string) => Promise<void>;
  removeSpaceFromGlobal: (spaceUuid: string) => Promise<void>;
  updateSpaceInCache: (dataset: AppDataset, updates: Partial<Space>) => void;

  // Boot wiring (used by the boot controller, not by schemas)
  /**
   * Read the Space record of every space the agent holds, for the sidebar and the spaces list, from
   * the published dataset list as it is when called. A space already held is not read again.
   */
  loadSpaces: () => Promise<void>;
  /**
   * Start what opening the space at this address needs — its templates and its schema reads — for a
   * boot that is about to open it, and read its Space record. Resolves when that record is held, at
   * once for an address that is not a space among these datasets.
   */
  prepareSpaceAt: (path: string, datasets: readonly AppDataset[]) => Promise<void>;

  // Testing
}

/**
 * The pieces of host state the space store writes and the host's surfaces draw from — each one the
 * app keeps a single copy of, made over the same reactivity port as the stores.
 */
export interface SpaceHostState {
  /** The order each record's reactions settled into, forgotten with the space. */
  signalOrder: Pick<typeof signalOrder, 'reset'>;
  /** The space's task workflow as the board draws it. */
  taskWorkflowLive: TaskWorkflowLive;
}

/** What the space store is built from: the port, and what it reads and lends of the stores before it. */
export interface SpaceStoreDeps {
  reactivity: ReactivityPort;
  platform: SpaceContext['platform'];
  toasts: Toasts;
  firstScreen: Pick<FirstScreen, 'open' | 'whenOpen'>;
  sessionStore: SpaceSession;
  datasetStore: SpaceDatasets;
  profileStore: SpaceDetailsDeps['profileStore'];
  recordStore: SpaceTaskStatesDeps['recordStore'] & SpaceContentDeps['recordStore'];
  routeStore: SpaceListDeps['routeStore'] & SpaceNavigationDeps['routeStore'];
  shapeStore: SpaceListDeps['shapeStore'] & SpaceExtractionDeps['shapeStore'];
  shellStore: SpaceNavigationDeps['shellStore'] & SpaceModulesDeps['shellStore'];
  templateStore: SpaceListDeps['templateStore'] &
    SpaceNavigationDeps['templateStore'] &
    SpaceModulesDeps['templateStore'];
  host: SpaceHostState;
}

/**
 * What the space store lends stores composed before it, which cannot read it: handed over by
 * `composeStores`, so every late binding between stores is written in that one file.
 */
export interface SpaceStoreLends {
  /** The spaces' records and this agent's overrides, for the template and theme stores. */
  appearance: SpaceAppearance;
  /** The modules this agent has installed, for the app store's switcher. */
  installedModules: Accessor<string[]>;
}

/** The space store, and what it lends. */
export interface SpaceStoreWithLends {
  store: SpaceStore;
  lends: SpaceStoreLends;
}

/*
  The parts, in the order they are built: the spaces held, how a setting on a space is written, where
  the agent is, who stands where, what a space runs and shows, what it extracts, its task states, who
  is on what, what is unread, what people make, and the space's own record. Each is handed what it
  reads of the ones before. A part reaches a later one only through a function it calls after the
  store is built — never while it is being built, so no part reads one that does not exist yet,
  whichever port runs the effects.
*/
export function createSpaceStore(deps: SpaceStoreDeps): SpaceStoreWithLends {
  const {
    reactivity,
    platform,
    toasts,
    firstScreen,
    sessionStore: session,
    datasetStore,
    profileStore,
    recordStore,
    routeStore,
    shapeStore,
    shellStore,
    templateStore,
    host,
  } = deps;
  const ctx = createSpaceContext({ reactivity, platform, toasts, firstScreen, sessionStore: session, datasetStore });

  /*
    The parts are built in the order they read each other, each taking the narrowest slice of the
    parts before it, so nothing reaches a part that does not exist yet. Two needs point backwards —
    the spaces list turning on a new space's sections (the modules part's switch), and the task
    states adding a board column for a state just named (the content part's boards) — and each is
    lent explicitly with a `provide*` call once the later part is built.
  */

  // The spaces this agent holds. First: every other part reads the records it holds.
  const spaces = createSpaceList({ ...ctx, routeStore, templateStore, shapeStore });

  // The space on screen, which navigation fills from the live read and most parts only read.
  const onScreen = createSpaceOnScreen(reactivity);

  // How a setting on a space record is written and shown, over the live read while it is saving.
  const writes = createSpaceWrites({ ...ctx, spaces, onScreen });

  // What each space runs and shows, and this agent's own choices about each.
  const modules = createSpaceModules({ ...ctx, templateStore, shellStore, spaces, onScreen, writes });
  spaces.provideSectionSwitch((viewId, spaceId) => modules.members.setViewEnabled(viewId, true, spaceId));

  // Who stands where in each space and what its rules allow, and the write check that holds them.
  const roles = createSpaceRoles({ ...ctx, spaces, onScreen });
  const { canAdministerSpace, canAdministerCurrentSpace } = roles.members;

  // Where the agent is, and the sections and structure of the space it is in.
  const navigation = createSpaceNavigation({
    ...ctx,
    routeStore,
    templateStore,
    shellStore,
    spaces,
    writes,
    onScreen,
    modules,
  });

  // What each space extracts, and the extraction runtime modules reach.
  const extraction = createSpaceExtraction({
    ...ctx,
    shapeStore,
    spaces,
    navigation,
    writes,
    canAdministerCurrentSpace,
  });

  // The states the space's work moves through, and the workflow that counts agreement between them.
  const taskStates = createSpaceTaskStates({
    ...ctx,
    recordStore,
    onScreen,
    writes,
    canAdministerCurrentSpace,
    taskWorkflowLive: host.taskWorkflowLive,
  });

  // Who is on what in each space, and what each person gave.
  const involvements = createSpaceInvolvements({
    ...ctx,
    signalOrder: host.signalOrder,
  });

  // What is new to this agent in each space, and who it has muted.
  const unread = createSpaceUnread(ctx);

  // What people make in each space: posts, boards and files, and where content with no other home lives.
  const content = createSpaceContent({
    ...ctx,
    recordStore,
    navigation,
    taskStates,
  });
  taskStates.provideSpaceBoard(content.members.addStateToSpaceBoard);

  // Each space's own record — its picture, name and place, defaults, thread mode — and its members.
  const details = createSpaceDetails({ ...ctx, profileStore, spaces, onScreen, writes });

  /*
    The spaces list: one row per joined dataset the agent can act on, its columns answered by each
    job — whether this agent administers the space (its roles), what it runs and shows and this
    agent's own choices about it (the modules part). A plain list, rebuilt whenever anything in it
    changes. What keeps a row's mount — a half-typed name, the settings page's scroll — is the
    renderer, which keeps the rows of a list by `id`; each row's is its dataset's.
  */
  const spaceList = reactivity.memo<SpaceListEntry[]>(() =>
    datasetStore.orderedDatasets().map((ds) =>
      spaces.listRow(ds, (space) => ({
        canAdminister: space ? canAdministerSpace(space.uuid) : false,
        ...modules.listColumns(ds.id, space),
      })),
    ),
  );

  /*
    The template and theme stores are composed before this one and cannot read it — they are lent the
    spaces' records and this agent's overrides, which they resolve which template and theme apply
    from (see `spaceAppearance.ts`). The overrides are this agent's own, written to the root dataset.
    Returned, and handed over by `composeStores`.
  */
  const appearance: SpaceAppearance = {
    spaces: spaces.members.mySpaces,
    spaceFor: spaces.spaceForUuid,
    overrideFor: modules.overrideFor,
    setOverride: (uuid, which, id) =>
      which === 'template'
        ? modules.writeSpacePreference('setSpaceTemplateOverride', uuid, { template: id })
        : modules.writeSpacePreference('setSpaceThemeOverride', uuid, { theme: id }),
  };
  // A call's transcript and its interpretation log, read for the dataset each export names.
  const callExports = createCallExports({
    toasts,
    dataset: () => datasetStore.currentDataset(),
    interpretation: () => session.backendPorts()?.interpretation,
    profileStore,
    exportMeta: extraction.collectionInterpretationFor,
  });

  const store: SpaceStore = {
    ...spaces.members,
    ...navigation.members,
    ...modules.members,
    ...extraction.members,
    ...roles.members,
    ...taskStates.members,
    ...involvements.members,
    ...unread.members,
    ...content.members,
    ...details.members,
    spaceList,
    firstScreenOpen: () => firstScreen.open(),
    exportCallTranscript: callExports.exportCallTranscript,
    exportInterpretationLog: callExports.exportInterpretationLog,
  };
  return { store, lends: { appearance, installedModules: modules.installedModules } };
}
