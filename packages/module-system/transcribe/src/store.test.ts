/**
 * How a transcript finds the record it belongs to.
 *
 * Everything here is the *writing* half of the store, driven through `flushNow` — the listening half
 * needs an `AudioContext` and a Whisper model, and is not what breaks. What breaks is the agreement
 * between several agents about which collection one call's words go into, and every failure in that
 * agreement is silent: nothing errors, the transcript is simply split in two, or attached to the
 * wrong meeting, or scattered loose into the space.
 *
 * The deps are the smallest thing that satisfies the contract — no transport, no presence driver,
 * just the roster the module reads and the two write calls it makes.
 */
import type { Activity, Peer } from '@we/backend-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CALL_KIND, CALL_PREDICATE, createTranscribeStore, TRANSCRIBE_ACTIVITY } from './store';

const ME = 'did:key:me';
const THEM = 'did:key:them';

interface Created {
  entity: string;
  fields: Record<string, unknown>;
  options?: { parent?: { id: string; predicate: string } };
}

interface Linked {
  entity: string;
  id: string;
  relation: string;
  value: string;
}

function peer(agentId: string, ...activities: Activity[]): Peer {
  return { agentId, updatedAt: 0, availability: 'available', activities, liveness: 'online' };
}

function harness(peers: Peer[] = [], extraDeps: Record<string, unknown> = {}) {
  const created: Created[] = [];
  const linked: Linked[] = [];
  const published: Activity[] = [];
  const cleared: string[] = [];
  let nextId = 1;
  const effects: Array<() => void> = [];

  const store = createTranscribeStore({
    signal: <T>(initial: T): [() => T, (next: T) => void] => {
      let value = initial;
      return [() => value, (next: T) => (value = next)];
    },
    // Run once now and keep a handle, so a test can re-run them after changing the roster — which is
    // what a real reactive host does when presence ticks.
    effect: (fn: () => void) => {
      effects.push(fn);
      fn();
    },
    selfId: () => ME,
    /**
     * Something to listen to, so the audio effect does not tear the session down on every tick.
     *
     * Without it that effect reads "no audio" and calls `stop`, which flushes — so any test that
     * changes the roster while words are buffered had a second, concurrent flush racing its own for
     * the buffer, and whichever lost saw nothing to write. The stream is never read here: the store
     * only hands it to an `AudioContext`, which these tests never reach.
     */
    audioInput: () => ({}) as MediaStream,
    presence: {
      peers: () => peers,
      setActivity: (activity) => published.push(activity),
      clearActivity: (type) => cleared.push(type),
    },
    createEntity: async (entity, fields, options) => {
      created.push({ entity, fields, options });
      return `id-${nextId++}`;
    },
    linkEntity: async (entity, id, relation, value) => {
      linked.push({ entity, id, relation, value });
    },
    ...extraDeps,
  }) as ReturnType<typeof createTranscribeStore> & Record<string, (...args: unknown[]) => unknown>;

  return {
    store,
    created,
    linked,
    published,
    cleared,
    setPeers: (next: Peer[]) => {
      peers = next;
      for (const fn of effects) fn();
    },
    /** Put words in the buffer and write them, the way an utterance arriving from the VAD would. */
    async say(text: string) {
      store.receiveText(text);
      await store.flushNow();
    },
  };
}

describe('the call record', () => {
  let inCall: Peer[];

  beforeEach(() => {
    inCall = [peer(ME, { type: 'call', id: 'space:uri' })];
  });

  it('writes nothing at all until something is said', async () => {
    // The record means "a call was recorded", not "a call happened". Creating it on the button press
    // would leave an empty collection behind every time somebody armed recording and nobody spoke —
    // and then need a delete path to clean them up.
    const h = harness(inCall);
    expect(h.created).toHaveLength(0);

    await h.say('');
    expect(h.created).toHaveLength(0);
  });

  it('creates the collection on the first utterance, and puts the words inside it', async () => {
    const h = harness(inCall);
    await h.say('hello');

    expect(h.created[0].entity).toBe('CollectionBlock');
    expect(h.created[0].fields.kind).toBe(CALL_KIND);

    expect(h.created[1].entity).toBe('TextBlock');
    expect(h.created[1].fields.text).toBe('hello');
    // Parented, not loose. A block written flat into the space is how transcripts used to end up in
    // the Cards route's Text list next to authored prose.
    expect(h.created[1].options?.parent).toEqual({ id: 'id-1', predicate: 'we://children' });
  });

  it('reuses the same record for the rest of the call', async () => {
    const h = harness(inCall);
    await h.say('one');
    await h.say('two');

    expect(h.created.filter((c) => c.entity === 'CollectionBlock')).toHaveLength(1);
    expect(h.created.filter((c) => c.entity === 'TextBlock')).toHaveLength(2);
  });

  it('hangs an anchored call off the node it is about, in the same write', async () => {
    // `WeNode.calls` is set by creating the collection *under* the anchor rather than by linking it
    // afterwards — a second step leaves a window where a crash orphans the call from its post.
    const h = harness([peer(ME, { type: 'call', id: 'node:uri:post-7', anchor: { nodeId: 'post-7' } })]);
    await h.say('about this post');

    expect(h.created[0].options?.parent).toEqual({ id: 'post-7', predicate: CALL_PREDICATE });
  });

  it('leaves a space-wide call unparented rather than inventing an anchor', async () => {
    const h = harness(inCall);
    await h.say('hello');

    expect(h.created[0].options).toBeUndefined();
  });

  it('drops an utterance with no call rather than scattering it into the space', async () => {
    const h = harness([peer(ME)]);
    await h.say('talking to myself');

    expect(h.created).toHaveLength(0);
  });
});

describe('agreeing on one record', () => {
  it('adopts a record another agent has already announced for this call', async () => {
    // Two transcripts of one meeting is the failure this exists to prevent, and it is silent: both
    // agents write successfully, and the words are simply in two places.
    const h = harness([
      peer(ME, { type: 'call', id: 'space:uri' }),
      peer(
        THEM,
        { type: 'call', id: 'space:uri' },
        { type: TRANSCRIBE_ACTIVITY, id: 'space:uri', collection: 'theirs' },
      ),
    ]);
    await h.say('joining in');

    expect(h.created.filter((c) => c.entity === 'CollectionBlock')).toHaveLength(0);
    expect(h.created[0].options?.parent?.id).toBe('theirs');
  });

  it('ignores a claim belonging to a different call in the same space', async () => {
    // A space can host several calls at once — `callRosters` groups them by id — so a claim has to be
    // matched on the call it names, not merely on being present.
    const h = harness([
      peer(ME, { type: 'call', id: 'space:uri' }),
      peer(
        THEM,
        { type: 'call', id: 'node:uri:x' },
        { type: TRANSCRIBE_ACTIVITY, id: 'node:uri:x', collection: 'other' },
      ),
    ]);
    await h.say('hello');

    expect(h.created[0].entity).toBe('CollectionBlock');
  });

  it('breaks a tie the same way on every agent', async () => {
    // Two agents may announce before either sees the other. Sorting rather than taking the first
    // means both converge on the same survivor, instead of each adopting whoever they happened to
    // hear from first and staying split.
    const h = harness([
      peer(ME, { type: 'call', id: 'space:uri' }),
      peer(
        'did:key:b',
        { type: 'call', id: 'space:uri' },
        { type: TRANSCRIBE_ACTIVITY, id: 'space:uri', collection: 'zzz' },
      ),
      peer(
        'did:key:c',
        { type: 'call', id: 'space:uri' },
        { type: TRANSCRIBE_ACTIVITY, id: 'space:uri', collection: 'aaa' },
      ),
    ]);
    await h.say('hello');

    expect(h.created[0].options?.parent?.id).toBe('aaa');
  });

  it('announces its own record so the others can join it', async () => {
    const h = harness([peer(ME, { type: 'call', id: 'space:uri' })]);
    await h.say('first words');

    const claim = h.published.find((a) => a.type === TRANSCRIBE_ACTIVITY);
    expect(claim).toMatchObject({ id: 'space:uri', collection: 'id-1' });
  });
});

describe('the roster', () => {
  it('writes only its own entry, however many people are in the call', async () => {
    // `participants` is a bag of links, not a set — nothing at the storage layer can refuse a
    // duplicate, and a read-modify-write would drop whoever lost the race. One writer per member is
    // the only thing that makes it a set, and the writer who can never be raced about an agent's
    // presence is that agent. Appending everyone it could see is what filled a two-person call's
    // avatar row with the same two faces over and over.
    const h = harness([peer(ME, { type: 'call', id: 'space:uri' }), peer(THEM, { type: 'call', id: 'space:uri' })]);
    await h.say('hello');

    expect(h.linked.map((l) => l.value)).toEqual([ME]);
    expect(h.linked[0]).toMatchObject({ entity: 'CollectionBlock', id: 'id-1', relation: 'participants' });
  });

  it('writes each agent once however much they say', async () => {
    const h = harness([peer(ME, { type: 'call', id: 'space:uri' })]);
    await h.say('one');
    await h.say('two');
    await h.say('three');

    expect(h.linked).toHaveLength(1);
  });

  it('adds itself to a record it has never written to, so a silent participant still appears', async () => {
    // Coverage is the point of the roster, and writing only your own entry would lose it if it were
    // tied to speaking. It is not: the record's id is published on presence, so an agent who never
    // turns transcription on and never says a word still reads it and puts itself on the list.
    const h = harness([
      peer(ME, { type: 'call', id: 'space:uri' }),
      peer(
        THEM,
        { type: 'call', id: 'space:uri' },
        { type: TRANSCRIBE_ACTIVITY, id: 'space:uri', collection: 'theirs' },
      ),
    ]);

    expect(h.created).toHaveLength(0);
    expect(h.linked).toEqual([{ entity: 'CollectionBlock', id: 'theirs', relation: 'participants', value: ME }]);
  });

  it('does not add itself again when it leaves and rejoins the same call', async () => {
    // The guard is keyed on the record rather than the call, and never cleared when a call ends —
    // keyed on the call, or reset on leave, a rejoin appends a second copy of the same person.
    const inCallWithClaim = [
      peer(ME, { type: 'call', id: 'space:uri' }),
      peer(
        THEM,
        { type: 'call', id: 'space:uri' },
        { type: TRANSCRIBE_ACTIVITY, id: 'space:uri', collection: 'theirs' },
      ),
    ];
    const h = harness(inCallWithClaim);
    expect(h.linked).toHaveLength(1);

    h.setPeers([peer(ME)]);
    h.setPeers(inCallWithClaim);

    expect(h.linked).toHaveLength(1);
  });
});

describe('when the call ends', () => {
  it('lets the record go, and withdraws the claim on it', async () => {
    // Holding the claim after leaving would invite a peer still in the space to adopt a collection
    // nobody is writing to.
    const h = harness([peer(ME, { type: 'call', id: 'space:uri' })]);
    await h.say('hello');

    h.setPeers([peer(ME)]);

    expect(h.cleared).toContain(TRANSCRIBE_ACTIVITY);
  });

  it('starts a new record for the next call rather than appending to the last', async () => {
    const h = harness([peer(ME, { type: 'call', id: 'space:uri' })]);
    await h.say('first meeting');

    h.setPeers([peer(ME)]);
    h.setPeers([peer(ME, { type: 'call', id: 'node:uri:post-2', anchor: { nodeId: 'post-2' } })]);
    await h.say('second meeting');

    const collections = h.created.filter((c) => c.entity === 'CollectionBlock');
    expect(collections).toHaveLength(2);
    expect(collections[1].options?.parent).toEqual({ id: 'post-2', predicate: CALL_PREDICATE });
  });

  it('keeps one record when recording is switched off and on inside a call', async () => {
    // Stopping the recording is not leaving the call. Tying the record's lifetime to the toggle gave
    // one meeting two transcripts, which defeats the point of grouping them at all.
    const h = harness([peer(ME, { type: 'call', id: 'space:uri' })]);
    await h.say('before');

    h.store.toggle();
    h.store.toggle();
    await h.say('after');

    expect(h.created.filter((c) => c.entity === 'CollectionBlock')).toHaveLength(1);
  });
});

/**
 * The election that decides who creates the record.
 *
 * The failure it replaces was not exotic: two agents start recording, both speak, and each creates a
 * collection because neither had announced one yet. Announcing at the first flush meant the window
 * was the whole span before anybody had finished an utterance — which is exactly how a call begins.
 */
describe('electing a creator', () => {
  /** Sorts before ME, so this peer wins the election against it. */
  const EARLIER = 'did:key:aaa';
  /** Sorts after ME, so ME wins. */
  const LATER = 'did:key:zzz';

  function recording(agentId: string) {
    return peer(
      agentId,
      { type: 'call', id: 'space:uri' },
      { type: TRANSCRIBE_ACTIVITY, id: 'space:uri', recording: true },
    );
  }

  it('publishes that it is recording on the button press, before a word is said', async () => {
    // The signal every other agent's prompt reads, and what makes the election deterministic: by the
    // time anyone speaks, everybody recording already knows who else is.
    const h = harness([peer(ME, { type: 'call', id: 'space:uri' })]);
    h.store.toggle();

    expect(h.published).toContainEqual({ type: TRANSCRIBE_ACTIVITY, id: 'space:uri', recording: true });
    expect(h.created).toHaveLength(0);
  });

  it('waits for the elected creator rather than creating a second record', async () => {
    const h = harness([peer(ME, { type: 'call', id: 'space:uri' }), recording(EARLIER)]);
    h.store.toggle();
    await h.say('first words');

    expect(h.created).toHaveLength(0);
  });

  it('writes the utterance it held once the creator announces, rather than losing it', async () => {
    // The opening line of a call is worth more than most of what follows it, and it is precisely the
    // one this defers. Dropping it would be a silent, permanent hole in every transcript but one.
    const h = harness([peer(ME, { type: 'call', id: 'space:uri' }), recording(EARLIER)]);
    h.store.toggle();
    await h.say('first words');

    h.setPeers([
      peer(ME, { type: 'call', id: 'space:uri' }),
      peer(
        EARLIER,
        { type: 'call', id: 'space:uri' },
        { type: TRANSCRIBE_ACTIVITY, id: 'space:uri', recording: true, collection: 'theirs' },
      ),
    ]);
    await h.store.flushNow();

    expect(h.created.filter((c) => c.entity === 'CollectionBlock')).toHaveLength(0);
    expect(h.created[0].fields.text).toBe('first words');
    expect(h.created[0].options?.parent?.id).toBe('theirs');
  });

  it('creates immediately when it is the one elected', async () => {
    const h = harness([peer(ME, { type: 'call', id: 'space:uri' }), recording(LATER)]);
    h.store.toggle();
    await h.say('my turn');

    expect(h.created[0].entity).toBe('CollectionBlock');
    expect(h.created[1].fields.text).toBe('my turn');
  });

  it('gives up waiting and creates one if the elected creator never speaks', async () => {
    // The election picks whoever sorts first among those recording, and that agent may simply never
    // say anything — they only create on their own first flush. Without a deadline, everyone else
    // buffers into a call that produces nothing at all.
    vi.useFakeTimers();
    try {
      const h = harness([peer(ME, { type: 'call', id: 'space:uri' }), recording(EARLIER)]);
      h.store.toggle();
      await h.say('anyone there');
      expect(h.created).toHaveLength(0);

      // Comfortably past the wait, and through however many retry ticks fall inside it — the point
      // is that the words come out the other side, not which attempt delivered them.
      await vi.advanceTimersByTimeAsync(30_000);

      expect(h.created.filter((c) => c.entity === 'CollectionBlock')).toHaveLength(1);
      expect(h.created.filter((c) => c.entity === 'TextBlock')[0].fields.text).toBe('anyone there');
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Picking a call back up after it ended.
 *
 * Once everyone has left, nobody publishes a claim to the record any more and it becomes
 * unreachable — correct, since the next conversation in a space is a different meeting, but it
 * leaves no way back into one that ended by accident.
 */
describe('continuing a call', () => {
  it('writes into the record it was handed rather than creating one', async () => {
    const h = harness([peer(ME, { type: 'call', id: 'space:uri' })]);
    h.store.resume('the-old-record');
    // The pin lands on the effect that watches for a call, the way it would after joining one.
    h.setPeers([peer(ME, { type: 'call', id: 'space:uri' })]);
    await h.say('picking this back up');

    expect(h.created.filter((c) => c.entity === 'CollectionBlock')).toHaveLength(0);
    expect(h.created[0].options?.parent).toEqual({ id: 'the-old-record', predicate: 'we://children' });
  });

  it('announces the record it resumed, so the rest of the call converges on it too', async () => {
    // One agent pressing Continue has to be enough: everybody else adopts an announced record in
    // preference to creating one, which is what pulls the whole call back onto the old transcript.
    const h = harness([peer(ME, { type: 'call', id: 'space:uri' })]);
    h.store.resume('the-old-record');
    h.setPeers([peer(ME, { type: 'call', id: 'space:uri' })]);

    expect(h.published).toContainEqual({
      type: TRANSCRIBE_ACTIVITY,
      id: 'space:uri',
      recording: false,
      collection: 'the-old-record',
    });
  });

  it('holds the request until there is a call to apply it to', async () => {
    // Joining is fire-and-forget and publishes the call activity several awaits deep, so a pin that
    // insisted on a call being there already would land before one was and be dropped.
    const h = harness([peer(ME)]);
    h.store.resume('the-old-record');
    await h.say('too early');
    expect(h.created).toHaveLength(0);

    h.setPeers([peer(ME, { type: 'call', id: 'space:uri' })]);
    await h.say('now then');

    expect(h.created.filter((c) => c.entity === 'CollectionBlock')).toHaveLength(0);
    expect(h.created[0].options?.parent?.id).toBe('the-old-record');
  });
});

describe('stopping', () => {
  /**
   * `stop()` used to flush *before* tearing the audio graph down, which left `context` non-null
   * across an await. The start guard is `if (!context)`, so audio returning inside that window found
   * a context already on its way out, skipped, and then watched `stop` null it. Recording was dead
   * with the button lit and no dependency left to change, so nothing re-triggered the effect — the
   * only way back was to leave the space.
   */
  it('is idle once it has stopped, not wedged mid-teardown', async () => {
    const { store } = harness();

    store.toggle();
    await store.stopNow();

    // The observable half of the fix: nothing is left holding the "already running" state that made
    // a restart impossible.
    expect(store.status()).toBe('idle');
    expect(store.speaking()).toBe(false);
    expect(store.level()).toBe(0);
  });

  it('still writes what was said before it was stopped', async () => {
    // Needs a call to attach to — "no call" is a legitimate refusal, not the case under test.
    const { store, created } = harness([peer(ME, { type: 'call', id: 'space:uri' })]);

    store.receiveText('the last thing anybody said');
    await store.stopNow();

    // Closing the audio graph first must not cost the buffer — the port is closed, but `buffer`
    // already holds the words, and a closed port cannot race the flush with one more message.
    expect(created.some((c) => JSON.stringify(c.fields).includes('the last thing anybody said'))).toBe(true);
  });

  it('releases its session when the module is disposed', async () => {
    const disposers: Array<() => void> = [];
    const { store } = harness([], { onDispose: (fn: () => void) => disposers.push(fn) });

    store.toggle();
    expect(disposers.length).toBeGreaterThan(0);

    for (const dispose of disposers) dispose();
    await Promise.resolve();

    // Same class as the call module's camera: unregistering must close the AudioContext and the
    // backend stream, not drop the only reference to them.
    expect(store.enabled()).toBe(false);
  });
});

describe('a backend that cannot transcribe', () => {
  /**
   * `'no-backend'` was dead code. The host always supplies a forwarding wrapper for the
   * transcription port — it has to, because a module store is built before the backend binds — so
   * `if (!transcription)` never fired, and a node with no speech-to-text at all fell through to
   * `'no-model'` and told the user to go and install one.
   */
  it('says so, rather than telling the user to install a model', async () => {
    const h = harness([], {
      transcription: { available: () => false, models: async () => [], open: async () => ({}) },
    });

    h.store.toggle();
    // The stand-in host re-runs effects on demand, the way a reactive one would when state moves.
    h.setPeers([]);
    await Promise.resolve();

    expect(h.store.status()).toBe('no-backend');
  });

  it('still asks a backend that does not answer the question', async () => {
    // `available` is optional, so an adapter predating it must read as "yes, ask me" — not as a
    // backend that cannot transcribe.
    const h = harness([], {
      transcription: { models: async () => [], open: async () => ({}) },
    });

    h.store.toggle();
    h.setPeers([]);
    await Promise.resolve();

    expect(h.store.status()).not.toBe('no-backend');
  });
});
