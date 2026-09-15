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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTranscribeStore, TRANSCRIBE_ACTIVITY } from './store';

/** A call and the record it names — the call module publishes both from the moment it starts. */
const RECORD = 'rec-1';
const CALL = `call:${RECORD}`;

const ME = 'did:key:me';
const THEM = 'did:key:them';

interface Created {
  entity: string;
  fields: Record<string, unknown>;
  // `dataset` is here so a test can assert its ABSENCE — a write that names one goes to whichever
  // space the call is running in rather than the one on screen, and the point of several of these
  // tests is that it does not.
  options?: { parent?: { id: string; predicate: string }; dataset?: unknown };
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
  /** What the module asked the host to say out loud — see `notify` on the contract. */
  const notified: { tone: string; message: string }[] = [];
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
    notify: (tone: string, message: string) => notified.push({ tone, message }),
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
    notified,
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

/**
 * What the store says can be extracted from the call this agent is in.
 *
 * The store answers per call now — a panel is about whichever call is on screen, which is the live
 * one most of the time and a past one whenever somebody opened it from a link — so the live answer
 * is the keyed one looked up by `callId`, exactly as a schema writes it.
 */
function liveExtraction(store: { extractionFor: () => unknown; callId: () => string }) {
  return extractionOf(store, store.callId());
}

/**
 * What the store says about one named call, read the way an expression reads it.
 *
 * A `namespace` rather than an object, because the ids are not enumerable from the store — see
 * `extractionFor`. `.get` is the same door `readProperty` goes through, so a test indexing a plain
 * object would pass against a shape the evaluator cannot reach. That is not hypothetical: this was
 * a `Proxy` first, every assertion here passed, and the panel showed nothing at all.
 */
function extractionOf(store: { extractionFor: () => unknown }, collection: string): ExtractionView {
  const byId = store.extractionFor() as { get: (key: string) => ExtractionView };
  return byId.get(collection);
}

interface ExtractionView {
  targets: TargetView[];
  canChoose: boolean;
  canExtract: boolean;
}

interface TargetView {
  entity: string;
  label: string;
  selected: boolean;
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
    // No longer how peers find the record — the call says that — but a continued call's record is
    // adopted before anybody speaks, so a peer has to be able to see that somebody is writing into
    // an old transcript.
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
  /*
    The call module says the record was picked back up — `continued` on the activity it already
    publishes the record in — and that is the whole of what this needs. It used to be told by a
    `resume` action the transcript panel's Continue button chained after `continueCall`, which the
    rail's path into the same call could not do, so Extract sat disabled on one path and not the
    other until somebody spoke.
  */
  const continued = peer(ME, { type: 'call', id: 'call:the-old-record', record: 'the-old-record', continued: true });
  /** Enough of the host's half for `canExtract` to be answerable: a model, and something to look for. */
  const interpretation = { available: () => true, targets: () => [{ entity: 'TaskBlock', selected: true }] };

  it('adopts the record before anybody has spoken', () => {
    const h = harness([continued], { interpretation });

    expect(h.store.collectionId()).toBe('the-old-record');
    // The point of adopting early: the record already holds a transcript, so a pass over it is
    // worth offering from the first second rather than after this agent's first utterance.
    expect(liveExtraction(h.store).canExtract).toBe(true);
  });

  it('writes into the record it picked up rather than creating one', async () => {
    const h = harness([continued]);
    await h.say('picking this back up');

    expect(h.created.filter((c) => c.entity === 'CollectionBlock')).toHaveLength(0);
    expect(h.created[0].options?.parent).toEqual({ id: 'the-old-record', predicate: 'we://children' });
  });

  it('announces the record it adopted, so the rest of the call converges on it too', () => {
    // One agent picking the call up has to be enough: everybody else adopts an announced record in
    // preference to creating one, which is what pulls the whole call back onto the old transcript.
    const h = harness([continued]);

    expect(h.published).toContainEqual({
      type: TRANSCRIBE_ACTIVITY,
      id: 'call:the-old-record',
      recording: false,
      collection: 'the-old-record',
    });
  });

  it('leaves a started call alone until somebody speaks', () => {
    // The other case, and the reason adoption is not simply "the call has a record": a record the
    // call just made is empty, and a pass over it spends a model call to find nothing.
    const h = harness([peer(ME, { type: 'call', id: CALL, record: RECORD })], { interpretation });

    expect(h.store.collectionId()).toBeNull();
    expect(liveExtraction(h.store).canExtract).toBe(false);
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

/**
 * Leaving a call ends this agent's recording, and nothing used to say so.
 *
 * The only effect that cleared `enabled` wanted *no dataset and no call*, which is the boot frame
 * and a logged-out agent. Inside a space the dataset is always there, so leaving a call left the
 * flag set for the rest of the session — and three surfaces read it and were each right to.
 */
describe('leaving a call', () => {
  const inThatCall = [peer(ME, { type: 'call', id: CALL, record: RECORD })];

  it('switches recording off, so nothing goes on claiming to record', async () => {
    const h = harness(inThatCall);
    h.store.toggle();
    expect(h.store.enabled()).toBe(true);

    h.setPeers([]);
    await Promise.resolve();

    // The level meter is drawn on this, and the panel's record button offers to *stop* on it — so
    // stale, it put a live meter and a stop button over a call that had ended.
    expect(h.store.enabled()).toBe(false);
  });

  it('rests at idle rather than parking on "nothing to listen to"', async () => {
    /*
      The audio effect reports `enabled && no audio` as `no-audio`, which is honest while a call is
      running and a microphone has gone away, and wrong once the call is over. Parked there it was
      invisible behind a past call — the status notes are hidden on one — and flashed into view the
      moment somebody continued that call, until the microphone arrived.
    */
    const h = harness(inThatCall);
    h.store.toggle();

    h.setPeers([]);
    await Promise.resolve();

    expect(h.store.status()).toBe('idle');
  });

  it('leaves a call still running alone', async () => {
    // The reset is about *this* transition, not about every re-run of the effect that carries it.
    const h = harness(inThatCall);
    h.store.toggle();

    await h.settle();

    expect(h.store.enabled()).toBe(true);
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
        // What the module actually calls: the host reconciles behind it, so the same list records it.
        passSettled: async (collectionId: string) => {
          reconciled.push(collectionId);
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
      expect(liveExtraction(h.store).canExtract).toBe(true);
    });

    it('registers the watch when automatic extraction is switched back on', async () => {
      /*
        The reported bug: "Automatic extraction is off for this call. Press Extract instead." stayed
        on screen whatever the switch said, once it had been toggled. The effect re-ran on the
        setting, but `syncWatch` remembered the call as watched on the branch that registers
        nothing, and its short-circuit sent every later run straight back out.
      */
      const i = interpreter();
      const auto: Record<string, boolean> = {};
      const autoEnabled = (collection?: string) => (collection ? (auto[collection] ?? true) : true);
      const h = harness(inCall, { interpretation: { ...i.port, autoEnabled } });
      auto[RECORD] = false;
      await h.say('nothing to watch for yet');

      expect(i.watches).toEqual([]);

      auto[RECORD] = true;
      await h.settle();

      expect(i.watches).toEqual([RECORD]);

      // And the other direction: off again has to stop it, not leave it spending a pass per batch.
      auto[RECORD] = false;
      await h.settle();

      expect(i.watches).toEqual([RECORD, `-${RECORD}`]);
      /*
        And says nothing about it either way. This reported "Automatic extraction is off for this
        call." under the controls, which is a sentence restating the switch directly above it,
        permanently, for everybody who had deliberately turned it off. `watchProblem` is for what
        somebody can neither see nor fix from here.
      */
      expect(h.store.watchProblem()).toBe('');
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

    it('tells the host a pass may have settled when it adopts a collection', async () => {
      // A pass can finish with nobody listening — on desktop the executor outlives the app — and
      // those records would otherwise never get their place in the call. The module names the
      // collection; what follows (the repair, a board) is the host's.
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

    expect(liveExtraction(h.store).canExtract).toBe(false);
    expect(h.store.extractable()).toBe(true);
  });

  it('offers nothing when the node has no model, however much was said', async () => {
    const i = interpreter(undefined, false);
    const h = harness(inCall, { interpretation: i.port });
    await h.say('hello');

    expect(liveExtraction(h.store).canExtract).toBe(false);
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
      expect(liveExtraction(h.store).targets).toEqual([
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
        liveExtraction(h.store)
          .targets.filter((t) => t.selected)
          .map((t) => t.entity),
      ).toEqual(['EventBlock', 'Sighting']);
      expect(i.watchTargetsOf(collection)).toEqual(['EventBlock', 'Sighting']);
    });

    it('will not run a pass with nothing selected, and says so through canExtract', async () => {
      const i = interpreter(undefined, true, ['TaskBlock']);
      const h = harness(inCall, { interpretation: i.port });
      await h.say('we should ship the docs on friday');
      expect(liveExtraction(h.store).canExtract).toBe(true);

      await h.store.toggleExtractionTarget('TaskBlock');

      expect(liveExtraction(h.store).canExtract).toBe(false);
    });

    it('has nothing to offer, and no watch to run, in a space that marks no models', async () => {
      const i = interpreter(undefined, true, []);
      const h = harness(inCall, { interpretation: i.port });
      await h.say('we should ship the docs on friday');

      expect(liveExtraction(h.store).targets).toEqual([]);
      expect(liveExtraction(h.store).canExtract).toBe(false);
      // Registering a watch with an empty class list is refused by the executor, and the reason is
      // one a person can act on — so it is said rather than attempted. Said *once*, out loud: it
      // used to be a permanent sentence under the controls describing what the chips already show.
      expect(i.watches).toEqual([]);
      expect(h.store.watchProblem()).toBe('');
      expect(h.notified).toEqual([{ tone: 'warning', message: 'No models selected for extraction' }]);
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
    staged: Array<{ id: string; kind: string; entity?: string; values: Record<string, unknown> }>,
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

  it('carries the model a suggestion is of, so a card can name and draw it', async () => {
    const i = interpreterWith([{ id: 'task-1', kind: 'create', entity: 'TaskBlock', values: { title: 'One' } }]);
    const h = harness(inCall, { interpretation: i.port });
    await h.say('hello');

    await h.store.extract();

    expect(h.store.proposals()[0].entity).toBe('TaskBlock');
  });

  it("says '' rather than nothing when the backend could not classify the base", async () => {
    /*
      An executor predating `subjectClassesOf` answers every proposal this way, and the card still
      has to draw: it falls back to the flat summary. Empty rather than absent so a schema can test
      it without reading a sometimes-missing property.
    */
    const i = interpreterWith([{ id: 'task-1', kind: 'create', values: { title: 'One' } }]);
    const h = harness(inCall, { interpretation: i.port });
    await h.say('hello');

    await h.store.extract();

    expect(h.store.proposals()[0].entity).toBe('');
    expect(h.store.proposals()[0].summary).toBe('title: One');
  });

  it('offers the values as rows, identifying field first', async () => {
    // A schema `$each` cannot iterate an object's entries, so the map is unrenderable however
    // well-shaped it is. The order is the same one `summary` prints in.
    const i = interpreterWith([
      { id: 'task-1', kind: 'create', entity: 'TaskBlock', values: { status: 'todo', title: 'One' } },
    ]);
    const h = harness(inCall, { interpretation: i.port });
    await h.say('hello');

    await h.store.extract();

    expect(h.store.proposals()[0].fields).toEqual([
      { name: 'title', label: 'Title', value: 'One' },
      { name: 'status', label: 'Status', value: 'todo' },
    ]);
  });

  it('writes an edit after the accept, never before', async () => {
    /*
      Accepting makes the model's staged value the real one and deletes the overlay, so a write made
      first is a write the accept then silently overwrites. Ordering it this way also lands after the
      overlay is gone, which is what stops a later pass overwriting what was typed.
    */
    const order: string[] = [];
    const i = interpreterWith([
      { id: 'task-1', kind: 'create', entity: 'TaskBlock', values: { title: 'Shp the docs' } },
    ]);
    const accept = i.port.accept;
    i.port.accept = async (id: string) => {
      order.push('accept');
      return accept(id);
    };
    const updates: Array<{ entity: string; id: string; fields: Record<string, unknown> }> = [];
    const h = harness(inCall, {
      interpretation: i.port,
      updateEntity: async (entity: string, id: string, fields: Record<string, unknown>) => {
        order.push('update');
        updates.push({ entity, id, fields });
      },
    });
    await h.say('hello');
    await h.store.extract();

    h.store.editProposal('task-1');
    h.store.setProposalField('title', 'Ship the docs');
    await h.store.acceptProposal('task-1');

    expect(order).toEqual(['accept', 'update']);
    expect(updates).toEqual([{ entity: 'TaskBlock', id: 'task-1', fields: { title: 'Ship the docs' } }]);
  });

  it('writes nothing when the card was opened and not changed', async () => {
    // The draft is seeded from the proposal, so sending it wholesale would rewrite every field with
    // the value it already had — invisible on screen, and a link the whole neighbourhood syncs.
    let wrote = 0;
    const i = interpreterWith([
      { id: 'task-1', kind: 'create', entity: 'TaskBlock', values: { title: 'One', status: 'todo' } },
    ]);
    const h = harness(inCall, { interpretation: i.port, updateEntity: async () => void wrote++ });
    await h.say('hello');
    await h.store.extract();

    h.store.editProposal('task-1');
    await h.store.acceptProposal('task-1');

    expect(wrote).toBe(0);
  });

  it('keeps the suggestion accepted when the edit cannot be written', async () => {
    // The decision was recorded and only the wording did not land. Rolling the accept back would
    // re-raise a question the reviewer already answered.
    const i = interpreterWith([{ id: 'task-1', kind: 'create', entity: 'TaskBlock', values: { title: 'One' } }]);
    const h = harness(inCall, {
      interpretation: i.port,
      updateEntity: async () => {
        throw new Error('offline');
      },
    });
    await h.say('hello');
    await h.store.extract();

    h.store.editProposal('task-1');
    h.store.setProposalField('title', 'Two');
    await h.store.acceptProposal('task-1');

    expect(i.resolved).toEqual([{ action: 'accept', id: 'task-1' }]);
    expect(h.store.proposals()).toEqual([]);
  });

  it('forgets the draft when the suggestion it belonged to is rejected', async () => {
    // Otherwise a card's worth of edits stays attached to an id that no longer resolves.
    const i = interpreterWith([{ id: 'task-1', kind: 'create', entity: 'TaskBlock', values: { title: 'One' } }]);
    const h = harness(inCall, { interpretation: i.port, updateEntity: async () => {} });
    await h.say('hello');
    await h.store.extract();

    h.store.editProposal('task-1');
    h.store.setProposalField('title', 'Two');
    await h.store.rejectProposal('task-1');

    expect(h.store.editingProposal()).toBe('');
    expect(h.store.proposalDraft()).toEqual({});
  });

  /**
   * Reopening a call in a session that has not extracted anything.
   *
   * The reported bug, and it read as data loss: after a restart the records were on the board and
   * the review list was empty, so every suggestion looked as though somebody had already accepted
   * it. Nothing had — the list was only ever filled by a pass settling in the activity feed or by
   * the transcriber adopting a record to write into, and neither of those happens on a fresh boot.
   * The feed is a live subscription that starts empty, and a collection is adopted only when this
   * agent is about to write into it.
   */
  it('fetches what is staged on a call the first time anybody asks about it', async () => {
    const i = interpreterWith([{ id: 'task-1', kind: 'create', entity: 'TaskBlock', values: { title: 'One' } }]);
    const h = harness(inCall, { interpretation: i.port });

    // No extract(), no words said — exactly the state a restart leaves the store in.
    const byId = h.store.proposalsFor() as { get: (key: string) => unknown[] };
    expect(byId.get('call-1')).toEqual([]);
    await Promise.resolve();
    await Promise.resolve();

    expect(byId.get('call-1').map((p) => (p as { id: string }).id)).toEqual(['task-1']);
  });

  it('asks the backend once per call however often the list is read', async () => {
    // The read is what triggers the fetch, and a panel re-reads it every frame. Without the guard
    // that is a round trip per frame, for an answer that cannot have changed.
    let asked = 0;
    const i = interpreterWith([{ id: 'task-1', kind: 'create', entity: 'TaskBlock', values: { title: 'One' } }]);
    const port = { ...i.port, proposals: async () => (asked++, [{ id: 'task-1', kind: 'create', values: {} }]) };
    const h = harness(inCall, { interpretation: port });

    const byId = h.store.proposalsFor() as { get: (key: string) => unknown[] };
    byId.get('call-1');
    byId.get('call-1');
    await Promise.resolve();
    byId.get('call-1');

    expect(asked).toBe(1);
  });

  it('keeps each call’s suggestions apart', async () => {
    // A panel opened on a past call used to list whatever the live one had staged, because there
    // was one flat list and it belonged to whichever conversation last filled it.
    const port = {
      available: () => true,
      runOnCollection: async () => ({ turns: 0, ids: [], proposed: [] }),
      proposals: async (_target: unknown, collection?: string) =>
        collection === 'call-1'
          ? [{ id: 'task-1', kind: 'create', values: {} }]
          : [{ id: 'task-2', kind: 'create', values: {} }],
      accept: async () => true,
      reject: async () => true,
    };
    const h = harness(inCall, { interpretation: port });

    const byId = h.store.proposalsFor() as { get: (key: string) => unknown[] };
    byId.get('call-1');
    byId.get('call-2');
    await Promise.resolve();
    await Promise.resolve();

    expect(byId.get('call-1').map((p) => (p as { id: string }).id)).toEqual(['task-1']);
    expect(byId.get('call-2').map((p) => (p as { id: string }).id)).toEqual(['task-2']);
  });

  it('asks about no call at all rather than about every call at once', async () => {
    /*
      An empty key used to mean "everything staged in the dataset". The port offers that and it is
      the honest answer for a surface genuinely about a dataset — but the extraction panel is about a
      conversation, so outside a call it listed every suggestion the space had ever accumulated, in
      one list, with no way to tell which came from where or to act on one from where the reader was.
    */
    let asked = 0;
    const port = {
      available: () => true,
      runOnCollection: async () => ({ turns: 0, ids: [], proposed: [] }),
      proposals: async () => (asked++, [{ id: 'task-1', kind: 'create', values: {} }]),
      accept: async () => true,
      reject: async () => true,
    };
    const h = harness([], { interpretation: port });

    const byId = h.store.proposalsFor() as { get: (key: string) => unknown[] };
    expect(byId.get('')).toEqual([]);
    await Promise.resolve();
    await Promise.resolve();

    expect(asked).toBe(0);
    expect(byId.get('')).toEqual([]);
  });

  it('keeps a card marked while its call is being switched away from', async () => {
    /*
      The marker asks whether anybody has agreed to a record, which is true or false wherever it is
      drawn. Keyed per call it flashed: the outgoing call's cards stay on the board for the moment
      its replacement is queried, and against the incoming call's list — empty, nothing having
      fetched it — every one of them rendered as settled.
    */
    const port = {
      available: () => true,
      runOnCollection: async () => ({ turns: 0, ids: [], proposed: [] }),
      proposals: async (_target: unknown, collection?: string) =>
        collection === 'call-1' ? [{ id: 'task-1', kind: 'create', values: {} }] : [],
      accept: async () => true,
      reject: async () => true,
    };
    const h = harness(inCall, { interpretation: port });

    const byId = h.store.proposalsFor() as { get: (key: string) => unknown[] };
    byId.get('call-1');
    await Promise.resolve();
    await Promise.resolve();
    // Switching: the new call is asked about and has nothing, while call-1's card is still drawn.
    byId.get('call-2');
    await Promise.resolve();
    await Promise.resolve();

    expect(byId.get('call-2')).toEqual([]);
    expect(h.store.pendingIds()).toEqual(['task-1']);
  });

  it('stops marking a card once its suggestion is resolved', async () => {
    // The union only ever loses an entry to a real decision, so nothing can un-mark a card that is
    // still waiting — which is the property that makes it safe to answer from across calls.
    const i = interpreterWith([{ id: 'task-1', kind: 'create', entity: 'TaskBlock', values: { title: 'One' } }]);
    const h = harness(inCall, { interpretation: i.port });
    await h.say('hello');
    await h.store.extract();
    expect(h.store.pendingIds()).toEqual(['task-1']);

    await h.store.rejectProposal('task-1');

    expect(h.store.pendingIds()).toEqual([]);
  });

  it('tells a record nobody has kept apart from an agreed one with a change suggested', async () => {
    // One list of ids made an accepted task a pass merely had an opinion about look like a draft,
    // and a "hide suggestions" built on it would have hidden agreed work.
    const i = interpreterWith([
      { id: 'task-new', kind: 'create', entity: 'TaskBlock', values: { title: 'New' } },
      { id: 'task-old', kind: 'update', entity: 'TaskBlock', values: { dueDate: '2026-09-15' } },
    ]);
    const h = harness(inCall, { interpretation: i.port });
    await h.say('hello');
    await h.store.extract();

    expect(h.store.unconfirmedIds()).toEqual(['task-new']);
    expect(h.store.changedIds()).toEqual(['task-old']);
    expect(h.store.pendingIds()).toEqual(['task-new', 'task-old']);
    expect(h.store.proposals()[1].fields[0]).toEqual({ name: 'dueDate', label: 'Due date', value: '2026-09-15' });
  });

  it('applies or dismisses one suggested change at a time, keeping the rest staged', async () => {
    const calls: Array<[string, string, string | undefined]> = [];
    const i = interpreterWith([
      { id: 'task-old', kind: 'update', entity: 'TaskBlock', values: { dueDate: '2026-09-15', assignee: 'Ana' } },
    ]);
    const port = {
      ...i.port,
      accept: async (id: string, property?: string) => (calls.push(['accept', id, property]), true),
      reject: async (id: string, property?: string) => (calls.push(['reject', id, property]), true),
    };
    const h = harness(inCall, { interpretation: port });
    await h.say('hello');
    await h.store.extract();

    await h.store.applyChange('task-old', 'dueDate');
    expect(h.store.proposals()[0].fields.map((f) => f.name)).toEqual(['assignee']);
    expect(h.store.changedIds()).toEqual(['task-old']);

    await h.store.dismissChange('task-old', 'assignee');
    expect(calls).toEqual([
      ['accept', 'task-old', 'dueDate'],
      ['reject', 'task-old', 'assignee'],
    ]);
    expect(h.store.changedIds()).toEqual([]);
  });

  it('stops marking a card a peer resolved, when the host says the suggestions moved', async () => {
    /*
      Settling a suggestion is not a pass, and a pass settling was the only thing that re-read the
      list — so a card another member accepted stayed pending on this screen until the next
      extraction. The host now reports that the staged set moved, and every call on screen is re-read.
    */
    let staged = [{ id: 'task-1', kind: 'create', values: {} }];
    let revision = 0;
    const port = {
      available: () => true,
      runOnCollection: async () => ({ turns: 0, ids: [], proposed: [] }),
      proposals: async () => staged,
      proposalsRevision: () => revision,
      accept: async () => true,
      reject: async () => true,
    };
    const h = harness(inCall, { interpretation: port });

    const byId = h.store.proposalsFor() as { get: (key: string) => unknown[] };
    byId.get('call-1');
    await h.settle();
    expect(h.store.pendingIds()).toEqual(['task-1']);

    // Somebody else accepts it: the graph changes, and the host's count moves.
    staged = [];
    revision = 1;
    await h.settle();

    expect(h.store.pendingIds()).toEqual([]);
  });

  it('offers the waiting suggestions as rows too, for a card that has to read one', async () => {
    /*
      A marker asks "is this waiting?" and takes ids; a card that shows what was proposed has to
      find the proposal and read it. The task board needs the second and was reading the flat live
      call's list for it — which is empty after a restart and wrong on a past call.
    */
    const i = interpreterWith([{ id: 'task-1', kind: 'create', entity: 'TaskBlock', values: { title: 'One' } }]);
    const h = harness(inCall, { interpretation: i.port });
    await h.say('hello');
    await h.store.extract();

    expect(h.store.pendingProposals().map((p) => p.id)).toEqual(['task-1']);
    expect(h.store.pendingProposals()[0].summary).toBe('title: One');
  });

  it('refuses to offer editing where nothing could write the result back', async () => {
    // A host lending no record-update surface. An edit control here would take the typing and
    // discard it on Keep, which is worse than not offering one.
    const i = interpreterWith([{ id: 'task-1', kind: 'create', entity: 'TaskBlock', values: { title: 'One' } }]);
    const h = harness(inCall, { interpretation: i.port });

    expect(h.store.canEditProposals()).toBe(false);
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

    expect(liveExtraction(h.store).canChoose).toBe(true);
    expect(liveExtraction(h.store).targets).toHaveLength(2);

    await h.store.toggleExtractionTarget('EventBlock');

    // The call's record, which presence has carried since the call started — not the collection the
    // transcriber has not adopted yet.
    expect(set).toEqual([{ collection: RECORD, entity: 'EventBlock', on: true }]);
  });

  it('answers about the call it is asked about, not the one this agent is in', async () => {
    /*
      The gap that made the workshop's own extraction panel wrong in two directions at once.

      It asked these three about the *live* call while drawing the results of the one in the address,
      so the chips said what one call was looking for above a list of what a different call had
      found — and its Extract button was hidden by a `canExtract` about the wrong record, even though
      the action behind it takes an id and would have worked.
    */
    const { h, set } = withInterpretation([peer(ME, { type: 'call', id: CALL, record: RECORD })]);
    const past = 'we://a-call-from-last-month';

    expect(extractionOf(h.store, past).canChoose).toBe(true);
    // A record somebody named is one they had, so it exists and has been spoken into — unlike the
    // live call's own, which is written before anybody says anything.
    expect(extractionOf(h.store, past).canExtract).toBe(true);
    expect(liveExtraction(h.store).canExtract).toBe(false);

    await h.store.toggleExtractionTarget('EventBlock', past);

    expect(set).toEqual([{ collection: past, entity: 'EventBlock', on: true }]);
  });

  it('still lists the space’s own defaults outside a call, and says it cannot narrow them', () => {
    /*
      The state that looked broken. Outside a call there is no record to hang a per-call decision on,
      so `canChooseTargets` is false — but the list is not empty and never was: `forCall` falls back
      to the space's defaults, which is why the chips showed the right ticks while refusing every
      press. The panel edits that list instead now, and this is the flag it branches on.
    */
    const { h } = withInterpretation([]);

    expect(liveExtraction(h.store).canChoose).toBe(false);
    expect(liveExtraction(h.store).targets).toEqual([]);
  });

  it('says it cannot on a host that has no way to store one', async () => {
    const h = harness([peer(ME, { type: 'call', id: CALL, record: RECORD })], {
      interpretation: { available: () => true, targets: () => targets },
    });

    expect(liveExtraction(h.store).canChoose).toBe(false);
    // And the action stays safe to call: a surface that offers it anyway does nothing, rather than
    // throwing on a missing method.
    await expect(h.store.toggleExtractionTarget('EventBlock')).resolves.toBeUndefined();
  });
});

/**
 * Turning recording off, and having it stay off.
 *
 * It took two presses. The auto-join effect reads `enabled` and `optedOut`, and under a real
 * reactive runtime a signal write runs it synchronously — so with `setEnabled(false)` written first,
 * the effect ran while `optedOut` still said false. That is an agent in a call, not recording, and
 * not having declined: exactly the state it exists to answer, so it turned recording back on. The
 * next press worked, because by then the opt-out had landed.
 *
 * The ordering itself is not reachable from here — these signals do not notify, so no write re-runs
 * an effect and the re-entrancy cannot happen. What *is* reachable is the property the fix depends
 * on, and the one that would take the bug back if it broke: a later run of that effect, after a
 * refusal, leaves recording alone.
 */
describe('stopping a recording', () => {
  it('is not undone by the next run of the auto-join effect', () => {
    const h = harness([peer(ME, { type: 'call', id: CALL, record: RECORD })], {
      // The effect needs a dataset before it will start anything.
      dataset: () => ({ id: 'ds' }),
    });

    h.store.toggle();
    expect(h.store.enabled()).toBe(true);

    h.store.toggle();
    expect(h.store.enabled()).toBe(false);

    // A presence tick — a peer joining, somebody's availability changing — re-runs every effect.
    // Without the refusal recorded, this is where recording would come back.
    h.setPeers([peer(ME, { type: 'call', id: CALL, record: RECORD }), peer(THEM)]);

    expect(h.store.enabled()).toBe(false);
  });

  it('starts again on the next press', () => {
    // A refusal for this call, not for good: the way back is the same button, and pressing it has to
    // clear the flag that keeps the effect out.
    const h = harness([peer(ME, { type: 'call', id: CALL, record: RECORD })], { dataset: () => ({ id: 'ds' }) });

    h.store.toggle();
    h.store.toggle();
    h.store.toggle();

    expect(h.store.enabled()).toBe(true);
  });
});

/**
 * Whether a call is extracted as it happens, decided by the people in it.
 *
 * The space has a standing answer and an administrator sets it. That was the only control, so
 * stopping a pass on a conversation that had wandered somewhere nobody wanted records of meant
 * finding whoever owns the space — or leaving the call. This is the same layer the target chips
 * write at: a group decision beside the call, leaving the community's default alone.
 */
describe('turning automatic extraction off for one call', () => {
  function withAuto(peers: Peer[], auto: Record<string, boolean>) {
    const set: { collection: string; on: boolean }[] = [];
    const h = harness(peers, {
      interpretation: {
        available: () => true,
        autoEnabled: (collection?: string) => (collection ? (auto[collection] ?? true) : true),
        setAuto: async (collection: string, on: boolean) => {
          set.push({ collection, on });
          auto[collection] = on;
        },
      },
    });
    return { h, set };
  }

  it('asks about the call, not the space', () => {
    // The record exists from the moment the call starts, so this is answerable before anybody has
    // spoken — which is when somebody deciding not to record a conversation would say so.
    const { h } = withAuto([peer(ME, { type: 'call', id: CALL, record: RECORD })], { [RECORD]: false });

    expect(h.store.autoExtract()).toBe(false);
  });

  it('shows what it makes when switched on, and leaves the panel alone when switched off', async () => {
    /*
      The rule recording follows: starting something invisible and saying nothing about it is how a
      feature comes to look broken. Off is not symmetrical — what a pass already found is still worth
      reading, so closing the panel is the reader's decision rather than a consequence.
    */
    const { h } = withAuto([peer(ME, { type: 'call', id: CALL, record: RECORD })], { [RECORD]: false });
    expect(h.store.extractionOpen()).toBe(false);

    await h.store.toggleAutoExtract();
    expect(h.store.extractionOpen()).toBe(true);

    await h.store.toggleAutoExtract();
    expect(h.store.extractionOpen()).toBe(true);
  });

  it('writes the decision against that call', async () => {
    const { h, set } = withAuto([peer(ME, { type: 'call', id: CALL, record: RECORD })], { [RECORD]: true });

    await h.store.toggleAutoExtract();

    expect(set).toEqual([{ collection: RECORD, on: false }]);
    expect(h.store.autoExtract()).toBe(false);
  });

  it('does nothing where there is no call to record it against', async () => {
    // The same quiet refusal `toggleExtractionTarget` makes, and the same surface answers for both:
    // `canChooseTargets` is about the same record.
    const { h, set } = withAuto([], {});

    await h.store.toggleAutoExtract();

    expect(set).toEqual([]);
  });
});

/**
 * Writing into a transcript by hand — a message typed during a call, and a line the recogniser
 * misheard.
 *
 * Both put text in the same timeline a microphone writes into, which is the point: a remark typed
 * during a meeting belongs at the moment it was typed, among what was being said then. What must
 * not follow is the record claiming somebody *said* it — see `TextBlock.source`.
 */
describe('typing into a transcript', () => {
  let inCall: Peer[];

  beforeEach(() => {
    inCall = [peer(ME, { type: 'call', id: CALL, record: RECORD })];
  });

  it('marks what a microphone heard as spoken', async () => {
    // The one writer allowed to say so, and the reason the other two marks mean anything.
    const h = harness(inCall);

    await h.say('hello there');

    expect(h.created.find((c) => c.entity === 'TextBlock')?.fields.source).toBe('spoken');
  });

  it('writes a typed message into the same timeline, saying it was typed', async () => {
    const h = harness(inCall);

    await h.store.addMessage('', '  Sam is joining late  ');

    const block = h.created.find((c) => c.entity === 'TextBlock');
    expect(block?.fields).toEqual({ text: 'Sam is joining late', source: 'typed' });
    // Into the call's own record, which exists from its first second — a message does not require
    // somebody to have spoken first.
    expect(block?.options?.parent).toEqual({ id: RECORD, predicate: 'we://children' });
  });

  it('writes nothing for an empty message', async () => {
    const h = harness(inCall);

    await h.store.addMessage('', '   ');

    expect(h.created.filter((c) => c.entity === 'TextBlock')).toEqual([]);
  });

  it('has nowhere to put a message outside a call, and does not invent one', async () => {
    const h = harness([]);

    await h.store.addMessage('', 'a thought');

    expect(h.created.filter((c) => c.entity === 'TextBlock')).toEqual([]);
  });

  it('writes into the transcript named, so a past call can be annotated', async () => {
    // The reason the collection is an argument: the composer sits under whichever transcript is on
    // screen, and that is not always the one being recorded.
    const h = harness([]);

    await h.store.addMessage('past-call', 'watched this back');

    const block = h.created.find((c) => c.entity === 'TextBlock');
    expect(block?.options?.parent).toEqual({ id: 'past-call', predicate: 'we://children' });
    // And in the space on screen, not in whichever space a live call happens to be running in.
    expect(block?.options?.dataset).toBeUndefined();
  });
});

describe('mending a line somebody misheard', () => {
  let inCall: Peer[];
  let updates: Array<{ entity: string; id: string; fields: Record<string, unknown> }>;
  let deps: Record<string, unknown>;

  beforeEach(() => {
    inCall = [peer(ME, { type: 'call', id: CALL, record: RECORD })];
    updates = [];
    deps = {
      updateEntity: async (entity: string, id: string, fields: Record<string, unknown>) => {
        updates.push({ entity, id, fields });
      },
    };
  });

  it('records that a heard line is no longer verbatim', async () => {
    /*
      The whole reason the mark exists: a mended line that still reads as a quotation is a claim
      nobody checked, in a record other people rely on.
    */
    const h = harness(inCall, deps);

    await h.store.editUtterance('block-1', 'Siobhan is joining late', 'spoken');

    expect(updates).toEqual([
      { entity: 'TextBlock', id: 'block-1', fields: { text: 'Siobhan is joining late', source: 'corrected' } },
    ]);
  });

  it('leaves a typed message typed when its author fixes it', async () => {
    // Correcting your own writing is not a correction *of a transcript*, and calling it one would
    // put a mark on the ordinary act of fixing a typo.
    const h = harness(inCall, deps);

    await h.store.editUtterance('block-1', 'Sam is joining late', 'typed');

    expect(updates[0].fields).toEqual({ text: 'Sam is joining late' });
  });

  it('does not un-correct a line corrected once already', async () => {
    const h = harness(inCall, deps);

    await h.store.editUtterance('block-1', 'third go', 'corrected');

    expect(updates[0].fields).toEqual({ text: 'third go' });
  });

  it('refuses to write an empty line over what was said', async () => {
    // Emptying an utterance is not a correction, and the row would then render as a blank quote
    // with a byline — worse than the misheard words it replaced.
    const h = harness(inCall, deps);

    await h.store.editUtterance('block-1', '   ', 'spoken');

    expect(updates).toEqual([]);
  });
});

/**
 * Getting a model onto a node that has none, and waiting for one that is still arriving.
 *
 * Both used to fail in ways that looked like something else. A node with no model gave up silently
 * when recording started on its own, so the panel never offered anything; and a model still
 * downloading was opened anyway, which on AD4M blocks inside the call and times out with an error
 * naming nothing.
 */
describe('models', () => {
  const IN_CALL = [peer(ME, { type: 'call', id: CALL, record: RECORD })];
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  interface FakeModel {
    id: string;
    name: string;
    ready: boolean;
    isDefault: boolean;
    progress?: number;
  }

  /** A transcription port whose model list a test can change, and which records what it was asked. */
  function port(initial: FakeModel[], { offer = true, refuse = false } = {}) {
    let models = initial;
    const opened: string[] = [];
    let installs = 0;
    return {
      opened,
      installs: () => installs,
      setModels: (next: FakeModel[]) => (models = next),
      transcription: {
        available: () => true,
        models: async () => models,
        open: async (id: string) => {
          opened.push(id);
          return { feed: async () => {}, close: async () => {} };
        },
        offeredModel: () => (offer ? { name: 'Whisper small', downloadBytes: 967_000_000 } : null),
        installOfferedModel: async () => {
          installs += 1;
          if (refuse) throw new Error('not permitted');
          models = [{ id: 'small', name: 'Whisper small', ready: false, isDefault: false, progress: 0 }];
        },
      },
    };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('knows there is no model as soon as the panel opens, before anybody tries to record', async () => {
    // The panel is where somebody goes to see whether this works here, so that is where the offer
    // has to be — not only after a failed attempt to record.
    const p = port([]);
    const h = harness([], { transcription: p.transcription });

    h.store.togglePanel();
    await h.settle();

    expect(h.store.modelMissing()).toBe(true);
  });

  it('notices a model added elsewhere while the panel says there is none', async () => {
    vi.useFakeTimers();
    const p = port([]);
    const h = harness([], { transcription: p.transcription });

    h.store.togglePanel();
    h.setPeers([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.modelMissing()).toBe(true);

    p.setModels([{ id: 'base', name: 'Whisper base', ready: true, isDefault: false }]);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(h.store.modelMissing()).toBe(false);
  });

  it('names the offered model and its size on the button', () => {
    const h = harness([], { transcription: port([]).transcription });

    expect(h.store.canInstallModel()).toBe(true);
    expect(h.store.installModelLabel()).toBe('Download Whisper small (970 MB)');
  });

  it('offers no install where the backend offers no model', () => {
    // A guest on somebody else's node: the adapter withholds the offer, and the panel falls back to
    // settings or a sentence rather than a button that would be refused.
    const h = harness([], { transcription: port([], { offer: false }).transcription });

    expect(h.store.canInstallModel()).toBe(false);
    expect(h.store.installModelLabel()).toBe('');
  });

  it('installs, and reports the download that follows', async () => {
    const p = port([]);
    const h = harness([], { transcription: p.transcription });

    await h.store.installModel();

    expect(p.installs()).toBe(1);
    expect(h.store.modelMissing()).toBe(false);
    expect(h.store.modelDownloading()).toBe(true);
    expect(h.store.modelDownloadText()).toBe('Downloading the speech model — 0%');
  });

  it('says why an install failed, rather than leaving the button to do nothing', async () => {
    const p = port([], { refuse: true });
    const h = harness([], { transcription: p.transcription });

    await h.store.installModel();

    expect(h.store.installError()).toBe('not permitted');
    expect(h.store.installingModel()).toBe(false);
  });

  it('waits for a model that is still downloading instead of opening it', async () => {
    const p = port([{ id: 'small', name: 'Whisper small', ready: false, isDefault: true, progress: 42 }]);
    const h = harness([], { transcription: p.transcription });

    h.store.toggle();
    await h.settle();

    expect(h.store.status()).toBe('downloading');
    expect(h.store.modelDownloadText()).toBe('Downloading the speech model — 42%');
    expect(p.opened).toEqual([]);
  });

  it('starts recording on its own once the download finishes', async () => {
    vi.useFakeTimers();
    const p = port([{ id: 'small', name: 'Whisper small', ready: false, isDefault: true, progress: 10 }]);
    // In a call, in a space: recording that is waiting has to have somewhere it is waiting to write.
    const h = harness(IN_CALL, { dataset: () => ({}), transcription: p.transcription });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.status()).toBe('downloading');

    p.setModels([{ id: 'small', name: 'Whisper small', ready: true, isDefault: true }]);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(p.opened).toEqual(['small']);
  });

  it('picks up a model added while `no-model` was showing, without another press', async () => {
    // "Once one is, transcription starts on its own" — true of a model added in settings as well as
    // one installed from the panel.
    vi.useFakeTimers();
    const p = port([]);
    const h = harness(IN_CALL, { dataset: () => ({}), transcription: p.transcription });
    await vi.advanceTimersByTimeAsync(0);

    // Auto-join gave up quietly; pressing record is what asks the question.
    h.store.toggle();
    // The stand-in host re-runs effects on demand, the way a reactive one would when state moves.
    h.setPeers(IN_CALL);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.status()).toBe('no-model');

    p.setModels([{ id: 'base', name: 'Whisper base', ready: true, isDefault: false }]);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(p.opened).toEqual(['base']);
  });

  it('lets an auto-join that gave up for want of a model try again after an install', async () => {
    const p = port([]);
    const h = harness(IN_CALL, { dataset: () => ({}), transcription: p.transcription });
    await settle();
    expect(h.store.enabled()).toBe(false);

    await h.store.installModel();
    await h.settle();

    expect(h.store.enabled()).toBe(true);
    expect(h.store.status()).toBe('downloading');
  });
});

/**
 * Saying that speech is with the model.
 *
 * Between somebody stopping and their words coming back there is a second or several in which the
 * panel otherwise looks as it would had nobody spoken at all.
 */
describe('transcribing', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is transcribing from an utterance being sent until its text arrives', () => {
    const h = harness();

    h.store.markUtteranceSent(16_000);
    expect(h.store.transcribing()).toBe(true);
    expect(h.store.heard()).toBe(true);

    h.store.receiveText('hello there');
    expect(h.store.transcribing()).toBe(false);
    // Still heard: the words are buffered, not yet in the record.
    expect(h.store.heard()).toBe(true);
  });

  it('counts two utterances in flight as two', () => {
    const h = harness();

    h.store.markUtteranceSent(16_000);
    h.store.markUtteranceSent(16_000);
    h.store.receiveText('first');

    expect(h.store.transcribing()).toBe(true);
  });

  it('stops claiming an utterance that never produced text', () => {
    // A cough the backend's own gate threw away answers with nothing, and nothing says so.
    vi.useFakeTimers();
    const h = harness();

    h.store.markUtteranceSent(16_000);
    vi.advanceTimersByTime(1_000 + 5_000);

    expect(h.store.transcribing()).toBe(false);
    expect(h.store.heard()).toBe(false);
  });
});

/**
 * A stream the backend let go of.
 *
 * AD4M reaps a stream nobody has fed for thirty seconds, and this module feeds only when somebody
 * speaks — so any long pause killed transcription for the rest of the call, with the panel still
 * saying it was listening. Driven through a stand-in audio graph, since this is the listening half
 * the rest of the file deliberately avoids.
 */
describe('a stream the backend dropped', () => {
  /** The worklet node the store builds, kept so a test can post an utterance through its port. */
  let nodes: { port: { onmessage: ((event: { data: unknown }) => void) | null } }[];

  beforeEach(() => {
    nodes = [];
    vi.stubGlobal(
      'AudioContext',
      class {
        audioWorklet = { addModule: async () => {} };
        createMediaStreamSource() {
          return { connect() {}, disconnect() {} };
        }
        async close() {}
      },
    );
    vi.stubGlobal(
      'AudioWorkletNode',
      class {
        port = { onmessage: null, postMessage() {}, close() {} };
        constructor() {
          nodes.push(this as never);
        }
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const IN_CALL = [peer(ME, { type: 'call', id: CALL, record: RECORD })];
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const utterance = () => ({ data: { kind: 'utterance', audio: new Float32Array(1600) } });

  function streams(behaviour: ('fails' | 'works')[]) {
    const fed: number[] = [];
    let opens = 0;
    return {
      fed,
      opens: () => opens,
      transcription: {
        available: () => true,
        models: async () => [{ id: 'small', name: 'Whisper small', ready: true, isDefault: true }],
        open: async () => {
          const index = opens++;
          const how = behaviour[index] ?? 'works';
          if (how === 'fails' && index > 0) throw new Error('model gone');
          return {
            feed: async () => {
              if (how === 'fails') throw new Error('stream not found');
              fed.push(index);
            },
            close: async () => {},
          };
        },
      },
    };
  }

  it('reopens the stream and resends the utterance that found it gone', async () => {
    const s = streams(['fails', 'works']);
    const h = harness(IN_CALL, { dataset: () => ({}), transcription: s.transcription });
    await settle();
    expect(h.store.status()).toBe('listening');

    nodes[0].port.onmessage?.(utterance());
    await settle();

    expect(s.opens()).toBe(2);
    expect(s.fed).toEqual([1]);
    expect(h.store.status()).toBe('listening');
  });

  it('shares one reopen between utterances that fail together', async () => {
    const s = streams(['fails', 'works']);
    const h = harness(IN_CALL, { dataset: () => ({}), transcription: s.transcription });
    await settle();

    nodes[0].port.onmessage?.(utterance());
    nodes[0].port.onmessage?.(utterance());
    await settle();

    expect(s.opens()).toBe(2);
    expect(s.fed).toEqual([1, 1]);
    expect(h.store.status()).toBe('listening');
  });

  it('stops and says so when the stream cannot be reopened', async () => {
    const s = streams(['fails', 'fails']);
    const h = harness(IN_CALL, { dataset: () => ({}), transcription: s.transcription });
    await settle();

    nodes[0].port.onmessage?.(utterance());
    await settle();
    await settle();

    expect(h.store.status()).toBe('error');
    expect(h.store.error()).toContain('could not be reached again');
    expect(h.store.listening()).toBe(false);
  });
});
