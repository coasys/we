/**
 * The priority list, offline (S2-7): the fixture's project meta and its one top-priority outcome
 * in `@we/backend-inmemory`, the `acorn.priorityList` part drawn by the real renderer. Every
 * change — add, remove, reorder — is a whole-list replace of `AcornProjectMeta.topPriorityOutcomes`
 * through `record.update`, run the way `TemplateProvider`'s `recordActions` runs it and read back
 * from the backend. The rig suite proves the same write reaches stock's project meta.
 */
import { fireEvent, render, waitFor } from '@solidjs/testing-library';
import { ACORN_MANIFEST, acornDatasetId, applyAcornFixture } from '@we/acorn-fixture';
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { manifestEntries } from '@we/backend-shared';
import { getEntityForDataset } from '@we/entities';
import { RenderSchema } from '@we/schema-solid';
import type { JSX } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { ACORN_PARTS, acornModule } from '../src/index.ts';

const SELF = 'did:test:acorn-self';

const FIRST = 'Acorn runs as a WE template'; // acorn-outcome-1, the fixture's one priority
const SECOND = 'Shell boots on the in-memory backend'; // acorn-outcome-2
const THIRD = 'Outcome list reads live mounted records'; // acorn-outcome-3

async function fixtureHost() {
  const ports = createInMemoryBackendPorts(
    { selfId: () => SELF },
    { datasets: [{ id: acornDatasetId, name: 'Acorn fixture' }] },
  );
  await applyAcornFixture(ports);
  const dataset = await ports.lifecycle.get(acornDatasetId);
  if (!dataset) throw new Error('fixture dataset missing after apply');
  const handle = dataset.handle;

  const bindings = ports.dataBindings({
    currentDataset: () => handle,
    currentDatasetEntities: () => manifestEntries(ACORN_MANIFEST),
    profiles: () => [],
    fetchProfile: () => {},
    ephemeral: ports.ephemeral,
  });

  const $sources: Record<string, (options: unknown) => unknown> = {};
  for (const fn of acornModule.contributes?.functions ?? []) {
    $sources[fn.name] = fn.fn as (options: unknown) => unknown;
  }

  const entity = (name: string) => {
    const cls = getEntityForDataset(name, handle);
    if (!cls) throw new Error(`no ${name} class on the fixture dataset`);
    return cls;
  };
  // `record.update` as `TemplateProvider`'s `recordActions.update` runs it: the dataset's class.
  const writes: Array<{ entity: string; id: string; fields: Record<string, unknown> }> = [];
  const record = {
    update: (name: string, id: string, fields: Record<string, unknown>) => {
      writes.push({ entity: name, id, fields });
      return entity(name).update(handle, id, fields);
    },
  };
  /** The meta's priority list as stored — ids, in order. */
  const priorities = async () => {
    const [meta] = (await entity('AcornProjectMeta').findAll(handle, {})) as Array<{
      topPriorityOutcomes?: Array<{ id: string } | string>;
    }>;
    return (meta?.topPriorityOutcomes ?? []).map((p) => (typeof p === 'string' ? p : p.id));
  };

  const errors: string[] = [];
  const stores = {
    ...bindings,
    record,
    $sources,
    $onError: (message: string) => errors.push(message),
    $modelsPending: () => false,
  };
  return { stores, errors, writes, priorities };
}

const Passthrough = (props: { children?: JSX.Element }) => props.children;
const registry = { Column: Passthrough, Row: Passthrough };

const buttonNamed = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll('we-button')].find((b) => (b.textContent ?? '').trim() === label) as
    HTMLElement | undefined;

async function drawList() {
  const host = await fixtureHost();
  const view = render(() => (
    <RenderSchema node={ACORN_PARTS.priorityList.node} stores={host.stores as never} registry={registry} context={{}} />
  ));
  await waitFor(() => expect(buttonNamed(view.container, `Prioritise ${SECOND}`)).toBeTruthy());
  return { ...host, ...view };
}

/** The ranked rows' contents, top first — read off the sortable's carriers. */
const ranked = (root: HTMLElement) =>
  [...root.querySelectorAll('we-sortable [data-we-id]')].map((row) => row.getAttribute('data-we-id'));

describe('the priority list', () => {
  it("draws the meta's priorities in order, and every other outcome to add", async () => {
    const { container, unmount, errors } = await drawList();
    try {
      await waitFor(() => expect(ranked(container)).toEqual(['acorn-outcome-1']));
      expect(container.querySelector('we-sortable')?.textContent).toContain(FIRST);
      expect(buttonNamed(container, `Prioritise ${FIRST}`)).toBeUndefined();
      expect(buttonNamed(container, `Prioritise ${THIRD}`)).toBeTruthy();
      expect(errors).toEqual([]);
    } finally {
      unmount();
    }
  });

  it('prioritise appends to the end — one whole-list replace', async () => {
    const { container, unmount, writes, priorities } = await drawList();
    try {
      fireEvent.click(buttonNamed(container, `Prioritise ${THIRD}`)!);
      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0]).toEqual({
        entity: 'AcornProjectMeta',
        id: 'acorn-project-meta',
        fields: { topPriorityOutcomes: ['acorn-outcome-1', 'acorn-outcome-3'] },
      });
      await waitFor(async () => expect(await priorities()).toEqual(['acorn-outcome-1', 'acorn-outcome-3']));
      await waitFor(() => expect(ranked(container)).toEqual(['acorn-outcome-1', 'acorn-outcome-3']));
      expect(buttonNamed(container, `Prioritise ${THIRD}`)).toBeUndefined();
    } finally {
      unmount();
    }
  });

  it('a reorder writes the order the sortable reports', async () => {
    const { container, unmount, writes, priorities } = await drawList();
    try {
      fireEvent.click(buttonNamed(container, `Prioritise ${SECOND}`)!);
      await waitFor(() => expect(ranked(container)).toEqual(['acorn-outcome-1', 'acorn-outcome-2']));
      // What `we-sortable` dispatches on a drop: `reorder`, the zone's ids in their new order.
      container
        .querySelector('we-sortable')!
        .dispatchEvent(new CustomEvent('reorder', { detail: ['acorn-outcome-2', 'acorn-outcome-1'], bubbles: true }));
      await waitFor(() => expect(writes).toHaveLength(2));
      expect(writes[1].fields).toEqual({ topPriorityOutcomes: ['acorn-outcome-2', 'acorn-outcome-1'] });
      await waitFor(async () => expect(await priorities()).toEqual(['acorn-outcome-2', 'acorn-outcome-1']));
      await waitFor(() => expect(ranked(container)).toEqual(['acorn-outcome-2', 'acorn-outcome-1']));
    } finally {
      unmount();
    }
  });

  it('remove drops one and keeps the rest in order; an empty list says so', async () => {
    const { container, unmount, writes, priorities } = await drawList();
    try {
      fireEvent.click(buttonNamed(container, `Remove ${FIRST} from priority`)!);
      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0].fields).toEqual({ topPriorityOutcomes: [] });
      await waitFor(async () => expect(await priorities()).toEqual([]));
      await waitFor(() => expect(container.textContent).toContain('Nothing is a priority yet'));
      expect(buttonNamed(container, `Prioritise ${FIRST}`)).toBeTruthy();
    } finally {
      unmount();
    }
  });
});
