import type { SchemaNode } from '@we/schema-shared';
import { spaceImageChange } from '@we/template-kit';

export const spaceSidebar: SchemaNode = {
  type: 'Column',
  props: { flex: '0 0 400px', gap: '200', bg: 'surface-raised' },
  children: [
    // Cover image
    {
      type: 'EditableImage',
      props: {
        src: { $: 'spaceSettings.currentSpace.coverImage' },
        alt: 'Cover image',
        fit: 'cover',
        width: '100%',
        height: '180px',
        aspect: 4 / 1,
        placeholderIcon: 'panorama',
        uploadLabel: 'Upload cover image',
        editLabel: 'Change cover image',
        onImageChange: spaceImageChange('coverImage'),
      },
    },
    {
      type: 'Column',
      props: { mt: '-65px', width: '100%', ax: 'center' },
      children: [
        // Profile picture
        {
          type: 'EditableImage',
          props: {
            src: { $: 'spaceSettings.currentSpace.avatar' },
            alt: 'Profile picture',
            fit: 'cover',
            width: '120px',
            height: '120px',
            r: 'avatar',
            ring: '0 0 0 2px var(--we-ring-color)',
            placeholderIcon: 'users-three',
            uploadLabel: 'Add image',
            editLabel: 'Change image',
            fontSize: '200',
            onImageChange: spaceImageChange('avatar'),
          },
        },
      ],
    },
    // Space Details
    {
      type: 'Column',
      props: { p: '400', gap: '200', ax: 'center' },
      children: [
        {
          type: 'we-text',
          props: {
            textAlign: 'center',
            loading: { $: '!spaceSettings.currentSpace' },
          },
          children: [{ $: 'spaceSettings.currentSpace.name' }],
        },
        {
          type: 'we-text',
          props: {
            variant: 'body',
            textAlign: 'center',
            mb: '400',
            loading: { $: '!spaceSettings.currentSpace' },
          },
          children: [{ $: 'spaceSettings.currentSpace.description' }],
        },
      ],
    },
    // Navigation
    {
      type: 'Column',
      props: { p: '400', gap: '200', ax: 'start' },
      children: [
        {
          // The same resolved list the header layout reads, and the same one the routes are built
          // from — see the note there for what having three copies of it cost.
          type: '$each',
          props: { items: { $: 'navigation.viewNav' }, as: 'view' },
          children: [
            {
              type: 'we-button',
              props: {
                variant: { $: "navigation.segments[2] == view.segment ? 'solid' : 'ghost'" },
                onClick: { $invoke: 'navigation.navigate', args: [{ $: 'view.path' }] },
              },
              children: [
                { type: 'we-icon', props: { name: { $: 'view.icon' } } },
                { type: 'we-text', children: [{ $: 'view.label' }] },
              ],
            },
          ],
        },
      ],
    },
  ],
};
