/**
 * Schema Mutations Template
 *
 * Minimal shell for testing the updateSchema diffing engine.
 * Each button triggers a mutation that adds/removes/changes nodes and props,
 * validating that the reactive diff + reconcile pipeline works correctly.
 *
 * Mutations covered:
 *   addChild (append), removeChild (pop), removeFromMiddle (splice),
 *   reorderChildren (swap first/last), changeProp (toggle bg color),
 *   changeType (Column ↔ Row), deepNestedProp (grandchild icon/text),
 *   multiMutate (3 changes at once), noopMutate (identical schema),
 *   changeText (string child swap), addProp (new key), removeProp (delete key),
 *   toggleTheme (add/remove theme override), invalidMutate (validation error),
 *   addRouteChild (mutate inside route definition)
 *
 * Tokens exercised:
 *   $store, $action, $routes, $concat, $if (prop-level)
 *
 * This replaces the old TestTemplate.schema.ts with a clean, focused design.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { toastService } from '@we/components/solid';
import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import { updateSchema } from '@we/schema-solid';
import type { SetStoreFunction } from 'solid-js/store';

import { deepClone } from '../../utils';

// ---------------------------------------------------------------------------
// Schema definition
// ---------------------------------------------------------------------------

function button(action: string, icon: string, label: string, variant?: string): SchemaNode {
  return {
    type: 'we-button',
    props: { ...(variant && { variant }), onClick: { $action: `templateStore.${action}` } },
    children: [{ type: 'we-icon', props: { name: icon } }, label],
  };
}

function buttonRow(variant: string | undefined, buttons: [string, string, string][]): SchemaNode {
  return {
    type: 'Row',
    props: { gap: '300', ay: 'center' },
    children: buttons.map(([action, icon, label]) => button(action, icon, label, variant)),
  };
}

const mutationButtons = buttonRow(undefined, [
  ['addChild', 'plus', 'Add child'],
  ['removeChild', 'minus', 'Remove child'],
  ['changeProp', 'pencil', 'Change prop'],
  ['changeType', 'arrows-clockwise', 'Change type'],
  ['addRouteChild', 'plus', 'Add route child'],
]);

const mutationButtons2 = buttonRow('secondary', [
  ['removeFromMiddle', 'arrows-in-line-vertical', 'Remove middle'],
  ['reorderChildren', 'arrows-down-up', 'Reorder'],
  ['deepNestedProp', 'tree-structure', 'Deep prop'],
  ['multiMutate', 'stack', 'Multi-mutate'],
  ['noopMutate', 'equals', 'No-op'],
]);

const mutationButtons3 = buttonRow('outline', [
  ['changeText', 'text-aa', 'Change text'],
  ['addProp', 'plus-circle', 'Add prop'],
  ['removeProp', 'minus-circle', 'Remove prop'],
  ['toggleTheme', 'palette', 'Toggle theme'],
  ['invalidMutate', 'warning', 'Invalid'],
]);

function mutationArea(placeholder: string, innerChildren: SchemaNode[] = []): SchemaNode {
  return {
    type: 'Column',
    props: { p: '400', bg: 'neutral-0', r: '400' },
    children: [
      {
        type: 'we-text',
        props: { color: 'neutral-400' },
        children: [placeholder],
      },
      { type: 'Column', props: { mt: '300', gap: '300' }, children: innerChildren },
    ],
  };
}

const dynamicArea = mutationArea('Root template children appear here. Click "Add child" above.');
const routeArea = mutationArea('Route children appear here. Click "Add route child" above.', [{ type: '$routes' }]);

const header: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
    {
      type: 'we-text',
      props: { fontSize: '700', fontWeight: '700', color: 'primary-800' },
      children: ['Schema Mutation Tests'],
    },
    {
      type: 'we-text',
      props: { color: 'neutral-600' },
      children: ['Tests the updateSchema diffing engine — use buttons to add, remove, and change nodes'],
    },
    { type: 'we-divider' },
  ],
};

const mainContent: SchemaNode = {
  type: 'Column',
  props: { minHeight: '100%', width: '100%', p: '500', bg: 'neutral-50', gap: '400' },
  children: [header, mutationButtons, mutationButtons2, mutationButtons3, dynamicArea, routeArea],
};

export const schemaMutationsTemplate: TemplateSchema = {
  meta: {
    name: 'Schema Mutations',
    description: 'Testing updateSchema diffing engine',
    icon: 'code',
  },
  type: 'Column',
  props: { height: '100%', width: '100%' },
  children: [mainContent, { type: 'ToastContainer' }],
  routes: [
    {
      path: '/',
      type: 'Column',
      props: { gap: '300' },
      children: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// Mutation functions
//
// Path reference:
//   children[0] = mainContent Column
//     children[0] = header
//     children[1] = mutation buttons Row (primary)
//     children[2] = mutation buttons Row 2 (secondary)
//     children[3] = mutation buttons Row 3 (outline)
//     children[4] = dynamic area Column
//       children[0] = placeholder text
//       children[1] = inner Column (dynamic children go here)
//     children[5] = route area Column (with $routes)
// ---------------------------------------------------------------------------

export function schemaMutationActions(
  currentSchema: TemplateSchema,
  setCurrentSchema: SetStoreFunction<TemplateSchema>,
) {
  function applyUpdate(newSchema: TemplateSchema) {
    const result = updateSchema(currentSchema, newSchema, setCurrentSchema);
    if (!result.applied && result.errors?.length) {
      toastService.error(`Schema validation failed: ${result.errors[0].message}`);
    }
  }

  function addChild() {
    const newSchema = deepClone(currentSchema) as any;
    const dynamicArea = newSchema.children[0].children[4].children[1];
    const count = dynamicArea.children.length;
    dynamicArea.children.push({
      type: 'Row',
      props: { p: '300', gap: '200', bg: 'neutral-100', r: '200', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: 'check', color: 'success-500' } },
        { type: 'we-text', children: [`Template child #${count}`] },
      ],
    });
    applyUpdate(newSchema);
  }

  function removeChild() {
    const newSchema = deepClone(currentSchema) as any;
    const dynamicArea = newSchema.children[0].children[4].children[1];
    if (dynamicArea.children.length > 0) {
      dynamicArea.children.pop();
    }
    applyUpdate(newSchema);
  }

  function changeProp() {
    const newSchema = deepClone(currentSchema) as any;
    const dynamicArea = newSchema.children[0].children[4];
    // Toggle background between neutral-0 and neutral-900
    dynamicArea.props.bg = dynamicArea.props.bg === 'neutral-0' ? 'neutral-900' : 'neutral-0';
    applyUpdate(newSchema);
  }

  function changeType() {
    const newSchema = deepClone(currentSchema) as any;
    const dynamicArea = newSchema.children[0].children[4].children[1];
    // Toggle between Column and Row
    dynamicArea.type = dynamicArea.type === 'Column' ? 'Row' : 'Column';
    applyUpdate(newSchema);
  }

  function addRouteChild() {
    const newSchema = deepClone(currentSchema) as any;
    const homeRoute = newSchema.routes.find((r: any) => r.path === '/');
    if (homeRoute) {
      const count = homeRoute.children.length;
      homeRoute.children.push({
        type: 'Row',
        props: { p: '300', gap: '200', bg: 'neutral-100', r: '200', ay: 'center' },
        children: [
          { type: 'we-icon', props: { name: 'check', color: 'primary-500' } },
          { type: 'we-text', children: [`Route child #${count}`] },
        ],
      });
    }
    applyUpdate(newSchema);
  }

  // --- New mutation functions ---

  function removeFromMiddle() {
    const newSchema = deepClone(currentSchema) as any;
    const dynamicArea = newSchema.children[0].children[4].children[1];
    if (dynamicArea.children.length >= 2) {
      // Remove from the middle (index 1, or middle of array)
      const midIndex = Math.floor(dynamicArea.children.length / 2);
      dynamicArea.children.splice(midIndex, 1);
    } else if (dynamicArea.children.length === 1) {
      dynamicArea.children.splice(0, 1);
    }
    applyUpdate(newSchema);
  }

  function reorderChildren() {
    const newSchema = deepClone(currentSchema) as any;
    const dynamicArea = newSchema.children[0].children[4].children[1];
    if (dynamicArea.children.length >= 2) {
      // Swap first and last child
      const first = dynamicArea.children[0];
      const last = dynamicArea.children[dynamicArea.children.length - 1];
      dynamicArea.children[0] = last;
      dynamicArea.children[dynamicArea.children.length - 1] = first;
    }
    applyUpdate(newSchema);
  }

  function deepNestedProp() {
    const newSchema = deepClone(currentSchema) as any;
    const dynamicArea = newSchema.children[0].children[4].children[1];
    if (dynamicArea.children.length > 0) {
      // Change a deep nested prop: first child's first child icon color
      const firstChild = dynamicArea.children[0];
      if (firstChild.children?.[0]?.props?.color) {
        firstChild.children[0].props.color =
          firstChild.children[0].props.color === 'success-500' ? 'danger-500' : 'success-500';
      }
      // Also change the text content of the second child
      if (firstChild.children?.[1]) {
        const textNode = firstChild.children[1];
        textNode.children = [`Modified at ${Date.now() % 10000}`];
      }
    }
    applyUpdate(newSchema);
  }

  function multiMutate() {
    const newSchema = deepClone(currentSchema) as any;
    const mainContent = newSchema.children[0];
    const dynamicArea = mainContent.children[4];
    const innerColumn = dynamicArea.children[1];

    // 1. Add a child
    const count = innerColumn.children.length;
    innerColumn.children.push({
      type: 'Row',
      props: { p: '300', gap: '200', bg: 'primary-50', r: '200', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: 'lightning', color: 'primary-500' } },
        { type: 'we-text', children: [`Multi-mutate child #${count}`] },
      ],
    });

    // 2. Change the dynamic area background
    dynamicArea.props.bg = dynamicArea.props.bg === 'neutral-0' ? 'primary-50' : 'neutral-0';

    // 3. Change the inner column layout type
    innerColumn.type = innerColumn.type === 'Column' ? 'Row' : 'Column';

    applyUpdate(newSchema);
  }

  function noopMutate() {
    // Apply identical schema — should produce zero mutations
    const newSchema = deepClone(currentSchema) as any;
    const result = updateSchema(currentSchema, newSchema, setCurrentSchema);
    if (result.applied) {
      toastService.success('No-op: schema unchanged (0 mutations)');
    }
  }

  function changeText() {
    const newSchema = deepClone(currentSchema) as any;
    const dynamicArea = newSchema.children[0].children[4];
    // Toggle the placeholder text
    const placeholder = dynamicArea.children[0];
    const current = placeholder.children[0];
    placeholder.children[0] =
      current === 'Dynamic children appear here. Click "Add child" above.'
        ? 'Text has been changed! Click again to revert.'
        : 'Dynamic children appear here. Click "Add child" above.';
    applyUpdate(newSchema);
  }

  function addProp() {
    const newSchema = deepClone(currentSchema) as any;
    const dynamicArea = newSchema.children[0].children[4];
    // Add a border prop that didn't exist before
    if (!dynamicArea.props.border) {
      dynamicArea.props.border = '2px solid var(--we-color-primary-300)';
    } else {
      // Toggle border style
      dynamicArea.props.border =
        dynamicArea.props.border === '2px solid var(--we-color-primary-300)'
          ? '2px dashed var(--we-color-danger-300)'
          : '2px solid var(--we-color-primary-300)';
    }
    applyUpdate(newSchema);
  }

  function removeProp() {
    const newSchema = deepClone(currentSchema) as any;
    const dynamicArea = newSchema.children[0].children[4];
    // Remove the border prop if it exists, or remove the r (border-radius) prop
    if (dynamicArea.props.border) {
      delete dynamicArea.props.border;
    } else if (dynamicArea.props.r) {
      delete dynamicArea.props.r;
    }
    applyUpdate(newSchema);
  }

  function toggleTheme() {
    const newSchema = deepClone(currentSchema) as any;
    const dynamicArea = newSchema.children[0].children[4];
    // Toggle theme on the dynamic area
    if (dynamicArea.theme) {
      delete dynamicArea.theme;
    } else {
      dynamicArea.theme = { primaryHue: 280, saturation: '80%' };
    }
    applyUpdate(newSchema);
  }

  function invalidMutate() {
    const newSchema = deepClone(currentSchema) as any;
    // Create an invalid $each node (missing items prop + children)
    newSchema.children[0].children[4].children[1].children.push({
      type: '$each',
      props: {},
      children: [],
    });
    applyUpdate(newSchema);
  }

  return {
    addChild,
    removeChild,
    changeProp,
    changeType,
    addRouteChild,
    removeFromMiddle,
    reorderChildren,
    deepNestedProp,
    multiMutate,
    noopMutate,
    changeText,
    addProp,
    removeProp,
    toggleTheme,
    invalidMutate,
  };
}
