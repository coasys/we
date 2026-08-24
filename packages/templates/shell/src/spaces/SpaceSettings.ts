import type { SchemaNode } from '@we/schema-shared';
import { attributeRow } from '@we/template-kit';

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
 * So the route is gone and this is the only one, reached from the spaces list — via the chrome
 * rail's own gear, which is present in every space and on every screen, so a second gear inside the
 * space was a duplicate of something that could never be missing.
 *
 * The About view's pencil is the one exception, and it is not a general entry point: it sits on the
 * fields it leads to, saying "these are edited over there" about a specific form rather than
 * offering settings in general.
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

/**
 * Name and description save when the field is left, so the spinner is the only thing that says the
 * change was taken.
 *
 * It sits by the section heading rather than by the field, because a blur has usually moved the
 * cursor somewhere else by the time the write lands — a spinner where the cursor no longer is
 * reports to nobody.
 */
const saveMetaOnBlur = [
  {
    $if: {
      condition: { $local: 'metaDirty' },
      then: [
        { $setLocal: 'saving', value: true },
        {
          $action: 'spaceStore.updateSpaceMeta',
          args: [{ name: { $local: 'editName' }, description: { $local: 'editDescription' } }, '$space.uuid'],
          onFinally: [
            { $setLocal: 'metaDirty', value: false },
            { $setLocal: 'saving', value: false },
          ],
        },
      ],
    },
  },
];

const isListed = { $eq: ['$space.discovery', 'listed'] };

/**
 * Whether the space appears on the global discovery globe.
 *
 * Reads `$space.discovery` rather than `spaceStore.currentSpace.discovery` — the row being
 * configured is usually not the space on screen, and the store accessor would answer for the wrong
 * one. The write names the space for the same reason.
 *
 * The switch computes its next value from the current one at *click* time rather than binding
 * `$event.detail`: `discovery` is a two-valued string, not a boolean, and there is no operator that
 * maps one to the other in an argument position.
 */
const discoveryRow: SchemaNode = attributeRow({
  icon: 'globe',
  label: 'Discovery',
  value: { $if: { condition: isListed, then: 'Listed', else: 'Hidden' } },
  description: {
    $if: {
      condition: isListed,
      then: 'Appears on the WE discovery globe',
      else: 'Not shown in global discovery',
    },
  },
  control: {
    type: 'we-switch',
    props: {
      py: '400',
      checked: isListed,
      labelOn: 'Listed',
      labelOff: 'Hidden',
      onChange: {
        $action: 'spaceStore.updateSpaceMeta',
        args: [{ discovery: { $if: { condition: isListed, then: 'hidden', else: 'listed' } } }, '$space.uuid'],
      },
    },
  },
});

const saveLocationOnBlur = [
  {
    $if: {
      condition: { $local: 'locationDirty' },
      then: {
        $action: 'spaceStore.updateSpaceMeta',
        args: [{ location: { $local: 'location' } }, '$space.uuid'],
        onFinally: [{ $setLocal: 'locationDirty', value: false }],
      },
    },
  },
];

/** Where the space says it is — the summary line, and the two buttons that change it. */
const locationRow: SchemaNode = attributeRow({
  icon: 'map-pin',
  label: 'Location',
  value: {
    $if: {
      condition: '$space.location',
      then: { $concat: ['$space.location.city', ', ', '$space.location.country'] },
      else: 'Not set',
    },
  },
  control: {
    type: 'Row',
    props: { ay: 'center', gap: '300' },
    children: [
      {
        type: 'we-button',
        props: { variant: 'secondary', size: 'sm', onClick: { $toggleLocal: 'editLocation' } },
        children: [{ $if: { condition: { $local: 'editLocation' }, then: 'Hide', else: 'Edit' } }],
      },
      {
        type: '$if',
        props: {
          // Nothing to remove when there is no location, and a Remove button beside "Not set"
          // reads as an offer that does nothing.
          condition: '$space.location',
          then: {
            type: 'we-button',
            props: {
              size: 'sm',
              variant: 'danger',
              onClick: [
                { $setLocal: 'location', value: null },
                { $action: 'spaceStore.updateSpaceMeta', args: [{ location: null }, '$space.uuid'] },
              ],
            },
            children: [
              { type: 'we-icon', props: { name: 'trash' } },
              { type: 'we-text', children: ['Remove'] },
            ],
          },
        },
      },
    ],
  },
});

/** The picker and the two name fields, opened by the row above. */
const locationEditor: SchemaNode = {
  type: '$if',
  props: {
    condition: { $local: 'editLocation' },
    then: {
      type: 'Column',
      props: { gap: '300' },
      children: [
        {
          type: 'we-form-field',
          props: { label: 'Location' },
          children: [
            {
              type: 'we-location-picker',
              props: {
                latitude: { $local: 'location.latitude' },
                longitude: { $local: 'location.longitude' },
                // Saved immediately rather than on blur: picking a place on a map is a deliberate,
                // finished act, and there is no field to leave.
                onChange: [
                  { $setLocal: 'location', from: '$event.detail' },
                  {
                    $action: 'spaceStore.updateSpaceMeta',
                    args: [{ location: { $local: 'location' } }, '$space.uuid'],
                  },
                ],
              },
            },
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $local: 'location' },
            then: {
              type: 'Row',
              props: { gap: '300' },
              children: [
                {
                  type: 'we-form-field',
                  props: { label: 'City', flex: '1' },
                  children: [
                    {
                      type: 'we-input',
                      props: {
                        value: { $local: 'location.city' },
                        placeholder: 'City…',
                        onInput: [
                          { $setLocal: 'location', merge: { city: '$event.detail' } },
                          { $setLocal: 'locationDirty', value: true },
                        ],
                        onBlur: saveLocationOnBlur,
                      },
                    },
                  ],
                },
                {
                  type: 'we-form-field',
                  props: { label: 'Country', flex: '1' },
                  children: [
                    {
                      type: 'we-input',
                      props: {
                        value: { $local: 'location.country' },
                        placeholder: 'Country…',
                        onInput: [
                          { $setLocal: 'location', merge: { country: '$event.detail' } },
                          { $setLocal: 'locationDirty', value: true },
                        ],
                        onBlur: saveLocationOnBlur,
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    },
  },
};

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
        saving: { type: 'boolean', initial: false },
        // One object rather than five scalar fields, all of which would need the same `$if` on the
        // space having a location at all. Read with dot notation, written with `merge`.
        location: { type: 'object', initial: '$space.location' },
        locationDirty: { type: 'boolean', initial: false },
        editLocation: { type: 'boolean', initial: false },
      },
      children: [
        {
          type: 'Row',
          props: { ax: 'between', ay: 'center', gap: '300' },
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
              type: '$if',
              props: { condition: { $local: 'saving' }, then: { type: 'we-spinner', props: { size: 'sm' } } },
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
                disabled: { $local: 'saving' },
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
                disabled: { $local: 'saving' },
                onInput: [
                  { $setLocal: 'editDescription', from: '$event.detail' },
                  { $setLocal: 'metaDirty', value: true },
                ],
                onBlur: saveMetaOnBlur,
              },
            },
          ],
        },
        discoveryRow,
        locationRow,
        locationEditor,
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
