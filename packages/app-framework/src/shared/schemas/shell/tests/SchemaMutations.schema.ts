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
import type { SchemaNode, TemplateSchema } from '@we/schema-shared';

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
  props: { minHeight: '100%', width: '100%', bg: 'neutral-50', gap: '400' },
  children: [header, mutationButtons, mutationButtons2, mutationButtons3, dynamicArea, routeArea],
};

export const schemaMutationsTemplate: TemplateSchema = {
  meta: {
    name: 'Schema Mutations',
    description: 'Testing updateSchema diffing engine',
    icon: 'code',
    stores: {
      testStore: {},
      templateStore: {
        actions: [
          'addChild',
          'removeChild',
          'changeProp',
          'changeType',
          'addRouteChild',
          'removeFromMiddle',
          'reorderChildren',
          'deepNestedProp',
          'multiMutate',
          'noopMutate',
          'changeText',
          'addProp',
          'removeProp',
          'toggleTheme',
          'invalidMutate',
        ],
      },
    },
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
