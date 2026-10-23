/**
 * The Flows page — every flow in the space, the records going through each, and the editor.
 *
 * A flow is drawn as lanes: the main line across the top, each branch below it saying where it leaves
 * and whether it rejoins or ends, and any move the rest does not cover listed as an exception. A
 * record going through it is drawn as a **walk** — the steps it has taken, the one it is at, the ones
 * ahead — because a record never branches: it takes one path, whatever the flow allows.
 *
 * Everything shown is computed by `flowStore` (lanes, requirements in words, the walk); this file
 * arranges it and names the actions. The editor works on a draft the store holds, so nothing reaches
 * the space until Save, and every edit that cannot be made says why in a toast rather than half
 * happening.
 *
 * ## The task-state flow
 *
 * Listed, and shown read-only: the board's task states write it, and tasks move on the board. "Edit in
 * Task states" goes where it is edited.
 */
import type { SchemaNode, SchemaProp } from '@we/schema-shared';
import { foldingBody, foldingSectionLabel, formModal, guardModal, stepRequirementFields } from '@we/template-kit';

const OPEN = 'flowStore.open';
const DRAFT = 'flowStore.draft';

/** The locals the page declares: which modal is open, and what it is about. */
export const FLOWS_LOCALS = {
  newFlowOpen: { type: 'boolean', initial: false },
  addStepLane: { type: 'number', initial: -1 },
  addStepAfter: { type: 'string', initial: '' },
  branchFrom: { type: 'string', initial: '' },
  editStep: { type: 'string', initial: '' },
  guardStep: { type: 'string', initial: '' },
  excFrom: { type: 'string', initial: '' },
  excTo: { type: 'string', initial: '' },
  historyOf: { type: 'string', initial: '' },
  showArchived: { type: 'boolean', initial: false },
  flowAsGraph: { type: 'boolean', initial: false },
} as const;

const text = (content: string | { $: string }, props: Record<string, SchemaProp> = {}): SchemaNode => ({
  type: 'we-text',
  props,
  children: [content],
});

const iconButton = (
  icon: string,
  label: string,
  onClick: SchemaProp,
  extra: Record<string, unknown> = {},
): SchemaNode => ({
  type: 'we-tooltip',
  props: { placement: 'top', content: label },
  children: [
    {
      type: 'we-button',
      props: { variant: 'ghost', size: 'sm', square: true, label, onClick, ...extra },
      children: [{ type: 'we-icon', props: { name: icon, size: 'sm' } }],
    },
  ],
});

const chip = (content: string | { $: string }, tone = 'surface-sunken'): SchemaNode => ({
  type: 'Row',
  props: { px: '200', py: '100', r: 'full', bg: tone, ay: 'center', gap: '100' },
  children: [text(content, { variant: 'footnote' })],
});

// ─── Lanes ─────────────────────────────────────────────────────────────────────

/** One step, as a card. `editing` adds the controls that change it. */
function stepCard(editing: boolean): SchemaNode {
  return {
    type: 'Column',
    props: {
      gap: '100',
      p: '300',
      r: 'card',
      bg: 'surface-raised',
      border: '1px solid border',
      /*
        One size for every step, so where a lane is is a number of steps along and a number of lanes
        down, and a line can be drawn exactly to a step it joins — see `lanes`. Taller while editing,
        for the controls. What does not fit is cut, each line to one line.
      */
      width: `${STATION}px`,
      height: `${editing ? STATION_H_EDITING : STATION_H}px`,
      overflow: 'hidden',
      flexShrink: '0',
    },
    children: [
      {
        type: 'Row',
        props: { gap: '200', ay: 'center' },
        children: [
          text({ $: 'step.label' }, { fontWeight: 'semibold', truncate: true }),
          {
            type: '$if',
            props: {
              condition: { $: 'step.final' },
              then: { type: 'we-icon', props: { name: 'flag-checkered', size: 'sm' } },
            },
          },
        ],
      },
      {
        type: '$each',
        props: { items: { $: 'step.requires' }, as: 'need' },
        children: [text({ $: 'need' }, { variant: 'footnote', color: 'text-muted', truncate: true })],
      },
      {
        type: '$if',
        props: {
          condition: { $: 'step.hint' },
          then: text({ $: 'step.hint' }, { variant: 'footnote', color: 'text-faint', truncate: true }),
        },
      },
      {
        // A move nothing else covers, said on the step it leads into — see `exceptions`.
        type: '$if',
        props: {
          condition: { $: 'count(step.alsoFrom ?? [])' },
          then: {
            type: 'Row',
            props: { gap: '100', ay: 'center' },
            children: [
              { type: 'we-icon', props: { name: 'arrow-bend-down-right', size: 'xs', color: 'accent-text' } },
              text(
                { $: "`also from ${join(step.alsoFrom, ', ')}`" },
                { variant: 'footnote', color: 'accent-text', truncate: true },
              ),
            ],
          },
        },
      },
      ...(editing
        ? [
            {
              type: 'Row',
              props: { gap: '100', wrap: true },
              children: [
                iconButton('arrow-left', 'Earlier', { $action: 'flowStore.moveStep', args: [{ $: 'step.name' }, -1] }),
                iconButton('arrow-right', 'Later', { $action: 'flowStore.moveStep', args: [{ $: 'step.name' }, 1] }),
                iconButton('plus', 'Add a step after this one', [
                  { $setLocal: 'addStepLane', value: { $: 'lane.index' } },
                  { $setLocal: 'addStepAfter', value: { $: 'step.name' } },
                ]),
                iconButton('git-branch', 'Branch from here', { $setLocal: 'branchFrom', value: { $: 'step.name' } }),
                iconButton('pencil-simple', 'Edit this step', { $setLocal: 'editStep', value: { $: 'step.name' } }),
                iconButton('trash', 'Remove this step', {
                  $action: 'flowStore.removeStep',
                  args: [{ $: 'step.name' }],
                }),
              ],
            } satisfies SchemaNode,
          ]
        : []),
    ],
  };
}

/** A step's width, the line between two, and the two together: one step along the line. */
const STATION = 180;
/** A step's height, reading and editing. */
const STATION_H = 112;
const STATION_H_EDITING = 176;
const LINK = 48;
const PITCH = STATION + LINK;
/** How far down a step its line runs — level with its name — and the gap between one lane and the next. */
const MID = 22;
const LANE_GAP = 32;
const LINE = '3px solid accent';

/** The line between two steps on a lane. */
const link: SchemaNode = {
  type: 'we-divider',
  props: { width: `${LINK}px`, thickness: '3px', color: 'accent', mt: `${MID - 1}px`, flexShrink: '0' },
};

/**
 * Every lane of a flow, as lines on a map — `source` is `flowStore.open` or `flowStore.draft`.
 *
 * The main line across the top, and each branch under it, joined to the step it leaves by a line that
 * drops from that step's foot and turns into the branch's first. A branch that rejoins further along
 * climbs back up into the foot of the step it rejoins at; one that rejoins earlier says where. A move no
 * lane covers is said on the step it leads into ("also from Draft").
 *
 * Every step is one size and every lane one height, so a step's place is a number of steps along
 * (`lane.column`) and of lanes down (`lane.index`), and a line is drawn exactly to the step it joins —
 * through the lanes in between, behind their steps — whatever is written on the steps. The lanes scroll
 * sideways rather than wrap, which would move a branch out from under its step.
 */
function lanes(source: string, editing: boolean): SchemaNode {
  const height = editing ? STATION_H_EDITING : STATION_H;
  const pitch = height + LANE_GAP;
  /** How far above this lane's top a step on lane `other` ends, as the top of a line climbing to it. */
  const climb = (other: string) => `${height} - (lane.index - ${other}) * ${pitch}`;
  /** A line climbing to a step on another lane, turning at this lane's line — `side` is the turn's corner. */
  const climber = (other: string, width: string, side: 'left' | 'right'): SchemaNode => ({
    type: 'Column',
    props: {
      width: { $: width },
      mt: { $: `\`\${${climb(other)}}px\`` },
      height: { $: `\`\${${MID + 1} - (${climb(other)})}px\`` },
      ...(side === 'left' ? { borderLeft: LINE, rbl: '500' } : { borderRight: LINE, rbr: '500' }),
      borderBottom: LINE,
      flexShrink: '0',
      // Behind the steps of the lanes it passes, so it reads as running under them to the one it joins.
      position: 'relative',
      zIndex: -1,
    },
  });
  return {
    type: 'Column',
    // Its own stacking context, so the climbing lines can go behind the steps and not behind the page.
    props: {
      gap: `${LANE_GAP}px`,
      width: '100%',
      overflowX: 'auto',
      pb: '200',
      pt: '100',
      position: 'relative',
      zIndex: 0,
    },
    children: [
      {
        type: '$each',
        props: { items: { $: `${source}.lanes` }, as: 'lane' },
        children: [
          {
            type: 'Row',
            props: { ay: 'start', gap: '0', height: `${height}px` },
            children: [
              {
                type: '$if',
                props: {
                  condition: { $: '!lane.main && lane.leavesLane >= 0' },
                  then: {
                    type: 'Row',
                    props: { ay: 'start', gap: '0', flexShrink: '0' },
                    children: [
                      {
                        type: 'Row',
                        props: {
                          width: { $: `\`\${(lane.column - 1) * ${PITCH} + ${STATION / 2}}px\`` },
                          flexShrink: '0',
                        },
                      },
                      climber('lane.leavesLane', `'${PITCH - STATION / 2}px'`, 'left'),
                    ],
                  },
                },
              },
              {
                type: '$each',
                props: { items: { $: 'lane.steps' }, as: 'step' },
                children: [
                  {
                    type: 'Row',
                    props: { ay: 'start', gap: '0', flexShrink: '0' },
                    children: [
                      { type: '$if', props: { condition: { $: 'index > 0' }, then: link } },
                      stepCard(editing),
                    ],
                  },
                ],
              },
              {
                type: '$if',
                props: {
                  condition: { $: '!lane.main && lane.rejoinsLane >= 0 && lane.rejoinsColumn > lane.lastColumn' },
                  then: climber(
                    'lane.rejoinsLane',
                    `\`\${(lane.rejoinsColumn - lane.lastColumn) * ${PITCH} - ${STATION / 2}}px\``,
                    'right',
                  ),
                },
              },
              {
                // Rejoining at or before where it is: no line can climb back, so it says where.
                type: '$if',
                props: {
                  condition: { $: '!lane.main && lane.rejoins && lane.rejoinsColumn <= lane.lastColumn' },
                  then: {
                    type: 'Row',
                    props: { gap: '100', ay: 'center', mt: `${MID - 10}px`, ml: '200', flexShrink: '0' },
                    children: [
                      { type: 'we-icon', props: { name: 'arrow-bend-left-up', size: 'sm', color: 'accent-text' } },
                      text({ $: '`back to ${lane.rejoinsLabel}`' }, { variant: 'footnote', color: 'text-muted' }),
                    ],
                  },
                },
              },
              ...(editing
                ? [
                    {
                      // On the lane's own row, so every lane stays one height and the lines meet.
                      type: 'Row',
                      props: { gap: '200', ay: 'center', mt: `${MID - 14}px`, ml: '300', flexShrink: '0' },
                      children: [
                        iconButton('plus', 'Add a step to the start of this lane', [
                          { $setLocal: 'addStepLane', value: { $: 'lane.index' } },
                          { $setLocal: 'addStepAfter', value: '' },
                        ]),
                        {
                          type: '$if',
                          props: {
                            condition: { $: '!lane.main' },
                            then: {
                              type: 'we-select',
                              props: {
                                fit: true,
                                size: 'sm',
                                value: { $: 'lane.rejoins' },
                                options: {
                                  $: `distinct([{ label: 'Ends here', value: '' }], ${source}.steps.map(s, { label: 'Rejoins at ' + s.label, value: s.name }))`,
                                },
                                onChange: {
                                  $action: 'flowStore.setBranchEnd',
                                  args: [{ $: 'lane.index' }, { $: 'event.detail' }],
                                },
                              },
                            },
                          },
                        },
                      ],
                    } satisfies SchemaNode,
                  ]
                : []),
            ],
          },
        ],
      },
    ],
  };
}

/** The moves nothing else covers. */
function exceptions(source: string, editing: boolean): SchemaNode {
  return {
    type: 'Column',
    props: { gap: '200' },
    children: [
      {
        type: '$if',
        props: {
          condition: { $: `count(${source}.exceptions) || ${editing}` },
          then: text('Other moves', { variant: 'label', color: 'text-muted' }),
        },
      },
      {
        type: '$each',
        props: { items: { $: `${source}.exceptions` }, as: 'move' },
        children: [
          {
            type: 'Row',
            props: { gap: '200', ay: 'center' },
            children: [
              text({ $: '`${move.fromLabel} → ${move.toLabel}`' }, { variant: 'footnote' }),
              ...(editing
                ? [
                    iconButton('x', 'Remove this move', {
                      $action: 'flowStore.removeException',
                      args: [{ $: 'move.from' }, { $: 'move.to' }],
                    }),
                  ]
                : []),
            ],
          },
        ],
      },
      ...(editing
        ? [
            {
              type: 'Row',
              props: { gap: '200', ay: 'center', wrap: true },
              children: [
                {
                  type: 'we-select',
                  props: {
                    fit: true,
                    size: 'sm',
                    placeholder: 'From',
                    value: { $: 'local.excFrom' },
                    options: { $: `${source}.steps.map(s, { label: s.label, value: s.name })` },
                    onChange: { $setLocal: 'excFrom', value: { $: 'event.detail' } },
                  },
                },
                { type: 'we-icon', props: { name: 'arrow-right', size: 'sm' } },
                {
                  type: 'we-select',
                  props: {
                    fit: true,
                    size: 'sm',
                    placeholder: 'To',
                    value: { $: 'local.excTo' },
                    options: { $: `${source}.steps.map(s, { label: s.label, value: s.name })` },
                    onChange: { $setLocal: 'excTo', value: { $: 'event.detail' } },
                  },
                },
                {
                  type: 'we-button',
                  props: {
                    size: 'sm',
                    variant: 'secondary',
                    disabled: { $: '!local.excFrom || !local.excTo' },
                    onClick: [
                      { $action: 'flowStore.addException', args: [{ $: 'local.excFrom' }, { $: 'local.excTo' }] },
                      { $setLocal: 'excFrom', value: '' },
                      { $setLocal: 'excTo', value: '' },
                    ],
                  },
                  children: [text('Add move')],
                },
              ],
            } satisfies SchemaNode,
          ]
        : []),
    ],
  };
}

/** The sequence rule of a flow, in a sentence. */
const ruleWords = (source: string) =>
  `${source}.rule == 'any' ? 'Any step can move to any other.' : ${source}.rule == 'next-and-back' ? 'Each step moves on to the next, or back to the one before.' : 'Each step moves on to the next.'`;

// ─── Records ───────────────────────────────────────────────────────────────────

/**
 * A record's walk, as a stepper.
 *
 * A track joins the steps and fills with the accent as far as the record has got: the segment before
 * a step is filled when the record has reached that step. Without it the steps read as a row of
 * unrelated words rather than one path.
 */
const walk: SchemaNode = {
  type: 'Row',
  props: { gap: '100', ay: 'center', wrap: true },
  children: [
    {
      type: '$each',
      props: { items: { $: 'rec.walk' }, as: 'step' },
      children: [
        {
          type: 'Row',
          props: { gap: '100', ay: 'center' },
          children: [
            {
              type: '$if',
              props: {
                condition: { $: 'index > 0' },
                // A divider rather than a sized box: a Row keeps a height of its own and drew an oval.
                then: {
                  type: 'we-divider',
                  props: {
                    width: '24px',
                    thickness: '3px',
                    color: { $: "step.at == 'ahead' ? 'border' : 'accent'" },
                  },
                },
              },
            },
            {
              type: 'we-icon',
              props: {
                size: 'sm',
                name: { $: "step.at == 'done' ? 'check-circle' : step.at == 'current' ? 'record' : 'circle'" },
                weight: { $: "step.at == 'ahead' ? 'regular' : 'fill'" },
                color: { $: "step.at == 'ahead' ? 'text-faint' : 'accent-text'" },
              },
            },
            text(
              { $: 'step.label' },
              {
                variant: 'footnote',
                fontWeight: { $: "step.at == 'current' ? 'semibold' : 'normal'" },
                color: { $: "step.at == 'ahead' ? 'text-faint' : 'text'" },
              },
            ),
          ],
        },
      ],
    },
  ],
};

/** Who agreed to a move, as faces — `step.voters` are DIDs, and the space's members carry the faces. */
const VOTER_FACES =
  'step.voters.map(d, { image: find(spaceStore.members, { did: d }).avatar, hash: d, initials: find(spaceStore.members, { did: d }).name })';
/** The same people as a sentence, for the tooltip over the faces. */
const VOTER_NAMES = "join(step.voters.map(d, find(spaceStore.members, { did: d }).name ?? 'Someone'), ', ')";

/**
 * What has happened to a record: one row per move, saying where it went, who agreed and when.
 *
 * The faces carry the "who" rather than a count, because "by 2 people" is the one thing a person
 * looking at a history wants named. Their names are in the tooltip, where a row has no room for them.
 */
const historyList: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'local.historyOf == rec.subject' },
    enterTransition: [
      { type: 'reveal', duration: 250 },
      { type: 'fade', duration: 150 },
    ],
    then: {
      type: 'Column',
      props: { gap: '200', pl: '400' },
      children: [
        {
          type: '$each',
          props: { items: { $: `${OPEN}.history[rec.subject] ?? []` }, as: 'step' },
          children: [
            {
              type: 'Row',
              props: { gap: '300', ay: 'center', wrap: true },
              children: [
                text({ $: '`${step.fromLabel} → ${step.toLabel}`' }, { variant: 'footnote' }),
                {
                  type: 'we-tooltip',
                  props: { placement: 'top', content: { $: `'Agreed by ' + ${VOTER_NAMES}` } },
                  children: [
                    {
                      type: 'AvatarStack',
                      props: { avatars: { $: VOTER_FACES }, size: 'xs', max: 5 },
                    },
                  ],
                },
                {
                  type: '$if',
                  props: {
                    condition: { $: 'step.when' },
                    then: {
                      type: 'we-timestamp',
                      props: { value: { $: 'step.when' }, relative: true, color: 'text-faint', fontSize: '100' },
                    },
                  },
                },
                {
                  type: '$if',
                  props: {
                    condition: { $: 'count(step.evidence) || step.note' },
                    then: text(
                      {
                        $: "`${count(step.evidence) ? `${count(step.evidence)} cited` : ''}${count(step.evidence) && step.note ? ' · ' : ''}${step.note ? `“${step.note}”` : ''}`",
                      },
                      { variant: 'footnote', color: 'text-muted' },
                    ),
                  },
                },
              ],
            },
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $: `!count(${OPEN}.history[rec.subject] ?? [])` },
            then: text('Nothing has moved it yet.', { variant: 'footnote', color: 'text-faint' }),
          },
        },
      ],
    },
  },
};

/** One record going through the open flow. */
const recordRow: SchemaNode = {
  type: 'Column',
  props: { gap: '200', p: '300', r: 'card', border: '1px solid border', bg: 'surface' },
  children: [
    {
      type: 'Row',
      props: { gap: '300', ay: 'center', wrap: true },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'bare',
            onClick: { $action: 'routeStore.setParam', args: ['card', { $: 'rec.subject' }] },
          },
          children: [text({ $: "rec.title ? rec.title : 'Untitled'" }, { truncate: true, maxWidth: '360px' })],
        },
        {
          type: '$if',
          props: {
            condition: { $: 'rec.startedAt' },
            then: {
              type: 'Row',
              props: { gap: '100', ay: 'center' },
              children: [
                text('started', { variant: 'footnote', color: 'text-faint' }),
                {
                  type: 'we-timestamp',
                  props: { value: { $: 'rec.startedAt' }, relative: true, color: 'text-faint', fontSize: '100' },
                },
              ],
            },
          },
        },
        {
          type: '$if',
          props: {
            condition: { $: 'rec.stalled' },
            then: chip('Stuck between two moves — one has to be withdrawn', 'warning-surface'),
          },
        },
        { type: 'Row', props: { flex: '1' } },
        iconButton('clock-counter-clockwise', 'What has happened to it', [
          { $action: 'flowStore.loadHistory', args: [{ $: 'rec.subject' }] },
          { $setLocal: 'historyOf', value: { $: "local.historyOf == rec.subject ? '' : rec.subject" } },
        ]),
      ],
    },
    walk,
    {
      type: '$each',
      props: { items: { $: 'rec.waiting' }, as: 'move' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center', wrap: true },
          children: [
            text(
              { $: '`Asked to move to ${move.toLabel} · ${count(move.voters)} of ${move.needs}`' },
              { variant: 'footnote' },
            ),
            {
              type: '$if',
              props: {
                condition: { $: `!${OPEN}.managedBy` },
                then: {
                  type: '$if',
                  props: {
                    condition: { $: 'move.mine' },
                    then: {
                      type: 'we-button',
                      props: {
                        size: 'sm',
                        variant: 'ghost',
                        onClick: {
                          $action: 'flowStore.withdrawRecord',
                          args: [{ $: `${OPEN}.name` }, { $: 'rec.subject' }],
                        },
                      },
                      children: [text('Withdraw')],
                    },
                    else: {
                      type: 'we-button',
                      props: {
                        size: 'sm',
                        variant: 'secondary',
                        onClick: {
                          $action: 'flowStore.moveRecord',
                          args: [{ $: `${OPEN}.name` }, { $: 'rec.subject' }, { $: 'move.to' }],
                        },
                      },
                      children: [text('Agree')],
                    },
                  },
                },
              },
            },
          ],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: `!${OPEN}.managedBy && count(rec.next)` },
        then: {
          type: 'Row',
          props: { gap: '200', ay: 'center', wrap: true },
          children: [
            text('Move to', { variant: 'footnote', color: 'text-muted' }),
            {
              type: '$each',
              props: { items: { $: 'rec.next' }, as: 'to' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    size: 'sm',
                    variant: 'ghost',
                    onClick: {
                      $action: 'flowStore.moveRecord',
                      args: [{ $: `${OPEN}.name` }, { $: 'rec.subject' }, { $: 'to.name' }],
                    },
                  },
                  children: [text({ $: 'to.label' })],
                },
              ],
            },
          ],
        },
      },
    },
    historyList,
  ],
};

// ─── The open flow ─────────────────────────────────────────────────────────────

const openHeader: SchemaNode = {
  type: 'Column',
  props: { gap: '200' },
  children: [
    {
      type: 'Row',
      props: { gap: '300', ay: 'center', wrap: true },
      children: [
        text({ $: `${OPEN}.label` }, { variant: 'heading-sm' }),
        { type: '$if', props: { condition: { $: `${OPEN}.archived` }, then: chip('Archived') } },
        { type: 'Row', props: { flex: '1' } },
        {
          type: '$if',
          props: {
            condition: { $: `${OPEN}.managedBy == 'task-states'` },
            then: {
              type: 'we-button',
              props: {
                size: 'sm',
                variant: 'secondary',
                onClick: { $action: 'shellStore.openSpaceSettings', args: ['vocabulary'] },
              },
              children: [text('Edit in Task states')],
            },
          },
        },
        {
          type: '$if',
          props: {
            condition: { $: `flowStore.canEdit && !${OPEN}.managedBy` },
            then: {
              type: 'Row',
              props: { gap: '200' },
              children: [
                {
                  type: '$if',
                  props: {
                    condition: { $: `${OPEN}.editable` },
                    then: {
                      type: 'we-button',
                      props: { size: 'sm', variant: 'secondary', onClick: { $action: 'flowStore.editFlow' } },
                      children: [text('Edit')],
                    },
                  },
                },
                {
                  type: 'we-button',
                  props: {
                    size: 'sm',
                    variant: 'ghost',
                    onClick: {
                      $action: 'spaceStore.setFlowArchived',
                      args: [{ $: `${OPEN}.name` }, { $: `!${OPEN}.archived` }],
                    },
                  },
                  children: [text({ $: `${OPEN}.archived ? 'Bring back' : 'Archive'` })],
                },
                {
                  type: '$if',
                  props: {
                    // Only once the records are read: before then the count is 0 for every flow,
                    // and Delete showed for a moment on one that had records.
                    condition: { $: `${OPEN}.recordsLoaded && !count(${OPEN}.records)` },
                    then: {
                      type: 'we-button',
                      props: {
                        size: 'sm',
                        variant: 'ghost',
                        onClick: { $action: 'flowStore.deleteFlow', args: [{ $: `${OPEN}.name` }] },
                      },
                      children: [text('Delete')],
                    },
                  },
                },
              ],
            },
          },
        },
      ],
    },
    {
      type: '$if',
      props: { condition: { $: `${OPEN}.hint` }, then: text({ $: `${OPEN}.hint` }, { color: 'text-muted' }) },
    },
    text({ $: ruleWords(OPEN) }, { variant: 'footnote', color: 'text-muted' }),
    {
      type: '$if',
      props: {
        condition: { $: `!${OPEN}.fits` },
        then: text(
          'This flow was not written as lanes, so it is shown as one line with every other move listed below it.',
          {
            variant: 'footnote',
            color: 'text-faint',
          },
        ),
      },
    },
  ],
};

/** The open flow's steps and moves, as `flowStore.flows` holds them once its definition is read. */
const OPEN_DEFINITION = `flowStore.flows.find(f, f.name == ${OPEN}.name)`;

/**
 * The open flow as a graph: one node per step, a line per move, laid out as a tree from the first.
 *
 * Read-only, and a second way of looking rather than a second editor: lanes are where a flow is
 * written. What a graph shows that lanes do not is a flow that does not fit them — one written by
 * another app, all moves and no line — and the shape of the wiring at a glance.
 */
const flowGraph: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '480px', r: 'card', border: '1px solid border', overflow: 'hidden' },
  children: [
    {
      type: 'GraphView',
      props: {
        seeds: {
          literal: true,
          nodes: {
            /*
              From the open flow's own steps, which say what entering each takes and what it means — the
              same lines a step's card carries in the lanes. The list's steps carried only their names.
            */
            $: `(${OPEN}.steps ?? []).map(s, { id: 'step:' + s.name, kind: 'cluster', type: 'flow-step', label: s.label + (count(s.requires) ? '\\n' + join(s.requires, '\\n') : '') + (s.hint ? '\\n' + s.hint : ''), data: { final: s.final } })`,
          },
          edges: {
            $: `(${OPEN_DEFINITION}.moves ?? []).map(m, { id: m.from + '>' + m.to, source: 'step:' + m.from, target: 'step:' + m.to, type: 'move' })`,
          },
        },
        /*
          Room between steps for the lines to read. The tree's gaps are centre to centre, and at its
          defaults a step sat closer to the next than its own width — overlapping — so a move back or a
          branch had nowhere to go but a sharp bend. A step's width plus 120 along, its height plus 70
          across.
        */
        layout: { type: 'tree', options: { direction: 'right', levelGap: 290, siblingGap: 166 } },
        nodeStyle: [
          { style: { shape: 'card', width: 170, height: 96, color: 'surface-raised' } },
          { when: { 'data.final': true }, style: { borderColor: 'accent-text', borderWidth: 2 } },
        ],
        edgeStyle: [{ style: { color: 'accent-text' } }],
        controls: ['zoom-in', 'zoom-out', 'fit'],
        behaviours: ['pan-zoom'],
      },
    },
  ],
};

const openFlow: SchemaNode = {
  type: 'Column',
  props: { gap: '500', width: '100%' },
  children: [
    openHeader,
    {
      type: 'Row',
      props: { gap: '200' },
      children: [
        {
          type: 'we-button',
          props: {
            size: 'sm',
            variant: { $: "local.flowAsGraph ? 'ghost' : 'secondary'" },
            onClick: { $setLocal: 'flowAsGraph', value: false },
          },
          children: [text('Lanes')],
        },
        {
          type: 'we-button',
          props: {
            size: 'sm',
            variant: { $: "local.flowAsGraph ? 'secondary' : 'ghost'" },
            onClick: { $setLocal: 'flowAsGraph', value: true },
          },
          children: [text('Graph')],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'local.flowAsGraph' },
        then: flowGraph,
        else: {
          type: 'Column',
          props: { gap: '500', width: '100%' },
          // The moves no lane covers are said on the steps they lead into; the list is the editor's.
          children: [lanes(OPEN, false)],
        },
      },
    },
    { type: 'we-divider' },
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        text('Going through it', { variant: 'label' }),
        chip({ $: `count(${OPEN}.records)` }),
        {
          type: '$if',
          props: {
            condition: { $: `count(${OPEN}.records) > 1` },
            then: text('Newest first', { variant: 'footnote', color: 'text-faint' }),
          },
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: `count(${OPEN}.records)` },
        then: {
          type: 'Column',
          props: { gap: '200' },
          children: [{ type: '$each', props: { items: { $: `${OPEN}.records` }, as: 'rec' }, children: [recordRow] }],
        },
        else: text(
          {
            $: `${OPEN}.managedBy ? 'Tasks join this flow the first time somebody moves them on the board.' : 'Nothing yet. Start this flow on a record from its inspector.'`,
          },
          {
            variant: 'footnote',
            color: 'text-faint',
          },
        ),
      },
    },
  ],
};

// ─── The editor ────────────────────────────────────────────────────────────────

const draftHeader: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
    {
      type: 'Row',
      props: { gap: '300', ay: 'center', wrap: true },
      children: [
        {
          type: '$if',
          props: {
            condition: { $: `${DRAFT}.isNew` },
            then: {
              type: 'we-input',
              props: {
                label: 'Name',
                value: { $: `${DRAFT}.label` },
                onChange: { $action: 'flowStore.setDraftLabel', args: [{ $: 'event.detail' }] },
              },
            },
            else: text({ $: `${DRAFT}.label` }, { variant: 'heading-sm' }),
          },
        },
        { type: 'Row', props: { flex: '1' } },
        {
          type: 'we-button',
          props: { variant: 'ghost', onClick: { $action: 'flowStore.cancelDraft' } },
          children: [text('Cancel')],
        },
        {
          type: 'we-button',
          props: {
            variant: 'primary',
            disabled: { $: `count(${DRAFT}.problems) > 0 || !${DRAFT}.dirty` },
            onClick: { $action: 'flowStore.saveDraft' },
          },
          children: [text('Save')],
        },
      ],
    },
    {
      type: 'we-input',
      props: {
        label: 'What it is for',
        value: { $: `${DRAFT}.hint` },
        onChange: { $action: 'flowStore.setDraftHint', args: [{ $: 'event.detail' }] },
      },
    },
    {
      type: 'Row',
      props: { gap: '300', wrap: true },
      children: [
        {
          type: 'we-form-field',
          props: { label: 'For' },
          children: [
            {
              type: 'we-select',
              props: {
                value: { $: `${DRAFT}.subjects[0] ?? ''` },
                /*
                  A note and a post are each a collection (`CollectionBlock`), not the text inside one
                  (`TextBlock`), which is what this used to name — so a flow for "notes and posts" was
                  offered on none of them. "Collections" picked the same records, and goes.
                */
                options: {
                  $: "[{ label: 'Any record', value: '' }, { label: 'Tasks', value: 'TaskBlock' }, { label: 'Notes and posts', value: 'CollectionBlock' }, { label: 'Events', value: 'EventBlock' }]",
                },
                onChange: {
                  $action: 'flowStore.setDraftSubjects',
                  args: [{ $: 'event.detail ? [event.detail] : []' }],
                },
              },
            },
          ],
        },
        {
          type: 'we-form-field',
          props: { label: 'Steps move' },
          children: [
            {
              type: 'we-select',
              props: {
                value: { $: `${DRAFT}.rule` },
                options: {
                  $: "[{ label: 'On to the next', value: 'next' }, { label: 'On, or back one', value: 'next-and-back' }, { label: 'Anywhere', value: 'any' }]",
                },
                onChange: { $action: 'flowStore.setRule', args: [{ $: 'event.detail' }] },
              },
            },
          ],
        },
      ],
    },
    {
      type: '$each',
      props: { items: { $: `${DRAFT}.problems` }, as: 'problem' },
      children: [text({ $: 'problem' }, { variant: 'footnote', color: 'danger' })],
    },
    {
      // Said where two ends that each ask for agreement sit side by side, on a backend that will not
      // choose between them.
      type: '$if',
      props: {
        condition: { $: "flowStore.capabilities.contention == 'stall'" },
        then: text(
          'If two moves out of one step are both agreed, the record stops there until somebody withdraws — so give the ends of a vote different numbers, or expect to settle a tie.',
          { variant: 'footnote', color: 'text-faint' },
        ),
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: "flowStore.capabilities.enforcement == 'peers'" },
        then: text(
          'These rules are kept by every member’s app. Somebody running other software could write past them, and nobody else’s screen would show it.',
          { variant: 'footnote', color: 'text-faint' },
        ),
      },
    },
  ],
};

const draftEditor: SchemaNode = {
  type: 'Column',
  props: { gap: '500', width: '100%' },
  children: [draftHeader, lanes(DRAFT, true), exceptions(DRAFT, true)],
};

// ─── Modals ────────────────────────────────────────────────────────────────────

/*
  Open from the page's own +, or from anywhere that goes to the page with `?new=1` — a tree's +, say.
  Read off the address while it holds the param, rather than through a synced local: a local reads
  its param once, when it mounts, and the page is kept alive, so going to `?new=1` a second time
  opened nothing. Closing it takes the param away again.
*/
const newFlowModal: SchemaNode = formModal({
  open: { $: "local.newFlowOpen || routeStore.params.new == '1'" },
  /*
    One handler rather than a list: `we-modal`'s `close` is a prop, not an event, and a list there is
    read as a value, so the ✕ and the backdrop did nothing. A `$if` is a handler and may run a list.
  */
  close: {
    $if: {
      condition: { $: "routeStore.params.new == '1'" },
      then: [
        { $action: 'routeStore.setParam', args: ['new', null] },
        { $setLocal: 'newFlowOpen', value: false },
      ],
      else: { $setLocal: 'newFlowOpen', value: false },
    },
  },
  title: 'New flow',
  size: 'sm',
  localState: {
    flowLabel: { type: 'string', initial: '' },
    flowPreset: { type: 'string', initial: 'proposal' },
  },
  children: [
    {
      type: 'we-input',
      props: {
        label: 'Name',
        value: { $: 'local.flowLabel' },
        onChange: { $setLocal: 'flowLabel', value: { $: 'event.detail' } },
      },
    },
    {
      type: 'we-form-field',
      props: { label: 'Start from' },
      children: [
        {
          type: 'we-select',
          props: {
            value: { $: 'local.flowPreset' },
            options: {
              $: "[{ label: 'A proposal: discussed, voted on, adopted or rejected', value: 'proposal' }, { label: 'A review: drafted, checked, published', value: 'review' }, { label: 'Two steps, to build on', value: 'blank' }]",
            },
            onChange: { $setLocal: 'flowPreset', value: { $: 'event.detail' } },
          },
        },
      ],
    },
  ],
  disabled: { $: '!local.flowLabel' },
  submitLabel: 'Start writing',
  submit: {
    $action: 'flowStore.newFlow',
    args: [
      { $: 'local.flowPreset' },
      { $: 'local.flowLabel' },
      { $: "local.flowPreset == 'proposal' ? ['CollectionBlock'] : ['TaskBlock']" },
    ],
  },
});

const addStepModal: SchemaNode = formModal({
  open: { $: 'local.addStepLane >= 0' },
  close: { $setLocal: 'addStepLane', value: -1 },
  title: 'Add a step',
  size: 'sm',
  localState: { stepLabel: { type: 'string', initial: '' } },
  children: [
    {
      type: 'we-input',
      props: {
        label: 'Name',
        value: { $: 'local.stepLabel' },
        onChange: { $setLocal: 'stepLabel', value: { $: 'event.detail' } },
      },
    },
  ],
  disabled: { $: '!local.stepLabel' },
  submitLabel: 'Add',
  submit: {
    $action: 'flowStore.addStep',
    args: [{ $: 'local.addStepLane' }, { $: 'local.stepLabel' }, { $: 'local.addStepAfter' }],
  },
});

const branchModal: SchemaNode = formModal({
  open: { $: 'local.branchFrom' },
  close: { $setLocal: 'branchFrom', value: '' },
  title: 'Branch from here',
  size: 'sm',
  localState: {
    branchLabel: { type: 'string', initial: '' },
    branchRejoins: { type: 'string', initial: '' },
  },
  children: [
    {
      type: 'we-input',
      props: {
        label: 'First step on the branch',
        value: { $: 'local.branchLabel' },
        onChange: { $setLocal: 'branchLabel', value: { $: 'event.detail' } },
      },
    },
    {
      type: 'we-form-field',
      props: { label: 'Afterwards', description: 'More steps can be added to the branch once it exists.' },
      children: [
        {
          type: 'we-select',
          props: {
            value: { $: 'local.branchRejoins' },
            options: {
              $: `distinct([{ label: 'It ends there', value: '' }], ${DRAFT}.steps.map(s, { label: 'It rejoins at ' + s.label, value: s.name }))`,
            },
            onChange: { $setLocal: 'branchRejoins', value: { $: 'event.detail' } },
          },
        },
      ],
    },
  ],
  disabled: { $: '!local.branchLabel' },
  submitLabel: 'Add branch',
  submit: {
    $action: 'flowStore.addBranch',
    args: [{ $: 'local.branchFrom' }, { $: 'local.branchLabel' }, { $: 'local.branchRejoins' }],
  },
});

/** The step being edited, read out of the draft's lanes. */
const EDITING = `${DRAFT}.steps.find(s, s.name == local.editStep)`;

const editStepModal: SchemaNode = formModal({
  open: { $: 'local.editStep' },
  close: { $setLocal: 'editStep', value: '' },
  title: 'Edit step',
  size: 'sm',
  localState: {
    stepName: { type: 'string', initial: { $: `${EDITING}.label` } },
    stepHint: { type: 'string', initial: { $: `${EDITING}.hint` } },
    stepApprovals: { type: 'number', initial: { $: `${EDITING}.approvals ?? 1` } },
    stepKind: { type: 'string', initial: { $: `${EDITING}.approverKind ?? ''` } },
  },
  children: [
    {
      type: 'we-input',
      props: {
        label: 'Name',
        value: { $: 'local.stepName' },
        onChange: { $setLocal: 'stepName', value: { $: 'event.detail' } },
      },
    },
    {
      type: 'we-input',
      props: {
        label: 'What being here means',
        value: { $: 'local.stepHint' },
        onChange: { $setLocal: 'stepHint', value: { $: 'event.detail' } },
      },
    },
    // The same fields a task state's form shows — see `stepRequirementFields`.
    ...stepRequirementFields({
      approvals: {
        value: { $: 'local.stepApprovals' },
        onChange: { $setLocal: 'stepApprovals', value: { $: 'event.detail' } },
      },
      kind: { value: { $: 'local.stepKind' }, onChange: { $setLocal: 'stepKind', value: { $: 'event.detail' } } },
      guards: {
        items: `${EDITING}.guards ?? []`,
        onRemove: { $action: 'flowStore.removeGuard', args: [{ $: 'local.editStep' }, { $: 'index' }] },
        onAdd: { $setLocal: 'guardStep', value: { $: 'local.editStep' } },
      },
    }),
  ],
  disabled: { $: '!local.stepName' },
  submitLabel: 'Save step',
  submit: {
    $action: 'flowStore.updateStep',
    args: [
      { $: 'local.editStep' },
      {
        label: { $: 'local.stepName' },
        hint: { $: 'local.stepHint' },
        approvals: { $: 'local.stepApprovals' },
        kind: { $: 'local.stepKind' },
      },
    ],
  },
});

const guardStepModal: SchemaNode = guardModal({
  open: { $: 'local.guardStep' },
  close: { $setLocal: 'guardStep', value: '' },
  submit: ({ entity, tie, min }) => ({
    $action: 'flowStore.addGuard',
    args: [{ $: 'local.guardStep' }, entity, tie, min],
  }),
});

// ─── The list ──────────────────────────────────────────────────────────────────

const flowButton: SchemaNode = {
  type: 'we-button',
  props: {
    variant: { $: `${OPEN}.name == flow.name && !${DRAFT} ? 'secondary' : 'ghost'` },
    width: '100%',
    onClick: [{ $action: 'flowStore.cancelDraft' }, { $action: 'flowStore.openFlow', args: [{ $: 'flow.name' }] }],
  },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', width: '100%' },
      children: [
        { type: 'we-icon', props: { name: { $: "flow.managedBy ? 'kanban' : 'flow-arrow'" }, size: 'sm' } },
        text({ $: 'flow.label' }, { truncate: true, flex: '1' }),
        text({ $: 'flow.records' }, { variant: 'footnote', color: 'text-faint' }),
      ],
    },
  ],
};

const flowList: SchemaNode = {
  type: 'Column',
  props: { gap: '200', width: '240px', flexShrink: '0' },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        text('Flows', { variant: 'label', flex: '1' }),
        {
          type: '$if',
          props: {
            condition: { $: 'flowStore.canEdit' },
            then: iconButton('plus', 'New flow', { $setLocal: 'newFlowOpen', value: true }),
          },
        },
      ],
    },
    {
      type: '$each',
      props: { items: { $: 'flowStore.flows.filter(f, !f.archived)' }, as: 'flow' },
      children: [flowButton],
    },
    /*
      Loading, then the list or "No flows yet." — never "No flows yet." while the list is still being
      read. On a shared node the read takes seconds, and the empty sentence said the space had lost
      its flows until they arrived.
    */
    {
      type: '$if',
      props: {
        condition: { $: 'flowStore.flowsLoaded' },
        then: {
          type: '$if',
          props: {
            condition: { $: '!count(flowStore.flows)' },
            then: text('No flows yet.', { variant: 'footnote', color: 'text-faint' }),
          },
        },
        else: {
          type: 'Column',
          props: { gap: '200' },
          children: [
            { type: 'we-skeleton', props: { height: '28px' } },
            { type: 'we-skeleton', props: { height: '28px', width: '80%' } },
          ],
        },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: 'flowStore.flows.exists(f, f.archived)' },
        then: {
          type: 'Column',
          props: { gap: '100' },
          children: [
            {
              type: 'we-button',
              props: { size: 'sm', variant: 'ghost', onClick: { $toggleLocal: 'showArchived' } },
              children: [text({ $: "local.showArchived ? 'Hide archived' : 'Archived'" }, { variant: 'footnote' })],
            },
            {
              type: '$if',
              props: {
                condition: { $: 'local.showArchived' },
                then: {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    {
                      type: '$each',
                      props: { items: { $: 'flowStore.flows.filter(f, f.archived)' }, as: 'flow' },
                      children: [flowButton],
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    },
  ],
};

/**
 * The page. `band` is the route's padding below the pinned chrome, which the workshop owns.
 */
export function flowsPage(band: Record<string, string>): SchemaNode {
  return {
    type: 'Column',
    props: { width: '100%', minHeight: '100%', ax: 'center', px: '400' },
    children: [
      {
        type: '$if',
        props: {
          condition: { $: 'flowStore.available' },
          then: {
            type: 'Row',
            props: { width: '100%', maxWidth: 'var(--we-layout-lg)', gap: '600', ay: 'start', ...band },
            children: [
              flowList,
              {
                type: 'Column',
                props: { flex: '1', minWidth: '0', gap: '400' },
                children: [
                  {
                    type: '$if',
                    props: {
                      condition: { $: DRAFT },
                      then: draftEditor,
                      else: {
                        type: '$if',
                        props: {
                          condition: { $: OPEN },
                          then: openFlow,
                          else: text('Choose a flow to see what is going through it.', { color: 'text-faint' }),
                        },
                      },
                    },
                  },
                ],
              },
            ],
          },
          else: {
            type: 'Column',
            props: { width: '100%', maxWidth: 'var(--we-layout-md)', ...band },
            children: [text('Flows are not available in this space.', { color: 'text-faint' })],
          },
        },
      },
      newFlowModal,
      addStepModal,
      branchModal,
      editStepModal,
      guardStepModal,
    ],
  };
}

// ─── The inspector's section ───────────────────────────────────────────────────

/**
 * What can be done to a record in one flow from its inspector: the moves waiting on agreement, with
 * Agree or Withdraw, and where it may be asked to go next. `inFlow` is one of its `recordFlows`.
 */
const inspectorMoves: SchemaNode = {
  type: 'Column',
  props: { gap: '100', pl: '600' },
  children: [
    {
      type: '$each',
      props: { items: { $: 'inFlow.asks' }, as: 'ask' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center', wrap: true },
          children: [
            text(
              { $: '`Asked to move to ${ask.toLabel} · ${count(ask.voters)} of ${ask.needs}`' },
              { variant: 'footnote', color: 'text-muted' },
            ),
            {
              type: '$if',
              props: {
                condition: { $: 'ask.mine' },
                then: {
                  type: 'we-button',
                  props: {
                    size: 'xs',
                    variant: 'ghost',
                    onClick: { $action: 'flowStore.withdrawRecord', args: [{ $: 'inFlow.flow' }, { $: 'row.id' }] },
                  },
                  children: [text('Withdraw')],
                },
                else: {
                  type: 'we-button',
                  props: {
                    size: 'xs',
                    variant: 'secondary',
                    onClick: {
                      $action: 'flowStore.moveRecord',
                      args: [{ $: 'inFlow.flow' }, { $: 'row.id' }, { $: 'ask.to' }],
                    },
                  },
                  children: [text('Agree')],
                },
              },
            },
          ],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'count(inFlow.next)' },
        then: {
          type: 'Row',
          props: { gap: '100', ay: 'center', wrap: true },
          children: [
            text('Move to', { variant: 'footnote', color: 'text-muted' }),
            {
              type: '$each',
              props: { items: { $: 'inFlow.next' }, as: 'to' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    size: 'xs',
                    variant: 'ghost',
                    onClick: {
                      $action: 'flowStore.moveRecord',
                      args: [{ $: 'inFlow.flow' }, { $: 'row.id' }, { $: 'to.name' }],
                    },
                  },
                  children: [text({ $: 'to.label' })],
                },
              ],
            },
          ],
        },
      },
    },
  ],
};

/**
 * The flows a record is going through, in its inspector, and the one control that starts another.
 *
 * Shown wherever the space has flows. `row` is the record the inspector's loop binds, `type` the
 * expression naming its entity. Where it stands in each is read from `flowStore.recordFlows`, which
 * watches every startable flow, so a card and its inspector agree without either asking.
 *
 * Each flow offers what can be done to the record from here — move it on, agree with a move somebody
 * asked for, or take back one's own ask — so moving a record does not mean leaving it. "Open" goes to
 * the Flows page with that flow open, where its whole walk and its history are read: the inspector
 * does not grow a second copy of the stepper.
 */
export function flowsSection(opts: { type: string; open: { field: string }; flowsPath: SchemaProp }): SchemaNode {
  const mine = 'flowStore.recordFlows[row.id] ?? []';
  return {
    type: '$if',
    props: {
      condition: {
        $: 'flowStore.available && (count(flowStore.startable) || count(flowStore.recordFlows[row.id] ?? []))',
      },
      then: {
        type: 'Column',
        props: { gap: '100' },
        children: [
          foldingSectionLabel({
            label: 'Flows',
            count: `count(${mine})`,
            open: opts.open,
            action: {
              type: 'DropdownMenu',
              props: {
                triggerIcon: 'flow-arrow',
                triggerTitle: 'Start a flow on this',
                triggerVariant: 'ghost',
                size: 'xs',
                itemSize: 'sm',
                placement: 'bottom-end',
                items: {
                  $: `flowStore.startable.filter(f, (${opts.type} in f.subjects || !count(f.subjects)) && !(${mine}).exists(c, c.flow == f.name)).map(f, { id: f.name, label: f.label })`,
                },
                onSelect: { $action: 'flowStore.startFlow', args: [{ $: 'arg.id' }, { $: 'row.id' }] },
              },
            },
          }),
          foldingBody({
            open: opts.open,
            children: [
              {
                type: 'Column',
                props: { gap: '200' },
                children: [
                  {
                    type: '$each',
                    props: { items: { $: mine }, as: 'inFlow' },
                    children: [
                      {
                        type: 'Column',
                        props: { gap: '100' },
                        children: [
                          {
                            type: 'Row',
                            props: { gap: '200', ay: 'center', wrap: true },
                            children: [
                              { type: 'we-icon', props: { name: 'flow-arrow', size: 'sm' } },
                              text({ $: 'inFlow.label' }, { variant: 'label' }),
                              text(
                                { $: "inFlow.stateLabel ? inFlow.stateLabel : 'Not placed yet'" },
                                { variant: 'footnote', color: 'text-muted' },
                              ),
                              {
                                type: '$if',
                                props: {
                                  condition: { $: 'inFlow.waiting' },
                                  then: chip({ $: '`${inFlow.waiting} waiting`' }, 'warning-surface'),
                                },
                              },
                              {
                                type: '$if',
                                props: { condition: { $: 'inFlow.stalled' }, then: chip('Stuck', 'warning-surface') },
                              },
                              { type: 'Row', props: { flex: '1' } },
                              {
                                type: 'we-button',
                                props: {
                                  size: 'xs',
                                  variant: 'ghost',
                                  onClick: [
                                    { $action: 'flowStore.openFlow', args: [{ $: 'inFlow.flow' }] },
                                    { $action: 'routeStore.navigate', args: [opts.flowsPath] },
                                  ],
                                },
                                children: [text('Open')],
                              },
                            ],
                          },
                          inspectorMoves,
                        ],
                      },
                    ],
                  },
                  {
                    type: '$if',
                    props: {
                      condition: { $: `!count(${mine})` },
                      then: text('Not going through any flow.', { variant: 'footnote', color: 'text-faint' }),
                    },
                  },
                ],
              },
            ],
          }),
        ],
      },
    },
  };
}
