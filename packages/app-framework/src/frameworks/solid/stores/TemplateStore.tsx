import type { PerspectiveProxy } from '@coasys/ad4m';
import { templateRegistry } from '@shared/registries/templateRegistry';
import { testMutations } from '@shared/schemas/test/TestTemplate.schema';
import { deepClone } from '@shared/utils';
import type { FileData } from '@we/models';
import { Template } from '@we/models';
import type { StoredTemplate, TemplateMeta, TemplateSchema } from '@we/schema-shared';
import { createStoredTemplate } from '@we/schema-shared';
import { updateSchema } from '@we/schema-solid';
import { Accessor, createContext, createEffect, createSignal, ParentProps, useContext } from 'solid-js';
import { createStore } from 'solid-js/store';

import { useAdamStore } from './AdamStore';

const TEMPLATES_PERSPECTIVE_NAME = 'we-templates';
const emptyMeta: TemplateMeta = { name: '', description: '', icon: '' };
const emptyTemplate: TemplateSchema = { id: '', meta: emptyMeta, type: '', children: [], slots: {}, routes: [] };

export interface TemplateStoreBase {
  // State
  templates: Accessor<TemplateSchema[]>;
  currentTemplate: TemplateSchema;
  loading: Accessor<boolean>;

  // Actions
  updateTemplate: (newTemplate: TemplateSchema) => void;
  switchTemplate: (newTemplateId: string) => void;
  removeTemplate: () => void;
  saveTemplate: (name: string) => Promise<void>;
}

// TODO: Comment out test mutations before deploying
export type TemplateStore = TemplateStoreBase & ReturnType<typeof testMutations>;

const TemplateContext = createContext<TemplateStore>();

export function TemplateStoreProvider(props: ParentProps) {
  const adamStore = useAdamStore();

  // Internal: AD4M perspective for template storage
  const [templatesPerspective, setTemplatesPerspective] = createSignal<PerspectiveProxy | null>(null);
  // Map template ID → AD4M model instance (for updates/deletes)
  const savedModelMap = new Map<string, Template>();

  // Built-in templates from registry (always available)
  const builtInTemplates: TemplateSchema[] = Object.entries(templateRegistry).map(([id, template]) => ({
    ...deepClone(template),
    id,
  }));

  // State
  const [templates, setTemplates] = createSignal<TemplateSchema[]>(builtInTemplates);
  const [loading, setLoading] = createSignal(true);
  const initialTemplate = deepClone(
    builtInTemplates.find((t) => t.id === 'launcher') || builtInTemplates[0] || emptyTemplate,
  );
  const [currentTemplate, setCurrentTemplate] = createStore<TemplateSchema>(initialTemplate);

  /** Find or create the dedicated templates perspective in AD4M */
  async function getOrCreatePerspective(): Promise<PerspectiveProxy | null> {
    const client = adamStore.adamClient();
    if (!client) return null;

    const perspectives = await client.perspective.all();
    let perspective = perspectives.find((p) => p.name === TEMPLATES_PERSPECTIVE_NAME) || null;

    if (!perspective) {
      perspective = await client.perspective.add(TEMPLATES_PERSPECTIVE_NAME);
      await perspective.ensureSDNASubjectClass(Template);
      // AD4M's ensureSDNASubjectClass resolves before SDNA is actually ready
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return perspective;
  }

  /** Load saved templates from AD4M and merge with built-in */
  async function loadSavedTemplates(): Promise<void> {
    try {
      const perspective = await getOrCreatePerspective();
      if (!perspective) return;

      setTemplatesPerspective(perspective);
      const models = await Template.findAll(perspective);

      savedModelMap.clear();
      const savedTemplates: TemplateSchema[] = [];

      for (const model of models) {
        if (!model.schema || typeof model.schema !== 'object') continue;

        // The schema field stores a StoredTemplate { schema, sections }
        const stored = model.schema as unknown as StoredTemplate;
        const schema = 'schema' in stored && stored.schema ? stored.schema : (stored as unknown as TemplateSchema);
        const templateId = model.name?.toLowerCase().replace(/\s+/g, '-') || model.baseExpression;

        savedTemplates.push({ ...schema, id: templateId });
        savedModelMap.set(templateId, model);
      }

      setTemplates([...builtInTemplates, ...savedTemplates]);
    } catch (error) {
      console.error('TemplateStore: loadSavedTemplates error', error);
    }
  }

  // Load saved templates when AD4M client becomes available
  createEffect(() => {
    if (adamStore.adamClient()) {
      loadSavedTemplates().finally(() => setLoading(false));
    }
  });

  // Actions
  function updateTemplate(newTemplate: TemplateSchema) {
    updateSchema(currentTemplate, newTemplate, setCurrentTemplate);
  }

  function switchTemplate(newTemplateId: string) {
    const newTemplate = templates().find((t) => t.id === newTemplateId);
    if (newTemplate) {
      setCurrentTemplate(deepClone(newTemplate));
    } else {
      console.error(`TemplateStore: switchTemplate - Invalid templateId "${newTemplateId}"`);
    }
  }

  function removeTemplate() {
    const templateId = currentTemplate.id;

    // If it's a saved (AD4M) template, delete from AD4M
    if (templateId && savedModelMap.has(templateId)) {
      const model = savedModelMap.get(templateId)!;
      savedModelMap.delete(templateId);
      setTemplates(templates().filter((t) => t.id !== templateId));
      // Fire-and-forget AD4M deletion
      model.delete?.().catch((err: unknown) => console.error('TemplateStore: delete error', err));
    }

    setCurrentTemplate(deepClone(emptyTemplate));
  }

  async function saveTemplate(name: string): Promise<void> {
    const perspective = templatesPerspective();
    if (!perspective) {
      console.error('TemplateStore: No templates perspective available');
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
      const existing = savedModelMap.get(templateId);
      if (existing) {
        existing.schema = schemaBlob as unknown as Record<string, unknown>;
        existing.name = name;
        existing.version = (existing.version || 1) + 1;
        await existing.save();
      } else {
        const model = new Template(perspective);
        model.name = name;
        model.origin = 'custom';
        model.active = true;
        model.version = 1;
        model.schema = schemaBlob as unknown as Record<string, unknown>;
        await model.save();
        savedModelMap.set(templateId, model);
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
    currentTemplate,
    loading,

    // Actions
    updateTemplate,
    switchTemplate,
    removeTemplate,
    saveTemplate,

    // Testing
    ...testMutations(currentTemplate, setCurrentTemplate),
  };

  return <TemplateContext.Provider value={store}>{props.children}</TemplateContext.Provider>;
}

export function useTemplateStore(): TemplateStore {
  const ctx = useContext(TemplateContext);
  if (!ctx) throw new Error('useTemplateStore must be used within TemplateStoreProvider');
  return ctx;
}

export default TemplateStoreProvider;
