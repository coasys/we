/**
 * Apps installed as data: reading a bundle from a file, asking, installing it, setting a space up for
 * it, and removing it.
 *
 * Below every store it writes through — templates, themes, record types, modules, the agent's settings
 * — because an install touches all of them and none of them should have to know what a bundle is.
 * Each lends one entry point (`writeLibraryTemplates`, `writeLibraryTheme`, `addRecordTypes`), classed
 * as wiring, so no template can call them; what a template may call is here, and the one call that
 * writes anything, `confirmInstall`, is answered from a host-drawn prompt.
 *
 * ## What is asked, and of whom
 *
 * A file is the weakest provenance there is — nothing attests to who made it — so the prompt says so,
 * and shows only what was worked out from the bundle's templates (`judgeBundle`), never what the file
 * says about itself. Its record types and sections belong to spaces, and change what a shared space
 * holds for everybody in it, so they go only into spaces this agent runs and only the ones ticked: the
 * prompt lists them, with the one on screen ticked when there is one. Any other is set up later, from
 * Settings, through the same list.
 *
 * A seed's bundles are built in rather than installed (see `seedBundles.ts`), so they are never asked
 * about and cannot be removed — but a space can be set up for one all the same, and it is listed.
 */
import { bundlePieces } from '@shared/bundles/bundlePieces';
import {
  installedEntry,
  readInstalledBundles,
  withInstalled,
  withoutInstalled,
} from '@shared/bundles/installedBundles';
import { judgeBundle, modulesNamedBy } from '@shared/bundles/judgeBundle';
import { moduleRegistry } from '@shared/registries/moduleRegistry';
import { seedBundlePieces } from '@shared/registries/seedBundles';
import { explain } from '@shared/userMessage';
import { toastService } from '@we/components/solid';
import { CORE_MANIFEST } from '@we/entities/manifest';
import { type Bundle, type BundleRecordType, readBundle, type TemplateSchema } from '@we/schema-shared';
import { type Accessor, createContext, createMemo, createSignal, type ParentProps, useContext } from 'solid-js';

import { useDatasetStore } from './DatasetStore';
import { useShapeStore } from './ShapeStore';
import { useSpaceStore } from './SpaceStore';
import { useTemplateStore } from './TemplateStore';
import { useThemeStore } from './ThemeStore';

/** Bigger than any app has reason to be, small enough that reading one cannot hang the page. */
const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;

/** What the install prompt shows: everything already in the words a person reads. */
export interface PendingBundleInstall {
  name: string;
  icon: string;
  version: string;
  /** Who the file says made it, or empty. Never attested — the prompt says so. */
  author: string;
  fileName: string;
  /** The version already installed, when this is an update; empty otherwise. */
  updates: string;
  /** What it adds, a sentence each. */
  adds: string[];
  capabilities: string[];
  /** References it makes that will be inert here, by path. */
  blocked: string[];
  /** Modules this install turns on for this agent, by name. */
  modulesToTurnOn: string[];
  /** Modules this deployment does not have at all, by id: those parts of the app stay empty. */
  modulesNotInBuild: string[];
  recordTypes: string[];
  /** Whether the app needs a space set up for it — it brings record types or sections. */
  needsSpace: boolean;
  /** `ours` — every space opens in the app's own template while it is the app in use; `theirs` — spaces keep theirs. */
  display: 'ours' | 'theirs' | '';
}

export interface InstalledBundleView {
  id: string;
  name: string;
  icon: string;
  version: string;
  /** `file` — this agent installed it; `deployment` — it is built in, and cannot be removed. */
  from: 'file' | 'deployment';
  /**
   * Whether the spaces this agent runs have what the app needs — its record types and sections.
   * `none` when it needs nothing or this agent runs no space; `done` when every one of them is set up;
   * `available` otherwise.
   */
  setUp: 'done' | 'available' | 'none';
}

/** A space this agent runs, as the set-up list shows it. */
export interface BundleSpaceChoice {
  id: string;
  name: string;
  avatar: string;
  /** Ticked: it will be set up when the prompt or the picker is confirmed. */
  chosen: boolean;
  /** Already set up for the app in question, so there is nothing to tick. */
  done: boolean;
  /** The space on screen. */
  here: boolean;
}

export interface BundleStore {
  pendingInstall: Accessor<PendingBundleInstall | null>;
  installed: Accessor<InstalledBundleView[]>;
  busy: Accessor<boolean>;
  /** The spaces this agent runs, for the app the prompt or the picker is about; empty with neither open. */
  spaceChoices: Accessor<BundleSpaceChoice[]>;
  /** The app the set-up picker is open for, or null. */
  setUpPicker: Accessor<{ id: string; name: string; icon: string } | null>;
  installFromFile: (file: unknown) => Promise<void>;
  confirmInstall: () => Promise<void>;
  cancelInstall: () => void;
  toggleSpace: (spaceId: string) => void;
  openSetUp: (bundleId: string) => void;
  closeSetUp: () => void;
  confirmSetUp: () => Promise<void>;
  removeBundle: (bundleId: string) => Promise<void>;
}

const BundleContext = createContext<BundleStore>();

/** What setting a space up needs to know of a bundle, wherever it came from. */
interface SetUpSource {
  id: string;
  name: string;
  sections: string[];
  recordTypes: BundleRecordType[];
  /**
   * Whether its sections have to be copied into the space for everyone in it to have them. An installed
   * app's live in one person's library; a deployment's are built in for every member already.
   */
  copySections: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const named = (names: string[]) => names.map((name) => `“${name}”`).join(', ');

/** A `File`, however a control reports it — itself, a list of one, or an event carrying either. */
function fileOf(input: unknown): File | null {
  const value = (input as { detail?: unknown } | null)?.detail ?? input;
  const first = Array.isArray(value) ? value[0] : value;
  return typeof File !== 'undefined' && first instanceof File ? first : null;
}

export function BundleStoreProvider(props: ParentProps) {
  const templateStore = useTemplateStore();
  const themeStore = useThemeStore();
  const shapeStore = useShapeStore();
  const spaceStore = useSpaceStore();
  const datasetStore = useDatasetStore();

  const [pending, setPending] = createSignal<{ bundle: Bundle; view: PendingBundleInstall } | null>(null);
  const [busy, setBusy] = createSignal(false);

  const installedList = () => readInstalledBundles(datasetStore.agentSettings()?.installedBundles);

  const sources = (): SetUpSource[] => [
    ...seedBundlePieces.map((pieces) => ({
      id: pieces.bundleId,
      name: pieces.name,
      sections: pieces.sections.map((section) => section.id),
      recordTypes: pieces.recordTypes,
      copySections: false,
    })),
    ...installedList().map((entry) => ({
      id: entry.id,
      name: entry.name,
      sections: entry.sections,
      recordTypes: entry.recordTypes,
      copySections: true,
    })),
  ];

  const [chosen, setChosen] = createSignal<string[]>([]);
  const [pickerFor, setPickerFor] = createSignal<string | null>(null);

  /** The spaces this agent runs — the only ones an app's record types and sections may go into. */
  const spacesYouRun = createMemo(() => spaceStore.spaceList().filter((row) => row.isWeSpace && row.canAdminister));

  const needsSpace = (source: Pick<SetUpSource, 'recordTypes' | 'sections'>) =>
    source.recordTypes.length > 0 || source.sections.length > 0;

  /**
   * Whether one space has what a bundle needs. Its sections switched on is the sign, since set-up
   * switches them on last; the space on screen also has its record types checked, which are loaded
   * for it and for no other.
   */
  const isSetUpIn = (source: Pick<SetUpSource, 'recordTypes' | 'sections'>, spaceId: string) => {
    const row = spacesYouRun().find((r) => r.uuid === spaceId);
    if (!row) return false;
    const enabled = new Set(row.views.filter((view) => view.enabled).map((view) => view.id));
    if (!source.sections.every((id) => enabled.has(id))) return false;
    if (spaceId !== datasetStore.currentDataset()?.id) return source.sections.length > 0;
    const shapes = new Set(shapeStore.spaceShapes().map((shape) => shape.name));
    return source.recordTypes.every((type) => shapes.has(type.name));
  };

  const setUpState = (source: SetUpSource): InstalledBundleView['setUp'] => {
    if (!needsSpace(source) || !spacesYouRun().length) return 'none';
    return spacesYouRun().every((row) => isSetUpIn(source, row.uuid)) ? 'done' : 'available';
  };

  const installed = createMemo<InstalledBundleView[]>(() => [
    ...seedBundlePieces.map((pieces) => ({
      id: pieces.bundleId,
      name: pieces.name,
      icon: pieces.icon,
      version: pieces.version,
      from: 'deployment' as const,
      setUp: setUpState(sources().find((s) => s.id === pieces.bundleId)!),
    })),
    ...installedList().map((entry) => ({
      id: entry.id,
      name: entry.name,
      icon: entry.icon,
      version: entry.version,
      from: entry.from,
      setUp: setUpState(sources().find((s) => s.id === entry.id)!),
    })),
  ]);

  /** What the list is about: the app being installed, or the one the picker was opened for. */
  const subject = (): Pick<SetUpSource, 'recordTypes' | 'sections'> | null => {
    const request = pending();
    if (request) {
      const pieces = bundlePieces(request.bundle);
      return {
        recordTypes: request.bundle.recordTypes ?? [],
        sections: pieces.sections.map((section) => section.id ?? ''),
      };
    }
    const id = pickerFor();
    return id ? (sources().find((s) => s.id === id) ?? null) : null;
  };

  const spaceChoices = createMemo<BundleSpaceChoice[]>(() => {
    const about = subject();
    if (!about || !needsSpace(about)) return [];
    const ticked = new Set(chosen());
    const here = datasetStore.currentDataset()?.id;
    return spacesYouRun().map((row) => {
      const done = isSetUpIn(about, row.uuid);
      return {
        id: row.uuid,
        name: row.name,
        avatar: row.avatar,
        chosen: !done && ticked.has(row.uuid),
        done,
        here: row.uuid === here,
      };
    });
  });

  /** The space on screen, ticked to start with when it is one this agent runs: where they asked from. */
  const startingChoice = () => {
    const here = datasetStore.currentDataset()?.id;
    return here && spacesYouRun().some((row) => row.uuid === here) ? [here] : [];
  };

  const toggleSpace = (spaceId: string) =>
    setChosen((list) => (list.includes(spaceId) ? list.filter((id) => id !== spaceId) : [...list, spaceId]));

  const settingUp = () => spaceChoices().filter((choice) => choice.chosen);

  async function installFromFile(input: unknown): Promise<void> {
    const file = fileOf(input);
    if (!file) return;
    if (file.size > MAX_BUNDLE_BYTES) {
      toastService.error('That file is too large to be an app');
      return;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(await file.text());
    } catch {
      toastService.error('That file is not an app: it is not JSON');
      return;
    }
    const read = readBundle(decoded);
    if (!read.bundle) {
      const first = read.problems[0];
      console.warn('Not a bundle:', read.problems);
      toastService.error(`That file is not an app this version of WE can read — ${first.message}`);
      return;
    }
    const bundle = read.bundle;
    if (seedBundlePieces.some((pieces) => pieces.bundleId === bundle.id)) {
      toastService.error(`“${bundle.name}” is built into this app already`);
      return;
    }

    const judged = judgeBundle(bundle, {
      requiredBy: (schema) => moduleRegistry.requiredBy(schema),
      hasModule: (id) => moduleRegistry.has(id),
      moduleInstalled: (id) => spaceStore.installedModules().includes(id),
      moduleName: (id) => moduleRegistry.get(id)?.definition.manifest.name ?? id,
      /*
        WE's own vocabulary only. Installing writes to this agent's library, not to a space; a record
        type that clashes with something a space already has is that space's question, answered as it
        is set up. Judging it against the space on screen refused a reinstall over its own earlier
        record types, which every space's model list carries once adopted.
      */
      knownEntities: Object.keys(CORE_MANIFEST.entities),
    });
    if (judged.refusals.length) {
      console.warn(`The app “${bundle.name}” cannot be installed:`, judged.refusals);
      toastService.error(`“${bundle.name}” cannot be installed — ${judged.refusals[0]}`);
      return;
    }

    const adds: string[] = [];
    if (judged.adds.app) adds.push(`Its own app, “${judged.adds.app}” — the chrome around every space`);
    if (judged.adds.spaceTemplates.length)
      adds.push(
        `${plural(judged.adds.spaceTemplates.length, 'space template', 'space templates')}: ${named(judged.adds.spaceTemplates)}`,
      );
    if (judged.adds.sections.length)
      adds.push(`${plural(judged.adds.sections.length, 'section', 'sections')}: ${named(judged.adds.sections)}`);
    if (judged.adds.theme) adds.push(`A theme, “${judged.adds.theme}”`);

    const recordTypes = judged.adds.recordTypes;
    const previous = installedList().find((entry) => entry.id === bundle.id);
    setPending({
      bundle,
      view: {
        name: bundle.name,
        icon: bundle.icon || 'app-window',
        version: bundle.version,
        author: bundle.author?.name ?? '',
        fileName: file.name,
        updates: previous?.version ?? '',
        adds,
        capabilities: judged.capabilities,
        blocked: judged.blocked,
        modulesToTurnOn: judged.modulesToTurnOn.map((module) => module.name),
        modulesNotInBuild: judged.modulesNotInBuild,
        recordTypes,
        needsSpace: recordTypes.length > 0 || judged.adds.sections.length > 0,
        display: bundle.display?.spaces ?? '',
      },
    });
    setPickerFor(null);
    setChosen(startingChoice());
  }

  async function confirmInstall(): Promise<void> {
    const request = pending();
    if (!request) return;
    // Read before the prompt closes: the list is about the app the prompt is showing.
    const spaces = settingUp();
    setPending(null);
    const { bundle, view } = request;
    setBusy(true);
    try {
      const pieces = bundlePieces(bundle);
      // The theme first: a theme record is known by the id it is given, and the templates naming it
      // have to point at that.
      const themeId = pieces.theme ? await themeStore.writeLibraryTheme(pieces.theme) : undefined;
      const pointAtTheme = (template: TemplateSchema): TemplateSchema =>
        themeId && template.meta.themeId === pieces.theme?.id
          ? { ...template, meta: { ...template.meta, themeId } }
          : template;
      await templateStore.writeLibraryTemplates(
        [...(pieces.app ? [pieces.app] : []), ...pieces.shells, ...pieces.sections].map(pointAtTheme),
        'bundle',
      );

      for (const id of judgeModulesToTurnOn(bundle)) await spaceStore.setModuleInstalled(id, true);

      const entry = installedEntry(pieces, { name: bundle.name, icon: view.icon, at: new Date().toISOString() });
      await datasetStore.updateAgentSettings({
        installedBundles: JSON.stringify(
          withInstalled(installedList(), { ...entry, ...(themeId ? { theme: themeId } : {}) }),
        ),
      });

      if (pieces.app) await templateStore.setAppTemplate(pieces.app.id);
      const unset = await setUpSpaces(bundle.id, spaces);

      const done = view.updates ? `“${bundle.name}” updated to ${bundle.version}` : `“${bundle.name}” installed`;
      if (!unset.length) toastService.success(spaces.length ? `${done}, and ${spacesAre(spaces)} set up for it` : done);
      else toastService.error(`${done}, but ${unset[0]}`);
    } catch (error) {
      toastService.error(explain(error, `Could not install “${bundle.name}”`));
    } finally {
      setBusy(false);
    }
  }

  /** Modules to turn on, asked again at the moment of confirming rather than remembered from the prompt. */
  function judgeModulesToTurnOn(bundle: Bundle): string[] {
    const ids = new Set<string>();
    for (const template of [...(bundle.app ? [bundle.app] : []), ...(bundle.templates ?? [])]) {
      for (const id of [...moduleRegistry.requiredBy(template), ...modulesNamedBy(template)]) ids.add(id);
    }
    return [...ids].filter((id) => moduleRegistry.has(id) && !spaceStore.installedModules().includes(id));
  }

  /** “Garden” is, or 3 spaces are — the subject of a sentence about what was set up. */
  const spacesAre = (spaces: readonly BundleSpaceChoice[]) =>
    spaces.length === 1 ? `“${spaces[0].name}” is` : `${spaces.length} spaces are`;

  /**
   * Set each chosen space up for a bundle, one after another. Resolves with what went wrong, a
   * sentence each, so a caller can say it once; a space that fails leaves the rest to go on.
   */
  async function setUpSpaces(bundleId: string, spaces: readonly BundleSpaceChoice[]): Promise<string[]> {
    const source = sources().find((s) => s.id === bundleId);
    if (!source) return [];
    const problems: string[] = [];
    for (const space of spaces) {
      try {
        const left = await setUpSpace(source, space.id);
        if (left.length) problems.push(`“${space.name}” was not set up: ${left[0]}`);
      } catch (error) {
        problems.push(explain(error, `“${space.name}” could not be set up`));
      }
    }
    return problems;
  }

  /** Add a bundle's record types to one space this agent runs, copy its sections in, and switch them on. */
  async function setUpSpace(source: SetUpSource, spaceId: string): Promise<string[]> {
    if (!spacesYouRun().some((row) => row.uuid === spaceId))
      return ['only whoever runs a space can set it up for an app'];
    const problems = source.recordTypes.length
      ? await shapeStore.addRecordTypes(source.id, source.recordTypes, spaceId)
      : [];
    // A section reading a record type the space holds under another definition would draw its
    // records as though they were this app's, so a space that refused one gets no sections either.
    if (problems.length) {
      console.warn(`Not setting a space up for “${source.name}”:`, problems);
      return problems;
    }
    /*
      A section switched on is a section every member is shown, so every member has to have it: an
      installed app's sections are copied into the space, as a space's own templates are stored.
      From this agent's library, which holds the version they installed; a later set-up after an
      update replaces the copy.
    */
    if (source.copySections) {
      const wanted = new Set(source.sections);
      const sections = templateStore
        .allTemplates()
        .filter((template) => !template._fromSpace && wanted.has(template.id ?? ''));
      if (sections.length) await templateStore.writeSpaceTemplates(sections, 'bundle', spaceId);
    }
    const row = spacesYouRun().find((r) => r.uuid === spaceId);
    const enabled = new Set((row?.views ?? []).filter((view) => view.enabled).map((view) => view.id));
    for (const section of source.sections)
      if (!enabled.has(section)) await spaceStore.setViewEnabled(section, true, spaceId);
    return problems;
  }

  function openSetUp(bundleId: string): void {
    if (!sources().some((s) => s.id === bundleId)) return;
    setPending(null);
    setPickerFor(bundleId);
    setChosen(startingChoice());
  }

  async function confirmSetUp(): Promise<void> {
    const bundleId = pickerFor();
    const source = sources().find((s) => s.id === bundleId);
    const spaces = settingUp();
    setPickerFor(null);
    if (!source || !spaces.length) return;
    setBusy(true);
    try {
      const problems = await setUpSpaces(source.id, spaces);
      if (problems.length) toastService.error(problems[0]);
      else toastService.success(`${spacesAre(spaces)} set up for “${source.name}”`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Remove what an install wrote: its app, templates and theme. Never its record types — those hold the
   * records people made with it, in spaces other people share — and never its sections' place in a
   * space, which go quiet on their own once their templates are gone.
   */
  async function removeBundle(bundleId: string): Promise<void> {
    const entry = installedList().find((e) => e.id === bundleId);
    if (!entry) return;
    setBusy(true);
    try {
      for (const id of [...(entry.app ? [entry.app] : []), ...entry.templates]) await templateStore.deleteTemplate(id);
      if (entry.theme) await themeStore.deleteTheme(entry.theme);
      await datasetStore.updateAgentSettings({
        installedBundles: JSON.stringify(withoutInstalled(installedList(), bundleId)),
      });
      toastService.success(`“${entry.name}” removed`);
    } catch (error) {
      toastService.error(explain(error, `Could not remove “${entry.name}”`));
    } finally {
      setBusy(false);
    }
  }

  const store: BundleStore = {
    pendingInstall: () => pending()?.view ?? null,
    installed,
    busy,
    spaceChoices,
    setUpPicker: () => {
      const id = pickerFor();
      const view = id ? installed().find((entry) => entry.id === id) : undefined;
      return view ? { id: view.id, name: view.name, icon: view.icon } : null;
    },
    installFromFile,
    confirmInstall,
    cancelInstall: () => setPending(null),
    toggleSpace,
    openSetUp,
    closeSetUp: () => setPickerFor(null),
    confirmSetUp,
    removeBundle,
  };

  return <BundleContext.Provider value={store}>{props.children}</BundleContext.Provider>;
}

export function useBundleStore(): BundleStore {
  const ctx = useContext(BundleContext);
  if (!ctx) throw new Error('useBundleStore must be used within BundleStoreProvider');
  return ctx;
}

export default BundleStoreProvider;
