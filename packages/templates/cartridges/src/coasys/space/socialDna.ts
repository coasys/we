import type { RouteSchema, SchemaNode, SchemaProp } from '@we/schema-shared';
import { emptyNote } from '@we/template-kit';

import { viewBar } from './bar.ts';
import {
  CLASS_COUNT,
  CLASS_GROUPS,
  CLASSES,
  DNA_AT,
  DNA_ID,
  DNA_KIND,
  DNA_LISTS,
  DNA_QUERIES,
  dnaCrumbs,
  type DnaList,
  editDna,
  POLICY,
  POLICY_RULES,
} from './dna.ts';
import { detail, glyph, grid, tile } from './groups.ts';
import { dnaEntityOf, dnaPage, inspect } from './paths.ts';

/**
 * Social DNA as a page — what the tree's Social DNA rows open in Page mode, as every other group row
 * opens its page. Canvas mode draws the same definitions as the vocabulary map, which shows how they
 * connect; this is the page for reading through them: a section of cards for each kind, each card
 * what a definition is called and what it is for.
 *
 * The focus in the address (`?dna=`) is the canvas's: a kind shows that kind's section alone, and a
 * definition is outlined in it and read in the inspector beside the page. It used to open the space's
 * settings instead — an edit surface off to the side, for somebody who only wanted to look; editing
 * is the bar's button now.
 */

/** A kind's section is on the page: everything that has some, or the kind in focus, even empty. */
const shows = (kind: string, items: string) =>
  `(${DNA_AT} == 'all' && count(${items}) > 0) || ${DNA_KIND} == '${kind}'`;

/** A section's heading: the kind, how many (`count`, an expression), and the way to it alone. */
const heading = (kind: string, label: string, icon: string, count: string): SchemaNode => ({
  type: 'we-button',
  props: { variant: 'bare', alignSelf: 'start', onClick: dnaPage(`'${kind}'`) },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: icon, color: 'text-muted' } },
        { type: 'we-text', props: { variant: 'subheading', fontWeight: 'semibold' }, children: [label] },
        { type: 'we-text', props: { color: 'text-muted' }, children: [{ $: count }] },
      ],
    },
  ],
});

const section = (opts: {
  kind: string;
  label: string;
  icon: string;
  items: string;
  as: string;
  card: SchemaNode;
}): SchemaNode => ({
  type: '$if',
  props: {
    condition: { $: shows(opts.kind, opts.items) },
    then: {
      type: 'Column',
      props: { gap: '300' },
      children: [
        heading(opts.kind, opts.label, opts.icon, `count(${opts.items})`),
        {
          type: '$if',
          props: {
            condition: { $: `count(${opts.items}) > 0` },
            then: grid([{ type: '$each', props: { items: { $: opts.items }, as: opts.as }, children: [opts.card] }]),
            else: emptyNote(`No ${opts.label.toLowerCase()} yet. Add them in the space's settings.`),
          },
        },
      ],
    },
  },
});

/** A definition, focused on this page and — unless it is a model, which the inspector does not read — opened beside it. */
const choose = (list: DnaList): SchemaProp => [
  dnaPage(`'${list.kind}|' + def.id`),
  ...(list.kind === 'model' ? [] : inspect('def.id', dnaEntityOf(`'${list.kind}'`))),
];

const kindSection = (list: DnaList): SchemaNode =>
  section({
    ...list,
    as: 'def',
    card: tile({
      lead: glyph({ $: list.itemIcon }),
      title: { $: 'def.name' },
      detail: detail({ $: "def.description ? def.description : ''" }),
      selected: `${DNA_KIND} == '${list.kind}' && ${DNA_ID} == def.id`,
      onClick: choose(list),
    }),
  });

/** The policy's rules, by their words — which is also what the vocabulary map knows them by. */
const policySection: SchemaNode = section({
  ...POLICY,
  items: POLICY_RULES,
  as: 'rule',
  card: tile({
    lead: glyph(POLICY.icon),
    title: { $: 'rule' },
    titleLines: 2,
    selected: `${DNA_KIND} == 'policy' && ${DNA_ID} == rule`,
    onClick: dnaPage("'policy|' + rule"),
  }),
});

/*
  Every class the space has, by where it comes from — the space's own models, each other app's
  namespace, WE's built-ins — first on the page, as the tree lists them by default. A class opens its
  records (`class|<name>`), drawn as the model asks to be shown (`recordStore.displays`), which every
  listed class has, whoever wrote it.
*/

const classesSection: SchemaNode = {
  type: '$if',
  props: {
    // On the whole page while there are any, and alone where the address names the classes.
    condition: { $: `(${DNA_AT} == 'all' && ${CLASS_COUNT} > 0) || ${DNA_AT} == '${CLASSES.kind}'` },
    then: {
      type: 'Column',
      props: { gap: '400' },
      children: [
        heading(CLASSES.kind, CLASSES.label, CLASSES.icon, CLASS_COUNT),
        {
          type: '$each',
          props: { items: { $: CLASS_GROUPS }, as: 'origin' },
          children: [
            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                {
                  type: 'we-text',
                  props: { variant: 'overline', color: 'text-muted' },
                  children: [{ $: 'origin.label' }],
                },
                grid([
                  {
                    type: '$each',
                    props: { items: { $: 'origin.classes' }, as: 'cls' },
                    children: [
                      tile({
                        lead: glyph({ $: 'cls.icon' }),
                        title: { $: 'cls.label' },
                        detail: detail({ $: "cls.hinted ? 'Says how to read it' : cls.name" }),
                        onClick: dnaPage(`'${CLASSES.kind}|' + cls.name`),
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

/** The records of the class in focus, each opened beside the page. */
const CLASS_IN_FOCUS = `${DNA_KIND} == '${CLASSES.kind}' && ${DNA_ID}`;
const CLASS_DISPLAY = `recordStore.displays[${DNA_ID}]`;
const classRecords: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: CLASS_IN_FOCUS },
    then: {
      type: 'Column',
      props: { gap: '300' },
      $queries: {
        classRows: {
          entity: { $: DNA_ID },
          order: { createdAt: 'desc' },
          limit: 100,
          when: { $: CLASS_IN_FOCUS },
        },
      },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: { $: `${CLASS_DISPLAY}.icon ?? 'cube'` }, color: 'text-muted' } },
            {
              type: 'we-text',
              props: { variant: 'subheading', fontWeight: 'semibold' },
              children: [{ $: `${CLASS_DISPLAY}.label ?? ${DNA_ID}` }],
            },
            { type: 'we-text', props: { color: 'text-muted' }, children: [{ $: 'count(local.classRows)' }] },
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $: 'count(local.classRows) > 0' },
            then: grid([
              {
                type: '$each',
                props: { items: { $: 'local.classRows' }, as: 'row' },
                children: [
                  tile({
                    lead: glyph({ $: `${CLASS_DISPLAY}.icon ?? 'cube'` }),
                    title: { $: `row[${CLASS_DISPLAY}.title] ?? row.id` },
                    detail: detail({ $: `row[${CLASS_DISPLAY}.summary] ?? ''` }),
                    onClick: inspect('row.id', { $: DNA_ID }),
                  }),
                ],
              },
            ]),
            else: {
              type: '$if',
              props: { condition: { $: 'local.classRowsLoaded' }, then: emptyNote('Nothing of this kind here yet.') },
            },
          },
        },
      ],
    },
  },
};

/** Nothing defined at all, which only a space made empty starts as. */
const NOTHING = [...DNA_LISTS.map((list) => list.items), POLICY_RULES]
  .map((items) => `count(${items}) == 0`)
  .join(' && ');

export const dnaRoute: RouteSchema = {
  path: '/dna',
  type: 'Column',
  props: { width: '100%', height: '100%' },
  $queries: DNA_QUERIES,
  children: [
    viewBar(dnaCrumbs(), 'dna', [editDna]),
    {
      type: 'Column',
      props: { flex: '1', minHeight: '0', overflowY: 'auto', px: '500', py: '500', gap: '600' },
      children: [
        {
          type: '$if',
          props: {
            condition: { $: `${DNA_AT} == 'all' && ${NOTHING} && ${CLASS_COUNT} == 0` },
            then: emptyNote(
              'This space has defined nothing about itself yet. Add signal types, task states and more in its settings.',
            ),
          },
        },
        classesSection,
        classRecords,
        ...DNA_LISTS.map(kindSection),
        policySection,
      ],
    },
  ],
};
