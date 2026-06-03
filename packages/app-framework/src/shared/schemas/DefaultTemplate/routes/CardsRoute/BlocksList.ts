import type { SchemaNode } from '@we/schema-shared';

export const blocksList: SchemaNode = {
  type: 'Column',
  props: { gap: '400' },
  children: [
    {
      type: '$each',
      props: {
        items: { $query: { model: 'ImageBlock', subscribe: true } },
        as: 'block',
      },
      children: [
        {
          type: 'Column',
          props: { p: '400', r: '400', bg: 'neutral-100', gap: '200' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '400', fontWeight: 'semibold', color: 'neutral-500' },
              children: ['Image Block'],
            },
            {
              type: 'we-image',
              props: {
                src: '$block.src',
                alt: '$block.altText',
              },
            },
          ],
        },
      ],
    },
  ],
};
