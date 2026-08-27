import type { LocalStateField, SchemaNode } from '@we/schema-shared';
import { agentByline, cardList, cardShell, emptyState, peopleRow } from '@we/template-kit';

const hasConversationModel = { $: "find(datasetStore.currentDatasetModels, { name: 'Conversation' })" };

/*
  Two ways this list can be empty, one sentence for both.

  Either Flux's SDNA is not installed here at all — a plain WE space, where the model is not
  registered and querying it would surface as an error toast — or it is installed and holds
  nothing. The distinction is real but not the reader's problem: what they asked was whether this
  space has Flux conversations, and the answer is no either way.
*/
const noModel: SchemaNode = emptyState({ icon: 'chats-circle', label: 'Flux conversations', delay: 0 });
const noRows: SchemaNode = emptyState({ icon: 'chats-circle', label: 'Flux conversations', searchable: true });

/** Merges extra $localState fields onto a node that may already declare some (e.g. cardShell's own). */
function withLocalState(node: SchemaNode, extra: Record<string, LocalStateField>): SchemaNode {
  return { ...node, $localState: { ...(node.$localState as Record<string, LocalStateField> | undefined), ...extra } };
}

const caretIcon = (openField: string): SchemaNode => ({
  type: 'we-icon',
  props: {
    name: { $if: { condition: { $local: openField }, then: 'caret-down', else: 'caret-right' } },
    size: 'sm',
  },
});

// Subgroup's messages disclosure — messages have no typed relation on ConversationSubgroup
// (they're heterogeneous: message/post/task), so they can't be reached via $query/parent.
// Fetched lazily on first expand through spaceStore.getSubgroupMessages, a raw SPARQL query
// mirroring Flux's own ConversationSubgroup.itemsData(). subgroupMessages stays null until
// loaded, then holds the (possibly empty) array — an empty array is still truthy in JS, so
// $local: 'subgroupMessages' alone distinguishes "not yet loaded" from "loaded".
const subgroupMessagesToggle: SchemaNode = {
  type: 'we-button',
  props: {
    variant: 'secondary',
    size: 'sm',
    alignSelf: 'start',
    px: '200',
    onClick: [
      { $toggleLocal: 'subgroupMessagesOpen' },
      {
        $if: {
          condition: { $: '!local.subgroupMessages' },
          then: {
            $action: 'spaceStore.getSubgroupMessages',
            args: ['$subgroup.id'],
            onSuccess: [{ $setLocal: 'subgroupMessages', from: '$result' }],
          },
        },
      },
    ],
  },
  children: [
    { type: 'we-icon', props: { name: 'envelope-simple', size: 'sm' } },
    {
      type: '$if',
      props: {
        condition: { $local: 'subgroupMessages' },
        then: {
          type: 'Row',
          props: { gap: '100', ay: 'center' },
          children: [
            { type: 'we-number', props: { value: { $: 'count(local.subgroupMessages)' } } },
            {
              type: 'we-text',
              children: [{ $: "plural(count(local.subgroupMessages), 'Message', 'Messages')" }],
            },
          ],
        },
        else: { type: 'we-text', children: ['Messages'] },
      },
    },
    caretIcon('subgroupMessagesOpen'),
  ],
};

const subgroupMessagesList: SchemaNode = {
  type: '$if',
  props: {
    condition: { $local: 'subgroupMessagesOpen' },
    then: {
      type: 'Column',
      props: { gap: '300' }, // pl: '600', borderLeft: '2px solid border'
      children: [
        {
          type: '$each',
          props: { items: { $local: 'subgroupMessages' }, as: 'msg' },
          children: [
            {
              type: 'Column',
              props: { gap: '200', p: '400', bg: 'surface-sunken', r: '300', border: '1px solid border' },
              children: [
                agentByline({ did: '$msg.author', timestamp: '$msg.timestamp' }),
                { type: 'we-html', props: { color: 'text', content: '$msg.body' } },
              ],
            },
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $: 'count(local.subgroupMessages) == 0' },
            then: { type: 'we-text', props: { color: 'text-faint' }, children: ['No messages in this subgroup.'] },
          },
        },
      ],
    },
  },
};

const subgroupCard: SchemaNode = withLocalState(
  {
    type: 'Column',
    props: { gap: '300', p: '400', bg: 'surface-sunken', r: '300', border: '1px solid border' },
    children: [
      {
        type: 'Row',
        props: { ay: 'center', gap: '300' },
        children: [
          { type: 'we-icon', props: { name: 'chat-dots' } },
          { type: 'we-text', props: { fontSize: '400' }, children: ['$subgroup.subgroupName'] },
        ],
      },
      {
        type: '$if',
        props: {
          condition: '$subgroup.summary',
          then: { type: 'we-text', props: { color: 'text-muted' }, children: ['$subgroup.summary'] },
        },
      },
      peopleRow({ items: '$subgroup.participants', dids: true, noun: 'Participant' }),
      subgroupMessagesToggle,
      subgroupMessagesList,
    ],
  },
  { subgroupMessagesOpen: { type: 'boolean', initial: false }, subgroupMessages: { type: 'object', initial: null } },
);

const conversationSubgroupsToggle: SchemaNode = {
  type: 'we-button',
  props: {
    variant: 'secondary',
    size: 'sm',
    px: '200',
    alignSelf: 'start',
    onClick: { $toggleLocal: 'subgroupsOpen' },
  },
  children: [
    { type: 'we-icon', props: { name: 'chat-dots', size: 'sm' } },
    { type: 'we-number', props: { value: '$conversation.$subgroupCount' } },
    {
      type: 'we-text',
      children: [{ $: "plural(conversation.$subgroupCount, 'Subgroup', 'Subgroups')" }],
    },
    caretIcon('subgroupsOpen'),
  ],
};

const conversationSubgroupsList: SchemaNode = {
  type: '$if',
  props: {
    condition: { $local: 'subgroupsOpen' },
    then: {
      type: 'Column',
      props: { gap: '200' }, // pl: '600', borderLeft: '2px solid border'
      children: [
        {
          type: '$each',
          props: {
            items: {
              $query: {
                entity: 'ConversationSubgroup',
                dataset: '$currentDataset',
                // Neutral drill-down: the ConversationSubgroups anchored to this Conversation via its
                // `subgroupEntities` relation. The AD4M adapter resolves `via`→predicate from the
                // perspective's model manifest (→ `ad4m://has_child`), so no raw predicate lives in the
                // template — and it hands AD4M the `{ id, predicate }` form, sidestepping its broken
                // relation-name resolver (`resolveParentPredicate`).
                scope: { anchor: 'Conversation', via: 'subgroupEntities', anchorId: '$conversation.id' },
              },
            },
            as: 'subgroup',
          },
          children: [subgroupCard],
        },
      ],
    },
  },
};

export const fluxConversationsNestedList: SchemaNode = {
  type: '$if',
  props: {
    condition: hasConversationModel,
    then: cardList({
      query: {
        entity: 'Conversation',
        dataset: '$currentDataset',
        where: {
          OR: [
            { conversationName: { contains: { $local: 'searchText' } } },
            { summary: { contains: { $local: 'searchText' } } },
          ],
        },
        order: { timestamp: { $local: 'sortDirection' } },
        limit: 20,
        include: {
          $subgroupCount: {
            from: 'subgroupEntities',
            count: true,
            where: { type: 'flux://conversation_subgroup' },
          },
        },
      },
      as: 'conversation',
      empty: noRows,
      children: [
        withLocalState(
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
                    children: ['$conversation.conversationName'],
                  },
                ],
              },
            ],
            body: [
              {
                type: '$if',
                props: {
                  condition: '$conversation.summary',
                  then: {
                    type: 'we-text',
                    props: { color: 'text-muted' },
                    children: ['$conversation.summary'],
                  },
                },
              },
              peopleRow({ items: '$conversation.participants', dids: true, noun: 'Participant' }),
              conversationSubgroupsToggle,
              conversationSubgroupsList,
            ],
          }),
          { subgroupsOpen: { type: 'boolean', initial: false } },
        ),
      ],
    }),
    else: noModel,
  },
};
