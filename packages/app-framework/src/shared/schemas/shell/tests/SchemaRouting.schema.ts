/**
 * Schema Routing Template
 *
 * Tests the $routes token and multi-level route resolution.
 *
 * Routing features exercised:
 *   - Top-level routes with catch-all (*)
 *   - Nested sub-routes with their own $routes outlet
 *   - Navigation via $action routeStore.navigate
 *   - Route parameter display
 */
import type { TemplateSchema } from '@we/schema-shared';

export const schemaRoutingTemplate: TemplateSchema = {
  meta: {
    name: 'Schema Routing',
    description: 'Testing $routes token and multi-level routing',
    icon: 'signpost',
    stores: ['testStore'],
  },
  type: 'Column',
  props: { height: '100%', width: '100%' },
  children: [
    {
      type: 'Column',
      props: { minHeight: '100%', width: '100%', p: '500', bg: 'neutral-50', gap: '400' },
      children: [
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '700', fontWeight: '700', color: 'primary-800' },
              children: ['Schema Routing Tests'],
            },
            {
              type: 'we-text',
              props: { color: 'neutral-600' },
              children: ['Tests $routes token, nested routes, catch-all, and navigation'],
            },
            { type: 'we-divider' },
          ],
        },
        {
          type: 'Row',
          props: { gap: '200' },
          children: [
            {
              type: 'we-button',
              props: {
                variant: {
                  $if: {
                    condition: { $eq: [{ $store: 'routeStore.currentPath' }, '/'] },
                    then: 'primary',
                    else: 'secondary',
                  },
                },
                onClick: { $action: 'routeStore.navigate', args: ['/'] },
              },
              children: ['Home'],
            },
            {
              type: 'we-button',
              props: {
                variant: {
                  $if: {
                    condition: { $eq: [{ $store: 'routeStore.currentPath' }, '/route-1'] },
                    then: 'primary',
                    else: 'secondary',
                  },
                },
                onClick: { $action: 'routeStore.navigate', args: ['/route-1'] },
              },
              children: ['Route 1'],
            },
            {
              type: 'we-button',
              props: {
                variant: {
                  $if: {
                    condition: { $eq: [{ $store: 'routeStore.currentPath' }, '/route-2'] },
                    then: 'primary',
                    else: 'secondary',
                  },
                },
                onClick: { $action: 'routeStore.navigate', args: ['/route-2'] },
              },
              children: ['Route 2'],
            },
            {
              type: 'we-button',
              props: { variant: 'outline', onClick: { $action: 'routeStore.navigate', args: ['/nonexistent'] } },
              children: ['404 test'],
            },
          ],
        },
        // $routes outlet
        {
          type: 'Column',
          props: { p: '400', bg: 'neutral-0', r: '400', gap: '400' },
          children: [{ type: '$routes' }],
        },
      ],
    },
  ],
  routes: [
    {
      path: '/',
      type: 'Column',
      props: { gap: '300' },
      children: [
        { type: 'we-text', props: { fontWeight: '600' }, children: ['Home'] },
        {
          type: 'we-text',
          props: { color: 'neutral-500' },
          children: ['This is the home route. Use buttons above to navigate.'],
        },
      ],
    },
    {
      path: '/route-1',
      type: 'Column',
      props: { gap: '300', ax: 'start' },
      children: [
        { type: 'we-text', props: { fontWeight: '600' }, children: ['Route 1'] },
        {
          type: 'we-text',
          props: { color: 'neutral-500' },
          children: ['This is another route. Use buttons below to navigate nested routes.'],
        },
        {
          type: 'Row',
          props: { gap: '300' },
          children: [
            {
              type: 'we-button',
              props: {
                variant: {
                  $if: {
                    condition: { $eq: [{ $store: 'routeStore.currentPath' }, '/route-1'] },
                    then: 'primary',
                    else: 'outline',
                  },
                },
                onClick: { $action: 'routeStore.navigate', args: ['/route-1'] },
              },
              children: ['Route 1.0 (Home)'],
            },
            {
              type: 'we-button',
              props: {
                variant: {
                  $if: {
                    condition: { $eq: [{ $store: 'routeStore.currentPath' }, '/route-1/nested'] },
                    then: 'primary',
                    else: 'outline',
                  },
                },
                onClick: { $action: 'routeStore.navigate', args: ['/route-1/nested'] },
              },
              children: ['Route 1.1'],
            },
          ],
        },
        { type: 'Column', props: { bg: 'neutral-100', p: '400', r: '400' }, children: [{ type: '$routes' }] },
      ],
      routes: [
        {
          path: '/',
          type: 'Column',
          props: { gap: '300' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '400', fontWeight: '600' },
              children: ['Route 1.0 (Home)'],
            },
            {
              type: 'we-text',
              props: { color: 'neutral-500' },
              children: ['This is the default sub-route for route 1. Use buttons above to navigate.'],
            },
          ],
        },
        {
          path: '/nested',
          type: 'Column',
          props: { gap: '300' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '400', fontWeight: '600' },
              children: ['Route 1.1 (Nested)'],
            },
            {
              type: 'we-text',
              props: { color: 'neutral-500' },
              children: ['This is another sub-route under route 1. Use buttons above to navigate.'],
            },
          ],
        },
        { path: '/*', type: 'we-text', children: ['Sub-route not found'] },
      ],
    },
    {
      path: '/route-2',
      type: 'Column',
      props: { gap: '300', ax: 'start' },
      children: [
        { type: 'we-text', props: { fontSize: '500', fontWeight: '600' }, children: ['Route 2'] },
        {
          type: 'we-text',
          props: { color: 'neutral-500' },
          children: ['Welcome to route 2 :)'],
        },
      ],
    },
    {
      path: '*',
      type: 'Column',
      children: [{ type: 'we-text', props: { color: 'neutral-400' }, children: ['Page not found'] }],
    },
  ],
};
