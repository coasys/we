import type { SchemaNode } from '@we/schema-shared';
import { cardList, cardShell, emptyState, peopleRow } from '@we/template-kit';

const hasConversationRecord = { $: "find(datasetStore.currentDatasetEntities, { name: 'Conversation' })" };

/*
  Two ways this list can be empty, one sentence for both.

  Either Flux's SDNA is not installed here at all — a plain WE space, where the model is not
  registered and querying it would surface as an error toast — or it is installed and holds
  nothing. The distinction is real but not the reader's problem: what they asked was whether this
  space has Flux conversations, and the answer is no either way.
*/
const noRecord: SchemaNode = emptyState({ icon: 'chats-circle', label: 'Flux conversations', delay: 0 });
const noRows: SchemaNode = emptyState({ icon: 'chats-circle', label: 'Flux conversations', searchable: true });

export const fluxConversationsList: SchemaNode = {
  type: '$if',
  props: {
    condition: hasConversationRecord,
    then: cardList({
      query: {
        entity: 'Conversation',
        dataset: '$currentDataset',
        where: {
          OR: [
            { conversationName: { contains: { $: 'local.searchText' } } },
            { summary: { contains: { $: 'local.searchText' } } },
          ],
        },
        order: { timestamp: { $: 'local.sortDirection' } },
        limit: 20,
      },
      as: 'conversation',
      empty: noRows,
      children: [
        cardShell({
          header: [
            {
              type: 'Row',
              props: { ay: 'center', gap: '300' },
              children: [
                { type: 'we-icon', props: { name: 'chats-circle' } },
                {
                  type: 'we-text',
                  props: { variant: 'heading-sm' },
                  children: [{ $: 'conversation.conversationName' }],
                },
              ],
            },
          ],
          body: [
            {
              type: '$if',
              props: {
                condition: { $: 'conversation.summary' },
                then: { type: 'we-text', props: { color: 'text-muted' }, children: [{ $: 'conversation.summary' }] },
              },
            },
            peopleRow({ items: { $: 'conversation.participants' }, dids: true, noun: 'Participant' }),
          ],
        }),
      ],
    }),
    else: noRecord,
  },
};
