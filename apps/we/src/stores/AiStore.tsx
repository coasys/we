import { Ad4mClient, AITask } from '@coasys/ad4m';
import { Model } from '@coasys/ad4m/lib/src/ai/AIResolver';
import { Accessor, createContext, createEffect, createSignal, ParentProps, useContext } from 'solid-js';

import { applyPatch, type PatchOp, type TemplateSchema, validatePatches, validateSchema } from '@we/schema-renderer/shared';

import { schemaPromptContext } from '@/prompts/schemaContext';
import { schemaPromptExamples } from '@/prompts/schemaExamples';
import { useAdamStore, useTemplateStore } from '@/stores';

export interface AiStore {
  // State
  models: Accessor<Model[]>;
  tasks: Accessor<AITask[]>;

  // Actions
  handleSchemaPrompt: (prompt: string) => Promise<string | undefined>;
}

const AiContext = createContext<AiStore>();

const schemaTask: AITask = {
  taskId: 'we-schema-generation',
  name: 'WE Schema Generation',
  modelId: 'gpt-4',
  systemPrompt: schemaPromptContext,
  promptExamples: schemaPromptExamples,
  metaData: 'Generates UI JSON schema based on user requirements',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export function AiStoreProvider(props: ParentProps) {
  const adamStore = useAdamStore();
  const templateStore = useTemplateStore();

  const [models, setModels] = createSignal<Model[]>([]);
  const [tasks, setTasks] = createSignal<AITask[]>([]);

  async function initialiseStore(client: Ad4mClient): Promise<void> {
    try {
      setModels(await client.ai.getModels());
      setTasks(await client.ai.tasks());

      // Ensure schema task is set up
      const existingSchemaTask = tasks().find((r) => r.name === schemaTask.name);
      if (!existingSchemaTask) {
        console.log('Creating schema task');
        await client.ai.addTask(schemaTask.name, 'default', schemaTask.systemPrompt, schemaTask.promptExamples);
        setTasks(await client.ai.tasks());
        console.log('Schema task created', { tasks: tasks() });
      }
    } catch (error) {
      console.error('AdamStore: getMyAI error', error);
    }
  }

  async function handleSchemaPrompt(textPrompt: string) {
    const client = adamStore.adamClient();
    if (!client) return;

    const fullPrompt = JSON.stringify({ request: textPrompt, currentSchema: templateStore.currentTemplate });

    const existingSchemaTask = tasks().find((t) => t.name === schemaTask.name);
    const taskId = existingSchemaTask ? existingSchemaTask.taskId : null;

    if (!taskId) {
      console.error('Schema task not found');
      return;
    }

    const result = await client.ai.prompt(taskId, fullPrompt);

    console.log('Schema generation result', result);

    try {
      const parsedResult = JSON.parse(result || '{}');
      const response: string | undefined = parsedResult.response;

      // JSON Patch path (primary)
      if (Array.isArray(parsedResult.patches) && parsedResult.patches.length > 0) {
        const patches: PatchOp[] = parsedResult.patches;
        const { valid, errors } = validatePatches(patches);
        if (!valid) {
          console.error('Invalid patches:', errors);
          return `Patches failed validation: ${errors.join(', ')}`;
        }

        const patched = applyPatch(templateStore.currentTemplate, patches) as TemplateSchema;
        const schemaValidation = validateSchema(patched);
        if (!schemaValidation.valid) {
          console.error('Patched schema is invalid:', schemaValidation.errors);
          return `Patched schema failed validation: ${schemaValidation.errors.map((e) => e.message).join(', ')}`;
        }

        console.log('Applying patches:', patches);
        templateStore.updateTemplate(patched);
        return response;
      }

      // Fallback: full schema replacement (backward compat)
      if (parsedResult.updatedSchema) {
        console.log('Falling back to full schema replacement');
        templateStore.updateTemplate(parsedResult.updatedSchema);
        return response;
      }

      return response;
    } catch (e) {
      console.error('Failed to parse schema generation result', e);
      return 'Failed to parse schema generation result';
    }
  }

  createEffect(() => {
    const client = adamStore.adamClient();
    if (client) initialiseStore(client);
  });

  const store: AiStore = {
    // State
    models,
    tasks,

    // Actions
    handleSchemaPrompt,
  };

  return <AiContext.Provider value={store}>{props.children}</AiContext.Provider>;
}

export function useAiStore(): AiStore {
  const ctx = useContext(AiContext);
  if (!ctx) throw new Error('useAiStore must be used within AiStoreProvider');
  return ctx;
}

export default AiStoreProvider;
