import { templateRegistry } from '@shared/registries/templateRegistry';
import { profileTemplate, schemaTestsTemplate, settingsTemplate } from '@shared/schemas';
import { schemaMutationActions } from '@shared/schemas/shell/tests/SchemaMutations.actions';
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

export interface TemplateStoreBase {
  // State
  templates: Accessor<TemplateSchema[]>;
  shellTemplates: TemplateSchema[];
  currentTemplate: TemplateSchema;
  loading: Accessor<boolean>;

  // Actions
  updateTemplate: (newTemplate: TemplateSchema) => void;
  switchTemplate: (newTemplateId: string) => void;
  removeTemplate: () => Promise<void>;
  saveTemplate: (name: string) => Promise<void>;
  saveTemplateAs: (schema: TemplateSchema) => Promise<boolean>;
  persistCurrentTemplate: () => Promise<void>;

  // Queries
  isCoreTemplate: (templateId: string) => boolean;
}

// TODO: Comment out test mutations before deploying
export type TemplateStore = TemplateStoreBase & ReturnType<typeof schemaMutationActions>;

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
  const [templates, setTemplates] = createSignal<TemplateSchema[]>([...coreTemplates]);
  const [loading, setLoading] = createSignal(true);
  const [currentTemplate, setCurrentTemplate] = createStore<TemplateSchema>(initialTemplate);

  /** Load saved templates from root perspective and merge with built-in */
  async function loadSavedTemplates(): Promise<void> {
    try {
      const perspective = adamStore.rootPerspective();
      if (!perspective) return;

      const templates = await Template.findAll(perspective);

      savedTemplateMap.clear();
      const savedTemplates: TemplateSchema[] = [];

      for (const template of templates) {
        if (!template.schema || typeof template.schema !== 'object') continue;

        // The schema field stores a StoredTemplate { schema, sections }
        const stored = template.schema as unknown as StoredTemplate;
        const schema = 'schema' in stored && stored.schema ? stored.schema : (stored as unknown as TemplateSchema);
        const templateId = template.name?.toLowerCase().replace(/\s+/g, '-') || template.id;

        savedTemplates.push({ ...schema, id: templateId });
        savedTemplateMap.set(templateId, template);
      }

      setTemplates([...coreTemplates, ...savedTemplates]);
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
    if (prefs?.currentTemplateId && prefs.currentTemplateId !== currentTemplate.id) {
      const persisted =
        templates().find((t) => t.id === prefs.currentTemplateId) ||
        shellTemplates.find((t) => t.id === prefs.currentTemplateId);
      if (persisted) {
        setCurrentTemplate(reconcile(deepClone(persisted)));
        initialRestoreDone = true;
      }
    }
  });

  // Actions
  function updateTemplate(newTemplate: TemplateSchema) {
    const result = updateSchema(currentTemplate, newTemplate, setCurrentTemplate);
    if (!result.applied && result.errors?.length) {
      toastService.error(`Schema validation failed: ${result.errors[0].message}`);
    }
  }

  function switchTemplate(newTemplateId: string) {
    const newTemplate =
      templates().find((t) => t.id === newTemplateId) || shellTemplates.find((t) => t.id === newTemplateId);
    if (newTemplate) {
      setCurrentTemplate(reconcile(deepClone(newTemplate)));
      routeStore.navigate('/');
      // Persist choice to Ad4m
      adamStore.updateAgentSettings({ currentTemplateId: newTemplateId });
    } else {
      console.error(`TemplateStore: switchTemplate - Invalid templateId "${newTemplateId}"`);
    }
  }

  async function removeTemplate() {
    const templateId = currentTemplate.id;

    // If it's a saved (AD4M) template, delete from AD4M
    if (templateId && savedTemplateMap.has(templateId)) {
      const template = savedTemplateMap.get(templateId)!;
      savedTemplateMap.delete(templateId);
      setTemplates(templates().filter((t) => t.id !== templateId));
      // Unlink from AgentSettings and delete template
      const prefs = adamStore.agentSettings();
      if (prefs) await prefs.removeInstalledTemplates(template).catch(() => {});
      template.delete?.().catch((err: unknown) => console.error('TemplateStore: delete error', err));
    }

    setCurrentTemplate(reconcile(deepClone(emptyTemplate)));
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
      }

      await loadSavedTemplates();
      // Directly set currentTemplate — don't rely on switchTemplate lookup
      // which can fail if loadSavedTemplates hasn't reflected the new template yet
      setCurrentTemplate(reconcile(deepClone(schemaToSave)));
      routeStore.navigate('/');
      adamStore.updateAgentSettings({ currentTemplateId: templateId });
      return true;
    } catch (error) {
      console.error('TemplateStore: saveTemplateAs error', error);
      toastService.error(`Failed to save template: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    const jsonBytes = new TextEncoder().encode(JSON.stringify(storedTemplate));
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

      // Update the in-memory templates signal so switching away and back preserves changes
      setTemplates((prev) => prev.map((t) => (t.id === templateId ? deepClone(currentTemplate) : t)));
    } catch (error) {
      console.error('TemplateStore: persistCurrentTemplate error', error);
    }
  }

  /** Check if a template is a built-in core template (not user-saved) */
  function isCoreTemplate(templateId: string): boolean {
    return coreTemplates.some((t) => t.id === templateId) && !savedTemplateMap.has(templateId);
  }

  const store: TemplateStore = {
    // State
    templates,
    shellTemplates,
    currentTemplate,
    loading,

    // Actions
    updateTemplate,
    switchTemplate,
    removeTemplate,
    saveTemplate,
    saveTemplateAs,
    persistCurrentTemplate,

    // Queries
    isCoreTemplate,

    // Testing
    ...schemaMutationActions(currentTemplate, setCurrentTemplate),
  };

  return <TemplateContext.Provider value={store}>{props.children}</TemplateContext.Provider>;
}

export function useTemplateStore(): TemplateStore {
  const ctx = useContext(TemplateContext);
  if (!ctx) throw new Error('useTemplateStore must be used within TemplateStoreProvider');
  return ctx;
}

export default TemplateStoreProvider;
