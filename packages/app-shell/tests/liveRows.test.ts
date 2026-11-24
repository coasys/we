import { describe, expect, it } from 'vitest';

import { heldLive, liveRows } from './liveRows';

describe('heldLive', () => {
  it('rejects the held first result when the handle is disposed before the gate opens', async () => {
    let open!: () => void;
    const held = heldLive(liveRows([1]), new Promise<void>((resolve) => (open = resolve)));
    const outcome = held.first.then(
      () => 'resolved',
      (error: Error) => error.message,
    );
    held.dispose();
    open();
    expect(await outcome).toMatch(/disposed/);
  });

  it('delivers the first result once the gate opens', async () => {
    let open!: () => void;
    const held = heldLive(liveRows([1]), new Promise<void>((resolve) => (open = resolve)));
    open();
    expect(await held.first).toEqual({ results: [1] });
  });
});
