import type { SchemaNode } from '@we/schema-solid';

/**
 * A real WE template rendered with real design-system components (Column/Row/Card + we-* primitives)
 * over the in-memory backend. Exercises $query, $each, where/OR filter, order, include (author), and
 * context dot-paths — the same surface the headless slice proves, now painting in a browser.
 */
export const feedTemplate: SchemaNode = {
  type: 'Column',
  props: { bg: 'neutral-50', p: '600', gap: '400', minHeight: '100vh', maxWidth: '640px', mx: 'auto' },
  children: [
    { type: 'we-text', props: { variant: 'heading-lg', tag: 'h1' }, children: ['Community Feed'] },
    {
      type: 'we-text',
      props: { variant: 'footnote', color: 'neutral-400' },
      children: ['Rendered by WE over an in-memory, non-AD4M backend.'],
    },
    {
      type: '$each',
      props: {
        items: {
          $query: {
            model: 'Post',
            where: { OR: [{ title: { contains: 'graph' } }, { content: { contains: 'graph' } }] },
            order: { createdAt: 'desc' },
            include: { author: true },
          },
        },
        as: 'post',
      },
      children: [
        {
          type: 'Card',
          props: { p: '400', gap: '300', bg: 'neutral-200' },
          children: [
            {
              type: 'Row',
              props: { gap: '300', ay: 'center' },
              children: [
                { type: 'we-avatar', props: { initials: '$post.author.name', size: 'sm' } },
                { type: 'we-text', props: { variant: 'label' }, children: ['$post.author.name'] },
              ],
            },
            { type: 'we-text', props: { variant: 'heading-sm', tag: 'h2' }, children: ['$post.title'] },
            { type: 'we-text', props: { color: 'neutral-600' }, children: ['$post.content'] },
          ],
        },
      ],
    },
  ],
};
