import type { Ad4mClient } from '@coasys/ad4m';
import type { LanguageModelPort } from '@we/backend-shared';

/**
 * The AD4M executor's AI service, as the neutral language-model port.
 *
 * Prompting here goes through a *task* — the executor's unit of "a system prompt registered
 * against a model" — so the port keeps one task, named below, and reuses it. Found by name rather
 * than held in memory because tasks persist on the executor across sessions: creating one per call
 * would accumulate copies, and holding an id in a variable would leak one task per reload.
 *
 * The task binds to the literal model id `"default"`, which the executor resolves to whatever the
 * user's AI settings name as the default LLM — so changing models in settings changes what answers
 * this, with no re-registration.
 */
const TASK_NAME = 'we://model-authoring';

export function createAd4mLanguageModelPort(backendClient: unknown): LanguageModelPort {
  const client = backendClient as Ad4mClient;

  return {
    async available() {
      try {
        const models = await client.ai.getModels();
        return models.some((m) => m.modelType === 'LLM');
      } catch {
        // An executor without the AI service is a node without a model, not an error.
        return false;
      }
    },

    async prompt(system, input) {
      const tasks = await client.ai.tasks();
      let task = tasks.find((t) => t.name === TASK_NAME);
      if (!task) {
        task = await client.ai.addTask(TASK_NAME, 'default', system, []);
      } else if (task.systemPrompt !== system) {
        /*
          The system prompt evolves with the app; the stored task follows it — by replacement, not
          `updateTask`.

          `updateTask` cannot succeed over the executor's WebSocket RPC: the client sends the task
          without its `taskId`, `createdAt` or `updatedAt`, and the handler deserialises a whole
          `AITask`, so every call is refused with "missing field `taskId`". It went unnoticed because
          it only runs when the prompt changes — the first release to change the model-authoring
          schema made generation fail for everyone who had generated before. Remove and add are both
          sound, and the task holds nothing but what this function writes into it.
        */
        await client.ai.removeTask(task.taskId);
        task = await client.ai.addTask(TASK_NAME, 'default', system, []);
      }
      return client.ai.prompt(task.taskId, input);
    },
  };
}
