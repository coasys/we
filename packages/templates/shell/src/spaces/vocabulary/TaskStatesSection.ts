import type { SchemaNode } from '@we/schema-shared';
import { field, formModal, sectionCard, stateFill, stateFillFor, stateIcon } from '@we/template-kit';

/**
 * The states this community's work moves through.
 *
 * The third of the same kind, beside Signal Types and Connection Types, and the same act each time:
 * a community naming what it means by something, as data, in its own space. A signal type says what
 * a reaction here *is*; a connection type, what a link here *is*; a state, what a stage of work here
 * *is*.
 *
 * ## Why every state carries a semantic
 *
 * A name is for people and cannot be reasoned about. Once "Done" is "Shipped" and "Parked" sits
 * beside it, "what work is outstanding here" is answerable only by something that learned this
 * community's vocabulary — which is nothing: not another view, not a peer, not an agent. The
 * semantic is the small closed fact underneath the free one, and picking it is the one part of
 * adding a state that is not merely naming.
 *
 * Five values, sized by the questions that have to be answerable from outside a space — see the
 * table on `TaskState.semantic` — and the picker says what each is *for* rather than what it is
 * called, since the whole point is that the name is the community's and the meaning is shared.
 *
 * ## Why the defaults are shown but not stored
 *
 * A space starts with three states it has never written down. They are listed here as "default"
 * because they are real — every task in a new space holds one of their slugs — but nothing is
 * written until somebody acts on one: dragging it into an order, withdrawing it, or naming a state
 * with its slug. That act adopts it. Writing all three down the moment anybody added a fourth was
 * the alternative, and two members doing so on two nodes at once wrote six.
 *
 * ## What can be changed afterwards, and the one thing that cannot
 *
 * Everything except the slug. A state could be named and withdrawn and nothing else until now, which
 * meant a colour was settable exactly once — at creation — and the three states a space starts with,
 * which ship without one, could never have one at all. A name typed in a hurry, a semantic picked
 * wrongly, a glyph nobody likes: each was fixable only by withdrawing the state and making another,
 * which strands every task sitting in it.
 *
 * The slug stays put because that is what a task stores. Renaming carries — work in `todo` follows
 * "To do" to "Backlog" untouched — and that is the whole point of the two being separate.
 *
 * ## Why states are retired rather than deleted
 *
 * A task names its state by slug, so removing the state leaves the work holding a word nothing
 * defines. Unlike a connection type — where deleting leaves a connection that keeps its label and
 * loses its colour, a fair degradation — a task with an unrecognised state falls out of every
 * column. It is not lost (a board gathers those into a column of their own so they can be moved
 * somewhere real), but it is displaced, and displacing somebody's work to tidy a vocabulary
 * is not a trade this offers. `SignalType` reached the same conclusion first.
 */

/** A label over a control the kit's `field` has no case for. */
const labelled = (label: string, control: SchemaNode): SchemaNode => ({
  type: 'we-form-field',
  props: { label, width: '100%' },
  children: [control],
});

/** The names the four fields are held under, so one form serves both modals. */
interface StateFieldNames {
  name: string;
  semantic: string;
  icon: string;
  color: string;
}

/**
 * What a state is, as a form — written once and filled in twice.
 *
 * The create and edit modals ask exactly the same four questions and differ only in what they start
 * from and where they submit. Two copies of this drifted apart in every other vocabulary section
 * before anybody noticed, and the fields here are the ones most worth keeping in step: the semantic
 * select's wording is an explanation, and an explanation that exists twice is one that is wrong in
 * one place.
 */
function stateFields(names: StateFieldNames): SchemaNode[] {
  const chosen = `local.${names.color}`;
  return [
    field({ name: names.name, label: 'Name', placeholder: 'Blocked' }),
    /*
      What the rest of the app should read this as — not what it is called, and not literally what
      stage of work it is.

      These used to read "Not started / Being worked on / Finished", which asked about *history* and
      made naming "Blocked" confusing: blocked work has started, so nothing fitted. The question is
      whether work in this state is outstanding, and if so whether anybody is on it, which every
      state answers cleanly.
    */
    labelled('The rest of the app reads this as', {
      type: 'we-select',
      props: {
        value: { $: `local.${names.semantic}` },
        onChange: { $setLocal: names.semantic, value: { $: 'event.detail' } },
        options: [
          { label: 'Still to do — nobody on it', value: 'open' },
          { label: 'Being worked on', value: 'active' },
          { label: 'Stuck — waiting on something', value: 'blocked' },
          { label: 'Finished', value: 'done' },
          { label: 'Dropped — not finished, not outstanding', value: 'cancelled' },
        ],
      },
    }),
    {
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-muted' },
      children: [
        'What this state means to everything outside this board — another view, a peer, an agent asking what is outstanding. The name is yours; this is the part they read.',
      ],
    },
    // The vocabulary's own field, which nothing offered a way to set. A state with an icon reads at a
    // glance on a board heading; one without falls back to a shape derived from its semantic.
    labelled('Icon', {
      type: 'we-icon-picker',
      props: {
        value: { $: `local.${names.icon}` },
        onChange: { $setLocal: names.icon, value: { $: 'event.detail' } },
      },
    }),
    /*
      The colour, previewing the default rather than showing nothing.

      An unset colour is `''`, which paints the swatch as no colour at all — so the control for the
      one field with a sensible default was the one that showed nothing. It shows what the state
      *would* be drawn in instead, which follows the semantic select above as it changes.

      `clearable`, because a picker has no notion of none and this value is an override: the way back
      to the default belongs in the same popover as the way in. That is the same job the key panel's
      reset button does beside a row, in the place a modal has for it.
    */
    labelled('Colour', {
      type: 'we-color-picker',
      props: {
        tokens: true,
        clearable: true,
        value: { $: `${chosen} ? ${chosen} : ${stateFillFor(`local.${names.semantic}`)}` },
        onChange: { $setLocal: names.color, value: { $: 'event.detail' } },
      },
    }),
  ];
}

const createModal: SchemaNode = formModal({
  open: { $: 'local.createTaskStateOpen' },
  close: { $setLocal: 'createTaskStateOpen', value: false },
  title: 'New state',
  size: 'sm',
  localState: {
    stateName: { type: 'string', initial: '' },
    stateSemantic: { type: 'string', initial: 'open' },
    stateColor: { type: 'string', initial: '' },
    stateIcon: { type: 'string', initial: '' },
  },
  children: stateFields({ name: 'stateName', semantic: 'stateSemantic', icon: 'stateIcon', color: 'stateColor' }),
  disabled: { $: '!local.stateName' },
  // `stateSemantic` and `stateColor` both start set, so including them would fire the guard on a
  // form nobody has touched.
  discardWhen: { $: 'local.stateName' },
  submitLabel: 'Add state',
  submit: {
    $action: 'spaceStore.createTaskState',
    args: [
      {
        name: { $: 'local.stateName' },
        semantic: { $: 'local.stateSemantic' },
        color: { $: 'local.stateColor' },
        icon: { $: 'local.stateIcon' },
      },
    ],
  },
});

/** The state being edited, found by the slug the row's pencil wrote. */
const EDITING = 'find(spaceStore.taskStates, { slug: local.editTaskStateSlug })';

/**
 * Changing a state the community already has.
 *
 * One modal for the whole list rather than one per row: `$localState` names are fixed when the
 * template is written, so a boolean per row is unavailable for rows that come from data — the slug
 * is held instead, and the modal finds its state from it. That is the same shape `$toggleLocalIn`
 * exists for, one step simpler because only one row can be open at a time.
 *
 * The draft is seeded from the record, so `discardWhen` asks whether it *changed* rather than
 * whether it is filled in. A form seeded from a record and guarded the other way reports unsaved
 * work the moment it opens.
 *
 * Not the slug, which is what every task stores — see the docblock above.
 */
const editModal: SchemaNode = formModal({
  open: { $: 'local.editTaskStateSlug' },
  close: { $setLocal: 'editTaskStateSlug', value: '' },
  title: 'Edit state',
  size: 'sm',
  localState: {
    editName: { type: 'string', initial: { $: `${EDITING}.name` } },
    editSemantic: { type: 'string', initial: { $: `${EDITING}.semantic` } },
    editColor: { type: 'string', initial: { $: `${EDITING}.color` } },
    editIcon: { type: 'string', initial: { $: `${EDITING}.icon` } },
  },
  children: [
    ...stateFields({ name: 'editName', semantic: 'editSemantic', icon: 'editIcon', color: 'editColor' }),
    {
      // What renaming does and does not touch, where somebody is about to do it.
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-faint' },
      children: [{ $: '`Tasks store this state as “${' + EDITING + '.slug}”, whatever it is called.`' }],
    },
  ],
  disabled: { $: '!local.editName' },
  discardWhen: {
    $:
      `local.editName != ${EDITING}.name || local.editSemantic != ${EDITING}.semantic || ` +
      `local.editIcon != ${EDITING}.icon || local.editColor != ${EDITING}.color`,
  },
  submitLabel: 'Save',
  submit: {
    $action: 'spaceStore.updateTaskState',
    args: [
      { $: 'local.editTaskStateSlug' },
      {
        name: { $: 'local.editName' },
        semantic: { $: 'local.editSemantic' },
        color: { $: 'local.editColor' },
        icon: { $: 'local.editIcon' },
      },
    ],
  },
});

/**
 * How a semantic reads when it is not the state's own name.
 *
 * Every chain over `semantic` in the app ends in the outstanding branch rather than in an error, so a
 * value a peer's older code does not recognise reads as "still to do" — right for `blocked`, and for
 * `cancelled` an over-count of outstanding work rather than finished work quietly disappearing.
 */
const SEMANTIC_LABEL =
  "state.semantic == 'done' ? 'finished' : " +
  "state.semantic == 'cancelled' ? 'dropped' : " +
  "state.semantic == 'active' ? 'in flight' : " +
  "state.semantic == 'blocked' ? 'stuck' : 'not started'";

/*
 * The glyph chain and the colour chain were written out here too, and disagreed with the workshop
 * key's copies of the same two. They are `@we/template-kit`'s now — `stateIcon` and `stateFill` —
 * so a state is drawn the same way wherever it is shown, and the picker in this section's form
 * previews exactly what the canvas will paint.
 */

const stateRow: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center', width: '100%', py: '300', borderBottom: '1px solid border' },
  children: [
    /*
      The colour as a *fill*, which is what it is.

      It used to ink the glyph, from a chain whose fallbacks were text roles — fine while a colour
      could only be chosen at creation and rarely was, and wrong now that these are the colours a
      card is painted in: a fill chosen to sit behind a label is a poor colour to draw a 24px glyph
      with. The swatch shows the state as the canvas will draw it, and the glyph stays legible.
    */
    {
      type: 'Column',
      props: {
        width: '24px',
        height: '24px',
        r: '400',
        flexShrink: '0',
        bg: { $: stateFill('state') },
        border: '2px solid border',
      },
    },
    {
      type: 'we-icon',
      props: {
        // The community's own icon where it chose one, and the semantic's shape where it did not.
        name: { $: stateIcon('state') },
        color: 'text-muted',
      },
    },
    {
      type: 'Column',
      props: { gap: '100', flex: '1' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center', wrap: true },
          children: [
            { type: 'we-text', props: { fontWeight: '600' }, children: [{ $: 'state.name' }] },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted' },
              children: [{ $: SEMANTIC_LABEL }],
            },
            {
              type: '$if',
              props: {
                condition: { $: 'state.retired' },
                then: { type: 'we-badge', props: { size: 'xs' }, children: ['withdrawn'] },
              },
            },
            {
              /*
                A state the space has never written down.

                Worth showing rather than hiding: it is honest about the fallback — these three are
                what a space has until it decides otherwise — and it says what will happen: acting on
                one makes it the community's own.
              */
              type: '$if',
              props: {
                condition: { $: '!state.defined' },
                then: {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-faint' },
                  children: ['default'],
                },
              },
            },
          ],
        },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-faint' },
          children: [{ $: '`tasks store this as “${state.slug}”`' }],
        },
      ],
    },
    {
      type: 'we-tooltip',
      props: { content: 'Edit this state' },
      children: [
        {
          /*
            Everything about a state except its slug — and, until now, the only way to change any of
            it was to withdraw the state and make another, which strands the work sitting in it.

            By slug like its neighbour, and for the same reason: editing a default is the act that
            writes it down. Which is why this is offered on a default's row too, where there is no
            record yet to edit.
          */
          type: 'we-button',
          props: {
            label: 'Edit this state',
            size: 'xs',
            variant: 'ghost',
            onClick: { $setLocal: 'editTaskStateSlug', value: { $: 'state.slug' } },
          },
          children: [{ type: 'we-icon', props: { name: 'pencil-simple' } }],
        },
      ],
    },
    {
      type: 'we-tooltip',
      props: { content: { $: "state.retired ? 'Bring this state back' : 'Stop offering this state'" } },
      children: [
        {
          /*
        Withdraw, not delete. By slug, so a default can be withdrawn too: the store adopts it — writes
        the record — as part of the same act, which is the only moment a default becomes one.
      */
          type: 'we-button',
          props: {
            label: { $: "state.retired ? 'Bring this state back' : 'Stop offering this state'" },
            size: 'xs',
            variant: 'ghost',
            onClick: {
              $action: 'spaceStore.setTaskStateRetired',
              args: [{ $: 'state.slug' }, { $: '!state.retired' }],
            },
          },
          children: [
            { type: 'we-icon', props: { name: { $: "state.retired ? 'arrow-counter-clockwise' : 'eye-slash'" } } },
          ],
        },
      ],
    },
  ],
};

export const taskStatesSection: SchemaNode = sectionCard({
  title: 'Task States',
  description:
    'The stages work moves through here — "To do", "Blocked", "Shipped". Each becomes a column on the tasks board, and each says what it counts as so the rest of the app can still tell finished work from outstanding.',
  aside: {
    type: 'we-button',
    props: { variant: 'secondary', size: 'sm', onClick: { $setLocal: 'createTaskStateOpen', value: true } },
    children: [
      { type: 'we-icon', props: { name: 'plus' } },
      { type: 'we-text', children: ['Add State'] },
    ],
  },
  children: [
    {
      /*
        Drag to reorder, which is the order a board's columns appear in.

        Written as an ordered relation on the space rather than a number on each state — so two
        people reordering at once converge instead of one write discarding the other. That is the
        same reason a card's position lives on the board rather than on the task.

        The rows are keyed by slug rather than id, because a default has no id until it is placed in
        an order — and placing it is what adopts it.
      */
      type: 'we-sortable',
      props: {
        direction: 'vertical',
        width: '100%',
        onReorder: { $action: 'spaceStore.reorderTaskStates', args: [{ $: 'arg.detail' }] },
      },
      children: [
        {
          // From the store rather than a `$query`, because the list a space *uses* is not the list
          // it has written down: with none defined it is the defaults, and a query would show
          // nothing at all on exactly the spaces that most need explaining.
          type: '$each',
          props: { items: { $: 'spaceStore.taskStates' }, as: 'state' },
          children: [
            {
              // `data-we-id` on a native element: a component's props are assigned as DOM
              // properties, so the attribute the sortable looks for would never exist on one.
              type: 'div',
              props: { 'data-we-id': { $: 'state.slug' }, style: { width: '100%' } },
              children: [stateRow],
            },
          ],
        },
      ],
    },
    createModal,
    // One modal for the whole list, opened by whichever row's pencil was pressed — see `editModal`.
    editModal,
  ],
});
