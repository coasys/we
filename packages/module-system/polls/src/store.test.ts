/**
 * One vote per person per poll, as a query rather than a constraint.
 */
import type { ModuleStoreDeps } from '@we/module-shared';
import { fakeDeps, fakeRecords } from '@we/module-testing';
import { newestWritten } from '@we/optimism';
import { describe, expect, it, vi } from 'vitest';

import { tally } from './functions';
import { createPollsStore } from './store';

function deps(records = fakeRecords({ author: 'did:me' }), settings: Record<string, boolean> = {}) {
  const bag = fakeDeps({
    selfId: () => 'did:me',
    selfIds: () => ['did:me'],
    settings: () => settings,
    kernels: { records: records.kernel },
  });
  return { bag, records };
}

/** What was written, as a sentence per write — the order is the assertion. */
const writesOf = (records: ReturnType<typeof fakeRecords>) =>
  records.writes.map((write) => `${write.op} ${write.entity}${write.op === 'create' ? '' : ` ${write.id}`}`);

describe('voting', () => {
  it('creates a vote the first time, and changes it the second with a new one', async () => {
    // New rather than edited: which of my votes counts is the newest, and an edit keeps the old time.
    const { bag, records } = deps();
    const store = createPollsStore(bag);
    await store.vote('poll-1', 'tea');
    await store.vote('poll-1', 'coffee');
    expect(records.rows).toEqual([
      { id: 'Vote-2', author: 'did:me', __entity: 'Vote', pollId: 'poll-1', option: 'coffee' },
    ]);
    expect(writesOf(records)).toEqual(['create Vote', 'create Vote', 'remove Vote Vote-1']);
  });

  it('does nothing when the same choice is pressed again', async () => {
    const { bag, records } = deps();
    const store = createPollsStore(bag);
    await store.vote('poll-1', 'tea');
    await store.vote('poll-1', 'tea');
    expect(writesOf(records)).toEqual(['create Vote']);
  });

  it('keeps votes on different polls apart', async () => {
    const { bag, records } = deps();
    const store = createPollsStore(bag);
    await store.vote('poll-1', 'tea');
    await store.vote('poll-2', 'tea');
    expect(records.rows).toHaveLength(2);
  });

  it('degrades to nothing without the records kernel', async () => {
    const { bag } = deps();
    const store = createPollsStore({ ...bag, kernels: {} });
    await expect(store.vote('poll-1', 'tea')).resolves.toBeUndefined();
  });

  it('reports a failed write rather than throwing', async () => {
    const records = fakeRecords({ author: 'did:me' });
    records.kernel.create = async () => {
      throw new Error('offline');
    };
    const { bag } = deps(records);
    const notified: string[] = [];
    const store = createPollsStore({ ...bag, notify: (_tone, message) => void notified.push(message) });
    await store.vote('poll-1', 'tea');
    expect(store.lastError()).toBe('offline');
    expect(notified).toEqual(['offline']);
    expect(store.voting()).toBe('');
  });
});

describe('the setting', () => {
  it('reveals counts before voting unless the community said otherwise', () => {
    expect(createPollsStore(deps().bag).revealBeforeVoting()).toBe(true);
    expect(createPollsStore(deps(fakeRecords(), { revealBeforeVoting: false }).bag).revealBeforeVoting()).toBe(false);
  });
});

/** A namespace is read through `get`, which is how the evaluator indexes one. */
const heldVote = (store: ReturnType<typeof createPollsStore>, pollId: string) =>
  (store.pendingVote() as { get(key: string): unknown }).get(pollId);

describe('a vote drawn before it is stored', () => {
  it('is held from the press, so the choice and the bars move together', async () => {
    /*
      `voting` was the whole of this before — a spinner saying something is happening, which is what
      a card can show without a hold. It is the wrong answer to "did my press register": the person
      pressed a choice, and what says it registered is that choice being selected and the bars
      moving. A second of unmoved bars under a spinner reads as the press having failed.
    */
    const { bag } = deps();
    const store = createPollsStore(bag);
    await store.vote('poll-1', 'tea');

    expect(heldVote(store, 'poll-1')).toEqual({ poll: 'poll-1', authors: ['did:me'], option: 'tea' });
    // And says nothing about a poll nobody has voted on.
    expect(heldVote(store, 'poll-2')).toBeUndefined();
  });

  it('is withdrawn when the write is refused', async () => {
    const records = fakeRecords({ author: 'did:me' });
    records.kernel.create = async () => {
      throw new Error('nope');
    };
    const { bag } = deps(records);
    const store = createPollsStore(bag);
    await store.vote('poll-1', 'tea');

    expect(heldVote(store, 'poll-1')).toBeUndefined();
    expect(store.lastError()).toBe('nope');
  });

  it('survives rows that have not caught up, and goes when they have', async () => {
    const { bag } = deps();
    const store = createPollsStore(bag);
    await store.vote('poll-1', 'tea');

    // The draw the press itself caused, made from rows that still say nothing — the baseline.
    store.settleFromRows('poll-1', [{ author: 'did:them', option: 'coffee' }]);
    expect(heldVote(store, 'poll-1')).toBeTruthy();

    // The push that answered.
    store.settleFromRows('poll-1', [
      { author: 'did:them', option: 'coffee' },
      { author: 'did:me', option: 'tea' },
    ]);
    expect(heldVote(store, 'poll-1')).toBeUndefined();
  });

  it('is not released by a poll nobody has voted on yet', async () => {
    // An empty list read as data says the held vote is absent, so it would be released and the
    // choice would un-select for the rest of the round trip — the flash this exists to remove.
    const { bag } = deps();
    const store = createPollsStore(bag);
    await store.vote('poll-1', 'tea');

    store.settleFromRows('poll-1', []);
    expect(heldVote(store, 'poll-1')).toBeTruthy();
  });
});

/*
  One person, two computers. Each writes as its own key; `selfIds` names both, this device first, then
  the person — what `sessionStore.me.dids` holds.
*/
const PHONE = 'did:key:phone';
const LAPTOP = 'did:key:laptop';
const PERSON = 'did:scid:me';

type Records = ReturnType<typeof fakeRecords>;

/**
 * One of my computers over the space's one set of rows: writes as `did`, stamped by `clock`. `gate`,
 * when given, holds each write's return until it resolves — two devices pressing at once, both written
 * before either reads back.
 */
function computer(records: Records, did: string, clock: () => number, gate?: Promise<void>) {
  const kernel: NonNullable<ModuleStoreDeps['kernels']['records']> = {
    ...records.kernel,
    create: async (entity, fields, options) => {
      const id = await records.kernel.create(entity, fields, options);
      const row = records.rows.find((r) => r.id === id)!;
      row.author = did;
      row.createdAt = new Date(clock()).toISOString();
      await gate;
      return id;
    },
  };
  const selfIds = [did, did === PHONE ? LAPTOP : PHONE, PERSON];
  return createPollsStore(fakeDeps({ selfId: () => did, selfIds: () => selfIds, kernels: { records: kernel } }));
}

/** The rows of one poll, as a card's `$queries` hands them to `tally`. */
const votesOn = (records: Records, pollId: string) =>
  records.rows.filter((row) => row.__entity === 'Vote' && row.pollId === pollId);

/** What a reader on either of my computers shows as my vote — `tally`'s row marked `mine`. */
const shownAsMine = (records: Records, pollId: string, me: string[]) =>
  tally({ votes: votesOn(records, pollId), options: 'tea,coffee', me }).find((row) => row.mine)?.option;

describe('one vote per person across their computers', () => {
  it('reads the vote my other computer cast as mine', async () => {
    const records = fakeRecords();
    records.seed('Vote', { pollId: 'poll-1', option: 'coffee', createdAt: '2026-11-01T10:00:00.000Z' }, LAPTOP);
    const phone = computer(records, PHONE, () => Date.parse('2026-11-01T11:00:00.000Z'));

    // The card shows it selected and counts it once.
    expect(shownAsMine(records, 'poll-1', [PHONE, LAPTOP, PERSON])).toBe('coffee');

    // Pressing what it already says writes nothing — not a second vote from this device.
    await phone.vote('poll-1', 'coffee');
    expect(votesOn(records, 'poll-1')).toHaveLength(1);
    expect(records.writes).toEqual([]);

    // And the press's hold is settled by the laptop's row, which is mine, rather than waiting on one
    // from this device that is never coming.
    expect(heldVote(phone, 'poll-1')).toEqual({ poll: 'poll-1', authors: [PHONE, LAPTOP, PERSON], option: 'coffee' });
    phone.settleFromRows('poll-1', votesOn(records, 'poll-1'));
    expect(heldVote(phone, 'poll-1')).toBeUndefined();
  });

  it('changing it from this computer leaves one vote, this one', async () => {
    const records = fakeRecords();
    const laptopVote = records.seed(
      'Vote',
      { pollId: 'poll-1', option: 'coffee', createdAt: '2026-11-01T10:00:00.000Z' },
      LAPTOP,
    );
    const phone = computer(records, PHONE, () => Date.parse('2026-11-01T11:00:00.000Z'));

    await phone.vote('poll-1', 'tea');

    expect(votesOn(records, 'poll-1').map((row) => [row.author, row.option])).toEqual([[PHONE, 'tea']]);
    // This device's vote lands first, and only then is the laptop's taken away.
    expect(writesOf(records)).toEqual(['create Vote', `remove Vote ${laptopVote.id}`]);
    expect(tally({ votes: votesOn(records, 'poll-1'), options: 'tea,coffee', me: [PHONE, LAPTOP] })).toEqual([
      { option: 'tea', count: 1, share: 1, leading: true, mine: true },
      { option: 'coffee', count: 0, share: 0, leading: false, mine: false },
    ]);
  });

  it('keeps the new vote when the space refuses to remove the old one, and still counts me once', async () => {
    const records = fakeRecords();
    records.seed('Vote', { pollId: 'poll-1', option: 'coffee', createdAt: '2026-11-01T10:00:00.000Z' }, LAPTOP);
    const remove = records.kernel.remove;
    records.kernel.remove = async (entity, id, target) => {
      if (records.rows.find((row) => row.id === id)?.author === LAPTOP) throw new Error('refused by policy');
      return remove(entity, id, target);
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const phone = computer(records, PHONE, () => Date.parse('2026-11-01T11:00:00.000Z'));

    await phone.vote('poll-1', 'tea');

    expect(phone.lastError()).toBe('');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    expect(votesOn(records, 'poll-1')).toHaveLength(2);
    const rows = tally({ votes: votesOn(records, 'poll-1'), options: 'tea,coffee', me: [PHONE, LAPTOP, PERSON] });
    expect(rows.map((row) => [row.option, row.count, row.mine])).toEqual([
      ['tea', 1, true],
      ['coffee', 0, false],
    ]);
  });

  /**
   * Both of my computers press at once: both votes are written before either reads back. Each removes
   * only what loses to its own — the loser takes its own back — so the winner is removed by nobody.
   */
  async function race(times: { phone: number; laptop: number }, phoneFirst: boolean) {
    const records = fakeRecords();
    let written = 0;
    let bothWritten!: () => void;
    const gate = new Promise<void>((resolve) => (bothWritten = resolve));
    const counting = (clock: () => number) => () => {
      if (++written === 2) queueMicrotask(bothWritten);
      return clock();
    };
    const phone = computer(
      records,
      PHONE,
      counting(() => times.phone),
      gate,
    );
    const laptop = computer(
      records,
      LAPTOP,
      counting(() => times.laptop),
      gate,
    );
    const presses = phoneFirst
      ? [() => phone.vote('poll-1', 'tea'), () => laptop.vote('poll-1', 'coffee')]
      : [() => laptop.vote('poll-1', 'coffee'), () => phone.vote('poll-1', 'tea')];
    let before: Record<string, unknown>[] = [];
    void gate.then(() => (before = votesOn(records, 'poll-1').map((row) => ({ ...row }))));
    await Promise.all(presses.map((press) => press()));
    return { records, before };
  }

  it('two computers voting at once leave exactly one — the later, the one readers already showed', async () => {
    for (const phoneFirst of [true, false]) {
      const { records, before } = await race({ phone: 1_000, laptop: 2_000 }, phoneFirst);
      // Both stood for a moment; every reader picked the laptop's.
      expect(before).toHaveLength(2);
      expect(newestWritten(before)?.option).toBe('coffee');
      expect(
        tally({ votes: before, options: 'tea,coffee', me: [PHONE, LAPTOP, PERSON] }).find((row) => row.mine)?.option,
      ).toBe('coffee');

      const left = votesOn(records, 'poll-1');
      expect(left.map((row) => [row.author, row.option])).toEqual([[LAPTOP, 'coffee']]);
      expect(shownAsMine(records, 'poll-1', [PHONE, LAPTOP, PERSON])).toBe('coffee');
      expect(shownAsMine(records, 'poll-1', [LAPTOP, PHONE, PERSON])).toBe('coffee');
    }
  });

  it('two computers voting at the same moment agree on one, whichever order the rows are in', async () => {
    for (const phoneFirst of [true, false]) {
      const { records, before } = await race({ phone: 1_000, laptop: 1_000 }, phoneFirst);
      expect(before).toHaveLength(2);
      // Equal times go to the larger id: the same pick from the rows listed either way round.
      const forwards = newestWritten(before);
      const backwards = newestWritten([...before].reverse());
      expect(backwards).toEqual(forwards);
      const me = [PHONE, LAPTOP, PERSON];
      expect(tally({ votes: before, options: 'tea,coffee', me })).toEqual(
        tally({ votes: [...before].reverse(), options: 'tea,coffee', me }),
      );

      // And the cleanup kept exactly that one.
      const left = votesOn(records, 'poll-1');
      expect(left.map((row) => row.id)).toEqual([forwards?.id]);
      expect(shownAsMine(records, 'poll-1', me)).toBe(forwards?.option);
    }
  });
});
