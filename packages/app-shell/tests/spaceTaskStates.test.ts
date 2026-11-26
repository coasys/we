/**
 * The space store's task-states part: the space's states read live, one per slug, in the community's
 * order; naming, retiring and reordering them; what the record layer is offered; and who may change
 * how tasks move.
 *
 * Run once under each reactivity port, against the in-memory backend.
 */
import { Space, TaskState } from '@we/entities';
import type { Setter } from '@we/reactivity';
import { afterEach, describe, expect, it } from 'vitest';

import { createSpaceList, type SpaceList } from '../src/shared/stores/space/spaces';
import { createSpaceTaskStates, type SpaceTaskStates } from '../src/shared/stores/space/taskStates';
import { createSpaceWrites } from '../src/shared/stores/space/writes';
import { createTaskWorkflowLive } from '../src/shared/taskWorkflowLive';
import { flush, reactivityPorts, type SpaceHarness, spaceHarness } from './support/spaceParts';

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  interface Built {
    h: SpaceHarness;
    spaces: SpaceList;
    states: SpaceTaskStates;
    setOnScreen: Setter<Space | null>;
    admin: { yes: boolean };
    boardColumns: string[];
    vocabulary: () => ((name: string) => string[] | undefined) | null;
  }

  async function build(): Promise<Built> {
    const h = await spaceHarness(makePort(), [
      { id: 'ds-a', name: 'Allotment' },
      { id: 'ds-b', name: 'Bakery' },
    ]);
    for (const id of ['ds-a', 'ds-b']) {
      await Space.create((await h.datasets.get(id)).handle, { uuid: id, name: `Space ${id}` });
    }
    const { reactivity } = h;
    const admin = { yes: true };
    const boardColumns: string[] = [];
    let vocabularies: ((name: string) => string[] | undefined) | null = null;
    let spaces!: SpaceList;
    let states!: SpaceTaskStates;
    let setOnScreen!: Setter<Space | null>;
    disposers.push(
      reactivity.root(() => {
        const [onScreen, writeOnScreen] = reactivity.signal<Space | null>(null);
        setOnScreen = writeOnScreen;
        spaces = createSpaceList({
          ...h.ctx,
          routeStore: { segments: () => [], navigate: () => {} },
          templateStore: { appTemplate: () => null, preloadSpaceTemplates: () => Promise.resolve() } as never,
          shapeStore: { addRecordTypes: () => Promise.resolve([]) } as never,
          newSpace: {
            enableView: () => Promise.resolve(),
            writeAdminGrant: () => Promise.resolve(),
            writeStartingPolicy: () => Promise.resolve(),
          },
        });
        const writes = createSpaceWrites({ ...h.ctx, spaces, onScreen: { current: onScreen, show: () => {} } });
        states = createSpaceTaskStates({
          ...h.ctx,
          recordStore: {
            provideVocabularies: (resolve) => {
              vocabularies = resolve;
              return () => (vocabularies = null);
            },
          },
          navigation: { members: { currentSpace: onScreen }, pushedOnScreen: () => false },
          writes,
          canAdministerCurrentSpace: () => admin.yes,
          taskWorkflowLive: createTaskWorkflowLive(reactivity.signal),
          addStateToSpaceBoard: (slug) => {
            boardColumns.push(slug);
            return Promise.resolve();
          },
        });
      }),
    );
    await spaces.members.loadSpaces();
    return { h, spaces, states, setOnScreen, admin, boardColumns, vocabulary: () => vocabularies };
  }

  async function enter(built: Built, id: string) {
    built.h.datasets.show(id);
    built.setOnScreen(built.spaces.heldSpace(await built.h.datasets.get(id))!);
    await flush();
  }

  it('reads the space’s states, ordered by what each counts as', async () => {
    const built = await build();
    const handle = (await built.h.datasets.get('ds-a')).handle;
    await TaskState.create(handle, { name: 'Done', slug: 'done', semantic: 'done' });
    await TaskState.create(handle, { name: 'To do', slug: 'todo', semantic: 'open' });
    await enter(built, 'ds-a');
    const { members } = built.states;
    expect(members.taskStatesLoaded()).toBe(true);
    expect(members.taskStates().map((s) => [s.slug, s.name])).toEqual([
      ['todo', 'To do'],
      ['done', 'Done'],
    ]);
  });

  it('follows a state somebody else names, and forgets them all in another space', async () => {
    const built = await build();
    await enter(built, 'ds-a');
    expect(built.states.members.taskStates()).toEqual([]);
    await TaskState.create((await built.h.datasets.get('ds-a')).handle, {
      name: 'Blocked',
      slug: 'blocked',
      semantic: 'blocked',
    });
    await flush();
    expect(built.states.members.taskStates().map((s) => s.slug)).toEqual(['blocked']);
    await enter(built, 'ds-b');
    expect(built.states.members.taskStates()).toEqual([]);
    expect(built.states.members.taskStatesLoaded()).toBe(true);
  });

  it('names a state, gives the space’s board its column, and refuses a name it has', async () => {
    const built = await build();
    await enter(built, 'ds-a');
    await built.states.members.createTaskState({ name: 'Doing', semantic: 'active' });
    expect(built.states.members.taskStates().map((s) => s.slug)).toEqual(['doing']);
    expect(built.boardColumns).toEqual(['doing']);
    await built.states.members.createTaskState({ name: 'Doing' });
    expect(built.h.toasts.said.length).toBe(1);
    expect(built.boardColumns).toEqual(['doing']);
  });

  it('offers the record layer the states in use, and not a retired one', async () => {
    const built = await build();
    await enter(built, 'ds-a');
    await built.states.members.createTaskState({ name: 'To do', semantic: 'open' });
    await built.states.members.createTaskState({ name: 'Parked', semantic: 'blocked' });
    expect(built.vocabulary()?.('taskState')).toEqual(['to-do', 'parked']);
    expect(built.vocabulary()?.('somethingElse')).toBeUndefined();
    await built.states.members.setTaskStateRetired('parked', true);
    expect(built.states.members.offeredTaskStates().map((s) => s.slug)).toEqual(['to-do']);
    expect(built.vocabulary()?.('taskState')).toEqual(['to-do']);
    expect(built.states.members.taskStates().map((s) => s.slug)).toEqual(['to-do', 'parked']);
  });

  it('shows a new order at once and keeps what the backend stored', async () => {
    const built = await build();
    await enter(built, 'ds-a');
    await built.states.members.createTaskState({ name: 'To do', semantic: 'open' });
    await built.states.members.createTaskState({ name: 'Done', semantic: 'done' });
    const reordering = built.states.members.reorderTaskStates(['done', 'to-do']);
    expect(built.states.members.taskStates().map((s) => s.slug)).toEqual(['done', 'to-do']);
    await reordering;
    await flush();
    expect(built.states.members.taskStates().map((s) => s.slug)).toEqual(['done', 'to-do']);
  });

  it('lets only whoever administers the space change how tasks move', async () => {
    const built = await build();
    await enter(built, 'ds-a');
    built.admin.yes = false;
    await expect(built.states.members.setTaskWorkflowRule('next')).rejects.toThrow(/administers/);
    await expect(built.states.members.setWorkflowArchived('review', true)).rejects.toThrow(/administers/);
    expect(built.states.members.taskWorkflowEnabled()).toBe(false);
  });
});
