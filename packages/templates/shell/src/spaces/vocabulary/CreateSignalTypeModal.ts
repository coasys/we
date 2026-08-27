import { field, formModal } from '@we/template-kit';

/**
 * Defining a new kind of reaction for this community.
 *
 * The gate it opens on is declared by `spaceVocabularySection`, since the button that sets it lives
 * in the signal-types section's header rather than in here.
 */
export const createSignalTypeModal = formModal({
  open: { $local: 'createSignalTypeOpen' },
  close: { $setLocal: 'createSignalTypeOpen', value: false },
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
    aggregate: { type: 'string', initial: 'count' },
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
                value: { $local: 'icon' },
                onChange: { $setLocal: 'icon', from: '$event.detail' },
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
                    value: { $local: 'iconSecondary' },
                    onChange: { $setLocal: 'iconSecondary', from: '$event.detail' },
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
                    value: { $local: 'rangeMin' },
                    onChange: { $setLocal: 'rangeMin', from: '$event.detail' },
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
                    value: { $local: 'rangeMax' },
                    onChange: { $setLocal: 'rangeMax', from: '$event.detail' },
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
                    value: { $local: 'step' },
                    min: 0.1,
                    step: 0.1,
                    onChange: { $setLocal: 'step', from: '$event.detail' },
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
              icon: { $local: 'icon' },
              iconSecondary: { $local: 'iconSecondary' },
              mode: { $local: 'mode' },
              rangeMin: { $local: 'rangeMin' },
              rangeMax: { $local: 'rangeMax' },
              step: { $local: 'step' },
            },
          },
        },
      ],
    },
  ],
  // The slug derives from the name when left blank, so a name is the whole precondition.
  disabled: { $: '!local.name' },
  // The typed fields only. `mode`, `aggregate` and the range have defaults and pickers, so they
  // are set from the first frame and would make the guard fire on an untouched form.
  discardWhen: { $: 'local.name || local.slug || local.description' },
  submitLabel: 'Create',
  submit: {
    $action: 'spaceStore.createSignalType',
    args: [
      {
        name: { $local: 'name' },
        slug: { $local: 'slug' },
        description: { $local: 'description' },
        icon: { $local: 'icon' },
        iconSecondary: { $local: 'iconSecondary' },
        mode: { $local: 'mode' },
        aggregate: { $local: 'aggregate' },
        rangeMin: { $local: 'rangeMin' },
        rangeMax: { $local: 'rangeMax' },
        step: { $local: 'step' },
      },
    ],
  },
});
