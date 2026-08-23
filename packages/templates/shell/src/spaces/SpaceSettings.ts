import type { SchemaNode } from '@we/schema-shared';

import { spaceDefaultsSection } from './SpaceDefaults.ts';
import { spaceSectionsSection } from './SpaceSections.ts';
import { spaceVocabularySection } from './SpaceVocabulary.ts';

/**
 * Settings for one space, reached from its card in the spaces list.
 *
 * Not a "current space" page. Navigating between spaces closes this overlay (`navigateToSpace`
 * calls `closeShellView`), so a page bound to wherever you are standing could only ever configure
 * that one place, and only for as long as you stayed. Keying off the row you clicked decouples
 * configuring a space from being in it — you can set up several in one sitting.
 *
 * ## One page, two doors
 *
 * The default template used to carry a `/settings` section of its own rendering the same actions.
 * Two presentations of one set of actions is what the schema system is for, so that was defensible
 * while it lasted — but the two had already diverged (the route offered vocabulary and the space's
 * default template; this page offered modules and the personal overrides), and a member's answer to
 * "where do I change this" depended on which they happened to open.
 *
 * So the route is gone and this is the only one, reached two ways: from the spaces list, to
 * configure any space without going to it, and from the gear in a space's own header, which opens
 * this page already keyed to that space. Same page, same URL inside the overlay, two ways in.
 *
 * That it lives outside every template is now load-bearing rather than incidental. With sections
 * installable, most shells will not provide a settings surface at all — and a community that
 * installs one which does not must still be able to change their template back.
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
              props: { variant: 'footnote', color: 'text-faint' },
              children: [
                {
                  $if: {
                    condition: '$space.isWeSpace',
                    then: {
                      $if: {
                        condition: { $eq: ['$space.kind', 'shared'] },
                        then: 'Shared space',
                        else: 'Personal space',
                      },
                    },
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
      props: {
        variant: 'secondary',
        size: 'sm',
        onClick: { $action: 'spaceStore.navigateToSpace', args: ['$space.uuid'] },
      },
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
  props: { gap: '200', p: '400', bg: 'surface-sunken', r: '300', border: '1px solid border' },
  children: [
    { type: 'we-text', props: { variant: 'label' }, children: ['Nothing to configure yet'] },
    {
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-faint' },
      children: ['This dataset was synced in from another app and has no WE space in it. Open it to initialize one.'],
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
      props: { gap: '300', p: '400', bg: 'surface-sunken', r: '300', border: '1px solid border' },
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
              props: { variant: 'footnote', color: 'text-faint' },
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
                onInput: [
                  { $setLocal: 'editName', from: '$event.detail' },
                  { $setLocal: 'metaDirty', value: true },
                ],
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
      props: { variant: 'footnote', color: 'warning-text' },
      children: ['Run here, but not installed for you — turn it on in Settings → Modules.'],
    },
    else: {
      type: '$if',
      props: {
        condition: { $and: ['$mod.installed', { $not: '$mod.enabled' }] },
        then: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-faint' },
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
      props: { gap: '300', p: '400', bg: 'surface-sunken', r: '300', border: '1px solid border' },
      children: [
        {
          type: 'Column',
          props: { gap: '100' },
          children: [
            { type: 'we-text', props: { variant: 'label' }, children: ['Invite'] },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-faint' },
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
                bg: 'surface-sunken',
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
  props: { gap: '300', p: '400', bg: 'surface-sunken', r: '300', border: '1px solid border' },
  children: [
    {
      type: 'Column',
      props: { gap: '100' },
      children: [
        { type: 'we-text', props: { variant: 'label' }, children: ['Appearance, for you'] },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-faint' },
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
              props: { variant: 'footnote', color: 'text-faint' },
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
            { type: 'we-text', props: { variant: 'footnote', color: 'text-faint' }, children: ['For me'] },
            {
              type: 'we-switch',
              props: {
                size: 'sm',
                checked: '$mod.visible',
                // Nothing to show while the module is not installed, so the control cannot do what
                // it appears to. The note beside it says where to change that.
                disabled: { $not: '$mod.installed' },
                // A bare `$event.detail`, never wrapped: an operator object around it would be
                // evaluated at render time, before the event exists. See `setModuleVisible`.
                onChange: {
                  $action: 'spaceStore.setModuleVisible',
                  args: ['$mod.id', '$event.detail', '$space.uuid'],
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
            { type: 'we-text', props: { variant: 'footnote', color: 'text-faint' }, children: ['For everyone'] },
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
  props: { gap: '200', p: '400', bg: 'surface-sunken', r: '300', border: '1px solid border' },
  children: [
    {
      type: 'Column',
      props: { gap: '100' },
      children: [
        { type: 'we-text', props: { variant: 'label' }, children: ['Modules'] },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-faint' },
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
 * Automatic extraction — a community decision, and priced like one.
 *
 * Its own section rather than a row in Modules, because it is not a module: it is what one of them
 * is allowed to do while nobody is watching. Worded to say who pays, since the cost is the part
 * that is easy to miss — a standing watch spends an LLM call on whichever member's node wins the
 * election, and writes what it finds into everyone's copy of the space.
 *
 * Administer-only for the same reason the right-hand module switch is, and off by default: joining
 * a space should not be the same act as volunteering to run its extraction.
 */
const autoInterpretSection: SchemaNode = {
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
            { type: 'we-text', props: { variant: 'label' }, children: ['Extract from calls automatically'] },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-faint' },
              children: [
                {
                  $if: {
                    condition: '$space.canAdminister',
                    then: 'Tasks and events are written down as a call happens, without anyone pressing Extract. Runs on a member’s node and costs them an AI call each time.',
                    else: 'Tasks and events are written down as a call happens. Changing this needs someone who administers the space.',
                  },
                },
              ],
            },
          ],
        },
        {
          type: 'we-switch',
          props: {
            size: 'sm',
            checked: { $store: 'spaceStore.autoInterpret' },
            disabled: { $not: '$space.canAdminister' },
            // Bare `$event.detail` — an operator around it would resolve at render time, before
            // the event exists. Same reason as the module switches above.
            onChange: { $action: 'spaceStore.setAutoInterpret', args: ['$event.detail', '$space.uuid'] },
          },
        },
      ],
    },
  ],
};

/**
 * Whether extraction shows its working to the whole space.
 *
 * Beside auto-extraction because it is the same feature seen from the other side: whoever turned
 * that on is exactly who might want to see what it is doing. It was a switch inside each expanded
 * pass in the call bar, which repeated one setting per row and implied it applied to that pass.
 *
 * Framed as bandwidth rather than privacy, because that is what it is. In a call the prompt is
 * built from a transcript every participant already holds, so nothing here is hidden from them —
 * it is simply tens of KB per pass on a transport meant for small messages, which is a poor
 * standing default and a very reasonable thing to switch on while working on extraction.
 */
const shareExtractionDetailSection: SchemaNode = {
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
            { type: 'we-text', props: { variant: 'label' }, children: ['Share extraction detail'] },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-faint' },
              children: [
                {
                  $if: {
                    condition: '$space.canAdminister',
                    then: 'Everyone in the space can read what each extraction asked the model and what it answered. Useful while working on extraction; off by default, since it sends a lot to every member on every pass.',
                    else: 'Everyone can read what each extraction asked the model and what it answered. Changing this needs someone who administers the space.',
                  },
                },
              ],
            },
          ],
        },
        {
          type: 'we-switch',
          props: {
            size: 'sm',
            checked: { $store: 'spaceStore.shareExtractionDetail' },
            disabled: { $not: '$space.canAdminister' },
            // Bare `$event.detail`, for the reason the switch above it gives.
            onChange: { $action: 'spaceStore.setShareExtractionDetail', args: ['$event.detail', '$space.uuid'] },
          },
        },
      ],
    },
  ],
};

/**
 * A rule and a label saying who the controls beneath it affect.
 *
 * Light chrome on purpose — the page is already a stack of bordered cards, and a heavier grouping
 * device on top of that reads as two nesting systems arguing. A label, a muted line and a rule is
 * enough to say "everything under here has the same audience".
 *
 * `readOnlyWhen` names a condition under which the group is visible but not editable, so the heading
 * can say so once instead of every card repeating it.
 */
const groupHeading = (label: string, description: string, editableWhen?: string): SchemaNode => ({
  type: 'Column',
  props: { gap: '100', pt: '200', borderTop: '1px solid border' },
  children: [
    { type: 'we-text', props: { variant: 'label', color: 'text' }, children: [label] },
    {
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-faint' },
      children: [
        editableWhen
          ? {
              $if: {
                condition: editableWhen,
                then: description,
                else: `${description} Changing them needs someone who administers the space.`,
              },
            }
          : description,
      ],
    },
  ],
});

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
            then: {
              type: 'Column',
              props: { gap: '500' },
              children: [
                /*
                  Three groups, in this order, because the question people get wrong on a page like
                  this is "who sees this change?" — and the answer is what the grouping is for.

                  Flat, the page was five cards in the order they happened to be written, with a
                  personal one sandwiched between two community ones. Sorting them by audience means
                  the answer is legible before any individual control is read.

                  The middle group carries both answers at once and keeps them side by side rather
                  than splitting each row across two groups: "the community removed this" and "you
                  hid this" are the two situations a member has to tell apart, and they are only
                  distinguishable when shown together. See `moduleRow`.
                */
                groupHeading(
                  'Everyone in this space',
                  'Changes here are visible to every member.',
                  '$space.canAdminister',
                ),
                communitySection,
                shareSection,
                spaceDefaultsSection,
                autoInterpretSection,
                shareExtractionDetailSection,
                spaceVocabularySection,

                groupHeading('What this space has', 'Two answers per row: yours, and the community’s.'),
                spaceSectionsSection,
                modulesSection,

                groupHeading('Just for you, here', 'Nobody else is affected by anything in this group.'),
                personalAppearanceSection,
              ],
            },
            else: notAWeSpaceNotice,
          },
        },
      ],
    },
  ],
};
