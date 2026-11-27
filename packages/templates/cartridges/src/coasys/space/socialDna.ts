import type { RouteSchema, SchemaNode } from '@we/schema-shared';
import { chooseTemplate, emptyNote, SPACE_TEMPLATE_CHOICES } from '@we/template-kit';

import { viewBar } from './bar.ts';
import {
  CLASS_COUNT,
  CLASS_DISPLAY,
  CLASS_ICON,
  CLASS_LABEL,
  CLASS_QUERIES,
  CLASS_ROWS,
  CLASS_ROWS_COUNT,
  CLASS_ROWS_LOADED,
  classGroup,
  DNA_AT,
  DNA_ID,
  DNA_KIND,
  DNA_RECORD,
  dnaCrumbs,
  editDna,
  FLOW_DEFINITIONS,
  MODEL,
  ON_CLASS,
  POLICY,
  POLICY_RULES,
} from './dna.ts';
import { detail, glyph, grid, tile } from './groups.ts';
import { dnaPage, groupPath, inspect } from './paths.ts';

/**
 * Social DNA as a page — what the tree's Social DNA rows open in Page mode, as every other group row
 * opens its page. Canvas mode draws the same classes as the vocabulary map, which shows how they
 * connect; this is the page for reading through them.
 *
 * It reads as the tree lists it: Models (the space's own classes and other apps'), Flows, Templates,
 * WE's built-in classes and the policy. A class (`?dna=model|<name>`) is its records, drawn as its
 * display says, whoever wrote the class; one of them chosen is outlined and read in the inspector
 * beside the page. Editing is the bar's button.
 */

/** A section's heading: what it is, how many (`count`, an expression), and — given `onClick` — the way to it alone. */
const heading = (
  label: SchemaNode['children'],
  icon: string | { $: string },
  count: string,
  onClick?: unknown,
): SchemaNode => {
  const row: SchemaNode = {
    type: 'Row',
    props: { gap: '200', ay: 'center' },
    children: [
      { type: 'we-icon', props: { name: icon, color: 'text-muted' } },
      { type: 'we-text', props: { variant: 'subheading', fontWeight: 'semibold' }, children: label },
      { type: 'we-text', props: { color: 'text-muted' }, children: [{ $: count }] },
    ],
  };
  return onClick
    ? { type: 'we-button', props: { variant: 'bare', alignSelf: 'start', onClick: onClick as never }, children: [row] }
    : row;
};

/** A grid of class tiles, each opening the class's page. */
const classTiles = (items: string): SchemaNode =>
  grid([
    {
      type: '$each',
      props: { items: { $: items }, as: 'cls' },
      children: [
        tile({
          lead: glyph({ $: 'cls.icon' }),
          title: { $: 'cls.label' },
          detail: detail({ $: 'cls.namespace ? cls.namespace : cls.id' }),
          onClick: dnaPage(`'${MODEL}|' + cls.id`),
        }),
      ],
    },
  ]);

/** A section of the whole page, shown while nothing in particular is in focus. */
const onAll = (children: SchemaNode[]): SchemaNode => ({
  type: '$if',
  props: {
    condition: { $: `${DNA_AT} == 'all'` },
    then: { type: 'Column', props: { gap: '600' }, children },
  },
});

/**
 * The classes of one group, a section, on the whole page: the group's own classes, then each nested
 * group (the built-in group's Blocks) as a section of its own, as the tree lists them. `items` lists
 * the group, or nothing.
 */
const classGroups = (items: string, empty?: string): SchemaNode =>
  onAll([
    {
      type: '$each',
      props: { items: { $: items }, as: 'group' },
      children: [
        {
          type: 'Column',
          props: { gap: '600' },
          children: [
            {
              type: 'Column',
              props: { gap: '300' },
              children: [
                heading([{ $: 'group.label' }], 'shapes', 'count(group.rows)'),
                empty
                  ? {
                      type: '$if',
                      props: {
                        condition: { $: 'count(group.rows) > 0' },
                        then: classTiles('group.rows'),
                        else: emptyNote(empty),
                      },
                    }
                  : classTiles('group.rows'),
              ],
            },
            {
              type: '$each',
              props: { items: { $: 'group.sub' }, as: 'sub' },
              children: [
                {
                  type: 'Column',
                  props: { gap: '300' },
                  children: [
                    heading([{ $: 'sub.label' }], 'squares-four', 'count(sub.classes)'),
                    classTiles('sub.classes'),
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ]);

/** The flows written here, each opening on the flows page, as its row in the tree does. */
const flowsSection: SchemaNode = onAll([
  {
    type: 'Column',
    props: { gap: '300' },
    children: [
      heading(['Flows'], 'flow-arrow', `count(${FLOW_DEFINITIONS})`),
      {
        type: '$if',
        props: {
          condition: { $: `count(${FLOW_DEFINITIONS}) > 0` },
          then: grid([
            {
              type: '$each',
              props: { items: { $: FLOW_DEFINITIONS }, as: 'workflow' },
              children: [
                tile({
                  lead: glyph('flow-arrow'),
                  title: { $: 'workflow.label' },
                  detail: detail({ $: "`${workflow.records} ${plural(workflow.records, 'record', 'records')}`" }),
                  onClick: [
                    { $invoke: 'workflowStore.openWorkflow', args: [{ $: 'workflow.name' }] },
                    { $invoke: 'navigation.navigate', args: [{ $: groupPath('workflows') }] },
                  ],
                }),
              ],
            },
          ]),
          else: emptyNote('No flows yet. Write one from the + beside Flows in the tree.'),
        },
      },
    ],
  },
]);

/**
 * The templates somebody would switch between here, as the tree lists them (`SPACE_TEMPLATE_CHOICES`):
 * the one worn outlined, the space's default starred, and choosing one wears it.
 */
const templatesSection: SchemaNode = onAll([
  {
    type: 'Column',
    props: { gap: '300' },
    children: [
      heading(['Templates'], 'layout', `count(${SPACE_TEMPLATE_CHOICES})`),
      grid([
        {
          type: '$each',
          props: { items: { $: SPACE_TEMPLATE_CHOICES }, as: 'template' },
          children: [
            tile({
              lead: glyph({ $: "template.icon ? template.icon : 'layout'" }),
              title: { $: 'template.name' },
              badge: {
                type: '$if',
                props: {
                  condition: { $: 'template.id == spaceSettings.spaceDefaultTemplateId' },
                  then: { type: 'we-icon', props: { name: 'star', weight: 'fill', color: 'warning-text' } },
                },
              },
              selected: 'template.id == appearance.currentSwitcherId',
              onClick: chooseTemplate('template.id'),
            }),
          ],
        },
      ]),
    ],
  },
]);

/**
 * The class in focus: its records, from the store's list where it keeps one and from a query of the
 * class otherwise (see `CLASS_ROWS`), each drawn as the class's display says and opened beside the page.
 */
const ROW_TITLE = `row[${CLASS_DISPLAY}.title] ?? row.name ?? row.id`;
const classPage: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: ON_CLASS },
    then: {
      type: 'Column',
      props: { gap: '300' },
      children: [
        heading([{ $: CLASS_LABEL }], { $: CLASS_ICON }, CLASS_ROWS_COUNT),
        {
          type: '$if',
          props: {
            condition: { $: `count(${CLASS_ROWS}) > 0` },
            then: grid([
              {
                type: '$each',
                props: { items: { $: CLASS_ROWS }, as: 'row' },
                children: [
                  tile({
                    lead: glyph({ $: `row.icon ? row.icon : ${CLASS_ICON}` }),
                    title: { $: ROW_TITLE },
                    detail: detail({ $: `row[${CLASS_DISPLAY}.summary] ?? row.description ?? ''` }),
                    selected: `${DNA_RECORD} == row.id`,
                    onClick: [dnaPage(`'${MODEL}|' + ${DNA_ID} + '|' + row.id`), ...inspect('row.id', { $: DNA_ID })],
                  }),
                ],
              },
            ]),
            else: {
              type: '$if',
              props: { condition: { $: CLASS_ROWS_LOADED }, then: emptyNote('Nothing of this kind here yet.') },
            },
          },
        },
      ],
    },
  },
};

/** The policy's rules, by their words — which is also what the vocabulary map knows them by. */
const policySection: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: `${DNA_AT} == 'all' || ${DNA_KIND} == 'policy'` },
    then: {
      type: 'Column',
      props: { gap: '300' },
      children: [
        heading([POLICY.label], POLICY.icon, `count(${POLICY_RULES})`, dnaPage("'policy'")),
        {
          type: '$if',
          props: {
            condition: { $: `count(${POLICY_RULES}) > 0` },
            then: grid([
              {
                type: '$each',
                props: { items: { $: POLICY_RULES }, as: 'rule' },
                children: [
                  tile({
                    lead: glyph(POLICY.icon),
                    title: { $: 'rule' },
                    titleLines: 2,
                    selected: `${DNA_KIND} == 'policy' && ${DNA_ID} == rule`,
                    onClick: dnaPage("'policy|' + rule"),
                  }),
                ],
              },
            ]),
            else: emptyNote("No rules yet. Add them in the space's settings."),
          },
        },
      ],
    },
  },
};

export const dnaRoute: RouteSchema = {
  path: '/dna',
  type: 'Column',
  props: { width: '100%', height: '100%' },
  // At the route, so the bar's crumbs can name the record chosen.
  $queries: CLASS_QUERIES,
  children: [
    viewBar(dnaCrumbs(), 'dna', [editDna]),
    {
      type: 'Column',
      props: { flex: '1', minHeight: '0', overflowY: 'auto', px: '500', py: '500', gap: '600' },
      children: [
        {
          type: '$if',
          props: {
            condition: { $: `${DNA_AT} == 'all' && ${CLASS_COUNT} == 0 && count(${POLICY_RULES}) == 0` },
            then: emptyNote(
              'This space has defined nothing about itself yet. Add models, task states and more in its settings.',
            ),
          },
        },
        classGroups(classGroup('models'), "No models yet. Add one in the space's settings."),
        flowsSection,
        templatesSection,
        classGroups(classGroup('we')),
        classPage,
        policySection,
      ],
    },
  ],
};
