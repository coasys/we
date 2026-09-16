import type { EntityManifest } from '@we/backend-shared';

/**
 * What a poll is, declared rather than written against a backend.
 *
 * ## Two entities
 *
 * A `Poll` is the question and its choices; a `Vote` is one agent's answer to one poll. Separate
 * records rather than a tally on the poll, because a tally written back to the poll is a
 * read-modify-write that two voters lose to each other, and because who voted for what is a fact a
 * community may or may not want to show — a fact is stored once and shown or not, never summarised
 * away at write time.
 *
 * A vote names its poll by id (`pollId`) rather than through a relation, for the reason the Pocket's
 * item names its record by string: it is what makes "my vote on this poll" a native equality in a
 * `where`, which is the one query the card asks on every render. `author` is the backend's own — every
 * record carries who wrote it — so one vote per agent is a query, not a constraint.
 *
 * ## `options` is a string
 *
 * Comma-separated, not a `json` list. A `json` property is a stored blob a form cannot edit and a
 * `where` cannot ask about; a string is what the derived form offers a person and what the block's
 * input would edit. `tally` splits it, once, where it is read.
 *
 * ## Blockable
 *
 * A poll is something a person composes into a post, so it is `blockable` — which obliges a `version`,
 * the counter concurrent edits inside a document are resolved by. The module names `pollCard` as its
 * card, so a poll renders inside a post the way an image or a task does.
 */
export const POLLS_MANIFEST: EntityManifest = {
  version: '1',
  entities: {
    Poll: {
      blockable: true,
      authoring: { fields: ['question', 'options'] },
      display: { title: 'question', fields: ['question', 'options'] },
      properties: {
        question: { type: 'string', required: true, default: '' },
        /** The choices, comma-separated. See the header for why a string. */
        options: { type: 'string', required: true, default: '', control: 'textarea' },
        /** Closed polls take no more votes and show their result to everyone. */
        closed: { type: 'boolean', default: false },
        version: { type: 'number', default: 0 },
      },
      relations: {},
    },
    Vote: {
      properties: {
        pollId: { type: 'string', required: true, default: '' },
        option: { type: 'string', required: true, default: '' },
      },
      relations: {},
    },
  },
};
