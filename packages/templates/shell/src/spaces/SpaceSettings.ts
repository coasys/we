import type { SchemaNode } from '@we/schema-shared';

/**
 * Settings for one space, reached from its card in the spaces list.
 *
 * Not a "current space" page. Navigating between spaces closes this overlay (`navigateToSpace`
 * calls `closeShellView`), so a page bound to wherever you are standing could only ever configure
 * that one place, and only for as long as you stayed. Keying off the row you clicked decouples
 * configuring a space from being in it — you can set up several in one sitting.
 *
 * The space's own template may also offer these controls in context (the default template's
 * `/settings` route does). That is not duplication in any load-bearing sense: both render the same
 * store actions, and two presentations of one set of actions is what the schema system is for. What
 * this page adds is that the controls exist for *every* space, including one whose template never
 * thought to provide them.
 */

/** Read the space this page is for out of the route. `/spaces/<uuid>` → segments[1]. */
const routeSpaceUuid = { $store: 'routeStore.segments.1' };

const backLink: SchemaNode = {
  type: 'we-button',
  props: { variant: 'ghost', size: 'sm', ax: 'start', onClick: { $action: 'routeStore.navigate', args: ['/spaces'] } },
  children: [
    { type: 'we-icon', props: { name: 'arrow-left' } },
    { type: 'we-text', props: { variant: 'label' }, children: ['All spaces'] },
  ],
};

const header: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center', ax: 'between', wrap: true },
  children: [
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        { type: 'we-avatar', props: { image: '$space.avatar', initials: '$space.name', size: 'md' } },
        {
          type: 'Column',
          props: { gap: '100' },
          children: [
            { type: 'we-text', props: { variant: 'heading-sm' }, children: ['$space.name'] },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'neutral-400' },
              children: [
                {
                  $if: {
                    condition: '$space.isWeSpace',
                    then: { $if: { condition: { $eq: ['$space.kind', 'shared'] }, then: 'Shared space', else: 'Personal space' } },
                    else: 'Joined dataset — not yet a WE space',
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'we-button',
      props: { variant: 'secondary', size: 'sm', onClick: { $action: 'spaceStore.navigateToSpace', args: ['$space.uuid'] } },
      children: [
        { type: 'we-text', props: { variant: 'label' }, children: ['Open'] },
        { type: 'we-icon', props: { name: 'arrow-right' } },
      ],
    },
  ],
};

/**
 * A dataset with no Space record has nothing to configure yet — initializing it happens inside it,
 * where the gate can prefill from the foreign app's own model.
 */
const notAWeSpaceNotice: SchemaNode = {
  type: 'Column',
  props: { gap: '200', p: '400', bg: 'neutral-0', r: '300', border: '1px solid neutral-200' },
  children: [
    { type: 'we-text', props: { variant: 'label' }, children: ['Nothing to configure yet'] },
    {
      type: 'we-text',
      props: { variant: 'footnote', color: 'neutral-400' },
      children: [
        'This dataset was synced in from another app and has no WE space in it. Open it to initialize one.',
      ],
    },
  ],
};

const saveMetaOnBlur = [
  {
    $if: {
      condition: { $local: 'metaDirty' },
      then: {
        $action: 'spaceStore.updateSpaceMeta',
        args: [{ name: { $local: 'editName' }, description: { $local: 'editDescription' } }, '$space.uuid'],
        onFinally: [{ $setLocal: 'metaDirty', value: false }],
      },
    },
  },
];

/**
 * What everyone in the space sees. Offered only where {@link canAdministerSpace} says so — which is
 * an affordance, not a boundary: a shared space is a neighbourhood every member can write to.
 */
const communitySection: SchemaNode = {
  type: '$if',
  props: {
    condition: '$space.canAdminister',
    then: {
      type: 'Column',
      props: { gap: '300', p: '400', bg: 'neutral-0', r: '300', border: '1px solid neutral-200' },
      $localState: {
        editName: { type: 'string', initial: '$space.name' },
        editDescription: { type: 'string', initial: '$space.description' },
        metaDirty: { type: 'boolean', initial: false },
      },
      children: [
        {
          type: 'Column',
          props: { gap: '100' },
          children: [
            { type: 'we-text', props: { variant: 'label' }, children: ['Community'] },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'neutral-400' },
              children: ['Changes here are visible to everyone in this space.'],
            },
          ],
        },
        {
          type: 'we-form-field',
          props: { label: 'Name' },
          children: [
            {
              type: 'we-input',
              props: {
                value: { $local: 'editName' },
                onInput: [{ $setLocal: 'editName', from: '$event.detail' }, { $setLocal: 'metaDirty', value: true }],
                onBlur: saveMetaOnBlur,
              },
            },
          ],
        },
        {
          type: 'we-form-field',
          props: { label: 'Description' },
          children: [
            {
              type: 'we-textarea',
              props: {
                value: { $local: 'editDescription' },
                onInput: [
                  { $setLocal: 'editDescription', from: '$event.detail' },
                  { $setLocal: 'metaDirty', value: true },
                ],
                onBlur: saveMetaOnBlur,
              },
            },
          ],
        },
      ],
    },
  },
};

/**
 * Why a module is not showing, when a toggle alone would not say.
 *
 * Three layers decide this, and they fail differently: a module the community runs but you have not
 * installed needs a visit to global settings; one you installed but the community has off needs
 * someone who administers the space. Without naming which, the page shows an "on" switch beside a
 * module that is not there and offers no way to find out why.
 */
const moduleStatus: SchemaNode = {
  type: '$if',
  props: {
    condition: { $and: ['$mod.enabled', { $not: '$mod.installed' }] },
    then: {
      type: 'we-text',
      props: { variant: 'footnote', color: 'warning-600' },
      children: ['Run here, but not installed for you — turn it on in Settings → Modules.'],
    },
    else: {
      type: '$if',
      props: {
        condition: { $and: ['$mod.installed', { $not: '$mod.enabled' }] },
        then: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'neutral-400' },
          children: ['Not run in this space.'],
        },
      },
    },
  },
};

/**
 * The link that gets someone else in here.
 *
 * Only for a shared space — a personal one has no global id, so `shareLink` is empty and there is
 * nothing a link could reach. Shown rather than hidden behind the copy button, because a link is
 * something people also read out, screenshot, or paste somewhere the clipboard cannot follow.
 */
const shareSection: SchemaNode = {
  type: '$if',
  props: {
    condition: '$space.shareLink',
    then: {
      type: 'Column',
      props: { gap: '300', p: '400', bg: 'neutral-0', r: '300', border: '1px solid neutral-200' },
      children: [
        {
          type: 'Column',
          props: { gap: '100' },
          children: [
            { type: 'we-text', props: { variant: 'label' }, children: ['Invite'] },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'neutral-400' },
              children: ['Anyone with this link can open the space and choose to join it.'],
            },
          ],
        },
        {
          type: 'Row',
          props: { gap: '200', ay: 'center', wrap: true },
          children: [
            {
              type: 'we-text',
              props: {
                variant: 'footnote',
                flex: '1',
                truncate: true,
                p: '200',
                bg: 'neutral-50',
                r: '200',
                styles: { 'word-break': 'break-all' },
              },
              children: ['$space.shareLink'],
            },
            {
              type: 'we-button',
              props: {
                variant: 'secondary',
                size: 'sm',
                onClick: { $action: 'spaceStore.copyShareLink', args: ['$space.uuid'] },
              },
              children: [
                { type: 'we-icon', props: { name: 'copy' } },
                { type: 'we-text', props: { variant: 'label' }, children: ['Copy'] },
              ],
            },
          ],
        },
      ],
    },
  },
};

/**
 * This agent's own template and theme for this space, overriding what the community set.
 *
 * Offered to everyone, not just whoever administers the space — this changes nothing another member
 * sees. That asymmetry is the point of the section: the community's defaults are a starting position,
 * not a constraint on how you personally read the place.
 *
 * `''` is a real option rather than an empty state, labelled "Use the space's default" — someone who
 * has overridden needs a way back, and a picker with no such entry silently makes the override
 * permanent.
 */
const personalAppearanceSection: SchemaNode = {
  type: 'Column',
  props: { gap: '300', p: '400', bg: 'neutral-0', r: '300', border: '1px solid neutral-200' },
  children: [
    {
      type: 'Column',
      props: { gap: '100' },
      children: [
        { type: 'we-text', props: { variant: 'label' }, children: ['Appearance, for you'] },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'neutral-400' },
          children: ['How this space looks when you open it. Only you see these.'],
        },
      ],
    },
    {
      type: 'we-form-field',
      props: { label: 'Template' },
      children: [
        {
          type: 'we-select',
          props: {
            value: '$space.templateOverride',
            options: { $store: 'spaceStore.templateOverrideOptions' },
            onChange: {
              $action: 'spaceStore.setSpaceTemplateOverride',
              args: ['$event.detail', '$space.uuid'],
            },
          },
        },
      ],
    },
    {
      type: 'we-form-field',
      props: { label: 'Theme' },
      children: [
        {
          type: 'we-select',
          props: {
            value: '$space.themeOverride',
            options: { $store: 'spaceStore.themeOverrideOptions' },
            onChange: {
              $action: 'spaceStore.setSpaceThemeOverride',
              args: ['$event.detail', '$space.uuid'],
            },
          },
        },
      ],
    },
  ],
};

const moduleRow: SchemaNode = {
  type: 'Row',
  props: { ay: 'center', ax: 'between', gap: '300', py: '200' },
  children: [
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: '$mod.icon', size: '20px' } },
        {
          type: 'Column',
          props: { gap: '100' },
          children: [
            { type: 'we-text', props: { variant: 'label' }, children: ['$mod.name'] },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'neutral-400' },
              children: ['$mod.description'],
            },
            moduleStatus,
          ],
        },
      ],
    },
    {
      type: 'Row',
      props: { gap: '400', ay: 'center' },
      children: [
        // Personal: mute it here without touching what anyone else sees. Phrased as "show for me"
        // rather than "mute" so both switches read the same way round — on means visible.
        {
          type: 'Column',
          props: { gap: '100', ax: 'center' },
          children: [
            { type: 'we-text', props: { variant: 'footnote', color: 'neutral-400' }, children: ['For me'] },
            {
              type: 'we-switch',
              props: {
                size: 'sm',
                checked: { $not: '$mod.muted' },
                // The switch reports whether it is now *shown*; muted is the opposite.
                onChange: {
                  $action: 'spaceStore.setModuleMuted',
                  args: ['$mod.id', { $not: '$event.detail' }, '$space.uuid'],
                },
              },
            },
          ],
        },
        // Community: only offered to whoever may administer the space.
        {
          type: 'Column',
          props: { gap: '100', ax: 'center' },
          children: [
            { type: 'we-text', props: { variant: 'footnote', color: 'neutral-400' }, children: ['For everyone'] },
            {
              type: 'we-switch',
              props: {
                size: 'sm',
                checked: '$mod.enabled',
                disabled: { $not: '$space.canAdminister' },
                onChange: {
                  $action: 'spaceStore.setModuleEnabled',
                  args: ['$mod.id', '$event.detail', '$space.uuid'],
                },
              },
            },
          ],
        },
      ],
    },
  ],
};

const modulesSection: SchemaNode = {
  type: 'Column',
  props: { gap: '200', p: '400', bg: 'neutral-0', r: '300', border: '1px solid neutral-200' },
  children: [
    {
      type: 'Column',
      props: { gap: '100' },
      children: [
        { type: 'we-text', props: { variant: 'label' }, children: ['Modules'] },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'neutral-400' },
          children: [
            {
              $if: {
                condition: '$space.canAdminister',
                then: 'What this space runs, and what you want to see of it. Only the right-hand switch affects other members.',
                else: 'What this space runs, and what you want to see of it. Changing what everyone sees needs someone who administers the space.',
              },
            },
          ],
        },
      ],
    },
    { type: '$each', props: { items: '$space.modules', as: 'mod' }, children: [moduleRow] },
  ],
};

/**
 * The page body, rendered per matching row.
 *
 * `$each` over a one-item filter rather than a `$find`, because it is the context variable that is
 * wanted: every control below reads `$space.uuid` to name what it is writing to.
 */
export const spaceSettingsPage: SchemaNode = {
  type: '$each',
  props: {
    items: { $filter: { items: { $store: 'spaceStore.spaceList' }, where: { uuid: routeSpaceUuid } } },
    as: 'space',
  },
  children: [
    {
      type: 'Column',
      props: { gap: '400', width: '100%' },
      children: [
        backLink,
        header,
        {
          type: '$if',
          props: {
            condition: '$space.isWeSpace',
            then: { type: 'Column', props: { gap: '400' }, children: [shareSection, personalAppearanceSection, communitySection, modulesSection] },
            else: notAWeSpaceNotice,
          },
        },
      ],
    },
  ],
};
