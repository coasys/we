import type { LocalStateField, SchemaNode } from '@we/schema-shared';

import { cardShell, gridWrapper } from './CardShell.ts';

const hasConversationModel = {
  $find: { items: { $store: 'adamStore.currentPerspectiveModels' }, where: { name: 'Conversation' } },
};

const emptyState: SchemaNode = {
  type: 'Column',
  props: { ax: 'center', ay: 'center', gap: '200', p: '600', width: '100%' },
  children: [
    { type: 'we-icon', props: { name: 'chats-circle', size: 'lg', color: 'neutral-400' } },
    {
      type: 'we-text',
      props: { color: 'neutral-400', textAlign: 'center' },
      children: ["This space doesn't have any Flux conversations."],
    },
  ],
};

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
          condition: { $not: { $local: 'subgroupMessages' } },
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
            { type: 'we-number', props: { value: { $count: { items: { $local: 'subgroupMessages' } } } } },
            {
              type: 'we-text',
              children: [
                {
                  $plural: {
                    count: { $count: { items: { $local: 'subgroupMessages' } } },
                    one: 'Message',
                    other: 'Messages',
                  },
                },
              ],
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
      props: { gap: '300' }, // pl: '600', borderLeft: '2px solid neutral-200'
      children: [
        {
          type: '$each',
          props: { items: { $local: 'subgroupMessages' }, as: 'msg' },
          children: [
            {
              type: 'Column',
              props: { gap: '200', p: '400', bg: 'neutral-50', r: '300', border: '1px solid neutral-200' },
              children: [
                {
                  type: '$agent',
                  props: { did: '$msg.author', as: 'author' },
                  children: [
                    {
                      type: 'Row',
                      props: { ay: 'center', gap: '300' },
                      children: [
                        { type: 'we-avatar', props: { size: 'sm', image: '$author.avatar', hash: '$author.did' } },
                        {
                          type: 'we-text',
                          props: { fontWeight: 'semibold' },
                          children: [{ $concat: ['$author.firstName', ' ', '$author.lastName'] }],
                        },
                        {
                          type: 'we-timestamp',
                          props: { value: '$msg.timestamp', relative: true, color: 'neutral-500' },
                        },
                      ],
                    },
                  ],
                },
                { type: 'we-html', props: { color: 'neutral-700', content: '$msg.body' } },
              ],
            },
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $count: { items: { $local: 'subgroupMessages' } } }, 0] },
            then: { type: 'we-text', props: { color: 'neutral-400' }, children: ['No messages in this subgroup.'] },
          },
        },
      ],
    },
  },
};

const subgroupCard: SchemaNode = withLocalState(
  {
    type: 'Column',
    props: { gap: '300', p: '400', bg: 'neutral-75', r: '300', border: '1px solid neutral-200' },
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
          then: { type: 'we-text', props: { color: 'neutral-600' }, children: ['$subgroup.summary'] },
        },
      },
      {
        type: 'Row',
        props: { gap: '300', ay: 'center' },
        children: [
          {
            type: 'AvatarStack',
            props: {
              avatars: {
                $map: {
                  items: '$subgroup.participants',
                  select: {
                    image: {
                      $find: {
                        items: { $store: 'adamStore.agents' },
                        where: { did: '$item' },
                        select: 'avatar',
                      },
                    },
                    hash: '$item',
                  },
                },
              },
              max: 5,
              size: 'sm',
              ring: '0 0 0 2px var(--we-ring-color)',
            },
          },
          {
            type: 'Row',
            props: { gap: '100' },
            children: [
              {
                type: 'we-number',
                props: { value: { $count: { items: '$subgroup.participants' } }, shorten: true },
              },
              {
                type: 'we-text',
                children: [
                  {
                    $plural: {
                      count: { $count: { items: '$subgroup.participants' } },
                      one: 'Participant',
                      other: 'Participants',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
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
      children: [{ $plural: { count: '$conversation.$subgroupCount', one: 'Subgroup', other: 'Subgroups' } }],
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
      props: { gap: '200' }, // pl: '600', borderLeft: '2px solid neutral-200'
      children: [
        {
          type: '$each',
          props: {
            items: {
              $query: {
                model: 'ConversationSubgroup',
                perspective: 'adamStore.currentPerspective',
                // `parent: { id, relation }` is broken end-to-end in the schema-system —
                // it never translates into ad4m's real ParentScope shape ({ model, id, field }
                // or { id, predicate }), so it crashes resolveParentPredicate with a WeakMap
                // error. Use the raw predicate form instead. `ad4m://has_child` is HasMany's
                // default `through` value, which is what Conversation.subgroupEntities uses
                // since it declares no explicit `through`.
                parent: { id: '$conversation.id', predicate: 'ad4m://has_child' },
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
    then: gridWrapper([
      {
        type: '$each',
        props: {
          items: {
            $query: {
              model: 'Conversation',
              perspective: 'adamStore.currentPerspective',
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
          },
          as: 'conversation',
        },
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
                      props: { color: 'neutral-600' },
                      children: ['$conversation.summary'],
                    },
                  },
                },
                {
                  type: 'Row',
                  props: { gap: '300', ay: 'center' },
                  children: [
                    {
                      type: 'AvatarStack',
                      props: {
                        avatars: {
                          $map: {
                            items: '$conversation.participants',
                            select: {
                              image: {
                                $find: {
                                  items: { $store: 'adamStore.agents' },
                                  where: { did: '$item' },
                                  select: 'avatar',
                                },
                              },
                              hash: '$item',
                            },
                          },
                        },
                        max: 5,
                        size: 'sm',
                        ring: '0 0 0 2px var(--we-ring-color)',
                      },
                    },
                    {
                      type: 'Row',
                      props: { gap: '100' },
                      children: [
                        {
                          type: 'we-number',
                          props: { value: { $count: { items: '$conversation.participants' } }, shorten: true },
                        },
                        {
                          type: 'we-text',
                          children: [
                            {
                              $plural: {
                                count: { $count: { items: '$conversation.participants' } },
                                one: 'Participant',
                                other: 'Participants',
                              },
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                conversationSubgroupsToggle,
                conversationSubgroupsList,
              ],
            }),
            { subgroupsOpen: { type: 'boolean', initial: false } },
          ),
        ],
      },
    ]),
    else: emptyState,
  },
};
