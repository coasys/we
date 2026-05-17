import { templateRegistry } from '@shared/registries/templateRegistry';
import { profileTemplate, schemaTestsTemplate, settingsTemplate } from '@shared/schemas';
import { deepClone } from '@shared/utils';
import { toastService } from '@we/components/solid';
import type { FileData } from '@we/models';
import { Template } from '@we/models';
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

export interface TemplateStore {
  // State
  templates: Accessor<TemplateSchema[]>;
  allTemplates: Accessor<TemplateSchema[]>;
  templateManagementList: Accessor<TemplateManagementItem[]>;
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
  toggleInstalled: (templateId: string) => Promise<void>;
  setDefaultTemplate: (templateId: string) => void;
  saveTemplate: (name: string) => Promise<void>;
  saveTemplateAs: (schema: TemplateSchema) => Promise<boolean>;
  persistCurrentTemplate: () => Promise<void>;
  openShellView: (id: string) => void;
  closeShellView: () => void;

  // Loading state
  operationLoading: Accessor<string | null>;

  // Queries
  isCoreTemplate: (templateId: string) => boolean;
  isInstalled: (templateId: string) => boolean;
  getTemplateModel: (templateId: string) => Template | undefined;
}

const TemplateContext = createContext<TemplateStore>();

export function TemplateStoreProvider(props: ParentProps) {
  const adamStore = useAdamStore();
  const routeStore = useRouteStore();

  // Map template ID → AD4M model instance (for updates/deletes)
  const savedTemplateMap = new Map<string, Template>();

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
  const [loading, setLoading] = createSignal(true);
  const [currentTemplate, setCurrentTemplate] = createStore<TemplateSchema>(initialTemplate);
  const [operationLoading, setOperationLoading] = createSignal<string | null>(null);
  // Shell overlay: which shell view (if any) is currently shown above the active template
  const [activeShellView, setActiveShellView] = createSignal<string | null>('landing-page');

  // Derived: core templates are always "installed", plus any custom templates in the installed set
  const templates = () => {
    const installed = installedIds();
    return allTemplates().filter((t) => isCoreTemplateId(t.id || '') || installed.has(t.id || ''));
  };

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
        if (!template.schema || typeof template.schema !== 'object') continue;

        // The schema field stores a StoredTemplate { schema, sections }
        const stored = template.schema as unknown as StoredTemplate;
        const schema = 'schema' in stored && stored.schema ? stored.schema : (stored as unknown as TemplateSchema);
        // Prefer the ID embedded in the schema (set during save) over deriving from name
        const templateId = schema.id || template.name?.toLowerCase().replace(/\s+/g, '-') || template.id;

        savedTemplates.push({ ...schema, id: templateId });
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

  // Load saved templates when root perspective becomes available
  createEffect(() => {
    if (adamStore.rootPerspective()) {
      loadSavedTemplates().finally(() => setLoading(false));
    }
  });

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
      const persisted = templates().find((t) => t.id === bootId) || shellTemplates.find((t) => t.id === bootId);
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
    // No-op if already on this template
    if (currentTemplate.id === newTemplateId) return;
    // If user manually switches before the boot restore fires, skip the restore
    initialRestoreDone = true;
    // Save current view segment before leaving (not the full path — space stays independent)
    if (currentTemplate.id) {
      const segs = routeStore.segments();
      const view = segs[0] === 'space' && segs[2] ? segs[2] : null;
      if (view) lastViewByTemplate.set(currentTemplate.id, view);
    }
    const newTemplate =
      allTemplates().find((t) => t.id === newTemplateId) || shellTemplates.find((t) => t.id === newTemplateId);
    if (newTemplate) {
      setCurrentTemplate(reconcile(deepClone(newTemplate)));
      // Always navigate using the current perspective so space selection is not affected.
      // Restore only the view segment for this template if one was previously saved.
      const segs = routeStore.segments();
      const currentView = segs[0] === 'space' && segs[2] ? segs[2] : 'globe';
      const view = lastViewByTemplate.get(newTemplateId) ?? currentView;
      const p = adamStore.currentPerspective();
      if (p) {
        const spaceId = p.sharedUrl ? p.sharedUrl.replace('neighbourhood://', '') : p.uuid;
        routeStore.navigate('/space/' + spaceId + '/' + view);
      } else {
        routeStore.navigate('/');
      }
      // Persist choice to Ad4m
      adamStore.updateAgentSettings({ currentTemplateId: newTemplateId });
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
        existingTemplate.schema = schemaBlob as unknown as Record<string, unknown>;
        existingTemplate.name = name;
        existingTemplate.version = (existingTemplate.version || 1) + 1;
        await existingTemplate.save();
      } else {
        const newTemplate = await Template.create(perspective, {
          name,
          origin: 'custom',
          version: 1,
          schema: schemaBlob as unknown as Record<string, unknown>,
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
   */
  async function saveTemplateAs(schema: TemplateSchema): Promise<boolean> {
    const perspective = adamStore.rootPerspective();
    if (!perspective) {
      toastService.error('Cannot save template: no root perspective available');
      return false;
    }

    const templateId = schema.id || schema.meta.name.toLowerCase().replace(/\s+/g, '-');
    setOperationLoading('save');
    const schemaToSave: TemplateSchema = { ...deepClone(schema), id: templateId };

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
        existingTemplate.schema = schemaBlob as unknown as Record<string, unknown>;
        existingTemplate.name = schemaToSave.meta.name;
        existingTemplate.version = (existingTemplate.version || 1) + 1;
        await existingTemplate.save();
      } else {
        const newTemplate = await Template.create(perspective, {
          name: schemaToSave.meta.name,
          origin: 'custom',
          version: 1,
          schema: schemaBlob as unknown as Record<string, unknown>,
        });
        savedTemplateMap.set(templateId, newTemplate);

        const prefs = adamStore.agentSettings();
        if (prefs) await prefs.addInstalledTemplates(newTemplate);

        // Immediately mark as installed so it shows in sidebar
        setInstalledIds((prev) => {
          const next = new Set(prev);
          next.add(templateId);
          return next;
        });
      }

      await loadSavedTemplates();

      // Ensure the just-saved template appears in allTemplates even if
      // AD4M's file storage hasn't resolved the schema blob yet
      setAllTemplates((prev) => {
        if (prev.some((t) => t.id === templateId)) return prev;
        return [...prev, deepClone(schemaToSave)];
      });
      setInstalledIds((prev) => {
        if (prev.has(templateId)) return prev;
        const next = new Set(prev);
        next.add(templateId);
        return next;
      });

      setCurrentTemplate(reconcile(deepClone(schemaToSave)));
      routeStore.navigate('/');
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
    if (!templateId || !savedTemplateMap.has(templateId)) return;

    const perspective = adamStore.rootPerspective();
    if (!perspective) return;

    const schemaToSave: TemplateSchema = deepClone(currentTemplate);
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
      const existing = savedTemplateMap.get(templateId)!;
      existing.schema = schemaBlob as unknown as Record<string, unknown>;
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
    setAllTemplates((prev) => prev.map((t) => (t.id === templateId ? schemaToSave : t)));
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

  /** Get the AD4M Template model instance by slug ID (for HasMany operations) */
  function getTemplateModel(templateId: string): Template | undefined {
    return savedTemplateMap.get(templateId);
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

  /** Pre-computed list for Settings UI with status flags */
  const templateManagementList = () => {
    const defaultId = defaultTemplateId();
    const installed = installedIds();
    return allTemplates().map((t) => ({
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
    templates,
    allTemplates,
    templateManagementList,
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
    toggleInstalled,
    setDefaultTemplate,
    saveTemplate,
    saveTemplateAs,
    persistCurrentTemplate,
    openShellView,
    closeShellView,

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
