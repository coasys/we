import type { TemplateMeta, TemplateSchema } from '@we/schema-renderer/shared';
import { validateSchema } from '@we/schema-renderer/shared';
import { updateSchema } from '@we/schema-renderer/solid';
import { Accessor, createContext, createSignal, ParentProps, useContext } from 'solid-js';
import { createStore } from 'solid-js/store';

import { templateRegistry } from '@/registries/templateRegistry';
import { testMutations } from '@/schemas/TestTemplate.schema';
import { deepClone } from '@/utils';

const SAVED_TEMPLATES_KEY = 'we.savedTemplates';
const CURRENT_TEMPLATE_KEY = 'we.currentTemplate';
const emptyMeta: TemplateMeta = { name: '', description: '', icon: '' };
const emptyTemplate: TemplateSchema = { id: '', meta: emptyMeta, type: '', children: [], slots: {}, routes: [] };

export interface TemplateStoreBase {
  // State
  templates: Accessor<TemplateSchema[]>;
  currentTemplate: TemplateSchema;

  // Actions
  updateTemplate: (newTemplate: TemplateSchema) => void;
  switchTemplate: (newTemplateId: string) => void;
  removeTemplate: () => void;
  saveTemplate: (name: string) => void;
}

// TODO: Comment out test mutations before deploying
export type TemplateStore = TemplateStoreBase & ReturnType<typeof testMutations>;

const TemplateContext = createContext<TemplateStore>();

function getSavedTemplates(): Record<string, TemplateSchema> {
  if (typeof window === 'undefined') return {};
  const saved = localStorage.getItem(SAVED_TEMPLATES_KEY);
  if (!saved) return {};
  try {
    return JSON.parse(saved) as Record<string, TemplateSchema>;
  } catch (error) {
    console.error('Error parsing saved templates from localStorage:', error);
    return {};
  }
}

function getSavedCurrentTemplateId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(CURRENT_TEMPLATE_KEY);
}

// TODO: try removing deepClone calls
export function TemplateStoreProvider(props: ParentProps) {
  // Get initial state
  const mergedTemplates: TemplateSchema[] = [
    ...Object.entries(templateRegistry).map(([id, template]) => ({ ...deepClone(template), id })),
    ...Object.entries(getSavedTemplates()).map(([id, template]) => ({ ...deepClone(template), id })),
  ];
  const initialTemplateId = getSavedCurrentTemplateId() || 'default';
  const initialTemplate = deepClone(mergedTemplates.find((t) => t.id === initialTemplateId) || emptyTemplate);

  // State
  const [templates, setTemplates] = createSignal<TemplateSchema[]>(mergedTemplates);
  const [currentTemplate, setCurrentTemplate] = createStore<TemplateSchema>(initialTemplate);

  // Actions
  function updateTemplate(newTemplate: TemplateSchema) {
    const { valid, errors } = validateSchema(newTemplate);
    if (valid) updateSchema(currentTemplate, newTemplate, setCurrentTemplate);
    else console.error('Invalid template schema:', errors);
  }

  async function switchTemplate(newTemplateId: string) {
    const newTemplate = templates().find((t) => t.id === newTemplateId);
    if (newTemplate) {
      setCurrentTemplate(deepClone(newTemplate));
      localStorage.setItem(CURRENT_TEMPLATE_KEY, newTemplate.id || '');
    } else {
      console.error(`TemplateStore: switchTemplate - Invalid templateId "${newTemplateId}"`);
    }
  }

  function removeTemplate() {
    setCurrentTemplate(emptyTemplate);
    console.log('Template removed', currentTemplate);
  }

  function saveTemplate(name: string) {
    const templateId = name.toLowerCase().replace(/\s+/g, '-');
    const savedTemplates = getSavedTemplates();
    const newTemplate = { ...deepClone(currentTemplate), id: templateId, meta: { ...currentTemplate.meta, name } };
    const newSavedTemplates = { ...savedTemplates, [templateId]: newTemplate };
    localStorage.setItem(SAVED_TEMPLATES_KEY, JSON.stringify(newSavedTemplates));
    localStorage.setItem(CURRENT_TEMPLATE_KEY, templateId);
    setTemplates([
      ...Object.entries(templateRegistry).map(([id, template]) => ({ ...deepClone(template), id })),
      ...Object.entries(newSavedTemplates).map(([id, template]) => ({ ...deepClone(template), id })),
    ]);
    console.log('Template saved');
  }

  const store: TemplateStore = {
    // State
    templates,
    currentTemplate,

    // Setters
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
