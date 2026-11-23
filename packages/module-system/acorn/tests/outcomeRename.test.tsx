/**
 * Renaming an outcome in the list: the content field commits on `change`, and a
 * change that holds only whitespace is not a rename — saving it would blank the
 * outcome's title. The write must not run at all, so the old content stays.
 */
import { render, waitFor } from '@solidjs/testing-library';
import { acornDatasetId, applyAcornFixture } from '@we/acorn-fixture';
import { ACORN_MANIFEST } from '@we/acorn-fixture';
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { manifestEntries } from '@we/backend-shared';
import type { SchemaNode } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import type { JSX } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

import { ACORN_PARTS, acornModule } from '../src/index.ts';

const SELF = 'did:test:acorn-self';

async function fixtureHost() {
  const ports = createInMemoryBackendPorts(
    { selfId: () => SELF },
    { datasets: [{ id: acornDatasetId, name: 'Acorn fixture' }] },
  );
  await applyAcornFixture(ports);
  const dataset = await ports.lifecycle.get(acornDatasetId);
  if (!dataset) throw new Error('fixture dataset missing after apply');

  const bindings = ports.dataBindings({
    currentDataset: () => dataset.handle,
    currentDatasetEntities: () => manifestEntries(ACORN_MANIFEST),
    profiles: () => [],
    fetchProfile: () => {},
    ephemeral: ports.ephemeral,
  });

  const $sources: Record<string, (options: unknown) => unknown> = {};
  for (const fn of acornModule.contributes?.functions ?? []) {
    $sources[fn.name] = fn.fn as (options: unknown) => unknown;
  }

  const recordStore = { updateRecordField: vi.fn(async () => {}) };
  const record = { create: vi.fn(async () => ({ id: 'outcome-new' })) };
  const errors: string[] = [];
  const stores = {
    ...bindings,
    $sources,
    record,
    recordStore,
    $onError: (message: string) => errors.push(message),
    $modelsPending: () => false,
  };
  return { stores, errors, record, recordStore };
}

const Passthrough = (props: { children?: JSX.Element }) => props.children;
const registry = { Column: Passthrough, Row: Passthrough };

describe('renaming an outcome — whitespace is not a rename', () => {
  it('a change holding only whitespace does not save; a real change does', async () => {
    const { stores, recordStore, errors } = await fixtureHost();
    const { container, unmount } = render(() => (
      <RenderSchema
        node={ACORN_PARTS.outcomeList.node as SchemaNode}
        stores={stores as never}
        registry={registry}
        context={{}}
      />
    ));
    try {
      // The first outcome row's content input is the second we-input — the create row's is first.
      const inputs = await waitFor(() => {
        const found = container.querySelectorAll('we-input');
        expect(found.length).toBeGreaterThan(1);
        return found;
      });
      const content = inputs[1] as HTMLElement;

      content.dispatchEvent(new CustomEvent('change', { detail: '   ' }));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(recordStore.updateRecordField).not.toHaveBeenCalled();

      content.dispatchEvent(new CustomEvent('change', { detail: 'Renamed outcome' }));
      await waitFor(() =>
        expect(recordStore.updateRecordField).toHaveBeenCalledWith(
          'AcornOutcome',
          expect.anything(),
          'content',
          'Renamed outcome',
        ),
      );
      expect(errors).toEqual([]);
    } finally {
      unmount();
    }
  });
});
