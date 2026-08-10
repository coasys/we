import type { SchemaNode } from '@we/schema-shared';

import { emptyState } from '../../EmptyState.ts';
import { cardList, cardShell } from './CardShell.ts';

const hasMessageModel = {
  $find: { items: { $store: 'datasetStore.currentDatasetModels' }, where: { name: 'Message' } },
};

/*
  Two ways this list can be empty, one sentence for both.

  Either Flux's SDNA is not installed here at all — a plain WE space, where the model is not
  registered and querying it would surface as an error toast — or it is installed and holds
  nothing. The distinction is real but not the reader's problem: what they asked was whether this
  space has Flux messages, and the answer is no either way.
*/
const noModel: SchemaNode = emptyState({ icon: 'envelope-simple', label: 'Flux messages', delay: 0 });
const noRows: SchemaNode = emptyState({ icon: 'envelope-simple', label: 'Flux messages', searchable: true });

export const fluxMessagesList: SchemaNode = {
  type: '$if',
  props: {
    condition: hasMessageModel,
    then: cardList({
      query: {
        entity: 'Message',
        dataset: '$currentDataset',
        where: { body: { contains: { $local: 'searchText' } } },
        order: { timestamp: { $local: 'sortDirection' } },
        limit: 30,
      },
      as: 'message',
      empty: noRows,
      children: [
        cardShell({
          header: [
            {
              type: '$agent',
              props: { did: '$message.author', as: 'author' },
              children: [
                {
                  type: 'Row',
                  props: { ay: 'center', gap: '300' },
                  children: [
                    {
                      type: 'we-avatar',
                      props: { size: 'sm', image: '$author.avatar', hash: '$author.did' },
                    },
                    {
                      type: 'we-text',
                      props: { fontWeight: 'semibold' },
                      children: ['$author.name'],
                    },
                    {
                      type: 'we-timestamp',
                      props: { value: '$message.createdAt', relative: true, color: 'neutral-500' },
                    },
                  ],
                },
              ],
            },
          ],
          body: [{ type: 'we-html', props: { content: '$message.body' } }],
        }),
      ],
    }),
    else: noModel,
  },
};
