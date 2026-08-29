import type { SchemaNode, SchemaProp } from '@we/schema-shared';
import { expr } from '@we/schema-shared';
import { attributeRow } from '@we/template-kit';

import { spaceDefaultsSection } from './SpaceDefaults.ts';
import { spaceSectionsSection } from './SpaceSections.ts';
import { spaceVocabularySection } from './SpaceVocabulary.ts';

/**
 * Settings for one space — one set of controls, rendered in two places.
 *
 * ## Two hosts, and why neither can be dropped
 *
 * The **panel** (`SpaceSettingsPanel.schema.ts`) configures the space you are standing in, docked
 * beside it like any module's panel. That is what the chrome rail's gear opens, and it is the common
 * case: you are in a space, you want to change something about it, and the app should not disappear
 * while you do. It also follows you — the body is keyed on the current dataset, so walking to another
 * space re-points the panel rather than closing it.
 *
 * The **page**, reached from a row in the spaces list, configures a space you are *not* in. That is
 * not the same act and cannot be folded into the panel: `navigateToSpace` closes the settings
 * overlay, so a surface bound to where you are standing could only ever configure that one place,
 * and only for as long as you stayed. Setting up several spaces in one sitting needs the list.
 *
 * Both render {@link spaceSettingsBody}, so there is one definition rather than two that drift —
 * which is the whole of what the old "one page, two doors" rule was protecting. What differs is
 * only which space they name and what chrome sits above it.
 *
 * The one place they genuinely diverge is vocabulary, and the divergence is real rather than
 * accidental: signals, relationships and models are read from the *open* dataset, so from the page
 * they are unreachable for any row but the current one and the section says so. In the panel that
 * branch never fires, because the panel is always about the space that is open.
 *
 * ## Why tabs
 *
 * Flat, this is nine cards and some two thousand lines of vocabulary below them, which is a long
 * scroll on a page and an unusable one in a 440px panel. The tabs are by *subject*, because that is
 * what somebody arriving has in mind ("where do I turn a module off").
 *
 * The audience question — "who else sees this change?" — was what the three flat groups answered,
 * and it is not abandoned: it moves inside the tabs, as the same `groupHeading` rules on the two
 * that mix (Appearance and Features) and an {@link audienceNote} on the two that do not. Losing it
 * entirely would be the regression; a reader must still be able to tell "the community removed
 * this" from "I hid this", which is also why the two switches stay side by side on a row.
 *
 * That all of this lives outside every template is load-bearing rather than incidental. With
 * sections installable, most shells will not provide a settings surface at all — and a community
 * that installs one which does not must still be able to change their template back.
 */

/** Read the space the *page* is for out of the route. `/spaces/<uuid>` → segments[1]. */
const routeSpaceUuid = { $: 'routeStore.segments[1]' };

const backLink: SchemaNode = {
  type: 'we-button',
  props: { variant: 'ghost', size: 'sm', ax: 'start', onClick: { $action: 'routeStore.navigate', args: ['/spaces'] } },
  children: [
    { type: 'we-icon', props: { name: 'arrow-left' } },
    { type: 'we-text', props: { variant: 'label' }, children: ['All spaces'] },
  ],
};

/**
 * Which space this is, in one row — the picture, the name, and what kind of thing it is.
 *
 * Shared by both hosts. The page pairs it with a way back to the list and a way *into* the space;
 * the panel shows it alone, since you are already in the space and the panel's titlebar is the way
 * out. Neither of those belongs to the identity itself, so both are composed around it.
 */
export const spaceIdentity: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center' },
  children: [
    { type: 'we-avatar', props: { image: { $: 'space.avatar' }, initials: { $: 'space.name' }, size: 'md' } },
    {
      type: 'Column',
      props: { gap: '100' },
      children: [
        { type: 'we-text', props: { variant: 'heading-sm' }, children: [{ $: 'space.name' }] },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-faint' },
          children: [
            {
              $: "space.isWeSpace ? space.kind == 'shared' ? 'Shared space' : 'Personal space' : 'Joined dataset — not yet a WE space'",
            },
          ],
        },
      ],
    },
  ],
};

const pageHeader: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center', ax: 'between', wrap: true },
  children: [
    spaceIdentity,
    {
      type: 'we-button',
      props: {
        variant: 'secondary',
        size: 'sm',
        onClick: { $action: 'spaceStore.navigateToSpace', args: [{ $: 'space.uuid' }] },
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
      condition: { $: 'local.metaDirty' },
      then: [
        { $setLocal: 'saving', value: true },
        {
          $action: 'spaceStore.updateSpaceMeta',
          args: [{ name: { $: 'local.editName' }, description: { $: 'local.editDescription' } }, { $: 'space.uuid' }],
          onFinally: [
            { $setLocal: 'metaDirty', value: false },
            { $setLocal: 'saving', value: false },
          ],
        },
      ],
    },
  },
];

const isListed = { $: "space.discovery == 'listed'" };

/**
 * Whether the space appears on the global discovery globe.
 *
 * Reads `$space.discovery` rather than `spaceStore.currentSpace.discovery` — the row being
 * configured is usually not the space on screen, and the store accessor would answer for the wrong
 * one. The write names the space for the same reason.
 *
 * The switch computes its next value from the current one rather than binding `event.detail`:
 * `discovery` is a two-valued string, not a boolean, and the current value is already on the row.
 */
const discoveryRow: SchemaNode = attributeRow({
  icon: 'globe',
  label: 'Discovery',
  value: expr`${isListed} ? 'Listed' : 'Hidden'`,
  description: expr`${isListed} ? 'Appears on the WE discovery globe' : 'Not shown in global discovery'`,
  control: {
    type: 'we-switch',
    props: {
      py: '400',
      checked: isListed,
      labelOn: 'Listed',
      labelOff: 'Hidden',
      onChange: {
        $action: 'spaceStore.updateSpaceMeta',
        args: [{ discovery: expr`${isListed} ? 'hidden' : 'listed'` }, { $: 'space.uuid' }],
      },
    },
  },
});

const saveLocationOnBlur = [
  {
    $if: {
      condition: { $: 'local.locationDirty' },
      then: {
        $action: 'spaceStore.updateSpaceMeta',
        args: [{ location: { $: 'local.location' } }, { $: 'space.uuid' }],
        onFinally: [{ $setLocal: 'locationDirty', value: false }],
      },
    },
  },
];

/** Where the space says it is — the summary line, and the two buttons that change it. */
const locationRow: SchemaNode = attributeRow({
  icon: 'map-pin',
  label: 'Location',
  value: { $: "space.location ? `${space.location.city}, ${space.location.country}` : 'Not set'" },
  control: {
    type: 'Row',
    props: { ay: 'center', gap: '300' },
    children: [
      {
        type: 'we-button',
        props: { variant: 'secondary', size: 'sm', onClick: { $toggleLocal: 'editLocation' } },
        children: [{ $: "local.editLocation ? 'Hide' : 'Edit'" }],
      },
      {
        type: '$if',
        props: {
          // Nothing to remove when there is no location, and a Remove button beside "Not set"
          // reads as an offer that does nothing.
          condition: { $: 'space.location' },
          then: {
            type: 'we-button',
            props: {
              size: 'sm',
              variant: 'danger',
              onClick: [
                { $setLocal: 'location', value: null },
                { $action: 'spaceStore.updateSpaceMeta', args: [{ location: null }, { $: 'space.uuid' }] },
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
    condition: { $: 'local.editLocation' },
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
                latitude: { $: 'local.location.latitude' },
                longitude: { $: 'local.location.longitude' },
                // Saved immediately rather than on blur: picking a place on a map is a deliberate,
                // finished act, and there is no field to leave.
                onChange: [
                  { $setLocal: 'location', value: { $: 'event.detail' } },
                  {
                    $action: 'spaceStore.updateSpaceMeta',
                    args: [{ location: { $: 'local.location' } }, { $: 'space.uuid' }],
                  },
                ],
              },
            },
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $: 'local.location' },
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
                        value: { $: 'local.location.city' },
                        placeholder: 'City…',
                        onInput: [
                          { $setLocal: 'location', merge: { city: { $: 'event.detail' } } },
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
                        value: { $: 'local.location.country' },
                        placeholder: 'Country…',
                        onInput: [
                          { $setLocal: 'location', merge: { country: { $: 'event.detail' } } },
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
    condition: { $: 'space.canAdminister' },
    then: {
      type: 'Column',
      props: { gap: '300', p: '400', bg: 'surface-sunken', r: '300', border: '1px solid border' },
      $localState: {
        editName: { type: 'string', initial: { $: 'space.name' } },
        editDescription: { type: 'string', initial: { $: 'space.description' } },
        metaDirty: { type: 'boolean', initial: false },
        saving: { type: 'boolean', initial: false },
        // One object rather than five scalar fields, all of which would need the same `$if` on the
        // space having a location at all. Read with dot notation, written with `merge`.
        location: { type: 'object', initial: { $: 'space.location' } },
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
              props: { condition: { $: 'local.saving' }, then: { type: 'we-spinner', props: { size: 'sm' } } },
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
                value: { $: 'local.editName' },
                disabled: { $: 'local.saving' },
                onInput: [
                  { $setLocal: 'editName', value: { $: 'event.detail' } },
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
                value: { $: 'local.editDescription' },
                disabled: { $: 'local.saving' },
                onInput: [
                  { $setLocal: 'editDescription', value: { $: 'event.detail' } },
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
    condition: { $: 'mod.enabled && !mod.installed' },
    then: {
      type: 'we-text',
      props: { variant: 'footnote', color: 'warning-text' },
      children: ['Run here, but not installed for you — turn it on in Settings → Modules.'],
    },
    else: {
      type: '$if',
      props: {
        condition: { $: 'mod.installed && !mod.enabled' },
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
    condition: { $: 'space.shareLink' },
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
                // The designated shrinker. `minWidth: '0'` is the load-bearing half: `truncate` sets
                // `white-space: nowrap`, so this item's min-content width is the whole link, and a flex
                // item's automatic minimum is exactly that — it refused every request to compress and
                // pushed the panel sideways instead of eliding.
                flex: '1 1 auto',
                minWidth: '0',
                truncate: true,
                p: '200',
                bg: 'surface-sunken',
                r: '200',
              },
              children: [{ $: 'space.shareLink' }],
            },
            {
              type: 'we-button',
              props: {
                variant: 'secondary',
                size: 'sm',
                onClick: { $action: 'spaceStore.copyShareLink', args: [{ $: 'space.uuid' }] },
              },
              children: [
                { type: 'we-icon', props: { name: 'copy' } },
                { type: 'we-text', props: { variant: 'label' }, children: ['Copy'] },
              ],
            },
          ],
        },
        // Guest invite link — zero-friction entry for someone without an account.
        // Hidden when no server URL exists (local executor).
        {
          type: '$if',
          props: {
            condition: { $: 'space.guestLink' },
            then: {
              type: 'Column',
              props: { gap: '100', mt: '200' },
              children: [
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-faint' },
                  children: ['Or share a guest link — no account or download needed.'],
                },
                {
                  type: 'Row',
                  props: { gap: '200', ay: 'center', wrap: true },
                  children: [
                    {
                      type: 'we-text',
                      props: {
                        variant: 'footnote',
                        // The designated shrinker. `minWidth: '0'` is the load-bearing half: `truncate` sets
                        // `white-space: nowrap`, so this item's min-content width is the whole link, and a flex
                        // item's automatic minimum is exactly that — it refused every request to compress and
                        // pushed the panel sideways instead of eliding.
                        flex: '1 1 auto',
                        minWidth: '0',
                        truncate: true,
                        p: '200',
                        bg: 'surface-sunken',
                        r: '200',
                      },
                      children: [{ $: 'space.guestLink' }],
                    },
                    {
                      type: 'we-button',
                      props: {
                        variant: 'secondary',
                        size: 'sm',
                        onClick: { $action: 'spaceStore.copyGuestLink', args: [{ $: 'space.uuid' }] },
                      },
                      children: [
                        { type: 'we-icon', props: { name: 'copy' } },
                        { type: 'we-text', props: { variant: 'label' }, children: ['Copy guest link'] },
                      ],
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
            value: { $: 'space.templateOverride' },
            options: { $: 'spaceStore.templateOverrideOptions' },
            onChange: {
              $action: 'spaceStore.setSpaceTemplateOverride',
              args: [{ $: 'event.detail' }, { $: 'space.uuid' }],
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
            value: { $: 'space.themeOverride' },
            options: { $: 'spaceStore.themeOverrideOptions' },
            onChange: {
              $action: 'spaceStore.setSpaceThemeOverride',
              args: [{ $: 'event.detail' }, { $: 'space.uuid' }],
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
        { type: 'we-icon', props: { name: { $: 'mod.icon' }, size: '20px' } },
        {
          type: 'Column',
          props: { gap: '100' },
          children: [
            { type: 'we-text', props: { variant: 'label' }, children: [{ $: 'mod.name' }] },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-faint' },
              children: [{ $: 'mod.description' }],
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
                checked: { $: 'mod.visible' },
                // Nothing to show while the module is not installed, so the control cannot do what
                // it appears to. The note beside it says where to change that.
                disabled: { $: '!mod.installed' },
                // A bare `$event.detail`, never wrapped: an operator object around it would be
                // evaluated at render time, before the event exists. See `setModuleVisible`.
                onChange: {
                  $action: 'spaceStore.setModuleVisible',
                  args: [{ $: 'mod.id' }, { $: 'event.detail' }, { $: 'space.uuid' }],
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
                checked: { $: 'mod.enabled' },
                disabled: { $: '!space.canAdminister' },
                onChange: {
                  $action: 'spaceStore.setModuleEnabled',
                  args: [{ $: 'mod.id' }, { $: 'event.detail' }, { $: 'space.uuid' }],
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
              $: "space.canAdminister ? 'What this space runs, and what you want to see of it. Only the right-hand switch affects other members.' : 'What this space runs, and what you want to see of it. Changing what everyone sees needs someone who administers the space.'",
            },
          ],
        },
      ],
    },
    { type: '$each', props: { items: { $: 'space.modules' }, as: 'mod' }, children: [moduleRow] },
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
                  /*
                    "Tasks and events" was right while those were the only two classes extraction
                    could produce. What it looks for is now whichever of this space's models are
                    marked for it — including any the community defined — so the sentence names the
                    act rather than enumerating a list that is no longer fixed.
                  */
                  $: "space.canAdminister ? 'Whatever this space’s models are marked for is written down as a call happens, without anyone pressing Extract. Runs on a member’s node and costs them an AI call each time.' : 'What this space’s models are marked for is written down as a call happens. Changing this needs someone who administers the space.'",
                },
              ],
            },
          ],
        },
        {
          type: 'we-switch',
          props: {
            size: 'sm',
            checked: { $: 'spaceStore.autoInterpret' },
            disabled: { $: '!space.canAdminister' },
            // Bare `$event.detail` — an operator around it would resolve at render time, before
            // the event exists. Same reason as the module switches above.
            onChange: { $action: 'spaceStore.setAutoInterpret', args: [{ $: 'event.detail' }, { $: 'space.uuid' }] },
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
/**
 * Which models this community's calls extract into.
 *
 * The middle of three layers, and the only one a community owns. The codebase decides what is a
 * *candidate* — an entity earns that by having AI hints, a dedup key and no required field a model
 * cannot satisfy, which is why no image or file block is one. This decides which candidates a call
 * here starts with. A call's participants then add or remove for that conversation.
 *
 * That middle layer exists because the alternative is WE asserting what every community's calls are
 * about. Tasks and events as a fixed default is an assumption about meeting culture; a space that
 * runs birdwatching walks wants its own model on and tasks off, and only it can know that.
 *
 * A space that has never touched this keeps what was hardcoded before the setting existed, so
 * nothing changes underneath anyone — the first toggle writes the whole resolved list and the
 * community owns it from then on.
 *
 * Administer-only, like the switches above: what a space extracts is written into everyone's copy
 * and spends whichever member's node runs the pass.
 */
const extractionTargetsSection: SchemaNode = {
  type: 'Column',
  props: { gap: '300', p: '400', bg: 'surface-sunken', r: '300', border: '1px solid border' },
  children: [
    {
      type: 'Column',
      props: { gap: '100' },
      children: [
        { type: 'we-text', props: { variant: 'label' }, children: ['What calls extract'] },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-faint' },
          children: [
            {
              $: "space.canAdminister ? 'The models a call in this space starts out looking for. Participants can add or remove them for one call. Every model named costs tokens on every pass, so keep the list to what this community actually talks about.' : 'The models a call in this space starts out looking for. Changing this needs someone who administers the space.'",
            },
          ],
        },
      ],
    },
    /*
      Every candidate, ticked or not — rather than only what is on.

      A list of what is enabled cannot be turned into a list of what could be, so a settings page
      that showed only the current targets would give a community no way to add one. The rows come
      from `shapeStore.extractionCandidates`, which is core vocabulary marked extractable plus this
      space's own adopted models.
    */
    {
      type: '$if',
      props: {
        condition: { $: 'count(shapeStore.extractionCandidates)' },
        then: {
          type: 'Column',
          props: { gap: '100' },
          children: [
            {
              type: '$each',
              props: { items: { $: 'shapeStore.extractionCandidates' }, as: 'candidate' },
              children: [
                {
                  type: 'Row',
                  props: { width: '100%', gap: '300', ay: 'center' },
                  children: [
                    { type: 'we-text', props: { flex: '1' }, children: [{ $: 'candidate' }] },
                    {
                      type: 'we-switch',
                      props: {
                        size: 'sm',
                        checked: { $: 'candidate in spaceStore.extractionTargets' },
                        disabled: { $: '!space.canAdminister' },
                        // Bare `event.detail` — an operator around it would resolve at render time,
                        // before the event exists.
                        onChange: {
                          $action: 'spaceStore.setExtractionTarget',
                          args: [{ $: 'candidate' }, { $: 'event.detail' }, { $: 'space.uuid' }],
                        },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        /*
          Not an error, and the one place it can be acted on.

          A space has candidates unless somebody has been through the vocabulary; a community that
          defines its own model marks it here by ticking the wizard's switch, which enrols it in
          this list on save.
        */
        else: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-faint' },
          children: ['Nothing in this space can be extracted yet. Models declare it, in Vocabulary.'],
        },
      },
    },
  ],
};

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
                  $: "space.canAdminister ? 'Everyone in the space can read what each extraction asked the model and what it answered. Useful while working on extraction; off by default, since it sends a lot to every member on every pass.' : 'Everyone can read what each extraction asked the model and what it answered. Changing this needs someone who administers the space.'",
                },
              ],
            },
          ],
        },
        {
          type: 'we-switch',
          props: {
            size: 'sm',
            checked: { $: 'spaceStore.shareExtractionDetail' },
            disabled: { $: '!space.canAdminister' },
            // Bare `$event.detail`, for the reason the switch above it gives.
            onChange: {
              $action: 'spaceStore.setShareExtractionDetail',
              args: [{ $: 'event.detail' }, { $: 'space.uuid' }],
            },
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
const groupHeading = (label: string, description: string, editableWhen?: SchemaProp): SchemaNode => ({
  type: 'Column',
  props: { gap: '100', pt: '200', borderTop: '1px solid border' },
  children: [
    { type: 'we-text', props: { variant: 'label', color: 'text' }, children: [label] },
    {
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-faint' },
      children: [
        editableWhen
          ? expr`${editableWhen} ? ${description} : ${`${description} Changing them needs someone who administers the space.`}`
          : description,
      ],
    },
  ],
});

/**
 * Who is affected by a whole tab, said once at the top of it.
 *
 * The lighter sibling of {@link groupHeading}, for a tab whose contents all have the same audience —
 * there is nothing to separate from, so a rule and a bold label would be drawing a boundary around
 * the only thing present.
 */
const audienceNote = (text: string, editableWhen?: SchemaProp): SchemaNode => ({
  type: 'we-text',
  props: { variant: 'footnote', color: 'text-faint' },
  children: [
    editableWhen
      ? expr`${editableWhen} ? ${text} : ${`${text} Changing them needs someone who administers the space.`}`
      : text,
  ],
});

/**
 * The tabs, in the order somebody works through a new space: what it is, how it looks, what it has,
 * what its words mean.
 *
 * Vocabulary is last because it is the deepest and the least often visited — and because it is
 * enormous, which is most of why these are tabs at all.
 */
const TABS = [
  { key: 'about', label: 'About' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'features', label: 'Features' },
  { key: 'vocabulary', label: 'Vocabulary' },
];

/**
 * One tab's contents, mounted only while it is the open one.
 *
 * `$if` rather than `$animate`, so the tab you are not looking at costs nothing — Vocabulary alone
 * holds three live subscriptions and the model wizard. What that unmounts is safe here: the name and
 * description fields save on blur, and clicking a tab *is* the blur, so a switch cannot lose an edit
 * the way it would in a form that saved on submit.
 *
 * `fill` is the panel's shape: the tab strip is pinned and *this* is what scrolls, so the tabs stay
 * reachable in a box a few hundred pixels tall. The page wants the opposite — it scrolls as a whole,
 * inside the overlay — and a scroll region there would be a second scrollbar inside the first.
 */
const tabPanel = (key: string, children: SchemaNode[], fill?: boolean): SchemaNode => {
  const body: SchemaNode = { type: 'Column', props: { gap: '400', width: '100%' }, children };
  return {
    type: '$if',
    props: {
      condition: expr`local.tab == ${key}`,
      then: fill ? { type: 'we-scroll-area', props: { flex: '1', width: '100%' }, children: [body] } : body,
    },
  };
};

/**
 * The settings themselves, for whichever space `uuid` names.
 *
 * `$each` over a one-item filter rather than a `$find`, because it is the context variable that is
 * wanted: every control below reads `$space.uuid` to name what it is writing to. `chrome` is
 * whatever the host puts above the tabs, and it is inside the loop because it names the space too.
 *
 * The tab lives in `$localState` rather than a route: the panel has no router, and giving the page
 * one would make the two hosts differ in a way a reader would have to learn. It is plain state, not
 * `persist`ed — which tab you last had open is a fact about the last space you configured, and
 * restoring Vocabulary onto a space that has none is a worse first frame than starting at About.
 *
 * `fill` says the host has given this a box to fit rather than a page to grow down: the column takes
 * the height it is offered and the open tab scrolls inside it. See {@link tabPanel}.
 */
export function spaceSettingsBody(uuid: SchemaProp, chrome: SchemaNode[], fill?: boolean): SchemaNode {
  // A flex child that fills its parent needs a zero minimum as well as a grow — its automatic
  // minimum is its content, so without this the column grows past the panel instead of scrolling.
  const fills = fill ? { flex: '1', minHeight: '0' } : {};
  return {
    /*
      The wrapper exists for one reason: the open tab must outlive the row.

      `spaceStore.spaceList` builds a fresh object per row on every recompute, and `$each` renders
      through a reference-keyed `<For>` — so *any* write to the space rebuilds this whole subtree.
      With the tab declared inside the loop, flicking a view or an extraction target destroyed the
      `$localState` holding it and re-created it at `'about'`: the settings panel jumped back to the
      first tab on every toggle.

      Above the loop it survives, and it belongs there anyway — which tab is open is a fact about
      the panel, not about the row the filter happens to return.
    */
    type: 'Column',
    props: { width: '100%', ...fills },
    $localState: { tab: { type: 'string', initial: 'about' } },
    children: [
      {
        type: '$each',
        props: {
          items: expr`filter(spaceStore.spaceList, { uuid: ${uuid} })`,
          as: 'space',
        },
        children: [
          {
            type: 'Column',
            props: { gap: '400', width: '100%', ...fills },
            children: [
              ...chrome,
              {
                type: '$if',
                props: {
                  condition: { $: 'space.isWeSpace' },
                  then: {
                    type: 'Column',
                    props: { gap: '400', width: '100%', ...fills },
                    children: [
                      {
                        type: 'we-tabs',
                        props: {
                          selectedKey: { $: 'local.tab' },
                          gap: '100',
                          width: '100%',
                          // Never squeezed by the scroll region beside it: the strip is how you reach
                          // the other tabs, so it is the last thing that should give up height.
                          flex: '0 0 auto',
                          // Dragged narrow, four tabs do not fit — and a panel clips rather than
                          // scrolling, so without these the last tab is simply unreachable.
                          // `minWidth` releases the flex item's automatic minimum size, which is
                          // otherwise the tabs' own content width — so the strip would refuse to
                          // narrow and overflow the panel instead of scrolling inside it.
                          minWidth: '0',
                          overflowX: 'auto',
                        },
                        children: TABS.map((tab) => ({
                          type: 'we-tab',
                          props: { key: tab.key, label: tab.label, onClick: { $setLocal: 'tab', value: tab.key } },
                        })),
                      },

                      /*
                    About — the space's own identity, and the link that gets someone else into it.

                    Community-owned throughout, which is why the note says so once rather than each
                    card repeating it. `communitySection` is itself gated on being able to
                    administer, so a member who cannot sees the invite link alone: correct, if
                    sparse, and the note explains the sparseness.
                  */
                      tabPanel(
                        'about',
                        [
                          audienceNote('Everyone in this space sees these.', { $: 'space.canAdminister' }),
                          communitySection,
                          shareSection,
                        ],
                        fill,
                      ),

                      /*
                    Appearance — the two audiences meet here, so the group headings stay.

                    The space's defaults are what a member gets on arrival; the overrides below are
                    what *you* see instead, and change nothing for anybody else. Those are opposite
                    answers to "who sees this", one card apart, and the headings are the only thing
                    saying so.
                  */
                      tabPanel(
                        'appearance',
                        [
                          groupHeading('Everyone in this space', 'What members get when they open this space.', {
                            $: 'space.canAdminister',
                          }),
                          spaceDefaultsSection,
                          groupHeading('Just for you, here', 'Nobody else is affected by anything in this group.'),
                          personalAppearanceSection,
                        ],
                        fill,
                      ),

                      /*
                    Features — what the space runs, and what you personally see of it.

                    The first heading carries both answers at once rather than splitting each row
                    across two groups: "the community removed this" and "you hid this" are the two
                    situations a member has to tell apart, and they are only distinguishable when
                    shown together. See `moduleRow`.

                    Extraction sits under a second heading because it is not a two-answer row — it is
                    a community decision with a cost attached, and it would read as a third switch on
                    the module list otherwise.
                  */
                      tabPanel(
                        'features',
                        [
                          groupHeading('What this space has', 'Two answers per row: yours, and the community’s.'),
                          spaceSectionsSection,
                          modulesSection,
                          groupHeading('Everyone in this space', 'What this space does on its own, for every member.', {
                            $: 'space.canAdminister',
                          }),
                          autoInterpretSection,
                          extractionTargetsSection,
                          shareExtractionDetailSection,
                        ],
                        fill,
                      ),

                      /*
                    Vocabulary — what this community has decided things mean.

                    The one tab that can refuse: it reads from the open dataset, so from the spaces
                    list it can only answer for the space you are already in. In the panel that
                    refusal is unreachable, since the panel is always about the open space.
                  */
                      tabPanel(
                        'vocabulary',
                        [
                          audienceNote('Everyone in this space sees these.', { $: 'space.canAdminister' }),
                          spaceVocabularySection,
                        ],
                        fill,
                      ),
                    ],
                  },
                  else: notAWeSpaceNotice,
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

/** The page in Settings → Spaces & data, for whichever row was clicked. */
export const spaceSettingsPage: SchemaNode = spaceSettingsBody(routeSpaceUuid, [backLink, pageHeader]);
