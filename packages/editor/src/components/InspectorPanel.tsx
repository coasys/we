import { Column, Combobox, type ComboboxOption, Grid, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import type { ComponentMeta, PropLayer, PropMeta, SchemaNode, ScopeGroup, TemplateSchema } from '@we/schema-shared';
import {
  contextData,
  findNodeById,
  getComponentMeta,
  getScopeAtNode,
  isPropsSchemaNode,
  mergeNode,
  replaceNodeInTree,
} from '@we/schema-shared';
import { useVisualEditor } from '@we/schema-solid';
import type { JSX } from 'solid-js';
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';

import { composeRing, parseRing, RING_THEME_ACCENT } from '../helpers';
import { type EditorImage, useEditorHost } from '../host';
import { paintedRoles } from '../paintedRoles';
import { deepClone } from '../utils';
import { ConditionEditor } from './ConditionEditor';
import { ContentEditor } from './ContentEditor';
import { ValueEditor } from './ValueEditor';

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

// bgImageOpacity/bgImageTint are edited inside BgImagePicker's own popover (alongside
// bgImage), not as independent rows — same reasoning as spacing keys above.
const BG_IMAGE_SUB_KEYS = new Set(['bgImageOpacity', 'bgImageTint']);

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
// Icon + color prop config
// -----------------------------------------------------------------------

// Props that render as segmented icon buttons instead of a combobox
const ICON_PROP_ICONS: Record<string, Record<string, string>> = {
  direction: {
    row: 'arrow-right',
    column: 'arrow-down',
    'row-reverse': 'arrow-left',
    'column-reverse': 'arrow-up',
  },
  ax: {
    start: 'align-left',
    center: 'align-center-horizontal',
    end: 'align-right',
    between: 'arrows-out-line-horizontal',
    stretch: 'arrows-horizontal',
  },
  ay: {
    start: 'align-top',
    center: 'align-center-vertical',
    end: 'align-bottom',
    between: 'arrows-out-line-vertical',
    stretch: 'arrows-vertical',
  },
  textAlign: {
    left: 'text-align-left',
    center: 'text-align-center',
    right: 'text-align-right',
    justify: 'text-align-justify',
  },
};

const ICON_PROP_KEYS = new Set(Object.keys(ICON_PROP_ICONS));

// Props that render as a color swatch picker instead of a combobox
const COLOR_PROP_KEYS = new Set(['bg', 'color', 'borderColor']);

// `ring` is a raw box-shadow fragment ("0 0 {blur} {width} {color}" — offset-x/offset-y
// pinned at 0 so it reads as an outline/glow around the element, not a directional
// drop shadow), not a bare color token — it gets its own composite picker (RingPicker)
// instead of ColorSwatchPicker.
const RING_DEFAULT_WIDTH_PX = 2;
const RING_DEFAULT_BLUR_PX = 0;
const RING_DEFAULT_COLOR = 'primary-500';
// Sentinel color value meaning "follow the active theme's ring color" — writes
// var(--we-ring-color) directly instead of a hardcoded token, so it stays in sync
// if the theme's accent color changes later.

// Component types where free text in `children` is idiomatic — used to offer an empty
// "Content" field on childless nodes. Nodes that already have string children get the
// field regardless of type (see showContent in NodeProperties).
const TEXT_CONTENT_TYPES = new Set([
  'we-text',
  'we-button',
  'we-badge',
  'we-tag',
  'we-link',
  'we-alert',
  'span',
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'small',
  'b',
  'i',
  'label',
  'a',
  'pre',
  'code',
  'blockquote',
]);

const COLOR_HUES = ['neutral', 'primary', 'success', 'warning', 'danger'] as const;

/**
 * The roles this picker offers, and the reason it leads with them.
 *
 * Every colour a template sets should name a role: a scale position is frozen into one theme's idea
 * of what that grey meant, and a role is what a theme can redesign. This picker offered *only*
 * scale positions, which meant anything authored through the visual editor came out unthemeable —
 * quietly undoing, one node at a time, the migration that made the rest of the app follow a theme.
 *
 * Ordered by how often a template needs one, not alphabetically, and kept to the roles a *template*
 * legitimately reaches for. The states (`surface-hover`, `accent-active`) and the internals
 * (`control-surface`, `shadow-color`) are the design system's business, not a node's.
 */
function isRole(value: string): boolean {
  return COLOR_ROLES.some((g) => g.roles.includes(value));
}

const COLOR_ROLES: { group: string; roles: string[] }[] = [
  { group: 'Surfaces', roles: ['page', 'surface', 'surface-raised', 'surface-sunken', 'surface-inverse'] },
  { group: 'Text', roles: ['text', 'text-muted', 'text-faint', 'on-inverse'] },
  { group: 'Accent', roles: ['accent', 'accent-text', 'on-accent', 'accent-muted'] },
  { group: 'Lines', roles: ['border', 'border-strong'] },
  {
    group: 'Status',
    roles: ['danger-text', 'danger-surface', 'success-text', 'success-surface', 'warning-text', 'warning-surface'],
  },
];
const COLOR_SHADES = ['0', '25', '50', '75', '100', '200', '300', '400', '500', '600', '700', '800', '900', '1000'];

// -----------------------------------------------------------------------
// NodeTree — schema layer tree
// -----------------------------------------------------------------------

const NODE_TYPE_ICON_MAP: Record<string, string> = {
  $if: 'question',
  $each: 'list',
  $routes: 'arrows-clockwise',
  $animate: 'lightning',
  $single: 'magnifying-glass',
  'we-button': 'cursor-click',
  'we-image': 'image',
  'we-input': 'pencil-simple',
  'we-icon': 'star',
};

function nodeTypeIcon(type: string | undefined): string {
  if (!type) return 'squares-four';
  return NODE_TYPE_ICON_MAP[type] ?? 'squares-four';
}

/** Collect child SchemaNodes from a node for tree display */
function treeChildren(node: SchemaNode): Array<{ child: SchemaNode; contextLabel?: string }> {
  const result: Array<{ child: SchemaNode; contextLabel?: string }> = [];

  if (node.children) {
    for (const child of node.children) {
      if (typeof child === 'object' && child !== null && !Array.isArray(child) && 'type' in (child as object)) {
        result.push({ child: child as SchemaNode });
      }
    }
  }

  if (node.routes) {
    for (const route of node.routes) {
      const r = route as SchemaNode & { path?: string };
      result.push({ child: r, contextLabel: r.path ?? undefined });
    }
  }

  if (node.slots) {
    for (const [slotName, slotNode] of Object.entries(node.slots)) {
      result.push({ child: slotNode, contextLabel: slotName });
    }
  }

  // Props-embedded SchemaNodes — e.g. $if.props.then / $if.props.else
  if (node.props) {
    for (const [propName, val] of Object.entries(node.props)) {
      if (Array.isArray(val)) {
        for (const item of val) {
          if (isPropsSchemaNode(item)) result.push({ child: item as SchemaNode, contextLabel: propName });
        }
      } else if (isPropsSchemaNode(val)) {
        result.push({ child: val as SchemaNode, contextLabel: propName });
      }
    }
  }

  return result;
}

interface TreeNodeProps {
  node: SchemaNode;
  depth: number;
  selectedId: () => string | null;
  hoveredId: () => string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  collapsed: () => Set<string>;
  onToggle: (id: string) => void;
  contextLabel?: string;
}

function TreeNode(props: TreeNodeProps) {
  const kids = () => treeChildren(props.node);
  const hasKids = () => kids().length > 0;
  const isCollapsed = () => !!props.node.id && props.collapsed().has(props.node.id);
  const isSelected = () => !!props.node.id && props.selectedId() === props.node.id;
  const isHovered = () => !!props.node.id && !isSelected() && props.hoveredId() === props.node.id;
  const isSpecial = () => !!props.node.type?.startsWith('$');

  let rowRef!: HTMLDivElement;

  createEffect(() => {
    if (isSelected() && rowRef) rowRef.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  return (
    <>
      <div
        ref={rowRef}
        onClick={() => props.node.id && props.onSelect(props.node.id)}
        onMouseEnter={() => props.node.id && props.onHover(props.node.id)}
        onMouseLeave={() => props.onHover(null)}
        style={{
          display: 'flex',
          'align-items': 'center',
          height: '22px',
          'padding-left': `${4 + props.depth * 12}px`,
          'padding-right': '8px',
          gap: '4px',
          cursor: 'pointer',
          'flex-shrink': '0',
          background: isSelected()
            ? 'var(--we-color-primary-100)'
            : isHovered()
              ? 'var(--we-color-neutral-50)'
              : 'transparent',
          'border-left': isSelected() ? '2px solid var(--we-color-primary-500)' : '2px solid transparent',
          'box-sizing': 'border-box',
        }}
      >
        {/* Expand/collapse toggle */}
        <div
          onClick={(e) => {
            if (hasKids() && props.node.id) {
              e.stopPropagation();
              props.onToggle(props.node.id);
            }
          }}
          style={{
            width: '14px',
            'flex-shrink': '0',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
          }}
        >
          <Show when={hasKids()}>
            <we-icon name={isCollapsed() ? 'caret-right' : 'caret-down'} size="xs" color="text-faint" />
          </Show>
        </div>

        {/* Node type icon */}
        <we-icon
          name={nodeTypeIcon(props.node.type)}
          size="xs"
          color={isSelected() ? 'primary-600' : isSpecial() ? 'primary-400' : 'neutral-400'}
        />

        {/* Context label: route path, slot name, or prop name */}
        <Show when={props.contextLabel}>
          <we-text fontSize="10px" lineHeight="1" flexShrink="0" whiteSpace="nowrap" color="text-faint">
            {props.contextLabel}:
          </we-text>
        </Show>

        {/* Component type name */}
        <we-text
          fontSize="11px"
          lineHeight="1"
          overflow="hidden"
          flex="1"
          minWidth="0"
          whiteSpace="nowrap"
          styles={{ 'text-overflow': 'ellipsis' }}
          color={isSelected() ? 'primary-700' : isSpecial() ? 'primary-500' : 'neutral-700'}
          fontWeight={isSelected() ? '600' : '400'}
        >
          {props.node.type ?? '(root)'}
        </we-text>
      </div>

      <Show when={!isCollapsed() && hasKids()}>
        <For each={kids()}>
          {({ child, contextLabel }) => (
            <TreeNode
              node={child}
              depth={props.depth + 1}
              selectedId={props.selectedId}
              hoveredId={props.hoveredId}
              onSelect={props.onSelect}
              onHover={props.onHover}
              collapsed={props.collapsed}
              onToggle={props.onToggle}
              contextLabel={contextLabel}
            />
          )}
        </For>
      </Show>
    </>
  );
}

function NodeTree() {
  const templateStore = useEditorHost().template;
  const visualEditor = useVisualEditor();
  const [collapsed, setCollapsed] = createSignal(new Set<string>());

  const onToggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <TreeNode
      node={templateStore.currentTemplate as SchemaNode}
      depth={0}
      selectedId={visualEditor.selectedId}
      hoveredId={visualEditor.hoveredId}
      onSelect={visualEditor.onSelect}
      onHover={visualEditor.onHover}
      collapsed={collapsed}
      onToggle={onToggle}
    />
  );
}

// -----------------------------------------------------------------------
// InspectorPanel
// -----------------------------------------------------------------------

export function InspectorPanel() {
  const templateStore = useEditorHost().template;
  const session = useEditorHost().session;
  const visualEditor = useVisualEditor();
  const [treeHeight, setTreeHeight] = createSignal(200);
  const [dividerResizing, setDividerResizing] = createSignal(false);

  const selectedNode = createMemo<SchemaNode | null>(() => {
    const id = visualEditor.selectedId();
    if (!id) return null;
    return findNodeById(templateStore.currentTemplate, id)?.node ?? null;
  });

  // Persisting hits AD4M storage (network/IPC), which is far slower than the in-memory
  // template update. Controls that fire many changes in quick succession (e.g. the ring
  // picker's number-input steppers) would otherwise persist on every single click, making
  // clicks feel laggy. Debounce the persist call; templateStore.updateTemplate above still
  // runs synchronously every time so the canvas updates instantly.
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = undefined;
      templateStore.persistCurrentTemplate();
    }, 400);
  }
  onCleanup(() => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = undefined;
      templateStore.persistCurrentTemplate();
    }
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
      session.pushSnapshot();
      templateStore.updateTemplate(updated);
      schedulePersist();
    } catch (e) {
      console.error('[PropChange] error:', e);
    }
  }

  /** Replace `children` wholesale. `null` deletes the key (mergeNode treats null as delete). */
  function setChildren(children: unknown[] | null) {
    const id = visualEditor.selectedId();
    if (!id) return;
    try {
      const clone = deepClone(templateStore.currentTemplate) as TemplateSchema;
      const found = findNodeById(clone, id);
      if (!found) return;
      const patched = mergeNode(found.node, { children });
      const updated = replaceNodeInTree(clone as SchemaNode, found.node, patched) as TemplateSchema;
      session.pushSnapshot();
      templateStore.updateTemplate(updated);
      schedulePersist();
    } catch (e) {
      console.error('[ContentChange] error:', e);
    }
  }

  function handleContentChange(value: string) {
    setChildren(value === '' ? null : [value]);
  }

  function handleContentTokenChange(value: unknown) {
    // Clearing a bound value leaves the node empty rather than printing "".
    setChildren(value === '' || value === null || value === undefined ? null : [value]);
  }

  function onDividerMouseDown(e: MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = treeHeight();
    setDividerResizing(true);
    const onMove = (mv: MouseEvent) => {
      setTreeHeight(Math.max(80, Math.min(500, startH + mv.clientY - startY)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setDividerResizing(false);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  return (
    <Column width="100%" height="100%" overflow="hidden" bg="surface" fontFamily="base" fontSize="200" color="text">
      {/* Header */}
      <Row
        ax="between"
        ay="center"
        px="400"
        py="300"
        borderBottom={`1px solid ${tokenVar('color', 'ui-200')}`}
        flexShrink="0"
      >
        <we-text fontSize="500" fontWeight="600">
          Visual Inspector
        </we-text>
        <we-tooltip title="Close inspector panel">
          <we-button variant="ghost" size="sm" onClick={() => session.toggleVisualPanel()}>
            <we-icon name="x" size="sm" />
          </we-button>
        </we-tooltip>
      </Row>

      {/* Layer tree */}
      <Column flex="none" height={`${treeHeight()}px`} overflow="hidden">
        <Row
          px="400"
          py="100"
          ay="center"
          gap="200"
          flex="none"
          borderBottom={`1px solid ${tokenVar('color', 'neutral-100')}`}
        >
          <we-icon name="list" size="xs" color="text-faint" />
          <we-text fontSize="100" fontWeight="600" textTransform="uppercase" letterSpacing="widest" color="text-faint">
            Layers
          </we-text>
        </Row>
        <div style={{ flex: '1', 'overflow-y': 'auto', 'overflow-x': 'hidden' }}>
          <NodeTree />
        </div>
      </Column>

      {/* Resize handle */}
      <div
        onMouseDown={onDividerMouseDown}
        style={{
          height: '4px',
          cursor: 'row-resize',
          'flex-shrink': '0',
          background: dividerResizing() ? 'var(--we-color-primary-300)' : 'var(--we-role-border)',
        }}
      />

      {/* Properties for selected node */}
      <Column flex="1" overflow="hidden" pb="500">
        <Show
          when={selectedNode()}
          fallback={
            <Column flex="1" ax="center" ay="center" gap="200" p="500" textAlign="center">
              <we-icon name="cursor-click" size="lg" color="text-faint" />
              <we-text fontSize="200" color="text-faint">
                Click a node to inspect it
              </we-text>
            </Column>
          }
        >
          {(node) => (
            <NodeProperties
              node={node()}
              onPropChange={handlePropChange}
              onContentChange={handleContentChange}
              onContentTokenChange={handleContentTokenChange}
              onChildrenChange={(children) => setChildren(children.length === 0 ? null : children)}
            />
          )}
        </Show>
      </Column>
    </Column>
  );
}

// -----------------------------------------------------------------------
// NodeProperties
// -----------------------------------------------------------------------

/**
 * The strip under the node's name that says what is painting it.
 *
 * Deliberately in the header rather than filed under a "Colors" section: it is a readout, not a
 * control, and its job is to be answering the question before anybody goes looking for where to ask
 * it. Each entry is a button because the useful next move is almost never "change this node" — it
 * is "change what this role means", which is a different panel, and the jump is the only affordance
 * that makes that discoverable.
 */
function ThemeRoleReadout(props: { node: SchemaNode }) {
  const host = useEditorHost();
  const templateStore = host.template;

  const painted = createMemo(() => {
    const ancestors: SchemaNode[] = [];
    let info = props.node.id ? findNodeById(templateStore.currentTemplate, props.node.id) : null;
    // Ancestry is walked by re-finding each parent by id — the same climb EditorOverlay does, and
    // the only one available: findNodeById reports one parent, not a path.
    while (info?.parent) {
      ancestors.push(info.parent);
      if (!info.parent.id) break;
      info = findNodeById(templateStore.currentTemplate, info.parent.id);
    }
    return paintedRoles(props.node, ancestors);
  });

  return (
    <Show when={painted().length > 0}>
      <Row gap="150" wrap ay="center" pt="100">
        <For each={painted()}>
          {(entry) => (
            <we-tooltip
              title={
                isRole(entry.value)
                  ? `${entry.what}: “${entry.value}”${entry.from ? `, inherited from ${entry.from}` : ''} — click to edit it for the whole theme`
                  : `${entry.what}: “${entry.value}” is a fixed scale position, so it does not follow the theme`
              }
            >
              <we-button
                variant="bare"
                onClick={() => {
                  if (!isRole(entry.value)) return;
                  host.theme.startEditing();
                  host.session.enterThemeEditing();
                }}
              >
                <Row
                  gap="150"
                  ay="center"
                  px="150"
                  py="100"
                  r="200"
                  bg="surface-sunken"
                  border={`1px solid ${'var(--we-role-border)'}`}
                >
                  <div
                    style={{
                      width: '10px',
                      height: '10px',
                      'flex-shrink': '0',
                      'border-radius': '2px',
                      background: isRole(entry.value)
                        ? `var(--we-role-${entry.value})`
                        : `var(--we-color-${entry.value})`,
                      border: '1px solid var(--we-role-border)',
                    }}
                  />
                  <we-text fontSize="100" color={entry.from ? 'text-faint' : 'text-muted'}>
                    {entry.value}
                  </we-text>
                  {/* An inherited colour is the common case and the one people misread, so it is
                      marked rather than left to look like a property of this node. */}
                  <Show when={entry.from}>
                    <we-icon name="arrow-bend-left-up" size="xs" color="text-faint" />
                  </Show>
                </Row>
              </we-button>
            </we-tooltip>
          )}
        </For>
      </Row>
    </Show>
  );
}

function NodeProperties(props: {
  node: SchemaNode;
  onPropChange: (key: string, value: unknown) => void;
  onContentChange: (value: string) => void;
  /** Replace the single token in `children` (data binding, value-level conditional). */
  onContentTokenChange: (value: unknown) => void;
  /** Replace the whole `children` array (raw JSON escape hatch). */
  onChildrenChange: (children: unknown[]) => void;
}) {
  const templateStore = useEditorHost().template;
  const meta = createMemo(() => getComponentMeta(props.node.type ?? '', contextData));

  // Content — `children` holds either child nodes (owned by the Layers tree) or content
  // the ContentEditor owns: text, a bound value, or a value-level conditional.
  const hasChildNodes = createMemo(() => !!props.node.children?.some((c) => isPropsSchemaNode(c)));

  const showContent = createMemo(() => {
    if (hasChildNodes()) return false;
    if (props.node.children && props.node.children.length > 0) return true;
    return TEXT_CONTENT_TYPES.has(props.node.type ?? '');
  });

  // Current prop values set on this node
  const currentProps = createMemo(() => props.node.props ?? {});

  // Props that are currently set (used) on the node — spacing props excluded (shown in SpacingSection)
  const usedProps = createMemo(() => {
    const used = new Map<string, unknown>();
    for (const [k, v] of Object.entries(currentProps())) {
      if (ALL_SPACING_KEYS.has(k) || BG_IMAGE_SUB_KEYS.has(k)) continue;
      const t = typeof v;
      if (t === 'string' || t === 'boolean' || t === 'number') {
        used.set(k, v);
      }
    }
    return used;
  });

  // Props the Logic section owns — excluded from the raw JSON list below so a condition
  // isn't editable in two places at once.
  const logicProps = createMemo(() => (props.node.type === '$if' ? new Set(['condition']) : new Set<string>()));

  // Complex (non-primitive) props — raw JSON escape hatch.
  // SchemaNode-valued props ($if's then/else, slot content) are excluded: they're whole
  // subtrees, already navigable and editable through the Layers tree above, and showing
  // them here as JSON blobs buries the props that are only editable here.
  const complexProps = createMemo(() =>
    Object.entries(currentProps()).filter(([k, v]) => {
      const t = typeof v;
      if (t === 'string' || t === 'boolean' || t === 'number') return false;
      if (logicProps().has(k)) return false;
      if (isPropsSchemaNode(v)) return false;
      if (Array.isArray(v) && v.length > 0 && v.every(isPropsSchemaNode)) return false;
      return true;
    }),
  );

  // Everything this node's props can refer to — drives the value pickers in the Logic
  // section. Recomputed from the live template so newly added $localState or $each
  // ancestors show up without reselecting the node.
  const scope = createMemo<ScopeGroup[]>(() =>
    getScopeAtNode(templateStore.currentTemplate as SchemaNode, props.node.id ?? '', {
      storeEntries: contextData.storeEntries,
      models: contextData.models,
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
      <Column px="400" pt="300" pb="200" gap="100" borderBottom="1px solid border" flex="none">
        <we-text fontSize="300" fontWeight="600" color="text">
          {props.node.type ?? '(no type)'}
        </we-text>
        <Show when={props.node.id}>
          <we-text fontSize="100" color="text-faint">
            id: {props.node.id}
          </we-text>
        </Show>
        <ThemeRoleReadout node={props.node} />
      </Column>

      {/* Scrollable content */}
      <we-scroll-area flex="1">
        {/* Content — text, a bound value, or a value-level conditional */}
        <Show when={showContent()}>
          <Column py="200" borderBottom="1px solid border">
            <ContentEditor
              content={props.node.children}
              nodeId={props.node.id}
              scope={scope()}
              onTextChange={props.onContentChange}
              onTokenChange={props.onContentTokenChange}
              onChildrenChange={props.onChildrenChange}
            />
          </Column>
        </Show>

        {/* Logic — condition builder for $if, in place of raw JSON */}
        <Show when={props.node.type === '$if'}>
          <Column py="100" borderBottom="1px solid border">
            <ConditionEditor
              label="Show when"
              condition={currentProps().condition}
              scope={scope()}
              onChange={(token) => props.onPropChange('condition', token)}
            />
          </Column>
        </Show>

        {/* Spacing — always-visible box model for padding + margin */}
        <BoxModel meta={meta()} currentProps={currentProps()} onPropChange={props.onPropChange} />

        {/* Used props — always visible */}
        <Show when={usedProps().size > 0}>
          <Column py="100">
            <SectionLabel>Set props</SectionLabel>
            {/*
              Iterate stable string keys, not [key, value] tuples — usedProps() rebuilds a
              new Map (and thus new tuple objects) on every prop edit. <For> keys items by
              reference, so tuples would remount every PropRow (and its local state, e.g.
              RingPicker's open dropdown) on each keystroke. Keys are stable strings, so
              <For> keeps the same instances alive; value/propMeta stay reactive via the
              getters below.
            */}
            <For each={[...usedProps().keys()]}>
              {(key) => {
                const value = () => usedProps().get(key) as string | boolean | number;
                const propMeta = () => meta()?.props.find((p) => p.name === key);
                return (
                  <PropRow
                    propKey={key}
                    value={value()}
                    options={propMeta()?.options}
                    valueType={propMeta()?.valueType ?? (typeof value() as 'string' | 'boolean' | 'number')}
                    onChange={(v) => props.onPropChange(key, v)}
                    currentProps={currentProps()}
                    onAnyPropChange={props.onPropChange}
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
              const unsetProps = () =>
                layerProps().filter((p) => !usedProps().has(p.name) && !BG_IMAGE_SUB_KEYS.has(p.name));
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
                          currentProps={currentProps()}
                          onAnyPropChange={props.onPropChange}
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
          <we-text py="400" px="14px" color="text-faint">
            No props
          </we-text>
        </Show>

        {/* Complex / dynamic props — ValueEditor picks the right control per token and
            falls back to the JSON editor for the ones with no row equivalent */}
        <Show when={complexProps().length > 0}>
          <Column py="100">
            <SectionLabel>Dynamic props</SectionLabel>
            <For each={complexProps().map(([key]) => key)}>
              {(key) => (
                <Column px="400" py="100" gap="100">
                  <we-text fontSize="100" fontWeight="500" color="text-muted">
                    {key}
                  </we-text>
                  <ValueEditor
                    value={currentProps()[key]}
                    scope={scope()}
                    onChange={(value) => props.onPropChange(key, value)}
                  />
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
        <we-icon name={open() ? 'caret-down' : 'caret-right'} size="xs" color="text-faint" />
        <we-text fontSize="100" fontWeight="600" textTransform="uppercase" letterSpacing="0.06em" color="text-faint">
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
      color="text-faint"
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

  const textColor = () =>
    props.value
      ? (props.color ?? 'var(--we-color-neutral-800)')
      : (props.placeholderColor ?? props.color ?? 'var(--we-color-neutral-400)');

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <we-button
        size="xs"
        variant="ghost"
        prop:hoverProps={{ bg: 'none' }}
        prop:activeProps={{ bg: 'none' }}
        onClick={(e: MouseEvent) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <we-text
          fontWeight={props.value ? '500' : '400'}
          color={textColor()}
          fontSize="10px"
          minWidth="22px"
          textAlign="center"
        >
          {props.value || props.placeholder}
        </we-text>
      </we-button>
      <Show when={open()}>
        <div
          style={{
            position: 'absolute',
            'z-index': '600',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            'margin-top': '2px',
            'min-width': '64px',
          }}
        >
          <we-menu>
            <div style={{ 'max-height': '200px', 'overflow-y': 'auto', padding: '2px 0' }}>
              <For each={[...(props.value ? ['(unset)'] : []), ...SPACE_OPTIONS.map((o) => o.value)]}>
                {(opt) => (
                  <we-menu-item
                    selected={opt === props.value}
                    on:select={() => {
                      props.onChange(opt === '(unset)' ? '' : opt);
                      setOpen(false);
                    }}
                    fontSize="100"
                  >
                    {opt}
                  </we-menu-item>
                )}
              </For>
            </div>
          </we-menu>
        </div>
      </Show>
    </div>
  );
}

// -----------------------------------------------------------------------
// IconSegmentedRow — icon button group for enum props like direction/ax/ay
// -----------------------------------------------------------------------

function IconSegmentedRow(props: { propKey: string; options: string[]; value: string; onChange: (v: string) => void }) {
  const icons = () => ICON_PROP_ICONS[props.propKey] ?? {};
  const selected = (opt: string) => opt === props.value;

  return (
    <Row wrap gap="100">
      <For each={props.options}>
        {(opt) => {
          const icon = icons()[opt];
          return (
            <we-button
              title={opt}
              size="sm"
              square
              variant={selected(opt) ? 'secondary' : 'outline'}
              onClick={() => props.onChange(selected(opt) ? '' : opt)}
            >
              {icon ? <we-icon name={icon} /> : opt.slice(0, 3)}
            </we-button>
          );
        }}
      </For>
    </Row>
  );
}

// -----------------------------------------------------------------------
// ColorSwatchPicker — swatch grid for bg/color/borderColor props
// -----------------------------------------------------------------------

function ColorSwatchPicker(props: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = createSignal(false);
  const [hovered, setHovered] = createSignal<string | null>(null);
  let ref!: HTMLDivElement;

  createEffect(() => {
    if (!open()) return;
    const handler = (e: MouseEvent) => {
      if (!ref.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    onCleanup(() => document.removeEventListener('mousedown', handler));
  });

  const host = useEditorHost();
  // A role and a scale position are different variables; a single guess paints one of them nothing.
  const swatchBg = (value: string) =>
    !value ? 'transparent' : isRole(value) ? `var(--we-role-${value})` : `var(--we-color-${value})`;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger */}
      <we-button variant="outline" size="xs" width="100%" onClick={() => setOpen((v) => !v)}>
        <Row ay="center" gap="200" width="100%">
          <div
            style={{
              width: '12px',
              height: '12px',
              'flex-shrink': '0',
              background: swatchBg(props.value),
              'border-radius': '2px',
              border: '1px solid rgba(0,0,0,0.15)',
            }}
          />
          <we-text flex="1" truncate color={props.value ? 'neutral-800' : 'neutral-400'} fontSize="200">
            {props.value || '—'}
          </we-text>
          <we-icon name={open() ? 'caret-up' : 'caret-down'} size="xs" color="text-faint" />
        </Row>
      </we-button>

      {/* Dropdown */}
      <Show when={open()}>
        <div
          style={{
            position: 'absolute',
            'z-index': '600',
            top: '100%',
            right: '0',
            'margin-top': '3px',
            'min-width': '220px',
          }}
        >
          <we-menu>
            <Column p="300" gap="200">
              {/* Unset */}
              <Show when={props.value}>
                <we-menu-item
                  on:select={() => {
                    props.onChange('');
                    setOpen(false);
                  }}
                >
                  <we-text color="text-faint">(unset)</we-text>
                </we-menu-item>
              </Show>

              {/*
                The bridge from a node to the theme.

                Somebody looking at a wrong colour is not thinking "surfaceRaised", they are
                thinking "that panel". Having arrived here by clicking the thing, the useful second
                option is to change it *everywhere* rather than only here — which is the difference
                between patching one node and fixing the theme.
              */}
              <Show when={props.value && isRole(props.value)}>
                <we-menu-item
                  on:select={() => {
                    host.theme.startEditing();
                    host.session.enterThemeEditing();
                    setOpen(false);
                  }}
                >
                  <Row gap="200" ay="center">
                    <we-icon name="paint-bucket" size="xs" color="accent-text" />
                    <we-text fontSize="200">Edit “{props.value}” for the whole theme</we-text>
                  </Row>
                </we-menu-item>
              </Show>

              {/* Roles first: this is what a template should be reaching for. */}
              <Column gap="100">
                <we-text fontSize="100" color="text-faint">
                  Roles — follow the theme
                </we-text>
                <For each={COLOR_ROLES}>
                  {(g) => (
                    <Row gap="100" wrap>
                      <For each={g.roles}>
                        {(v) => (
                          <we-tooltip title={`${v} · ${g.group}`} placement="top">
                            <button
                              onClick={() => {
                                props.onChange(v);
                                setOpen(false);
                              }}
                              onMouseEnter={() => setHovered(v)}
                              onMouseLeave={() => setHovered(null)}
                              style={{
                                all: 'unset',
                                width: '20px',
                                height: '20px',
                                background: `var(--we-role-${v})`,
                                'box-shadow': `0 0 0 1px var(--we-role-${hovered() === v ? 'accent' : 'border'})`,
                                'border-radius': '3px',
                                cursor: 'pointer',
                                padding: '0',
                                transition: 'all 0.3s',
                              }}
                            />
                          </we-tooltip>
                        )}
                      </For>
                    </Row>
                  )}
                </For>
              </Column>

              <we-text fontSize="100" color="text-faint">
                Scale — a fixed colour, for a palette
              </we-text>

              {/* White + black */}
              <Row gap="100">
                <For each={['white', 'black']}>
                  {(v) => (
                    <we-tooltip title={v} placement="top">
                      <button
                        onClick={() => {
                          props.onChange(v);
                          setOpen(false);
                        }}
                        onMouseEnter={() => setHovered(v)}
                        onMouseLeave={() => setHovered(null)}
                        style={{
                          all: 'unset',
                          width: '20px',
                          height: '20px',
                          background: `var(--we-color-${v})`,
                          'box-shadow': `0 0 0 1px var(--we-color-primary-${hovered() === v ? 600 : 300})`,
                          'border-radius': '3px',
                          cursor: 'pointer',
                          padding: '0',
                          transition: 'all 0.3s',
                        }}
                      />
                    </we-tooltip>
                  )}
                </For>
              </Row>

              {/* Hue rows */}
              <Column gap="100">
                <For each={COLOR_HUES}>
                  {(hue) => (
                    <Row gap="100">
                      <For each={COLOR_SHADES}>
                        {(shade) => {
                          const v = `${hue}-${shade}`;
                          return (
                            <we-tooltip title={v} placement="top">
                              <button
                                onClick={() => {
                                  props.onChange(v);
                                  setOpen(false);
                                }}
                                onMouseEnter={() => setHovered(v)}
                                onMouseLeave={() => setHovered(null)}
                                style={{
                                  all: 'unset',
                                  width: '20px',
                                  height: '20px',
                                  background: `var(--we-color-${v})`,
                                  'box-shadow': `0 0 0 1px var(--we-color-primary-${hovered() === v ? 600 : 300})`,
                                  'border-radius': '3px',
                                  cursor: 'pointer',
                                  padding: '0',
                                  transition: 'all 0.3s',
                                }}
                              />
                            </we-tooltip>
                          );
                        }}
                      </For>
                    </Row>
                  )}
                </For>
              </Column>
            </Column>
          </we-menu>
        </div>
      </Show>
    </div>
  );
}

// -----------------------------------------------------------------------
// RingPicker — composite width + color swatch picker for the `ring` prop
// -----------------------------------------------------------------------

function RingPicker(props: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = createSignal(false);
  const [hovered, setHovered] = createSignal<string | null>(null);
  let ref!: HTMLDivElement;

  createEffect(() => {
    if (!open()) return;
    const handler = (e: MouseEvent) => {
      if (!ref.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    onCleanup(() => document.removeEventListener('mousedown', handler));
  });

  const parsed = createMemo(() => (props.value ? parseRing(props.value) : null));
  const widthPx = () => parsed()?.widthPx ?? RING_DEFAULT_WIDTH_PX;
  const blurPx = () => parsed()?.blurPx ?? RING_DEFAULT_BLUR_PX;
  const color = () => parsed()?.color ?? '';

  // Each onChange triggers InspectorPanel.handlePropChange, which does two full JSON
  // deep-clones of the whole template plus a schema diff — all synchronous, so it blocks
  // the main thread and delays paint. The stepper buttons on we-number-input already show
  // their own incremented value optimistically and instantly (see number-input.ts's _emit),
  // so debouncing the outbound onChange call here doesn't lose responsiveness on the visible
  // counter — it just stops a rapid burst of clicks from each blocking the thread in turn.
  let widthTimer: ReturnType<typeof setTimeout> | undefined;
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (widthTimer) clearTimeout(widthTimer);
    if (blurTimer) clearTimeout(blurTimer);
  });

  const setWidthPx = (w: number) => {
    if (widthTimer) clearTimeout(widthTimer);
    widthTimer = setTimeout(() => {
      widthTimer = undefined;
      props.onChange(composeRing(w, blurPx(), color() || RING_DEFAULT_COLOR));
    }, 150);
  };
  const setBlurPx = (b: number) => {
    if (blurTimer) clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      blurTimer = undefined;
      props.onChange(composeRing(widthPx(), b, color() || RING_DEFAULT_COLOR));
    }, 150);
  };
  const setColor = (c: string) => props.onChange(composeRing(widthPx(), blurPx(), c));

  // Trigger swatch preview — always a fixed-size reference ring, not the actual configured
  // width/blur. A large width/blur value would otherwise render a box-shadow that visually
  // spills out of the trigger button; the numeric width/blur is already shown in the label.
  const previewShadow = () => (props.value ? composeRing(2, 0, color() || RING_DEFAULT_COLOR) : 'none');

  const swatch = (v: string, size = '20px') => (
    <we-tooltip title={v} placement="top">
      <button
        onClick={() => setColor(v)}
        onMouseEnter={() => setHovered(v)}
        onMouseLeave={() => setHovered(null)}
        style={{
          all: 'unset',
          width: size,
          height: size,
          'flex-shrink': '0',
          background: isRole(v) ? `var(--we-role-${v})` : `var(--we-color-${v})`,
          'box-shadow':
            color() === v
              ? `0 0 0 2px var(--we-color-primary-600)`
              : `0 0 0 1px var(--we-color-primary-${hovered() === v ? 600 : 300})`,
          'border-radius': '3px',
          cursor: 'pointer',
          padding: '0',
          transition: 'all 0.3s',
        }}
      />
    </we-tooltip>
  );

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger */}
      <we-button variant="outline" size="xs" width="100%" onClick={() => setOpen((v) => !v)}>
        <Row ay="center" gap="200" width="100%">
          <div
            style={{
              width: '12px',
              height: '12px',
              'flex-shrink': '0',
              'border-radius': '2px',
              background: 'var(--we-color-neutral-0)',
              'box-shadow': previewShadow(),
            }}
          />
          <we-text flex="1" truncate color={props.value ? 'neutral-800' : 'neutral-400'} fontSize="200">
            {props.value
              ? `${widthPx()}px · ${color() === RING_THEME_ACCENT ? 'theme accent' : color() || 'custom'}`
              : '—'}
          </we-text>
          <we-icon name={open() ? 'caret-up' : 'caret-down'} size="xs" color="text-faint" />
        </Row>
      </we-button>

      {/* Dropdown */}
      <Show when={open()}>
        <div
          style={{
            position: 'absolute',
            'z-index': '600',
            top: '100%',
            right: '0',
            'margin-top': '3px',
            'min-width': '220px',
          }}
        >
          <we-menu>
            <Column p="300" gap="200">
              {/* Unset */}
              <Show when={props.value}>
                <we-menu-item
                  on:select={() => {
                    props.onChange('');
                    setOpen(false);
                  }}
                >
                  <we-text color="text-faint">(unset)</we-text>
                </we-menu-item>
              </Show>

              {/* Width + blur */}
              <Row gap="200">
                <Column gap="100" flex="1" ax="start">
                  <we-text
                    fontSize="100"
                    fontWeight="600"
                    color="text-faint"
                    textTransform="uppercase"
                    letterSpacing="0.06em"
                  >
                    Width
                  </we-text>
                  <we-number-input
                    value={widthPx()}
                    min={0}
                    max={40}
                    step={1}
                    size="xs"
                    on:change={(e: CustomEvent<number>) => setWidthPx(e.detail)}
                  />
                </Column>
                <Column gap="100" flex="1" ax="start">
                  <we-text
                    fontSize="100"
                    fontWeight="600"
                    color="text-faint"
                    textTransform="uppercase"
                    letterSpacing="0.06em"
                  >
                    Blur
                  </we-text>
                  <we-number-input
                    value={blurPx()}
                    min={0}
                    max={40}
                    step={1}
                    size="xs"
                    on:change={(e: CustomEvent<number>) => setBlurPx(e.detail)}
                  />
                </Column>
              </Row>

              {/* Color */}
              <Column gap="100">
                <we-text
                  fontSize="100"
                  fontWeight="600"
                  color="text-faint"
                  textTransform="uppercase"
                  letterSpacing="0.06em"
                >
                  Color
                </we-text>

                {/* Theme accent — follows --we-ring-color rather than a fixed token */}
                <we-tooltip title="Follows the active theme's ring color" placement="top">
                  <button
                    onClick={() => setColor(RING_THEME_ACCENT)}
                    style={{
                      all: 'unset',
                      display: 'flex',
                      'align-items': 'center',
                      gap: '6px',
                      cursor: 'pointer',
                      padding: '4px 6px',
                      'border-radius': '4px',
                      background: color() === RING_THEME_ACCENT ? 'var(--we-color-primary-50)' : 'transparent',
                    }}
                  >
                    <div
                      style={{
                        width: '16px',
                        height: '16px',
                        'flex-shrink': '0',
                        'border-radius': '3px',
                        background: 'var(--we-ring-color)',
                      }}
                    />
                    <we-text fontSize="200">Theme accent</we-text>
                  </button>
                </we-tooltip>

                {/* Roles first: this is what a template should be reaching for. */}
                <Column gap="100">
                  <we-text fontSize="100" color="text-faint">
                    Roles — follow the theme
                  </we-text>
                  <For each={COLOR_ROLES}>
                    {(g) => (
                      <Row gap="100" wrap>
                        <For each={g.roles}>
                          {(v) => (
                            <we-tooltip title={`${v} · ${g.group}`} placement="top">
                              <button
                                onClick={() => {
                                  props.onChange(v);
                                  setOpen(false);
                                }}
                                onMouseEnter={() => setHovered(v)}
                                onMouseLeave={() => setHovered(null)}
                                style={{
                                  all: 'unset',
                                  width: '20px',
                                  height: '20px',
                                  background: `var(--we-role-${v})`,
                                  'box-shadow': `0 0 0 1px var(--we-role-${hovered() === v ? 'accent' : 'border'})`,
                                  'border-radius': '3px',
                                  cursor: 'pointer',
                                  padding: '0',
                                  transition: 'all 0.3s',
                                }}
                              />
                            </we-tooltip>
                          )}
                        </For>
                      </Row>
                    )}
                  </For>
                </Column>

                <we-text fontSize="100" color="text-faint">
                  Scale — a fixed colour, for a palette
                </we-text>

                {/* White + black */}
                <Row gap="100">{['white', 'black'].map((v) => swatch(v))}</Row>

                {/* Hue rows */}
                <Column gap="100">
                  <For each={COLOR_HUES}>
                    {(hue) => <Row gap="100">{COLOR_SHADES.map((shade) => swatch(`${hue}-${shade}`))}</Row>}
                  </For>
                </Column>
              </Column>
            </Column>
          </we-menu>
        </div>
      </Show>
    </div>
  );
}

// -----------------------------------------------------------------------
// BgImagePicker — browse space ImageBlocks, upload a new one, or paste a URL
// -----------------------------------------------------------------------

type BgImageTab = 'browse' | 'upload' | 'url';

const BG_IMAGE_TABS: { key: BgImageTab; label: string }[] = [
  { key: 'browse', label: 'Browse' },
  { key: 'upload', label: 'Upload' },
  { key: 'url', label: 'URL' },
];

function BgImagePicker(props: {
  value: string;
  onChange: (v: string) => void;
  opacity?: number;
  tint?: string;
  bg?: string;
  onOpacityChange: (v: number | undefined) => void;
  onTintChange: (v: string) => void;
}) {
  const images_ = useEditorHost().images;
  const [open, setOpen] = createSignal(false);
  const [tab, setTab] = createSignal<BgImageTab>('browse');
  const [images, setImages] = createSignal<EditorImage[]>([]);
  const [loadingImages, setLoadingImages] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [urlDraft, setUrlDraft] = createSignal('');
  let ref!: HTMLDivElement;

  createEffect(() => {
    if (!open()) return;
    const handler = (e: MouseEvent) => {
      if (!ref.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    onCleanup(() => document.removeEventListener('mousedown', handler));
  });

  // Fetch the images already in this dataset whenever the Browse tab becomes visible.
  //
  // Through the host's image port rather than a model class: "what images are here" and "store this
  // file, give me a URL" are host concerns, and reaching for `ImageBlock` directly would have made
  // the whole editor backend-coupled for the sake of one picker. A host without images omits the
  // port and the picker degrades to the URL tab.
  createEffect(() => {
    if (!open() || tab() !== 'browse') return;
    const port = images_;
    if (!port) return;
    setLoadingImages(true);
    port
      .list(60)
      .then(setImages)
      .catch(() => setImages([]))
      .finally(() => setLoadingImages(false));
  });

  async function handleUpload(file: File) {
    const port = images_;
    if (!port) return;
    setUploading(true);
    try {
      props.onChange(await port.upload(file));
      setOpen(false);
    } finally {
      setUploading(false);
    }
  }

  function handleFileInputChange(e: Event) {
    const file = (e as CustomEvent).detail as File | null;
    if (file) void handleUpload(file);
  }

  function handleUrlSubmit() {
    const url = urlDraft().trim();
    if (!url) return;
    props.onChange(url);
    setUrlDraft('');
    setOpen(false);
  }

  const previewStyle = (src: string) => ({
    'background-image': src ? `url("${src}")` : undefined,
    'background-size': 'cover',
    'background-position': 'center',
    'background-color': 'var(--we-role-border)',
  });

  // Long unbroken strings (data URIs, or just long URLs) can blow out an ancestor's
  // layout regardless of truncate/minWidth on this text node — flex AND grid items
  // both default to min-width:auto (intrinsic content sizing), and this trigger sits
  // inside PropRow's Grid, so a fix at this element alone doesn't reliably contain it.
  // Simplest robust fix: never let the label string itself be long, independent of
  // whatever CSS truncation is (or isn't) correctly threaded through every ancestor.
  const MAX_TRIGGER_LABEL_LENGTH = 40;
  const triggerLabel = () => {
    const v = props.value;
    if (!v) return '—';
    const match = v.match(/^data:([^;]+);/);
    if (match) return `Uploaded image (${match[1].replace('image/', '')})`;
    return v.length > MAX_TRIGGER_LABEL_LENGTH ? `${v.slice(0, MAX_TRIGGER_LABEL_LENGTH)}…` : v;
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger */}
      <we-button variant="outline" size="xs" width="100%" onClick={() => setOpen((v) => !v)}>
        <Row ay="center" gap="200" width="100%">
          <div
            style={{
              width: '16px',
              height: '16px',
              'flex-shrink': '0',
              'border-radius': '2px',
              border: '1px solid rgba(0,0,0,0.15)',
              ...previewStyle(props.value),
            }}
          />
          <we-text flex="1" minWidth="0" truncate color={props.value ? 'neutral-800' : 'neutral-400'} fontSize="200">
            {triggerLabel()}
          </we-text>
          <we-icon name={open() ? 'caret-up' : 'caret-down'} size="xs" color="text-faint" />
        </Row>
      </we-button>

      {/* Dropdown */}
      <Show when={open()}>
        <div
          style={{
            position: 'absolute',
            'z-index': '600',
            top: '100%',
            right: '0',
            'margin-top': '3px',
            width: '280px',
          }}
        >
          <we-menu>
            <Column p="300" gap="300">
              {/* Unset */}
              <Show when={props.value}>
                <we-menu-item
                  on:select={() => {
                    props.onChange('');
                    setOpen(false);
                  }}
                >
                  <we-text color="text-faint">(unset)</we-text>
                </we-menu-item>
              </Show>

              {/* Tab switcher */}
              <Row gap="100">
                <For each={BG_IMAGE_TABS}>
                  {(t) => (
                    <we-button
                      size="xs"
                      variant={tab() === t.key ? 'secondary' : 'ghost'}
                      flex="1"
                      onClick={() => setTab(t.key)}
                    >
                      {t.label}
                    </we-button>
                  )}
                </For>
              </Row>

              {/* Browse — existing space ImageBlocks as a thumbnail grid */}
              <Show when={tab() === 'browse'}>
                <Show
                  when={!loadingImages()}
                  fallback={
                    <Row ax="center" py="400">
                      <we-spinner size="sm" />
                    </Row>
                  }
                >
                  <Show
                    when={images().length > 0}
                    fallback={
                      <we-text color="text-faint" fontSize="200" textAlign="center">
                        No images in this space yet
                      </we-text>
                    }
                  >
                    <Grid columns={4} gap="100" maxHeight="200px" overflowY="auto">
                      <For each={images()}>
                        {(img) => (
                          <button
                            title={img.altText || img.src}
                            onClick={() => {
                              props.onChange(img.src);
                              setOpen(false);
                            }}
                            style={{
                              all: 'unset',
                              width: '100%',
                              'aspect-ratio': '1 / 1',
                              cursor: 'pointer',
                              'border-radius': '4px',
                              'box-shadow': img.src === props.value ? '0 0 0 2px var(--we-color-primary-600)' : 'none',
                              ...previewStyle(img.src),
                            }}
                          />
                        )}
                      </For>
                    </Grid>
                  </Show>
                </Show>
              </Show>

              {/* Upload — direct file upload, creates a standalone ImageBlock */}
              <Show when={tab() === 'upload'}>
                <Show
                  when={!uploading()}
                  fallback={
                    <Row ax="center" py="400">
                      <we-spinner size="sm" />
                    </Row>
                  }
                >
                  <we-file-upload accept="image/*" on:change={handleFileInputChange} width="100%">
                    <we-icon name="image" color="text-muted" size="lg" />
                    <we-text color="text-muted" fontSize="200">
                      Drop an image or click to browse
                    </we-text>
                  </we-file-upload>
                </Show>
              </Show>

              {/* URL — manual entry, kept as an escape hatch for external images */}
              <Show when={tab() === 'url'}>
                <Row ay="center" gap="200">
                  <we-input
                    type="text"
                    value={urlDraft()}
                    on:input={(e: CustomEvent<string>) => setUrlDraft(e.detail)}
                    placeholder="Paste an image URL…"
                    size="xs"
                    flex="1"
                  />
                  <we-button size="xs" onClick={handleUrlSubmit} disabled={!urlDraft().trim()}>
                    Add
                  </we-button>
                </Row>
              </Show>

              {/* Opacity/tint — persistent regardless of active tab, since they apply to
                  whichever image is currently selected, not to the picking process itself. */}
              <Show when={props.value}>
                <Column gap="200" borderTop="1px solid border" pt="300">
                  <Row ay="center" gap="200">
                    <we-text
                      fontSize="100"
                      fontWeight="600"
                      color="text-faint"
                      textTransform="uppercase"
                      letterSpacing="0.06em"
                      flex="1"
                    >
                      Opacity
                    </we-text>
                    <we-text fontSize="100" color="text-faint">
                      {Math.round((props.opacity ?? 1) * 100)}%
                    </we-text>
                  </Row>
                  <we-slider
                    value={Math.round((props.opacity ?? 1) * 100)}
                    min={0}
                    max={100}
                    step={1}
                    size="xs"
                    on:change={(e: CustomEvent<number>) =>
                      props.onOpacityChange(e.detail >= 100 ? undefined : e.detail / 100)
                    }
                  />

                  {/* Tint only matters once the image is actually faded — hidden otherwise
                      to avoid presenting an irrelevant control at full opacity. */}
                  <Show when={props.opacity !== undefined && props.opacity < 1}>
                    <we-text
                      fontSize="100"
                      fontWeight="600"
                      color="text-faint"
                      textTransform="uppercase"
                      letterSpacing="0.06em"
                    >
                      Fade to
                    </we-text>
                    <ColorSwatchPicker value={props.tint ?? ''} onChange={(v) => props.onTintChange(v)} />
                    <we-text fontSize="100" color="text-faint">
                      {props.tint ? '' : `Defaults to ${props.bg ?? 'neutral-0'} (this element's own bg)`}
                    </we-text>
                  </Show>
                </Column>
              </Show>
            </Column>
          </we-menu>
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
  border: 'var(--we-role-warning-text)',
  label: 'var(--we-color-warning-800)',
  value: 'var(--we-color-warning-800)',
  placeholder: 'var(--we-role-warning-text)',
};

const BOX_PADDING = {
  bg: 'var(--we-color-success-200)',
  border: 'var(--we-role-success-text)',
  label: 'var(--we-color-success-800)',
  value: 'var(--we-color-success-800)',
  placeholder: 'var(--we-role-success-text)',
};

const BOX_ELEMENT = {
  bg: 'var(--we-role-accent-muted)',
  border: 'var(--we-role-accent)',
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
      rows="20px 1fr 20px"
      minHeight="72px"
      bg={BOX_PADDING.bg}
      border={`1px solid ${BOX_PADDING.border}`}
      r="100"
      gap="0"
    >
      <we-text py="2px" px="4px" lineHeight="16px" whiteSpace="nowrap" fontSize="10px" color={BOX_PADDING.label}>
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
        m="3px"
        py="0"
        px="6px"
      >
        <we-text fontSize="10px" fontWeight="700" color={BOX_ELEMENT.text} truncate>
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
      <Column px="400" py="200" borderBottom="1px solid border">
        {/* Shorthand row: all / x-axis / y-axis setters */}
        <Column gap="100" mb="200">
          <Show when={hasMargin()}>
            <Row ay="center" gap="200">
              <we-text fontSize="12px" fontWeight="700" color={BOX_MARGIN.border} letterSpacing="0.04em">
                Margin
              </we-text>
              <Show when={availableKeys().has('m')}>
                <Row ay="center" gap="100">
                  <we-text fontSize="12px" color={BOX_MARGIN.label}>
                    all
                  </we-text>
                  <InlineSpaceInput value={rawVal('m')} placeholder="—" onChange={(v) => props.onPropChange('m', v)} />
                </Row>
              </Show>
              <Show when={availableKeys().has('mx')}>
                <Row ay="center" gap="100">
                  <we-text fontSize="12px" color={BOX_MARGIN.label}>
                    x
                  </we-text>
                  <InlineSpaceInput
                    value={rawVal('mx')}
                    placeholder="—"
                    onChange={(v) => props.onPropChange('mx', v)}
                  />
                </Row>
              </Show>
              <Show when={availableKeys().has('my')}>
                <Row ay="center" gap="100">
                  <we-text fontSize="12px" color={BOX_MARGIN.label}>
                    y
                  </we-text>
                  <InlineSpaceInput
                    value={rawVal('my')}
                    placeholder="—"
                    onChange={(v) => props.onPropChange('my', v)}
                  />
                </Row>
              </Show>
            </Row>
          </Show>
          <Show when={hasPadding()}>
            <Row ay="center" gap="200">
              <we-text fontSize="12px" fontWeight="700" color={BOX_PADDING.border} letterSpacing="0.04em">
                Padding
              </we-text>
              <Show when={availableKeys().has('p')}>
                <Row ay="center" gap="100">
                  <we-text fontSize="12px" color={BOX_PADDING.label}>
                    all
                  </we-text>
                  <InlineSpaceInput value={rawVal('p')} placeholder="—" onChange={(v) => props.onPropChange('p', v)} />
                </Row>
              </Show>
              <Show when={availableKeys().has('px')}>
                <Row ay="center" gap="100">
                  <we-text fontSize="12px" color={BOX_PADDING.label}>
                    x
                  </we-text>
                  <InlineSpaceInput
                    value={rawVal('px')}
                    placeholder="—"
                    onChange={(v) => props.onPropChange('px', v)}
                  />
                </Row>
              </Show>
              <Show when={availableKeys().has('py')}>
                <Row ay="center" gap="100">
                  <we-text fontSize="12px" color={BOX_PADDING.label}>
                    y
                  </we-text>
                  <InlineSpaceInput
                    value={rawVal('py')}
                    placeholder="—"
                    onChange={(v) => props.onPropChange('py', v)}
                  />
                </Row>
              </Show>
            </Row>
          </Show>
        </Column>

        {/* Nested box diagram: orange margin wraps green padding wraps blue element */}
        <Show when={hasMargin()} fallback={paddingBox()}>
          <Grid
            template="28px 1fr 28px"
            rows="20px 1fr 20px"
            bg={BOX_MARGIN.bg}
            border={`1px solid ${BOX_MARGIN.border}`}
            r="100"
            gap="0"
          >
            <we-text py="2px" px="4px" lineHeight="16px" whiteSpace="nowrap" fontSize="10px" color={BOX_MARGIN.label}>
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
  // Only used by the bgImage special case below, to read/write the sibling
  // bgImageOpacity/bgImageTint props from within the same popover.
  currentProps?: Record<string, unknown>;
  onAnyPropChange?: (key: string, value: unknown) => void;
}) {
  const strVal = () => String(props.value ?? '');

  const renderInput = () => {
    if (props.valueType === 'boolean') {
      return (
        <we-checkbox
          checked={props.value as boolean}
          size="xs"
          on:change={(e: CustomEvent<boolean>) => props.onChange(e.detail)}
        />
      );
    }
    if (props.valueType === 'number') {
      return (
        <we-input
          type="number"
          value={String(props.value)}
          size="xs"
          on:change={(e: CustomEvent<string>) => {
            const v = Number(e.detail);
            if (!isNaN(v) && v !== props.value) props.onChange(v);
          }}
        />
      );
    }
    if (props.propKey === 'ring') {
      return <RingPicker value={strVal()} onChange={(v) => props.onChange(v)} />;
    }
    if (props.propKey === 'bgImage') {
      return (
        <BgImagePicker
          value={strVal()}
          onChange={(v) => props.onChange(v)}
          opacity={props.currentProps?.bgImageOpacity as number | undefined}
          tint={props.currentProps?.bgImageTint as string | undefined}
          bg={props.currentProps?.bg as string | undefined}
          onOpacityChange={(v) => props.onAnyPropChange?.('bgImageOpacity', v)}
          onTintChange={(v) => props.onAnyPropChange?.('bgImageTint', v)}
        />
      );
    }
    if (COLOR_PROP_KEYS.has(props.propKey)) {
      return <ColorSwatchPicker value={strVal()} onChange={(v) => props.onChange(v)} />;
    }
    if (ICON_PROP_KEYS.has(props.propKey) && props.options) {
      return (
        <IconSegmentedRow
          propKey={props.propKey}
          options={props.options}
          value={strVal()}
          onChange={(v) => props.onChange(v)}
        />
      );
    }
    return (
      <Combobox
        options={[
          ...(props.value !== '' ? [{ label: '(unset)', value: '' } as ComboboxOption] : []),
          ...(props.options ?? []).map((o) => ({ label: o, value: o }) as ComboboxOption),
        ]}
        value={strVal()}
        size="xs"
        onChange={(v: string) => props.onChange(v)}
      />
    );
  };

  return (
    // minmax(0, ...) — not bare 1fr/1.2fr — is required for the tracks to actually
    // shrink below their content's intrinsic min-content size. Grid tracks default to
    // min-width:auto just like flex items; a bare `1fr` still won't yield to a long
    // unbroken string (a URL, a data URI) in the input column, which pushes the whole
    // row wider than the panel and shoves the prop-key label out of view.
    <Grid template="minmax(0, 1fr) minmax(0, 1.2fr)" gap="200" ay="center" px="400" py="100">
      <we-text title={props.propKey} fontSize="200" fontWeight="500" color="text-muted" truncate minWidth="0">
        {props.propKey}
      </we-text>
      {renderInput()}
    </Grid>
  );
}
