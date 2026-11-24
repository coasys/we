/**
 * Adding an outcome: Enter in the "New outcome…" input does what the Add button
 * does, and while an add is running the button is disabled — a double click
 * makes one outcome, not two.
 */
import { render, waitFor } from '@solidjs/testing-library';
import { ACORN_MANIFEST, acornDatasetId, applyAcornFixture } from '@we/acorn-fixture';
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { manifestEntries } from '@we/backend-shared';
import type { SchemaNode } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import type { JSX } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

import { ACORN_PARTS, acornModule } from '../src/index.ts';

const SELF = 'did:test:acorn-self';

async function fixtureHost(create: () => Promise<unknown> = async () => ({ id: 'outcome-new' })) {
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

  const record = { create: vi.fn(create) };
  const errors: string[] = [];
  const stores = {
    ...bindings,
    $sources,
    record,
    recordStore: { updateRecordField: vi.fn(async () => {}) },
    $onError: (message: string) => errors.push(message),
    $modelsPending: () => false,
  };
  return { stores, errors, record };
}

const Passthrough = (props: { children?: JSX.Element }) => props.children;
const registry = { Column: Passthrough, Row: Passthrough };

/** The create row's input is the first we-input; the Add button carries the text "Add". */
async function createRow(container: HTMLElement) {
  return waitFor(() => {
    const input = container.querySelector('we-input') as HTMLElement;
    const button = [...container.querySelectorAll('we-button')].find((b) =>
      b.textContent?.includes('Add'),
    ) as HTMLElement;
    expect(input, 'the new-outcome input').toBeTruthy();
    expect(button, 'the Add button').toBeTruthy();
    return { input, button };
  });
}

function type(input: HTMLElement, text: string) {
  input.dispatchEvent(new CustomEvent('input', { detail: text, bubbles: true, composed: true }));
}

describe('adding an outcome — Enter and the busy lock', () => {
  it('Enter in the input adds the outcome, same as the button', async () => {
    const { stores, record } = await fixtureHost();
    const { container, unmount } = render(() => (
      <RenderSchema
        node={ACORN_PARTS.outcomeList.node as SchemaNode}
        stores={stores as never}
        registry={registry}
        context={{}}
      />
    ));
    try {
      const { input } = await createRow(container);
      type(input, 'Ship the demo');
      input.dispatchEvent(new CustomEvent('keydown', { detail: { key: 'Enter' }, bubbles: true, composed: true }));
      await waitFor(() => expect(record.create).toHaveBeenCalledWith('AcornOutcome', { content: 'Ship the demo' }));
    } finally {
      unmount();
    }
  });

  it('an Enter that confirms an IME candidate adds nothing — the next plain Enter does', async () => {
    const { stores, record } = await fixtureHost();
    const { container, unmount } = render(() => (
      <RenderSchema
        node={ACORN_PARTS.outcomeList.node as SchemaNode}
        stores={stores as never}
        registry={registry}
        context={{}}
      />
    ));
    try {
      const { input } = await createRow(container);
      type(input, 'デモ');
      input.dispatchEvent(
        new CustomEvent('keydown', { detail: { key: 'Enter', isComposing: true }, bubbles: true, composed: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(record.create).not.toHaveBeenCalled();
      input.dispatchEvent(
        new CustomEvent('keydown', { detail: { key: 'Enter', isComposing: false }, bubbles: true, composed: true }),
      );
      await waitFor(() => expect(record.create).toHaveBeenCalledWith('AcornOutcome', { content: 'デモ' }));
      expect(record.create).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it('while an add runs the button is disabled, so a double click makes one outcome', async () => {
    let release: (v: unknown) => void = () => {};
    const slow = () => new Promise((resolve) => (release = resolve));
    const { stores, record } = await fixtureHost(slow);
    const { container, unmount } = render(() => (
      <RenderSchema
        node={ACORN_PARTS.outcomeList.node as SchemaNode}
        stores={stores as never}
        registry={registry}
        context={{}}
      />
    ));
    try {
      const { input, button } = await createRow(container);
      type(input, 'One outcome');
      button.click();
      await waitFor(() => expect(record.create).toHaveBeenCalledTimes(1));
      // The add is still in flight — the button must be disabled for the second click.
      await waitFor(() => expect((button as { disabled?: boolean }).disabled).toBe(true));
      release({ id: 'outcome-new' });
      // The lock released: a fresh draft enables the button again (the cleared
      // draft alone would leave it disabled). Wait out the microtask `onFinally`
      // runs on — it clears the draft first.
      await new Promise((resolve) => setTimeout(resolve, 0));
      type(input, 'Second outcome');
      await waitFor(() => expect((button as { disabled?: boolean }).disabled).toBe(false));
    } finally {
      unmount();
    }
  });
});
