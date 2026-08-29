import type { SchemaNode } from '@we/schema-shared';
import { cardList, cardShell, emptyState, peopleRow } from '@we/template-kit';

const hasConversationSubgroupRecord = {
  $: "find(datasetStore.currentDatasetEntities, { name: 'ConversationSubgroup' })",
};

/*
  Two ways this list can be empty, one sentence for both.

  Either Flux's SDNA is not installed here at all — a plain WE space, where the model is not
  registered and querying it would surface as an error toast — or it is installed and holds
  nothing. The distinction is real but not the reader's problem: what they asked was whether this
  space has Flux conversation subgroups, and the answer is no either way.
*/
const noRecord: SchemaNode = emptyState({ icon: 'chat-dots', label: 'Flux conversation subgroups', delay: 0 });
const noRows: SchemaNode = emptyState({ icon: 'chat-dots', label: 'Flux conversation subgroups', searchable: true });

export const fluxConversationSubgroupsList: SchemaNode = {
  type: '$if',
  props: {
    condition: hasConversationSubgroupRecord,
    then: cardList({
      query: {
        entity: 'ConversationSubgroup',
        dataset: '$currentDataset',
        where: {
          OR: [
            { subgroupName: { contains: { $: 'local.searchText' } } },
            { summary: { contains: { $: 'local.searchText' } } },
          ],
        },
        order: { timestamp: { $: 'local.sortDirection' } },
        limit: 20,
      },
      as: 'subgroup',
      empty: noRows,
      children: [
        cardShell({
          header: [
            {
              type: 'Row',
              props: { ay: 'center', gap: '300' },
              children: [
                { type: 'we-icon', props: { name: 'chat-dots' } },
                { type: 'we-text', props: { variant: 'heading-sm' }, children: [{ $: 'subgroup.subgroupName' }] },
              ],
            },
          ],
          body: [
            {
              type: '$if',
              props: {
                condition: { $: 'subgroup.summary' },
                then: { type: 'we-text', props: { color: 'text-muted' }, children: [{ $: 'subgroup.summary' }] },
              },
            },
            peopleRow({ items: { $: 'subgroup.participants' }, dids: true, noun: 'Participant' }),
          ],
        }),
      ],
    }),
    else: noRecord,
  },
};
