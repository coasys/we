import { templateRegistry, testTemplateRegistry } from '@shared/registries/templateRegistry';
import { schemaMutationActions } from '@shared/schemas/tests/SchemaMutations.actions';
import { deepClone } from '@shared/utils';
import { toastService } from '@we/components/solid';
import type { FileData } from '@we/models';
import { Template } from '@we/models';
import type { StoredTemplate, TemplateMeta, TemplateSchema } from '@we/schema-shared';
import { createStoredTemplate } from '@we/schema-shared';
import { updateSchema } from '@we/schema-solid';
import { Accessor, createContext, createEffect, createMemo, createSignal, ParentProps, useContext } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';

import { useAdamStore } from './AdamStore';

const emptyMeta: TemplateMeta = { name: '', description: '', icon: '' };
const emptyTemplate: TemplateSchema = { id: '', meta: emptyMeta, type: '', children: [], slots: {}, routes: [] };

export interface TemplateStoreBase {
  // State
  templates: Accessor<TemplateSchema[]>;
  mainTemplates: Accessor<TemplateSchema[]>;
  testTemplates: Accessor<TemplateSchema[]>;
  currentTemplate: TemplateSchema;
  loading: Accessor<boolean>;

  // Actions
  updateTemplate: (newTemplate: TemplateSchema) => void;
  switchTemplate: (newTemplateId: string) => void;
  removeTemplate: () => Promise<void>;
  saveTemplate: (name: string) => Promise<void>;
}

// TODO: Comment out test mutations before deploying
export type TemplateStore = TemplateStoreBase & ReturnType<typeof schemaMutationActions>;

const TemplateContext = createContext<TemplateStore>();

export function TemplateStoreProvider(props: ParentProps) {
  const adamStore = useAdamStore();

  // Map template ID → AD4M model instance (for updates/deletes)
  const savedTemplateMap = new Map<string, Template>();

  // Built-in templates from registry (always available)
  const builtInTemplates: TemplateSchema[] = Object.entries(templateRegistry).map(([id, template]) => ({
    ...deepClone(template),
    id,
  }));

  const builtInTestTemplates: TemplateSchema[] = Object.entries(testTemplateRegistry).map(([id, template]) => ({
    ...deepClone(template),
    id,
  }));

  const initialTemplate = deepClone(
    builtInTemplates.find((t) => t.id === 'launcher') || builtInTemplates[0] || emptyTemplate,
  );

  console.log(
    'TemplateStore: Initializing with built-in templates:',
    builtInTemplates.map((t) => t.id),
  );

  // State
  const [templates, setTemplates] = createSignal<TemplateSchema[]>([...builtInTemplates, ...builtInTestTemplates]);
  const [loading, setLoading] = createSignal(true);
  const [currentTemplate, setCurrentTemplate] = createStore<TemplateSchema>(initialTemplate);

  const testTemplateIds = new Set(Object.keys(testTemplateRegistry));
  const mainTemplates = createMemo(() => templates().filter((t) => !testTemplateIds.has(t.id!)));
  const testTemplates = createMemo(() => templates().filter((t) => testTemplateIds.has(t.id!)));

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

      setTemplates([...builtInTemplates, ...builtInTestTemplates, ...savedTemplates]);
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
    const prefs = adamStore.userPreferences();
    if (loading() || initialRestoreDone) return;
    if (prefs?.currentTemplateId && prefs.currentTemplateId !== currentTemplate.id) {
      const persisted = templates().find((t) => t.id === prefs.currentTemplateId);
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
    const newTemplate = templates().find((t) => t.id === newTemplateId);
    if (newTemplate) {
      setCurrentTemplate(reconcile(deepClone(newTemplate)));
      // Persist choice to Ad4m
      adamStore.updatePreferences({ currentTemplateId: newTemplateId });
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
      // Unlink from AgentConfig and delete template
      const prefs = adamStore.userPreferences();
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
    const schemaBlob = {
      data_base64: btoa(JSON.stringify(storedTemplate)),
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

        // Link to AgentConfig via @HasMany relation
        const prefs = adamStore.userPreferences();
        if (prefs) await prefs.addInstalledTemplates(newTemplate);
      }

      // Refresh templates list from AD4M
      await loadSavedTemplates();
    } catch (error) {
      console.error('TemplateStore: saveTemplate error', error);
    }
  }

  const store: TemplateStore = {
    // State
    templates,
    mainTemplates,
    testTemplates,
    currentTemplate,
    loading,

    // Actions
    updateTemplate,
    switchTemplate,
    removeTemplate,
    saveTemplate,

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
