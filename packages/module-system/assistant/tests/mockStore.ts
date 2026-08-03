/**
 * Shared mock AssistantStore + representative fixtures for the assistant-component tests
 * and the screenshot harness. Plain objects cast to the model types — the components only
 * read fields, so no real AD4M perspective/instances are needed.
 */
import { vi } from 'vitest';

import type { Assistant, McpServer, Message, Personality, Skill, Thread } from '../src/models';
import type { AssistantStore } from '../src/store';
import { parseIdList } from '../src/store';

function model<T>(o: Record<string, unknown>): T {
  return o as unknown as T;
}

export const sampleThreads: Thread[] = [
  model<Thread>({
    id: 't1',
    title: 'Weather in Melbourne',
    assistantId: 'a1',
    modelId: '',
    createdAt: '2026-07-28T01:00:00.000Z',
    updatedAt: '2026-07-28T02:00:00.000Z',
  }),
  model<Thread>({
    id: 't2',
    title: 'Refactor ideas',
    assistantId: 'a2',
    modelId: 'qwen2.5-coder',
    createdAt: '2026-07-27T01:00:00.000Z',
    updatedAt: '2026-07-27T05:00:00.000Z',
  }),
];

export const toolCallsJson = JSON.stringify([
  {
    id: 'call_1',
    name: 'get_weather',
    input: { city: 'Melbourne', units: 'metric' },
    result: { tempC: 14, sky: 'cloudy', wind: '12 km/h' },
    status: 'complete',
  },
]);

export const sampleMessages: Message[] = [
  model<Message>({
    id: 'm1',
    threadId: 't1',
    role: 'user',
    content: 'What is the weather in Melbourne right now?',
    toolCalls: '',
    ts: '2026-07-28T02:00:01.000Z',
    status: 'complete',
  }),
  model<Message>({
    id: 'm2',
    threadId: 't1',
    role: 'assistant',
    content: 'Let me check the current conditions for you.',
    toolCalls: toolCallsJson,
    ts: '2026-07-28T02:00:02.000Z',
    status: 'complete',
  }),
  model<Message>({
    id: 'm3',
    threadId: 't1',
    role: 'tool',
    content: '{\n  "tempC": 14,\n  "sky": "cloudy",\n  "wind": "12 km/h"\n}',
    toolCalls: '',
    ts: '2026-07-28T02:00:03.000Z',
    status: 'complete',
  }),
  model<Message>({
    id: 'm4',
    threadId: 't1',
    role: 'assistant',
    content: 'It is currently **14°C and cloudy** in Melbourne, with wind around 12 km/h.',
    toolCalls: '',
    ts: '2026-07-28T02:00:04.000Z',
    status: 'complete',
  }),
];

export const sampleAssistants: Assistant[] = [
  model<Assistant>({
    id: 'a1',
    name: 'Research Assistant',
    modelId: 'llama-3.1-8b',
    systemPrompt: 'Answer concisely and cite sources.',
    personalityIds: JSON.stringify(['p1']),
    skillIds: JSON.stringify(['s1']),
    mcpServerIds: JSON.stringify(['mcp1']),
  }),
  model<Assistant>({
    id: 'a2',
    name: 'Coding Assistant',
    modelId: 'qwen2.5-coder',
    systemPrompt: '',
    personalityIds: '[]',
    skillIds: '[]',
    mcpServerIds: '[]',
  }),
];

export const samplePersonalities: Personality[] = [
  model<Personality>({ id: 'p1', name: 'Friendly', body: 'Warm, encouraging, plain language.' }),
  model<Personality>({ id: 'p2', name: 'Terse', body: 'Minimal words. No filler.' }),
];

export const sampleSkills: Skill[] = [
  model<Skill>({ id: 's1', name: 'web-search', description: 'Search the web for current info', body: '...' }),
  model<Skill>({ id: 's2', name: 'calculator', description: 'Evaluate arithmetic', body: '...' }),
];

export const sampleMcpServers: McpServer[] = [
  model<McpServer>({
    id: 'mcp1',
    name: 'filesystem',
    transport: 'stdio',
    url: '',
    command: 'npx -y @modelcontextprotocol/server-filesystem',
    auth: '',
  }),
];

export const sampleModels = ['llama-3.1-8b', 'qwen2.5-coder', 'gpt-oss-20b'];

/** Build a mock AssistantStore. All accessors return fixtures; all actions are spies. */
export function makeMockStore(overrides: Partial<AssistantStore> = {}): AssistantStore {
  const base: AssistantStore = {
    threads: () => sampleThreads,
    activeThreadId: () => 't1',
    activeThread: () => sampleThreads[0],
    selectThread: vi.fn(),
    createThread: vi.fn(async () => 't-new'),
    deleteThread: vi.fn(async () => {}),
    renameThread: vi.fn(async () => {}),
    setThreadModel: vi.fn(async () => {}),

    messages: () => sampleMessages,
    streamingMessageId: () => null,
    sendMessage: vi.fn(async () => {}),

    assistants: () => sampleAssistants,
    activeAssistant: () => sampleAssistants[0],
    createAssistant: vi.fn(async () => 'a-new'),
    updateAssistant: vi.fn(async () => {}),
    deleteAssistant: vi.fn(async () => {}),
    toggleGrant: vi.fn(async () => {}),
    assistantHasGrant: (assistant, field, itemId) => parseIdList(assistant[field]).includes(itemId),

    personalities: () => samplePersonalities,
    createPersonality: vi.fn(async () => {}),
    updatePersonality: vi.fn(async () => {}),
    deletePersonality: vi.fn(async () => {}),

    skills: () => sampleSkills,
    createSkill: vi.fn(async () => {}),
    updateSkill: vi.fn(async () => {}),
    deleteSkill: vi.fn(async () => {}),

    mcpServers: () => sampleMcpServers,
    createMcpServer: vi.fn(async () => {}),
    updateMcpServer: vi.fn(async () => {}),
    deleteMcpServer: vi.fn(async () => {}),

    models: () => sampleModels,
    refreshModels: vi.fn(async () => {}),

    open: () => true,
    toggle: vi.fn(),
    close: vi.fn(),
  };
  return { ...base, ...overrides };
}
