/**
 * Polls — ask the space a question and watch the answer arrive.
 *
 * ## Why this module exists
 *
 * It is the proof the contract asked for: the smallest module that uses every kind of contribution
 * a third party is likely to want. It declares **entities**, ships a **block** (a poll composes into
 * a post), a **view** (a section a space can enable), a **part** any template can place, a
 * **function** expressions can call, a **setting** a community decides, and a **store** that does the
 * one thing a template cannot — a write that depends on a read — through the `records` kernel.
 *
 * It was written against the contract rather than alongside it, which is what makes it a test of
 * the seams: nothing here was in anybody's mind when the contract was drawn.
 *
 * ## What is data and what is code
 *
 * Almost everything is data. The poll and the vote are declared entities; the card, the composer and
 * the section are fragments; counting is a pure function. The store is thirty lines, and every line
 * is there because casting a vote means *finding the one you cast before* — a read a schema cannot
 * make from a click handler. That is the shape a module should aspire to: declare what you can, and
 * write only what a declaration cannot say.
 *
 * ## Own the container, never the content
 *
 * A poll's votes name their poll by id and are read back by a query, exactly as the notes module's
 * notes are `TextBlock`s in a collection rather than a `Note`. Nothing here is a copy of anything.
 */
import { defineModule, type ModuleDefinition, type ModuleHost, type ModuleStoreDeps } from '@we/module-shared';

import { POLLS_MANIFEST } from './entities';
import { tally, tallyFunction } from './functions';
import { pollCard, pollComposer, pollsView } from './Poll.schema';
import { createPollsStore } from './store';

export { POLLS_MANIFEST } from './entities';
export { pollOptions, tally, type TallyRow } from './functions';
export { pollCard, pollComposer, pollsView } from './Poll.schema';
export { createPollsStore } from './store';

/**
 * The store instance, for the one caller that cannot be handed it.
 *
 * `createStore` runs once per app, so this is one per running app — the same shape the host's
 * `boardOptimism` singleton has. It exists because a module's `functions` are declared statically,
 * on the definition, while the holds they report against live in the store; the registered `tally`
 * below is the only thing that sees a card's rows and its held vote at the same moment.
 */
let pollsStore: ReturnType<typeof createPollsStore> | null = null;

export const pollsModule: ModuleDefinition = defineModule({
  manifest: {
    id: 'polls',
    name: 'Polls',
    description: 'Ask the space a question and watch the answer arrive.',
    icon: 'chart-bar',
    // No `frameworks` — every piece of UI is a fragment. One kernel: the store reads a vote before it
    // writes one, which is the only reason it is a store at all.
    requires: { kernels: ['records'] },
  },

  contributes: {
    entities: { manifest: POLLS_MANIFEST },

    /**
     * `pollCard` is public API: a template places it over any Poll record bound as `block`, and the
     * block contribution below names it as the card a composed poll is drawn with.
     */
    parts: { pollCard, pollComposer },

    /** A poll composes into a post. No input component — it is inserted through the record form. */
    blocks: [{ entity: 'Poll', card: 'pollCard' }],

    /** A section a space may enable. */
    views: [pollsView],

    /**
     * Counting, for any template that shows a tally — this module's cards and anybody else's.
     *
     * The registered function is a wrapper: it answers with the pure `tally` and, when the card
     * passed a held vote, defers a report of what the rows it drew from actually say. That is the
     * only place the two are visible at once — the store cannot read a template's `$queries` — and
     * it is the same shape the host uses for involvements, where the provider computes the view and
     * then reports from the draw in a microtask.
     *
     * Deferred, never inline: a store write during a render is a re-entrancy bug waiting to happen.
     * `tally` itself stays pure and total, which is what the function contract requires and what its
     * own tests exercise.
     */
    functions: [
      {
        ...tallyFunction,
        fn: ((args: { votes?: unknown; pending?: { poll?: unknown } } | undefined) => {
          const rows = tally(args ?? {});
          const pollId = (args?.pending as { poll?: unknown } | undefined)?.poll;
          if (typeof pollId === 'string' && pollId) {
            queueMicrotask(() => pollsStore?.settleFromRows(pollId, args?.votes));
          }
          return rows;
        }) as (...args: never[]) => unknown,
      },
    ],

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

  createStore: (deps: ModuleStoreDeps) => (pollsStore = createPollsStore(deps)),
});

/** The one factory shape every module package exports — the generated registry imports it. */
export const createModule = (_host: ModuleHost): ModuleDefinition => pollsModule;
