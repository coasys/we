import type { SchemaNode } from '@we/schema-shared';

export const postsList: SchemaNode = {
  type: 'Column',
  props: { gap: '400' },
  $localState: {
    sortBy: { type: 'string', initial: 'ASC' },
  },
  children: [
    // ── Header: sort controls ──────────────────────────────────────────────
    {
      type: 'Row',
      props: { ay: 'center', gap: '300', pb: '200' },
      children: [
        { type: 'we-text', props: { fontSize: '300', color: 'neutral-500' }, children: ['Sort by'] },
        {
          type: 'we-select',
          props: {
            value: { $local: 'sortBy' },
            options: [
              { label: 'Newest', value: 'DESC' },
              { label: 'Oldest', value: 'ASC' },
            ],
            onChange: { $setLocal: 'sortBy', from: '$event.target.value' },
          },
        },
      ],
    },

    // ── Post list
    {
      type: '$each',
      props: {
        items: {
          $query: {
            model: 'CollectionBlock',
            where: { type: 'root' },
            order: { createdAt: { $local: 'sortBy' } },
            include: { signals: true },
          },
        },
        as: 'post',
      },
      children: [
        {
          type: 'Column',
          props: { width: '100%', bg: 'neutral-25', r: '400', p: '600' },
          children: [
            {
              type: 'Column',
              children: [
                {
                  type: 'BlockRenderer',
                  props: { post: '$post.editorState' },
                },
              ],
            },
            {
              type: 'Column',
              props: { mt: '400', ay: 'center', gap: '300' },
              children: [
                {
                  type: '$each',
                  props: { items: { $query: { model: 'SignalType', subscribe: true } }, as: 'sig' },
                  children: [
                    {
                      type: 'SignalControl',
                      props: {
                        signalType: '$sig',
                        signals: { $filter: { items: '$post.signals', where: { signalTypeId: '$sig.id' } } },
                        myDid: { $store: 'adamStore.me.did' },
                        onSignal: { $action: 'spaceStore.upsertSignal', args: ['$post.id', '$sig.id', '$arg'] },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
