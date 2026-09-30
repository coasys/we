/**
 * Schema Tests Template
 *
 * Root shell template for all schema test suites.
 * Provides a landing page with cards for each test section,
 * with routes to the individual test templates.
 *
 * Routes:
 *   /tokens/*    — schema token integration tests
 *   /mutations/* — updateSchema diffing engine tests
 *   /queries/*   — every $query shape through the QueryIR, against real AD4M
 *   /routing/*   — $routes token and multi-level routing tests
 *
 * WHY THESE LIVE IN THE APP (and the render benchmarks do not)
 *
 * The rule is: **move what the environment corrupts, keep what the environment validates.**
 *
 * Render benchmarks moved out to `apps/playgrounds/solid/render-bench` because the surrounding app
 * changed their *results* — AD4M subscriptions, the embedded-app iframe and dev-mode frameworks all
 * distorted the numbers, and a team adopting WE brings their own shell rather than ours.
 *
 * These four are correctness tests, so the environment cannot change whether they pass. For two of
 * them the app is not incidental, it is the system under test:
 *
 *   - Tokens    verifies design tokens against the *live theme system*. Standing this up in an
 *               isolated harness would mean a stub theme setup — testing something that isn't what
 *               ships.
 *   - Routing   verifies $routes against the app's *actual* router configuration.
 *   - Queries   validates the AD4M adapter against a real node. In a local-first app the backend is
 *               the user's own install (SDNA versions, perspective state), which cannot be
 *               reproduced elsewhere — so being able to run this in situ has real diagnostic value.
 *   - Mutations needs templateStore.
 *
 * So moving any of these to the neutral harness would weaken them rather than tidy them.
 */
import type { RouteSchema, SchemaNode, TemplateSchema } from '@we/schema-shared';
import { expr } from '@we/schema-shared';

import { schemaMutationsTemplate } from './tests/SchemaMutations.schema.ts';
import { schemaQueriesTemplate } from './tests/SchemaQueries.schema.ts';
import { schemaRoutingTemplate } from './tests/SchemaRouting.schema.ts';
import { schemaTokensTemplate } from './tests/SchemaTokens.schema.ts';

// ---------------------------------------------------------------------------
// Test sections metadata
// ---------------------------------------------------------------------------

const sections = [
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
    id: 'queries',
    label: 'Queries',
    description: 'Every $query shape through the QueryIR routing',
    icon: 'magnifying-glass',
    path: '/queries',
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
      variant: expr`routeStore.segments[0] == ${section.id} ? 'primary' : 'secondary'`,
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
  },
  type: 'Column',
  props: { width: '100%', minHeight: '100%', ax: 'center', bg: 'page' },
  children: [
    {
      type: 'Column',
      props: { maxWidth: '1200px', width: '100%', bg: 'page', p: '500', gap: '400' },
      children: [
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-icon', props: { name: 'flask', size: 'xl' } },
                {
                  type: 'we-text',
                  props: { variant: 'heading-md' },
                  children: ['Schema Tests'],
                },
              ],
            },
            {
              type: 'we-text',
              children: ['Integration test suite for the schema system'],
            },
            { type: 'Row', props: { gap: '300', py: '200', wrap: true }, children: sections.map(sectionButton) },
            { type: 'we-divider' },
          ],
        },
        { type: '$routes' },
      ],
    },
  ],
  routes: [
    { path: '/', redirect: '/tokens' },
    testRoute('/tokens', schemaTokensTemplate),
    testRoute('/mutations', schemaMutationsTemplate),
    testRoute('/queries', schemaQueriesTemplate),
    testRoute('/routing', schemaRoutingTemplate),
  ],
};
