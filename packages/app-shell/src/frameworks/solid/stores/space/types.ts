import type { StarterChoice } from '@shared/bundles/bundleStarter';
import type { LocationData, SpaceSyncOptions } from '@shared/spaceSync';
import type { ViewSetting } from '@shared/viewResolution';
import type { LivePage as Page, LiveQuery } from '@we/backend-shared';
import type { FileData, Space } from '@we/entities';

/**
 * The shapes `SpaceStore` speaks in, beside the store interface itself (which stays in
 * `SpaceStore.tsx`, where the generated context reads every `*Store` interface from).
 */

/**
 * One row of the spaces list — every joined dataset the agent can act on, space or not.
 *
 * Built over datasets rather than over `mySpaces` because a dataset that is *not* yet a WE space
 * still belongs in the list: a community synced in from another app is a thing you have joined and
 * can act on (by initializing it). A space you cannot see is a space you cannot leave.
 *
 * Shared and personal differ by exactly one field on the same model, which is a badge (`kind`), not
 * a heading — it is one list.
 */
export interface SpaceListEntry {
  /**
   * The dataset id — stable whether or not a Space record exists, so it keys navigation and settings,
   * and what a page keeps the row by while its fields change, so a settings screen drawn over the
   * list is not drawn again on every write.
   */
  id: string;
  name: string;
  description: string;
  avatar: string;
  kind: 'shared' | 'personal' | 'foreign';
  /** False for a joined dataset with no WE Space record — the "initialize" state. */
  isWeSpace: boolean;
  /**
   * This row's Space record has not been read yet, so `isWeSpace` and `kind` do not know yet.
   *
   * True only for the first seconds of a boot: the space on screen is read before the app appears,
   * and the others after its first screen has drawn (see `BootController`). A row that is loading is
   * not a dataset from another app, so a page must not say it is one.
   */
  loading: boolean;
  /** Whether this agent may change what everyone here sees. See `SpaceStore.canAdministerSpace`. */
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
  /**
   * Where sharing this space stands while it is not yet shared: `'sharing'` while the backend
   * publishes it, `'failed'` when that did not work (see `shareError`, and `shareSpace` to try
   * again), `''` otherwise. A shared space reads `''` and has a `shareLink`.
   *
   * Creating a shared space makes the local space first and shares it after, so a space can be in
   * use while this says `'sharing'`.
   */
  sharing: '' | 'sharing' | 'failed';
  /** Why the last attempt to share this space failed, or `''`. */
  shareError: string;
}

/**
 * What sharing a space was asked for: the backend's sharing option, the server it syncs through when
 * that option uses one, and the listing to write after.
 */
export interface ShareTask {
  sharing?: string;
  server?: string;
  /** Set when the space is listed in global discovery — the images and place to list it with. */
  listing?: SpaceSyncOptions;
}

/** Something a new space can start with, as a template reads it — a starter without its records. */
export type StarterOption = Omit<StarterChoice, 'starter'>;

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

/** A state this space's work can be in, as a screen reads it — one `TaskState` record. */
export interface TaskStateView {
  id: string;
  name: string;
  /** What `TaskBlock.status` holds. */
  slug: string;
  /** See `TaskState.semantic` — five values, sized by the questions answerable from outside a space. */
  semantic: 'open' | 'active' | 'blocked' | 'done' | 'cancelled';
  color: string;
  /** The community's own icon, empty where it has not chosen one. */
  icon: string;
  retired: boolean;
  /** How many distinct people must agree before a task enters this state. 1 is a plain drop. */
  approvals: number;
  /** The involvement kind whose holders' agreement counts, or empty for any member's. */
  approverKind: string;
  /**
   * What must be there before a task enters this state, each with a sentence saying so — see
   * `TaskState.evidence`. `via` is the relation the task holds them through, empty for anywhere.
   */
  evidence: {
    entity: string;
    where?: Record<string, string | number | boolean>;
    via: string;
    min: number;
    label: string;
  }[];
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
   * The relation it joins on that node. Defaults to `'children'` — containment, which is what a
   * channel message wants. Pass `'responses'` for a reply, which hangs off a node rather than
   * sitting inside it.
   */
  relation?: string;
}

// Space.avatar/coverImage are typed as string (resolved data URI on read) but accept FileData on write.
// This input type reflects the actual write-path contract.
export type SpaceInput = Omit<Partial<Space>, 'avatar' | 'coverImage'> & {
  avatar?: FileData | string;
  coverImage?: FileData | string;
};

/** One button in the module rail. See `SpaceStore.moduleLaunchers`. */
export type LauncherRow = {
  id: string;
  icon: string;
  label: string;
  active: boolean;
  busy: boolean;
  concealed: boolean;
};

/**
 * A model's live query, as this store follows one. It opens on a page of rows and hands every change
 * whole — the records themselves, so a change is applied from what arrived rather than by asking the
 * backend the same question again. `snapshot.initial` tells the rows it opened on from a change.
 */
export type LiveRows<T> = LiveQuery<Page<T>>;
