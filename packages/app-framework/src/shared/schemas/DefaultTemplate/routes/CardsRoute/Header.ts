import type { SchemaNode } from '@we/schema-shared';

export const postsHeader: SchemaNode = {
  type: 'Row',
  props: { ax: 'between', ay: 'center', gap: '200' },
  children: [
    // Mode toggle
    {
      type: 'Row',
      props: { gap: '100' },
      children: [
        {
          type: 'we-button',
          props: {
            text: 'Posts',
            height: '32px',
            width: 'fit-content',
            bg: {
              $if: {
                condition: { $eq: [{ $local: 'viewMode' }, 'posts'] },
                then: 'primary-500',
                else: 'neutral-100',
              },
            },
            color: {
              $if: {
                condition: { $eq: [{ $local: 'viewMode' }, 'posts'] },
                then: 'neutral-0',
                else: 'neutral-600',
              },
            },
            onClick: { $setLocal: 'viewMode', value: 'posts' },
          },
        },
        {
          type: 'we-button',
          props: {
            text: 'Blocks',
            height: '32px',
            width: 'fit-content',
            bg: {
              $if: {
                condition: { $eq: [{ $local: 'viewMode' }, 'blocks'] },
                then: 'primary-500',
                else: 'neutral-100',
              },
            },
            color: {
              $if: {
                condition: { $eq: [{ $local: 'viewMode' }, 'blocks'] },
                then: 'neutral-0',
                else: 'neutral-600',
              },
            },
            onClick: { $setLocal: 'viewMode', value: 'blocks' },
          },
        },
      ],
    },
    // Create Post button
    {
      type: 'we-button',
      props: {
        text: 'Create Post',
        bg: 'primary-500',
        color: 'neutral-0',
        height: '40px',
        width: 'fit-content',
        onClick: { $setLocal: 'createPostOpen', value: true },
      },
    },
  ],
};
