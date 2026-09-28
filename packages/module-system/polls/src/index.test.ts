/**
 * The declaration — what a third party's module looks like when it uses everything at once.
 */
import { validateManifest } from '@we/backend-shared';
import { checkModuleCompatibility, lintModule, moduleCapabilities, storeSurface } from '@we/module-shared';
import { markAction, markState } from '@we/module-shared';
import { describe, expect, it } from 'vitest';

import { pollOptions, tally } from './functions';
import { createModule, pollsModule } from './index';

describe('the polls module', () => {
  it('is backend- and framework-agnostic, and asks for one kernel', () => {
    expect(pollsModule.manifest.requires?.backends).toBeUndefined();
    expect(pollsModule.manifest.requires?.frameworks).toBeUndefined();
    expect(pollsModule.manifest.requires?.kernels).toEqual(['records']);
    expect(checkModuleCompatibility(pollsModule, { backend: 'inmemory', framework: 'react' }).compatible).toBe(true);
    expect(checkModuleCompatibility(pollsModule, { backend: 'ad4m', framework: 'solid', kernels: [] }).compatible).toBe(
      false,
    );
  });

  it('declares a valid manifest with a blockable poll that is a node', () => {
    // `WeNode` lives in the host's vocabulary, so it is named as external — as the registry does.
    const result = validateManifest(pollsModule.contributes!.entities!.manifest, { externalEntities: ['WeNode'] });
    expect(result.valid).toBe(true);
    expect(lintModule(pollsModule).problems).toEqual([]);
    expect(pollsModule.contributes!.entities!.manifest.entities.Poll.extends).toBe('WeNode');
    expect(pollsModule.contributes!.entities!.manifest.entities.Poll.blockable).toBe(true);
  });

  it('names a card it publishes for its block, and a view with the right role', () => {
    const { blocks, parts, views } = pollsModule.contributes!;
    expect(parts?.[blocks![0].card]).toBeDefined();
    expect(views![0].meta.role).toBe('view');
    expect(views![0].id).toBe('polls');
    expect(views![0].meta.requires?.modules).toEqual(['polls']);
  });

  it('is described to a person as storage in the space and nothing else alarming', () => {
    expect(moduleCapabilities(pollsModule)).toEqual(['kernel:records', 'storage:space']);
  });

  it('publishes what its card reads and keeps nothing hidden it does not need to', () => {
    const store = pollsModule.createStore!({
      signal: <T>(initial: T): [() => T, (next: T) => void] => {
        let value = initial;
        return [() => value, (next: T) => void (value = next)];
      },
      state: markState,
      action: markAction,
      kernels: {},
    });
    const surface = storeSurface(store);
    expect(surface.vote?.kind).toBe('action');
    expect(surface.voting?.kind).toBe('state');
    expect(surface.revealBeforeVoting?.kind).toBe('state');
    for (const member of Object.values(surface)) expect(member.doc.length).toBeGreaterThan(10);
  });

  it('exports the one factory shape the generated registry imports', () => {
    expect(createModule({ components: {} })).toBe(pollsModule);
  });
});

describe('tally with a vote still in flight', () => {
  const mine = { poll: 'p1', author: 'did:me', option: 'coffee' };

  it('counts the held vote, so the bars move on the press', () => {
    // Without it the bars sit still for a round trip and the press reads as having failed — the
    // vote is written, and the tally beside it is the only thing that could say so.
    const rows = tally({ votes: [], options: 'tea,coffee', pending: mine });
    expect(rows.find((row) => row.option === 'coffee')?.count).toBe(1);
    expect(rows.find((row) => row.option === 'tea')?.count).toBe(0);
  });

  it('counts it in PLACE of this agent’s stored vote, never as well', () => {
    /*
      The case a naive overlay gets wrong. Changing a vote from tea to coffee leaves the tea row in
      the query result for a round trip; adding the held vote on top makes the total two for one
      person, so every share is wrong and both bars are drawn from a number nobody voted for.
    */
    const rows = tally({
      votes: [
        { author: 'did:me', option: 'tea' },
        { author: 'did:them', option: 'tea' },
      ],
      options: 'tea,coffee',
      pending: mine,
    });
    expect(rows.find((row) => row.option === 'tea')?.count).toBe(1);
    expect(rows.find((row) => row.option === 'coffee')?.count).toBe(1);
    expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(2);
  });

  it('leaves everybody else alone', () => {
    const rows = tally({
      votes: [
        { author: 'did:a', option: 'tea' },
        { author: 'did:b', option: 'tea' },
      ],
      options: 'tea,coffee',
      pending: mine,
    });
    expect(rows.find((row) => row.option === 'tea')?.count).toBe(2);
  });

  it('ignores a pending that is not a vote — pure and total, like the rest', () => {
    const rows = tally({ votes: [{ author: 'did:a', option: 'tea' }], options: 'tea', pending: { poll: 'p1' } });
    expect(rows.find((row) => row.option === 'tea')?.count).toBe(1);
  });
});

describe('tally', () => {
  it('gives every declared choice a row, in order, and counts votes under them', () => {
    const rows = tally({
      votes: [{ option: 'tea' }, { option: 'tea' }, { option: 'milk' }],
      options: 'tea, coffee, milk',
    });
    expect(rows.map((r) => [r.option, r.count])).toEqual([
      ['tea', 2],
      ['coffee', 0],
      ['milk', 1],
    ]);
    expect(rows[0].share).toBeCloseTo(2 / 3);
    expect(rows.map((r) => r.leading)).toEqual([true, false, false]);
  });

  it('keeps a vote for a choice the poll no longer offers', () => {
    const rows = tally({ votes: [{ option: 'gone' }], options: 'tea' });
    expect(rows.map((r) => r.option)).toEqual(['tea', 'gone']);
  });

  it('answers with empty rows and zero shares for nothing', () => {
    expect(tally({})).toEqual([]);
    expect(tally({ options: 'a, b' }).every((r) => r.share === 0 && !r.leading)).toBe(true);
    expect(tally({ votes: 'nope', options: ['a'] })[0].count).toBe(0);
  });

  it('splits options from a string or a list', () => {
    expect(pollOptions(' a , b,,c ')).toEqual(['a', 'b', 'c']);
    expect(pollOptions(['a', ' b '])).toEqual(['a', 'b']);
    expect(pollOptions(3)).toEqual([]);
  });
});
