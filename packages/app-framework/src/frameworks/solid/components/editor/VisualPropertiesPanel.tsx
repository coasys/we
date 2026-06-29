import { deepClone } from '@shared/utils';
import { useTemplateStore } from '@solid/stores';
import { contextData } from '@we/ai-context';
import { Column, Combobox, type ComboboxOption, Grid, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
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
    if (!id) return;
    try {
      const clone = deepClone(templateStore.currentTemplate) as TemplateSchema;
      const found = findNodeById(clone, id);
      if (!found) return;
      const patch =
        value === '' || value === null || value === false ? { props: { [key]: null } } : { props: { [key]: value } };
      const patched = mergeNode(found.node, patch);
      const updated = replaceNodeInTree(clone as SchemaNode, found.node, patched) as TemplateSchema;
      templateStore.updateTemplate(updated);
      templateStore.persistCurrentTemplate();
    } catch (e) {
      console.error('[PropChange] error:', e);
    }
  }

  return (
    <Column
      width="100%"
      height="100%"
      overflow="hidden"
      bg="neutral-0"
      fontFamily="base"
      fontSize="200"
      color="neutral-800"
    >
      <Show
        when={selectedNode()}
        fallback={
          <Column flex="1" ax="center" ay="center" gap="200" p="600" textAlign="center">
            <we-icon name="cursor-click" size="lg" color="neutral-300" />
            <we-text fontSize="300" color="neutral-400">
              Click any element to inspect it
            </we-text>
          </Column>
        }
      >
        {(node) => <NodeProperties node={node()} onPropChange={handlePropChange} />}
      </Show>
    </Column>
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
      <Column px="400" pt="300" pb="200" gap="100" borderBottom="1px solid neutral-100" flex="none">
        <we-text fontSize="300" fontWeight="600" color="neutral-900">
          {props.node.type ?? '(no type)'}
        </we-text>
        <Show when={props.node.id}>
          <we-text fontSize="100" color="neutral-400">
            id: {props.node.id}
          </we-text>
        </Show>
      </Column>

      {/* Scrollable content */}
      <we-scroll-area style={{ flex: '1' }}>
        {/* Spacing — always-visible box model for padding + margin */}
        <BoxModel meta={meta()} currentProps={currentProps()} onPropChange={props.onPropChange} />

        {/* Used props — always visible */}
        <Show when={usedProps().size > 0}>
          <Column py="100">
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
          </Column>
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
          <we-text py="400" px="14px" color="neutral-400">
            No props
          </we-text>
        </Show>

        {/* Complex / dynamic props — read-only preview */}
        <Show when={complexProps().length > 0}>
          <Column py="100">
            <SectionLabel>Dynamic props</SectionLabel>
            <For each={complexProps()}>
              {([key, value]) => (
                <Column px="400" py="100" gap="100">
                  <we-text fontSize="100" fontWeight="500" color="neutral-500">
                    {key}
                  </we-text>
                  <pre
                    style={{
                      margin: '0',
                      background: tokenVar('color', 'neutral-50'),
                      'border-radius': tokenVar('radius', '200'),
                      padding: '4px 6px',
                      'font-size': '10px',
                      'font-family': 'monospace',
                      color: tokenVar('color', 'neutral-500'),
                      'white-space': 'pre-wrap',
                      'word-break': 'break-all',
                      'max-height': '56px',
                      overflow: 'hidden',
                    }}
                  >
                    {JSON.stringify(value, null, 1).slice(0, 180)}
                  </pre>
                </Column>
              )}
            </For>
          </Column>
        </Show>
      </we-scroll-area>
    </>
  );
}

// -----------------------------------------------------------------------
// CollapsibleSection
// -----------------------------------------------------------------------

function CollapsibleSection(props: { label: string; children: JSX.Element }) {
  const [open, setOpen] = createSignal(false);

  return (
    <Column borderTop="1px solid neutral-50">
      <Row ay="center" gap="100" px="400" py="100" cursor="pointer" onClick={() => setOpen((v) => !v)}>
        <we-icon name={open() ? 'caret-down' : 'caret-right'} size="xs" color="neutral-400" />
        <we-text fontSize="100" fontWeight="600" textTransform="uppercase" letterSpacing="0.06em" color="neutral-400">
          {props.label}
        </we-text>
      </Row>
      <Show when={open()}>
        <Column pb="200">{props.children}</Column>
      </Show>
    </Column>
  );
}

// -----------------------------------------------------------------------
// SectionLabel
// -----------------------------------------------------------------------

function SectionLabel(props: { children: string }) {
  return (
    <we-text
      py="100"
      px="14px"
      fontSize="100"
      fontWeight="600"
      textTransform="uppercase"
      letterSpacing="0.06em"
      color="neutral-400"
    >
      {props.children}
    </we-text>
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
    <Grid
      template="28px 1fr 28px"
      styles={{ 'grid-template-rows': '20px 1fr 20px', 'min-height': '72px' }}
      bg={BOX_PADDING.bg}
      border={`1px solid ${BOX_PADDING.border}`}
      r="100"
      gap="0"
    >
      <we-text
        styles={{ padding: '2px 4px', 'line-height': '16px', 'white-space': 'nowrap' }}
        fontSize="8px"
        color={BOX_PADDING.label}
      >
        padding
      </we-text>
      <Row ax="center" ay="center">
        {hasPadding() && inp('pt', paddingPh(), BOX_PADDING.value, BOX_PADDING.placeholder)}
      </Row>
      <div />

      <Row ax="center" ay="center">
        {hasPadding() && inp('pl', paddingPh(), BOX_PADDING.value, BOX_PADDING.placeholder)}
      </Row>
      <Row
        ax="center"
        ay="center"
        bg={BOX_ELEMENT.bg}
        border={`1px solid ${BOX_ELEMENT.border}`}
        r="50"
        overflow="hidden"
        styles={{ margin: '3px', padding: '0 6px' }}
      >
        <we-text fontSize="9px" fontWeight="700" color={BOX_ELEMENT.text} truncate>
          {props.meta?.typeName ?? ''}
        </we-text>
      </Row>
      <Row ax="center" ay="center">
        {hasPadding() && inp('pr', paddingPh(), BOX_PADDING.value, BOX_PADDING.placeholder)}
      </Row>

      <div />
      <Row ax="center" ay="center">
        {hasPadding() && inp('pb', paddingPh(), BOX_PADDING.value, BOX_PADDING.placeholder)}
      </Row>
      <div />
    </Grid>
  );

  return (
    <Show when={hasPadding() || hasMargin()}>
      <Column px="400" py="200" borderBottom="1px solid neutral-100">
        {/* Shorthand row: quick all-sides setters */}
        <Row gap="300" mb="200" ay="center">
          <Show when={hasPadding() && availableKeys().has('p')}>
            <Row ay="center" gap="100">
              <we-text fontSize="9px" fontWeight="700" color={BOX_PADDING.label} letterSpacing="0.04em">
                P
              </we-text>
              <InlineSpaceInput value={rawVal('p')} placeholder="all" onChange={(v) => props.onPropChange('p', v)} />
            </Row>
          </Show>
          <Show when={hasMargin() && availableKeys().has('m')}>
            <Row ay="center" gap="100">
              <we-text fontSize="9px" fontWeight="700" color={BOX_MARGIN.label} letterSpacing="0.04em">
                M
              </we-text>
              <InlineSpaceInput value={rawVal('m')} placeholder="all" onChange={(v) => props.onPropChange('m', v)} />
            </Row>
          </Show>
        </Row>

        {/* Nested box diagram: orange margin wraps green padding wraps blue element */}
        <Show when={hasMargin()} fallback={paddingBox()}>
          <Grid
            template="28px 1fr 28px"
            styles={{ 'grid-template-rows': '20px 1fr 20px' }}
            bg={BOX_MARGIN.bg}
            border={`1px solid ${BOX_MARGIN.border}`}
            r="100"
            gap="0"
          >
            <we-text
              styles={{ padding: '2px 4px', 'line-height': '16px', 'white-space': 'nowrap' }}
              fontSize="8px"
              color={BOX_MARGIN.label}
            >
              margin
            </we-text>
            <Row ax="center" ay="center">
              {inp('mt', marginPh(), BOX_MARGIN.value, BOX_MARGIN.placeholder)}
            </Row>
            <div />

            <Row ax="center" ay="center">
              {inp('ml', marginPh(), BOX_MARGIN.value, BOX_MARGIN.placeholder)}
            </Row>
            {paddingBox()}
            <Row ax="center" ay="center">
              {inp('mr', marginPh(), BOX_MARGIN.value, BOX_MARGIN.placeholder)}
            </Row>

            <div />
            <Row ax="center" ay="center">
              {inp('mb', marginPh(), BOX_MARGIN.value, BOX_MARGIN.placeholder)}
            </Row>
            <div />
          </Grid>
        </Show>
      </Column>
    </Show>
  );
}

// -----------------------------------------------------------------------
// PropRow — single editable prop with Combobox, number input, or checkbox
// -----------------------------------------------------------------------

function PropRow(props: {
  propKey: string;
  value: string | boolean | number;
  options?: string[];
  valueType: 'string' | 'boolean' | 'number';
  onChange: (v: string | boolean | number) => void;
}) {
  return (
    <Grid template="1fr 1.2fr" gap="200" ay="center" px="400" py="100">
      <we-text title={props.propKey} fontSize="200" fontWeight="500" color="neutral-600" truncate>
        {props.propKey}
      </we-text>

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
            <we-input
              type="number"
              value={String(props.value)}
              size="xs"
              on:change={(e: CustomEvent<string>) => {
                const v = Number(e.detail);
                if (!isNaN(v) && v !== props.value) props.onChange(v);
              }}
            />
          </Show>
        }
      >
        <we-checkbox
          checked={props.value as boolean}
          size="xs"
          on:change={(e: CustomEvent<boolean>) => props.onChange(e.detail)}
        />
      </Show>
    </Grid>
  );
}
