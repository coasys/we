import { field, formModal } from '@we/schema-kit';
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

/** Where the sheet is opened from, and what closes it. */
export interface CreateSignalTypeModalOptions {
  /** What decides whether it is showing — `{ $: 'local.createSignalTypeOpen' }`. */
  open: SchemaProp;
  /** How it is dismissed. */
  close: SchemaProp;
}

/**
 * The plus that opens that form, sized for a section heading.
 *
 * Exported because the affordance and the list it belongs to are not always in the same place: a
 * panel that draws its reactions under a folding heading wants the plus IN that heading, beside the
 * count, where every other per-section control in the app sits — and a heading is the template's,
 * not the reaction list's. The flag is the caller's for the same reason: `$setLocal` only reaches a
 * field an ancestor of the BUTTON declared, and the list's own root is not an ancestor of the row
 * above it.
 *
 * Gated on administering the space, because defining a reaction names something every member will
 * then see. A member without the right sees the reactions and no plus, which is what they see in
 * Settings → Vocabulary too.
 */
export function newSignalTypeButton(options: { open: string }): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: { $: 'spaceStore.canAdministerCurrentSpace' },
      then: {
        type: 'we-tooltip',
        props: { content: 'New signal type' },
        children: [
          {
            type: 'we-button',
            // `xs`, which is the size a section heading's aside is — see `sectionLabel`, which
            // reserves exactly that much room for one.
            props: {
              variant: 'ghost',
              size: 'xs',
              square: true,
              label: 'New signal type',
              onClick: { $setLocal: options.open, value: true },
            },
            children: [{ type: 'we-icon', props: { name: 'plus' } }],
          },
        ],
      },
    },
  };
}

/**
 * Defining a new kind of reaction for this community.
 *
 * A function rather than the constant this was, because it is opened from two places now: the
 * vocabulary section in space settings, where a community's reactions are listed and managed, and
 * the reactions sheet on a record, where somebody has just looked for the reaction they wanted and
 * not found it. That second one is the moment the need is actually felt, and sending them to
 * Settings → Vocabulary to answer it is asking them to leave the thing they were reacting to.
 *
 * One form for both, so the second surface cannot quietly offer a narrower one. The gate stays the
 * caller's: the vocabulary section asks `space.canAdminister` and the sheet asks
 * `spaceStore.canAdministerCurrentSpace`, which are the same question about two different rows.
 */
export function createSignalTypeModal(options: CreateSignalTypeModalOptions): SchemaNode {
  return formModal({
    open: options.open,
    close: options.close,
    title: 'New signal type',
    /*
    The draft lives here rather than on the section, which is what retires the `$resetLocal: '$scope'`
    that used to run between the create and the close: the modal is mounted only while open, so the
    form is new every time. That reset also had to fire *before* the close and after the action, in
    a hand-written three-step `onClick` — an ordering nothing enforced.
  */
    localState: {
      name: { type: 'string', initial: '' },
      slug: { type: 'string', initial: '' },
      description: { type: 'string', initial: '' },
      icon: { type: 'string', initial: '❤️' },
      iconSecondary: { type: 'string', initial: '' },
      mode: { type: 'string', initial: 'toggle' },
      rangeMin: { type: 'number', initial: 0 },
      rangeMax: { type: 'number', initial: 1 },
      step: { type: 'number', initial: 1 },
    },
    children: [
      field({ name: 'name', label: 'Name', placeholder: 'e.g. Like' }),
      field({
        name: 'slug',
        label: 'Slug',
        description: 'Auto-generated from name. Used in schemas to reference this signal type.',
        placeholder: 'e.g. like',
      }),
      field({ name: 'description', label: 'Description', control: 'textarea', placeholder: 'Description' }),

      // Mode & icon selectors
      {
        type: 'Row',
        props: { gap: '400', wrap: true },
        children: [
          field({
            name: 'mode',
            label: 'Mode',
            control: 'select',
            props: {
              options: [
                { label: 'Toggle', value: 'toggle' },
                { label: 'Vote', value: 'vote' },
                { label: 'Rating', value: 'rating' },
                { label: 'Slider', value: 'slider' },
              ],
            },
          }),
          {
            type: 'we-form-field',
            props: { label: 'Icon' },
            children: [
              {
                type: 'we-icon-picker',
                props: {
                  value: { $: 'local.icon' },
                  onChange: { $setLocal: 'icon', value: { $: 'event.detail' } },
                },
              },
            ],
          },
          // Only for vote mode, which is the one that needs something to point the other way.
          {
            type: '$if',
            props: {
              condition: { $: "local.mode == 'vote'" },
              then: {
                type: 'we-form-field',
                props: { label: 'Secondary Icon', description: 'Used as the negative icon in vote mode' },
                children: [
                  {
                    type: 'we-icon-picker',
                    props: {
                      placeholder: 'Same as icon',
                      value: { $: 'local.iconSecondary' },
                      onChange: { $setLocal: 'iconSecondary', value: { $: 'event.detail' } },
                    },
                  },
                ],
              },
            },
          },
        ],
      },

      // Range & step, only for the modes that have a range at all.
      {
        type: '$if',
        props: {
          condition: { $: "local.mode == 'rating' || local.mode == 'slider'" },
          then: {
            type: 'Row',
            props: { gap: '300' },
            children: [
              {
                type: 'we-form-field',
                props: { label: 'Min' },
                children: [
                  {
                    type: 'we-number-input',
                    props: {
                      value: { $: 'local.rangeMin' },
                      onChange: { $setLocal: 'rangeMin', value: { $: 'event.detail' } },
                    },
                  },
                ],
              },
              {
                type: 'we-form-field',
                props: { label: 'Max' },
                children: [
                  {
                    type: 'we-number-input',
                    props: {
                      value: { $: 'local.rangeMax' },
                      onChange: { $setLocal: 'rangeMax', value: { $: 'event.detail' } },
                    },
                  },
                ],
              },
              {
                type: 'we-form-field',
                props: { label: 'Step' },
                children: [
                  {
                    type: 'we-number-input',
                    props: {
                      value: { $: 'local.step' },
                      min: 0.1,
                      step: 0.1,
                      onChange: { $setLocal: 'step', value: { $: 'event.detail' } },
                    },
                  },
                ],
              },
            ],
          },
        },
      },

      // Live preview
      {
        type: 'Column',
        props: { gap: '200', mt: '200', ax: 'center', border: '1px solid border', p: '400', r: '500' },
        children: [
          { type: 'we-text', props: { variant: 'label', color: 'text-muted' }, children: ['Preview'] },
          {
            type: 'SignalControl',
            props: {
              preview: true,
              signalType: {
                icon: { $: 'local.icon' },
                iconSecondary: { $: 'local.iconSecondary' },
                mode: { $: 'local.mode' },
                rangeMin: { $: 'local.rangeMin' },
                rangeMax: { $: 'local.rangeMax' },
                step: { $: 'local.step' },
              },
            },
          },
        ],
      },
    ],
    // The slug derives from the name when left blank, so a name is the whole precondition.
    disabled: { $: '!local.name' },
    // The typed fields only. `mode` and the range have defaults and pickers, so they are set from the
    // first frame and would make the guard fire on an untouched form.
    discardWhen: { $: 'local.name || local.slug || local.description' },
    submitLabel: 'Create',
    submit: {
      $action: 'spaceStore.createSignalType',
      args: [
        {
          name: { $: 'local.name' },
          slug: { $: 'local.slug' },
          description: { $: 'local.description' },
          icon: { $: 'local.icon' },
          iconSecondary: { $: 'local.iconSecondary' },
          /*
          No `aggregate`. The form never asked for one — it carried a hidden local pinned at `count`
          and posted it with every type, so a rating's own record said it should be read as a
          headcount. The store derives it from the mode instead, which is the only answer this form
          has the information to give; a community that wants a median has a field nobody has built a
          picker for yet, and an unauthored value is worse than an absent one.
        */
          mode: { $: 'local.mode' },
          rangeMin: { $: 'local.rangeMin' },
          rangeMax: { $: 'local.rangeMax' },
          step: { $: 'local.step' },
        },
      ],
    },
  });
}
