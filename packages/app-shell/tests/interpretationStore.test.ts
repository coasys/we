/**
 * What extraction is doing in the space on screen: this node's passes and their progress, the
 * suggestions-changed signal modules re-read on, and the first-screen gate the reads wait behind.
 *
 * A plain store test, run once under each reactivity port. The gate is one of the port's own, built
 * per test, rather than the app's, so a held gate in one case says nothing to the next.
 */
import type { InterpretationActivity } from '@we/backend-shared';
import type { ReactivityPort } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { solidReactivity } from '@we/reactivity-solid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFirstScreen, type FirstScreen } from '../src/shared/firstScreen';
import type { ModuleHostServices } from '../src/shared/registries/moduleHostServices';

let published: ModuleHostServices = {};
vi.mock('../src/shared/registries/moduleHostServices', () => ({
  provideModuleHostServices: (slice: ModuleHostServices) => {
    published = { ...published, ...slice };
    return () => {};
  },
}));

import { createInterpretationStore, type InterpretationStore } from '../src/shared/stores/InterpretationStore';

const ports: [string, () => ReactivityPort][] = [
  ['Solid', () => solidReactivity],
  ['the test port', createTestReactivity],
];

const ME = 'did:key:z6MkOwn';

describe.each(ports)('interpretationStore, under %s', (_name, makePort) => {
  let port: ReactivityPort;
  const disposers: (() => void)[] = [];

  function setUp(options: { held?: boolean; capable?: boolean } = {}) {
    let report: (activity: InterpretationActivity) => void = () => {};
    let proposalsChanged: () => void = () => {};
    const interpretation = {
      checkAvailability: vi.fn(async () => options.capable ?? true),
      observe: vi.fn(async (_handle: unknown, onActivity: (activity: InterpretationActivity) => void) => {
        report = onActivity;
        return () => {};
      }),
      onProposalsChanged: vi.fn(async (_handle: unknown, onChange: () => void) => {
        proposalsChanged = onChange;
        return () => {};
      }),
    };
    // One object for the session's life, as the session holds it: a new one is a new connection.
    const backendPorts = { interpretation } as never;
    const [current, setCurrent] = port.signal<{ handle: never } | null>({ handle: 'space-a' as never });
    const firstScreen: FirstScreen = createFirstScreen({ signal: port.signal });
    if (options.held) {
      firstScreen.hold();
      firstScreen.waiting();
    }
    let store!: InterpretationStore;
    disposers.push(
      port.root(() => {
        store = createInterpretationStore({
          reactivity: port,
          firstScreen,
          sessionStore: { backendPorts: () => backendPorts, me: () => ({ did: ME }) },
          datasetStore: { currentDataset: current },
          profileStore: { fetchProfile: async () => undefined, profiles: () => [] },
          spaceStore: { autoInterpret: () => false, autoInterpretFor: () => false },
        });
      }),
    );
    return {
      store,
      interpretation,
      firstScreen,
      setCurrent,
      report: (activity: Partial<InterpretationActivity>) =>
        report({ passId: 'p1', mine: true, phase: 'thinking', at: Date.now(), ...activity } as InterpretationActivity),
      proposalsChanged: () => proposalsChanged(),
    };
  }

  beforeEach(() => {
    port = makePort();
    published = {};
  });
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    vi.useRealTimers();
  });

  /*
    `proposalsRevision` tells a module "the suggestions may have moved, ask again", and the Feed reads
    a move as a change to its window. Bumped when the store merely started later, it made the Feed read
    its whole window a second time the moment the first page was drawn.
  */
  it('starts once the first page is drawn, without telling modules the suggestions moved', async () => {
    const h = setUp({ held: true });
    expect(h.interpretation.checkAvailability).not.toHaveBeenCalled();
    const revision = published.interpretationProposalsRevision?.();

    h.firstScreen.answered();
    await vi.waitFor(() => expect(h.interpretation.checkAvailability).toHaveBeenCalledTimes(1));
    expect(h.interpretation.onProposalsChanged).toHaveBeenCalledTimes(1);
    expect(published.interpretationProposalsRevision?.()).toBe(revision);
  });

  it('shows this node’s pass as it runs and as it settles, in words', async () => {
    const h = setUp();
    await vi.waitFor(() => expect(h.interpretation.observe).toHaveBeenCalled());
    h.report({ phase: 'thinking', runner: ME });
    expect(h.store.runningCount()).toBe(1);
    expect(h.store.activity()[0]).toMatchObject({ label: 'You are waiting on the model', running: true, mine: true });

    h.report({ phase: 'done', runner: ME, ids: ['a', 'b'] });
    expect(h.store.runningCount()).toBe(0);
    expect(h.store.settledPasses()[0]).toMatchObject({ label: 'Found 2 records', elapsed: '' });
  });

  it('indents the exchange when it is JSON, and leaves it alone when it is not', async () => {
    const h = setUp();
    await vi.waitFor(() => expect(h.interpretation.observe).toHaveBeenCalled());
    h.report({ phase: 'done', llm: { prompt: '{"a":1}', response: 'not json' } } as never);
    expect(h.store.activity()[0]).toMatchObject({ prompt: '{\n  "a": 1\n}', response: 'not json', hasDetail: true });
  });

  it('forgets settled rows when asked, and keeps the running ones', async () => {
    const h = setUp();
    await vi.waitFor(() => expect(h.interpretation.observe).toHaveBeenCalled());
    h.report({ passId: 'p1', phase: 'done' });
    h.report({ passId: 'p2', phase: 'thinking' });
    h.store.dismissSettled();
    expect(h.store.activity().map((row) => row.passId)).toEqual(['p2']);
    expect(h.store.hasActivity()).toBe(true);
  });

  it('says when this node cannot interpret, and starts optimistic again in another space', async () => {
    const h = setUp({ capable: false });
    await vi.waitFor(() => expect(h.store.capable()).toBe(false));
    h.interpretation.checkAvailability.mockResolvedValue(true);
    h.setCurrent({ handle: 'space-b' as never });
    expect(h.store.capable()).toBe(true);
  });

  it('tells modules the suggestions moved once for a burst, and again for a new space', async () => {
    const h = setUp();
    await vi.waitFor(() => expect(h.interpretation.onProposalsChanged).toHaveBeenCalled());
    const before = published.interpretationProposalsRevision!();
    vi.useFakeTimers();
    h.proposalsChanged();
    h.proposalsChanged();
    h.proposalsChanged();
    vi.advanceTimersByTime(250);
    expect(published.interpretationProposalsRevision!()).toBe(before + 1);
    vi.useRealTimers();

    h.setCurrent({ handle: 'space-b' as never });
    expect(published.interpretationProposalsRevision!()).toBe(before + 2);
  });
});
