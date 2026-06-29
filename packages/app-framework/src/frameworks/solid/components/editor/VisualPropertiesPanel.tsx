import { deepClone } from '@shared/utils';
import { useTemplateStore } from '@solid/stores';
import { contextData } from '@we/ai-context';
import { Combobox, type ComboboxOption } from '@we/components/solid';
import type { ComponentMeta, PropLayer, PropMeta, SchemaNode, TemplateSchema } from '@we/schema-shared';
import { findNodeById, getComponentMeta, mergeNode } from '@we/schema-shared';
import { useVisualEditor } from '@we/schema-solid';
import type { JSX } from 'solid-js';
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';

// -----------------------------------------------------------------------
// Schema helpers
// -----------------------------------------------------------------------

function isPropsSchemaNode(val: unknown): val is SchemaNode {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) return false;
  const type = (val as Record<string, unknown>).type;
  if (typeof type !== 'string') return false;
  return /^[A-Z$]/.test(type) || type.includes('-');
}

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
  // Also traverse SchemaNodes embedded in props (e.g. $if.props.then / .else)
  if (schema.props) {
    const newProps: Record<string, unknown> = {};
    let changed = false;
    for (const [k, v] of Object.entries(schema.props)) {
      if (Array.isArray(v)) {
        const arr = v.map((item) => {
          if (!isPropsSchemaNode(item)) return item;
          const r = item === target ? replacement : replaceNodeInTree(item as SchemaNode, target, replacement);
          if (r !== item) changed = true;
          return r;
        });
        newProps[k] = arr;
      } else if (isPropsSchemaNode(v)) {
        const r = v === target ? replacement : replaceNodeInTree(v as SchemaNode, target, replacement);
        if (r !== v) changed = true;
        newProps[k] = r;
      } else {
        newProps[k] = v;
      }
    }
    if (changed) clone.props = newProps as SchemaNode['props'];
  }
  return clone;
}

// -----------------------------------------------------------------------
// Layer display config
// -----------------------------------------------------------------------

const LAYER_LABELS: Record<PropLayer, string> = {
  component: 'Component',
  size: 'Size',
  position: 'Position',
  spacing: 'Spacing',
  flex: 'Flex',
  visual: 'Visual',
  typography: 'Typography',
  state: 'State',
};

const LAYER_ORDER: PropLayer[] = ['component', 'size', 'position', 'spacing', 'flex', 'visual', 'typography', 'state'];

// All spacing prop keys — excluded from "Set props" list, shown in SpacingSection instead
const ALL_SPACING_KEYS = new Set(['p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml']);

const SPACE_OPTIONS: ComboboxOption[] = [
  '0',
  '100',
  '200',
  '300',
  '400',
  '500',
  '600',
  '700',
  '800',
  '900',
  '1000',
].map((v) => ({ label: v, value: v }));

// -----------------------------------------------------------------------
// VisualPropertiesPanel
// -----------------------------------------------------------------------

export function VisualPropertiesPanel() {
  const templateStore = useTemplateStore();
  const visualEditor = useVisualEditor();

  const selectedNode = createMemo<SchemaNode | null>(() => {
    const id = visualEditor.selectedId();
    if (!id) return null;
    return findNodeById(templateStore.currentTemplate, id)?.node ?? null;
  });

  function handlePropChange(key: string, value: unknown) {
    const id = visualEditor.selectedId();
    console.log('[PropChange] key:', key, 'value:', value, 'selectedId:', id);
    if (!id) return;
    try {
      const clone = deepClone(templateStore.currentTemplate) as TemplateSchema;
      const found = findNodeById(clone, id);
      console.log('[PropChange] found node:', found?.node?.type, found?.node?.props);
      if (!found) return;
      const patch =
        value === '' || value === null || value === false ? { props: { [key]: null } } : { props: { [key]: value } };
      const patched = mergeNode(found.node, patch);
      console.log('[PropChange] patched props:', patched.props);
      const updated = replaceNodeInTree(clone as SchemaNode, found.node, patched) as TemplateSchema;
      templateStore.updateTemplate(updated);
      templateStore.persistCurrentTemplate();
      console.log('[PropChange] done');
    } catch (e) {
      console.error('[PropChange] error:', e);
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
// NodeProperties
// -----------------------------------------------------------------------

function NodeProperties(props: { node: SchemaNode; onPropChange: (key: string, value: unknown) => void }) {
  const meta = createMemo(() => getComponentMeta(props.node.type ?? '', contextData));

  // Current prop values set on this node
  const currentProps = createMemo(() => props.node.props ?? {});

  // Props that are currently set (used) on the node — spacing props excluded (shown in SpacingSection)
  const usedProps = createMemo(() => {
    const used = new Map<string, unknown>();
    for (const [k, v] of Object.entries(currentProps())) {
      if (ALL_SPACING_KEYS.has(k)) continue;
      const t = typeof v;
      if (t === 'string' || t === 'boolean' || t === 'number') {
        used.set(k, v);
      }
    }
    return used;
  });

  // Complex (non-primitive) props — read-only preview
  const complexProps = createMemo(() =>
    Object.entries(currentProps()).filter(([, v]) => {
      const t = typeof v;
      return t !== 'string' && t !== 'boolean' && t !== 'number';
    }),
  );

  // All available props from meta, grouped by layer
  const availableByLayer = createMemo(() => {
    const m = meta();
    if (!m) return new Map<PropLayer, PropMeta[]>();
    const groups = new Map<PropLayer, PropMeta[]>();
    for (const p of m.props) {
      if (!groups.has(p.layer)) groups.set(p.layer, []);
      groups.get(p.layer)!.push(p);
    }
    return groups;
  });

  return (
    <>
      {/* Header */}
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
          <div style={{ color: 'var(--we-color-neutral-400, #9ca3af)', 'font-size': '10px' }}>id: {props.node.id}</div>
        </Show>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: '1 1 auto', overflow: 'auto' }}>
        {/* Spacing — always-visible box model for padding + margin */}
        <BoxModel meta={meta()} currentProps={currentProps()} onPropChange={props.onPropChange} />

        {/* Used props — always visible */}
        <Show when={usedProps().size > 0}>
          <div style={{ padding: '4px 0 8px' }}>
            <SectionLabel>Set props</SectionLabel>
            <For each={[...usedProps().entries()]}>
              {([key, value]) => {
                const propMeta = meta()?.props.find((p) => p.name === key);
                return (
                  <PropRow
                    propKey={key}
                    value={value as string | boolean | number}
                    options={propMeta?.options}
                    valueType={propMeta?.valueType ?? (typeof value as 'string' | 'boolean' | 'number')}
                    onChange={(v) => props.onPropChange(key, v)}
                  />
                );
              }}
            </For>
          </div>
        </Show>

        {/* Available props grouped by layer — spacing handled by SpacingSection above */}
        <Show when={availableByLayer().size > 0}>
          <For each={LAYER_ORDER.filter((l) => l !== 'spacing')}>
            {(layer) => {
              const layerProps = () => availableByLayer().get(layer) ?? [];
              const unsetProps = () => layerProps().filter((p) => !usedProps().has(p.name));
              return (
                <Show when={unsetProps().length > 0}>
                  <CollapsibleSection label={LAYER_LABELS[layer]}>
                    <For each={unsetProps()}>
                      {(p) => (
                        <PropRow
                          propKey={p.name}
                          value={''}
                          options={p.options}
                          valueType={p.valueType}
                          onChange={(v) => props.onPropChange(p.name, v)}
                        />
                      )}
                    </For>
                  </CollapsibleSection>
                </Show>
              );
            }}
          </For>
        </Show>

        {/* Unknown component — show any primitive props that are set */}
        <Show when={!meta() && usedProps().size === 0 && complexProps().length === 0}>
          <div style={{ padding: '16px 14px', color: 'var(--we-color-neutral-400, #9ca3af)', 'font-size': '12px' }}>
            No props
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

// -----------------------------------------------------------------------
// CollapsibleSection
// -----------------------------------------------------------------------

function CollapsibleSection(props: { label: string; children: JSX.Element }) {
  const [open, setOpen] = createSignal(false);

  return (
    <div style={{ 'border-top': '1px solid var(--we-color-neutral-50, #f9fafb)' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '4px',
          width: '100%',
          padding: '5px 14px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          'text-align': 'left',
          'font-size': '10px',
          'font-weight': '600',
          'text-transform': 'uppercase',
          'letter-spacing': '0.06em',
          color: 'var(--we-color-neutral-400, #9ca3af)',
          'font-family': 'inherit',
        }}
      >
        <we-icon name={open() ? 'caret-down' : 'caret-right'} size="xs" />
        {props.label}
      </button>
      <Show when={open()}>
        <div style={{ 'padding-bottom': '6px' }}>{props.children}</div>
      </Show>
    </div>
  );
}

// -----------------------------------------------------------------------
// SectionLabel
// -----------------------------------------------------------------------

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
// InlineSpaceInput — minimal click-to-open token picker for the box model
// -----------------------------------------------------------------------

function InlineSpaceInput(props: {
  value: string;
  placeholder: string;
  color?: string;
  placeholderColor?: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = createSignal(false);
  let ref!: HTMLDivElement;

  createEffect(() => {
    if (!open()) return;
    const handler = (e: MouseEvent) => {
      if (!ref.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    onCleanup(() => document.removeEventListener('mousedown', handler));
  });

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        style={{
          background: 'none',
          border: 'none',
          'border-radius': '3px',
          cursor: 'pointer',
          'font-size': '10px',
          'font-weight': props.value ? '500' : '400',
          color: props.value
            ? (props.color ?? 'var(--we-color-neutral-800)')
            : (props.placeholderColor ?? props.color ?? 'var(--we-color-neutral-400)'),
          padding: '1px 4px',
          'min-width': '22px',
          'text-align': 'center',
          'font-family': 'inherit',
          'line-height': '1.4',
        }}
      >
        {props.value || props.placeholder}
      </button>
      <Show when={open()}>
        <div
          style={{
            position: 'absolute',
            'z-index': '600',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            'margin-top': '2px',
            background: 'var(--we-color-neutral-0)',
            border: '1px solid var(--we-color-neutral-200)',
            'border-radius': '6px',
            'box-shadow': '0 4px 12px rgba(0,0,0,0.12)',
            padding: '3px',
            'min-width': '64px',
            'max-height': '200px',
            'overflow-y': 'auto',
          }}
        >
          <For each={[...(props.value ? ['(unset)'] : []), ...SPACE_OPTIONS.map((o) => o.value)]}>
            {(opt) => (
              <button
                onClick={() => {
                  props.onChange(opt === '(unset)' ? '' : opt);
                  setOpen(false);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '3px 8px',
                  background: opt === props.value ? 'var(--we-color-primary-50)' : 'none',
                  border: 'none',
                  cursor: 'pointer',
                  'font-size': '11px',
                  'text-align': 'center',
                  'border-radius': '4px',
                  color:
                    opt === props.value
                      ? 'var(--we-color-primary-600)'
                      : opt === '(unset)'
                        ? 'var(--we-color-neutral-400)'
                        : 'var(--we-color-neutral-700)',
                  'font-weight': opt === props.value ? '600' : '400',
                  'font-family': 'inherit',
                }}
              >
                {opt}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

// -----------------------------------------------------------------------
// BoxModel — Chrome DevTools-style nested rectangle spacing diagram
// -----------------------------------------------------------------------

const BOX_EDGE: JSX.CSSProperties = {
  display: 'flex',
  'align-items': 'center',
  'justify-content': 'center',
};

const BOX_MARGIN = {
  bg: 'var(--we-color-warning-200)',
  border: 'var(--we-color-warning-400)',
  label: 'var(--we-color-warning-800)',
  value: 'var(--we-color-warning-800)',
  placeholder: 'var(--we-color-warning-400)',
};

const BOX_PADDING = {
  bg: 'var(--we-color-success-200)',
  border: 'var(--we-color-success-400)',
  label: 'var(--we-color-success-800)',
  value: 'var(--we-color-success-800)',
  placeholder: 'var(--we-color-success-400)',
};

const BOX_ELEMENT = {
  bg: 'var(--we-color-primary-200)',
  border: 'var(--we-color-primary-400)',
  text: 'var(--we-color-primary-800)',
};

function BoxModel(props: {
  meta: ComponentMeta | null;
  currentProps: Record<string, unknown>;
  onPropChange: (key: string, value: unknown) => void;
}) {
  const availableKeys = () => new Set(props.meta?.props.map((p) => p.name) ?? []);
  const hasPadding = () => ['p', 'pt', 'pr', 'pb', 'pl'].some((k) => availableKeys().has(k));
  const hasMargin = () => ['m', 'mt', 'mr', 'mb', 'ml'].some((k) => availableKeys().has(k));

  const rawVal = (key: string): string => {
    const v = props.currentProps[key];
    return v !== undefined && v !== null ? String(v) : '';
  };

  const paddingPh = () => rawVal('p') || '—';
  const marginPh = () => rawVal('m') || '—';

  const inp = (key: string, ph: string, color?: string, placeholderColor?: string) => (
    <InlineSpaceInput
      value={rawVal(key)}
      placeholder={ph}
      color={color}
      placeholderColor={placeholderColor}
      onChange={(v) => props.onPropChange(key, v)}
    />
  );

  // Inner green padding box containing the element
  const paddingBox = () => (
    <div
      style={{
        display: 'grid',
        'grid-template-columns': '28px 1fr 28px',
        'grid-template-rows': '20px 1fr 20px',
        background: BOX_PADDING.bg,
        border: `1px solid ${BOX_PADDING.border}`,
        'border-radius': '3px',
        'min-height': '72px',
      }}
    >
      <div
        style={{
          'font-size': '8px',
          color: BOX_PADDING.label,
          padding: '2px 4px',
          'line-height': '16px',
          'white-space': 'nowrap',
        }}
      >
        padding
      </div>
      <div style={BOX_EDGE}>{hasPadding() && inp('pt', paddingPh(), BOX_PADDING.value, BOX_PADDING.placeholder)}</div>
      <div />

      <div style={BOX_EDGE}>{hasPadding() && inp('pl', paddingPh(), BOX_PADDING.value, BOX_PADDING.placeholder)}</div>
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          background: BOX_ELEMENT.bg,
          border: `1px solid ${BOX_ELEMENT.border}`,
          'border-radius': '2px',
          margin: '3px',
          'font-size': '9px',
          'font-weight': '600',
          color: BOX_ELEMENT.text,
          overflow: 'hidden',
          'white-space': 'nowrap',
          'text-overflow': 'ellipsis',
          padding: '0 6px',
        }}
      >
        {props.meta?.typeName ?? ''}
      </div>
      <div style={BOX_EDGE}>{hasPadding() && inp('pr', paddingPh(), BOX_PADDING.value, BOX_PADDING.placeholder)}</div>

      <div />
      <div style={BOX_EDGE}>{hasPadding() && inp('pb', paddingPh(), BOX_PADDING.value, BOX_PADDING.placeholder)}</div>
      <div />
    </div>
  );

  return (
    <Show when={hasPadding() || hasMargin()}>
      <div style={{ padding: '8px 14px', 'border-bottom': '1px solid var(--we-color-neutral-100)' }}>
        {/* Shorthand row: quick all-sides setters */}
        <div style={{ display: 'flex', gap: '10px', 'margin-bottom': '6px', 'align-items': 'center' }}>
          <Show when={hasPadding() && availableKeys().has('p')}>
            <div style={{ display: 'flex', 'align-items': 'center', gap: '2px' }}>
              <span
                style={{
                  'font-size': '9px',
                  'font-weight': '700',
                  color: BOX_PADDING.label,
                  'letter-spacing': '0.04em',
                }}
              >
                P
              </span>
              <InlineSpaceInput value={rawVal('p')} placeholder="all" onChange={(v) => props.onPropChange('p', v)} />
            </div>
          </Show>
          <Show when={hasMargin() && availableKeys().has('m')}>
            <div style={{ display: 'flex', 'align-items': 'center', gap: '2px' }}>
              <span
                style={{
                  'font-size': '9px',
                  'font-weight': '700',
                  color: BOX_MARGIN.label,
                  'letter-spacing': '0.04em',
                }}
              >
                M
              </span>
              <InlineSpaceInput value={rawVal('m')} placeholder="all" onChange={(v) => props.onPropChange('m', v)} />
            </div>
          </Show>
        </div>

        {/* Nested box diagram: orange margin wraps green padding wraps blue element */}
        <Show when={hasMargin()} fallback={paddingBox()}>
          <div
            style={{
              display: 'grid',
              'grid-template-columns': '28px 1fr 28px',
              'grid-template-rows': '20px 1fr 20px',
              background: BOX_MARGIN.bg,
              border: `1px solid ${BOX_MARGIN.border}`,
              'border-radius': '4px',
            }}
          >
            <div
              style={{
                'font-size': '8px',
                color: BOX_MARGIN.label,
                padding: '2px 4px',
                'line-height': '16px',
                'white-space': 'nowrap',
              }}
            >
              margin
            </div>
            <div style={BOX_EDGE}>{inp('mt', marginPh(), BOX_MARGIN.value, BOX_MARGIN.placeholder)}</div>
            <div />

            <div style={BOX_EDGE}>{inp('ml', marginPh(), BOX_MARGIN.value, BOX_MARGIN.placeholder)}</div>
            {paddingBox()}
            <div style={BOX_EDGE}>{inp('mr', marginPh(), BOX_MARGIN.value, BOX_MARGIN.placeholder)}</div>

            <div />
            <div style={BOX_EDGE}>{inp('mb', marginPh(), BOX_MARGIN.value, BOX_MARGIN.placeholder)}</div>
            <div />
          </div>
        </Show>
      </div>
    </Show>
  );
}

// -----------------------------------------------------------------------
// PropRow — single editable prop with Combobox or checkbox
// -----------------------------------------------------------------------

function PropRow(props: {
  propKey: string;
  value: string | boolean | number;
  options?: string[];
  valueType: 'string' | 'boolean' | 'number';
  onChange: (v: string | boolean | number) => void;
}) {
  const numInputStyle = {
    border: '1px solid var(--we-color-neutral-200)',
    'border-radius': '4px',
    padding: '3px 6px',
    'font-size': '11px',
    background: 'var(--we-color-neutral-0)',
    color: 'var(--we-color-neutral-800)',
    width: '100%',
    'box-sizing': 'border-box' as const,
    outline: 'none',
    'font-family': 'inherit',
  };

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
          color: 'var(--we-color-neutral-600)',
          overflow: 'hidden',
          'text-overflow': 'ellipsis',
          'white-space': 'nowrap',
        }}
        title={props.propKey}
      >
        {props.propKey}
      </label>

      <Show
        when={props.valueType === 'boolean'}
        fallback={
          <Show
            when={props.valueType === 'number'}
            fallback={
              <Combobox
                options={[
                  ...(props.value !== '' ? [{ label: '(unset)', value: '' } as ComboboxOption] : []),
                  ...(props.options ?? []).map((o) => ({ label: o, value: o }) as ComboboxOption),
                ]}
                value={String(props.value ?? '')}
                size="xs"
                onChange={(v: string) => props.onChange(v)}
              />
            }
          >
            <input
              type="number"
              value={String(props.value)}
              style={numInputStyle}
              onBlur={(e) => {
                const v = Number(e.currentTarget.value);
                if (v !== props.value) props.onChange(v);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          </Show>
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
