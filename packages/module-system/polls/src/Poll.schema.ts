/**
 * The polls module's presentation — a card, a composer, and a section listing every poll.
 *
 * Every piece is a fragment. `pollCard` is written against a record bound as `block`, which is what
 * a block contribution's card is handed and also what a `$each` over a Poll query binds — so the same
 * part draws a poll composed into a post and a poll listed in the section.
 */
import type { SchemaNode, TemplateSchema } from '@we/schema-shared';

/** This agent's vote on this poll, written and not yet read back — see `modules.polls.pendingVote`. */
const PENDING = 'modules.polls.pendingVote[block.id]';
/**
 * A choice one has to pick, and the tally to draw it from — read once per card.
 *
 * The held vote goes in, so the bars move on the press rather than a round trip later. `tally`
 * counts it in place of this agent's stored vote, so changing a vote does not count twice.
 */
const ROWS = { $: `tally({ votes: local.votes, options: block.options, pending: ${PENDING} })` };
/**
 * This agent's own vote, if any — the held one first.
 *
 * Both halves, or the press is half-drawn: the bars would move while the choice stayed unselected,
 * which reads as somebody else's vote arriving rather than as your own registering.
 */
const MY_VOTE = `(${PENDING}.option ?? local.votes.find(v, v.author == me.did).option)`;
/** Whether counts are shown: the community says so, the agent has voted, or the poll is closed. */
const REVEAL = `modules.polls.revealBeforeVoting || ${MY_VOTE} || block.closed`;

/** One choice: a button that votes, with the count and a bar once counts are shown. */
const optionRow: SchemaNode = {
  type: 'Column',
  props: { gap: '100' },
  children: [
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: { $: `${MY_VOTE} == row.option ? 'primary' : 'outline'` },
            size: 'sm',
            disabled: { $: 'block.closed || modules.polls.voting == block.id' },
            loading: { $: 'modules.polls.voting == block.id' },
            onClick: { $action: 'modules.polls.vote', args: [{ $: 'block.id' }, { $: 'row.option' }] },
          },
          children: [{ $: 'row.option' }],
        },
        {
          type: '$if',
          props: {
            condition: { $: REVEAL },
            then: {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-number', props: { value: { $: 'row.count' }, color: 'text-muted' } },
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-faint' },
                  children: [{ $: "plural(row.count, 'vote', 'votes')" }],
                },
              ],
            },
          },
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: REVEAL },
        then: {
          type: 'we-progress-bar',
          props: {
            value: { $: 'round(row.share * 100)' },
            variant: { $: "row.leading ? 'primary' : 'neutral'" },
            size: 'xs',
          },
        },
      },
    },
  ],
};

/**
 * A poll, drawn over the record bound as `block`.
 *
 * Its votes are one hoisted subscription per card, read by the tally, the reveal condition and every
 * row's button — one question asked once. `block.id` is the record's id whether the card is placed
 * from a query or inside a composed post, where the block renderer hands the key on as `id`.
 */
export const pollCard: SchemaNode = {
  type: 'Column',
  $queries: { votes: { entity: 'Vote', where: { pollId: { $: 'block.id' } } } },
  props: { gap: '300', p: 'surface', bg: 'surface', r: 'surface', border: '1px solid border' },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', ax: 'between' },
      children: [
        { type: 'we-text', props: { variant: 'heading-sm' }, children: [{ $: 'block.question' }] },
        {
          type: '$if',
          props: {
            condition: { $: 'block.closed' },
            then: { type: 'we-badge', props: { variant: 'neutral' }, children: ['Closed'] },
          },
        },
      ],
    },
    {
      type: '$each',
      props: { items: ROWS, as: 'row' },
      children: [optionRow],
    },
    {
      type: '$if',
      props: {
        condition: { $: `!(${REVEAL})` },
        then: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-faint' },
          children: ['Vote to see how others answered.'],
        },
      },
    },
  ],
};

/**
 * Ask a question. `record.create` from the template's own bag: making a poll is an ordinary write
 * the person causes with a click, which is exactly the case the module ships no wrapper for.
 */
export const pollComposer: SchemaNode = {
  type: 'Column',
  props: { gap: '300', p: 'surface', bg: 'surface-sunken', r: 'surface' },
  $localState: {
    question: { type: 'string', initial: '' },
    options: { type: 'string', initial: '' },
  },
  children: [
    {
      type: 'we-input',
      props: {
        placeholder: 'What would you like to ask?',
        value: { $: 'local.question' },
        onInput: { $setLocal: 'question', value: { $: 'event.detail' } },
      },
    },
    {
      type: 'we-input',
      props: {
        placeholder: 'Choices, separated by commas',
        value: { $: 'local.options' },
        onInput: { $setLocal: 'options', value: { $: 'event.detail' } },
      },
    },
    {
      type: 'Row',
      props: { ax: 'end' },
      children: [
        {
          type: 'we-button',
          props: {
            size: 'sm',
            disabled: { $: '!trim(local.question) || count(tally({ options: local.options })) < 2' },
            onClick: [
              {
                $action: 'record.create',
                args: ['Poll', { question: { $: 'trim(local.question)' }, options: { $: 'local.options' } }],
                onSuccess: [
                  { $setLocal: 'question', value: '' },
                  { $setLocal: 'options', value: '' },
                ],
              },
            ],
          },
          children: ['Ask'],
        },
      ],
    },
  ],
};

/**
 * The section: every poll in the space, newest first, with the composer above.
 *
 * A view a module contributes is enabled per space exactly as a built-in one is, and a space that
 * never turns it on never sees it — which is the whole of what a module may say about the address
 * space.
 */
export const pollsView: TemplateSchema = {
  id: 'polls',
  meta: {
    name: 'Polls',
    description: 'Questions put to the space, and how it answered.',
    icon: 'chart-bar',
    role: 'view',
    segment: 'polls',
    requires: { modules: ['polls'] },
  },
  type: 'Column',
  props: { width: '100%', ax: 'center' },
  $queries: { polls: { entity: 'Poll', order: { createdAt: 'desc' }, limit: 50 } },
  children: [
    {
      type: 'Column',
      props: { width: '100%', maxWidth: 'var(--we-layout-md)', gap: '400', px: '400', py: '500' },
      children: [
        pollComposer,
        {
          type: '$if',
          props: {
            condition: { $: 'local.pollsLoaded && !count(local.polls)' },
            then: {
              type: 'Column',
              props: { ax: 'center', gap: '200', p: '600' },
              children: [
                { type: 'we-icon', props: { name: 'chart-bar', size: 'lg', color: 'text-faint' } },
                { type: 'we-text', props: { color: 'text-faint' }, children: ['Nobody has asked anything yet.'] },
              ],
            },
          },
        },
        {
          type: '$each',
          props: { items: { $: 'local.polls' }, as: 'block' },
          children: [{ type: '$part', props: { id: 'polls.pollCard' } }],
        },
      ],
    },
  ],
};
