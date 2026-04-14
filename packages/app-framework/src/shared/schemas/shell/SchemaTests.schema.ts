/**
 * Schema Tests Template
 *
 * Root shell template for all schema test suites.
 * Provides a landing page with cards for each test section,
 * with routes to the individual test templates.
 *
 * Routes:
 *   /benchmark/* — performance benchmark suite
 *   /tokens/*    — schema token integration tests
 *   /mutations/* — updateSchema diffing engine tests
 *   /routing/*   — $routes token and multi-level routing tests
 */
import type { RouteSchema, SchemaNode, TemplateSchema } from '@we/schema-shared';

import { schemaBenchmarkTemplate } from './tests/SchemaBenchmark.schema';
import { schemaMutationsTemplate } from './tests/SchemaMutations.schema';
import { schemaRoutingTemplate } from './tests/SchemaRouting.schema';
import { schemaTokensTemplate } from './tests/SchemaTokens.schema';

// ---------------------------------------------------------------------------
// Test sections metadata
// ---------------------------------------------------------------------------

const sections = [
  {
    id: 'benchmarks',
    label: 'Benchmarks',
    description: 'Performance benchmark suite for schema renderer',
    icon: 'timer',
    path: '/benchmarks',
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

function sectionButton(section: (typeof sections)[number]): SchemaNode {
  return {
    type: 'we-button',
    props: {
      variant: {
        $if: {
          condition: { $eq: [{ $store: 'routeStore.segments.0' }, section.id] },
          then: 'primary',
          else: 'secondary',
        },
      },
      onClick: { $action: 'routeStore.navigate', args: [section.path] },
    },
    children: [{ type: 'we-icon', props: { name: section.icon, size: 'sm' } }, section.label],
  };
}

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
    stores: { testStore: true, templateStore: true },
    components: ['BenchmarkTimer'],
  },
  type: 'Column',
  props: { width: '100%', minHeight: '100%', p: '500', bg: 'neutral-50', gap: '400' },
  children: [
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
          children: ['Integration test suite for the schema system'],
        },
        { type: 'Row', props: { gap: '300', py: '200', wrap: true }, children: sections.map(sectionButton) },
        { type: 'we-divider' },
      ],
    },
    { type: '$routes' },
  ],
  routes: [
    { path: '/', redirect: '/benchmarks' },
    testRoute('/benchmarks', schemaBenchmarkTemplate),
    testRoute('/tokens', schemaTokensTemplate),
    testRoute('/mutations', schemaMutationsTemplate),
    testRoute('/routing', schemaRoutingTemplate),
  ],
};
