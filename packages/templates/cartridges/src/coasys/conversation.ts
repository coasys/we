/**
 * The conversation DNA Coasys brings: what a call is interpreted into, and how a topic moves.
 *
 * A call becomes a tree: its agenda, the topics discussed under each part, and the positions people
 * took and the questions they left open about each topic. Action items are tasks (`TaskBlock`), on the
 * board and in the task states the starter writes.
 *
 * In Coasys's own vocabulary (`conv://`), not WE's: these are an app's shapes, not WE's ontology. A
 * record is one of them by its required fields, with no WE type marker, as the vocabulary was first
 * written into Coasys's spaces by hand, so the records already there match the same types.
 *
 * Each interpretation hint is what the interpretation model is told about a class or a field. The
 * accept policy each class once carried (`auto_accept`) is left out: nothing here can say it yet.
 */
import type { BundleWorkflow } from '@we/schema-shared';
import type { FixtureShape } from '@we/template-fixtures';

export const conversationShapes: FixtureShape[] = [
  {
    name: 'AgendaItem',
    icon: 'list-numbers',
    description: 'One part of a call, as its agenda gave it or as it came up',
    manifest: {
      version: '1',
      entities: {
        AgendaItem: {
          namespace: 'conv://',
          flag: false,
          description: 'One part of a call, as its agenda gave it or as it came up',
          interpretationHint:
            "One line of the call's agenda: a high-level part of the call such as 'Check in' or 'Pricing'. A one-hour call has 4 to 8. When someone states the agenda, in speech or in a chat message, create one AgendaItem per line, in the words used. When no agenda was stated and the conversation moves to a subject that none of the `existing` AgendaItems covers, create one for it; name it for the whole part of the call, not for the first point made in it. Never create a second AgendaItem for a part that is already in `existing`. Keep `status` up to date: when the turns show the call moving on to another part, emit the AgendaItem that starts with status `current` and the one that ended with status `done`, each with its `id`.",
          extractable: true,
          properties: {
            title: {
              type: 'string',
              predicate: 'conv://agenda_title',
              required: true,
              identity: true,
              interpretationHint: 'The agenda line as stated, or 2-6 words naming this part of the call.',
            },
            order: {
              type: 'string',
              predicate: 'conv://agenda_order',
              interpretationHint: 'Position on the agenda as a number: 1 for the first line, 2 for the second.',
            },
            source: {
              type: 'string',
              predicate: 'conv://agenda_source',
              interpretationHint:
                '`stated` when someone gave this line as agenda, `detected` when you created it from the flow of the conversation.',
            },
            status: {
              type: 'string',
              predicate: 'conv://agenda_status',
              interpretationHint:
                'Where the call is: `upcoming` before this part starts, `current` while the call is in it, `done` once the call has moved on. Two parts can be `current` together when the talk goes back and forth between them.',
            },
          },
          relations: {},
        },
      },
    },
  },
  {
    name: 'DiscussionTopic',
    icon: 'chats-circle',
    description: 'One thread a conversation goes back and forth on',
    manifest: {
      version: '1',
      entities: {
        DiscussionTopic: {
          namespace: 'conv://',
          flag: false,
          description: 'One thread a conversation goes back and forth on',
          interpretationHint:
            "One thread of discussion: a single question, proposal or problem that people go back and forth on for several turns. Keep topics narrow: 'Whether to buy drip irrigation' and 'Who pays the water bill' are two topics, not one 'Garden watering'. A 30-minute working call usually has 5-8 topics. Not small talk, audio problems, greetings or scheduling. If the thread is already in `existing`, do not emit it again unless its summary or clarity changed; then emit it with its `id`. When the turns open a new thread inside the area of an existing broad topic, create a new DiscussionTopic for it. Give every new topic its place: `agendaItem` for the part of the call it belongs to, or `subTopicOf` when it is one aspect of a topic already in `existing`.",
          extractable: true,
          properties: {
            title: {
              type: 'string',
              predicate: 'conv://title',
              required: true,
              identity: true,
              interpretationHint: 'Short label for the subject, 3-10 words.',
            },
            summary: {
              type: 'string',
              predicate: 'conv://summary',
              interpretationHint:
                'One or two sentences: what is being discussed, who holds which view, and where it stands now.',
            },
            clarity: {
              type: 'string',
              predicate: 'conv://clarity',
              interpretationHint:
                'How clear the shared understanding is, judged from the whole exchange: low (people are confused, talk past each other, or the key question is open), medium, or high (everyone understands it the same way and agrees on what it means).',
            },
          },
          relations: {
            agendaItem: {
              target: 'AgendaItem',
              cardinality: 'one',
              predicate: 'conv://agenda_item',
              interpretationHint:
                'The AgendaItem this topic belongs to: the part of the call in which it is discussed, normally the one whose `status` is `current`. Choose by where the call is, not by which agenda title sounds closest to the topic. Leave empty only when no AgendaItem fits.',
            },
            subTopicOf: {
              target: 'DiscussionTopic',
              cardinality: 'one',
              predicate: 'conv://sub_topic_of',
              interpretationHint:
                "Set only when this topic is one aspect of a broader DiscussionTopic already in `existing`, such as 'Encryption at rest' under 'Executor tenancy'. Do not set it because one topic followed another in the conversation. The target is always a DiscussionTopic, never an AgendaItem, and must itself have no `subTopicOf`.",
            },
          },
        },
      },
    },
  },
  {
    name: 'Position',
    icon: 'hand',
    description: 'A view one person states on a topic',
    manifest: {
      version: '1',
      entities: {
        Position: {
          namespace: 'conv://',
          flag: false,
          description: 'A view one person states on a topic',
          interpretationHint:
            'A view one participant states on a topic: a proposal, support, doubt or objection. Write the view in the field `statement` (never `title`). Every participant who says something substantive about a topic gets their own Position, so a topic discussed by three people usually has two to four Positions. Always link it to its DiscussionTopic with `about`.',
          extractable: true,
          properties: {
            statement: {
              type: 'string',
              predicate: 'conv://statement',
              required: true,
              identity: true,
              interpretationHint: "The view in one sentence, in the speaker's terms.",
            },
            holder: {
              type: 'string',
              predicate: 'conv://holder',
              interpretationHint:
                "The participant's name exactly as in the transcript's `speaker` field. If every turn has the same speaker (one recording without speaker labels), infer the person from the content: who is addressed by name, who says 'I will' about their own work; write 'unknown' if you cannot tell.",
            },
            stance: {
              type: 'string',
              predicate: 'conv://stance',
              interpretationHint: 'One of: proposes, supports, questions, objects.',
            },
          },
          relations: {
            about: {
              target: 'DiscussionTopic',
              cardinality: 'one',
              predicate: 'conv://about',
              interpretationHint: 'The DiscussionTopic this position is about.',
            },
          },
        },
      },
    },
  },
  {
    name: 'Question',
    icon: 'question',
    description: 'A question the group leaves open',
    manifest: {
      version: '1',
      entities: {
        Question: {
          namespace: 'conv://',
          flag: false,
          description: 'A question the group leaves open',
          interpretationHint:
            'A question the group raises and leaves open: something they say they do not know yet or must decide later. Not rhetorical questions and not questions answered a few turns later. Write it in the field `text`.',
          extractable: true,
          properties: {
            text: {
              type: 'string',
              predicate: 'conv://text',
              required: true,
              identity: true,
              interpretationHint: 'The question, phrased as a question.',
            },
            askedBy: {
              type: 'string',
              predicate: 'conv://askedBy',
              interpretationHint: 'Name of the participant who raised it, as in `speaker`.',
            },
          },
          relations: {
            about: {
              target: 'DiscussionTopic',
              cardinality: 'one',
              predicate: 'conv://about',
              interpretationHint: 'The DiscussionTopic the question belongs to.',
            },
          },
        },
      },
    },
  },
];

/** How far a group has got on one topic. */
export const conversationTopicWorkflow: BundleWorkflow = {
  name: 'ConversationTopic',
  entities: ['DiscussionTopic'],
  hint: "Tracks how far the group has got on one topic. Propose the topic's next state in `flow_proposals` as soon as the turns show it.",
  states: [
    {
      name: 'raised',
      hint: 'Only one person has spoken about it so far.',
    },
    {
      name: 'discussing',
      hint: 'Two or more people engage and views differ, someone is confused, or the key question is still open.',
    },
    {
      name: 'resonant',
      hint: 'The people engaging agree on the substance ("yes", "makes sense", "I think that\'s right", "cool") and nobody holds an objection, or the group settles on a concrete decision.',
    },
    {
      name: 'parked',
      hint: 'The group explicitly defers it ("later", "next week", "not now", "let\'s not spend time on this now").',
    },
  ],
  transitions: [
    {
      from: 'raised',
      to: 'discussing',
      name: 'Engage',
    },
    {
      from: 'raised',
      to: 'resonant',
      name: 'Agree',
    },
    {
      from: 'discussing',
      to: 'resonant',
      name: 'Agree',
    },
    {
      from: 'raised',
      to: 'parked',
      name: 'Park',
    },
    {
      from: 'discussing',
      to: 'parked',
      name: 'Park',
    },
    {
      from: 'parked',
      to: 'discussing',
      name: 'Resume',
    },
  ],
};
