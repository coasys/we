import type { SchemaNode } from '@we/schema-shared';

/**
 * A person's profile, as a page: their cover and picture, their name and handle, what they say about
 * themselves, where they are and their key — and, when it is yours, the form to change it.
 *
 * One page for anybody. WE's own profile (the account's, under the settings cog) and a space's view of
 * a member are the same page with someone else's details in it, so the two cannot drift. It reads a
 * profile bound by name — wrap it in `$agent`, which fetches the person's profile and binds it — and
 * is editable only where `editable` says, which is the case only for your own: the pictures become
 * pictures you can change, and the form is drawn under them.
 */

/**
 * The fields a person edits about themselves — name, handle, bio, where they are. The profile page
 * draws it under the cover and the picture, and Settings → Profile draws it on its own, so there is
 * one form and two places to reach it.
 */
export const profileEditor: SchemaNode = {
  type: 'Card',
  props: { bg: 'surface' },
  children: [
    {
      type: 'Row',
      props: { gap: '300', ay: 'center', mb: '200' },
      children: [
        { type: 'we-icon', props: { name: 'pencil' } },
        {
          type: 'we-text',
          children: ['Edit Profile'],
        },
      ],
    },
    {
      type: 'Row',
      props: { gap: '300', wrap: true },
      children: [
        {
          type: 'we-form-field',
          props: { label: 'First Name' },
          children: [
            {
              type: 'we-input',
              props: {
                placeholder: 'First name',
                value: { $: 'profileStore.ownProfile.firstName' },
                onChange: {
                  $invoke: 'profileStore.updateOwnProfile',
                  args: [{ firstName: { $: 'arg.detail' } }],
                },
              },
            },
          ],
        },
        {
          type: 'we-form-field',
          props: { label: 'Last Name' },
          children: [
            {
              type: 'we-input',
              props: {
                placeholder: 'Last name',
                value: { $: 'profileStore.ownProfile.lastName' },
                onChange: {
                  $invoke: 'profileStore.updateOwnProfile',
                  args: [{ lastName: { $: 'arg.detail' } }],
                },
              },
            },
          ],
        },
      ],
    },
    {
      type: 'we-form-field',
      props: { label: 'Handle' },
      children: [
        {
          type: 'we-input',
          props: {
            placeholder: 'yourhandle',
            value: { $: 'profileStore.ownProfile.handle' },
            onChange: {
              $invoke: 'profileStore.updateOwnProfile',
              args: [{ handle: { $: 'arg.detail' } }],
            },
          },
        },
      ],
    },
    {
      type: 'we-form-field',
      props: { label: 'Bio' },
      children: [
        {
          type: 'we-textarea',
          props: {
            placeholder: 'Tell us about yourself...',
            value: { $: 'profileStore.ownProfile.bio' },
            onChange: {
              $invoke: 'profileStore.updateOwnProfile',
              args: [{ bio: { $: 'arg.detail' } }],
            },
          },
        },
      ],
    },
    {
      type: 'we-form-field',
      props: { label: 'Location' },
      children: [
        {
          type: 'we-location-picker',
          props: {
            latitude: { $: 'profileStore.ownProfile.location.latitude' },
            longitude: { $: 'profileStore.ownProfile.location.longitude' },
            placeholder: 'Pin your location on the globe…',
            onChange: {
              $invoke: 'profileStore.updateOwnLocation',
              args: [
                {
                  latitude: { $: 'arg.detail.latitude' },
                  longitude: { $: 'arg.detail.longitude' },
                  city: { $: 'arg.detail.city' },
                  country: { $: 'arg.detail.country' },
                  countryCode: { $: 'arg.detail.countryCode' },
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
        condition: { $: 'profileStore.ownProfile.location' },
        then: {
          type: 'Row',
          props: { gap: '300', wrap: true },
          children: [
            {
              type: 'we-form-field',
              props: { label: 'City', flex: '1' },
              children: [
                {
                  type: 'we-input',
                  props: {
                    placeholder: 'City',
                    value: { $: 'profileStore.ownProfile.location.city' },
                    onChange: {
                      $invoke: 'profileStore.updateOwnLocation',
                      args: [{ city: { $: 'arg.detail' } }],
                    },
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
                    placeholder: 'Country',
                    value: { $: 'profileStore.ownProfile.location.country' },
                    onChange: {
                      $invoke: 'profileStore.updateOwnLocation',
                      args: [{ country: { $: 'arg.detail' } }],
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    },
  ],
};

export interface ProfilePageOptions {
  /** The name the profile is bound as — what `$agent`'s `as` says. */
  as: string;
  /** Whether this is the viewer's own profile, as an expression: the pictures and the form are theirs. */
  editable: string;
}

/** A picture on the page: one you can change on your own profile, a plain picture on anyone else's. */
const picture = (editable: string, image: SchemaNode, editableImage: SchemaNode): SchemaNode => ({
  type: '$if',
  props: { condition: { $: editable }, then: editableImage, else: image },
});

/** A person's profile as a page — see the module comment. */
export function profilePage({ as, editable }: ProfilePageOptions): SchemaNode {
  const p = (field: string) => `${as}.${field}`;
  return {
    type: 'Column',
    props: { minWidth: '100%', minHeight: '100%', bg: 'chrome', ax: 'center' },
    children: [
      picture(
        editable,
        {
          type: '$if',
          props: {
            condition: { $: p('coverImage') },
            then: {
              type: 'we-image',
              props: { src: { $: p('coverImage') }, alt: '', fit: 'cover', width: '100%', height: '200px' },
            },
            // Nobody's cover yet: the band still stands, so the picture overlapping it sits the same.
            else: { type: 'Column', props: { width: '100%', height: '200px', bg: 'surface-sunken' } },
          },
        },
        {
          type: 'EditableImage',
          props: {
            src: { $: p('coverImage') },
            alt: 'Cover image',
            fit: 'cover',
            width: '100%',
            height: '200px',
            aspect: 4 / 1,
            placeholderIcon: 'panorama',
            uploadLabel: 'Upload cover image',
            editLabel: 'Change cover image',
            onImageChange: { $invoke: 'profileStore.updateProfileImage', args: ['coverImage', { $: 'arg' }] },
            onImageRemove: { $invoke: 'profileStore.clearProfileImage', args: ['coverImage'] },
          },
        },
      ),

      {
        type: 'Column',
        props: { mt: '-60px', maxWidth: '800px', width: '100%', gap: '400', px: '500', mb: '500' },
        children: [
          picture(
            editable,
            {
              type: 'we-avatar',
              props: {
                size: '120px',
                image: { $: p('avatar') },
                initials: { $: p('name') },
                hash: { $: p('did') },
                ringWidth: '3px',
                ringColor: 'border-strong',
              },
            },
            {
              type: 'EditableImage',
              props: {
                src: { $: p('avatar') },
                alt: 'Profile picture',
                fit: 'cover',
                width: '120px',
                height: '120px',
                r: 'avatar',
                /*
                  The disc overlaps the cover image, and the ring is what separates the two — which is
                  `border-strong`, "two regions that are genuinely apart". A role variable rather than
                  the bare name because `ring` is emitted as `box-shadow` verbatim — it is the one
                  colour-carrying DS prop with no token resolution.
                */
                ring: '0 0 0 3px var(--we-role-border-strong)',
                placeholderIcon: 'user',
                uploadLabel: 'Add photo',
                editLabel: 'Change photo',
                fontSize: '200',
                onImageChange: { $invoke: 'profileStore.updateProfileImage', args: ['avatar', { $: 'arg' }] },
                onImageRemove: { $invoke: 'profileStore.clearProfileImage', args: ['avatar'] },
              },
            },
          ),

          // The name the app calls them by everywhere else, then their handle.
          {
            type: 'Column',
            props: { gap: '100', mt: '200' },
            children: [
              { type: 'we-text', props: { variant: 'heading-md' }, children: [{ $: p('name') }] },
              {
                type: '$if',
                props: {
                  condition: { $: p('handle') },
                  then: { type: 'we-text', props: { variant: 'body' }, children: [{ $: `'@' + ${p('handle')}` }] },
                },
              },
            ],
          },

          {
            type: '$if',
            props: {
              condition: { $: p('bio') },
              then: { type: 'we-text', props: { variant: 'body', lineHeight: '1.5' }, children: [{ $: p('bio') }] },
            },
          },

          {
            type: '$if',
            props: {
              condition: { $: p('location') },
              then: {
                type: 'Row',
                props: { gap: '200', ay: 'center' },
                children: [
                  { type: 'we-icon', props: { name: 'map-pin', size: '20px' } },
                  {
                    type: 'we-text',
                    props: { variant: 'body' },
                    children: [{ $: `\`\${${p('location.city')}}, \${${p('location.country')}}\`` }],
                  },
                ],
              },
            },
          },

          {
            type: 'Row',
            props: { gap: '200', ay: 'center' },
            children: [
              { type: 'we-icon', props: { name: 'key', size: '20px' } },
              {
                type: 'we-text',
                props: { variant: 'body', truncate: true, minWidth: '0' },
                children: [{ $: p('did') }],
              },
            ],
          },

          { type: '$if', props: { condition: { $: editable }, then: profileEditor } },
        ],
      },
    ],
  };
}
