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
import { beforeEach, describe, expect, it } from 'vitest';

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

function harness(peers: Peer[] = []) {
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
  it('records everyone in the call, not only whoever is transcribing', async () => {
    // Coverage is the point: transcription is opt-in and hears only its own microphone, so a partial
    // record is normal. Deriving participants from block authors would show who *contributed* and
    // quietly lose the fact that anyone else was there.
    const h = harness([peer(ME, { type: 'call', id: 'space:uri' }), peer(THEM, { type: 'call', id: 'space:uri' })]);
    await h.say('hello');

    expect(h.linked.map((l) => l.value).sort()).toEqual([ME, THEM].sort());
    expect(h.linked[0]).toMatchObject({ entity: 'CollectionBlock', id: 'id-1', relation: 'participants' });
  });

  it('writes each agent once however much they say', async () => {
    const h = harness([peer(ME, { type: 'call', id: 'space:uri' })]);
    await h.say('one');
    await h.say('two');
    await h.say('three');

    expect(h.linked).toHaveLength(1);
  });

  it('picks up someone who joins after the recording started', async () => {
    const h = harness([peer(ME, { type: 'call', id: 'space:uri' })]);
    await h.say('alone so far');
    expect(h.linked).toHaveLength(1);

    h.setPeers([peer(ME, { type: 'call', id: 'space:uri' }), peer(THEM, { type: 'call', id: 'space:uri' })]);
    await h.say('someone arrived');

    expect(h.linked.map((l) => l.value)).toContain(THEM);
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
