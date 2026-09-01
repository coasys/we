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

import { createTranscribeStore, TRANSCRIBE_ACTIVITY } from './store';

/** A call and the record it names — the call module publishes both from the moment it starts. */
const RECORD = 'rec-1';
const CALL = `call:${RECORD}`;

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
    /**
     * Re-run the store's effects and let what they start finish — a reactive host's next tick.
     *
     * The sibling of `setPeers` for state that is not the roster: the host's extraction-target list
     * changes when a community adopts a model, and the effect that follows it starts an async
     * remove-then-add that a test has to be able to wait for. A macrotask rather than a microtask
     * because that sequence is two awaits deep.
     */
    async settle() {
      for (const fn of effects) fn();
      await new Promise((resolve) => setTimeout(resolve, 0));
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
    inCall = [peer(ME, { type: 'call', id: CALL, record: RECORD })];
  });

  it('writes nothing at all until something is said', async () => {
    // The record exists from the moment the call starts — the call module makes it — but this module
    // must not put anything in it for a call nobody spoke in.
    const h = harness(inCall);
    expect(h.created).toHaveLength(0);

    await h.say('');
    expect(h.created).toHaveLength(0);
  });

  it('writes into the record the call names, and creates no collection of its own', async () => {
    // The whole of what replaced electing a creator: the id arrives on the call's activity, so there
    // is nothing to agree about and nothing to race over.
    const h = harness(inCall);
    await h.say('hello');

    expect(h.created.filter((c) => c.entity === 'CollectionBlock')).toHaveLength(0);
    expect(h.created[0].entity).toBe('TextBlock');
    expect(h.created[0].fields.text).toBe('hello');
    // Parented, not loose. A block written flat into the space is how transcripts used to end up in
    // the Cards route's Text list next to authored prose.
    expect(h.created[0].options?.parent).toEqual({ id: RECORD, predicate: 'we://children' });
  });

  it('reuses the same record for the rest of the call', async () => {
    const h = harness(inCall);
    await h.say('one');
    await h.say('two');

    expect(h.created.filter((c) => c.entity === 'TextBlock')).toHaveLength(2);
    expect(h.created.every((c) => c.options?.parent?.id === RECORD)).toBe(true);
  });

  it('holds an utterance while the call names no record yet, rather than dropping it', async () => {
    // A presence round trip, and the only waiting state left. The opening line of a call is worth
    // more than most of what follows, so it is re-buffered rather than discarded.
    const h = harness([peer(ME, { type: 'call', id: CALL })]);
    await h.say('first words');
    expect(h.created).toHaveLength(0);

    h.setPeers([peer(ME, { type: 'call', id: CALL, record: RECORD })]);
    await h.store.flushNow();

    expect(h.created[0].fields.text).toBe('first words');
    expect(h.created[0].options?.parent?.id).toBe(RECORD);
  });

  it('drops an utterance with no call rather than scattering it into the space', async () => {
    const h = harness([peer(ME)]);
    await h.say('talking to myself');

    expect(h.created).toHaveLength(0);
  });

  it('announces which record it is writing into', async () => {
    // No longer how peers find the record — the call says that — but `resume` writes a *different*
    // one than the call names, so a peer has to be able to see that somebody continued an old
    // transcript.
    const h = harness(inCall);
    await h.say('first words');

    const claim = h.published.find((a) => a.type === TRANSCRIBE_ACTIVITY);
    expect(claim).toMatchObject({ id: CALL, collection: RECORD });
  });
});

describe('the roster', () => {
  it('writes only its own entry, however many people are in the call', async () => {
    // `participants` is a bag of links, not a set — nothing at the storage layer can refuse a
    // duplicate, and a read-modify-write would drop whoever lost the race. One writer per member is
    // the only thing that makes it a set, and the writer who can never be raced about an agent's
    // presence is that agent. Appending everyone it could see is what filled a two-person call's
    // avatar row with the same two faces over and over.
    const h = harness([
      peer(ME, { type: 'call', id: CALL, record: RECORD }),
      peer(THEM, { type: 'call', id: CALL, record: RECORD }),
    ]);
    await h.say('hello');

    expect(h.linked.map((l) => l.value)).toEqual([ME]);
    expect(h.linked[0]).toMatchObject({ entity: 'CollectionBlock', id: RECORD, relation: 'participants' });
  });

  it('writes each agent once however much they say', async () => {
    const h = harness([peer(ME, { type: 'call', id: CALL, record: RECORD })]);
    await h.say('one');
    await h.say('two');
    await h.say('three');

    expect(h.linked).toHaveLength(1);
  });

  it('adds itself to a record it has never written to, so a silent participant still appears', async () => {
    // Coverage is the point of the roster, and writing only your own entry would lose it if it were
    // tied to speaking. It is not: the record's id is on the call's own activity, so an agent who
    // never turns transcription on and never says a word still reads it and puts itself on the list.
    const h = harness([
      peer(ME, { type: 'call', id: CALL, record: RECORD }),
      peer(THEM, { type: 'call', id: CALL, record: RECORD }),
    ]);

    expect(h.created).toHaveLength(0);
    expect(h.linked).toEqual([{ entity: 'CollectionBlock', id: RECORD, relation: 'participants', value: ME }]);
  });

  it('does not add itself again when it leaves and rejoins the same call', async () => {
    // The guard is keyed on the record rather than the call, and never cleared when a call ends —
    // keyed on the call, or reset on leave, a rejoin appends a second copy of the same person.
    const inCallWithClaim = [
      peer(ME, { type: 'call', id: CALL, record: RECORD }),
      peer(THEM, { type: 'call', id: CALL, record: RECORD }),
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
    const h = harness([peer(ME, { type: 'call', id: CALL, record: RECORD })]);
    await h.say('hello');

    h.setPeers([peer(ME)]);

    expect(h.cleared).toContain(TRANSCRIBE_ACTIVITY);
  });

  it('writes the next call into its own record, not the last one’s', async () => {
    const h = harness([peer(ME, { type: 'call', id: CALL, record: RECORD })]);
    await h.say('first meeting');

    h.setPeers([peer(ME)]);
    h.setPeers([peer(ME, { type: 'call', id: 'call:rec-2', record: 'rec-2', anchor: { nodeId: 'post-2' } })]);
    await h.say('second meeting');

    const parents = h.created.map((c) => c.options?.parent?.id);
    expect(parents).toEqual([RECORD, 'rec-2']);
  });

  it('keeps one record when recording is switched off and on inside a call', async () => {
    // Stopping the recording is not leaving the call. Tying the record's lifetime to the toggle gave
    // one meeting two transcripts, which defeats the point of grouping them at all.
    const h = harness([peer(ME, { type: 'call', id: CALL, record: RECORD })]);
    await h.say('before');

    h.store.toggle();
    h.store.toggle();
    await h.say('after');

    expect(h.created.map((c) => c.options?.parent?.id)).toEqual([RECORD, RECORD]);
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
    const h = harness([peer(ME, { type: 'call', id: CALL, record: RECORD })]);
    h.store.resume('the-old-record');
    // The pin lands on the effect that watches for a call, the way it would after joining one.
    h.setPeers([peer(ME, { type: 'call', id: CALL, record: RECORD })]);
    await h.say('picking this back up');

    expect(h.created.filter((c) => c.entity === 'CollectionBlock')).toHaveLength(0);
    expect(h.created[0].options?.parent).toEqual({ id: 'the-old-record', predicate: 'we://children' });
  });

  it('announces the record it resumed, so the rest of the call converges on it too', async () => {
    // One agent pressing Continue has to be enough: everybody else adopts an announced record in
    // preference to creating one, which is what pulls the whole call back onto the old transcript.
    const h = harness([peer(ME, { type: 'call', id: CALL, record: RECORD })]);
    h.store.resume('the-old-record');
    h.setPeers([peer(ME, { type: 'call', id: CALL, record: RECORD })]);

    expect(h.published).toContainEqual({
      type: TRANSCRIBE_ACTIVITY,
      id: CALL,
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

    h.setPeers([peer(ME, { type: 'call', id: CALL, record: RECORD })]);
    await h.say('now then');

    expect(h.created.filter((c) => c.entity === 'CollectionBlock')).toHaveLength(0);
    expect(h.created[0].options?.parent?.id).toBe('the-old-record');
  });
});

/**
 * Recording the call you are in.
 *
 * Two things this replaces, both of which produced a transcript nobody could trust. A prompt, which
 * was ignored reliably enough that the ordinary outcome of a group call was a record containing one
 * person — not a smaller record than the real one but a wrong one. And, after that, a rule that
 * joined a transcript somebody else had started but never started one: which left whether a meeting
 * was recorded at all resting on whoever arrived first remembering to press a button.
 *
 * So being in a call is the whole condition, and everything worth testing is the ways it must *not*
 * fire: over a decision somebody made, on a node that cannot transcribe, and against silence.
 */
describe('recording the call you are in', () => {
  /**
   * The two deps auto-join checks that nothing else here does.
   *
   * `dataset` because there is no point recording into a space that is not open — and because the
   * effect that enforces that switches recording off, so without one the two would take turns for
   * the length of the run. The whole harness gets it, since every test in this block is about a call
   * happening somewhere.
   */
  const IN_A_SPACE = { dataset: () => ({}) };

  /** A node that can transcribe, so auto-join is not talked out of it before it starts. */
  const CAN_TRANSCRIBE = {
    available: () => true,
    models: async () => [{ id: 'whisper', name: 'Whisper', ready: true, isDefault: true }],
    // Opened, then unwound: `start` builds an AudioContext next, which Node does not have, so it
    // throws into `start`'s own catch and closes this on the way out. Everything asserted here is
    // decided before that point.
    open: async () => ({ close: async () => {} }),
  };

  /** A node with the port but nothing installed to run — the silent-failure case. */
  const NO_MODEL = { available: () => true, models: async () => [], open: async () => ({ close: async () => {} }) };

  /** Somebody else in this call, recording. */
  const THEIR_TRANSCRIPT = [
    peer(ME, { type: 'call', id: CALL, record: RECORD }),
    peer(THEM, { type: 'call', id: CALL, record: RECORD }, { type: TRANSCRIBE_ACTIVITY, id: CALL, recording: true }),
  ];

  /** Let the microtasks `start` awaits on run out, so a silent give-up has happened by the assert. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('starts recording without being asked, when a peer already is', async () => {
    const h = harness(THEIR_TRANSCRIPT, { ...IN_A_SPACE, transcription: CAN_TRANSCRIBE });

    expect(h.store.enabled()).toBe(true);
    expect(h.store.autoJoined()).toBe(true);
  });

  it('starts recording a call nobody else is recording', () => {
    /*
      The half this used to refuse, on the reasoning that being *first* is a decision about the
      conversation rather than about a microphone. True, and it left the decision to whoever arrived
      first noticing a button — so the common case was a meeting with no record and nothing to say
      why. A space that wants its calls left alone says so in its own settings; it is not this
      effect's job to guess that from the roster.
    */
    const h = harness([peer(ME, { type: 'call', id: CALL, record: RECORD }), peer(THEM, { type: 'call', id: CALL })], {
      ...IN_A_SPACE,
      transcription: CAN_TRANSCRIBE,
    });

    expect(h.store.enabled()).toBe(true);
    expect(h.store.autoJoined()).toBe(true);
  });

  it('records nothing while there is no call to record', () => {
    // The condition, stated the other way round. Being in a space is not being in a conversation,
    // and a microphone that opens on entering a space is the thing nobody asked for.
    const h = harness([peer(ME)], { ...IN_A_SPACE, transcription: CAN_TRANSCRIBE });

    expect(h.store.enabled()).toBe(false);
  });

  it('announces it immediately, rather than waiting for the first word', () => {
    // The same reason the button press announces before a word is said: a peer that hears about a
    // transcription late writes into whatever collection it had already picked.
    const h = harness(THEIR_TRANSCRIPT, { ...IN_A_SPACE, transcription: CAN_TRANSCRIBE });

    expect(h.published).toContainEqual({ type: TRANSCRIBE_ACTIVITY, id: CALL, recording: true });
  });

  it('does not open the panel, which nobody asked for', () => {
    // `toggle` opens it, deliberately — a person who presses record wants to see what it produces.
    // Recording that starts on its own has no such request behind it, and a panel appearing every
    // time a call begins is chrome. This is why auto-join sets the signal rather than calling toggle.
    const h = harness(THEIR_TRANSCRIPT, { ...IN_A_SPACE, transcription: CAN_TRANSCRIBE });

    expect(h.store.enabled()).toBe(true);
    expect(h.store.open()).toBe(false);
  });

  it('stays out once the agent has left, however many peers start afterwards', () => {
    // The failure this guards is the one that would make the feature unusable: leaving sets nothing,
    // the effect sees an agent not recording while a peer is, and switches them straight back on.
    const h = harness(THEIR_TRANSCRIPT, { ...IN_A_SPACE, transcription: CAN_TRANSCRIBE });
    expect(h.store.enabled()).toBe(true);

    h.store.toggle();
    expect(h.store.enabled()).toBe(false);

    // A third person starts. Per-peer dismissal — what the old prompt used — would re-offer here,
    // and auto-join would take the offer.
    h.setPeers([
      ...THEIR_TRANSCRIPT,
      peer(
        'did:key:third',
        { type: 'call', id: CALL, record: RECORD },
        { type: TRANSCRIBE_ACTIVITY, id: CALL, recording: true },
      ),
    ]);

    expect(h.store.enabled()).toBe(false);
    expect(h.store.autoJoined()).toBe(false);
  });

  it('treats a new call as a new decision', () => {
    // Opting out is about the conversation, not about the room. Held any longer it would be a
    // setting nobody chose and nothing on screen could explain.
    const h = harness(THEIR_TRANSCRIPT, { ...IN_A_SPACE, transcription: CAN_TRANSCRIBE });
    h.store.toggle();
    expect(h.store.enabled()).toBe(false);

    h.setPeers([peer(ME)]);
    h.setPeers(THEIR_TRANSCRIPT);

    expect(h.store.enabled()).toBe(true);
  });

  it('does not start where the space, or this agent, has said not to', () => {
    /*
      The fourth guard, and the only one that is a decision rather than an impossibility. It arrives
      already resolved across every level that had an opinion — this effect does not know a space
      exists, let alone which of four levels refused, which is what keeps the policy beside the state
      that holds it rather than in the module.
    */
    const h = harness(THEIR_TRANSCRIPT, {
      ...IN_A_SPACE,
      transcription: CAN_TRANSCRIBE,
      settings: () => ({ recordCalls: false }),
    });

    expect(h.store.enabled()).toBe(false);
  });

  it('records where a host has no settings layer at all', () => {
    // `settings` is optional on the contract, and absent must read as the declared default rather
    // than as a refusal — otherwise adding the layer would have silently switched recording off for
    // every deployment that had not adopted it.
    const h = harness(THEIR_TRANSCRIPT, { ...IN_A_SPACE, transcription: CAN_TRANSCRIBE, settings: undefined });

    expect(h.store.enabled()).toBe(true);
  });

  it('does not start when there is nothing to listen to', () => {
    const h = harness(THEIR_TRANSCRIPT, { ...IN_A_SPACE, transcription: CAN_TRANSCRIBE, audioInput: () => null });

    expect(h.store.enabled()).toBe(false);
  });

  it('gives up quietly on a node with no model, rather than warning about something nobody asked for', async () => {
    const h = harness(THEIR_TRANSCRIPT, { ...IN_A_SPACE, transcription: NO_MODEL });
    await settle();

    expect(h.store.enabled()).toBe(false);
    expect(h.store.autoJoined()).toBe(false);
    // The point of the whole path: `no-model` is an answer to a question, and nobody asked one.
    expect(h.store.status()).toBe('idle');
  });

  it('stops trying after it has given up, rather than fighting `start` for the rest of the call', async () => {
    const h = harness(THEIR_TRANSCRIPT, { ...IN_A_SPACE, transcription: NO_MODEL });
    await settle();

    h.setPeers(THEIR_TRANSCRIPT);
    expect(h.store.enabled()).toBe(false);
  });

  it('still says `no-model` to somebody who pressed record', async () => {
    // The other half of the bargain. Auto-join is allowed to fail silently *because* the explicit
    // path still explains itself — losing that would leave no way to find out a model is missing.
    const h = harness(THEIR_TRANSCRIPT, { ...IN_A_SPACE, transcription: NO_MODEL });
    await settle();

    h.store.toggle();
    // The stand-in host re-runs effects on demand, the way a reactive one would when state moves.
    h.setPeers(THEIR_TRANSCRIPT);
    await settle();

    expect(h.store.status()).toBe('no-model');
  });
});

/**
 * Saying how much of the call is actually in the record.
 *
 * Transcription is per microphone, so a partial transcript is an ordinary outcome and reads exactly
 * like a whole one. These two numbers are what lets the panel say which it is.
 */
describe('coverage', () => {
  it('counts who is transcribing against who is here', () => {
    const h = harness([
      peer(ME, { type: 'call', id: CALL, record: RECORD }),
      peer(THEM, { type: 'call', id: CALL, record: RECORD }, { type: TRANSCRIBE_ACTIVITY, id: CALL, recording: true }),
      peer('did:key:third', { type: 'call', id: CALL, record: RECORD }),
    ]);

    expect(h.store.callAgents()).toHaveLength(3);
    expect(h.store.transcribers()).toEqual([THEM]);
    expect(h.store.partialCoverage()).toBe(true);
  });

  it('counts this agent among the transcribers once it is recording', () => {
    const h = harness([
      peer(ME, { type: 'call', id: CALL, record: RECORD }),
      peer(THEM, { type: 'call', id: CALL, record: RECORD }, { type: TRANSCRIBE_ACTIVITY, id: CALL, recording: true }),
    ]);
    h.store.toggle();

    expect(h.store.transcribers()).toEqual([ME, THEM].sort());
    // Everyone in the call is recording, so there is no gap left to report.
    expect(h.store.partialCoverage()).toBe(false);
  });

  it('has nothing to say outside a call', () => {
    const h = harness([peer(ME)]);

    expect(h.store.callAgents()).toEqual([]);
    expect(h.store.partialCoverage()).toBe(false);
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
    const { store, created } = harness([peer(ME, { type: 'call', id: CALL, record: RECORD })]);

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

/**
 * Turning a transcript into records.
 *
 * The pass itself is an LLM call and is not what breaks. What breaks is everything around it: which
 * collection gets read, whether the last sentence made it in, and whether a slow pass leaves the
 * button looking dead. Each of those fails quietly.
 */
describe('extraction', () => {
  let inCall: Peer[];

  beforeEach(() => {
    inCall = [peer(ME, { type: 'call', id: CALL, record: RECORD })];
  });

  /** The host's half of the contract, recorded so a test can see what was asked of it. */
  function interpreter(
    result: { turns: number; ids: string[]; proposed: string[] } | Error = { turns: 5, ids: ['task-1'], proposed: [] },
    available = true,
    /**
     * What the host says this space may extract into.
     *
     * A parameter because it is no longer a constant the module carries: the host computes it from
     * core vocabulary plus whatever models the community defined, so "a space with a shape of its
     * own" and "a space that has declared nothing" are both states worth testing.
     */
    initialTargets: string[] = ['TaskBlock', 'EventBlock'],
  ) {
    const calls: string[] = [];
    /** Every watch registration and removal, in order — `-id` for a removal. */
    const watches: string[] = [];
    /** Collections a repair sweep was asked for. */
    const reconciled: string[] = [];
    /**
     * What each call extracts, as the host resolves it.
     *
     * A map rather than one list, because the answer is per call now: the space names a default and
     * a call's participants may add to or remove from it. The module never sees any of that — it
     * asks the host what this collection extracts and is handed the answer.
     */
    const targets = new Map<string, string[]>();
    const candidates = new Set(initialTargets);
    const defaults = [...initialTargets];
    const forCall = (collection: string) => targets.get(collection) ?? defaults.filter((e) => candidates.has(e));
    return {
      calls,
      watches,
      reconciled,
      /** What the watch would currently be registered for — the module hands the host a collection. */
      watchTargetsOf: (collection: string) => forCall(collection),
      /** Stand in for a community adopting (or withdrawing) a model while the call is running. */
      setCandidates: (next: string[]) => {
        candidates.clear();
        for (const entity of next) candidates.add(entity);
        defaults.length = 0;
        defaults.push(...next);
      },
      port: {
        available: () => available,
        targets: (collection: string) => {
          const active = forCall(collection);
          return [...candidates].map((entity) => ({ entity, selected: active.includes(entity) }));
        },
        setTarget: async (collection: string, entity: string, on: boolean) => {
          const next = new Set(forCall(collection));
          if (on) next.add(entity);
          else next.delete(entity);
          targets.set(collection, [...next]);
        },
        runOnCollection: async (collectionId: string) => {
          calls.push(collectionId);
          if (result instanceof Error) throw result;
          return result;
        },
        watchCollection: async (collectionId: string) => {
          watches.push(collectionId);
        },
        unwatchCollection: async (collectionId: string) => {
          watches.push(`-${collectionId}`);
        },
        reconcileCollection: async (collectionId: string) => {
          reconciled.push(collectionId);
          return 0;
        },
        proposals: async () => [],
        accept: async () => true,
        reject: async () => true,
      },
    };
  }

  /*
    The standing watch follows the call's collection.

    Wired to `collectionId` rather than to the record button, because the collection appears late —
    it is the call's own record, which arrives when the call does — so there is nothing to name at
    the press. These pin that it starts when there is something to watch and
    stops when the call ends, which is the part most likely to rot: nothing fails visibly if a watch
    outlives its call, it just keeps interpreting a conversation nobody is having.
  */
  describe('the standing watch', () => {
    it('registers nothing until somebody has spoken', () => {
      const i = interpreter();
      harness(inCall, { interpretation: i.port });

      expect(i.watches).toEqual([]);
    });

    it('watches the collection once there is one, and names only the collection', async () => {
      const i = interpreter(undefined, true, ['EventBlock', 'Sighting', 'TaskBlock']);
      const h = harness(inCall, { interpretation: i.port });
      await h.say('we should ship the docs on friday');

      expect(i.watches).toHaveLength(1);
      // The class list never reaches the module: three layers decide it and all three are host
      // state, so the module hands over a collection and the host resolves what to look for.
      expect(i.watchTargetsOf(i.watches[0])).toEqual(['EventBlock', 'Sighting', 'TaskBlock']);
      // Registered against a real collection rather than an empty string — a watch over nothing
      // would sit there interpreting a transcript that does not exist.
      expect(i.watches[0]).toBeTruthy();
      // The same collection the one-shot path would read: `canExtract` gates on there being one,
      // and both go through `collectionId`.
      expect(h.store.canExtract()).toBe(true);
    });

    it('stops the watch when the call ends', async () => {
      const i = interpreter();
      const h = harness(inCall, { interpretation: i.port });
      await h.say('something worth writing down');
      const collection = i.watches[0];

      h.setPeers([]);
      await Promise.resolve();

      // Left running it would keep spending an LLM call on a conversation that is over.
      expect(i.watches).toEqual([collection, `-${collection}`]);
    });

    it('repairs unattached records when it adopts a collection', async () => {
      // A pass can finish with nobody listening — on desktop the executor outlives the app — and
      // those records would otherwise never get their place in the call.
      const i = interpreter();
      const h = harness(inCall, { interpretation: i.port });
      await h.say('worth writing down');

      expect(i.reconciled).toEqual([i.watches[0]]);
    });

    it('still watches the new call when stopping the old one fails', async () => {
      /*
        The two were one `try` block, so a teardown that threw took the next registration with it —
        one failed `unwatch` and nothing was ever watched again for the rest of the session. It
        happened for real: the engine registers the config class as `AutoProcessor` and the ORM
        class is `AutoProcessorConfig`, so the delete threw on a name lookup.
      */
      const i = interpreter();
      i.port.unwatchCollection = async () => {
        throw new Error('No SHACL shape stored for class AutoProcessorConfig');
      };
      const h = harness(inCall, { interpretation: i.port });
      await h.say('first call');
      const first = i.watches[0];
      expect(first).toBeTruthy();

      // End that call and start another, the way clicking "new call" does. A different call, so a
      // different record — the id no longer comes from whatever this module happened to create.
      h.setPeers([]);
      await Promise.resolve();
      h.setPeers([peer(ME, { type: 'call', id: 'call:rec-2', record: 'rec-2' })]);
      await h.say('second call');

      const registrations = i.watches.filter((w) => !w.startsWith('-'));
      expect(registrations).toHaveLength(2);
      expect(registrations[1]).not.toBe(first);
    });

    it('survives a backend that cannot hold one', async () => {
      // Every runtime without the auto-processor throws here, and a call is not worth interrupting
      // over a capability the Extract button already covers.
      const i = interpreter();
      i.port.watchCollection = async () => {
        throw new Error('no auto-processor here');
      };
      const h = harness(inCall, { interpretation: i.port });

      await expect(h.say('hello')).resolves.not.toThrow();
      expect(i.calls.length).toBeGreaterThanOrEqual(0);
    });
  });

  it('offers nothing to extract before anybody has spoken', () => {
    // There is no collection until the first utterance, so there is nothing to read back. Offering
    // the button here would spend an LLM call on an empty transcript.
    const i = interpreter();
    const h = harness(inCall, { interpretation: i.port });

    expect(h.store.canExtract()).toBe(false);
    expect(h.store.extractable()).toBe(true);
  });

  it('offers nothing when the node has no model, however much was said', async () => {
    const i = interpreter(undefined, false);
    const h = harness(inCall, { interpretation: i.port });
    await h.say('hello');

    expect(h.store.canExtract()).toBe(false);
    // Distinguishable from the case above, because the two need different sentences: one is "say
    // something first", the other is "this node cannot do that at all".
    expect(h.store.extractable()).toBe(false);
  });

  it('reads back the collection this call is writing into', async () => {
    const i = interpreter();
    const h = harness(inCall, { interpretation: i.port });
    await h.say('James will ship the docs on Friday');

    await h.store.extract();

    expect(i.calls).toEqual([RECORD]);
  });

  /*
    What a press looks for, and who decides.

    Two rules that pull in opposite directions and are both load-bearing. The press is one agent's,
    so narrowing it is local and affects nobody else — but the standing watch is a registration in
    the shared graph that spends whichever peer runs the pass, so it takes the space's whole
    list and no agent's selection. Collapsing the two would either give one member a veto over what
    the neighbourhood extracts, or have peers overwrite each other's registration in turn.
  */
  describe('choosing what a pass looks for', () => {
    it('offers every candidate the space has, ticked as the host resolved them', async () => {
      const i = interpreter(undefined, true, ['EventBlock', 'Sighting', 'TaskBlock']);
      const h = harness(inCall, { interpretation: i.port });

      // The label is presentation only — every write and every request uses `entity`. `*Block` is
      // WE's own naming and would read as jargon on a row of toggles beside a community's own
      // model, so it is dropped: "Task", "Event", "Sighting".
      await h.say('we should ship the docs on friday');
      expect(h.store.extractionTargets()).toEqual([
        { entity: 'EventBlock', label: 'Event', selected: true },
        { entity: 'Sighting', label: 'Sighting', selected: true },
        { entity: 'TaskBlock', label: 'Task', selected: true },
      ]);
    });

    /*
      A toggle is a *group* decision, and that is the whole reason it goes through the host.

      It changes what the standing watch registers for the neighbourhood as well as what the next
      press asks for — one list, both consumers. A per-agent narrowing would have peers overwriting
      each other's registration in a loop, which is why the module holds no selection of its own.
    */
    it('changes what the call extracts, for the press and the watch alike', async () => {
      const i = interpreter(undefined, true, ['EventBlock', 'Sighting', 'TaskBlock']);
      const h = harness(inCall, { interpretation: i.port });
      await h.say('a heron on the river this morning');
      const collection = h.store.liveCollectionId();

      await h.store.toggleExtractionTarget('TaskBlock');

      expect(
        h.store
          .extractionTargets()
          .filter((t) => t.selected)
          .map((t) => t.entity),
      ).toEqual(['EventBlock', 'Sighting']);
      expect(i.watchTargetsOf(collection)).toEqual(['EventBlock', 'Sighting']);
    });

    it('will not run a pass with nothing selected, and says so through canExtract', async () => {
      const i = interpreter(undefined, true, ['TaskBlock']);
      const h = harness(inCall, { interpretation: i.port });
      await h.say('we should ship the docs on friday');
      expect(h.store.canExtract()).toBe(true);

      await h.store.toggleExtractionTarget('TaskBlock');

      expect(h.store.canExtract()).toBe(false);
    });

    it('has nothing to offer, and no watch to run, in a space that marks no models', async () => {
      const i = interpreter(undefined, true, []);
      const h = harness(inCall, { interpretation: i.port });
      await h.say('we should ship the docs on friday');

      expect(h.store.extractionTargets()).toEqual([]);
      expect(h.store.canExtract()).toBe(false);
      // Registering a watch with an empty class list is refused by the executor, and the reason is
      // one a person can act on — so it is reported rather than attempted.
      expect(i.watches).toEqual([]);
      expect(h.store.watchProblem()).toContain('no models marked for AI extraction');
    });

    /*
      The re-registration rule, and the reason it cannot be an optimisation.

      `addAutoProcessor` writes `interpretationClasses` through the shape's `addLink` setter, so
      registering twice under one processor id UNIONS the two lists. Re-registering to narrow a set
      would widen it instead — permanently, for the neighbourhood. So a change has to remove first,
      and this pins the order.
    */
    it('removes the watch before re-registering it when the call gains a model', async () => {
      const i = interpreter(undefined, true, ['EventBlock', 'TaskBlock']);
      const h = harness(inCall, { interpretation: i.port });
      await h.say('we should ship the docs on friday');
      const collection = h.store.liveCollectionId();

      i.setCandidates(['EventBlock', 'Sighting', 'TaskBlock']);
      await h.settle();

      expect(i.watches).toEqual([collection, `-${collection}`, collection]);
      expect(i.watchTargetsOf(collection)).toEqual(['EventBlock', 'Sighting', 'TaskBlock']);
    });

    it('re-registers when the participants toggle one mid-call', async () => {
      const i = interpreter(undefined, true, ['EventBlock', 'TaskBlock']);
      const h = harness(inCall, { interpretation: i.port });
      await h.say('we should ship the docs on friday');
      const collection = h.store.liveCollectionId();

      await h.store.toggleExtractionTarget('EventBlock');
      await h.settle();

      // Removed first, then registered again — a plain re-register would union the old list back in.
      expect(i.watches).toEqual([collection, `-${collection}`, collection]);
      expect(i.watchTargetsOf(collection)).toEqual(['TaskBlock']);
    });

    it('does not re-register when the list has not actually changed', async () => {
      const i = interpreter(undefined, true, ['EventBlock', 'TaskBlock']);
      const h = harness(inCall, { interpretation: i.port });
      await h.say('we should ship the docs on friday');

      i.setCandidates(['EventBlock', 'TaskBlock']);
      await h.settle();

      expect(i.watches).toHaveLength(1);
    });

    it('names only the collection when it asks for a repair', async () => {
      const i = interpreter(undefined, true, ['EventBlock', 'Sighting', 'TaskBlock']);
      const h = harness(inCall, { interpretation: i.port });
      await h.say('a heron on the river this morning');

      // The host resolves what a repair should look for, as it does for every other pass — this
      // attaches what a *standing* pass minted, and that ran against the call's shared list.
      expect(i.reconciled).toContain(h.store.liveCollectionId());
    });
  });

  it('flushes what is still buffered before reading', async () => {
    // The last thing said before pressing the button is usually the reason for pressing it, and the
    // buffer holds up to three seconds of speech. Extracting without flushing would reliably miss it.
    const i = interpreter();
    const h = harness(inCall, { interpretation: i.port });
    await h.say('first');

    h.store.receiveText('and one more thing');
    await h.store.extract();

    const texts = h.created.filter((c) => c.entity === 'TextBlock').map((c) => c.fields.text);
    expect(texts).toContain('and one more thing');
  });

  it('reports what it found, so a finished pass does not look like a dead button', async () => {
    const i = interpreter({ turns: 5, ids: ['task-1', 'event-2'], proposed: ['event-2'] });
    const h = harness(inCall, { interpretation: i.port });
    await h.say('hello');

    await h.store.extract();

    expect(h.store.extractStatus()).toBe('done');
    expect(h.store.extractCount()).toBe(2);
  });

  it('surfaces a failed pass rather than swallowing it', async () => {
    const i = interpreter(new Error('no LLM configured'));
    const h = harness(inCall, { interpretation: i.port });
    await h.say('hello');

    await h.store.extract();

    expect(h.store.extractStatus()).toBe('error');
    expect(h.store.extractError()).toBe('no LLM configured');
  });

  it('does not start a second pass over the first', async () => {
    // An LLM pass takes seconds. Without this, an impatient second press runs the whole thing again
    // concurrently — two bills, and two sets of writes racing into one collection.
    const i = interpreter();
    const h = harness(inCall, { interpretation: i.port });
    await h.say('hello');

    await Promise.all([h.store.extract(), h.store.extract()]);

    expect(i.calls).toHaveLength(1);
  });

  it('does nothing at all on a backend that cannot interpret', async () => {
    const h = harness(inCall);
    await h.say('hello');

    await h.store.extract();

    expect(h.store.extractStatus()).toBe('idle');
  });
});

/**
 * Resolving what the model proposed.
 *
 * Staging happens only where a human already owns a value, so this path is rare and correspondingly
 * easy to get wrong without noticing — the list is usually empty, which looks identical to a list
 * that never loads.
 */
describe('staged suggestions', () => {
  let inCall: Peer[];

  beforeEach(() => {
    inCall = [peer(ME, { type: 'call', id: CALL, record: RECORD })];
  });

  function interpreterWith(
    staged: Array<{ id: string; kind: string; values: Record<string, unknown> }>,
    proposed: string[] = staged.map((s) => s.id),
  ) {
    const resolved: Array<{ action: 'accept' | 'reject'; id: string }> = [];
    let list = staged;
    return {
      resolved,
      port: {
        available: () => true,
        runOnCollection: async () => ({ turns: 5, ids: proposed, proposed }),
        proposals: async () => list,
        accept: async (id: string) => {
          resolved.push({ action: 'accept', id });
          list = list.filter((s) => s.id !== id);
          return true;
        },
        reject: async (id: string) => {
          resolved.push({ action: 'reject', id });
          list = list.filter((s) => s.id !== id);
          return true;
        },
      },
    };
  }

  it('does not go looking for a review list when nothing was staged', async () => {
    // The ordinary case. A backend with no provenance gate reports nothing proposed and never had a
    // list to fetch, so asking would be a round trip per pass for an empty array.
    let asked = 0;
    const h = harness(inCall, {
      interpretation: {
        available: () => true,
        runOnCollection: async () => ({ turns: 5, ids: ['t1'], proposed: [] }),
        proposals: async () => {
          asked += 1;
          return [];
        },
        accept: async () => true,
        reject: async () => true,
      },
    });
    await h.say('hello');

    await h.store.extract();

    expect(asked).toBe(0);
    expect(h.store.proposals()).toEqual([]);
  });

  it('reads the list when a pass stages something', async () => {
    const i = interpreterWith([{ id: 'task-1', kind: 'update', values: { title: 'Ship the docs' } }]);
    const h = harness(inCall, { interpretation: i.port });
    await h.say('hello');

    await h.store.extract();

    expect(h.store.proposals()).toHaveLength(1);
    expect(h.store.proposals()[0].summary).toBe('title: Ship the docs');
  });

  it('asks about this call rather than about the whole space', async () => {
    /*
      A proposal outlives the pass that made it. One nobody resolved an hour ago is still staged, so
      an unscoped read hands it to the next call's review list looking like something that call just
      found — and accepting it commits a record parented to the *earlier* call, which then never
      appears on the board of the call the reviewer is sitting in.

      Asserted on the argument rather than on the result, because the narrowing happens in the
      backend: what this store owes is naming the conversation it is asking about.
    */
    const scopes: (string | undefined)[] = [];
    const h = harness(inCall, {
      interpretation: {
        available: () => true,
        runOnCollection: async () => ({ turns: 5, ids: ['t1'], proposed: ['t1'] }),
        proposals: async (_target: unknown, collection?: string) => {
          scopes.push(collection);
          return [];
        },
        accept: async () => true,
        reject: async () => true,
      },
    });
    await h.say('hello');

    await h.store.extract();
    // And a finished call extracted from the calls list asks about *that* one — reviewing what it
    // found is the whole point of being able to extract it.
    await h.store.extractCollection('older-call');

    expect(scopes).toEqual([RECORD, 'older-call']);
  });

  it('leads a summary with the field that identifies the record', async () => {
    // A person deciding whether to keep a suggestion reads it rather than inspecting it, and
    // whichever key happened to come first is not a useful thing to lead with.
    const i = interpreterWith([{ id: 'task-1', kind: 'create', values: { priority: 'high', title: 'Ship the docs' } }]);
    const h = harness(inCall, { interpretation: i.port });
    await h.say('hello');

    await h.store.extract();

    expect(h.store.proposals()[0].summary).toBe('title: Ship the docs · priority: high');
  });

  it('drops a resolved suggestion without re-reading the list', async () => {
    // A re-read is a second round trip during which the row someone is looking at can move, and the
    // answer is already known: a resolved overlay is gone.
    const i = interpreterWith([
      { id: 'task-1', kind: 'update', values: { title: 'One' } },
      { id: 'task-2', kind: 'update', values: { title: 'Two' } },
    ]);
    const h = harness(inCall, { interpretation: i.port });
    await h.say('hello');
    await h.store.extract();

    await h.store.acceptProposal('task-1');

    expect(i.resolved).toEqual([{ action: 'accept', id: 'task-1' }]);
    expect(h.store.proposals().map((p) => p.id)).toEqual(['task-2']);
  });

  it('discards on reject, and says so to the backend', async () => {
    const i = interpreterWith([{ id: 'task-1', kind: 'create', values: { title: 'One' } }]);
    const h = harness(inCall, { interpretation: i.port });
    await h.say('hello');
    await h.store.extract();

    await h.store.rejectProposal('task-1');

    expect(i.resolved).toEqual([{ action: 'reject', id: 'task-1' }]);
    expect(h.store.proposals()).toEqual([]);
  });

  it('keeps a successful extraction successful when the review list cannot be read', async () => {
    // The pass already wrote its records. Reporting an error because a follow-up read failed would
    // be a lie about what happened, and would hide a result the user can see in the graph.
    const h = harness(inCall, {
      interpretation: {
        available: () => true,
        runOnCollection: async () => ({ turns: 5, ids: ['t1'], proposed: ['t1'] }),
        proposals: async () => {
          throw new Error('unreachable');
        },
        accept: async () => true,
        reject: async () => true,
      },
    });
    await h.say('hello');

    await h.store.extract();

    expect(h.store.extractStatus()).toBe('done');
    expect(h.store.proposals()).toEqual([]);
  });
});

/**
 * Extracting a call you are not in.
 *
 * The reachable path, and the one the calls list uses. Everything here is about *which* collection a
 * pass runs on — the failure mode is silent, because extracting the wrong call still succeeds.
 */
describe('extracting by id', () => {
  let inCall: Peer[];

  beforeEach(() => {
    inCall = [peer(ME, { type: 'call', id: CALL, record: RECORD })];
  });

  function interpreter() {
    const calls: string[] = [];
    return {
      calls,
      port: {
        available: () => true,
        runOnCollection: async (collectionId: string) => {
          calls.push(collectionId);
          return { turns: 5, ids: ['task-1'], proposed: [] };
        },
        proposals: async () => [],
        accept: async () => true,
        reject: async () => true,
      },
    };
  }

  it('runs on a collection this agent never transcribed into', async () => {
    // No call, no live collection — the case the panel's button cannot reach at all.
    const i = interpreter();
    const h = harness([], { interpretation: i.port });

    await h.store.extractCollection('someone-elses-call');

    expect(i.calls).toEqual(['someone-elses-call']);
  });

  it('does not flush the live buffer into a different call', async () => {
    // Pressing Extract on this morning's call must not push a word said just now into it.
    const i = interpreter();
    const h = harness(inCall, { interpretation: i.port });
    await h.say('hello');

    h.store.receiveText('said during a later call');
    await h.store.extractCollection('an-older-call');

    const texts = h.created.filter((c) => c.entity === 'TextBlock').map((c) => c.fields.text);
    expect(texts).not.toContain('said during a later call');
  });

  it('flushes when the named collection is the live one', async () => {
    const i = interpreter();
    const h = harness(inCall, { interpretation: i.port });
    await h.say('hello');

    h.store.receiveText('and one more thing');
    await h.store.extractCollection(RECORD);

    const texts = h.created.filter((c) => c.entity === 'TextBlock').map((c) => c.fields.text);
    expect(texts).toContain('and one more thing');
  });

  it('names which call a result belongs to, so a list cannot show it on the wrong card', async () => {
    const i = interpreter();
    const h = harness([], { interpretation: i.port });

    await h.store.extractCollection('call-7');

    expect(h.store.extractedId()).toBe('call-7');
    // Cleared when the pass ends — it marks what is in flight, not what was done.
    expect(h.store.extractingId()).toBe('');
  });

  it('refuses a second pass while one is running, whichever call it names', async () => {
    const i = interpreter();
    const h = harness([], { interpretation: i.port });

    await Promise.all([h.store.extractCollection('call-a'), h.store.extractCollection('call-b')]);

    expect(i.calls).toEqual(['call-a']);
  });
});

/**
 * The gap between the preview clearing and the row appearing.
 *
 * `pending` used to be emptied at the top of a flush, and the row it becomes does not exist until a
 * create has gone to the backend and come back through the feed's subscription. Between those two
 * moments the transcript said nothing at all — a sentence vanishing and reappearing somewhere else,
 * which reads as a glitch rather than as saving.
 */
describe('what is shown while an utterance is being written', () => {
  /** A harness whose writes hang until the returned function is called. */
  function slowWrites(peers: Peer[]) {
    let release!: () => void;
    const written = new Promise<void>((resolve) => (release = resolve));
    let nextId = 1;
    const h = harness(peers, {
      createEntity: async () => {
        await written;
        return `id-${nextId++}`;
      },
    });
    return { h, release: () => release() };
  }

  it('keeps the words visible until the write lands, then lets the row have them', async () => {
    const { h, release } = slowWrites([peer(ME, { type: 'call', id: CALL, record: RECORD })]);

    h.store.receiveText('the whole sentence');
    const writing = h.store.flushNow();

    // Out of the buffer, into the write — and still on screen, because it is still not a row.
    expect(h.store.pending()).toBe('the whole sentence');

    release();
    await writing;

    expect(h.store.pending()).toBe('');
  });

  it('shows words said during a write after the ones being written', async () => {
    // Speech does not stop for a round trip. Both are pending from the reader's side — neither is in
    // the record — and they are shown in the order they will be written.
    const { h, release } = slowWrites([peer(ME, { type: 'call', id: CALL, record: RECORD })]);

    h.store.receiveText('first');
    const writing = h.store.flushNow();
    h.store.receiveText('second');

    expect(h.store.pending()).toBe('first second');

    release();
    await writing;

    expect(h.store.pending()).toBe('second');
  });
});

/**
 * Choosing what a call looks for, before it has said anything.
 *
 * `collectionId` is the record this agent is *writing into*, and it is null until somebody speaks —
 * the transcriber adopts the call's record on the first flush. So a call that had just started had
 * no collection: the chips rendered against `''`, every candidate came back unnarrowed and looking
 * selected, and every press hit a guard that returned without a word. Which is exactly when somebody
 * wants to choose — before the conversation, not after it.
 */
describe('what a call extracts, before anybody has spoken', () => {
  const targets = [
    { entity: 'TaskBlock', selected: true },
    { entity: 'EventBlock', selected: false },
  ];

  function withInterpretation(peers: Peer[]) {
    const set: { collection: string; entity: string; on: boolean }[] = [];
    const h = harness(peers, {
      interpretation: {
        available: () => true,
        targets: (collection: string) => (collection ? targets : []),
        setTarget: async (collection: string, entity: string, on: boolean) => {
          set.push({ collection, entity, on });
        },
      },
    });
    return { h, set };
  }

  it('records a choice against the call’s own record, with no transcript yet', async () => {
    const { h, set } = withInterpretation([peer(ME, { type: 'call', id: CALL, record: RECORD })]);

    expect(h.store.canChooseTargets()).toBe(true);
    expect(h.store.extractionTargets()).toHaveLength(2);

    await h.store.toggleExtractionTarget('EventBlock');

    // The call's record, which presence has carried since the call started — not the collection the
    // transcriber has not adopted yet.
    expect(set).toEqual([{ collection: RECORD, entity: 'EventBlock', on: true }]);
  });

  it('still lists the space’s own defaults outside a call, and says it cannot narrow them', () => {
    /*
      The state that looked broken. Outside a call there is no record to hang a per-call decision on,
      so `canChooseTargets` is false — but the list is not empty and never was: `forCall` falls back
      to the space's defaults, which is why the chips showed the right ticks while refusing every
      press. The panel edits that list instead now, and this is the flag it branches on.
    */
    const { h } = withInterpretation([]);

    expect(h.store.canChooseTargets()).toBe(false);
    expect(h.store.extractionTargets()).toEqual([]);
  });

  it('says it cannot on a host that has no way to store one', async () => {
    const h = harness([peer(ME, { type: 'call', id: CALL, record: RECORD })], {
      interpretation: { available: () => true, targets: () => targets },
    });

    expect(h.store.canChooseTargets()).toBe(false);
    // And the action stays safe to call: a surface that offers it anyway does nothing, rather than
    // throwing on a missing method.
    await expect(h.store.toggleExtractionTarget('EventBlock')).resolves.toBeUndefined();
  });
});
