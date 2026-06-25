import type { PerspectiveProxy } from '@coasys/ad4m';
import { templateRegistry } from '@shared/registries/templateRegistry';
import { profileTemplate, schemaTestsTemplate, settingsTemplate } from '@shared/schemas';
import { deepClone } from '@shared/utils';
import { toastService } from '@we/components/solid';
import type { FileData } from '@we/models';
import { compressImageToFileData, decodeFileAsJson, ImageBlock, SpaceTemplatePreference, Template } from '@we/models';
import type { StoredTemplate, TemplateMeta, TemplateSchema } from '@we/schema-shared';
import { createStoredTemplate } from '@we/schema-shared';
import { updateSchema } from '@we/schema-solid';
import { Accessor, createContext, createEffect, createSignal, ParentProps, useContext } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';

import { useAdamStore } from './AdamStore';
import { useRouteStore } from './RouteStore';

const emptyMeta: TemplateMeta = { name: '', description: '', icon: '' };
const emptyTemplate: TemplateSchema = { id: '', meta: emptyMeta, type: '', children: [], slots: {}, routes: [] };

export type TemplateManagementItem = {
  id: string;
  name: string;
  icon: string;
  description: string;
  isCore: boolean;
  isInstalled: boolean;
  isDefault: boolean;
};

export type TemplateSwitcherItem = { id: string; name: string; icon: string };
export type TemplateSwitcherGroup = { label: string; items: TemplateSwitcherItem[] };

export interface TemplateStore {
  // State
  personalTemplates: Accessor<TemplateSchema[]>;
  spaceTemplates: Accessor<TemplateSchema[]>;
  coreTemplates: Accessor<TemplateSchema[]>;
  myTemplates: Accessor<TemplateSchema[]>;
  allTemplates: Accessor<TemplateSchema[]>;
  templateManagementList: Accessor<TemplateManagementItem[]>;
  switcherGroups: Accessor<TemplateSwitcherGroup[]>;
  currentTemplate: TemplateSchema;
  loading: Accessor<boolean>;
  defaultTemplateId: Accessor<string>;
  activeShellView: Accessor<string | null>;

  // Actions
  updateTemplate: (newTemplate: TemplateSchema) => void;
  replaceTemplate: (newTemplate: TemplateSchema) => void;
  switchTemplate: (newTemplateId: string) => void;
  removeTemplate: () => Promise<void>;
  deleteTemplate: (templateId: string) => Promise<void>;
  installTemplate: (templateId: string) => Promise<void>;
  uninstallTemplate: (templateId: string) => Promise<void>;
  installFromMarketplace: (marketplaceTemplateId: string) => Promise<void>;
  installToSpace: (marketplaceTemplateId: string) => Promise<void>;
  toggleInstalled: (templateId: string) => Promise<void>;
  setDefaultTemplate: (templateId: string) => void;
  saveTemplate: (name: string) => Promise<void>;
  saveTemplateAs: (schema: TemplateSchema, destination?: 'root' | 'space') => Promise<boolean>;
  publishToSpace: (perspectiveUuid: string, spaceName: string) => Promise<boolean>;
  deleteMarketplaceTemplate: (templateId: string) => Promise<void>;
  publishToMarketplace: (options: {
    name: string;
    description: string;
    themeId?: string;
    screenshots: File[];
  }) => Promise<boolean>;
  persistCurrentTemplate: () => Promise<void>;
  preloadSpaceTemplates: (perspective: PerspectiveProxy) => Promise<void>;
  loadSpaceTemplates: (perspective: PerspectiveProxy) => Promise<void>;
  refreshSpaceTemplates: () => Promise<void>;
  clearSpaceTemplates: () => void;
  openShellView: (id: string) => void;
  closeShellView: () => void;
  scrollToId: (id: string) => void;

  // Loading state
  operationLoading: Accessor<string | null>;

  // Queries
  isCoreTemplate: (templateId: string) => boolean;
  isInstalled: (templateId: string) => boolean;
  getTemplateModel: (templateId: string) => Template | undefined;
}

const TemplateContext = createContext<TemplateStore>();

const SPACE_PREFIX = 'space::';

export function TemplateStoreProvider(props: ParentProps) {
  const adamStore = useAdamStore();
  const routeStore = useRouteStore();

  // Map template ID → AD4M model instance for we-root templates
  const savedTemplateMap = new Map<string, Template>();
  // Map template ID → AD4M model instance for the current space's templates
  const spaceTemplateMap = new Map<string, Template>();

  // Per-session cache of space templates keyed by perspective UUID.
  // Populated on first visit; subsequent visits restore synchronously without an AD4M fetch.
  interface SpaceTemplateCacheEntry {
    schemas: TemplateSchema[];
    models: Map<string, Template>;
    ids: Set<string>;
  }
  const spaceTemplateCache = new Map<string, SpaceTemplateCacheEntry>();

  // Core templates from registry (always available)
  const coreTemplates: TemplateSchema[] = Object.entries(templateRegistry).map(([id, template]) => ({
    ...deepClone(template),
    id,
  }));

  // Shell templates — static system pages (profile, settings, testing)
  // landing-page is now an overlay (activeShellView), not a currentTemplate value
  const shellTemplates: TemplateSchema[] = [
    { ...deepClone(profileTemplate), id: 'profile' },
    { ...deepClone(settingsTemplate), id: 'settings' },
    { ...deepClone(schemaTestsTemplate), id: 'schema-tests' },
  ];

  const initialTemplate = deepClone(
    coreTemplates.find((t) => t.id === 'launcher') || coreTemplates[0] || emptyTemplate,
  );

  console.log(
    'TemplateStore: Initializing with core templates:',
    coreTemplates.map((t) => t.id),
  );

  // State
  const [allTemplates, setAllTemplates] = createSignal<TemplateSchema[]>([...coreTemplates]);
  const [installedIds, setInstalledIds] = createSignal<Set<string>>(new Set());
  const [spaceTemplateIdSet, setSpaceTemplateIdSet] = createSignal<Set<string>>(new Set());
  const [loading, setLoading] = createSignal(true);
  const [currentTemplate, setCurrentTemplate] = createStore<TemplateSchema>(initialTemplate);
  const [operationLoading, setOperationLoading] = createSignal<string | null>(null);
  // Shell overlay: which shell view (if any) is currently shown above the active template
  const [activeShellView, setActiveShellView] = createSignal<string | null>('landing-page');

  const personalTemplates = () => {
    const installed = installedIds();
    const spaceIds = spaceTemplateIdSet();
    return allTemplates().filter(
      (t) => !spaceIds.has(t.id || '') && (isCoreTemplateId(t.id || '') || installed.has(t.id || '')),
    );
  };

  const spaceTemplates = () => allTemplates().filter((t) => t._fromSpace);

  const coreTemplatesAccessor = () => allTemplates().filter((t) => isCoreTemplateId(t.id || ''));

  // User-installed templates that are neither built-in core nor from the current space
  const myTemplates = () => {
    const installed = installedIds();
    return allTemplates().filter((t) => !isCoreTemplateId(t.id || '') && !t._fromSpace && installed.has(t.id || ''));
  };

  const toSwitcherItems = (templates: TemplateSchema[], prefix = ''): TemplateSwitcherItem[] =>
    templates.map((t) => ({ id: prefix + (t.id || ''), name: t.meta?.name || '', icon: t.meta?.icon || '' }));

  // Grouped template data for the template switcher UI — flat name/icon fields allow $filter in schemas
  const switcherGroups = (): TemplateSwitcherGroup[] => [
    { label: 'Space templates', items: toSwitcherItems(spaceTemplates(), SPACE_PREFIX) },
    { label: 'My templates', items: toSwitcherItems(myTemplates()) },
    { label: 'Built-in', items: toSwitcherItems(coreTemplatesAccessor()) },
  ];

  const defaultTemplateId = () => adamStore.agentSettings()?.defaultTemplateId || 'default';

  /** Load saved templates from root perspective and merge with built-in */
  async function loadSavedTemplates(): Promise<void> {
    try {
      const perspective = adamStore.rootPerspective();
      if (!perspective) return;

      const allDbTemplates = await Template.findAll(perspective);

      savedTemplateMap.clear();
      const savedTemplates: TemplateSchema[] = [];

      for (const template of allDbTemplates) {
        const decoded = decodeFileAsJson(template.schema);
        if (!decoded || typeof decoded !== 'object') continue;

        // The schema field stores a StoredTemplate { schema, sections }
        const stored = decoded as unknown as StoredTemplate;
        const schema = 'schema' in stored && stored.schema ? stored.schema : (stored as unknown as TemplateSchema);
        // Prefer the ID embedded in the schema (set during save) over deriving from name
        const templateId = schema.id || template.name?.toLowerCase().replace(/\s+/g, '-') || template.id;

        const entry = { ...schema, id: templateId, templateVersion: template.version ?? 1 };
        savedTemplates.push(entry);
        savedTemplateMap.set(templateId, template);
      }

      // If a saved template shares an ID with a core template, use the saved version
      const savedIds = new Set(savedTemplates.map((t) => t.id));
      const filteredCore = coreTemplates.filter((t) => !savedIds.has(t.id));
      setAllTemplates([...filteredCore, ...savedTemplates]);

      // Build installed ID set from AgentSettings HasMany relation
      // HasMany without .include() returns raw URI strings, not model instances.
      // Build a reverse map from AD4M model ID → template slug so we can match them.
      // Merge with existing installedIds to preserve any just-added entries
      // (HasMany may not reflect recent addInstalledTemplates calls yet).
      const prefs = adamStore.agentSettings();
      if (prefs) {
        const installedRefs = prefs.installedTemplates || [];
        const modelIdToSlug = new Map<string, string>();
        for (const [slug, model] of savedTemplateMap.entries()) {
          modelIdToSlug.set(model.id, slug);
        }

        const ids = new Set<string>(installedIds());
        for (const ref of installedRefs) {
          // ref may be a string URI or an object with .id
          const modelId = typeof ref === 'string' ? ref : ref.id;
          const slug = modelIdToSlug.get(modelId);
          if (slug) ids.add(slug);
        }
        setInstalledIds(ids);
      }
    } catch (error) {
      console.error('TemplateStore: loadSavedTemplates error', error);
    }
  }

  /** Remove all current-space templates from state — call before switching spaces */
  function clearSpaceTemplates() {
    const spaceIds = new Set(spaceTemplateMap.keys());
    spaceTemplateMap.clear();
    setSpaceTemplateIdSet(new Set<string>());
    if (spaceIds.size === 0) return;
    // Remove only _fromSpace entries — personal templates with the same slug must stay
    setAllTemplates((prev) => prev.filter((t) => !t._fromSpace));
    setInstalledIds((prev) => {
      const next = new Set(prev);
      // Only drop from installedIds if the ID isn't also a personal template
      spaceIds.forEach((id) => {
        if (!savedTemplateMap.has(id)) next.delete(id);
      });
      return next;
    });
  }

  /** Load templates from a space perspective, merge into allTemplates, and populate the cache */
  async function loadSpaceTemplates(perspective: PerspectiveProxy): Promise<void> {
    clearSpaceTemplates();
    try {
      const spaceDbTemplates = await Template.findAll(perspective);
      const schemas: TemplateSchema[] = [];
      const models = new Map<string, Template>();

      for (const template of spaceDbTemplates) {
        const decoded = decodeFileAsJson(template.schema);
        if (!decoded || typeof decoded !== 'object') continue;
        const stored = decoded as unknown as StoredTemplate;
        const schema = 'schema' in stored && stored.schema ? stored.schema : (stored as unknown as TemplateSchema);
        const templateId = schema.id || template.name?.toLowerCase().replace(/\s+/g, '-') || template.id;

        schemas.push({ ...schema, id: templateId, _fromSpace: true });
        models.set(templateId, template);
        spaceTemplateMap.set(templateId, template);
      }

      const ids = new Set(schemas.map((t) => t.id || '').filter(Boolean));

      // Always cache the result (including empty) so subsequent visits skip the fetch
      spaceTemplateCache.set(perspective.uuid, { schemas, models, ids });

      if (schemas.length === 0) return;

      setAllTemplates((prev) => [...prev.filter((t) => !t._fromSpace), ...schemas]);
      setInstalledIds((prev) => {
        const next = new Set(prev);
        schemas.forEach((t) => t.id && next.add(t.id));
        return next;
      });
      setSpaceTemplateIdSet(ids);
    } catch (error) {
      console.error('TemplateStore: loadSpaceTemplates error', error);
    }
  }

  /**
   * Ensure space templates for a perspective are in allTemplates.
   * Cache hit: restores synchronously from session cache (no AD4M fetch).
   * Cache miss: full async load that also populates the cache.
   */
  async function preloadSpaceTemplates(perspective: PerspectiveProxy): Promise<void> {
    const cached = spaceTemplateCache.get(perspective.uuid);
    if (cached) {
      clearSpaceTemplates();
      if (cached.schemas.length > 0) {
        cached.models.forEach((model, id) => spaceTemplateMap.set(id, model));
        setAllTemplates((prev) => [...prev.filter((t) => !t._fromSpace), ...cached.schemas]);
        setInstalledIds((prev) => {
          const next = new Set(prev);
          cached.ids.forEach((id) => next.add(id));
          return next;
        });
        setSpaceTemplateIdSet(cached.ids);
      }
      return;
    }
    await loadSpaceTemplates(perspective);
  }

  // Load saved templates when root perspective becomes available
  createEffect(() => {
    if (adamStore.rootPerspective()) {
      loadSavedTemplates().finally(() => setLoading(false));
    }
  });

  function resolveSpaceFromPerspective(perspective: PerspectiveProxy) {
    const sharedCid = perspective.sharedUrl?.replace('neighbourhood://', '');
    const allKnownSpaces = [...adamStore.personalSpaces(), ...adamStore.sharedSpaces()];
    return sharedCid
      ? allKnownSpaces.find((s) => s.url === sharedCid)
      : allKnownSpaces.find((s) => s.uuid === perspective.uuid);
  }

  // On space switch: apply default template.
  // When navigateToSpace pre-loads templates, the cache is already populated and the
  // template switches synchronously here. For deep links / page refresh, takes the async path.
  let lastSpacePerspectiveUuid: string | null = null;
  createEffect(() => {
    const perspective = adamStore.currentPerspective();
    if (!perspective) {
      clearSpaceTemplates();
      lastSpacePerspectiveUuid = null;
      return;
    }
    if (perspective.uuid === lastSpacePerspectiveUuid) return;
    lastSpacePerspectiveUuid = perspective.uuid;

    if (spaceTemplateCache.has(perspective.uuid)) {
      // Templates were pre-loaded by navigateToSpace — apply synchronously
      const cachedSpace = resolveSpaceFromPerspective(perspective);
      if (cachedSpace?.defaultTemplateId) {
        const template =
          allTemplates().find((t) => t.id === cachedSpace.defaultTemplateId && t._fromSpace) ||
          allTemplates().find((t) => t.id === cachedSpace.defaultTemplateId);
        if (template) replaceTemplate(template);
      }
    } else {
      // Deep link or first boot — async path
      void applySpaceTemplate(perspective);
    }
  });

  async function applySpaceTemplate(perspective: PerspectiveProxy): Promise<void> {
    // preloadSpaceTemplates handles cache hit (sync restore) or miss (AD4M fetch)
    await preloadSpaceTemplates(perspective);

    // Use mySpaces cache for defaultTemplateId — avoids a redundant Space.findOne round-trip
    const cachedSpace = resolveSpaceFromPerspective(perspective);
    if (!cachedSpace?.defaultTemplateId) return;
    const spaceTemplateId = cachedSpace.defaultTemplateId;

    // Check per-space preference stored in we-root
    const sharedCid = perspective.sharedUrl?.replace('neighbourhood://', '');
    const rootPerspective = adamStore.rootPerspective();
    const spaceUrl = sharedCid || perspective.uuid;
    let perSpacePref: string | null = null;
    if (rootPerspective) {
      const prefs = await SpaceTemplatePreference.findAll(rootPerspective, {
        where: { spaceUrl },
      }).catch(() => [] as SpaceTemplatePreference[]);
      if (prefs.length > 0) perSpacePref = prefs[0].preference;
    }

    // Per-space "user" means they explicitly chose their own template for this space
    if (perSpacePref === 'user') return;

    const spaceTemplate =
      allTemplates().find((t) => t.id === spaceTemplateId && t._fromSpace) ||
      allTemplates().find((t) => t.id === spaceTemplateId);
    if (!spaceTemplate) return;

    // Guard: if the user navigated away before the async work completed, skip
    if (adamStore.currentPerspective()?.uuid !== perspective.uuid) return;

    replaceTemplate(spaceTemplate);

    const settings = adamStore.agentSettings();
    if (settings && !settings.useSpaceTemplate && perSpacePref !== 'space') {
      toastService.info(`Viewing with this space's template. Open Settings to use your own.`, 7000);
    }
  }

  // Restore persisted template choice on boot (runs once, then stops)
  let initialRestoreDone = false;
  createEffect(() => {
    const prefs = adamStore.agentSettings();
    if (loading() || initialRestoreDone) return;
    // Use defaultTemplateId for boot, fall back to currentTemplateId for backward compat
    const bootId = prefs?.defaultTemplateId || prefs?.currentTemplateId;
    // Always boot on the landing page overlay — skip restore for 'default' and 'landing-page'.
    // 'landing-page' is now an overlay (activeShellView), not a template to restore.
    // Only restore explicitly non-default templates (e.g. a custom template the user was editing).
    if (bootId && bootId !== 'default' && bootId !== 'landing-page' && bootId !== currentTemplate.id) {
      const persisted = allTemplates().find((t) => t.id === bootId) || shellTemplates.find((t) => t.id === bootId);
      if (persisted) {
        setCurrentTemplate(reconcile(deepClone(persisted)));
        initialRestoreDone = true;
      }
    }
    initialRestoreDone = true;
  });

  // Actions
  function updateTemplate(newTemplate: TemplateSchema) {
    const result = updateSchema(currentTemplate, newTemplate, setCurrentTemplate);
    if (!result.applied && result.errors?.length) {
      toastService.error(`Schema validation failed: ${result.errors[0].message}`);
    }
  }

  /** Replace the current template wholesale using reconcile (bypasses findMutations).
   *  Preferred for AI updates where large structural changes (new routes, etc.) need
   *  reliable reactivity. Caller is responsible for pre-validating the schema. */
  function replaceTemplate(newTemplate: TemplateSchema) {
    setCurrentTemplate(reconcile(deepClone(newTemplate)));
  }

  // Per-template last-view memory — remembers which view segment (e.g. 'globe', 'chat')
  // was active for each template. Intentionally stores only the view, not the space ID,
  // so that template switching and space selection remain independent.
  const lastViewByTemplate = new Map<string, string>();

  function switchTemplate(newTemplateId: string) {
    const isSpace = newTemplateId.startsWith(SPACE_PREFIX);
    const realId = isSpace ? newTemplateId.slice(SPACE_PREFIX.length) : newTemplateId;
    // No-op if already on this template from the same source
    if (currentTemplate.id === realId && !!currentTemplate._fromSpace === isSpace) return;
    // If user manually switches before the boot restore fires, skip the restore
    initialRestoreDone = true;
    // Save current view segment before leaving (not the full path — space stays independent)
    if (currentTemplate.id) {
      const segs = routeStore.segments();
      const view = segs[0] === 'space' && segs[2] ? segs[2] : null;
      if (view) lastViewByTemplate.set(currentTemplate.id, view);
    }
    const newTemplate = isSpace
      ? allTemplates().find((t) => t.id === realId && t._fromSpace)
      : allTemplates().find((t) => t.id === realId && !t._fromSpace) || shellTemplates.find((t) => t.id === realId);
    if (newTemplate) {
      setCurrentTemplate(reconcile(deepClone(newTemplate)));
      const segs = routeStore.segments();
      const currentView = segs[0] === 'space' && segs[2] ? segs[2] : 'globe';
      const view = lastViewByTemplate.get(realId) ?? currentView;
      const p = adamStore.currentPerspective();
      if (p) {
        const spaceId = p.sharedUrl ? p.sharedUrl.replace('neighbourhood://', '') : p.uuid;
        routeStore.navigate('/space/' + spaceId + '/' + view);
      } else {
        routeStore.navigate('/');
      }
      adamStore.updateAgentSettings({ currentTemplateId: realId });
    } else {
      console.error(`TemplateStore: switchTemplate - Invalid templateId "${newTemplateId}"`);
    }
  }

  function openShellView(id: string) {
    setActiveShellView(id);
  }

  function closeShellView() {
    setActiveShellView(null);
  }

  function scrollToId(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function removeTemplate() {
    const templateId = currentTemplate.id;

    // If it's a saved (AD4M) template, delete from AD4M
    if (templateId && savedTemplateMap.has(templateId)) {
      const template = savedTemplateMap.get(templateId)!;
      savedTemplateMap.delete(templateId);
      setAllTemplates(allTemplates().filter((t) => t.id !== templateId));
      setInstalledIds((prev) => {
        const next = new Set(prev);
        next.delete(templateId);
        return next;
      });
      // Unlink from AgentSettings and delete template
      const prefs = adamStore.agentSettings();
      if (prefs) await prefs.removeInstalledTemplates(template).catch(() => {});
      template.delete?.().catch((err: unknown) => console.error('TemplateStore: delete error', err));
    }

    setCurrentTemplate(reconcile(deepClone(emptyTemplate)));
  }

  /** Delete a template by ID (does not need to be the current template) */
  async function deleteTemplate(templateId: string): Promise<void> {
    if (!templateId || !savedTemplateMap.has(templateId)) return;

    setOperationLoading(`delete:${templateId}`);
    const template = savedTemplateMap.get(templateId)!;

    // Delete from AD4M first, before updating local state
    try {
      const prefs = adamStore.agentSettings();
      if (prefs) await prefs.removeInstalledTemplates(template).catch(() => {});
      await template.delete();
    } catch (err) {
      console.error('TemplateStore: deleteTemplate AD4M error', err);
      toastService.error('Failed to delete template');
      setOperationLoading(null);
      return;
    }

    // Only update local state after successful AD4M deletion
    savedTemplateMap.delete(templateId);
    setAllTemplates(allTemplates().filter((t) => t.id !== templateId));
    setInstalledIds((prev) => {
      const next = new Set(prev);
      next.delete(templateId);
      return next;
    });

    // If we deleted the current template, switch to the default
    if (currentTemplate.id === templateId) {
      const fallback = allTemplates().find((t) => t.id === 'default') || allTemplates()[0] || emptyTemplate;
      setCurrentTemplate(reconcile(deepClone(fallback)));
    }
    setOperationLoading(null);
  }

  /** Add a template to the installed set (appears in sidebar) */
  async function installTemplate(templateId: string): Promise<void> {
    if (!savedTemplateMap.has(templateId)) return;
    const template = savedTemplateMap.get(templateId)!;

    setOperationLoading(`install:${templateId}`);
    const prefs = adamStore.agentSettings();
    if (prefs) {
      await prefs.addInstalledTemplates(template).catch(() => {});
    }

    setInstalledIds((prev) => {
      const next = new Set(prev);
      next.add(templateId);
      return next;
    });
    setOperationLoading(null);
  }

  /** Remove a template from the installed set (hidden from sidebar, not deleted) */
  async function uninstallTemplate(templateId: string): Promise<void> {
    if (!savedTemplateMap.has(templateId)) return;
    const template = savedTemplateMap.get(templateId)!;

    setOperationLoading(`uninstall:${templateId}`);
    const prefs = adamStore.agentSettings();
    if (prefs) {
      await prefs.removeInstalledTemplates(template).catch(() => {});
    }

    setInstalledIds((prev) => {
      const next = new Set(prev);
      next.delete(templateId);
      return next;
    });
    setOperationLoading(null);
  }

  /** Fetch a template from the marketplace perspective and save it to the user's root perspective */
  async function installFromMarketplace(marketplaceTemplateId: string): Promise<void> {
    const marketplacePerspective = adamStore.marketplacePerspective();
    const rootPerspective = adamStore.rootPerspective();
    if (!marketplacePerspective || !rootPerspective) {
      toastService.error('Cannot install: marketplace not connected');
      return;
    }

    setOperationLoading(`marketplace-install:${marketplaceTemplateId}`);
    try {
      const marketplaceTemplate = await Template.findOne(marketplacePerspective, {
        where: { id: marketplaceTemplateId },
      });
      if (!marketplaceTemplate) {
        toastService.error('Template not found in marketplace');
        return;
      }

      const decoded = decodeFileAsJson(marketplaceTemplate.schema);
      if (!decoded || typeof decoded !== 'object') {
        toastService.error('Could not read template data');
        return;
      }

      const stored = decoded as unknown as StoredTemplate;
      const schema = 'schema' in stored && stored.schema ? stored.schema : (stored as unknown as TemplateSchema);
      const templateId =
        schema.id || marketplaceTemplate.name?.toLowerCase().replace(/\s+/g, '-') || marketplaceTemplateId;
      const newVersion = marketplaceTemplate.version || 1;
      const schemaToInstall: TemplateSchema = { ...deepClone(schema), id: templateId, templateVersion: newVersion };

      const schemaBlob = (() => {
        const storedTemplate = createStoredTemplate(schemaToInstall);
        const jsonBytes = new TextEncoder().encode(JSON.stringify(storedTemplate));
        const base64 = btoa(String.fromCharCode(...jsonBytes));
        return { data_base64: base64, name: 'template-schema.json', file_type: 'application/json' };
      })();

      const existingLocal = savedTemplateMap.get(templateId);
      if (existingLocal) {
        // Already installed — update schema and version in place
        existingLocal.schema = schemaBlob as any;
        existingLocal.version = newVersion;
        await existingLocal.save();
        toastService.success(`"${schemaToInstall.meta.name}" updated to v${newVersion}`);
      } else {
        const newTemplate = await Template.create(rootPerspective, {
          name: schemaToInstall.meta.name,
          origin: 'marketplace',
          slug: templateId,
          version: newVersion,
          schema: schemaBlob as any,
        });
        savedTemplateMap.set(templateId, newTemplate);

        const prefs = adamStore.agentSettings();
        if (prefs) await prefs.addInstalledTemplates(newTemplate);

        setInstalledIds((prev) => {
          const next = new Set(prev);
          next.add(templateId);
          return next;
        });
        toastService.success(`"${schemaToInstall.meta.name}" installed`);
      }

      await loadSavedTemplates();
    } catch (error) {
      console.error('TemplateStore: installFromMarketplace error', error);
      toastService.error(`Failed to install template: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setOperationLoading(null);
    }
  }

  /** Re-fetch space templates for the current perspective — call after any mutation (delete, install) */
  async function refreshSpaceTemplates(): Promise<void> {
    const perspective = adamStore.currentPerspective();
    if (!perspective) return;
    await loadSpaceTemplates(perspective);
  }

  /** Fetch a template from the marketplace and install it into the current space's perspective */
  async function installToSpace(marketplaceTemplateId: string): Promise<void> {
    const marketplacePerspective = adamStore.marketplacePerspective();
    const spacePerspective = adamStore.currentPerspective();
    if (!marketplacePerspective || !spacePerspective) {
      toastService.error('Cannot install: no active space or marketplace not connected');
      return;
    }

    setOperationLoading(`space-install:${marketplaceTemplateId}`);
    try {
      const marketplaceTemplate = await Template.findOne(marketplacePerspective, {
        where: { id: marketplaceTemplateId },
      });
      if (!marketplaceTemplate) {
        toastService.error('Template not found in marketplace');
        return;
      }

      const decoded = decodeFileAsJson(marketplaceTemplate.schema);
      if (!decoded || typeof decoded !== 'object') {
        toastService.error('Could not read template data');
        return;
      }

      const stored = decoded as unknown as StoredTemplate;
      const schema = 'schema' in stored && stored.schema ? stored.schema : (stored as unknown as TemplateSchema);
      const templateId =
        schema.id || marketplaceTemplate.name?.toLowerCase().replace(/\s+/g, '-') || marketplaceTemplateId;
      const schemaToInstall: TemplateSchema = { ...deepClone(schema), id: templateId };

      const schemaBlob = (() => {
        const storedTemplate = createStoredTemplate(schemaToInstall);
        const jsonBytes = new TextEncoder().encode(JSON.stringify(storedTemplate));
        const base64 = btoa(String.fromCharCode(...jsonBytes));
        return { data_base64: base64, name: 'template-schema.json', file_type: 'application/json' };
      })();

      await Template.create(spacePerspective, {
        name: schemaToInstall.meta.name,
        origin: 'marketplace',
        slug: templateId,
        version: marketplaceTemplate.version || 1,
        schema: schemaBlob as any,
      });

      await loadSpaceTemplates(spacePerspective);
      toastService.success(`"${schemaToInstall.meta.name}" installed to space`);
    } catch (error) {
      console.error('TemplateStore: installToSpace error', error);
      toastService.error(`Failed to install template: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setOperationLoading(null);
    }
  }

  /** Set a template as the default (loaded on boot) */
  function setDefaultTemplate(templateId: string): void {
    adamStore.updateAgentSettings({ defaultTemplateId: templateId });
  }

  async function saveTemplate(name: string): Promise<void> {
    const perspective = adamStore.rootPerspective();
    if (!perspective) {
      console.error('TemplateStore: No root perspective available');
      return;
    }

    const templateId = name.toLowerCase().replace(/\s+/g, '-');
    const schemaToSave: TemplateSchema = {
      ...deepClone(currentTemplate),
      id: templateId,
      author: adamStore.me()?.did,
      meta: { ...currentTemplate.meta, name },
    };

    // Wrap in StoredTemplate with computed sections
    const storedTemplate = createStoredTemplate(schemaToSave);
    const jsonBytes = new TextEncoder().encode(JSON.stringify(storedTemplate));
    const base64 = btoa(String.fromCharCode(...jsonBytes));
    const schemaBlob = {
      data_base64: base64,
      name: 'template-schema.json',
      file_type: 'application/json',
    } as FileData;

    try {
      const existingTemplate = savedTemplateMap.get(templateId);
      if (existingTemplate) {
        existingTemplate.schema = schemaBlob as any;
        existingTemplate.name = name;
        existingTemplate.version = (existingTemplate.version || 1) + 1;
        await existingTemplate.save();
      } else {
        const newTemplate = await Template.create(perspective, {
          name,
          origin: 'custom',
          slug: templateId,
          version: 1,
          schema: schemaBlob as any,
        });
        savedTemplateMap.set(templateId, newTemplate);

        // Link to AgentSettings via @HasMany relation
        const prefs = adamStore.agentSettings();
        if (prefs) await prefs.addInstalledTemplates(newTemplate);

        // Immediately mark as installed so it shows in sidebar
        setInstalledIds((prev) => {
          const next = new Set(prev);
          next.add(templateId);
          return next;
        });
      }

      // Refresh templates list from AD4M
      await loadSavedTemplates();
    } catch (error) {
      console.error('TemplateStore: saveTemplate error', error);
    }
  }

  /**
   * Save a provided schema as a new (or updated) template, refresh the
   * templates list, and switch to it. Returns true on success.
   * Pass destination='space' to save into the current space perspective instead of we-root.
   */
  async function saveTemplateAs(schema: TemplateSchema, destination: 'root' | 'space' = 'root'): Promise<boolean> {
    const isSpace = destination === 'space';
    const perspective = isSpace ? adamStore.currentPerspective() : adamStore.rootPerspective();
    if (!perspective) {
      toastService.error(`Cannot save template: no ${isSpace ? 'space' : 'root'} perspective available`);
      return false;
    }

    const templateId = schema.id || schema.meta.name.toLowerCase().replace(/\s+/g, '-');
    setOperationLoading('save');
    const schemaToSave: TemplateSchema = { ...deepClone(schema), id: templateId, author: adamStore.me()?.did };

    const storedTemplate = createStoredTemplate(schemaToSave);
    const jsonBytes = new TextEncoder().encode(JSON.stringify(storedTemplate));
    const base64 = btoa(String.fromCharCode(...jsonBytes));
    const schemaBlob = {
      data_base64: base64,
      name: 'template-schema.json',
      file_type: 'application/json',
    } as FileData;

    try {
      const targetMap = isSpace ? spaceTemplateMap : savedTemplateMap;
      const existingTemplate = targetMap.get(templateId);
      if (existingTemplate) {
        existingTemplate.schema = schemaBlob as any;
        existingTemplate.name = schemaToSave.meta.name;
        existingTemplate.version = (existingTemplate.version || 1) + 1;
        await existingTemplate.save();
      } else {
        const newTemplate = await Template.create(perspective, {
          name: schemaToSave.meta.name,
          origin: isSpace ? 'shared' : 'custom',
          slug: templateId,
          version: 1,
          schema: schemaBlob as any,
        });
        targetMap.set(templateId, newTemplate);

        if (!isSpace) {
          // Link to AgentSettings so it appears in the sidebar
          const prefs = adamStore.agentSettings();
          if (prefs) await prefs.addInstalledTemplates(newTemplate);
        }

        setInstalledIds((prev) => {
          const next = new Set(prev);
          next.add(templateId);
          return next;
        });
      }

      if (isSpace) {
        await loadSpaceTemplates(perspective);
      } else {
        await loadSavedTemplates();
      }

      // Ensure the just-saved template appears in allTemplates even if
      // AD4M's file storage hasn't resolved the schema blob yet
      setAllTemplates((prev) => {
        if (prev.some((t) => t.id === templateId)) return prev;
        const savedModel = savedTemplateMap.get(templateId);
        return [...prev, { ...deepClone(schemaToSave), templateVersion: savedModel?.version ?? 1 }];
      });
      setInstalledIds((prev) => {
        if (prev.has(templateId)) return prev;
        const next = new Set(prev);
        next.add(templateId);
        return next;
      });

      setCurrentTemplate(reconcile(deepClone(schemaToSave)));
      const p = adamStore.currentPerspective();
      if (p) {
        const spaceId = p.sharedUrl ? p.sharedUrl.replace('neighbourhood://', '') : p.uuid;
        const segs = routeStore.segments();
        const view = segs[0] === 'space' && segs[2] ? segs[2] : 'globe';
        routeStore.navigate('/space/' + spaceId + '/' + view);
      } else {
        routeStore.navigate('/');
      }
      adamStore.updateAgentSettings({ currentTemplateId: templateId });
      setOperationLoading(null);
      return true;
    } catch (error) {
      console.error('TemplateStore: saveTemplateAs error', error);
      toastService.error(`Failed to save template: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setOperationLoading(null);
      return false;
    }
  }

  /** Persist the current in-memory template state to AD4M (for saved templates only) */
  async function persistCurrentTemplate(): Promise<void> {
    const templateId = currentTemplate.id;
    if (!templateId || (!savedTemplateMap.has(templateId) && !spaceTemplateMap.has(templateId))) return;

    const perspective = adamStore.rootPerspective();
    if (!perspective) return;

    const cloned = deepClone(currentTemplate);
    delete cloned._fromSpace;
    const schemaToSave: TemplateSchema = { ...cloned, author: adamStore.me()?.did };
    const storedTemplate = createStoredTemplate(schemaToSave);
    // Include a timestamp so the content hash is unique per save — avoids
    // "Key already exists" rejections from the content-addressed store when
    // re-persisting a previously-saved schema (e.g. after undo/redo).
    const envelope = { ...storedTemplate, savedAt: Date.now() };
    const jsonBytes = new TextEncoder().encode(JSON.stringify(envelope));
    const base64 = btoa(String.fromCharCode(...jsonBytes));
    const schemaBlob = {
      data_base64: base64,
      name: 'template-schema.json',
      file_type: 'application/json',
    } as FileData;

    try {
      const existing = savedTemplateMap.get(templateId) ?? spaceTemplateMap.get(templateId);
      if (!existing) return;
      existing.schema = schemaBlob as any;
      existing.version = (existing.version || 1) + 1;
      await existing.save();
    } catch (error) {
      // Content-addressed store returns "Key already exists" when the blob
      // is already stored — this is expected and the data is persisted.
      const msg = String(error);
      if (!msg.includes('Key already exists')) {
        console.error('[TemplateStore] persistCurrentTemplate failed', error);
        return; // Only bail on real errors
      }
    }

    // Update the in-memory templates signal so switching away and back preserves changes.
    // Use schemaToSave (captured before any await) — currentTemplate may have changed
    // if the user navigated to a different template while the save was in flight.
    // Preserve templateVersion from the existing entry — it's sourced from the model record
    // and may not be present on currentTemplate if the fallback path was taken.
    setAllTemplates((prev) =>
      prev.map((t) => {
        if (t.id !== templateId) return t;
        const tv = t.templateVersion ?? savedTemplateMap.get(templateId)?.version ?? 1;
        return { ...schemaToSave, templateVersion: tv };
      }),
    );
  }

  /** Copy the current template into a specific space perspective */
  async function publishToSpace(perspectiveUuid: string, spaceName: string): Promise<boolean> {
    const perspective = adamStore.allPerspectives().find((p) => p.uuid === perspectiveUuid);
    if (!perspective) {
      toastService.error('Space not found');
      return false;
    }

    const schema = currentTemplate;
    const templateId = schema.id || schema.meta.name.toLowerCase().replace(/\s+/g, '-');

    const existing = await Template.findOne(perspective, { where: { slug: templateId } });
    if (existing) {
      toastService.error(`Template "${schema.meta.name}" is already in "${spaceName}"`);
      return false;
    }

    setOperationLoading('publish-space');

    const storedTemplate = createStoredTemplate({ ...deepClone(schema), id: templateId });
    const jsonBytes = new TextEncoder().encode(JSON.stringify(storedTemplate));
    const base64 = btoa(String.fromCharCode(...jsonBytes));
    const schemaBlob = { data_base64: base64, name: 'template-schema.json', file_type: 'application/json' } as FileData;

    try {
      await Template.create(perspective, {
        name: schema.meta.name,
        origin: 'shared',
        slug: templateId,
        version: 1,
        schema: schemaBlob as any,
      });
      toastService.success(`Template "${schema.meta.name}" shared to space "${spaceName}"`);
      return true;
    } catch (error) {
      console.error('TemplateStore: publishToSpace error', error);
      toastService.error('Failed to share template to space');
      return false;
    } finally {
      setOperationLoading(null);
    }
  }

  /** Publish the current template to the marketplace perspective */
  async function deleteMarketplaceTemplate(templateId: string): Promise<void> {
    const marketplacePerspective = adamStore.marketplacePerspective();
    if (!marketplacePerspective) {
      toastService.error('Marketplace not connected');
      return;
    }
    setOperationLoading(`marketplace-delete:${templateId}`);
    try {
      const template = await Template.findOne(marketplacePerspective, { where: { id: templateId } });
      if (!template) {
        toastService.error('Template not found');
        return;
      }
      await template.delete();
    } catch (error) {
      console.error('TemplateStore: deleteMarketplaceTemplate error', error);
      toastService.error('Failed to delete template');
    } finally {
      setOperationLoading(null);
    }
  }

  async function publishToMarketplace(options: {
    name: string;
    description: string;
    themeId?: string;
    screenshots: File[];
  }): Promise<boolean> {
    const marketplacePerspective = adamStore.marketplacePerspective();
    if (!marketplacePerspective) {
      toastService.error('Marketplace not connected');
      return false;
    }

    const schema = currentTemplate;
    const templateId = schema.id || schema.meta.name.toLowerCase().replace(/\s+/g, '-');

    const existing = await Template.findOne(marketplacePerspective, { where: { slug: templateId } });
    if (existing && existing.author !== adamStore.me()?.did) {
      toastService.error(`A template with this slug already exists in the marketplace by a different author`);
      return false;
    }

    setOperationLoading('publish-marketplace');

    const storedTemplate = createStoredTemplate({ ...deepClone(schema), id: templateId, author: adamStore.me()?.did });
    const jsonBytes = new TextEncoder().encode(JSON.stringify(storedTemplate));
    const base64 = btoa(String.fromCharCode(...jsonBytes));
    const schemaBlob = { data_base64: base64, name: 'template-schema.json', file_type: 'application/json' } as FileData;

    try {
      if (existing) {
        // Update existing marketplace entry in place — bump version, replace schema and screenshots
        existing.name = options.name;
        existing.description = options.description;
        existing.version = (existing.version || 1) + 1;
        existing.schema = schemaBlob as any;
        if (options.themeId !== undefined) existing.themeId = options.themeId;
        await existing.save();

        await existing.setScreenshots([]);
        for (const file of options.screenshots) {
          const fileData = await compressImageToFileData(file, `screenshot-${Date.now()}`);
          const imageBlock = await ImageBlock.create(marketplacePerspective, {
            src: fileData as any,
            altText: 'Screenshot',
            version: 1,
          });
          await existing.addScreenshots(imageBlock);
        }

        toastService.success(`Template "${options.name}" updated in marketplace (v${existing.version})`);
      } else {
        const template = await Template.create(marketplacePerspective, {
          name: options.name,
          description: options.description,
          origin: 'marketplace',
          slug: templateId,
          version: 1,
          schema: schemaBlob as any,
          ...(options.themeId ? { themeId: options.themeId } : {}),
        });

        for (const file of options.screenshots) {
          const fileData = await compressImageToFileData(file, `screenshot-${Date.now()}`);
          const imageBlock = await ImageBlock.create(marketplacePerspective, {
            src: fileData as any,
            altText: 'Screenshot',
            version: 1,
          });
          await template.addScreenshots(imageBlock);
        }

        toastService.success(`Template "${options.name}" published to marketplace`);
      }
      return true;
    } catch (error) {
      console.error('TemplateStore: publishToMarketplace error', error);
      toastService.error('Failed to publish template to marketplace');
      return false;
    } finally {
      setOperationLoading(null);
    }
  }

  /** Check if a template ID belongs to a built-in core template */
  function isCoreTemplateId(templateId: string): boolean {
    return coreTemplates.some((t) => t.id === templateId);
  }

  /** Check if a template is a built-in core template (not user-saved/customized) */
  function isCoreTemplate(templateId: string): boolean {
    return isCoreTemplateId(templateId) && !savedTemplateMap.has(templateId);
  }

  /** Check if a custom template is installed (visible in sidebar) */
  function isInstalled(templateId: string): boolean {
    return installedIds().has(templateId);
  }

  /** Get the AD4M Template model instance by slug ID */
  function getTemplateModel(templateId: string): Template | undefined {
    return savedTemplateMap.get(templateId) ?? spaceTemplateMap.get(templateId);
  }

  /** Toggle a custom template's installed state */
  async function toggleInstalled(templateId: string): Promise<void> {
    if (isCoreTemplateId(templateId)) return;
    if (isInstalled(templateId)) {
      await uninstallTemplate(templateId);
    } else {
      await installTemplate(templateId);
    }
  }

  /** Pre-computed list for Settings UI with status flags — excludes space templates */
  const templateManagementList = () => {
    const defaultId = defaultTemplateId();
    const installed = installedIds();
    return allTemplates()
      .filter((t) => !t._fromSpace)
      .map((t) => ({
        id: t.id || '',
        name: t.meta?.name || '',
        icon: t.meta?.icon || '',
        description: t.meta?.description || '',
        isCore: isCoreTemplateId(t.id || ''),
        isInstalled: isCoreTemplateId(t.id || '') || installed.has(t.id || ''),
        isDefault: (t.id || '') === defaultId,
      }));
  };

  const store: TemplateStore = {
    // State
    personalTemplates,
    spaceTemplates,
    coreTemplates: coreTemplatesAccessor,
    myTemplates,
    allTemplates,
    templateManagementList,
    switcherGroups,
    currentTemplate,
    loading,
    defaultTemplateId,
    activeShellView,

    // Actions
    updateTemplate,
    replaceTemplate,
    switchTemplate,
    removeTemplate,
    deleteTemplate,
    installTemplate,
    uninstallTemplate,
    installFromMarketplace,
    deleteMarketplaceTemplate,
    installToSpace,
    refreshSpaceTemplates,
    toggleInstalled,
    setDefaultTemplate,
    saveTemplate,
    saveTemplateAs,
    publishToSpace,
    publishToMarketplace,
    persistCurrentTemplate,
    preloadSpaceTemplates,
    loadSpaceTemplates,
    clearSpaceTemplates,
    openShellView,
    closeShellView,
    scrollToId,

    // Loading state
    operationLoading,

    // Queries
    isCoreTemplate,
    isInstalled,
    getTemplateModel,
  };

  return <TemplateContext.Provider value={store}>{props.children}</TemplateContext.Provider>;
}

export function useTemplateStore(): TemplateStore {
  const ctx = useContext(TemplateContext);
  if (!ctx) throw new Error('useTemplateStore must be used within TemplateStoreProvider');
  return ctx;
}

export default TemplateStoreProvider;
