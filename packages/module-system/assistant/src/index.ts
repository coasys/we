import { defineModule } from '@we/module-shared';

import { AssistantConfigPanel } from './components/AssistantConfigPanel';
import { AssistantThreadList } from './components/AssistantThreadList';
import { AssistantThreadView } from './components/AssistantThreadView';
import { Assistant, McpServer, Message, Personality, Skill, Thread } from './models';
import { createAssistantStore } from './store';
import { assistantSlot } from './surface';

export {
  AssistantContext,
  parseIdList,
  parseToolCalls,
  type AssistantStore,
  type ToolCall,
  useAssistantStore,
} from './store';
export * from './models';

/**
 * The AI-assistant module: threads and messages rendered from the dataset, replies written into it
 * by the AD4M backend. The UI never calls a model — streaming is an assistant message's `content`
 * growing under a live subscription.
 *
 * First module to ship its own Solid components (declared via `frameworks`), and first to use
 * `agentModels`: assistant configuration is personal (root dataset), while conversations live in
 * whichever space they were started in — Thread/Message appear in both lists so personal
 * conversations work before any space is opened.
 *
 * `backends: ['ad4m']` for the documented reason (decorated model classes; no manifest→SDNA
 * compiler yet) plus one of its own: the store reads `deps.connection` for `/v1/models` discovery
 * against the executor's HTTP surface, degrading to referenced-model ids without it.
 */
export const assistantModule = defineModule({
  id: 'assistant',
  name: 'AI Assistant',
  description: 'Chat with AI assistants whose replies are produced by the backend',
  icon: 'sparkle',
  backends: ['ad4m'],
  frameworks: ['solid'],
  capabilities: ['storage', 'network:localhost', 'slot:overlay'],

  components: { AssistantConfigPanel, AssistantThreadList, AssistantThreadView },

  models: [Thread, Message],
  agentModels: [Assistant, Personality, Skill, McpServer, Thread, Message],

  slots: [{ anchor: 'overlay', node: assistantSlot, order: 20 }],

  launcher: { icon: 'sparkle', label: 'AI Assistant', action: 'toggle', activeWhen: 'open' },

  createStore: createAssistantStore,
});
