/**
 * What a space runs and shows: the modules on in it, for the community and for this agent, their
 * settings at every level, the rail of their launchers, and the space's sections — which exist, which
 * the community has, and which this agent sees. Also this agent's own choices about each space
 * (what they muted, what they hid, which template and theme they override it with), which live in
 * one record per space in the root dataset. Part of `SpaceStore` — see `../SpaceStore.ts`.
 */
import { FOLLOW_SPACE, SpacePreference } from '@we/entities';
import type { ResolvedView, TemplateSchema } from '@we/schema-shared';
import { hasViewsMarker } from '@we/schema-shared';

import { updatingSignal } from '../../distinctSignal';
import {
  clearSetting,
  type LevelValues,
  resolveGroup,
  settingRows,
  settingsOf,
  type SettingValue,
  writeSetting,
} from '../../moduleSettings';
import { withDerivedIds } from '../../registries/derivedIds';
import { isCommunityDecided, moduleRegistry, moduleStores, moduleSurface } from '../../registries/moduleRegistry';
import { defaultViewOrder, viewRegistry } from '../../registries/viewRegistry';
import { getSeed } from '../../seedRegistry';
import { overrideTemplateId } from '../../spaceAppearance';
import {
  activeSections,
  idListOf,
  preserveUnknownViews,
  resolveEnabledViews,
  routableSections,
  type ViewSetting,
  viewSettings,
} from '../../viewResolution';
import type { AppStore } from '../AppStore';
import type { ShellStore } from '../ShellStore';
import type { SpaceStore } from '../SpaceStore';
import type { TemplateStore } from '../TemplateStore';
import { type SpaceContext, withRow } from './context';
import { moduleSettingsFrom, registeredModules, resolveEnabledModules } from './enabledModules';
import type { SpaceNavigation } from './navigation';
import type { SpaceList } from './spaces';
import type { LauncherRow } from './types';
import type { SpaceWrites } from './writes';

export interface SpaceModulesDeps extends SpaceContext {
  templateStore: Pick<TemplateStore, 'allTemplates' | 'draftOf' | 'defaultTemplateId' | 'currentTemplate'>;
  appStore: Pick<AppStore, 'provideInstalledModules'>;
  shellStore: Pick<ShellStore, 'provideModuleGate' | 'dockGeometry' | 'revealDock' | 'toggleModulePanel'>;
  spaces: Pick<SpaceList, 'heldSpace' | 'spaceForUuid'>;
  navigation: { members: Pick<SpaceNavigation['members'], 'currentSpace'> };
  writes: Pick<SpaceWrites, 'writeSpaceSetting'>;
}

export function createSpaceModules(deps: SpaceModulesDeps) {
  const {
    reactivity,
    toasts,
    datasetStore,
    templateStore,
    appStore,
    shellStore,
    spaces,
    navigation,
    writes,
    runCore,
    targetDataset,
  } = deps;
  const { memo, effect, onCleanup } = reactivity;
  const { heldSpace, spaceForUuid } = spaces;
  const { currentSpace } = navigation.members;
  const { writeSpaceSetting } = writes;

  /**
   * The middle layer: which modules this agent wants available to them at all, anywhere.
   *
   * Read from the root dataset, so it is personal — turning one off here changes nothing another
   * member sees. Unset means "not decided" and falls back to everything registered, so an agent who
   * never opens the setting keeps what they had.
   *
   * Everything registered, and **not** the seed's default the community layer falls back to. It was
   * the seed's, which made `enabled: false` mean "off for every agent too" — so a module shipped for
   * communities to opt into could not be switched on by one until each of its members had separately
   * installed it. `enabled: false` is a statement about spaces; this layer is about people.
   */
  const installedModules = memo<string[]>(() =>
    resolveEnabledModules(datasetStore.agentSettings()?.installedModules, registeredModules),
  );

  /** This agent's personal choices per space, from the root dataset. See `SpacePreference`. */
  const [spacePreferences, setSpacePreferences, updateSpacePreferences] = updatingSignal<SpacePreference[]>(
    reactivity,
    [],
  );

  const preferenceFor = (spaceUuid: string | undefined): SpacePreference | undefined =>
    spaceUuid ? spacePreferences().find((p) => p.spaceUuid === spaceUuid) : undefined;

  const mutedModulesFor = (spaceUuid: string | undefined): string[] => idListOf(preferenceFor(spaceUuid)?.mutedModules);

  /**
   * Sections this agent has hidden in one space — the private half of the section list.
   *
   * Exclusions, like `mutedModulesFor`: a section the community adds later shows up, because silence
   * about a view is "no opinion" rather than "no".
   */
  const hiddenViewsFor = (spaceUuid: string | undefined): string[] => idListOf(preferenceFor(spaceUuid)?.hiddenViews);

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
   * Every view this agent could put in a space: the ones compiled in, plus the ones installed.
   *
   * A view installed at runtime is an ordinary `Template` record whose `meta.role` is `'view'` —
   * the same record a shell is stored as, which is what lets one marketplace, one install flow and
   * one publish path serve both. The registry is consulted first so a built-in id keeps meaning the
   * built-in view even if somebody installs a template sharing its id.
   */
  const availableViews = memo<Map<string, TemplateSchema>>(() => {
    const out = new Map<string, TemplateSchema>(Object.entries(viewRegistry));
    /*
      Views a module contributes, beside the built-ins and ahead of anything installed.

      An experience pack — a board view with its task block, an events view with its RSVP — ships as a
      module, and its view is what the space enables exactly as it enables a built-in. The built-in
      wins a collision on id for the reason it wins one below: a module must not be able to replace
      "About" by naming a view `about`.
    */
    for (const [id, view] of Object.entries(moduleRegistry.views())) {
      if (out.has(id)) {
        console.warn(`module view "${id}" shares its id with a built-in section and will not be used`);
        continue;
      }
      out.set(id, withDerivedIds(view, id));
    }
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
      // A section being edited where it is drawn is drawn from its working copy, so the edit is seen
      // in its shell as it is made. See `openDraft`.
      out.set(template.id, templateStore.draftOf(template) ?? template);
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
  const viewSettingsFor = (
    spaceUuid: string | undefined,
    enabled: unknown,
    modulesOn: readonly string[],
  ): ViewSetting[] => {
    const off = viewsOffFor(modulesOn);
    return viewSettings({
      enabled,
      hidden: hiddenViewsFor(spaceUuid),
      available: new Map([...availableViews()].filter(([id]) => !off.has(id))),
      fallbackOrder: defaultViewOrder(),
      isBuiltIn: (id) => id in viewRegistry,
    });
  };

  /**
   * The sections a space cannot have, because the module that contributes them is off there.
   *
   * The community layer only — `enabledModules`, not `activeModules` — for the reason the sections
   * themselves are not intersected with an install: a section is part of what the space *is*, and one
   * member not having a module installed must not give them a different set of sections from
   * everybody else. A community turning a module off is a decision about the space, and takes its
   * sections with it.
   */
  const viewsOffFor = (modulesOn: readonly string[]): Set<string> => {
    const on = new Set(modulesOn);
    return new Set(
      Object.entries(moduleRegistry.viewOwners())
        .filter(([, owner]) => !on.has(owner))
        .map(([viewId]) => viewId),
    );
  };

  /**
   * Turn a stored override into the id that actually applies.
   *
   * `''` defers to the community's choice; {@link AGENT_DEFAULT} defers to this agent's global one,
   * read live so it tracks a later change rather than freezing today's answer.
   */
  const resolveTemplateFor = (uuid: string): string =>
    overrideTemplateId(
      templateOverrideFor(uuid),
      spaceForUuid(uuid)?.defaultTemplateId,
      templateStore.defaultTemplateId(),
    );

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
  const installedSet = memo(() => new Set(installedModules()));

  /**
   * Which modules this space has on.
   *
   * An unset field means "not decided", never "none" — see `Space.enabledModules`. Falling back to
   * the registered set is what stops this shipping as a silent regression that strips every existing
   * space of its chrome.
   */
  const enabledModules = memo<string[]>(() => resolveEnabledModules(currentSpace()?.enabledModules));

  /*
    ── Module settings ──────────────────────────────────────────────────────────────────────────

    The four levels a capability's settings resolve through, read from the four places they live.
    `moduleSettings.ts` owns the resolution and the reasoning; this owns only the reading.

    A capability could be switched on and off four ways here and could not carry a single *value*,
    which is why `autoInterpret` and `extractionTargets` are columns on the core `Space` entity.
    Those two stay where they are — they are interpretation's configuration, and where that lands is a
    question about wires rather than about settings — but nothing new joins them.
  */
  const settingLevels = memo<LevelValues>(() => {
    const uuid = datasetStore.currentDataset()?.id;
    return {
      deployment: getSeed().settings ?? {},
      agent: settingsOf(datasetStore.agentSettings()?.moduleSettings, 'AgentSettings.moduleSettings'),
      space: settingsOf(currentSpace()?.moduleSettings, 'Space.moduleSettings'),
      'agent-in-space': settingsOf(preferenceFor(uuid)?.moduleSettings, 'SpacePreference.moduleSettings'),
    };
  });

  /** Every module that declares settings, as the screens and the resolver both want them. */
  const settingGroups = memo(() => moduleRegistry.settingGroups());

  /*
    Hand each module its own answers.

    Read at call time inside the module's store, so a module built once at boot follows the space it
    is in — which is the whole point of a per-space level. Registered here because this is the store
    that can see all four levels; `moduleRegistry` sits below it and knows about none of them.
  */
  onCleanup(
    moduleRegistry.provideSettings((group) =>
      resolveGroup(
        settingGroups().find((entry) => entry.id === group) ?? { id: group, label: group, settings: [] },
        settingLevels(),
      ),
    ),
  );

  /*
    The groups that apply here: a community-decided module this space has off asks nothing of it.
    A poll setting on the settings page of a space with no polls is a control for nothing.
  */
  const groupsHere = memo(() => {
    const on = new Set(enabledModules());
    return settingGroups().filter((group) => {
      const definition = moduleRegistry.get(group.id)?.definition;
      return !definition || !isCommunityDecided(definition) || on.has(group.id);
    });
  });
  /*
    Plain lists, rebuilt on every write. A settings screen keeps its rows through the renderer, which
    keeps them by each row's `id` (`group.key`), so pressing one switch redraws nothing else.
  */
  const spaceModuleSettings = memo(() => settingRows(groupsHere(), 'space', settingLevels()));
  const myModuleSettings = memo(() => settingRows(groupsHere(), 'agent-in-space', settingLevels()));
  const agentModuleSettings = memo(() => settingRows(settingGroups(), 'agent', settingLevels()));

  /**
   * Write, or withdraw, the community's opinion about one setting.
   *
   * `undefined` clears rather than writing a value, because a level that has been reset must go back
   * to **silence** — a stored `false` that happens to equal the default goes on deciding, and the
   * control that wrote it then reads as untouched while still overruling everything less specific.
   */
  async function setSpaceModuleSetting(
    group: string,
    key: string,
    value?: SettingValue,
    spaceUuid?: string,
  ): Promise<void> {
    const ds = targetDataset(spaceUuid);
    const space = ds ? heldSpace(ds) : undefined;
    if (!ds || !space || !group || !key) return;
    await writeSpaceSetting(ds, space, 'setSpaceModuleSetting', 'moduleSettings', { group, key, value });
  }

  /** The same, for this agent in this one space. Private — written to the root dataset. */
  async function setMyModuleSetting(
    group: string,
    key: string,
    value?: SettingValue,
    spaceUuid?: string,
  ): Promise<void> {
    const uuid = spaceUuid ?? datasetStore.currentDataset()?.id;
    if (!uuid || !group || !key) return;
    await writeSpacePreference('setMyModuleSetting', uuid, { group, key, value });
  }

  /** The same, for this agent everywhere. Also private, and also the root dataset. */
  async function setAgentModuleSetting(group: string, key: string, value?: SettingValue): Promise<void> {
    const stored = datasetStore.agentSettings()?.moduleSettings;
    const next = value === undefined ? clearSetting(stored, group, key) : writeSetting(stored, group, key, value);
    await datasetStore.updateAgentSettings({ moduleSettings: next });
  }

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
  const activeModules = memo<string[]>(() => {
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
      .filter(({ definition }) => definition.manifest.scope === 'agent' && installed.has(definition.manifest.id))
      .map(({ definition }) => definition.manifest.id);
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
  const routableViews = memo<ResolvedView[]>(() => routableSections(availableViews(), defaultViewOrder()));

  /**
   * The routable views this space may show — less any whose module the community has off.
   *
   * Filtered here rather than in `routableViews`, which the Router is built from and must stay put
   * when a switch flips. What changes is which sections the nav lists and which route bodies render.
   */
  const routableHere = memo<ResolvedView[]>(() => {
    const off = viewsOffFor(enabledModules());
    return routableViews().filter((view) => !off.has(view.id));
  });

  const spaceViews = memo<ResolvedView[]>(() =>
    activeSections({
      routable: routableHere(),
      enabled: currentSpace()?.enabledViews,
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
  const enabledViewIds = memo<string[]>(() =>
    activeSections({
      routable: routableHere(),
      enabled: currentSpace()?.enabledViews,
      hidden: [],
      fallbackOrder: defaultViewOrder(),
    }).map((view) => view.id),
  );

  /**
   * The same list, as the nav strip reads it.
   *
   * A projection rather than a second source, which is the point: anything rendering a section list
   * reads this, so there is one answer to what a space contains.
   *
   * `path` is relative (`./cards`) because a section is always addressed from inside its space.
   */
  const viewNav = memo(() =>
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
  const moduleInstallSettings = memo(() => {
    const installed = installedSet();
    return moduleRegistry.all().map(({ definition }) => {
      const surface = moduleSurface(definition);
      const { manifest } = definition;
      return {
        id: manifest.id,
        name: manifest.name,
        description: manifest.description ?? '',
        icon: manifest.icon ?? 'puzzle-piece',
        installed: installed.has(manifest.id),
        surface,
        /**
         * What a person is agreeing to — derived from the manifest and what the module contributes,
         * never authored, so it cannot go stale.
         */
        capabilities: moduleRegistry.capabilitiesOf(manifest.id),
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

  /** Read a boolean off a module's own store, unwrapping the accessor a module store exposes. */
  const read = (moduleId: string, key: string | undefined, fallback: boolean): boolean => {
    if (!key) return fallback;
    const value = (moduleStores[moduleId] as Record<string, unknown> | undefined)?.[key];
    return typeof value === 'function' ? Boolean((value as () => unknown)()) : Boolean(value);
  };

  // Personal per-space choices live in the root dataset, so they load with it rather than with any
  // space — and stay readable for every space at once, which the settings list needs.
  effect(() => {
    const root = datasetStore.rootDataset();
    if (!root) {
      setSpacePreferences([]);
      return;
    }
    void SpacePreference.findAll(root.handle)
      .then(setSpacePreferences)
      .catch(() => setSpacePreferences([]));
  });

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
  const requiredModules = memo<string[]>(() => {
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
  const missingModules = memo<string[]>(() => {
    const installed = installedSet();
    return requiredModules().filter((id) => !installed.has(id));
  });

  /** Turn a module on or off for this agent everywhere. See `AgentSettings.installedModules`. */
  async function setModuleInstalled(moduleId: string, installed: boolean): Promise<void> {
    // Refused rather than warned: uninstalling a module the visible template mounts takes the
    // component out from under it, and the route stops rendering with nothing to explain why. This
    // guard is what makes a capability module safe to offer a switch for at all.
    if (!installed && requiredModules().includes(moduleId)) {
      const name = moduleRegistry.get(moduleId)?.definition.manifest.name ?? moduleId;
      const template = templateStore.currentTemplate.meta?.name ?? 'current';
      toasts.error(`${name} can't be turned off — the ${template} template uses it`);
      return;
    }
    const next = new Set(installedModules());
    if (installed) next.add(moduleId);
    else next.delete(moduleId);
    // Writes the resolved list, so the first toggle pins whatever was on by fallback — the same
    // reason `setModuleEnabled` does, and the same consequence: a module added to the seed later
    // will not silently appear for an agent who has already decided.
    await datasetStore.updateAgentSettings({ installedModules: [...next] });
  }

  /**
   * Write one agent-private choice about one space — the operation finds this agent's preference for
   * it or makes the first — and hold the record it answers with, so the choice is what the next read
   * of it sees.
   *
   * Always the root dataset, never the space — these are mine, and putting them in the shared
   * dataset would tell every other member which modules I muted and which theme I use.
   */
  async function writeSpacePreference(operation: string, uuid: string, args: Record<string, unknown>): Promise<void> {
    const root = datasetStore.rootDataset();
    if (!root) return;
    try {
      const preference = await runCore<Partial<SpacePreference>>(operation, { space: uuid, ...args }, root.handle);
      updateSpacePreferences((rows) => withRow(rows, preference));
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
    if (!uuid || !moduleId) return;
    await writeSpacePreference('setModuleVisible', uuid, { module: moduleId, visible });
  }

  /*
    Tell the shell which modules' chrome is live here.

    The same predicate `gateOnSpace` wraps every module slot in — enabled here, *or* the module says
    it is holding on regardless (`holds`, which is how a call keeps its bar in a space that
    never enabled calls). Only this store can answer it, and `ShellStore` mounts above this one, so
    it is injected rather than read.

    Without it, a dock's frame unmounted on a space switch and its *request* did not, so
    `contentInset` went on reserving room for a panel that was no longer there — with the close
    button inside the frame that had gone. See `ShellStore.moduleGate`.
  */
  effect(() => {
    const on = new Set(activeModules());
    shellStore.provideModuleGate((moduleId: string) => {
      if (on.has(moduleId)) return true;
      // `holds` is a bare key on the module's own store. See `ModuleContributions.holds`.
      return read(moduleId, moduleRegistry.get(moduleId)?.definition.contributes?.holds, false);
    });
  });

  /**
   * The rows the rail was last handed, so a recompute that changes nothing about a button hands back
   * the same object.
   *
   * The rail draws these through `$each`, which keys rows by reference, and this memo now reads the
   * shell's dock geometry to answer `concealed` — geometry that changes on every frame of a drag and on
   * every tab flash. Fresh objects each time rebuilt every rail button under the pointer, so a hovered
   * button lost its hover fill and got it back: a flicker for as long as anything on screen moved.
   */
  let lastLaunchers: LauncherRow[] = [];
  /**
   * What the module rail renders: one entry per enabled module that declares a launcher.
   *
   * Reads `moduleStores` so `active` tracks the module's own state — the notes tab highlights while
   * its panel is open, the call tab while you are in a call. A module with no `activeWhen` is simply
   * never highlighted.
   */
  const moduleLaunchers = memo(() => {
    const on = new Set(activeModules());
    const rows: LauncherRow[] = moduleRegistry
      .all()
      .filter(({ definition }) => on.has(definition.manifest.id))
      .flatMap(({ definition }) => {
        const id = definition.manifest.id;
        /*
          A rail entry per panel that asks for one, then the module's own launchers.

          A panel's button is derived from the panel — its icon, its title, whether it is open — so a
          module with a panel declares nothing about the rail. A launcher that is not a panel's (the
          call's "start a call" / "go to the call") is declared separately, and reads its state off
          the store as it always did.
        */
        const panels = moduleRegistry
          .panelsOf(id)
          .filter(({ panel }) => panel.icon && read(id, panel.availableWhen, true))
          .map(({ dockId, panel, isOpen }) => {
            const active = isOpen();
            return {
              id: dockId,
              icon: panel.icon!,
              // The active label where there is one, so a tooltip cannot describe an act the button
              // has stopped performing.
              label: (active && panel.activeLabel) || panel.label || panel.title,
              active,
              // Background work the module reports — a running pass. Read separately from `active`,
              // since a panel can be shut while its module is busy.
              busy: read(id, panel.busyWhen, false),
              concealed: dockConcealed(dockId),
            };
          });
        const launchers = moduleRegistry
          .launchersOf(definition)
          .filter(({ launcher }) => read(id, launcher.availableWhen, true))
          .map(({ key, launcher }) => {
            const active = read(id, launcher.activeWhen, false);
            return {
              id: key,
              icon: launcher.icon,
              label: (active && launcher.activeLabel) || launcher.label,
              active,
              busy: read(id, launcher.busyWhen, false),
              concealed: false,
            };
          });
        return [...panels, ...launchers];
      });
    const same = (a: LauncherRow, b: LauncherRow) =>
      a.id === b.id &&
      a.icon === b.icon &&
      a.label === b.label &&
      a.active === b.active &&
      a.busy === b.busy &&
      a.concealed === b.concealed;
    const stable = rows.map((row) => lastLaunchers.find((previous) => same(previous, row)) ?? row);
    if (stable.length !== lastLaunchers.length || stable.some((row, i) => row !== lastLaunchers[i]))
      lastLaunchers = stable;
    return lastLaunchers;
  });

  /**
   * Whether a panel is open and nobody can see it — behind another tab of its stack, folded to its
   * bar, or in a lane collapsed to its edge.
   *
   * Asked of the shell's resolved geometry rather than re-derived, because the shell is what decides
   * all three. Not eclipsed-by-full-screen: the rail hides while a panel is maximised, so no rail
   * button is ever pressed in that state to be wrong about it.
   */
  function dockConcealed(dockId: string | null): boolean {
    if (!dockId) return false;
    const geometry = shellStore.dockGeometry()[dockId];
    if (!geometry?.edge || geometry.home) return false;
    return Boolean(geometry.hidden || geometry.collapsed || geometry.stowed);
  }

  /**
   * Invoke a module's launcher.
   *
   * Here rather than in the schema because `$invoke` resolves a *literal* path, so a rail iterating
   * over modules cannot build `modules.<id>.<method>` per entry. The rail passes the id instead and
   * this dereferences it.
   */
  function launchModule(entryId: string) {
    /*
      The rail's key: a panel's dock id (`<module>:<name>`) or a launcher's key (`<module>:<key>`, or
      the bare module id). The whole of the addressing is in the key, so a rail iterating over entries
      needs nothing else, which is the constraint that put this here rather than in a schema.
    */
    const panel = moduleRegistry.panel(entryId);
    if (panel) {
      /*
        The panel is open and out of sight: bring it into sight, and do not toggle it.

        A toggle reads "open" and closes, so a button lit for a panel stacked behind another tab put
        that panel away when pressed — the one thing the person pressing it could not have wanted.
        Only the shell knows where the panel is, so the shell answers.
      */
      if (dockConcealed(panel.dockId)) {
        shellStore.revealDock(panel.dockId);
        return;
      }
      shellStore.toggleModulePanel(panel.dockId);
      // A panel the press just opened comes to the front of wherever it opened. `revealDock` leaves a
      // panel that is still closed alone.
      shellStore.revealDock(panel.dockId);
      return;
    }

    const [id] = entryId.split(':');
    const definition = moduleRegistry.get(id)?.definition;
    if (!definition) return;
    const launcher = moduleRegistry.launchersOf(definition).find((entry) => entry.key === entryId)?.launcher;
    if (!launcher?.action) return;
    const store = moduleStores[id] as Record<string, unknown> | undefined;
    const fn = store?.[launcher.action];
    if (typeof fn !== 'function') {
      console.warn(`module "${id}" declares launcher action "${launcher.action}" but its store has no such method`);
      return;
    }
    (fn as () => void)();
  }

  async function setModuleEnabled(moduleId: string, enabled: boolean, spaceUuid?: string) {
    const ds = targetDataset(spaceUuid);
    // Read the space from the cache rather than `currentSpace`, so this answers for a space being
    // configured from the spaces list as readily as for the one on screen.
    const space = ds ? heldSpace(ds) : undefined;
    if (!ds || !space) return;
    // The first toggle writes the fallback whole, so it pins everything that was on by default, and a
    // module added to the seed later doesn't silently appear in a space that had already decided.
    await writeSpaceSetting(ds, space, 'setModuleEnabled', 'enabledModules', {
      module: moduleId,
      on: enabled,
      fallback: resolveEnabledModules(undefined),
    });
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
    const space = ds ? heldSpace(ds) : undefined;
    if (!ds || !space || !viewId) return;
    /*
      Worked out from the stored list, where a section this build has never heard of is kept where
      it is: one member on an older build flicking one switch must not remove, for the whole
      community, every section their build lacks.
    */
    await writeSpaceSetting(ds, space, 'setViewEnabled', 'enabledViews', {
      view: viewId,
      on: enabled,
      fallback: defaultViews(),
    });
  }

  /** The sections a space has before its community decides: the bundled set this build has, in seed order. */
  const defaultViews = (): string[] => {
    const available = availableViews();
    return resolveEnabledViews(undefined, (id) => available.has(id), defaultViewOrder());
  };

  /**
   * Set the whole section list at once — what a drag-reorder writes.
   *
   * Takes the order rather than a moved id, because `we-sortable` reports the resulting arrangement
   * and re-deriving it from a move would be a second implementation of the same decision. A reorder
   * may only reorder, which `core.reorderViews` holds: a section the drag handed back that is not on
   * stays off. Sections this build does not know go back where they were first (`preserveUnknownViews`).
   */
  async function reorderViews(viewIds: string[], spaceUuid?: string) {
    const ds = targetDataset(spaceUuid);
    const space = ds ? heldSpace(ds) : undefined;
    if (!ds || !space || !Array.isArray(viewIds)) return;
    const available = availableViews();
    const order = preserveUnknownViews(viewIds, idListOf(space.enabledViews), (id) => available.has(id));
    await writeSpaceSetting(ds, space, 'reorderViews', 'enabledViews', { order, fallback: defaultViews() });
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
    if (!uuid || !viewId) return;
    await writeSpacePreference('setViewVisible', uuid, { view: viewId, visible });
  }

  /** This agent's own template and theme override for a space — see `SpaceAppearance.overrideFor`. */
  const overrideFor = (uuid: string) => ({ template: templateOverrideFor(uuid), theme: themeOverrideFor(uuid) });

  /**
   * The modules and sections columns of a spaces-list row: each layer's answer for that space, so
   * the settings page can say which one turned a thing off.
   */
  function listColumns(dsId: string, space: { enabledModules?: unknown; enabledViews?: unknown } | undefined) {
    return {
      modules: space ? moduleSettingsFrom(space.enabledModules, installedSet(), new Set(mutedModulesFor(dsId))) : [],
      // Per row rather than a "current space" memo, for the reason the page exists: it configures
      // whichever space you clicked, which is usually not the one you are standing in.
      views: space ? viewSettingsFor(dsId, space.enabledViews, resolveEnabledModules(space.enabledModules)) : [],
      usesSections: usesSectionsFor(dsId),
      templateOverride: templateOverrideFor(dsId),
      themeOverride: themeOverrideFor(dsId),
    };
  }

  const members: Pick<
    SpaceStore,
    | 'enabledModules'
    | 'installedModules'
    | 'requiredModules'
    | 'missingModules'
    | 'activeModules'
    | 'moduleInstallSettings'
    | 'moduleLaunchers'
    | 'spaceViews'
    | 'routableViews'
    | 'enabledViewIds'
    | 'viewNav'
    | 'spaceModuleSettings'
    | 'myModuleSettings'
    | 'agentModuleSettings'
    | 'setSpaceModuleSetting'
    | 'setMyModuleSetting'
    | 'setAgentModuleSetting'
    | 'setModuleEnabled'
    | 'setModuleInstalled'
    | 'setModuleVisible'
    | 'setViewEnabled'
    | 'setViewVisible'
    | 'reorderViews'
    | 'launchModule'
  > = {
    enabledModules,
    installedModules,
    requiredModules,
    missingModules,
    activeModules,
    moduleInstallSettings,
    moduleLaunchers,
    spaceViews,
    routableViews,
    enabledViewIds,
    viewNav,
    spaceModuleSettings,
    myModuleSettings,
    agentModuleSettings,
    setSpaceModuleSetting,
    setMyModuleSetting,
    setAgentModuleSetting,
    setModuleEnabled,
    setModuleInstalled,
    setModuleVisible,
    setViewEnabled,
    setViewVisible,
    reorderViews,
    launchModule,
  };

  return { members, usesSectionsFor, overrideFor, writeSpacePreference, listColumns };
}

export type SpaceModules = ReturnType<typeof createSpaceModules>;
