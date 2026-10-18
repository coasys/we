/**
 * A space joined a moment ago waits for its own record before its template is decided.
 *
 * Seen on two machines: a peer followed `/space/<id>/canvas?call=…`, joined, and was shown the
 * default template at `/about`. The space's `Space` record — which names the Workshop — had not
 * synced yet, the template question was marked answered without it, and nothing asked again.
 *
 * Driven through real signals and effects, because the bug was an effect that ran once and never
 * heard what arrived after it.
 */
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSpaceRecordWait } from '../src/frameworks/solid/stores/spaceRecordWait';

function harness() {
  const [currentId, setCurrentId] = createSignal<string | null>('ds-1');
  const [space, setSpace] = createSignal<{ defaultTemplateId?: string } | undefined>(undefined);
  const [templates, setTemplates] = createSignal<string[]>(['default']);
  const choose = vi.fn(async () => {});
  const settle = vi.fn();
  let dispose = () => {};
  const { wait, waiting } = createRoot((d) => {
    dispose = d;
    return createSpaceRecordWait({
      currentId,
      spaceOf: space,
      hasTemplate: (id) => templates().includes(id),
      choose,
      settle,
      patienceMs: 1_000,
    });
  });
  return { wait, waiting, setCurrentId, setSpace, setTemplates, choose, settle, dispose: () => dispose() };
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('waiting for a space’s own record', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('decides nothing while the record is missing', async () => {
    const h = harness();
    h.wait('ds-1');
    await flush();

    expect(h.choose).not.toHaveBeenCalled();
    expect(h.settle).not.toHaveBeenCalled();
    h.dispose();
  });

  it('chooses the template, then settles, once the record arrives', async () => {
    const h = harness();
    h.setTemplates(['default', 'workshop']);
    h.wait('ds-1');

    h.setSpace({ defaultTemplateId: 'workshop' });
    await flush();
    await flush();

    expect(h.choose).toHaveBeenCalledOnce();
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
    await flush();

    expect(h.choose).toHaveBeenCalledOnce();
    expect(h.settle).toHaveBeenCalledWith('ds-1');
    h.dispose();
  });

  it('settles at the limit for a dataset that never gets a record, and still applies a late one', async () => {
    const h = harness();
    h.wait('ds-1');

    vi.advanceTimersByTime(1_000);
    expect(h.settle).toHaveBeenCalledWith('ds-1');
    expect(h.choose).not.toHaveBeenCalled();

    h.setSpace({});
    await flush();
    expect(h.choose).toHaveBeenCalledOnce();
    h.dispose();
  });

  it('says which space it is waiting for, so the host can show it loading', async () => {
    // What "Loading space data…" is drawn from.
    const h = harness();
    expect(h.waiting()).toBeNull();

    h.wait('ds-1');
    expect(h.waiting()).toBe('ds-1');

    h.setSpace({});
    await flush();
    expect(h.waiting()).toBeNull();
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

    expect(h.choose).not.toHaveBeenCalled();
    expect(h.settle).not.toHaveBeenCalled();
    h.dispose();
  });
});
