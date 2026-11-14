/**
 * The two properties everything downstream leans on: ids are deterministic, and the editor state a
 * fixture writes is the shape the renderer reads.
 *
 * Both are load-bearing rather than tidy. A screenshot script navigates straight to
 * `/channel?id=discord-general` on first load, which is only possible because that id is derived rather
 * than minted — the backend is in memory, so anything minted is different on the next load. And an
 * editor state in the wrong shape renders as a silently empty message body with a decode error
 * several frames from the cause.
 */
import { describe, expect, it } from 'vitest';

import { applyFixture, datasetIdFor, pathFor } from '../src/apply';
import { discordFixture } from '../src/discord';
import { editorState, editorStateBlocks, textBlockId } from '../src/editorState';
import type { Fixture } from '../src/types';

/** A model layer that records rather than stores — enough to see what a fixture writes. */
function recorder() {
  const writes: Array<{ model: string; data: Record<string, unknown> }> = [];
  const links: Array<[string, string]> = [];
  const getEntity = (model: string) => ({
    async create(_handle: unknown, data: Record<string, unknown>) {
      writes.push({ model, data });
      const id = (data.id as string) ?? `minted-${writes.length}`;
      return {
        id,
        async addChildren(related: unknown) {
          links.push([id, (related as { id: string }).id]);
        },
        async addSignals() {},
      };
    },
  });
  return { writes, links, getEntity };
}

const apply = async (fixture: Fixture) => {
  const { writes, links, getEntity } = recorder();
  const result = await applyFixture(
    { getEntity, dataset: {}, datasetId: datasetIdFor(fixture), sharedId: datasetIdFor(fixture) },
    fixture,
  );
  return { writes, links, result };
};

describe('deterministic ids', () => {
  it('derives the same ids on every run', async () => {
    const first = await apply(discordFixture);
    const second = await apply(discordFixture);
    expect(first.result.nodes).toEqual(second.result.nodes);
  });

  it('slugs a title, and numbers what has none', async () => {
    const { result } = await apply(discordFixture);
    expect(result.nodes.find((n) => n.title === 'general')?.id).toBe('discord-general');
    // Messages have no title, so their id comes from position within their kind.
    expect(result.nodes.filter((n) => n.kind === 'message')[0].id).toBe('discord-message-1');
  });

  it('nominates a route that names a node it actually created', async () => {
    const { result } = await apply(discordFixture);
    const path = pathFor(discordFixture);
    // No space prefix: template routes mount at the router root.
    expect(path).toBe('/channel?id=discord-general');
    expect(result.nodes.some((n) => path.endsWith(n.id))).toBe(true);
  });
});

describe('what it writes', () => {
  it('gives the space the url the template resolver matches on', async () => {
    const { writes } = await apply(discordFixture);
    const space = writes.find((w) => w.model === 'Space')!.data;
    // `resolveSpaceFromPerspective` matches a *shared* dataset by `url === sharedId` and only falls
    // back to `uuid` for a personal one. Without `url` the space renders under the default template.
    expect(space.url).toBe('preview-discord');
    expect(space.uuid).toBe('preview-discord');
    expect(space.defaultTemplateId).toBe('discord');
  });

  it('carries authorship and timestamps rather than letting them default', async () => {
    const { writes } = await apply(discordFixture);
    const messages = writes.filter((w) => w.data.kind === 'message');
    expect(messages.every((m) => typeof m.data.author === 'string')).toBe(true);
    expect(messages.every((m) => typeof m.data.createdAt === 'string')).toBe(true);
  });

  it('links each child to its container', async () => {
    const { links } = await apply(discordFixture);
    expect(links).toContainEqual(['discord-the-club', 'discord-general']);
    expect(links).toContainEqual(['discord-general', 'discord-message-1']);
  });

  it('refuses a signal slug with no matching type', async () => {
    await expect(
      apply({
        ...discordFixture,
        signalTypes: [],
        content: [{ kind: 'message', body: ['x'], signals: [{ slug: 'heart', by: ['did:x'] }] }],
      }),
    ).rejects.toThrow(/signal slug 'heart'/);
  });
});

describe('fixture epoch', () => {
  /*
    `discordFixture` declares no `createdAt` — it must write exactly what it wrote before the
    epoch existed. That contract is: a node's own `createdAt` lands as `createdAt`+`timestamp`,
    and nothing anywhere gains `updatedAt` or inherits time it did not declare — not the space,
    not the signal types, not the signals.
  */
  it('is opt-in — a fixture without `createdAt` writes exactly the old stamps', async () => {
    const { writes } = await apply(discordFixture);

    // No `updatedAt` anywhere — the pre-epoch policy never wrote one.
    for (const w of writes) expect(w.data.updatedAt).toBeUndefined();

    // The space, its signal types and its signals carried no time at all.
    for (const w of writes) {
      if (w.data.id === 'discord-space' || w.model === 'SignalType' || w.model === 'Signal') {
        expect(w.data.createdAt).toBeUndefined();
        expect(w.data.timestamp).toBeUndefined();
      }
    }
    // Signals in particular: the epoch policy stamped them with their parent's time, which is
    // precisely the drift this test exists to catch.
    expect(writes.some((w) => w.model === 'Signal')).toBe(true);

    // What a node declares still lands — `createdAt` and `timestamp`, nothing more.
    const message = writes.find((w) => w.data.id === 'discord-message-1')!.data;
    expect(message.createdAt).toBe('2026-08-11T09:14:00.000Z');
    expect(message.timestamp).toBe('2026-08-11T09:14:00.000Z');
    expect(
      Object.keys(message)
        .filter((k) => k.endsWith('At') || k === 'timestamp')
        .sort(),
    ).toEqual(['createdAt', 'timestamp']);

    // A TextBlock of the same node: the same pair and no more.
    const block = writes.find((w) => w.model === 'TextBlock')!.data;
    expect(block.createdAt).toBe('2026-08-11T09:14:00.000Z');
    expect(block.timestamp).toBe('2026-08-11T09:14:00.000Z');
    expect(block.updatedAt).toBeUndefined();
  });

  it('opts in — `createdAt` stamps all three fields, everywhere it reaches', async () => {
    const epoch = '2025-01-01T00:00:00.000Z';
    const { writes } = await apply({ ...discordFixture, createdAt: epoch });

    for (const w of writes) {
      expect(typeof w.data.createdAt).toBe('string');
      expect(w.data.timestamp).toBe(w.data.createdAt);
      expect(w.data.updatedAt).toBe(w.data.createdAt);
    }
    // A node's own `createdAt` wins; a record without one inherits the epoch.
    expect(writes.find((w) => w.data.id === 'discord-message-1')!.data.createdAt).toBe('2026-08-11T09:14:00.000Z');
    expect(writes.find((w) => w.data.id === 'discord-space')!.data.createdAt).toBe(epoch);
    expect(writes.find((w) => w.model === 'SignalType')!.data.createdAt).toBe(epoch);
    // And signals take their parent's time — epoch behaviour, off by default.
    expect(writes.find((w) => w.model === 'Signal')!.data.createdAt).toBe('2026-08-11T09:14:00.000Z');
  });

  it('keeps an author-set `updatedAt` on a record over the epoch stamp', async () => {
    const epoch = '2025-01-01T00:00:00.000Z';
    const { writes } = await apply({
      ...discordFixture,
      createdAt: epoch,
      records: [
        {
          entity: 'TaskState',
          id: 'state-1',
          createdAt: '2025-02-02T00:00:00.000Z',
          fields: { name: 'Parked', updatedAt: '2024-06-01T00:00:00.000Z' },
        },
      ],
    });
    const record = writes.find((w) => w.model === 'TaskState')!.data;
    expect(record.createdAt).toBe('2025-02-02T00:00:00.000Z');
    expect(record.updatedAt).toBe('2024-06-01T00:00:00.000Z');
  });
});

describe('editor state', () => {
  it('is a data URL the renderer can decode, in Portable Text shape', () => {
    const url = editorState(['One.', 'Two.'], 'post-1');
    expect(url.startsWith('data:application/json;base64,')).toBe(true);

    const decoded = JSON.parse(atob(url.split(';base64,')[1]));
    expect(decoded).toEqual(editorStateBlocks(['One.', 'Two.'], 'post-1'));
    expect(Array.isArray(decoded)).toBe(true);
    expect(decoded).toHaveLength(2);
    // Canonical text beside the derived span, and keys that match the TextBlock models written.
    expect(decoded[0]._type).toBe('block');
    expect(decoded[0].text).toBe('One.');
    expect(decoded[0].children[0].text).toBe('One.');
    expect(decoded[0]._key).toBe(textBlockId('post-1', 0));
  });

  it('encodes UTF-8 the way the app does, and the app decodes it back exactly', () => {
    // `createBlocks` writes base64 of the UTF-8 bytes; `decodeEditorState` reads it with a
    // TextDecoder. A bare `atob` — what the app used to do — yields Latin-1 mojibake, which is why
    // fixture bodies were kept ASCII for a while. They need not be any more.
    const bytes = atob(editorState(['Sørensen']).split(';base64,')[1]);
    const utf8 = new TextDecoder().decode(Uint8Array.from(bytes, (c) => c.charCodeAt(0)));
    expect(JSON.parse(utf8)[0].text).toBe('Sørensen');
  });
});
