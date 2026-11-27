/**
 * What `Ad4mModel` itself holds in a to-one relation after a write, on a real executor, with none of
 * WE's patches installed.
 *
 * `src/toOneValues.ts` works round the model layer: given `[id]` for a to-one, `create` writes the
 * link and hands back an instance still holding the list, and inside a transaction nothing reads it
 * back until the commit. This file asks the model directly, so it goes red the day a pin of
 * `@coasys/ad4m` holds the id itself, which is when the workaround is to be deleted
 * (ad4m-issue:to-one-held-as-list).
 *
 * It must not import `createAd4mBackendPorts`, or anything that calls it: that installs the patch on
 * `Ad4mModel.prototype`, and the inverted cases would then pass for WE's reason, not AD4M's. Vitest
 * evaluates each file's modules afresh, so another file installing it does not reach this one, and
 * the first case checks the prototype is the SDK's own.
 */
import { Ad4mClient, Ad4mModel, HasOne, Model, type PerspectiveProxy, Property } from '@coasys/ad4m';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

@Model({ name: 'ToOneHeldAsList' })
class Placed extends Ad4mModel {
  @Property({ through: 'toonelive://label' })
  label?: string;

  @HasOne({ through: 'toonelive://placed_node' })
  node?: string;
}

const PATCHED = Symbol.for('we.ad4m.toOneValues');
const unpatched = () => !(PATCHED in Ad4mModel.prototype);

let opened: { client: Ad4mClient; perspective: PerspectiveProxy } | undefined;

beforeAll(async () => {
  // A patched prototype would make every inverted case below pass for the wrong reason.
  if (!unpatched()) throw new Error('Ad4mModel.prototype carries the to-one patch; this file must not install it');
  const { url, token } = inject('ad4mExecutor');
  const client = new Ad4mClient(url, token);
  const perspective = await client.perspective.add(`we-to-one-${Date.now()}`);
  opened = { client, perspective };
  await Ad4mModel.registerAll(perspective, [Placed]);
}, 180_000);

afterAll(async () => {
  if (!opened) return;
  await opened.client.perspective.remove(opened.perspective.uuid).catch(() => undefined);
  opened.client.close();
});

describe('Ad4mModel, unpatched: a to-one written as a list of one', () => {
  it('runs on the SDK prototype, with no to-one patch installed', () => {
    expect(unpatched()).toBe(true);
    expect((Ad4mModel.prototype.save as { name?: string }).name).not.toBe('withToOneValues');
  });

  it('writes the link, and a read holds the one id', { timeout: 60_000 }, async () => {
    const { perspective } = opened!;
    const created = await Placed.create(perspective, { label: 'read', node: ['toonelive://n1'] });
    const read = await Placed.findOne(perspective, { where: { id: created.id } });
    expect(read?.node).toBe('toonelive://n1');
  });

  it.fails(
    'holds the one id on the instance create returns [known gap: the instance keeps the list until the next read (ad4m-issue:to-one-held-as-list)]',
    { timeout: 60_000 },
    async () => {
      const created = await Placed.create(opened!.perspective, { label: 'created', node: ['toonelive://n2'] });
      expect(created.node).toBe('toonelive://n2');
    },
  );

  it.fails(
    'holds the one id on an instance created inside a transaction [known gap: the instance keeps the list until the next read (ad4m-issue:to-one-held-as-list)]',
    { timeout: 60_000 },
    async () => {
      const { perspective } = opened!;
      let held: unknown;
      await Ad4mModel.transaction(perspective, async ({ batchId }) => {
        const created = await Placed.create(perspective, { label: 'batched', node: ['toonelive://n3'] }, { batchId });
        held = created.node;
      });
      expect(held).toBe('toonelive://n3');
    },
  );
});
