# Polls

The polls module (`@we/module-polls`) lets a member ask the space a question with a list of choices, and shows the votes as they arrive. A poll can be a block in a post, a card that a template places, or a section of the space.

**Why:** The module is the contract's test: the smallest module that uses every kind of contribution that a third party will probably want. Almost all of it is data. The store has one job, because to cast a vote is to find the vote that the agent cast before, and a schema cannot read and then write from one click (`index.ts` header).

**Parent:** [Space tools](README.md)

<details><summary>How it works</summary>

- **Entities** (`POLLS_MANIFEST`): `Poll` `{ question, options, closed, version }`, where `options` is a comma-separated string, and `Vote` `{ pollId, option }`. A vote names its poll by id, and a query reads the votes back.
- **Block:** `{ entity: 'Poll', card: 'pollCard' }`, so a poll goes into a post through the block composer.
- **View:** `pollsView`, a section that a space can enable.
- **Parts:** `pollCard` (input `block`, the Poll record) and `pollComposer`.
- **Function:** `tally(votes)` gives one `TallyRow` `{ option, count, share, leading }` for each choice, in the poll's order. A choice with no votes has a row, and a vote for a choice that was removed is counted at the end.
- **Setting:** `revealBeforeVoting` (space level, default true).
- **Store:** `vote(pollId, option)` finds this agent's `Vote` by `author` and updates it, or creates one. One vote for each agent is a query, and the backend does not enforce it. The store shows the choice at once with `@we/optimism` (`createOptimism`). `tally` reports the rows back to the store (`settleFromRows`), so the held vote ends when the vote comes back.
- In `we-seed.json`, polls has `enabled: false`: the build contains it, and a space must turn it on.

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/polls/src/index.ts](../../../../packages/module-system/polls/src/index.ts): `pollsModule` and its contributions.
- [packages/module-system/polls/src/entities.ts](../../../../packages/module-system/polls/src/entities.ts): `POLLS_MANIFEST`.
- [packages/module-system/polls/src/functions.ts](../../../../packages/module-system/polls/src/functions.ts): `tally`, `pollOptions`, `TallyRow`.
- [packages/module-system/polls/src/store.ts](../../../../packages/module-system/polls/src/store.ts): `createPollsStore`, `vote`, `settleFromRows`.
- [packages/module-system/polls/src/Poll.schema.ts](../../../../packages/module-system/polls/src/Poll.schema.ts): `pollCard`, `pollComposer`, `pollsView`.
- How a module block reaches the composer: [Blocks](../../blocks/README.md).

</details>
