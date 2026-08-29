import type { SchemaNode } from '@we/schema-shared';
import { agentByline, cardList, cardShell, emptyState } from '@we/template-kit';

const hasMessageRecord = { $: "find(datasetStore.currentDatasetEntities, { name: 'Message' })" };

/*
  Two ways this list can be empty, one sentence for both.

  Either Flux's SDNA is not installed here at all — a plain WE space, where the model is not
  registered and querying it would surface as an error toast — or it is installed and holds
  nothing. The distinction is real but not the reader's problem: what they asked was whether this
  space has Flux messages, and the answer is no either way.
*/
const noRecord: SchemaNode = emptyState({ icon: 'envelope-simple', label: 'Flux messages', delay: 0 });
const noRows: SchemaNode = emptyState({ icon: 'envelope-simple', label: 'Flux messages', searchable: true });

export const fluxMessagesList: SchemaNode = {
  type: '$if',
  props: {
    condition: hasMessageRecord,
    then: cardList({
      query: {
        entity: 'Message',
        dataset: '$currentDataset',
        where: { body: { contains: { $: 'local.searchText' } } },
        order: { timestamp: { $: 'local.sortDirection' } },
        limit: 30,
      },
      as: 'message',
      empty: noRows,
      children: [
        cardShell({
          drag: { entity: 'Message', id: { $: 'message.id' }, label: { $: 'message.body' }, icon: 'chat-text' },
          header: [agentByline({ did: { $: 'message.author' }, timestamp: { $: 'message.createdAt' } })],
          body: [{ type: 'we-html', props: { content: { $: 'message.body' } } }],
        }),
      ],
    }),
    else: noRecord,
  },
};
