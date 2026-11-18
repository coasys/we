/**
 * The a9 socket — the second WebSocket the mount/template calls ride — unit tested
 * where it lives.
 *
 * Two obligations the first version missed, both from the review: a call the executor
 * never answers must not hang forever (one `setTimeout` per pending call, and one on the
 * open), and the socket belongs to the session that opened it — when the session ends,
 * or re-authorises into different credentials under it, the socket closes and every
 * pending call hears one answer rather than timing out one by one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAd4mAcornLifecycle } from './acornLifecycleAdapter';
import type { Ad4mHttpConnection } from './languageModelPort';

/** A WebSocket that never leaves the test: every instance is inspectable and drivable. */
class FakeWS {
  static instances: FakeWS[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  readonly sent: string[] = [];
  closed = false;

  constructor(readonly url: string) {
    FakeWS.instances.push(this);
    queueMicrotask(() => {
      // An open socket unless the test says otherwise — `quiet` keeps it in CONNECTING.
      if (!FakeWS.quiet && !this.closed) this.onopen?.();
    });
  }

  /** Set by a test before construction: sockets never open. */
  static quiet = false;

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.onclose?.();
  }

  /** Deliver a reply frame for the most recently sent call id. */
  reply(result: unknown, error?: { message: string }) {
    const last = JSON.parse(this.sent[this.sent.length - 1]) as { id: string };
    this.onmessage?.({ data: JSON.stringify(error ? { id: last.id, error } : { id: last.id, result }) });
  }
}

/** Wait until `ws` has sent `n` frames — a reply before the send lands answers nothing. */
const sent = (ws: FakeWS, n = 1) => vi.waitFor(() => expect(ws.sent).toHaveLength(n));

const port = (conn?: Ad4mHttpConnection | null) =>
  createAd4mAcornLifecycle(
    { expression: { interact: vi.fn(async () => null) } },
    () => conn ?? { url: 'http://127.0.0.1:12000', token: 'test-token' },
  );

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWS);
  FakeWS.instances = [];
  FakeWS.quiet = false;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the a9 socket', () => {
  it('opens lazily on the session url and token, and matches replies by id', async () => {
    const p = port();
    const call = p.mounts('dataset-1');
    await vi.waitFor(() => expect(FakeWS.instances).toHaveLength(1));
    const ws = FakeWS.instances[0];
    expect(ws.url).toBe('ws://127.0.0.1:12000/api/v1/ws?token=test-token');
    await sent(ws);
    ws.reply(['lang-a']);
    await expect(call).resolves.toEqual(['lang-a']);
  });

  it('rejects a call the executor never answers', async () => {
    vi.useFakeTimers();
    const p = port();
    const call = p.mounts('dataset-1');
    const settled = call.then(
      () => 'resolved',
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(31_000);
    await expect(settled).resolves.toMatch(/nothing|timed? ?out/i);
  });

  it('lets go of an open that never completes, and the next call tries fresh', async () => {
    vi.useFakeTimers();
    FakeWS.quiet = true;
    const p = port();
    const settled = p.mounts('dataset-1').then(
      () => 'resolved',
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(11_000);
    await expect(settled).resolves.toMatch(/open/i);

    FakeWS.quiet = false;
    const retry = p.mounts('dataset-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWS.instances).toHaveLength(2);
    FakeWS.instances[1].reply([]);
    await expect(retry).resolves.toEqual([]);
  });

  it('close with the session: dispose rejects what is in flight and refuses what follows', async () => {
    const p = port();
    const first = p.mounts('dataset-1');
    await vi.waitFor(() => expect(FakeWS.instances).toHaveLength(1));
    await sent(FakeWS.instances[0]);
    FakeWS.instances[0].reply([]);
    await first; // the socket is open and idle

    const hanging = p.mount('dataset-1', 'lang-a');
    await vi.waitFor(() => expect(FakeWS.instances[0].sent).toHaveLength(2));
    const settled = hanging.then(
      () => 'resolved',
      (e: Error) => e.message,
    );

    const dispose = (p as { dispose?: () => void }).dispose;
    expect(dispose, 'the port exposes dispose() — the session-close path').toBeInstanceOf(Function);
    dispose!.call(p);

    await expect(settled).resolves.toMatch(/ended|closed/i);
    expect(FakeWS.instances[0].closed).toBe(true);
    await expect(p.mounts('dataset-1')).rejects.toThrow(/ended|closed/i);
    // Idempotent — a second dispose must not throw.
    expect(() => (p as { dispose?: () => void }).dispose?.()).not.toThrow();
  });

  it('closes the socket it was authenticated under when the session credentials change', async () => {
    let conn: Ad4mHttpConnection = { url: 'http://127.0.0.1:12000', token: 'token-one' };
    const p = createAd4mAcornLifecycle({ expression: { interact: vi.fn() } }, () => conn);
    const first = p.mounts('dataset-1');
    await vi.waitFor(() => expect(FakeWS.instances).toHaveLength(1));
    await sent(FakeWS.instances[0]);
    FakeWS.instances[0].reply([]);
    await first;

    conn = { url: 'http://127.0.0.1:12000', token: 'token-two' };
    const second = p.mounts('dataset-1');
    await vi.waitFor(() => expect(FakeWS.instances).toHaveLength(2));
    expect(FakeWS.instances[0].closed).toBe(true);
    expect(FakeWS.instances[1].url).toBe('ws://127.0.0.1:12000/api/v1/ws?token=token-two');
    await sent(FakeWS.instances[1]);
    FakeWS.instances[1].reply([]);
    await expect(second).resolves.toEqual([]);
  });

  it('ignores frames that are not replies to a pending call', async () => {
    const p = port();
    const call = p.mounts('dataset-1');
    await vi.waitFor(() => expect(FakeWS.instances).toHaveLength(1));
    const ws = FakeWS.instances[0];
    await sent(ws);
    ws.onmessage?.({ data: 'not json at all' });
    ws.onmessage?.({ data: JSON.stringify({ event: 'perspective-added', data: {} }) });
    ws.onmessage?.({ data: JSON.stringify({ id: 'nobody-asked', result: [] }) });
    ws.reply(['lang-a']);
    await expect(call).resolves.toEqual(['lang-a']);
  });

  it('rejects every pending call when the socket closes mid-flight', async () => {
    const p = port();
    const call = p.mounts('dataset-1');
    await vi.waitFor(() => expect(FakeWS.instances).toHaveLength(1));
    await sent(FakeWS.instances[0]);
    FakeWS.instances[0].onclose?.();
    await expect(call).rejects.toThrow(/closed/i);
    // The next call opens a fresh socket rather than reusing the corpse.
    const retry = p.mounts('dataset-1');
    await vi.waitFor(() => expect(FakeWS.instances).toHaveLength(2));
    await sent(FakeWS.instances[1]);
    FakeWS.instances[1].reply([]);
    await expect(retry).resolves.toEqual([]);
  });
});
