/**
 * The space store's call-exports part: a call's transcript as text and its interpretation log as
 * Markdown, each named before anything is gathered, each person labelled by name where a profile is
 * known and by DID where none is, and what each save came to said once.
 *
 * The part reads no reactive state of its own; it runs under each reactivity port all the same, so the
 * profiles it labels with are the port's signals, against the in-memory backend.
 */
import { provideFileSaver } from '@we/design-utils';
import { CollectionBlock, getEntity, TextBlock } from '@we/entities';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCallExports } from '../src/shared/stores/space/callExports';
import { reactivityPorts } from './support/engines';
import { ME, type SpaceHarness, spaceHarness } from './support/spaceParts';

const SOMEBODY = 'did:key:z6MkSomebodyElse';
const later = () => new Promise((resolve) => setTimeout(resolve, 5));

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    vi.restoreAllMocks();
  });

  interface Built {
    h: SpaceHarness;
    exports: ReturnType<typeof createCallExports>;
    saved: { name: string; type: string; text: string }[];
    fetched: string[];
    answer: { save: boolean };
    meta: { calls: number };
  }

  async function build(options: { dataset?: boolean } = {}): Promise<Built> {
    const h = await spaceHarness(makePort(), [{ id: 'ds-a', name: 'Allotment' }]);
    const handle = (await h.datasets.get('ds-a')).handle;
    const [profiles, setProfiles] = h.reactivity.signal<{ did: string; firstName: string }[]>([]);
    const fetched: string[] = [];
    const saved: Built['saved'] = [];
    const answer = { save: true };
    const meta = { calls: 0 };
    disposers.push(
      provideFileSaver(async (file) => {
        saved.push({ name: file.name, type: file.type, text: new TextDecoder().decode(file.bytes) });
        return answer.save;
      }),
    );
    const exports = createCallExports({
      toasts: h.ctx.toasts,
      dataset: () => (options.dataset === false ? null : { handle }),
      interpretation: () => undefined,
      profileStore: {
        // Only Anna has a profile, and it arrives when asked for — as the cache fills on a fetch.
        fetchProfile: (did: string) => {
          fetched.push(did);
          if (did === SOMEBODY) setProfiles([{ did: SOMEBODY, firstName: 'Anna' }]);
          return Promise.resolve(undefined);
        },
        profiles,
      } as never,
      exportMeta: () => {
        meta.calls += 1;
        return Promise.resolve({ spaceName: 'The Allotment', spaceTargets: ['TaskBlock'], auto: true, classes: [] });
      },
    });
    return { h, exports, saved, fetched, answer, meta };
  }

  /** A call with a line from each of two people, the second said first, and one line nobody said. */
  async function callWithLines(h: SpaceHarness) {
    const handle = (await h.datasets.get('ds-a')).handle;
    const first = await h.as(SOMEBODY, () =>
      TextBlock.create(handle, { text: 'Shall we plant the beans?', source: 'spoken' }),
    );
    await later();
    const second = await TextBlock.create(handle, { text: 'Yes, on Friday.', source: 'typed' });
    const unsaid = await TextBlock.create(handle, { text: 'A summary nobody spoke.', source: '' });
    const call = await CollectionBlock.create(handle, {
      kind: 'call',
      title: 'Planting',
      children: [second.id, first.id, unsaid.id],
    });
    return { handle, call: call.id };
  }

  it('exports a call’s lines in the order they were said, each by name or by DID, and says it did', async () => {
    const { h, exports, saved, fetched } = await build();
    const { call } = await callWithLines(h);
    await exports.exportCallTranscript(call);
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toMatch(/^planting.*\.txt$/i);
    expect(saved[0].type).toBe('text/plain;charset=utf-8');
    const lines = saved[0].text.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Anna');
    expect(lines[0]).toContain('Shall we plant the beans?');
    // No profile for this agent: the DID, never "Anonymous", since in a file the label is all there is.
    expect(lines[1]).toContain(ME);
    expect(lines[1]).toContain('Yes, on Friday.');
    expect(new Set(fetched)).toEqual(new Set([SOMEBODY, ME]));
    expect(h.toasts.said).toEqual(['success: Transcript exported.']);
  });

  it('writes nothing for a call with no lines, and says why', async () => {
    const { h, exports, saved } = await build();
    const handle = (await h.datasets.get('ds-a')).handle;
    const call = await CollectionBlock.create(handle, { kind: 'call', title: 'Quiet' });
    await exports.exportCallTranscript(call.id);
    expect(saved).toEqual([]);
    expect(h.toasts.said).toEqual(['warning: This call has no transcript to export.']);
  });

  it('says nothing when the save is cancelled', async () => {
    const { h, exports, answer } = await build();
    const { call } = await callWithLines(h);
    answer.save = false;
    await exports.exportCallTranscript(call);
    expect(h.toasts.said).toEqual([]);
  });

  it('does nothing outside a space or for no call', async () => {
    const { h, exports, saved } = await build({ dataset: false });
    await exports.exportCallTranscript('call-1');
    await exports.exportInterpretationLog('call-1');
    const inside = await build();
    await inside.exports.exportCallTranscript('');
    expect([...saved, ...inside.saved]).toEqual([]);
    expect([...h.toasts.said, ...inside.h.toasts.said]).toEqual([]);
  });

  it('tells the person when the call cannot be read', async () => {
    const { h, exports } = await build();
    vi.spyOn(
      getEntity('CollectionBlock') as unknown as { findOne: () => Promise<unknown> },
      'findOne',
    ).mockRejectedValue(new Error('backend unreachable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await exports.exportCallTranscript('call-1');
    await exports.exportInterpretationLog('call-1');
    expect(h.toasts.said).toEqual([
      'error: Could not export the transcript.',
      'error: Could not export the interpretation log.',
    ]);
  });

  it('writes no log for a call nothing has interpreted, without reading the space’s answers to head it', async () => {
    const { h, exports, saved } = await build();
    const { call } = await callWithLines(h);
    await exports.exportInterpretationLog(call);
    expect(saved).toEqual([]);
    expect(h.toasts.said).toEqual(['warning: No interpretation has run on this call yet.']);
  });

  it('exports what interpretation did with a call as Markdown, headed by the space’s answers', async () => {
    const { h, exports, saved, meta } = await build();
    const { handle, call } = await callWithLines(h);
    const run = await h.as(SOMEBODY, () =>
      (getEntity('ModelRun') as unknown as { create: (p: unknown, d: object) => Promise<{ id: string }> }).create(
        handle,
        { kind: 'extraction', model: 'small-model', prompt: 'Find the tasks', output: '[]' },
      ),
    );
    await CollectionBlock.update(handle, call, { runs: [run.id] } as never);
    await exports.exportInterpretationLog(call);
    expect(meta.calls).toBe(1);
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toMatch(/-interpretation-log\.md$/);
    expect(saved[0].type).toBe('text/markdown;charset=utf-8');
    expect(saved[0].text).toContain('The Allotment');
    expect(saved[0].text).toContain('Find the tasks');
    expect(saved[0].text).toContain('Anna');
    expect(h.toasts.said).toEqual(['success: Interpretation log exported.']);
  });
});
