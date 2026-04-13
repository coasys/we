/**
 * Schema Tests Template
 *
 * Root shell template for all schema test suites.
 * Provides a landing page with cards for each test section,
 * with routes to the individual test templates.
 *
 * Routes:
 *   /            — landing page with test section cards
 *   /benchmark/* — performance benchmark suite
 *   /tokens/*    — schema token integration tests
 *   /mutations/* — updateSchema diffing engine tests
 *   /routing/*   — $routes token and multi-level routing tests
 */
import type { RouteSchema, SchemaNode, TemplateSchema } from '@we/schema-shared';

import { schemaBenchmarkTemplate, schemaMutationsTemplate, schemaRoutingTemplate, schemaTokensTemplate } from './tests';

// ---------------------------------------------------------------------------
// Test sections metadata
// ---------------------------------------------------------------------------

const sections = [
  {
    id: 'benchmark',
    label: 'Benchmark',
    description: 'Performance benchmark suite for schema renderer',
    icon: 'timer',
    path: '/benchmark',
  },
  {
    id: 'tokens',
    label: 'Tokens',
    description: 'Visual test suite for all schema tokens',
    icon: 'currency-dollar',
    path: '/tokens',
  },
  {
    id: 'mutations',
    label: 'Mutations',
    description: 'Testing updateSchema diffing engine',
    icon: 'code',
    path: '/mutations',
  },
  {
    id: 'routing',
    label: 'Routing',
    description: 'Testing $routes token and multi-level routing',
    icon: 'signpost',
    path: '/routing',
  },
] as const;

// ---------------------------------------------------------------------------
// Landing page
// ---------------------------------------------------------------------------

function sectionCard(section: (typeof sections)[number]): SchemaNode {
  return {
    type: 'Column',
    props: {
      p: '400',
      gap: '200',
      bg: 'neutral-0',
      r: '400',
      cursor: 'pointer',
      border: '1px solid neutral-200',
      hoverProps: { bg: 'primary-25', borderColor: 'primary-300' },
      onClick: { $action: 'routeStore.navigate', args: [section.path] },
    },
    children: [
      {
        type: 'Row',
        props: { gap: '200', ay: 'center' },
        children: [
          { type: 'we-icon', props: { name: section.icon, size: 'lg', color: 'primary-600' } },
          {
            type: 'we-text',
            props: { fontWeight: '600', fontSize: '500', color: 'neutral-800' },
            children: [section.label],
          },
        ],
      },
      { type: 'we-text', props: { color: 'neutral-500', fontSize: '300' }, children: [section.description] },
    ],
  };
}

const landingRoute: RouteSchema = {
  path: '/',
  type: 'Column',
  props: {
    gap: '300',
    styles: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(280px, 1fr))' },
  },
  children: sections.map(sectionCard),
};

// ---------------------------------------------------------------------------
// Sub-routes — each wraps a test template's content
// ---------------------------------------------------------------------------

function testRoute(path: string, template: TemplateSchema): RouteSchema {
  return {
    path,
    type: template.type!,
    props: template.props,
    children: template.children,
    routes: template.routes,
  };
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export const schemaTestsTemplate: TemplateSchema = {
  meta: {
    name: 'Testing',
    description: 'Schema test suites — benchmark, tokens, mutations, routing',
    icon: 'flask',
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
    components: ['BenchmarkTimer'],
  },
  type: 'Column',
  props: { width: '100%', height: '100%', p: '500', bg: 'neutral-50', gap: '400' },
  children: [
    // {
    //   type: 'we-text',
    //   props: { fontSize: '700', fontWeight: '700', color: 'primary-800' },
    //   children: ['Schema Tests'],
    // },
    {
      type: 'Column',
      props: { gap: '300' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'flask', size: 'xl', color: 'primary-700' } },
            {
              type: 'we-text',
              props: { fontSize: '700', fontWeight: '700', color: 'primary-800' },
              children: ['Schema Tests'],
            },
          ],
        },
        {
          type: 'we-text',
          props: { color: 'neutral-600' },
          children: ['Select a test suite to run'],
        },
        { type: 'we-divider' },
      ],
    },
    { type: '$routes' },
  ],
  routes: [
    landingRoute,
    testRoute('/benchmark', schemaBenchmarkTemplate),
    testRoute('/tokens', schemaTokensTemplate),
    testRoute('/mutations', schemaMutationsTemplate),
    testRoute('/routing', schemaRoutingTemplate),
  ],
};
