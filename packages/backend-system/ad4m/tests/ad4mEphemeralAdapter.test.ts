/**
 * The AD4M ephemeral adapter — focused on the two behaviours that aren't just "call
 * `sendBroadcastU`": scope sharing across consumers, and the emulated-unicast filter.
 *
 * Scope sharing is the one worth testing hardest. It has no visible symptom when it is wrong — you
 * get a second executor signal handler, every message parsed twice, and one consumer's `dispose()`
 * quietly killing another's transport.
 */
import { createAd4mEphemeralPort } from '@we/backend-ad4m';
import { describe, expect, it, vi } from 'vitest';

type Handler = (signal: unknown) => void;

/**
 * Let the microtask queue drain.
 *
 * A publish now awaits the signal-handler registration before it sends, so the send is several
 * microtasks deep rather than one. Draining rather than counting ticks keeps the tests from
 * depending on how many `await`s the implementation happens to have.
 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A `PerspectiveProxy` stand-in exposing only what the adapter reaches for. */
// `null` (not `undefined`) means unshared — passing undefined to a defaulted parameter would
// silently take the default and build a shared perspective instead.
function fakePerspective(sharedUrl: string | null = 'neighbourhood://Qm1') {
  const handlers: Handler[] = [];
  const sent: Array<{ source: string; predicate: string; target: string }> = [];
  const neighbourhood = {
    addSignalHandler: vi.fn(async (h: Handler) => {
      handlers.push(h);
    }),
    removeSignalHandler: vi.fn((h: Handler) => {
      const i = handlers.indexOf(h);
      if (i !== -1) handlers.splice(i, 1);
    }),
    sendBroadcastU: vi.fn(async (payload: { links: Array<{ source: string; predicate: string; target: string }> }) => {
      sent.push(payload.links[0]);
      return true;
    }),
  };
  return {
    perspective: { sharedUrl, getNeighbourhoodProxy: () => neighbourhood } as never,
    neighbourhood,
    handlers,
    sent,
    /** Play an inbound signal as the executor would. */
    receive(author: string, predicate: string, source: unknown, target = '*') {
      const signal = { data: { links: [{ author, data: { source: JSON.stringify(source), predicate, target } }] } };
      handlers.forEach((h) => h(signal));
    },
  };
}

describe('createAd4mEphemeralPort', () => {
  it('returns null for a personal space, so consumers degrade rather than publish into a void', () => {
    const port = createAd4mEphemeralPort(() => 'me');
    expect(port(fakePerspective(null).perspective)).toBeNull();
  });

  describe('scope sharing', () => {
    it('registers one signal handler however many consumers ask for the same dataset', () => {
      const env = fakePerspective();
      const port = createAd4mEphemeralPort(() => 'me');

      port(env.perspective);
      port(env.perspective);
      port(env.perspective);

      expect(env.neighbourhood.addSignalHandler).toHaveBeenCalledTimes(1);
    });

    it('keeps the transport alive while another consumer still holds it', () => {
      const env = fakePerspective();
      const port = createAd4mEphemeralPort(() => 'me');
      const presence = port(env.perspective)!;
      const call = port(env.perspective)!;

      const seen: unknown[] = [];
      call.channel('rtc').onMessage((_from, payload) => seen.push(payload));

      // Presence unmounts. The call module must not lose its transport.
      presence.dispose();
      expect(env.neighbourhood.removeSignalHandler).not.toHaveBeenCalled();

      env.receive('peer', 'we://ephemeral/rtc', { offer: 1 });
      expect(seen).toEqual([{ offer: 1 }]);
    });

    it('tears down only when the last consumer releases', () => {
      const env = fakePerspective();
      const port = createAd4mEphemeralPort(() => 'me');
      const a = port(env.perspective)!;
      const b = port(env.perspective)!;

      a.dispose();
      b.dispose();

      expect(env.neighbourhood.removeSignalHandler).toHaveBeenCalledTimes(1);
    });

    it('does not over-decrement on a double dispose', () => {
      const env = fakePerspective();
      const port = createAd4mEphemeralPort(() => 'me');
      const a = port(env.perspective)!;
      const b = port(env.perspective)!;

      a.dispose();
      a.dispose(); // idempotent — must not release b's hold
      expect(env.neighbourhood.removeSignalHandler).not.toHaveBeenCalled();

      b.dispose();
      expect(env.neighbourhood.removeSignalHandler).toHaveBeenCalledTimes(1);
    });

    it('re-registers after a full teardown, rather than handing back a dead scope', () => {
      const env = fakePerspective();
      const port = createAd4mEphemeralPort(() => 'me');
      port(env.perspective)!.dispose();

      const revived = port(env.perspective)!;
      const seen: unknown[] = [];
      revived.channel('presence').onMessage((_from, payload) => seen.push(payload));

      expect(env.neighbourhood.addSignalHandler).toHaveBeenCalledTimes(2);
      env.receive('peer', 'we://ephemeral/presence', { beat: 1 });
      expect(seen).toEqual([{ beat: 1 }]);
    });

    it('gives different datasets different scopes', () => {
      const one = fakePerspective('neighbourhood://Qm1');
      const two = fakePerspective('neighbourhood://Qm2');
      const port = createAd4mEphemeralPort(() => 'me');

      port(one.perspective);
      port(two.perspective);

      expect(one.neighbourhood.addSignalHandler).toHaveBeenCalledTimes(1);
      expect(two.neighbourhood.addSignalHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('routing', () => {
    it('delivers only to the matching tag', () => {
      const env = fakePerspective();
      const scope = createAd4mEphemeralPort(() => 'me')(env.perspective)!;
      const presence: unknown[] = [];
      const rtc: unknown[] = [];
      scope.channel('presence').onMessage((_f, p) => presence.push(p));
      scope.channel('rtc').onMessage((_f, p) => rtc.push(p));

      env.receive('peer', 'we://ephemeral/presence', 'beat');

      expect(presence).toEqual(['beat']);
      expect(rtc).toEqual([]);
    });

    it('ignores traffic that is not ours, and our own echo', () => {
      const env = fakePerspective();
      const scope = createAd4mEphemeralPort(() => 'me')(env.perspective)!;
      const seen: unknown[] = [];
      scope.channel('presence').onMessage((_f, p) => seen.push(p));

      env.receive('peer', 'some/other/protocol', 'not ours');
      env.receive('me', 'we://ephemeral/presence', 'my own echo');

      expect(seen).toEqual([]);
    });

    it('honours addressing on receipt — emulated unicast is a filter, not privacy', () => {
      const env = fakePerspective();
      const scope = createAd4mEphemeralPort(() => 'me')(env.perspective)!;
      const seen: unknown[] = [];
      scope.channel('rtc').onMessage((_f, p) => seen.push(p));

      env.receive('peer', 'we://ephemeral/rtc', 'for someone else', 'other-did');
      expect(seen).toEqual([]);

      env.receive('peer', 'we://ephemeral/rtc', 'for me', 'me');
      expect(seen).toEqual(['for me']);
    });

    it('survives a malformed payload rather than tearing down the channel', () => {
      const env = fakePerspective();
      const scope = createAd4mEphemeralPort(() => 'me')(env.perspective)!;
      const seen: unknown[] = [];
      scope.channel('presence').onMessage((_f, p) => seen.push(p));

      env.handlers.forEach((h) =>
        h({
          data: { links: [{ author: 'peer', data: { source: 'not json', predicate: 'we://ephemeral/presence' } }] },
        }),
      );
      env.receive('peer', 'we://ephemeral/presence', 'fine');

      // Presence is idempotent, so dropping one bad message and carrying on is the right behaviour.
      expect(seen).toEqual(['fine']);
    });

    it('addresses a broadcast to everyone by default', async () => {
      const env = fakePerspective();
      const scope = createAd4mEphemeralPort(() => 'me')(env.perspective)!;

      scope.channel('presence').publish({ beat: 1 });
      await flush();

      expect(env.sent[0]).toMatchObject({ predicate: 'we://ephemeral/presence', target: '*' });
      expect(JSON.parse(env.sent[0].source)).toEqual({ beat: 1 });
    });
  });

  /**
   * Both behaviours here are latency bugs, which is why neither was noticed for so long: nothing
   * fails, nothing logs, and every message eventually arrives. They were found from the outside, as
   * "starting a call takes a while to show up for the other agent".
   */
  describe('publish timing', () => {
    it('waits for the signal handler before publishing anything', async () => {
      // The presence handshake is one round trip: a joiner broadcasts `hello` and every peer answers
      // at once. Publishing before the executor has registered our handler means those answers are
      // delivered to nobody, and the joiner sits in an apparently empty space until each peer's next
      // heartbeat.
      const env = fakePerspective();
      let registered = false;
      env.neighbourhood.addSignalHandler.mockImplementationOnce(async (h: Handler) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        env.handlers.push(h);
        registered = true;
      });

      const scope = createAd4mEphemeralPort(() => 'me')(env.perspective)!;
      scope.channel('presence').publish({ hello: true });

      await flush();
      expect(env.sent).toHaveLength(0);

      await new Promise((resolve) => setTimeout(resolve, 10));
      await flush();
      expect(registered).toBe(true);
      expect(env.sent).toHaveLength(1);
    });

    it('holds a coalesced publish and sends it when the in-flight one lands', async () => {
      // The difference between holding and dropping. "The next message carries the same state" is
      // true of a heartbeat and false of the state change it has not started repeating yet — so a
      // dropped `join a call` cost the other agent a full heartbeat interval of not knowing.
      const env = fakePerspective();
      let release: (() => void) | undefined;
      env.neighbourhood.sendBroadcastU.mockImplementationOnce(async (payload) => {
        await new Promise<void>((resolve) => (release = resolve));
        env.sent.push(payload.links[0]);
        return true;
      });

      const scope = createAd4mEphemeralPort(() => 'me')(env.perspective)!;
      const channel = scope.channel('presence', { coalesce: true });

      channel.publish({ beat: 1 });
      await flush();

      // Two state changes land while the first send is stuck. Only the newest is worth sending —
      // that is what coalescing means — but *something* must be.
      channel.publish({ joinedCall: true });
      channel.publish({ leftCall: true });
      expect(env.sent).toHaveLength(0);

      release!();
      await flush();

      expect(env.sent.map((link) => JSON.parse(link.source))).toEqual([{ beat: 1 }, { leftCall: true }]);
    });

    it('keeps publishing after a send throws synchronously', async () => {
      // A synchronous throw never reaches a `.finally`, so the in-flight flag would stay set and the
      // channel would go silent for the rest of the session — the worst possible failure for the one
      // option whose entire job is to gate on that flag.
      const env = fakePerspective();
      env.neighbourhood.sendBroadcastU.mockImplementationOnce(() => {
        throw new Error('executor gone');
      });

      const scope = createAd4mEphemeralPort(() => 'me')(env.perspective)!;
      const channel = scope.channel('presence', { coalesce: true });

      channel.publish({ beat: 1 });
      await flush();
      channel.publish({ beat: 2 });
      await flush();

      expect(env.sent.map((link) => JSON.parse(link.source))).toEqual([{ beat: 2 }]);
    });
  });
});
