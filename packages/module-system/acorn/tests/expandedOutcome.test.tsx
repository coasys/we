/**
 * The expanded outcome, offline: the outcome list over the Acorn fixture in
 * `@we/backend-inmemory`, an outcome opened from its row, read and edited — every write going
 * through `record.update` the way `TemplateProvider`'s `recordActions` runs it (the entity class
 * the dataset registers, `.update(dataset, id, fields)`), then read back from the backend, not
 * from the DOM. The same class's `.update` is what dispatches to the mount's `update` call on the
 * AD4M host; that half is the live suite's (`apps/we-web/tests/live/acorn.live.mjs`).
 */
import { fireEvent, render, waitFor } from '@solidjs/testing-library';
import { ACORN_MANIFEST, acornDatasetId, applyAcornFixture } from '@we/acorn-fixture';
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { manifestEntries } from '@we/backend-shared';
import { getEntityForDataset } from '@we/entities';
import type { SchemaNode } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import type { JSX } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { ACORN_PARTS, acornModule } from '../src/index.ts';

const SELF = 'did:test:acorn-self';

const BIG = 'Acorn runs as a WE template'; // acorn-outcome-1: description, tag `frontend`
const SMALL = 'Shell boots on the in-memory backend'; // acorn-outcome-2: Small, Achieved, no description
const UNCERTAIN = 'Outcome list reads live mounted records'; // acorn-outcome-3: Uncertain, a time frame

/** `resolveParts`, for the acorn parts only — a `$part` stands in for its node, recursively. */
function expandParts(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(expandParts);
  const record = node as SchemaNode;
  if (record.type === '$part') {
    const id = (record.props as { id?: unknown } | undefined)?.id;
    const part = typeof id === 'string' ? ACORN_PARTS[id.split('.')[1]] : undefined;
    if (!part) throw new Error(`$part "${String(id)}" names no acorn part`);
    return expandParts(part.node);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    // Every value, as `resolveParts` walks props too: `$if`'s branches live there.
    out[key] = expandParts(value);
  }
  return out;
}

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
  const read = async (id: string) =>
    (await entity('AcornOutcome').findOne(handle, { where: { id } })) as Record<string, unknown> | null;

  const errors: string[] = [];
  const stores = {
    ...bindings,
    record,
    $sources,
    $onError: (message: string) => errors.push(message),
    $modelsPending: () => false,
  };
  return { stores, errors, writes, read };
}

const Passthrough = (props: { children?: JSX.Element }) => props.children;
const registry = { Column: Passthrough, Row: Passthrough };

const buttonNamed = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll('we-button')].find((b) => (b.textContent ?? '').trim() === label) as
    HTMLElement | undefined;

/** The dialog the list opens — the only `we-modal` it draws. */
const dialog = (root: HTMLElement) => root.querySelector('we-modal') as HTMLElement | null;

async function openList() {
  const host = await fixtureHost();
  const view = render(() => (
    <RenderSchema
      node={expandParts(ACORN_PARTS.outcomeList.node) as SchemaNode}
      stores={host.stores as never}
      registry={registry}
      context={{}}
    />
  ));
  await waitFor(() => expect(buttonNamed(view.container, `Open ${BIG}`)).toBeTruthy());
  return { ...host, ...view };
}

async function open(container: HTMLElement, content: string) {
  fireEvent.click(buttonNamed(container, `Open ${content}`)!);
  await waitFor(() => expect(dialog(container)?.textContent).toContain(content));
  return dialog(container)!;
}

/**
 * What a `we-input`/`we-textarea` dispatches as a person types: `input`, the value as detail —
 * bubbling and composed as the primitive's own is, since Solid delegates `input` at the document.
 */
const type = (el: Element, value: string) =>
  el.dispatchEvent(new CustomEvent('input', { detail: value, bubbles: true, composed: true }));
/** What a `we-select` dispatches on a pick: `change`, the option's value as detail. */
const pick = (el: Element, value: string) =>
  el.dispatchEvent(new CustomEvent('change', { detail: value, bubbles: true, composed: true }));

/** A field by its `label` — a property the renderer assigns, not an attribute a selector can see. */
const labelled = (root: HTMLElement, tag: string, label: string) =>
  [...root.querySelectorAll(tag)].find((el) => (el as unknown as { label?: string }).label === label);
const selectLabelled = (root: HTMLElement, label: string) => labelled(root, 'we-select', label);
const titleField = (root: HTMLElement) => labelled(root, 'we-input', 'Title');
const descriptionField = (root: HTMLElement) => labelled(root, 'we-textarea', 'Description');

describe('the expanded outcome', () => {
  it('opens from the list and shows the record — title, description, scope, tags', async () => {
    const { container, unmount, errors } = await openList();
    try {
      expect(dialog(container)).toBeNull();
      const modal = await open(container, BIG);
      expect(modal.textContent).toContain('The vertical slice: shell, project list, live outcome list.');
      // The tag arrives through `include: { tags: true }` as an AcornTag record, drawn by name.
      await waitFor(() => expect(modal.querySelector('we-tag')?.textContent).toContain('frontend'));
      expect(buttonNamed(modal, 'Edit outcome')).toBeTruthy();
      expect(errors).toEqual([]);
    } finally {
      unmount();
    }
  });

  it('says so when an outcome has no description', async () => {
    const { container, unmount } = await openList();
    try {
      const modal = await open(container, SMALL);
      expect(modal.textContent).toContain('No description');
    } finally {
      unmount();
    }
  });

  it('closing drops the dialog', async () => {
    const { container, unmount } = await openList();
    try {
      const modal = await open(container, BIG);
      (modal as unknown as { close: () => void }).close();
      await waitFor(() => expect(dialog(container)).toBeNull());
    } finally {
      unmount();
    }
  });

  it('edit → save writes title and description in one record.update, and the dialog redraws', async () => {
    const { container, unmount, writes, read } = await openList();
    try {
      const modal = await open(container, BIG);
      fireEvent.click(buttonNamed(modal, 'Edit outcome')!);
      // The drafts start from the record.
      await waitFor(() => expect(titleField(modal)).toBeTruthy());
      const title = titleField(modal)!;
      const description = descriptionField(modal)!;
      expect((title as unknown as { value: string }).value).toBe(BIG);

      type(title, 'Acorn ships inside WE');
      type(description, 'Now with an expanded view.');
      fireEvent.click(buttonNamed(modal, 'Save')!);

      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0]).toEqual({
        entity: 'AcornOutcome',
        id: 'acorn-outcome-1',
        fields: { content: 'Acorn ships inside WE', description: 'Now with an expanded view.' },
      });
      await waitFor(async () => {
        const stored = await read('acorn-outcome-1');
        expect(stored?.content).toBe('Acorn ships inside WE');
        expect(stored?.description).toBe('Now with an expanded view.');
      });
      // Back to reading, from the record rather than the drafts.
      await waitFor(() => expect(buttonNamed(dialog(container)!, 'Edit outcome')).toBeTruthy());
      await waitFor(() => expect(dialog(container)!.textContent).toContain('Now with an expanded view.'));
    } finally {
      unmount();
    }
  });

  it('an emptied description saves as the empty value', async () => {
    const { container, unmount, read } = await openList();
    try {
      const modal = await open(container, BIG);
      fireEvent.click(buttonNamed(modal, 'Edit outcome')!);
      await waitFor(() => expect(descriptionField(modal)).toBeTruthy());
      type(descriptionField(modal)!, '');
      fireEvent.click(buttonNamed(modal, 'Save')!);
      await waitFor(async () => expect((await read('acorn-outcome-1'))?.description ?? '').toBe(''));
    } finally {
      unmount();
    }
  });

  it('an empty title cannot be saved', async () => {
    const { container, unmount } = await openList();
    try {
      const modal = await open(container, BIG);
      fireEvent.click(buttonNamed(modal, 'Edit outcome')!);
      await waitFor(() => expect(titleField(modal)).toBeTruthy());
      type(titleField(modal)!, '');
      await waitFor(() =>
        expect((buttonNamed(modal, 'Save') as unknown as { disabled?: boolean }).disabled).toBe(true),
      );
    } finally {
      unmount();
    }
  });

  it('cancel writes nothing and keeps the record', async () => {
    const { container, unmount, writes, read } = await openList();
    try {
      const modal = await open(container, BIG);
      fireEvent.click(buttonNamed(modal, 'Edit outcome')!);
      await waitFor(() => expect(titleField(modal)).toBeTruthy());
      type(titleField(modal)!, 'never saved');
      fireEvent.click(buttonNamed(modal, 'Cancel')!);
      await waitFor(() => expect(buttonNamed(modal, 'Edit outcome')).toBeTruthy());
      expect(writes).toEqual([]);
      expect((await read('acorn-outcome-1'))?.content).toBe(BIG);
    } finally {
      unmount();
    }
  });

  it('a Small outcome offers status; a pick writes achievementStatus alone', async () => {
    const { container, unmount, writes, read } = await openList();
    try {
      const modal = await open(container, SMALL);
      await waitFor(() => expect(selectLabelled(modal, 'Status')).toBeTruthy());
      pick(selectLabelled(modal, 'Status')!, 'NotAchieved');
      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0].fields).toEqual({ achievementStatus: 'NotAchieved' });
      await waitFor(async () => expect((await read('acorn-outcome-2'))?.achievementStatus).toBe('NotAchieved'));
    } finally {
      unmount();
    }
  });

  it('an Uncertain outcome has no status to pick; its scope can be set Small, and status then appears', async () => {
    const { container, unmount, writes, read } = await openList();
    try {
      const modal = await open(container, UNCERTAIN);
      expect(modal.textContent).toContain('Time frame:');
      expect(selectLabelled(modal, 'Status')).toBeUndefined();
      pick(selectLabelled(modal, 'This outcome is')!, 'Small');
      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0].fields).toEqual({ scopeType: 'Small' });
      await waitFor(async () => expect((await read('acorn-outcome-3'))?.scopeType).toBe('Small'));
      await waitFor(() => expect(selectLabelled(dialog(container)!, 'Status')).toBeTruthy());
    } finally {
      unmount();
    }
  });
});
