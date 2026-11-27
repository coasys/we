/**
 * Polls — ask the space a question and watch the answer arrive.
 *
 * ## Why this module exists
 *
 * It is the proof the contract asked for: the smallest module that uses every kind of contribution
 * a third party is likely to want. It declares **entities**, ships a **block** (a poll composes into
 * a post), a **view** (a section a space can enable), a **part** any template can place, a
 * **function** expressions can call, a **setting** a community decides, a declared **operation** for
 * the one write that depends on a read (`polls.vote`), and a **store** that runs it and says when it
 * fails.
 *
 * It was written against the contract rather than alongside it, which is what makes it a test of
 * the seams: nothing here was in anybody's mind when the contract was drawn.
 *
 * ## What is data and what is code
 *
 * Almost everything is data. The poll and the vote are declared entities; the card, the composer and
 * the section are fragments; counting is a pure function; casting a vote — *find the one you cast
 * before, then change it or make one* — is a declared operation, which the host draws before it
 * lands as it does every one. The store holds only which poll a vote is being written for. That is the
 * shape a module should aspire to: declare what you can, and write only what a declaration cannot say.
 *
 * ## Own the container, never the content
 *
 * A poll's votes name their poll by id and are read back by a query, exactly as the notes module's
 * notes are `TextBlock`s in a collection rather than a `Note`. Nothing here is a copy of anything.
 */
import { defineModule, type ModuleDefinition, type ModuleHost, type ModuleStoreDeps } from '@we/module-shared';

import { POLLS_MANIFEST } from './entities';
import { tallyFunction } from './functions';
import { pollCard, pollComposer, pollsView } from './Poll.schema';
import { createPollsStore } from './store';

export { POLLS_MANIFEST } from './entities';
export { pollOptions, tally, type TallyRow } from './functions';
export { pollCard, pollComposer, pollsView } from './Poll.schema';
export { createPollsStore } from './store';

export const pollsModule: ModuleDefinition = defineModule({
  manifest: {
    id: 'polls',
    name: 'Polls',
    description: 'Ask the space a question and watch the answer arrive.',
    icon: 'chart-bar',
    // No `frameworks` — every piece of UI is a fragment — and no kernel: the vote's read and write are
    // the declared operation, run through `deps.operations`.
  },

  contributes: {
    entities: { manifest: POLLS_MANIFEST },

    /**
     * `pollCard` is public API: a template places it over any Poll record bound as `block`, and the
     * block contribution below names it as the card a composed poll is drawn with.
     */
    parts: {
      pollCard: {
        node: pollCard,
        label: 'Poll',
        description: 'A poll with its choices, the votes so far, and a vote of your own.',
        inputs: { block: { description: 'the Poll record to show' } },
      },
      pollComposer: {
        node: pollComposer,
        label: 'New poll',
        description: 'Asks the space a question with a list of choices.',
      },
    },

    /** A poll composes into a post. No input component — it is inserted through the record form. */
    blocks: [{ entity: 'Poll', card: 'pollCard' }],

    /** A section a space may enable. */
    views: [pollsView],

    /** Counting, for any template that shows a tally — this module's cards and anybody else's. */
    functions: [tallyFunction],

    /**
     * Whether a poll shows its counts before somebody has voted. A community's decision: some want
     * an unbiased answer, some want to see where the room is.
     */
    settings: [
      {
        key: 'revealBeforeVoting',
        label: 'Show counts before voting',
        description: 'Whether a poll’s tally is visible to somebody who has not voted yet.',
        type: 'boolean',
        default: true,
        levels: ['space'],
      },
    ],
  },

  createStore: (deps: ModuleStoreDeps) => createPollsStore(deps),
});

/** The one factory shape every module package exports — the generated registry imports it. */
export const createModule = (_host: ModuleHost): ModuleDefinition => pollsModule;
