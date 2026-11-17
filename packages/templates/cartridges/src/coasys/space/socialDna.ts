import type { RouteSchema, SchemaNode } from '@we/schema-shared';
import { emptyNote } from '@we/template-kit';

import { viewBar } from './bar.ts';
import {
  CLASS_COUNT,
  CLASS_DISPLAY,
  CLASS_GROUPS,
  CLASS_ICON,
  CLASS_LABEL,
  CLASS_QUERIES,
  CLASS_ROWS,
  CLASS_ROWS_LOADED,
  DNA_AT,
  DNA_ID,
  DNA_KIND,
  DNA_RECORD,
  dnaCrumbs,
  editDna,
  MODEL,
  ON_CLASS,
  POLICY,
  POLICY_RULES,
} from './dna.ts';
import { detail, glyph, grid, tile } from './groups.ts';
import { dnaPage, inspect } from './paths.ts';

/**
 * Social DNA as a page — what the tree's Social DNA rows open in Page mode, as every other group row
 * opens its page. Canvas mode draws the same classes as the vocabulary map, which shows how they
 * connect; this is the page for reading through them.
 *
 * All of it is the classes the space has, in the tree's three groups — its own, other apps', WE's —
 * and the policy. A class (`?dna=model|<name>`) is its records, drawn as its display says, whoever
 * wrote the class; one of them chosen is outlined and read in the inspector beside the page. Editing
 * is the bar's button.
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

/** The classes, a section a group, on the whole page. */
const classGroups: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: `${DNA_AT} == 'all'` },
    then: {
      type: 'Column',
      props: { gap: '600' },
      children: [
        {
          type: '$each',
          props: { items: { $: CLASS_GROUPS }, as: 'group' },
          children: [
            {
              type: 'Column',
              props: { gap: '300' },
              children: [
                heading([{ $: 'group.label' }], 'shapes', 'count(group.classes)'),
                grid([
                  {
                    type: '$each',
                    props: { items: { $: 'group.classes' }, as: 'cls' },
                    children: [
                      tile({
                        lead: glyph({ $: 'cls.icon' }),
                        title: { $: 'cls.label' },
                        detail: detail({ $: 'cls.namespace ? cls.namespace : cls.id' }),
                        onClick: dnaPage(`'${MODEL}|' + cls.id`),
                      }),
                    ],
                  },
                ]),
              ],
            },
          ],
        },
      ],
    },
  },
};

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
        heading([{ $: CLASS_LABEL }], { $: CLASS_ICON }, `count(${CLASS_ROWS})`),
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
        classGroups,
        classPage,
        policySection,
      ],
    },
  ],
};
