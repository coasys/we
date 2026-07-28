import { Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import type { Assistant } from '@we/models';
import { createEffect, createSignal, For, Show } from 'solid-js';

import { parseIdList, useAssistantStore } from '../../stores/AssistantStore';

type Tab = 'assistants' | 'personalities' | 'skills' | 'mcp';

/**
 * Right pane of the AI-assistant surface: manage the personal assistant configuration
 * (assistants + their model, system prompt and granted personalities/skills/MCP servers)
 * and the reusable libraries (personalities, skills, MCP servers). All data lives in the
 * personal we-root perspective.
 */
export function AssistantConfigPanel() {
  const [tab, setTab] = createSignal<Tab>('assistants');

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'assistants', label: 'Assistants', icon: 'sparkle' },
    { id: 'personalities', label: 'Personalities', icon: 'mask-happy' },
    { id: 'skills', label: 'Skills', icon: 'lightning' },
    { id: 'mcp', label: 'MCP', icon: 'plugs' },
  ];

  return (
    <Column
      width="360px"
      height="100%"
      bg="neutral-25"
      borderLeft={`1px solid ${tokenVar('color', 'ui-200')}`}
      styles={{ 'flex-shrink': '0' }}
    >
      {/* Tab bar */}
      <Row
        ay="center"
        gap="50"
        px="200"
        py="200"
        borderBottom={`1px solid ${tokenVar('color', 'ui-200')}`}
        styles={{ 'flex-shrink': '0', 'overflow-x': 'auto' }}
      >
        <For each={tabs}>
          {(t) => (
            <Row
              ay="center"
              gap="100"
              px="200"
              py="150"
              r="300"
              cursor="pointer"
              bg={tab() === t.id ? 'neutral-150' : 'transparent'}
              hoverProps={{ bg: tab() === t.id ? 'neutral-150' : 'neutral-100' }}
              onClick={() => setTab(t.id)}
              styles={{ 'flex-shrink': '0' }}
            >
              <we-icon name={t.icon} size="xs" color={tab() === t.id ? 'neutral-900' : 'neutral-500'} />
              <we-text fontSize="250" fontWeight={tab() === t.id ? '600' : '400'} color={tab() === t.id ? 'neutral-900' : 'neutral-600'}>
                {t.label}
              </we-text>
            </Row>
          )}
        </For>
      </Row>

      <Column flex="1" overflow="auto" p="300" gap="300">
        <Show when={tab() === 'assistants'}>
          <AssistantsSection />
        </Show>
        <Show when={tab() === 'personalities'}>
          <PersonalitySection />
        </Show>
        <Show when={tab() === 'skills'}>
          <SkillSection />
        </Show>
        <Show when={tab() === 'mcp'}>
          <McpSection />
        </Show>
      </Column>
    </Column>
  );
}

// --------------------------------------------------------------------------- Assistants

function AssistantsSection() {
  const store = useAssistantStore();
  const [selectedId, setSelectedId] = createSignal<string | null>(null);

  const selected = () => store.assistants().find((a) => a.id === selectedId()) ?? store.activeAssistant();

  // Editable buffers, re-seeded when the selected assistant changes.
  const [name, setName] = createSignal('');
  const [modelId, setModelId] = createSignal('');
  const [systemPrompt, setSystemPrompt] = createSignal('');
  createEffect(() => {
    const a = selected();
    setName(a?.name ?? '');
    setModelId(a?.modelId ?? '');
    setSystemPrompt(a?.systemPrompt ?? '');
  });

  async function addAssistant() {
    const id = await store.createAssistant({ name: 'New assistant' });
    if (id) setSelectedId(id);
  }

  async function save() {
    const a = selected();
    if (!a) return;
    await store.updateAssistant(a.id, { name: name(), modelId: modelId(), systemPrompt: systemPrompt() });
  }

  return (
    <Column gap="300">
      <Row ay="center" ax="between">
        <we-text fontSize="300" fontWeight="600">
          Assistants
        </we-text>
        <we-button size="xs" variant="secondary" onClick={addAssistant}>
          <we-icon name="plus" size="xs" />
          <we-text fontSize="200">New</we-text>
        </we-button>
      </Row>

      {/* Assistant picker */}
      <Show
        when={store.assistants().length > 0}
        fallback={<Empty text="No assistants yet. Create one to start chatting." />}
      >
        <select value={selected()?.id ?? ''} onChange={(e) => setSelectedId(e.currentTarget.value)} style={inputStyle()}>
          <For each={store.assistants()}>{(a) => <option value={a.id}>{a.name || 'Assistant'}</option>}</For>
        </select>

        <Show when={selected()}>
          {(a) => (
            <Column gap="250">
              <Field label="Name">
                <we-input value={name()} size="sm" placeholder="Assistant name" on:input={(e: CustomEvent) => setName(e.detail as string)} />
              </Field>

              <Field label="Model">
                <input
                  value={modelId()}
                  list="assistant-model-options"
                  placeholder="model id (e.g. from /v1/models)"
                  onInput={(e) => setModelId(e.currentTarget.value)}
                  style={inputStyle()}
                />
                <datalist id="assistant-model-options">
                  <For each={store.models()}>{(m) => <option value={m} />}</For>
                </datalist>
              </Field>

              <Field label="System prompt">
                <we-textarea
                  value={systemPrompt()}
                  rows={3}
                  resize="vertical"
                  placeholder="Base instructions for this assistant"
                  on:input={(e: CustomEvent) => setSystemPrompt(e.detail as string)}
                />
              </Field>

              <Row gap="200">
                <we-button size="sm" onClick={save}>
                  <we-text fontSize="250">Save changes</we-text>
                </we-button>
                <we-button size="sm" variant="ghost" onClick={() => void store.deleteAssistant(a().id)}>
                  <we-icon name="trash" size="xs" color="danger-400" />
                  <we-text fontSize="250" color="danger-400">
                    Delete
                  </we-text>
                </we-button>
              </Row>

              {/* Grants */}
              <GrantGroup title="Personalities" field="personalityIds" assistant={a()} items={store.personalities()} />
              <GrantGroup title="Skills" field="skillIds" assistant={a()} items={store.skills()} />
              <GrantGroup title="MCP servers" field="mcpServerIds" assistant={a()} items={store.mcpServers()} />
            </Column>
          )}
        </Show>
      </Show>
    </Column>
  );
}

function GrantGroup(props: {
  title: string;
  field: 'personalityIds' | 'skillIds' | 'mcpServerIds';
  assistant: Assistant;
  items: { id: string; name: string }[];
}) {
  const store = useAssistantStore();
  // Read reactively from the live assistant record so toggles reflect immediately.
  const grantedSet = () => new Set(parseIdList(store.assistants().find((a) => a.id === props.assistant.id)?.[props.field]));

  return (
    <Column gap="150">
      <we-text fontSize="200" fontWeight="600" color="neutral-500">
        {props.title}
      </we-text>
      <Show when={props.items.length > 0} fallback={<we-text fontSize="200" color="neutral-400">{`No ${props.title.toLowerCase()} defined`}</we-text>}>
        <Column gap="50">
          <For each={props.items}>
            {(item) => {
              const on = () => grantedSet().has(item.id);
              return (
                <Row
                  ay="center"
                  gap="200"
                  px="200"
                  py="150"
                  r="200"
                  cursor="pointer"
                  hoverProps={{ bg: 'neutral-100' }}
                  onClick={() => void store.toggleGrant(props.assistant.id, props.field, item.id)}
                >
                  <we-icon name={on() ? 'check-square' : 'square'} size="sm" color={on() ? 'primary-500' : 'neutral-400'} />
                  <we-text fontSize="250" color="neutral-700">
                    {item.name || 'Untitled'}
                  </we-text>
                </Row>
              );
            }}
          </For>
        </Column>
      </Show>
    </Column>
  );
}

// --------------------------------------------------------------------------- Personalities

function PersonalitySection() {
  const store = useAssistantStore();
  const [name, setName] = createSignal('');
  const [body, setBody] = createSignal('');
  const [editingId, setEditingId] = createSignal<string | null>(null);

  function reset() {
    setName('');
    setBody('');
    setEditingId(null);
  }

  async function submit() {
    if (!name().trim() && !body().trim()) return;
    const id = editingId();
    if (id) await store.updatePersonality(id, { name: name(), body: body() });
    else await store.createPersonality({ name: name(), body: body() });
    reset();
  }

  return (
    <Column gap="300">
      <we-text fontSize="300" fontWeight="600">
        Personalities
      </we-text>
      <we-text fontSize="200" color="neutral-400">
        Reusable guidance blocks that can be granted to an assistant.
      </we-text>

      <Show when={store.personalities().length > 0} fallback={<Empty text="No personalities yet." />}>
        <Column gap="100">
          <For each={store.personalities()}>
            {(p) => (
              <ListRow
                title={p.name}
                subtitle={p.body}
                onEdit={() => {
                  setEditingId(p.id);
                  setName(p.name);
                  setBody(p.body);
                }}
                onDelete={() => void store.deletePersonality(p.id)}
              />
            )}
          </For>
        </Column>
      </Show>

      <EditorCard title={editingId() ? 'Edit personality' : 'New personality'}>
        <we-input value={name()} size="sm" placeholder="Name" on:input={(e: CustomEvent) => setName(e.detail as string)} />
        <we-textarea value={body()} rows={4} resize="vertical" placeholder="Personality guidance…" on:input={(e: CustomEvent) => setBody(e.detail as string)} />
        <EditorActions editing={!!editingId()} onSubmit={submit} onCancel={reset} />
      </EditorCard>
    </Column>
  );
}

// --------------------------------------------------------------------------- Skills

function SkillSection() {
  const store = useAssistantStore();
  const [name, setName] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [body, setBody] = createSignal('');
  const [editingId, setEditingId] = createSignal<string | null>(null);

  function reset() {
    setName('');
    setDescription('');
    setBody('');
    setEditingId(null);
  }

  async function submit() {
    if (!name().trim()) return;
    const id = editingId();
    if (id) await store.updateSkill(id, { name: name(), description: description(), body: body() });
    else await store.createSkill({ name: name(), description: description(), body: body() });
    reset();
  }

  return (
    <Column gap="300">
      <we-text fontSize="300" fontWeight="600">
        Skills
      </we-text>
      <we-text fontSize="200" color="neutral-400">
        Named capabilities the AD4M backend can equip an assistant with.
      </we-text>

      <Show when={store.skills().length > 0} fallback={<Empty text="No skills yet." />}>
        <Column gap="100">
          <For each={store.skills()}>
            {(s) => (
              <ListRow
                title={s.name}
                subtitle={s.description}
                onEdit={() => {
                  setEditingId(s.id);
                  setName(s.name);
                  setDescription(s.description);
                  setBody(s.body);
                }}
                onDelete={() => void store.deleteSkill(s.id)}
              />
            )}
          </For>
        </Column>
      </Show>

      <EditorCard title={editingId() ? 'Edit skill' : 'New skill'}>
        <we-input value={name()} size="sm" placeholder="Name" on:input={(e: CustomEvent) => setName(e.detail as string)} />
        <we-input value={description()} size="sm" placeholder="Short description" on:input={(e: CustomEvent) => setDescription(e.detail as string)} />
        <we-textarea value={body()} rows={4} resize="vertical" placeholder="Skill definition / instructions…" on:input={(e: CustomEvent) => setBody(e.detail as string)} />
        <EditorActions editing={!!editingId()} onSubmit={submit} onCancel={reset} />
      </EditorCard>
    </Column>
  );
}

// --------------------------------------------------------------------------- MCP servers

function McpSection() {
  const store = useAssistantStore();
  const [name, setName] = createSignal('');
  const [transport, setTransport] = createSignal('stdio');
  const [url, setUrl] = createSignal('');
  const [command, setCommand] = createSignal('');
  const [auth, setAuth] = createSignal('');
  const [editingId, setEditingId] = createSignal<string | null>(null);

  function reset() {
    setName('');
    setTransport('stdio');
    setUrl('');
    setCommand('');
    setAuth('');
    setEditingId(null);
  }

  async function submit() {
    if (!name().trim()) return;
    const data = { name: name(), transport: transport(), url: url(), command: command(), auth: auth() };
    const id = editingId();
    if (id) await store.updateMcpServer(id, data);
    else await store.createMcpServer(data);
    reset();
  }

  const isStdio = () => transport() === 'stdio';

  return (
    <Column gap="300">
      <we-text fontSize="300" fontWeight="600">
        MCP servers
      </we-text>
      <we-text fontSize="200" color="neutral-400">
        Model Context Protocol servers the backend connects to on an assistant's behalf.
      </we-text>

      <Show when={store.mcpServers().length > 0} fallback={<Empty text="No MCP servers yet." />}>
        <Column gap="100">
          <For each={store.mcpServers()}>
            {(m) => (
              <ListRow
                title={m.name}
                subtitle={`${m.transport}${m.url ? ` · ${m.url}` : ''}${m.command ? ` · ${m.command}` : ''}`}
                onEdit={() => {
                  setEditingId(m.id);
                  setName(m.name);
                  setTransport(m.transport || 'stdio');
                  setUrl(m.url);
                  setCommand(m.command);
                  setAuth(m.auth);
                }}
                onDelete={() => void store.deleteMcpServer(m.id)}
              />
            )}
          </For>
        </Column>
      </Show>

      <EditorCard title={editingId() ? 'Edit MCP server' : 'New MCP server'}>
        <we-input value={name()} size="sm" placeholder="Name" on:input={(e: CustomEvent) => setName(e.detail as string)} />
        <Field label="Transport">
          <select value={transport()} onChange={(e) => setTransport(e.currentTarget.value)} style={inputStyle()}>
            <option value="stdio">stdio</option>
            <option value="sse">sse</option>
            <option value="http">http</option>
            <option value="websocket">websocket</option>
          </select>
        </Field>
        <Show
          when={isStdio()}
          fallback={<we-input value={url()} size="sm" placeholder="URL (https://…)" on:input={(e: CustomEvent) => setUrl(e.detail as string)} />}
        >
          <we-input value={command()} size="sm" placeholder="Command (e.g. npx -y @modelcontextprotocol/server-…)" on:input={(e: CustomEvent) => setCommand(e.detail as string)} />
        </Show>
        <we-input value={auth()} size="sm" placeholder="Auth (optional JSON / token)" on:input={(e: CustomEvent) => setAuth(e.detail as string)} />
        <EditorActions editing={!!editingId()} onSubmit={submit} onCancel={reset} />
      </EditorCard>
    </Column>
  );
}

// --------------------------------------------------------------------------- Shared UI bits

function Field(props: { label: string; children: unknown }) {
  return (
    <Column gap="100">
      <we-text fontSize="200" fontWeight="600" color="neutral-500">
        {props.label}
      </we-text>
      {props.children as never}
    </Column>
  );
}

function ListRow(props: { title: string; subtitle?: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <Row ay="center" gap="200" px="200" py="200" r="200" bg="neutral-50" hoverProps={{ bg: 'neutral-100' }}>
      <Column gap="25" styles={{ flex: '1', 'min-width': '0' }}>
        <we-text fontSize="250" fontWeight="600" color="neutral-800" styles={{ 'white-space': 'nowrap', overflow: 'hidden', 'text-overflow': 'ellipsis' }}>
          {props.title || 'Untitled'}
        </we-text>
        <Show when={props.subtitle}>
          <we-text fontSize="200" color="neutral-400" styles={{ 'white-space': 'nowrap', overflow: 'hidden', 'text-overflow': 'ellipsis' }}>
            {props.subtitle}
          </we-text>
        </Show>
      </Column>
      <we-button variant="ghost" size="xs" square onClick={props.onEdit}>
        <we-icon name="pencil-simple" size="xs" color="neutral-500" />
      </we-button>
      <we-button variant="ghost" size="xs" square onClick={props.onDelete}>
        <we-icon name="trash" size="xs" color="neutral-400" />
      </we-button>
    </Row>
  );
}

function EditorCard(props: { title: string; children: unknown }) {
  return (
    <Column gap="200" p="250" r="300" bg="neutral-50" border={`1px solid ${tokenVar('color', 'ui-200')}`}>
      <we-text fontSize="250" fontWeight="600" color="neutral-600">
        {props.title}
      </we-text>
      {props.children as never}
    </Column>
  );
}

function EditorActions(props: { editing: boolean; onSubmit: () => void; onCancel: () => void }) {
  return (
    <Row gap="200">
      <we-button size="sm" onClick={props.onSubmit}>
        <we-text fontSize="250">{props.editing ? 'Save' : 'Add'}</we-text>
      </we-button>
      <Show when={props.editing}>
        <we-button size="sm" variant="ghost" onClick={props.onCancel}>
          <we-text fontSize="250">Cancel</we-text>
        </we-button>
      </Show>
    </Row>
  );
}

function Empty(props: { text: string }) {
  return (
    <we-text fontSize="250" color="neutral-400" italic>
      {props.text}
    </we-text>
  );
}

function inputStyle(): Record<string, string> {
  return {
    'font-size': '13px',
    padding: '6px 10px',
    'border-radius': '6px',
    border: `1px solid ${tokenVar('color', 'ui-200')}`,
    background: tokenVar('color', 'neutral-0'),
    color: tokenVar('color', 'neutral-800'),
    width: '100%',
  };
}
