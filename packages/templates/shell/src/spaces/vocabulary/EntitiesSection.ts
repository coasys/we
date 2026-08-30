import type { SchemaNode } from '@we/schema-shared';
import { confirmModal, sectionCard } from '@we/template-kit';

/**
 * The Models section of space settings: the content models this space defines, the wizard that
 * creates and edits them, and per-space tuning of interpretation hints — for the space's own
 * models and for the core vocabulary (tasks, events) alike.
 *
 * All form state lives in `shapeStore` rather than `$localState`: the wizard's rows are
 * structured, interdependent and validated as a whole (the `runtimeStore.aiForm` precedent), and
 * the LLM flow fills the same draft — both frontends share one review path. The only `$localState`
 * here is the delete confirmation, which is genuinely view-local.
 */

/**
 * How wide a default-value control is.
 *
 * Fixed rather than filling the panel: a default is a short value — a date, one of a handful of
 * words — and a full-width control reads as though a paragraph were expected. The number input opts
 * out and keeps its natural size, since it carries its own steppers and a few digits need no more.
 */
const DEFAULT_CONTROL_WIDTH = '220px';

/*
  Properties are scalars; content is a relation to a block.

  Which is why there is no Image or File here, and no Location: an image belongs to an ImageBlock,
  which carries alt text and dimensions and can be signalled on, commented on and drawn in the
  graph — none of which a URL in a string can do. The relationship picker already offers every
  block type, so those models are expressible today, by the route that makes them first-class.
*/
const PROPERTY_TYPE_OPTIONS = [
  { label: 'Text', value: 'text' },
  { label: 'Number', value: 'number' },
  { label: 'Boolean', value: 'boolean' },
  { label: 'Date', value: 'date' },
  { label: 'Select', value: 'select' },
];

/**
 * The grab area of a member row.
 *
 * A native element, twice over: the renderer assigns a web component's props as DOM *properties*,
 * so the `data-we-handle` attribute `we-sortable` looks for would never exist on a `we-button`;
 * and a native element is the one node type the validator has no prop list for, so the data
 * attribute is not reported as unknown. `tabindex` keeps the keyboard path open — Space on a
 * focused handle picks the row up, which is the whole reason the handle is focusable at all.
 */
const dragHandle: SchemaNode = {
  type: 'div',
  props: {
    'data-we-handle': '',
    tabindex: '0',
    title: 'Drag to reorder',
    // Given the height of one control rather than centred on the card: it grips the whole row, and
    // a property card grows and shrinks as its conditional inputs appear, so a centred handle would
    // drift up and down as you change a field's type. This keeps it level with the first line.
    style: {
      display: 'flex',
      alignItems: 'center',
      height: 'var(--we-component-height-sm)',
      cursor: 'grab',
    },
  },
  children: [{ type: 'we-icon', props: { size: 'sm', name: 'dots-six-vertical', color: 'text-faint' } }],
};

/**
 * A row's own buttons, held in its top-right corner — the drag handle's counterpart.
 *
 * A sibling of the content column rather than the last item inside it, for the reason the handle is
 * one: the controls wrap, and anything sharing a line with them wraps too. These buttons act on the
 * row as a whole, so a narrow modal that folded them underneath the fields made them read as
 * belonging to whichever field they had landed beside.
 *
 * Given the height of one control, like the handle, so both corners sit level with the first line
 * rather than drifting as the card grows.
 */
const rowActions = (buttons: SchemaNode[]): SchemaNode => ({
  type: 'Row',
  props: { gap: '100', ay: 'center', height: 'var(--we-component-height-sm)' },
  children: buttons,
});

/** Remove this member. Pinned top-right of the row rather than trailing its last input, which moves. */
const removeMemberButton: SchemaNode = {
  type: 'we-button',
  props: {
    variant: 'ghost',
    size: 'sm',
    // Square, like every icon-only button: the default's horizontal padding is sized for a word
    // beside the icon, which leaves a lozenge around a single glyph.
    square: true,
    onClick: { $action: 'shapeStore.removeMember', args: [{ $: 'member.rowId' }] },
  },
  children: [{ type: 'we-icon', props: { name: 'trash' } }],
};

/**
 * The shared name input — the one control both kinds of member row open with.
 *
 * The placeholder names the row's kind rather than teaching the camelCase spelling ("fieldName"):
 * these inputs carry no label, so the placeholder is doing label duty, and the identifier
 * validation already teaches the spelling at the moment it matters.
 */
const memberNameInput: SchemaNode = {
  type: 'we-input',
  props: {
    placeholder: { $: "member.kind == 'relationship' ? 'Relationship name…' : 'Property name…'" },
    width: '160px',
    size: 'sm',
    value: { $: 'member.name' },
    onInput: { $action: 'shapeStore.setMemberField', args: [{ $: 'member.rowId' }, 'name', { $: 'arg.detail' }] },
    // Typed member fields mutate in place (the focus concession), so reactive readers — the
    // generate button's guard among them — only learn a row was touched when the edit is published.
    onBlur: { $action: 'shapeStore.commitDraft' },
  },
};

/** Opens and closes a property's detail panel. Caret direction is the only state it shows. */
const expandToggle: SchemaNode = {
  type: 'we-button',
  props: {
    variant: 'ghost',
    size: 'sm',
    square: true,
    title: 'Show hint, default and options',
    onClick: { $action: 'shapeStore.toggleMemberExpanded', args: [{ $: 'member.rowId' }] },
  },
  children: [
    {
      type: 'we-icon',
      props: {
        name: { $: "member.rowId in shapeStore.expandedMembers ? 'caret-up' : 'caret-down'" },
      },
    },
  ],
};

/**
 * The default-value control, chosen by the property's type.
 *
 * Each branch exists to delete a validation rule rather than to decorate: a number input cannot
 * produce "not a valid number", a date picker emits the `YYYY-MM-DD` the rest of the system reads,
 * and picking from a select's own declared options cannot produce a default that is not one of
 * them. What the manifest stores is unchanged — the draft holds text either way, coerced once at
 * lowering by the declared type.
 */
const defaultValueControl: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: "member.type == 'number'" },
    then: {
      type: 'we-number-input',
      props: {
        size: 'sm',
        // Content width, measured in a browser rather than guessed at: the host is block-level, so
        // in a form field's column it fills the row unless told not to, and only an inline style —
        // which a DS prop becomes — beats the design system's own sheet. The field inside sizes
        // itself from the number, so this grows for a long one instead of clipping it.
        width: 'fit-content',
        placeholder: 'None',
        value: { $: 'member.defaultValue' },
        onChange: {
          $action: 'shapeStore.setMemberField',
          args: [{ $: 'member.rowId' }, 'defaultValue', { $: 'arg.detail' }],
        },
      },
    },
    else: {
      type: '$if',
      props: {
        condition: { $: "member.type == 'date'" },
        then: {
          type: 'we-date-picker',
          props: {
            size: 'sm',
            width: DEFAULT_CONTROL_WIDTH,
            // One timestamp type rather than two. The time is optional — a day with none given
            // stays a bare date — so the same field serves a birthday and a shift start, and the
            // value records which was meant. Splitting them would buy nothing: nothing enforces a
            // scalar type, since the compiler never reads one.
            showTime: true,
            value: { $: 'member.defaultValue' },
            onChange: {
              $action: 'shapeStore.setMemberField',
              args: [{ $: 'member.rowId' }, 'defaultValue', { $: 'arg.detail' }],
            },
          },
        },
        else: {
          type: '$if',
          props: {
            // Both the closed vocabularies: a select's declared options, and a boolean's true/false.
            // Each list carries its own "None" entry, since unset is a third answer the
            // manifest distinguishes from false.
            condition: { $: "member.type == 'select' || member.type == 'boolean'" },
            then: {
              type: 'we-select',
              props: {
                size: 'sm',
                // Fitted, not fixed: these options are a handful of short words — true/false, or
                // the values this very field declares — so a control sized for user text would be
                // mostly empty. `fit` measures the widest option rather than the current one, so
                // picking one never resizes the row.
                fit: true,
                placeholder: 'None',
                // Through the store rather than off `$member`: the row is mutated in place while
                // its values are typed, so anything read from the row itself cannot update.
                options: { $: 'find(shapeStore.memberOptions, { rowId: member.rowId }).options' },
                value: { $: 'member.defaultValue' },
                onChange: {
                  $action: 'shapeStore.setMemberField',
                  args: [{ $: 'member.rowId' }, 'defaultValue', { $: 'arg.detail' }],
                },
              },
            },
            else: {
              type: 'we-input',
              props: {
                size: 'sm',
                width: DEFAULT_CONTROL_WIDTH,
                placeholder: 'None',
                value: { $: 'member.defaultValue' },
                onInput: {
                  $action: 'shapeStore.setMemberField',
                  args: [{ $: 'member.rowId' }, 'defaultValue', { $: 'arg.detail' }],
                },
              },
            },
          },
        },
      },
    },
  },
};

/**
 * What a property carries beyond its structure, behind a caret.
 *
 * Split out because the six inputs were never equally important: a name, a type and whether it is
 * required are structural and always relevant, while a hint, a default and a value list are
 * secondary and usually empty. Left on one line they competed for the same space, which is what
 * made a six-field model unreadable. Labelled here, where there is room for labels.
 */
const propertyDetail: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'member.rowId in shapeStore.expandedMembers' },
    enterTransition: [
      { type: 'reveal', duration: 200 },
      { type: 'fade', duration: 150 },
    ],
    then: {
      type: 'Column',
      props: { gap: '300', pt: '200' },
      children: [
        {
          type: '$if',
          props: {
            condition: { $: "member.type == 'select'" },
            then: {
              type: 'we-form-field',
              props: { label: 'Allowed values', description: 'Comma-separated. The only values this field accepts.' },
              children: [
                {
                  type: 'we-input',
                  props: {
                    size: 'sm',
                    placeholder: 'fiction, non-fiction, poetry',
                    value: { $: 'member.options' },
                    onInput: {
                      $action: 'shapeStore.setMemberField',
                      args: [{ $: 'member.rowId' }, 'options', { $: 'arg.detail' }],
                    },
                    // The default picker below is built from these, so the edit is published when
                    // it is finished rather than on every keystroke.
                    onBlur: { $action: 'shapeStore.commitDraft' },
                  },
                },
              ],
            },
          },
        },
        // Default before hint: the panel then reads as allowed values → the value picked from them
        // → the prose about the field, shortest to longest, structure before guidance.
        {
          type: 'we-form-field',
          props: { label: 'Default value', description: 'What a new entry starts with.' },
          children: [defaultValueControl],
        },
        {
          type: 'we-form-field',
          props: {
            label: 'AI hint',
            description: 'What goes in this field: allowed values, formats, what to leave out.',
          },
          children: [
            {
              type: 'we-textarea',
              props: {
                rows: 2,
                size: 'sm',
                placeholder: 'The title as spoken, without a subtitle.',
                value: { $: 'member.hint' },
                onInput: {
                  $action: 'shapeStore.setMemberField',
                  args: [{ $: 'member.rowId' }, 'hint', { $: 'arg.detail' }],
                },
                onBlur: { $action: 'shapeStore.commitDraft' },
              },
            },
          ],
        },
      ],
    },
  },
};

/**
 * One property row — a scalar field of the model being defined.
 *
 * Three columns, and the outer one never wraps: the handle, everything the row declares, and the
 * buttons that act on the row as a whole. The buttons sat inside the content column once, held
 * right by `ax: 'between'` — which pins them only while the fields beside them fit, and folded them
 * underneath at any width where they did not.
 */
const propertyRow: SchemaNode = {
  type: 'Row',
  // neutral-0, not neutral-50: neutral-50 is what `we-input` fills itself with, so a card painted
  // in it made every field disappear into its own container. Surfaces take the surface step and
  // controls keep their recessed one — see the note on `relationshipRow` for the tinted case.
  props: { gap: '200', p: '300', bg: 'surface-sunken', r: '300', border: '1px solid border', ay: 'start' },
  children: [
    dragHandle,
    {
      type: 'Column',
      /*
        No `gap` — the two children below the header animate their own height, and a flex gap cannot.

        Gap is a step function of how many children are mounted: expanding mounts the detail panel,
        adding 8px in the frame before either reveal has moved, and unmounting the hint preview takes
        8px back in a single frame 200ms later. A smooth animation bracketed by two instant 8px steps
        is the jolt. Each child carries that spacing as its own top padding instead, which sits
        inside the revealed box and so animates with it.
      */
      props: { flex: '1', minWidth: '0' },
      children: [
        {
          type: 'Row',
          props: { gap: '300', ay: 'center', wrap: true },
          children: [
            memberNameInput,
            {
              type: 'we-select',
              props: {
                size: 'sm',
                width: '130px',
                options: PROPERTY_TYPE_OPTIONS,
                value: { $: 'member.type' },
                onChange: {
                  $action: 'shapeStore.setMemberField',
                  args: [{ $: 'member.rowId' }, 'type', { $: 'arg.detail' }],
                },
              },
            },
            /*
                  A checkbox, not a switch.

                  A switch says "this takes effect now", which is a setting; required-ness is a
                  property of a record being filled in, which is a form control. It is also narrower
                  and — unlike a switch labelled Optional on one side and Required on the other — a
                  fixed width, so toggling it cannot shift where this wrapping row breaks. The
                  unchecked state needs no word of its own: an unticked "Required" says it.
                */
            {
              type: 'we-checkbox',
              props: {
                size: 'sm',
                checked: { $: 'member.required' },
                onChange: {
                  $action: 'shapeStore.setMemberField',
                  args: [{ $: 'member.rowId' }, 'required', { $: 'arg.detail' }],
                },
              },
              children: [{ type: 'we-text', props: { variant: 'label' }, children: ['Required'] }],
            },
          ],
        },
        /*
          The hint, readable without opening the row.

          A generated model's hints are the part most worth checking before it is adopted, which is
          why generation used to expand every row it produced — eight tall cards between the author
          and the Save button, to show one line each. Shown here, the same reading is available in
          the list itself, and expanding goes back to meaning "I want to edit this".

          Hidden while the row is open, because the editor below is then showing the same text.

          **The expansion check comes first, and must.** `$and` short-circuits, and only the
          expansion is reactive — `$member.hint` is a plain read off a row that mutates in place.
          Written the other way round, a row that mounts *without* a hint (every hand-added one)
          fails on the first operand, never reaches the store read, and so ends up a condition with
          no reactive dependency at all: it never re-evaluates, and the line can never appear however
          much is typed. Leading with the store read makes every toggle re-run this, which re-reads
          the hint as it now stands.

          Both transitions match `propertyDetail`'s: the two heights change in opposite directions on
          the same click, so without them the line vanishes in one frame while the panel eases open
          — the row jerks down, then grows. Moving together, it just grows.
        */
        {
          type: '$if',
          props: {
            condition: { $: '!(member.rowId in shapeStore.expandedMembers) && member.hint' },
            enterTransition: [
              { type: 'reveal', duration: 200 },
              { type: 'fade', duration: 150 },
            ],
            exitTransition: [
              { type: 'reveal', duration: 200 },
              { type: 'fade', duration: 150 },
            ],
            then: {
              type: 'we-text',
              props: {
                variant: 'footnote',
                color: 'text-faint',
                // Its own spacing, since the Column has no gap to give it — see the note there.
                pt: '200',
                truncate: true,
                /*
                  `truncate` says the intent; this pins it.

                  Something in the running app relaxes the truncation on hover — a long hint reflowed
                  to two lines under the pointer, so a cursor travelling down the list grew and shrank
                  each row it crossed. It survived a search of every `:hover` rule in the design
                  system, the interop stylesheet (which needs `hoverProps` to apply at all, and none
                  are set here), `we-sortable` and the themes, so the rule was never found by reading.

                  `styles` lands inline on [part='base'], which no stylesheet :hover rule can outrank
                  without `!important`. That makes the fix independent of a cause I could not name —
                  the honest trade for chasing it further through a surface this large.
                */
                styles: { 'white-space': 'nowrap', overflow: 'hidden', 'text-overflow': 'ellipsis' },
              },
              children: [{ $: 'member.hint' }],
            },
          },
        },
        propertyDetail,
      ],
    },
    rowActions([expandToggle, removeMemberButton]),
  ],
};

/**
 * One relationship row — an edge to another model.
 *
 * Deliberately shorter than a property row rather than a property row with half its inputs hidden:
 * a relation carries a target and a cardinality and nothing else, so there is no type, no default,
 * and no hint to show. That asymmetry is why the two are separate rows at all.
 */
const relationshipRow: SchemaNode = {
  type: 'Row',
  // A tint is fine where a fill is not: primary-50 is a different step from the neutral-50 that
  // `we-input` paints itself, so the fields still read as recessed against it.
  props: { gap: '200', p: '300', bg: 'accent-muted', r: '300', border: '1px solid accent-muted', ay: 'start' },
  children: [
    dragHandle,
    {
      type: 'Column',
      props: { gap: '200', flex: '1', minWidth: '0' },
      children: [
        {
          type: 'Row',
          props: { gap: '300', ay: 'center', wrap: true },
          children: [
            memberNameInput,
            { type: 'we-icon', props: { name: 'arrow-right', color: 'text-faint' } },
            {
              type: 'we-select',
              props: {
                size: 'sm',
                width: '260px',
                searchable: true,
                // "Links to", because that is literally what it is here — a perspective is made
                // of links. No persistent label: the arrow icon beside the picker carries the
                // direction once a target is chosen.
                placeholder: 'Links to…',
                options: { $: 'shapeStore.relationshipTargets' },
                value: { $: 'member.target' },
                onChange: {
                  $action: 'shapeStore.setMemberField',
                  args: [{ $: 'member.rowId' }, 'target', { $: 'arg.detail' }],
                },
              },
            },
            {
              type: 'we-switch',
              props: {
                size: 'sm',
                labelOff: 'One',
                labelOn: 'Many',
                checked: { $: 'member.many' },
                onChange: {
                  $action: 'shapeStore.setMemberField',
                  args: [{ $: 'member.rowId' }, 'many', { $: 'arg.detail' }],
                },
              },
            },
          ],
        },
      ],
    },
    rowActions([removeMemberButton]),
  ],
};

/**
 * One row of the members list, wrapped for drag-to-reorder.
 *
 * `data-we-id` goes on a native div for the same two reasons the handle does — a web component
 * would never carry the attribute, and the validator has no prop list for a native element.
 */
const memberRow: SchemaNode = {
  type: 'div',
  props: { 'data-we-id': { $: 'member.rowId' }, style: { width: '100%' } },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: "member.kind == 'relationship'" },
        then: relationshipRow,
        else: propertyRow,
      },
    },
  ],
};

/**
 * Fill in what has not been written yet — the model's fields, and any of its description, hint and
 * icon left blank.
 *
 * Offered on new models only: generation replaces the member list wholesale, which on a stored model
 * would orphan the predicates its data lives under (the additive guard refuses it at save anyway).
 *
 * The label names what the press would do, and the store has already worked that out — 'none' and
 * 'generate' both read "Generate", since a disabled button and an enabled one should describe the
 * same act; the two re-run states read "Regenerate", because there is something there to replace.
 */
const generateButton: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: '!shapeStore.editingShapeId && shapeStore.aiAvailable' },
    then: {
      type: 'we-button',
      props: {
        variant: 'secondary',
        title: 'Fill in the fields from the name and description — and anything above still left blank',
        loading: { $: 'shapeStore.generating' },
        // 'none' is the only state with nothing to work from. A generation that would discard
        // written rows stays clickable and asks instead — refusing the click outright is what made
        // the first attempt the only attempt.
        disabled: { $: "shapeStore.generating || shapeStore.generateIntent == 'none'" },
        onClick: { $action: 'shapeStore.requestGenerateFields' },
      },
      children: [
        { type: 'we-icon', props: { name: 'sparkle' } },
        {
          type: 'we-text',
          children: [{ $: "shapeStore.generateIntent in ['regenerate', 'replace'] ? 'Regenerate' : 'Generate'" }],
        },
      ],
    },
  },
};

/** The wizard: create or edit one model. Mounted while `shapeStore.shapeDraft` is non-null. */
const shapeWizardModal: SchemaNode = {
  type: 'we-modal',
  // Backdrop and close button both route through the guard — that click was the way a half-written
  // model got thrown away.
  // `lg` because a member row is a form in itself and the rows wrapped at anything narrower. The
  // hand-written `min(850px, 92vw)` this replaced was the modal reinventing its own gutter, which
  // `size` now carries for every modal — and the 850 included the padding, which is why it looked
  // like a number nobody could have guessed.
  props: { size: 'lg', close: { $action: 'shapeStore.requestCloseWizard' } },
  children: [
    {
      type: 'we-text',
      slot: 'header',
      props: { variant: 'heading-md', textAlign: 'center' },
      children: [{ $: "shapeStore.editingShapeId ? 'Edit model' : 'New model'" }],
    },
    {
      type: 'Column',
      props: { gap: '400' },
      children: [
        /*
          Identity, and the one-click route out of filling the rest in by hand.

          The generate button lives here rather than over the field list it produces, because what it
          produces is not only fields: it answers the description, the AI hint and the icon too, for
          anything left blank. Beside the name it is reachable the moment there is a name to work
          from — type "BookRecommendation", press it, review what comes back — which is the flow this
          form is actually for. It could not sit here while generation was one-shot, since spending
          the only attempt on a bare name was a trap; it re-runs freely now, so an early press costs
          nothing.

          Icon first, name second: they are one identity pair (the models list below draws a shape
          the same way), and generation fills the icon — so it appears right beside the name that
          produced it, where the press happened.

          `ay: 'end'` because a `we-form-field` stacks its label above its control: centred, a bare
          button aligns to the middle of label-plus-input and floats above the line it belongs to.
        */
        {
          type: 'Row',
          props: { gap: '300', ay: 'end', wrap: true },
          children: [
            {
              type: 'we-form-field',
              props: { label: 'Icon' },
              children: [
                {
                  type: 'we-icon-picker',
                  props: {
                    value: { $: 'shapeStore.shapeDraft.icon' },
                    onChange: { $action: 'shapeStore.setShapeField', args: ['icon', { $: 'arg.detail' }] },
                  },
                },
              ],
            },
            {
              type: 'we-form-field',
              props: { label: 'Name', flex: '1' },
              children: [
                {
                  type: 'we-input',
                  props: {
                    // Runs the words together on purpose: it is the spelling the field accepts, and
                    // the placeholder is the first place anyone learns that multi-word names are fine.
                    placeholder: 'BookRecommendation',
                    value: { $: 'shapeStore.shapeDraft.name' },
                    // Renaming changes what queries resolve, so an existing model's name is fixed.
                    disabled: { $: 'shapeStore.editingShapeId' },
                    onInput: { $action: 'shapeStore.setShapeField', args: ['name', { $: 'arg.detail' }] },
                  },
                },
              ],
            },
            generateButton,
          ],
        },
        {
          type: 'we-form-field',
          props: { label: 'Description' },
          children: [
            {
              type: 'we-textarea',
              props: {
                rows: 1,
                placeholder: 'A book someone in the group recommended',
                value: { $: 'shapeStore.shapeDraft.description' },
                onInput: { $action: 'shapeStore.setShapeField', args: ['description', { $: 'arg.detail' }] },
              },
            },
          ],
        },
        {
          type: 'we-form-field',
          props: {
            label: 'AI hint',
            description: 'Helps AI recognise these entries in conversations and create them automatically.',
          },
          children: [
            {
              type: 'we-textarea',
              props: {
                rows: 2,
                // Shows the include-then-exclude shape a workable hint needs, which is easier to
                // copy than to explain (see TaskBlock's rationale in @we/entities).
                placeholder:
                  'Only counts when someone is actually recommending it, not books merely mentioned. Use the title as spoken, and the author if said.',
                value: { $: 'shapeStore.shapeDraft.classHint' },
                onInput: { $action: 'shapeStore.setShapeField', args: ['classHint', { $: 'arg.detail' }] },
              },
            },
          ],
        },
        {
          type: 'Column',
          props: { gap: '200' },
          children: [
            { type: 'we-text', props: { variant: 'label' }, children: ['Fields'] },
            {
              type: '$if',
              props: {
                condition: { $: '!count(shapeStore.shapeDraft.members)' },
                then: {
                  type: 'Column',
                  props: {
                    ax: 'center',
                    py: '400',
                    px: '400',
                    r: '300',
                    border: '1px dashed border-strong',
                    gap: '100',
                  },
                  children: [
                    {
                      type: 'we-text',
                      props: { color: 'text-faint' },
                      children: ['No properties or relationships yet.'],
                    },
                    /*
                      The one place the greyed-out Generate button can be explained.

                      A disabled control does not reliably raise its own tooltip — browsers drop
                      pointer events on it — so "why can I not press that?" has nowhere else to be
                      answered. Said here, where an empty field list is already being remarked on.
                    */
                    {
                      type: '$if',
                      props: {
                        condition: { $: 'shapeStore.aiAvailable' },
                        then: {
                          type: 'we-text',
                          props: { variant: 'footnote', color: 'text-faint', textAlign: 'center' },
                          children: ['Add one below, or name the model above and press Generate.'],
                        },
                        else: {
                          type: 'we-text',
                          props: { variant: 'footnote', color: 'text-faint', textAlign: 'center' },
                          children: [
                            'Configure a language model in Settings \u2192 AI to generate fields from a description.',
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            },
            {
              type: 'we-sortable',
              props: {
                direction: 'vertical',
                gap: 'var(--we-space-200)',
                width: '100%',
                // Order is the declaration order the manifest stores, and will be the field order
                // of the derived creation form — so reordering is data, not decoration.
                onReorder: { $action: 'shapeStore.reorderMembers', args: [{ $: 'arg.detail' }] },
              },
              children: [
                {
                  type: '$each',
                  props: { items: { $: 'shapeStore.shapeDraft.members' }, as: 'member' },
                  children: [memberRow],
                },
              ],
            },
            {
              type: 'Row',
              props: { gap: '200', wrap: true },
              children: [
                {
                  type: 'we-button',
                  props: { variant: 'outline', size: 'sm', onClick: { $action: 'shapeStore.addProperty' } },
                  children: [
                    { type: 'we-icon', props: { name: 'plus' } },
                    { type: 'we-text', children: ['Add property'] },
                  ],
                },
                {
                  type: 'we-button',
                  props: { variant: 'outline', size: 'sm', onClick: { $action: 'shapeStore.addRelationship' } },
                  children: [
                    { type: 'we-icon', props: { name: 'arrow-right' } },
                    { type: 'we-text', children: ['Add relationship'] },
                  ],
                },
              ],
            },
          ],
        },
        /*
          Whether an interpreter may write into this model — the switch that makes the hint above
          mean something.

          Here rather than beside the hint, and immediately before the identifying field, because
          the three read as one decision in the order they are made: what this is, whether AI may
          create them, and how it recognises one it has already created. Off by default: a model
          somebody curates by hand should not have an interpreter minting rows into it, and every
          model an extraction pass names puts its whole shape into the prompt at the community's
          expense.

          Ticking it does two things, deliberately. It marks the *model* extractable, which travels
          with the definition — so a fork of it lands in another space as something that space may
          switch on. And it adds this model to *this* space's default targets on save, because
          whoever ticked the box is the community saying yes, now; asking the same question again in
          Settings would be two affordances for one intent. A model that arrives already marked —
          copied, forked, synced from a peer — is only ever a candidate, and never starts writing
          into a space unasked.
        */
        {
          type: 'Column',
          props: { gap: '200', p: '400', bg: 'surface-sunken', r: '300', border: '1px solid border' },
          children: [
            {
              type: 'Row',
              props: { width: '100%', gap: '400', ay: 'center' },
              children: [
                {
                  type: 'Column',
                  props: { gap: '100', flex: '1' },
                  children: [
                    { type: 'we-text', props: { variant: 'label' }, children: ['Let AI create these'] },
                    {
                      type: 'we-text',
                      props: { variant: 'footnote', color: 'text-faint' },
                      children: [
                        'Extraction passes over this space’s calls may create entries of this model from what was said, and saving adds it to what calls here look for by default. Leave off for a model your community fills in by hand.',
                      ],
                    },
                  ],
                },
                {
                  type: 'we-switch',
                  props: {
                    size: 'sm',
                    checked: { $: 'shapeStore.shapeDraft.extractable' },
                    // Bare `event.detail` — an operator around it would resolve at render time,
                    // before the event exists.
                    onChange: { $action: 'shapeStore.setExtractable', args: [{ $: 'event.detail' }] },
                  },
                },
              ],
            },
            /*
              The warning, and why it is a warning rather than a refusal.

              A model with no identifying field still extracts perfectly well — it simply has no way
              to recognise what it wrote last time, so every pass mints fresh copies of everything it
              finds. That is a real cost and a recoverable one, and the fix is one field below this,
              so saying so beats refusing the save. Gated on the store rather than composed from two
              reads here, because "what makes extraction converge" is knowledge about the model layer
              and not about this form.
            */
            {
              type: '$if',
              props: {
                condition: { $: 'shapeStore.extractionNeedsIdentity' },
                then: {
                  type: 'we-alert',
                  props: { variant: 'warning' },
                  children: [
                    'Without an identifying field below, every extraction pass will create fresh entries rather than recognising ones it already made.',
                  ],
                },
              },
            },
          ],
        },
        {
          type: 'we-form-field',
          /*
            Not "Unique field", tempting as it is: nothing enforces uniqueness here, and that name
            promises a save will be refused for a repeat. "Identifying field" names the role the
            field plays without claiming a constraint — and stays a short noun phrase, like every
            other label in this form.
          */
          props: {
            label: 'Identifying field',
            description:
              'When AI extraction finds one of these, it compares this field to decide whether it has seen it before. Leave as None if nothing about these names one uniquely.',
          },
          children: [
            {
              type: 'we-select',
              props: {
                size: 'sm',
                width: '240px',
                options: { $: 'shapeStore.identityOptions' },
                value: { $: "shapeStore.shapeDraft.identityMember ? shapeStore.shapeDraft.identityMember : 'none'" },
                onChange: { $action: 'shapeStore.setIdentityMember', args: [{ $: 'arg.detail' }] },
              },
            },
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $: 'count(shapeStore.draftErrors)' },
            then: {
              type: 'Column',
              props: { gap: '100' },
              children: [
                {
                  type: '$each',
                  props: { items: { $: 'shapeStore.draftErrors' }, as: 'error' },
                  children: [{ type: 'we-alert', props: { variant: 'danger' }, children: [{ $: 'error' }] }],
                },
              ],
            },
          },
        },
      ],
    },
    {
      type: 'Row',
      slot: 'footer',
      props: { ax: 'end', gap: '200' },
      children: [
        {
          type: 'we-button',
          props: { variant: 'ghost', onClick: { $action: 'shapeStore.requestCloseWizard' } },
          children: ['Cancel'],
        },
        {
          type: 'we-button',
          props: {
            variant: 'primary',
            loading: { $: 'shapeStore.savingShape' },
            disabled: { $: 'shapeStore.savingShape' },
            onClick: { $action: 'shapeStore.saveShapeDraft' },
          },
          children: [{ $: "shapeStore.editingShapeId ? 'Save changes' : 'Create model'" }],
        },
      ],
    },
  ],
};

/** Per-space hint tuning for one entity. Mounted while `shapeStore.hintEditor` is non-null. */
const hintEditorModal: SchemaNode = {
  type: 'we-modal',
  // Title and actions slotted: a model with many properties scrolls its hint rows, never the
  // heading that says whose hints these are or the buttons that save them. `lg` for the same
  // reason as the wizard — a hint row is a label over a full-width field.
  props: { size: 'lg', close: { $action: 'shapeStore.closeHintEditor' } },
  children: [
    {
      type: 'Row',
      slot: 'header',
      props: { gap: '200', ay: 'center', ax: 'between' },
      children: [
        {
          type: 'we-text',
          props: { variant: 'heading-sm' },
          children: [{ $: '`AI hints — ${shapeStore.hintEditor.entity}`' }],
        },
        {
          type: '$if',
          props: {
            condition: { $: 'shapeStore.hintEditor.customized' },
            then: { type: 'we-badge', props: { variant: 'primary' }, children: ['Customized for this space'] },
            else: { type: 'we-badge', props: { variant: 'neutral' }, children: ['Using defaults'] },
          },
        },
      ],
    },
    {
      type: 'Column',
      props: { gap: '400' },
      children: [
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-faint' },
          children: [
            'These hints steer AI extraction in this space. Once customized, they stay as this community set them — updates to the defaults no longer apply until you reset.',
          ],
        },
        {
          type: 'we-form-field',
          props: { label: 'What counts as one of these' },
          children: [
            {
              type: 'we-textarea',
              props: {
                rows: 3,
                value: { $: 'shapeStore.hintEditor.classHint' },
                onInput: { $action: 'shapeStore.setHintDraft', args: ['class', { $: 'arg.detail' }] },
              },
            },
          ],
        },
        {
          type: '$each',
          props: { items: { $: 'shapeStore.hintEditor.rows' }, as: 'row' },
          children: [
            {
              type: 'we-form-field',
              props: { label: { $: 'row.name' } },
              children: [
                {
                  type: 'we-textarea',
                  props: {
                    rows: 2,
                    placeholder: 'No hint — the AI sees only the field name and type',
                    value: { $: 'row.hint' },
                    onInput: {
                      $action: 'shapeStore.setHintDraft',
                      args: [{ $: 'row.predicate' }, { $: 'arg.detail' }],
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'Row',
      slot: 'footer',
      props: { ax: 'between', gap: '200', ay: 'center' },
      children: [
        {
          type: '$if',
          props: {
            condition: { $: 'shapeStore.hintEditor.customized' },
            then: {
              type: 'we-button',
              props: {
                variant: 'ghost',
                loading: { $: 'shapeStore.hintBusy' },
                onClick: { $action: 'shapeStore.resetHintEditor' },
              },
              children: [
                { type: 'we-icon', props: { name: 'arrows-clockwise' } },
                { type: 'we-text', children: ['Reset to defaults'] },
              ],
            },
            else: { type: 'div' },
          },
        },
        {
          type: 'Row',
          props: { gap: '200' },
          children: [
            {
              type: 'we-button',
              props: { variant: 'ghost', onClick: { $action: 'shapeStore.closeHintEditor' } },
              children: ['Cancel'],
            },
            {
              type: 'we-button',
              props: {
                variant: 'primary',
                loading: { $: 'shapeStore.hintBusy' },
                disabled: { $: 'shapeStore.hintBusy' },
                onClick: { $action: 'shapeStore.saveHintEditor' },
              },
              children: ['Save for this space'],
            },
          ],
        },
      ],
    },
  ],
};

/** One space-defined model in the list. */
const shapeRow: SchemaNode = {
  type: 'Column',
  props: { gap: '100', py: '200' },
  children: [
    {
      type: 'Row',
      props: { gap: '300', ay: 'center', ax: 'between', wrap: true },
      children: [
        {
          type: 'Row',
          props: { gap: '300', ay: 'center' },
          children: [
            {
              type: 'we-icon',
              props: {
                name: { $: "shape.icon ? shape.icon : 'cube'" },
                color: 'accent-text',
              },
            },
            {
              type: 'Column',
              props: { gap: '0' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '200', ay: 'center' },
                  children: [
                    { type: 'we-text', props: { fontWeight: 'semibold' }, children: [{ $: 'shape.name' }] },
                    {
                      type: 'we-badge',
                      props: { variant: 'neutral', size: 'xs' },
                      children: [
                        {
                          $: "`${shape.propertyCount} ${plural(shape.propertyCount, 'field', 'fields')} · v${shape.version}`",
                        },
                      ],
                    },
                  ],
                },
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-faint' },
                  children: [{ $: 'shape.description' }],
                },
              ],
            },
          ],
        },
        {
          type: 'Row',
          props: { gap: '100' },
          children: [
            {
              type: 'we-button',
              props: {
                variant: 'ghost',
                size: 'sm',
                onClick: { $action: 'shapeStore.openHintEditor', args: [{ $: 'shape.name' }] },
              },
              children: [
                { type: 'we-icon', props: { name: 'sparkle' } },
                { type: 'we-text', children: ['AI hints'] },
              ],
            },
            {
              type: 'we-button',
              // Square for the same reason as the wizard's row buttons — an icon with no word
              // beside it should not sit in padding meant for one.
              props: {
                variant: 'ghost',
                size: 'sm',
                square: true,
                onClick: { $action: 'shapeStore.openShapeWizard', args: [{ $: 'shape.id' }] },
              },
              children: [{ type: 'we-icon', props: { name: 'pencil-simple' } }],
            },
            {
              type: 'we-button',
              props: {
                variant: 'ghost',
                size: 'sm',
                square: true,
                /*
                  No `confirmModal`: the host raises its own in front of every destructive store
                  action, from the tier boundary. This one used to be gated on the row's id rather
                  than a boolean, because a list needs to say *which* — a question the host's dialog
                  does not have, since it is handed the arguments of the call it is guarding.
                  See DestructivePrompt.schema.ts.
                */
                onClick: { $action: 'shapeStore.deleteShape', args: [{ $: 'shape.id' }] },
              },
              children: [{ type: 'we-icon', props: { name: 'trash' } }],
            },
          ],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'count(shape.problems)' },
        then: {
          type: '$each',
          props: { items: { $: 'shape.problems' }, as: 'problem' },
          children: [{ type: 'we-alert', props: { variant: 'warning' }, children: [{ $: 'problem' }] }],
        },
      },
    },
  ],
};

/** One core entity offering hint tuning. */
const hintEntityRow: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center', ax: 'between', py: '100' },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: 'package', color: 'text-muted' } },
        { type: 'we-text', children: [{ $: 'entity.entity' }] },
        { type: 'we-badge', props: { variant: 'neutral', size: 'xs' }, children: ['Built-in'] },
      ],
    },
    {
      type: 'we-button',
      props: {
        variant: 'ghost',
        size: 'sm',
        onClick: { $action: 'shapeStore.openHintEditor', args: [{ $: 'entity.entity' }] },
      },
      children: [
        { type: 'we-icon', props: { name: 'sparkle' } },
        { type: 'we-text', children: ['AI hints'] },
      ],
    },
  ],
};

/**
 * "Discard this?" — the guard on closing the wizard.
 *
 * Mounted beside the wizard rather than inside it, so it survives the modal it is asking about and
 * is not itself dismissed by the backdrop click that raised the question.
 */
const discardConfirmModal: SchemaNode = confirmModal({
  open: { $: 'shapeStore.confirmDiscard' },
  close: { $action: 'shapeStore.cancelDiscard' },
  title: 'Discard this model?',
  body: 'What you have filled in will be lost. Nothing has been saved to the space yet.',
  cancelLabel: 'Keep editing',
  confirmLabel: 'Discard',
  confirm: { $action: 'shapeStore.cancelShapeWizard' },
});

/**
 * "Replace these?" — the guard on regenerating over fields somebody wrote.
 *
 * Only raised for that case: a generation the author has not touched re-runs on the click, since a
 * dialog asking to discard a proposal nobody wrote is a dialog that teaches people to dismiss
 * dialogs. Beside the wizard rather than inside it, like the discard confirmation.
 */
const replaceFieldsConfirmModal: SchemaNode = confirmModal({
  open: { $: 'shapeStore.confirmReplaceFields' },
  close: { $action: 'shapeStore.cancelReplaceFields' },
  title: 'Replace the fields below?',
  body: 'Generating starts the field list again from the name, description and AI hint. The fields you have written will be replaced.',
  cancelLabel: 'Keep them',
  confirmLabel: 'Replace',
  confirm: { $action: 'shapeStore.generateShapeFields' },
});

export const modelsSection: SchemaNode = {
  ...sectionCard({
    title: 'Models',
    description: 'The kinds of content this space defines — its own record types, and how AI interprets them.',
    aside: {
      type: 'we-button',
      props: { variant: 'secondary', size: 'sm', onClick: { $action: 'shapeStore.openShapeWizard' } },
      children: [
        { type: 'we-icon', props: { name: 'plus' } },
        { type: 'we-text', children: ['New model'] },
      ],
    },
    children: [
      {
        type: '$if',
        props: {
          condition: { $: 'shapeStore.shapesLoaded' },
          then: {
            type: '$if',
            props: {
              condition: { $: 'count(shapeStore.spaceShapes)' },
              then: {
                type: 'Column',
                props: { gap: '100' },
                children: [
                  {
                    type: '$each',
                    props: { items: { $: 'shapeStore.spaceShapes' }, as: 'shape' },
                    children: [shapeRow],
                  },
                ],
              },
              else: {
                type: 'Column',
                props: { ax: 'center', gap: '200', p: '400' },
                children: [
                  { type: 'we-icon', props: { name: 'cube', size: 'lg', color: 'text-faint' } },
                  {
                    type: 'we-text',
                    props: { color: 'text-faint', textAlign: 'center' },
                    children: ['This space has no models of its own yet.'],
                  },
                ],
              },
            },
          },
          else: { type: 'we-skeleton', props: { height: '48px' } },
        },
      },
      { type: 'we-divider' },
      {
        type: 'Column',
        props: { gap: '100' },
        children: [
          { type: 'we-text', props: { variant: 'label' }, children: ['Built-in models'] },
          {
            type: 'we-text',
            props: { variant: 'footnote', color: 'text-faint' },
            children: ['Ship with WE. Their structure is fixed, but how AI interprets them here is yours to tune.'],
          },
          {
            type: '$each',
            props: {
              items: { $: "filter(shapeStore.hintEntities, { source: 'core' })" },
              as: 'entity',
            },
            children: [hintEntityRow],
          },
        ],
      },
      { type: '$if', props: { condition: { $: 'shapeStore.shapeDraft' }, then: shapeWizardModal } },
      { type: '$if', props: { condition: { $: 'shapeStore.hintEditor' }, then: hintEditorModal } },
      discardConfirmModal,
      replaceFieldsConfirmModal,
    ],
  }),
  $localState: {
    confirmDeleteShapeId: { type: 'string', initial: '' },
  },
};
