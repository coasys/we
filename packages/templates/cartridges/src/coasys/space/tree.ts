import type { SchemaNode, SchemaProp } from '@we/schema-shared';
import {
  type Choice,
  chooseTemplate,
  chooseTheme,
  field,
  formModal,
  MEMBERS,
  peopleTooltip,
  SPACE_TEMPLATE_CHOICES,
  SPACE_THEME_CHOICES,
  templateChoice,
  themeChoice,
  TREE_LEAD,
  treeRow,
} from '@we/template-kit';

import { CLASS_COUNT, classGroup, FLOW_DEFINITIONS, MODEL, POLICY, POLICY_RULES } from './dna.ts';
import { countPill, liveDot } from './marks.ts';
import {
  callPath,
  channelPath,
  DNA_AT,
  DNA_PARAM,
  DNA_SHOWN,
  GROUP_PAGES,
  PAGE_EXPR,
  personPath,
  ROW_ID,
  SELECTED_EXPR,
  showDna,
  withView,
} from './paths.ts';

/**
 * The space as a tree: its Feed, its calls, its running flows, its people, its Social DNA and its
 * themes, under the space's name and what it is for. Nico's d12 inner sidebar, built on `we-tree`.
 *
 * Each group is a query, not a list somebody keeps: a call held, a workflow written, a member joining
 * — each appears here because it exists. Choosing a row navigates; the view beside the tree draws
 * whatever was chosen. What is selected comes from the address, so arriving by a link lights the same
 * row a click would.
 *
 * The Feed is the space collection, the root channel. Sub-channels (`CollectionBlock`s of kind
 * `channel` under it) are not listed while a space is one integrated conversation; a sub-channel that
 * exists still opens by its address. Chat lines are never rows: the Feed is opened to read them.
 */

/**
 * How far the lane's blocks sit in from its edges — the header, the purpose prompt, the search and
 * the running call — so they line up with each other. The tree's own list sits closer to the edge
 * (`px: '200'`): its rows draw their own padding, and a lit row's background reaches nearer the edge
 * than the words above it.
 */
const INSET = '300';

/** Open groups and channels, by row value. Kept on this device, not in the address. */
const OPEN = 'local.openRows';
const isOpen = (value: string): SchemaProp => ({ $: `'${value}' in ${OPEN}` });
const toggle = (value: SchemaProp): SchemaProp => ({ $toggleLocalIn: 'openRows', value });

/**
 * A row open while its own key is saved open, or while one of `within` holds — something chosen
 * inside it. So a flow opened from the flows page is seen lit rather than chosen inside a closed row.
 *
 * Closing it forgets its key, and does each `up` whose `when` holds — moving the choice up to the row,
 * as `revealing` does — so it closes when asked. `press` is the flip a press on the row's label runs
 * (`onSelect`): it asks only what is saved, so pressing a row that is open because of what is chosen
 * keeps it open and saves it.
 */
const holding = (value: string, within: { when: string; up: SchemaProp }[]) => {
  const saved = `'${value}' in ${OPEN}`;
  const isOpenNow = [saved, ...within.map((w) => `(${w.when})`)].join(' || ');
  const open = { $if: { condition: { $: `!(${saved})` }, then: toggle(value) } };
  const close = [
    { $setLocal: 'openRows', value: { $: `${OPEN}.filter(k, k != '${value}')` } },
    ...within.map((w) => ({ $if: { condition: { $: w.when }, then: w.up } })),
  ];
  return {
    open: { $: isOpenNow },
    onOpenChange: { $if: { condition: { $: 'event.detail.open' }, then: open, else: close } },
    press: { $if: { condition: { $: saved }, then: close, else: open } } as SchemaProp,
  };
};

/**
 * A group: one of the space's kinds of thing, with its glyph, opened or closed by a press anywhere on
 * its row as by its caret. Most groups' rows open a page of what the group lists as well (see
 * `onSelect`).
 *
 * `count` is how many rows it holds, as an expression. Every group says it at the end of its row, and
 * only a group with something in it has a caret and opens: an empty one has nothing to show, and a
 * caret on it promised rows that were not there — `expandable` says otherwise where the count is not
 * of rows (running flows are counted and not listed). `tone` colours the count — Calls goes green
 * while one is running. `action` is a control beside the count, the + that makes one more. `nested`
 * draws it as a row inside another group, and `kind` is its value's prefix (`group|<key>`).
 */
const group = (
  key: string,
  label: string,
  icon: string,
  children: SchemaNode[],
  opts: {
    count: string;
    tone?: SchemaProp;
    action?: SchemaNode;
    openness?: { open: SchemaProp; onOpenChange: SchemaProp };
    expandable?: SchemaProp;
    nested?: boolean;
    kind?: string;
  },
): SchemaNode =>
  treeRow({
    ...(opts.nested ? { nested: true } : {}),
    value: `${opts.kind ?? 'group'}|${key}`,
    label,
    icon,
    ...(opts.openness ?? {
      open: isOpen(`${opts.kind ?? 'group'}|${key}`),
      onOpenChange: toggle(`${opts.kind ?? 'group'}|${key}`),
    }),
    expandable: opts.expandable ?? { $: `${opts.count} > 0` },
    badge: {
      type: 'Row',
      props: { gap: '100', ay: 'center' },
      children: [countPill(opts.count, opts.tone), ...(opts.action ? [opts.action] : [])],
    },
    children,
  });

/** A small + at the end of a group's row, for making one more of what it holds. */
const addButton = (label: string, onClick: SchemaProp): SchemaNode => ({
  type: 'we-tooltip',
  props: { content: label, placement: 'right' },
  children: [
    {
      type: 'we-button',
      props: { variant: 'ghost', size: 'xs', square: true, label, onClick },
      children: [{ type: 'we-icon', props: { name: 'plus' } }],
    },
  ],
});

/**
 * The Feed: the space's own conversation, every call and message and what was found in them, in one
 * stream — the root channel, drawn by the Feed module. One row rather than a group of channels: a
 * space starts as one integrated conversation, and channels of its own come later, each a whole
 * space in miniature. Nothing here makes one yet.
 */
const feedRow = treeRow({ value: { $: "'channel|' + spaceStore.root" }, label: 'Feed', icon: 'chats-circle' });

/** A call still running carries a Live tag, so the way back into it is on the row. */
export const LIVE = 'find(modules.call.liveCalls, { recordId: call.id })';

/**
 * Who is in a running call, on its row: their faces, overlapped, and on hover everyone in it, one
 * per line with a picture and a name. Shown whether or not this agent is in the call — it is the
 * row's answer to "who is there", which matters most before joining.
 */
const callPeople: SchemaNode = peopleTooltip({
  items: { $: `${LIVE}.faces` },
  as: 'person',
  image: { $: 'person.image' },
  hash: { $: 'person.hash' },
  // `initials` carries the profile's name: the stack draws initials from it.
  name: { $: 'person.initials' },
  placement: 'right',
  children: [
    {
      type: 'AvatarStack',
      props: { avatars: { $: `${LIVE}.faces.map(f, { image: f.image, hash: f.hash })` }, max: 3, size: 'xs' },
    },
  ],
});

const calls = group(
  'calls',
  'Calls',
  'phone',
  [
    {
      type: '$each',
      props: { items: { $: 'local.calls' }, as: 'call' },
      children: [
        treeRow({
          nested: true,
          value: { $: "'call|' + call.id" },
          label: { $: "call.title ? call.title : 'Call'" },
          icon: { $: `${LIVE} ? 'phone-call' : 'phone'` },
          badge: {
            type: '$if',
            props: {
              condition: { $: LIVE },
              then: {
                type: 'Row',
                props: { gap: '100', ay: 'center' },
                children: [
                  callPeople,
                  { type: 'we-badge', props: { tone: 'success', size: 'xs' }, children: [liveDot, 'Live'] },
                ],
              },
              else: {
                type: 'we-timestamp',
                props: {
                  value: { $: 'call.createdAt' },
                  relative: true,
                  relativeStyle: 'narrow',
                  color: 'text-faint',
                  fontSize: '100',
                },
              },
            },
          },
        }),
      ],
    },
  ],
  { count: 'count(local.calls)', tone: { $: "count(modules.call.liveCalls) ? 'success' : ''" } },
);

const FLOWS_PAGE = "spaceStore.spacePath + '/workflows'";

/** A flow is chosen on the flows page — its row, under Social DNA's Flows, is the one lit. */
const FLOW_CHOSEN = `(${PAGE_EXPR}) == 'workflows' && workflowStore.open`;
const flowChosen = { when: FLOW_CHOSEN, up: { $invoke: 'workflowStore.closeWorkflow' } as SchemaProp };

/** Social DNA's Flows: open while saved open, or while a flow is chosen. */
const FLOWS_HELD = holding('dnagroup|flows', [flowChosen]);

/** A running record's row, as `run|<workflow>|<record>`. */
const RUN_WORKFLOW = "split(event.detail.value, '|')[1]";
const RUN_RECORD = "split(event.detail.value, '|')[2]";

/**
 * Active flows: what is going on in the space — every record still going through one of its flows,
 * the one with the latest activity first, named by what it is and marked with the step it is at. A
 * record in two flows is two rows. Its row opens the flows page (`group|workflows`); a record's row
 * opens its flow there with the record chosen. What a flow *is* is listed under Social DNA.
 */
const activeFlows = group(
  'workflows',
  'Active flows',
  'flow-arrow',
  [
    {
      type: '$each',
      props: { items: { $: 'workflowStore.active' }, as: 'run' },
      children: [
        treeRow({
          nested: true,
          value: { $: "'run|' + run.workflow + '|' + run.record" },
          label: { $: 'run.title' },
          icon: { $: "run.stalled ? 'warning' : run.waiting ? 'hourglass-medium' : 'flow-arrow'" },
          badge: {
            type: 'we-text',
            props: { variant: 'footnote', color: 'text-faint', truncate: true, maxWidth: '96px' },
            children: [{ $: 'run.stateLabel' }],
          },
        }),
      ],
    },
  ],
  { count: 'count(workflowStore.active)' },
);

/** The flows written for this space, under Social DNA: a row each, opening it, and the + that writes another. */
const flowDefinitions = group(
  'flows',
  'Flows',
  'flow-arrow',
  [
    {
      type: '$each',
      props: { items: { $: FLOW_DEFINITIONS }, as: 'workflow' },
      children: [
        treeRow({
          nested: true,
          value: { $: "'workflow|' + workflow.name" },
          label: { $: 'workflow.label' },
          icon: 'flow-arrow',
        }),
      ],
    },
  ],
  {
    kind: 'dnagroup',
    nested: true,
    openness: FLOWS_HELD,
    count: `count(${FLOW_DEFINITIONS})`,
    action: addButton('New flow', { $invoke: 'routeStore.navigate', args: [{ $: `${FLOWS_PAGE} + '?new=1'` }] }),
  },
);

const people = group(
  'people',
  'People',
  'users',
  [
    {
      type: '$each',
      props: { items: { $: MEMBERS }, as: 'person' },
      children: [
        treeRow({
          nested: true,
          value: { $: "'person|' + person.did" },
          label: { $: 'person.name' },
          avatar: { src: { $: 'person.avatar' }, name: { $: 'person.name' }, hash: { $: 'person.did' } },
        }),
      ],
    },
  ],
  { count: `count(${MEMBERS})` },
);

/*
  Social DNA: what the space has defined about itself — its Models (its own and other apps' classes),
  its Flows, its Templates, WE's built-in classes and its policy. Four levels — the group, each group
  in it, each class or flow or template, and for the policy each rule — so the tree is the space's own
  graph read as an outline, the same classes the canvas draws.

  Values are `dnagroup|<group>` for a group of classes (`models`, `we`, `we.blocks`) and for the flows
  (`dnagroup|flows`), `dna|model|<name>` for a class — any class, whoever wrote it — and
  `dnaprop|policy|<rule>` for one rule of the policy. Templates keeps `group|templates`. A class is a
  leaf: its records are on its page (or on the vocabulary map, in Canvas mode), never rows under it
  here, since a class can hold thousands.
*/

/**
 * A Social DNA row, open while what is in focus is inside it — so a definition chosen on the vocabulary
 * map is shown lit in the tree, not lit inside a row that is closed. `inside` is that condition, and
 * `up` the focus that is not inside it: closing the row moves the focus up to the row itself, rather
 * than leaving a row that will not close.
 */
const revealing = (value: string, inside: string, up: string) => {
  const within = `(${DNA_SHOWN}) && (${inside})`;
  const toggle = { $toggleLocalIn: 'openRows', value: { $: value } };
  return {
    open: { $: `((${value}) in ${OPEN}) || (${within})` },
    onOpenChange: {
      $if: {
        condition: { $: `!event.detail.open && (${within})` },
        then: [
          { $invoke: 'routeStore.setParam', args: [DNA_PARAM, { $: up }] },
          { $if: { condition: { $: `(${value}) in ${OPEN}` }, then: toggle } },
        ],
        else: toggle,
      },
    },
  };
};

/** Another app's class says its namespace after its name, quietly — the first to carry that name; one name is one row. */
const namespace: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'cls.namespace' },
    then: {
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-faint', truncate: true, maxWidth: '96px' },
      children: [{ $: 'cls.namespace' }],
    },
  },
};

/** A class: a leaf, opening its page. */
const classRows = (items: string): SchemaNode => ({
  type: '$each',
  props: { items: { $: items }, as: 'cls' },
  children: [
    treeRow({
      nested: true,
      value: { $: `'dna|${MODEL}|' + cls.id` },
      label: { $: 'cls.label' },
      icon: { $: 'cls.icon' },
      badge: namespace,
    }),
  ],
});

/** Some class in `classes` is in focus — what keeps a row around it open. */
const holdsFocus = (classes: string) =>
  `startsWith(${DNA_AT}, '${MODEL}|') && ${classes}.exists(c, c.id == split(${DNA_AT}, '|')[1])`;

/**
 * A group of classes, open while a class in it is in focus: its own classes a row each, then its
 * nested groups (the built-in group's Blocks), each a row holding its classes. `items` lists the group,
 * or nothing where it has nothing to list.
 */
const classGroupRows = (items: string): SchemaNode => ({
  type: '$each',
  props: { items: { $: items }, as: 'group' },
  children: [
    treeRow({
      nested: true,
      value: { $: "'dnagroup|' + group.key" },
      label: { $: 'group.label' },
      icon: { $: "group.key == 'we' ? 'cube' : 'shapes'" },
      ...revealing("'dnagroup|' + group.key", holdsFocus('group.classes'), "'all'"),
      expandable: { $: 'count(group.classes) > 0' },
      badge: countPill('count(group.classes)'),
      children: [
        classRows('group.rows'),
        {
          type: '$each',
          props: { items: { $: 'group.sub' }, as: 'sub' },
          children: [
            treeRow({
              nested: true,
              value: { $: "'dnagroup|' + group.key + '.' + sub.key" },
              label: { $: 'sub.label' },
              icon: 'squares-four',
              ...revealing("'dnagroup|' + group.key + '.' + sub.key", holdsFocus('sub.classes'), "'all'"),
              expandable: { $: 'count(sub.classes) > 0' },
              badge: countPill('count(sub.classes)'),
              children: [classRows('sub.classes')],
            }),
          ],
        },
      ],
    }),
  ],
});

/** The space's policy: who may do what, one rule a row, as the people settings word them. */
const policyKind: SchemaNode = treeRow({
  nested: true,
  value: { $: "'dnakind|policy'" },
  label: POLICY.label,
  icon: POLICY.icon,
  ...revealing("'dnakind|policy'", `startsWith(${DNA_AT}, 'policy|')`, "'policy'"),
  expandable: { $: `count(${POLICY_RULES}) > 0` },
  badge: countPill(`count(${POLICY_RULES})`),
  children: [
    {
      type: '$each',
      props: { items: { $: POLICY_RULES }, as: 'rule' },
      // By its words, which are also what the vocabulary map knows it by.
      children: [treeRow({ nested: true, value: { $: "'dnaprop|policy|' + rule" }, label: { $: 'rule' } })],
    },
  ],
});

/*
  How the space looks: the templates and the themes somebody would switch between here, each with the
  star on the space's default and the things the rail's pickers offer — reset the layout (on the one
  in use, once it has been moved), edit, fork. What a row *is* is the template kit's
  (\`templateChoice\`, \`themeChoice\`), shared with those pickers; this only draws it as a tree row. The
  one in use is ticked, since the tree's own selection follows the address.
*/

/** A template or theme as a row of the tree, by what the kit says the row is. */
const choiceRow = (kind: 'template' | 'theme', choice: Choice): SchemaNode =>
  treeRow({
    nested: true,
    value: { $: `'${kind}|' + ${kind}.id` },
    label: choice.label,
    icon: choice.icon,
    isDefault: choice.isDefault,
    actions: choice.actions,
    badge: {
      type: '$if',
      props: { condition: choice.selected, then: { type: 'we-icon', props: { name: 'check', color: 'accent-text' } } },
    },
  });

/** The + beside a group's count: make another. */
const newButton = (tooltip: string, onClick: SchemaProp): SchemaNode => ({
  type: 'we-tooltip',
  props: { content: tooltip, placement: 'top' },
  children: [
    {
      type: 'we-button',
      props: { size: 'xs', variant: 'ghost', square: true, label: tooltip, onClick },
      children: [{ type: 'we-icon', props: { name: 'plus' } }],
    },
  ],
});

const templatesGroup = group(
  'templates',
  'Templates',
  'layout',
  [
    {
      type: '$each',
      props: { items: { $: SPACE_TEMPLATE_CHOICES }, as: 'template' },
      children: [choiceRow('template', templateChoice())],
    },
  ],
  {
    nested: true,
    count: `count(${SPACE_TEMPLATE_CHOICES})`,
    action: newButton('New template', { $invoke: 'editorStore.startFresh' }),
  },
);

const themesGroup = group(
  'themes',
  'Themes',
  'palette',
  [
    {
      type: '$each',
      props: { items: { $: SPACE_THEME_CHOICES }, as: 'theme' },
      children: [choiceRow('theme', themeChoice())],
    },
  ],
  {
    count: `count(${SPACE_THEME_CHOICES})`,
    action: newButton('New theme', { $invoke: 'themeStore.startThemeFork' }),
  },
);

/**
 * Social DNA is open while saved open, or while something in it is in focus or chosen — a definition
 * on the vocabulary map, a flow on the flows page. Closing it then shows all of it.
 */
const SOCIAL_DNA_HELD = holding('group|dna', [
  {
    when: `(${DNA_SHOWN}) && ${DNA_AT} != 'all'`,
    up: { $invoke: 'routeStore.setParam', args: [DNA_PARAM, 'all'] },
  },
  flowChosen,
]);

/**
 * Everything the space has defined about itself — see above: Models, Flows, Templates, then WE's
 * built-in classes and the policy. It always holds something (Models, Flows and Templates are listed
 * empty), so it always opens; its count is of its classes.
 */
const socialDna = group(
  'dna',
  'Social DNA',
  'dna',
  [classGroupRows(classGroup('models')), flowDefinitions, templatesGroup, classGroupRows(classGroup('we')), policyKind],
  {
    count: CLASS_COUNT,
    expandable: true,
    openness: SOCIAL_DNA_HELD,
  },
);

/** A class row's kind and name — `dna|model|<name>`. */
const DEF_KIND = "split(event.detail.value, '|')[1]";
const DEF_ID = "split(event.detail.value, '|')[2]";

/**
 * What choosing a row does, by the kind its value names.
 *
 * Every row is a place. A group's row opens its page — Channels, Calls, Flows and People are full
 * views of what the group lists — and opens or closes the group, as its caret does. Opening on a press
 * but closing only on the caret read as two rules for one row, so a press folds as well. Social DNA's
 * page is the vocabulary map (`showDna`).
 */
const onSelect: SchemaProp = [
  {
    $if: {
      // Social DNA opens and closes as `holding` says.
      condition: { $: "startsWith(event.detail.value, 'group|') && event.detail.value != 'group|dna'" },
      then: { $toggleLocalIn: 'openRows', value: { $: 'event.detail.value' } },
    },
  },
  {
    $if: {
      condition: {
        $: `event.detail.value in [${GROUP_PAGES.filter((p) => p !== 'workflows')
          .map((p) => `'group|${p}'`)
          .join(', ')}]`,
      },
      then: { $invoke: 'routeStore.navigate', args: [{ $: withView(`spaceStore.spacePath + '/' + ${ROW_ID}`) }] },
    },
  },
  // The flows page shows every flow until one is chosen, so choosing the group closes the one open.
  {
    $if: {
      condition: { $: "event.detail.value == 'group|workflows'" },
      then: [
        { $invoke: 'workflowStore.closeWorkflow' },
        { $invoke: 'routeStore.navigate', args: [{ $: withView(FLOWS_PAGE) }] },
      ],
    },
  },
  // Social DNA is the vocabulary map: over the canvas in Canvas mode, its own page in Page mode.
  {
    $if: {
      condition: { $: "event.detail.value == 'group|dna'" },
      then: [SOCIAL_DNA_HELD.press, showDna("'all'")],
    },
  },
  {
    $if: {
      condition: { $: "startsWith(event.detail.value, 'channel|')" },
      then: { $invoke: 'routeStore.navigate', args: [{ $: channelPath(ROW_ID) }] },
    },
  },
  {
    $if: {
      condition: { $: "startsWith(event.detail.value, 'call|')" },
      then: { $invoke: 'routeStore.navigate', args: [{ $: callPath(ROW_ID) }] },
    },
  },
  {
    $if: {
      condition: { $: "startsWith(event.detail.value, 'workflow|')" },
      then: [
        { $invoke: 'workflowStore.openWorkflow', args: [{ $: ROW_ID }] },
        { $invoke: 'routeStore.navigate', args: [{ $: withView(FLOWS_PAGE) }] },
      ],
    },
  },
  /*
    A running record opens its flow on the flows page, with the record chosen there. The id goes in
    `query`, never pasted after a `?`: an interpreted record's id carries its source already encoded
    (`we://interpreted/ad4m%3A%2F%2Fobj…`), and pasted raw it was decoded on the way back, so the `card`
    read back was not the record's id and neither its row here nor its card on the page was lit.
  */
  {
    $if: {
      condition: { $: "startsWith(event.detail.value, 'run|')" },
      then: [
        { $invoke: 'workflowStore.openWorkflow', args: [{ $: RUN_WORKFLOW }] },
        {
          $invoke: 'routeStore.navigate',
          args: [{ $: withView(FLOWS_PAGE) }, { $: `{ query: { card: ${RUN_RECORD} } }` }],
        },
      ],
    },
  },
  {
    $if: {
      condition: { $: "startsWith(event.detail.value, 'person|')" },
      then: { $invoke: 'routeStore.navigate', args: [{ $: personPath(ROW_ID) }] },
    },
  },
  /*
    A class is lit on the vocabulary map in Canvas mode and is its page in Page mode, where its records
    are. A group of classes opens as a group does.
  */
  {
    $if: {
      condition: { $: "startsWith(event.detail.value, 'dna|')" },
      then: showDna(`${DEF_KIND} + '|' + ${DEF_ID}`),
    },
  },
  {
    $if: {
      condition: { $: "startsWith(event.detail.value, 'dnagroup|') && event.detail.value != 'dnagroup|flows'" },
      then: { $toggleLocalIn: 'openRows', value: { $: 'event.detail.value' } },
    },
  },
  { $if: { condition: { $: "event.detail.value == 'dnagroup|flows'" }, then: FLOWS_HELD.press } },
  // A kind of definition opens as a group does, and is lit on the map with all it holds.
  {
    $if: {
      condition: { $: "startsWith(event.detail.value, 'dnakind|')" },
      then: [{ $toggleLocalIn: 'openRows', value: { $: 'event.detail.value' } }, showDna(ROW_ID)],
    },
  },
  // A template or a theme is worn by choosing it, as in the rail's pickers.
  {
    $if: {
      condition: { $: "startsWith(event.detail.value, 'template|')" },
      then: chooseTemplate(ROW_ID),
    },
  },
  {
    $if: {
      condition: { $: "startsWith(event.detail.value, 'theme|')" },
      then: chooseTheme(ROW_ID),
    },
  },
  // One rule of the policy, lit on the map by its words.
  {
    $if: {
      condition: { $: "startsWith(event.detail.value, 'dnaprop|policy|')" },
      then: showDna("'policy|' + split(event.detail.value, '|')[2]"),
    },
  },
];

/**
 * The space's face, its name and what it is for, the way to its settings, and the way to fold the
 * tree away. d12's header: a rounded-square avatar — the space's, where other avatars are people's
 * circles — with the name beside it and the description under the name.
 */
const header: SchemaNode = {
  type: 'Row',
  // Wraps: in a narrow sidebar the two buttons drop under the name rather than leaving it a letter.
  props: { gap: '300', ay: 'center', wrap: true, px: INSET, pt: '400', pb: '300' },
  children: [
    {
      type: 'we-avatar',
      props: {
        // Large enough to stand beside the name and two lines of what the space is for.
        size: 'xl',
        r: '600',
        image: { $: 'spaceStore.currentSpace.avatar' },
        initials: { $: 'spaceStore.currentSpace.name' },
        hash: { $: 'spaceStore.currentSpace.uuid' },
      },
    },
    {
      type: 'Column',
      props: { flex: '1', minWidth: '5rem' },
      children: [
        {
          type: 'we-text',
          props: { variant: 'subheading', fontWeight: 'semibold', truncate: true },
          children: [{ $: 'spaceStore.currentSpace.name' }],
        },
        {
          type: '$if',
          props: {
            condition: { $: 'spaceStore.currentSpace.description' },
            then: {
              type: 'we-text',
              props: { variant: 'footnote', fontSize: '200', color: 'text-muted', lines: 2 },
              children: [{ $: 'spaceStore.currentSpace.description' }],
            },
          },
        },
      ],
    },
    {
      type: 'we-tooltip',
      props: { content: 'Space settings', placement: 'bottom' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'md',
            square: true,
            label: 'Space settings',
            onClick: { $invoke: 'shellStore.toggleSpaceSettings' },
          },
          children: [{ type: 'we-icon', props: { name: 'gear-six' } }],
        },
      ],
    },
    {
      type: 'we-tooltip',
      props: { content: 'Hide the sidebar', placement: 'bottom' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'md',
            square: true,
            label: 'Hide the sidebar',
            onClick: { $invoke: 'shellStore.setLaneCollapsed', args: ['tree', true] },
          },
          children: [{ type: 'we-icon', props: { name: 'sidebar-simple' } }],
        },
      ],
    },
  ],
};

/**
 * The way to say what the space is for, while nobody has: d12's dashed box, not yet written and a
 * press away from being. Once there is a description the header carries it.
 */
const purpose: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: '!spaceStore.currentSpace.description && spaceStore.canAdministerCurrentSpace' },
    then: {
      type: 'Column',
      props: { px: INSET, pb: '300' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'bare',
            ax: 'start',
            width: '100%',
            p: '300',
            r: 'surface',
            border: '1px dashed border-strong',
            onClick: { $invoke: 'shellStore.openSpaceSettings', args: ['about'] },
          },
          children: [
            {
              type: 'we-text',
              props: { variant: 'overline', color: 'accent-text' },
              children: ['What is this space for?'],
            },
          ],
        },
      ],
    },
  },
};

/**
 * d12's "Find or ask": one field for finding something in the space and asking the space's assistant.
 *
 * Typing only holds the draft on `local.findQuery` — nothing searches as it is typed.
 * Enter asks: the question opens a chat scoped to this one dataset, a window over the space
 * (a sheet on a phone) whose tools may not reach any other.
 */
const findOrAsk: SchemaNode = {
  type: 'Column',
  props: { px: INSET, pb: '500' },
  $localState: { findQuery: { type: 'string', initial: '' } },
  children: [
    {
      type: 'we-input',
      props: {
        placeholder: 'Find or ask',
        value: { $: 'local.findQuery' },
        onInput: { $setLocal: 'findQuery', value: { $: 'event.detail' } },
        onKeyDown: {
          $if: {
            // `isComposing` rides the detail now (we-input forwards it): an Enter still in an IME
            // composition is the IME's, not an ask.
            condition: { $: "event.detail.key == 'Enter' && !event.detail.isComposing && trim(local.findQuery)" },
            then: [
              {
                $invoke: 'chatStore.openChat',
                args: [
                  {
                    $: `{ datasetId: datasetStore.currentDataset.id, spaceName: spaceStore.currentSpace.name, draft: local.findQuery }`,
                  },
                ],
              },
              { $setLocal: 'findQuery', value: '' },
            ],
          },
        },
      },
      children: [
        { type: 'we-icon', slot: 'start', props: { name: 'magnifying-glass', color: 'text-muted', mr: '200' } },
      ],
    },
  ],
};

/**
 * Start a call here. Shown only while no call is running, so this is only ever a new call.
 *
 * `startCall`, not `goToCall`: with nothing running, `goToCall` continues the call the address
 * names, and on this space the address names one long after it ended. Joining a call puts it in
 * `?call=`, nothing takes it out, and the router gives a page back its last query string. So a
 * Calls list where a call was once started kept naming that call, and Start a call there rejoined
 * the first call the space ever had. Picking a past call back up is its page's own button.
 */
const callButton: SchemaNode = {
  type: '$if',
  props: {
    // Only while there is no call here: once there is, its row under Calls, tagged Live, is the way in.
    condition: { $: 'modules.call.canCall && !count(modules.call.liveCalls)' },
    then: {
      type: 'Column',
      props: { p: '300', ax: 'start' },
      children: [
        {
          type: 'we-button',
          // Solid, in the accent: starting a call is the one thing the tree invites.
          props: { variant: 'solid', onClick: { $invoke: 'modules.call.startCall' } },
          children: [{ type: 'we-icon', props: { name: 'phone' } }, 'Start a call'],
        },
      ],
    },
  },
};

/**
 * The new-channel dialog, opened by a boolean local the caller declares — the tree's + and the empty
 * channel's "Make a channel" card each hold their own.
 */
export const newChannelDialog = (openLocal: string): SchemaNode =>
  formModal({
    open: { $: `local.${openLocal}` },
    close: { $setLocal: openLocal, value: false },
    title: 'New channel',
    size: 'sm',
    localState: { channelName: { type: 'string', initial: '' } },
    children: [field({ name: 'channelName', label: 'Name', placeholder: 'What it is about' })],
    disabled: { $: '!trim(local.channelName)' },
    submitLabel: 'Make channel',
    submit: {
      $invoke: 'record.create',
      args: [
        'CollectionBlock',
        { kind: 'channel', title: { $: 'trim(local.channelName)' } },
        { parent: { id: { $: 'spaceStore.root' }, relation: 'children', entity: 'CollectionBlock' } },
      ],
    },
  });

/** The channels under the space's root, oldest first — General is the root itself. Shared with the Channels page. */
export const SUB_CHANNELS = {
  entity: 'CollectionBlock',
  where: { kind: 'channel' },
  scope: { anchor: 'CollectionBlock', via: 'children', anchorId: { $: 'spaceStore.root' } },
  order: { createdAt: 'asc' },
  limit: 100,
  when: { $: 'spaceStore.root' },
};

/**
 * The space's calls, newest first. The tree lists the latest few; the Calls page more.
 *
 * By the fields a call row draws — its id, title and time (see `LIVE` and the rows above). A whole
 * call also carries the id of every line said in it, which is most of what a call weighs.
 */
export const CALLS = {
  entity: 'CollectionBlock',
  where: { kind: 'call' },
  order: { createdAt: 'desc' },
  select: ['title', 'createdAt'],
};

/**
 * The sidebar's latest calls. The Feed's empty-space prompt asks whether there is any call with this
 * same question, so the renderer holds one subscription for both rather than a second for a count.
 *
 * Read once the first screen is up: neither is on the Feed's first page, and the executor answers one
 * read at a time. The prompt waits for the answer (`anyCallLoaded`), so it is never shown wrongly
 * meanwhile.
 */
export const LATEST_CALLS = { ...CALLS, limit: 12, when: { $: 'spaceStore.firstScreenOpen' } };

/** The tree section, as the space template's left lane holds it — the lane paints the chrome behind it. */
export const treeSection: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%' },
  $localState: {
    openRows: {
      type: 'array',
      // Calls and Active flows start open: what is going on in the space, before what it has defined.
      initial: ['group|calls', 'group|workflows'],
      persist: 'coasys.tree.open',
    },
  },
  $queries: { calls: LATEST_CALLS },
  children: [
    header,
    purpose,
    findOrAsk,
    {
      type: 'Column',
      props: { flex: '1', minHeight: '0', overflowY: 'auto', px: '200' },
      children: [
        { type: 'we-text', props: { variant: 'overline', px: '200', pb: '100' }, children: ['Space'] },
        {
          type: 'we-tree',
          /*
            The caret at the end: a row is a place, pressed to go there, and the caret beside its count
            is the one thing that folds. Guides drop from each row's glyph, so a lead's width is given.
          */
          props: { label: 'This space', selected: { $: SELECTED_EXPR }, onSelect, caret: 'end', lead: TREE_LEAD },
          children: [feedRow, calls, activeFlows, people, socialDna, themesGroup],
        },
      ],
    },
    callButton,
  ],
};
