/**
 * A space joined a moment ago waits for its own record before its template is decided.
 *
 * Seen on two machines: a peer followed `/space/<id>/canvas?call=…`, joined, and was shown the
 * default template at `/about`. The space's `Space` record — which names the Workshop — had not
 * synced yet, the template question was marked answered without it, and nothing asked again. Then,
 * with that fixed, the default template still flashed up for a second before the Workshop: the wait
 * let go before the choice was applied, and a record arriving without its `defaultTemplateId` read
 * as one naming none.
 *
 * Driven through real signals and effects, because every one of these was an effect hearing too
 * little or too early — under each engine (Solid, the test port, Vue).
 */
import type { ReactivityPort } from '@we/reactivity';
import { solidReactivity } from '@we/reactivity-solid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSpaceRecordWait } from '../src/shared/stores/spaceRecordWait';
import { reactivityPorts } from './support/engines';

let port: ReactivityPort = solidReactivity;

function harness() {
  const [currentId, setCurrentId] = port.signal<string | null>('ds-1');
  const [space, setSpace] = port.signal<{ defaultTemplateId?: string } | undefined>(undefined);
  const [templates, setTemplates] = port.signal<string[]>(['default', 'workshop']);
  let applied: () => void = () => {};
  const choose = vi.fn(() => new Promise<void>((resolve) => (applied = resolve)));
  const settle = vi.fn();
  let wait!: (datasetId: string) => void;
  let waiting!: () => string | null;
  const dispose = port.root(() => {
    ({ wait, waiting } = createSpaceRecordWait({
      reactivity: port,
      currentId,
      spaceOf: space,
      hasTemplate: (id) => templates().includes(id),
      choose,
      settle,
      patienceMs: 1_000,
      noDefaultGraceMs: 300,
    }));
  });
  return {
    wait,
    waiting,
    setCurrentId,
    setSpace,
    setTemplates,
    choose,
    settle,
    /** The template store finishing its choice. */
    apply: async () => {
      applied();
      await flush();
    },
    dispose: () => dispose(),
  };
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe.each(reactivityPorts)('waiting for a space’s own record, under %s', (_name, makePort) => {
  beforeEach(() => {
    port = makePort();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('decides nothing while the record is missing', async () => {
    const h = harness();
    h.wait('ds-1');
    await flush();

    expect(h.choose).not.toHaveBeenCalled();
    expect(h.settle).not.toHaveBeenCalled();
    expect(h.waiting()).toBe('ds-1');
    h.dispose();
  });

  it('chooses the template once the record arrives, and only then stops loading and settles', async () => {
    // Letting go before the choice was applied remounted the router with the agent's default for
    // the moment the choice took — the default flashed up before the space's own.
    const h = harness();
    h.wait('ds-1');

    h.setSpace({ defaultTemplateId: 'workshop' });
    await flush();
    expect(h.choose).toHaveBeenCalledOnce();
    expect(h.waiting()).toBe('ds-1');
    expect(h.settle).not.toHaveBeenCalled();

    await h.apply();
    expect(h.waiting()).toBeNull();
    expect(h.settle).toHaveBeenCalledWith('ds-1');
    h.dispose();
  });

  it('waits on the template the record names, when that template has not arrived either', async () => {
    // A space's own template syncs in like its record does.
    const h = harness();
    h.wait('ds-1');
    h.setSpace({ defaultTemplateId: 'their-own' });
    await flush();
    expect(h.choose).not.toHaveBeenCalled();

    h.setTemplates(['default', 'their-own']);
    await flush();

    expect(h.choose).toHaveBeenCalledOnce();
    h.dispose();
  });

  it('gives a record naming no default a moment for one to arrive', async () => {
    // A record arrives in pieces: the Space first, its defaultTemplateId after.
    const h = harness();
    h.wait('ds-1');
    h.setSpace({});
    await flush();
    expect(h.choose).not.toHaveBeenCalled();

    h.setSpace({ defaultTemplateId: 'workshop' });
    await flush();

    expect(h.choose).toHaveBeenCalledOnce();
    h.dispose();
  });

  it('chooses without a default once the grace is over, for a space that names none', async () => {
    const h = harness();
    h.wait('ds-1');
    h.setSpace({});
    await flush();

    vi.advanceTimersByTime(300);
    await flush();

    expect(h.choose).toHaveBeenCalledOnce();
    await h.apply();
    expect(h.settle).toHaveBeenCalledWith('ds-1');
    h.dispose();
  });

  it('settles and stops loading at the limit, for a dataset that never gets a record', async () => {
    // The loading screen must not outlive the limit; a record that turns up later is the template
    // store's to follow, as any change to a settled space's default is.
    const h = harness();
    h.wait('ds-1');

    vi.advanceTimersByTime(1_000);

    expect(h.settle).toHaveBeenCalledWith('ds-1');
    expect(h.waiting()).toBeNull();
    h.setSpace({ defaultTemplateId: 'workshop' });
    await flush();
    expect(h.choose).not.toHaveBeenCalled();
    h.dispose();
  });

  it('stops waiting for a space that was left', async () => {
    const h = harness();
    h.wait('ds-1');
    h.setCurrentId('ds-2');
    await flush();

    h.setSpace({ defaultTemplateId: 'default' });
    await flush();
    vi.advanceTimersByTime(1_000);

    expect(h.waiting()).toBeNull();
    expect(h.choose).not.toHaveBeenCalled();
    expect(h.settle).not.toHaveBeenCalled();
    h.dispose();
  });

  it('chooses at once for a space whose record and template are already here, the limit still set', async () => {
    // The effect may run on the write that starts the wait; it must find the wait whole when it does.
    const h = harness();
    h.setSpace({ defaultTemplateId: 'workshop' });
    h.wait('ds-1');
    await flush();
    expect(h.choose).toHaveBeenCalledOnce();

    await h.apply();
    expect(h.settle).toHaveBeenCalledOnce();
    // The limit was cleared with the wait, so it does not settle a second time.
    vi.advanceTimersByTime(1_000);
    expect(h.settle).toHaveBeenCalledOnce();
    h.dispose();
  });
});
