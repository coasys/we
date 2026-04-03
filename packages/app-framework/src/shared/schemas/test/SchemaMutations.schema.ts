/**
 * Schema Mutations Template
 *
 * Minimal shell for testing the updateSchema diffing engine.
 * Each button triggers a mutation that adds/removes/changes nodes and props,
 * validating that the reactive diff + reconcile pipeline works correctly.
 *
 * Tokens exercised:
 *   $store, $action, $routes (multi-level routing), $concat, $if (prop-level)
 *
 * This replaces the old TestTemplate.schema.ts with a clean, focused design.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TemplateSchema } from '@we/schema-shared';
import { updateSchema } from '@we/schema-solid';
import type { SetStoreFunction } from 'solid-js/store';

import { deepClone } from '../../utils';

// ---------------------------------------------------------------------------
// Schema definition
// ---------------------------------------------------------------------------

const mutationButtons = {
  type: 'Row',
  props: {
    p: '400',
    gap: '300',
    ay: 'center',
    bg: 'neutral-100',
    style: { 'border-bottom': '1px solid var(--we-color-neutral-200)', 'flex-wrap': 'wrap' },
  },
  children: [
    { type: 'we-text', props: { fontSize: '400', fontWeight: '700', color: 'neutral-600' }, children: ['Mutations:'] },
    {
      type: 'we-button',
      props: { variant: 'ghost', onClick: { $action: 'templateStore.addChild' } },
      children: [{ type: 'we-icon', props: { name: 'plus' } }, 'Add child'],
    },
    {
      type: 'we-button',
      props: { variant: 'ghost', onClick: { $action: 'templateStore.removeChild' } },
      children: [{ type: 'we-icon', props: { name: 'minus' } }, 'Remove child'],
    },
    {
      type: 'we-button',
      props: { variant: 'ghost', onClick: { $action: 'templateStore.changeProp' } },
      children: [{ type: 'we-icon', props: { name: 'pencil' } }, 'Change prop'],
    },
    {
      type: 'we-button',
      props: { variant: 'ghost', onClick: { $action: 'templateStore.changeType' } },
      children: [{ type: 'we-icon', props: { name: 'arrows-clockwise' } }, 'Change type'],
    },
    {
      type: 'we-button',
      props: { variant: 'ghost', onClick: { $action: 'templateStore.addRouteChild' } },
      children: [{ type: 'we-icon', props: { name: 'plus' } }, 'Add route child'],
    },
  ],
};

const dynamicArea = {
  type: 'Column',
  props: { id: 'dynamic-area', p: '400', gap: '300', bg: 'neutral-0' },
  children: [
    {
      type: 'we-text',
      props: { fontSize: '300', color: 'neutral-400' },
      children: ['Dynamic children appear here. Click "Add child" above.'],
    },
  ],
};

const mainContent = {
  type: 'Column',
  props: { style: { flex: '1', overflow: 'auto' } },
  children: [
    mutationButtons,
    dynamicArea,
    // $routes: routed content appears here
    { type: 'main', props: { p: '400' }, children: [{ type: '$routes' }] },
  ],
};

export const schemaMutationsTemplate: TemplateSchema = {
  meta: {
    name: 'Schema Mutations',
    description: 'Testing updateSchema diffing engine',
    icon: 'code',
  },
  type: 'Column',
  props: { height: '100%', width: '100%' },
  children: [mainContent],
  routes: [
    {
      path: '*',
      type: 'Column',
      props: { p: '400' },
      children: [{ type: 'we-text', props: { fontSize: '400', color: 'neutral-400' }, children: ['Page not found'] }],
    },
    {
      path: '/',
      type: 'Column',
      props: { gap: '300' },
      children: [
        { type: 'we-text', props: { fontSize: '500', fontWeight: '600' }, children: ['Home'] },
        {
          type: 'Row',
          props: { gap: '200' },
          children: [
            {
              type: 'we-button',
              props: { variant: 'ghost', onClick: { $action: 'routeStore.navigate', args: ['/sub'] } },
              children: ['Go to /sub'],
            },
            {
              type: 'we-button',
              props: { variant: 'ghost', onClick: { $action: 'routeStore.navigate', args: ['/sub/nested'] } },
              children: ['Go to /sub/nested'],
            },
          ],
        },
      ],
    },
    {
      path: '/sub',
      type: 'Column',
      props: { gap: '300' },
      children: [
        { type: 'we-text', props: { fontSize: '500', fontWeight: '600' }, children: ['Sub-route'] },
        {
          type: 'we-button',
          props: { variant: 'ghost', onClick: { $action: 'routeStore.navigate', args: ['/'] } },
          children: ['Back to home'],
        },
        { type: 'main', children: [{ type: '$routes' }] },
      ],
      routes: [
        { path: '/', type: 'we-text', props: { fontSize: '400', color: 'neutral-500' }, children: ['Sub-route index'] },
        {
          path: '/nested',
          type: 'we-text',
          props: { fontSize: '400', color: 'primary-500', fontWeight: '600' },
          children: ['Nested sub-route!'],
        },
        { path: '/*', type: 'we-text', children: ['Sub-route not found'] },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Mutation functions
//
// Path reference:
//   children[0] = mainContent Column
//     children[0] = mutation buttons Row
//     children[1] = dynamic area Column (id: 'dynamic-area')
//     children[2] = main (with $routes)
// ---------------------------------------------------------------------------

export function schemaMutationActions(
  currentSchema: TemplateSchema,
  setCurrentSchema: SetStoreFunction<TemplateSchema>,
) {
  function addChild() {
    const newSchema = deepClone(currentSchema) as any;
    const dynamicArea = newSchema.children[0].children[1];
    const count = dynamicArea.children.length;
    dynamicArea.children.push({
      type: 'Row',
      props: { p: '300', gap: '200', bg: 'primary-50', r: '200', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: 'check', color: 'primary-500' } },
        { type: 'we-text', props: { fontSize: '300' }, children: [`Dynamic child #${count}`] },
      ],
    });
    updateSchema(currentSchema, newSchema, setCurrentSchema);
  }

  function removeChild() {
    const newSchema = deepClone(currentSchema) as any;
    const dynamicArea = newSchema.children[0].children[1];
    if (dynamicArea.children.length > 1) {
      dynamicArea.children.pop();
    }
    updateSchema(currentSchema, newSchema, setCurrentSchema);
  }

  function changeProp() {
    const newSchema = deepClone(currentSchema) as any;
    const dynamicArea = newSchema.children[0].children[1];
    // Toggle background between neutral-0 and neutral-900
    dynamicArea.props.bg = dynamicArea.props.bg === 'neutral-0' ? 'neutral-900' : 'neutral-0';
    updateSchema(currentSchema, newSchema, setCurrentSchema);
  }

  function changeType() {
    const newSchema = deepClone(currentSchema) as any;
    const dynamicArea = newSchema.children[0].children[1];
    // Toggle between Column and Row
    dynamicArea.type = dynamicArea.type === 'Column' ? 'Row' : 'Column';
    updateSchema(currentSchema, newSchema, setCurrentSchema);
  }

  function addRouteChild() {
    const newSchema = deepClone(currentSchema) as any;
    const homeRoute = newSchema.routes.find((r: any) => r.path === '/');
    if (homeRoute) {
      const count = homeRoute.children.length;
      homeRoute.children.push({
        type: 'we-text',
        props: { fontSize: '300', color: 'success-500' },
        children: [`Route child #${count}`],
      });
    }
    updateSchema(currentSchema, newSchema, setCurrentSchema);
  }

  return { addChild, removeChild, changeProp, changeType, addRouteChild };
}
