/**
 * The two properties everything downstream leans on: ids are deterministic, and the editor state a
 * fixture writes is the shape the renderer reads.
 *
 * Both are load-bearing rather than tidy. A screenshot script navigates straight to
 * `/channel/discord-general` on first load, which is only possible because that id is derived rather
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
    expect(path).toBe('/channel/discord-general');
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
