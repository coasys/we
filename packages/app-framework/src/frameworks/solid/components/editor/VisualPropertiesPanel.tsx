import { useTemplateStore } from '@solid/stores';
import { deepClone } from '@shared/utils';
import { findNodeById, mergeNode } from '@we/schema-shared';
import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import { useVisualEditor } from '@we/schema-solid';
import { createMemo, For, Show } from 'solid-js';

// -----------------------------------------------------------------------
// Schema helpers
// -----------------------------------------------------------------------

function replaceNodeInTree(schema: SchemaNode, target: SchemaNode, replacement: SchemaNode): SchemaNode {
  if (schema === target) return replacement;
  const clone: SchemaNode = { ...schema };
  if (Array.isArray(schema.children)) {
    clone.children = schema.children.map((child) => {
      if (typeof child === 'string') return child;
      const c = child as SchemaNode;
      return c === target ? replacement : replaceNodeInTree(c, target, replacement);
    });
  }
  if (Array.isArray(schema.routes)) {
    clone.routes = schema.routes.map((r) => {
      const route = r as SchemaNode;
      return route === target ? replacement : replaceNodeInTree(route, target, replacement);
    }) as SchemaNode['routes'];
  }
  if (schema.slots && typeof schema.slots === 'object') {
    const slots: Record<string, SchemaNode> = {};
    for (const [k, v] of Object.entries(schema.slots)) {
      slots[k] = v === target ? replacement : replaceNodeInTree(v, target, replacement);
    }
    clone.slots = slots;
  }
  return clone;
}

// -----------------------------------------------------------------------
// VisualPropertiesPanel
// -----------------------------------------------------------------------

export function VisualPropertiesPanel() {
  const templateStore = useTemplateStore();
  const visualEditor = useVisualEditor();

  // Read selected node directly from the live store — IDs were assigned into the store
  // by ensureNodeIds in TemplateLayout on visual mode entry, so store ids match DOM ids.
  const selectedNode = createMemo<SchemaNode | null>(() => {
    const id = visualEditor.selectedId();
    if (!id) return null;
    return findNodeById(templateStore.currentTemplate, id)?.node ?? null;
  });

  function handlePropChange(key: string, value: unknown) {
    const id = visualEditor.selectedId();
    if (!id) return;
    try {
      const clone = deepClone(templateStore.currentTemplate) as TemplateSchema;
      const found = findNodeById(clone, id);
      if (!found) return;
      const patched = mergeNode(found.node, { [key]: value });
      const updated = replaceNodeInTree(clone as SchemaNode, found.node, patched) as TemplateSchema;
      templateStore.updateTemplate(updated);
      templateStore.persistCurrentTemplate();
    } catch {
      // Ignore errors
    }
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        'flex-direction': 'column',
        overflow: 'hidden',
        background: 'var(--we-color-neutral-0, #fff)',
        'font-family': 'var(--we-font-family-base, system-ui, sans-serif)',
        'font-size': '12px',
        color: 'var(--we-color-neutral-800, #1f2937)',
      }}
    >
      <Show
        when={selectedNode()}
        fallback={
          <div
            style={{
              flex: '1',
              display: 'flex',
              'flex-direction': 'column',
              'align-items': 'center',
              'justify-content': 'center',
              gap: '8px',
              color: 'var(--we-color-neutral-400, #9ca3af)',
              padding: '24px',
              'text-align': 'center',
            }}
          >
            <we-icon name="cursor-click" size="lg" color="neutral-300" />
            <span style={{ 'font-size': '13px' }}>Click any element to inspect it</span>
          </div>
        }
      >
        {(node) => <NodeProperties node={node()} onPropChange={handlePropChange} />}
      </Show>
    </div>
  );
}

// -----------------------------------------------------------------------
// NodeProperties — shows node type + editable props
// -----------------------------------------------------------------------

function NodeProperties(props: { node: SchemaNode; onPropChange: (key: string, value: unknown) => void }) {
  const editableProps = createMemo(() =>
    Object.entries(props.node.props ?? {}).filter(([, v]) => {
      const t = typeof v;
      return t === 'string' || t === 'boolean' || t === 'number';
    }),
  );

  const complexProps = createMemo(() =>
    Object.entries(props.node.props ?? {}).filter(([, v]) => {
      const t = typeof v;
      return t !== 'string' && t !== 'boolean' && t !== 'number';
    }),
  );

  return (
    <>
      {/* Node type header */}
      <div
        style={{
          padding: '12px 14px 10px',
          'border-bottom': '1px solid var(--we-color-neutral-100, #e5e7eb)',
          flex: '0 0 auto',
        }}
      >
        <div
          style={{
            'font-weight': '600',
            'font-size': '13px',
            color: 'var(--we-color-neutral-900, #111827)',
            'margin-bottom': '2px',
          }}
        >
          {props.node.type ?? '(no type)'}
        </div>
        <Show when={props.node.id}>
          <div style={{ color: 'var(--we-color-neutral-400, #9ca3af)', 'font-size': '10px' }}>
            id: {props.node.id}
          </div>
        </Show>
      </div>

      {/* Scrollable props area */}
      <div style={{ flex: '1 1 auto', overflow: 'auto' }}>
        <Show when={editableProps().length === 0 && complexProps().length === 0}>
          <div
            style={{
              padding: '16px 14px',
              color: 'var(--we-color-neutral-400, #9ca3af)',
              'font-size': '12px',
            }}
          >
            No props
          </div>
        </Show>

        {/* Editable primitive props */}
        <Show when={editableProps().length > 0}>
          <div style={{ padding: '4px 0 8px' }}>
            <SectionLabel>Props</SectionLabel>
            <For each={editableProps()}>
              {([key, value]) => (
                <PropRow
                  propKey={key}
                  value={value as string | boolean | number}
                  onChange={(v) => props.onPropChange(key, v)}
                />
              )}
            </For>
          </div>
        </Show>

        {/* Complex / dynamic props — read-only preview */}
        <Show when={complexProps().length > 0}>
          <div style={{ padding: '4px 0 8px' }}>
            <SectionLabel>Dynamic props</SectionLabel>
            <For each={complexProps()}>
              {([key, value]) => (
                <div style={{ padding: '3px 14px 3px' }}>
                  <div
                    style={{
                      'font-size': '11px',
                      'font-weight': '500',
                      color: 'var(--we-color-neutral-500, #6b7280)',
                      'margin-bottom': '2px',
                    }}
                  >
                    {key}
                  </div>
                  <div
                    style={{
                      background: 'var(--we-color-neutral-50, #f9fafb)',
                      'border-radius': '4px',
                      padding: '4px 6px',
                      'font-family': 'monospace',
                      'font-size': '10px',
                      color: 'var(--we-color-neutral-500, #6b7280)',
                      'white-space': 'pre-wrap',
                      'word-break': 'break-all',
                      'max-height': '56px',
                      overflow: 'hidden',
                    }}
                  >
                    {JSON.stringify(value, null, 1).slice(0, 180)}
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </>
  );
}

function SectionLabel(props: { children: string }) {
  return (
    <div
      style={{
        padding: '4px 14px 4px',
        'font-size': '10px',
        'font-weight': '600',
        'text-transform': 'uppercase',
        'letter-spacing': '0.06em',
        color: 'var(--we-color-neutral-400, #9ca3af)',
      }}
    >
      {props.children}
    </div>
  );
}

// -----------------------------------------------------------------------
// PropRow — single editable prop
// -----------------------------------------------------------------------

function PropRow(props: { propKey: string; value: string | boolean | number; onChange: (v: string | boolean | number) => void }) {
  const isBoolean = () => typeof props.value === 'boolean';
  const isNumber = () => typeof props.value === 'number';

  return (
    <div
      style={{
        display: 'grid',
        'grid-template-columns': '1fr 1.2fr',
        gap: '6px',
        'align-items': 'center',
        padding: '3px 14px',
      }}
    >
      <label
        style={{
          'font-size': '11px',
          'font-weight': '500',
          color: 'var(--we-color-neutral-600, #4b5563)',
          overflow: 'hidden',
          'text-overflow': 'ellipsis',
          'white-space': 'nowrap',
        }}
        title={props.propKey}
      >
        {props.propKey}
      </label>
      <Show
        when={isBoolean()}
        fallback={
          <input
            type={isNumber() ? 'number' : 'text'}
            value={String(props.value)}
            style={{
              border: '1px solid var(--we-color-neutral-200, #e5e7eb)',
              'border-radius': '4px',
              padding: '3px 6px',
              'font-size': '11px',
              background: 'var(--we-color-neutral-0, #fff)',
              color: 'var(--we-color-neutral-800, #1f2937)',
              width: '100%',
              'box-sizing': 'border-box',
              outline: 'none',
            }}
            onBlur={(e) => {
              const raw = e.currentTarget.value;
              props.onChange(isNumber() ? Number(raw) : raw);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        }
      >
        <input
          type="checkbox"
          checked={props.value as boolean}
          onChange={(e) => props.onChange(e.currentTarget.checked)}
          style={{ cursor: 'pointer' }}
        />
      </Show>
    </div>
  );
}
