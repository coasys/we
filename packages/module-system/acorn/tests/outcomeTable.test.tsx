/**
 * The outcome table, offline (S2-6): the fixture's tree in `@we/backend-inmemory`, the
 * `acorn.outcomeTable` part drawn by the real renderer. What it must show is Acorn's table — the
 * tree depth-first with Acorn's ID numbers and computed scope and status — and what its filters
 * must do is Acorn's `filterMatch`: keyword or ID, high priority, status, scope and tags.
 */
import { fireEvent, render, waitFor } from '@solidjs/testing-library';
import { ACORN_MANIFEST, acornDatasetId, applyAcornFixture } from '@we/acorn-fixture';
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { manifestEntries } from '@we/backend-shared';
import type { SchemaNode } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import type { JSX } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { ACORN_FUNCTIONS, ACORN_PARTS, acornModule } from '../src/index.ts';

const SELF = 'did:test:acorn-self';

const BIG = 'Acorn runs as a WE template'; // acorn-outcome-1: the root, a priority, tag `frontend`
const SMALL = 'Shell boots on the in-memory backend'; // acorn-outcome-2: Small, Achieved
const UNCERTAIN = 'Outcome list reads live mounted records'; // acorn-outcome-3: Uncertain

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
  for (const [key, value] of Object.entries(record)) out[key] = expandParts(value);
  return out;
}

async function drawTable() {
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
  for (const fn of acornModule.contributes?.functions ?? []) $sources[fn.name] = fn.fn as (o: unknown) => unknown;
  const errors: string[] = [];
  const stores = { ...bindings, $sources, $onError: (m: string) => errors.push(m), $modelsPending: () => false };

  const Passthrough = (props: { children?: JSX.Element }) => props.children;
  const view = render(() => (
    <RenderSchema
      node={expandParts(ACORN_PARTS.outcomeTable.node) as SchemaNode}
      stores={stores as never}
      registry={{ Column: Passthrough, Row: Passthrough }}
      context={{}}
    />
  ));
  await waitFor(() => expect(rows(view.container)).toHaveLength(3));
  return { ...view, errors };
}

const labelOf = (el: Element) => (el as unknown as { label?: string }).label ?? '';

/** The table's rows, top first — each row's "Open <content>" button, outside any dialog. */
const rows = (root: HTMLElement) =>
  [...root.querySelectorAll('we-button')]
    .filter((b) => !b.closest('we-modal') && labelOf(b).startsWith('Open '))
    .map((b) => labelOf(b).slice('Open '.length));

const buttonNamed = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll('we-button')].find(
    (b) => !b.closest('we-modal') && ((b.textContent ?? '').trim() === label || labelOf(b) === label),
  ) as HTMLElement | undefined;

const type = (el: Element, value: string) =>
  el.dispatchEvent(new CustomEvent('input', { detail: value, bubbles: true, composed: true }));

const idNumber = (id: string) =>
  (
    ACORN_FUNCTIONS.find((f) => f.name === 'acornTableRows')!.fn as (
      o: unknown,
    ) => Array<{ id: string; number: string }>
  )({
    outcomes: [{ id }],
    connections: [],
  })[0].number;

describe('the outcome table', () => {
  it("draws the tree depth-first with Acorn's ID numbers, computed scope and status, and tags", async () => {
    const { container, unmount, errors } = await drawTable();
    try {
      expect(rows(container)).toEqual([BIG, SMALL, UNCERTAIN]);
      const text = container.textContent ?? '';
      for (const header of ['ID#', 'Outcome', 'Scope', 'Status', 'Progress', 'Tags']) expect(text).toContain(header);
      expect(text).toContain(idNumber('acorn-outcome-1'));
      // The root's scope and status are computed from its children: one Uncertain keeps it so.
      expect(text).toMatch(new RegExp(`${BIG}.*Uncertain.*Not achieved`));
      expect(text).toMatch(new RegExp(`${SMALL}.*Small.*Achieved.*100%`));
      expect(container.querySelector('we-tag')?.textContent).toBe('frontend');
      expect(errors).toEqual([]);
    } finally {
      unmount();
    }
  });

  it('a parent row folds its children away and opens them again', async () => {
    const { container, unmount } = await drawTable();
    try {
      fireEvent.click(buttonNamed(container, `Collapse ${BIG}`)!);
      await waitFor(() => expect(rows(container)).toEqual([BIG]));
      fireEvent.click(buttonNamed(container, `Expand ${BIG}`)!);
      await waitFor(() => expect(rows(container)).toEqual([BIG, SMALL, UNCERTAIN]));
    } finally {
      unmount();
    }
  });

  it("filters as Acorn's table does — keyword or ID, priority, status, scope, tags — and clears", async () => {
    const { container, unmount } = await drawTable();
    try {
      const keyword = [...container.querySelectorAll('we-input')].find(
        (el) => labelOf(el) === 'Filter by keyword or ID number',
      )!;
      type(keyword, 'shell boots');
      await waitFor(() => expect(rows(container)).toEqual([SMALL]));
      // Acorn's ID# keeps six digits of the hash, and the fixture's three ids share them — so the
      // number finds all three, none of whose statements holds a digit.
      expect(idNumber('acorn-outcome-1')).toBe(idNumber('acorn-outcome-3'));
      type(keyword, idNumber('acorn-outcome-3'));
      await waitFor(() => expect(rows(container)).toEqual([BIG, SMALL, UNCERTAIN]));
      type(keyword, 'nothing like this');
      await waitFor(() => expect(rows(container)).toEqual([]));
      type(keyword, 'nothing like this');
      await waitFor(() => expect(container.textContent).toContain('No outcome matches.'));
      type(keyword, '');
      await waitFor(() => expect(rows(container)).toHaveLength(3));

      // A filtered table draws matches even under a folded parent, as Acorn's does.
      fireEvent.click(buttonNamed(container, `Collapse ${BIG}`)!);
      await waitFor(() => expect(rows(container)).toEqual([BIG]));
      fireEvent.click(buttonNamed(container, 'Small')!);
      await waitFor(() => expect(rows(container)).toEqual([SMALL]));
      // Scope OR status lists AND together: Small and Not achieved matches nothing here.
      fireEvent.click(buttonNamed(container, 'Not achieved')!);
      await waitFor(() => expect(rows(container)).toEqual([]));
      fireEvent.click(buttonNamed(container, 'Clear filters')!);
      await waitFor(() => expect(rows(container)).toEqual([BIG]));

      fireEvent.click(buttonNamed(container, 'Only high priority')!);
      await waitFor(() => expect(rows(container)).toEqual([BIG]));
      fireEvent.click(buttonNamed(container, 'Only high priority')!);
      fireEvent.click(buttonNamed(container, 'Uncertain')!);
      // The root's computed scope is Uncertain too.
      await waitFor(() => expect(rows(container)).toEqual([BIG, UNCERTAIN]));
      fireEvent.click(buttonNamed(container, 'Uncertain')!);
      fireEvent.click(buttonNamed(container, 'frontend')!);
      await waitFor(() => expect(rows(container)).toEqual([BIG]));
    } finally {
      unmount();
    }
  });

  it('a row opens the expanded outcome over the table', async () => {
    const { container, unmount } = await drawTable();
    try {
      fireEvent.click(buttonNamed(container, `Open ${UNCERTAIN}`)!);
      await waitFor(() => expect(container.querySelector('we-modal')?.textContent).toContain(UNCERTAIN));
      expect(container.querySelector('we-modal')?.textContent).toContain('Children 0');
    } finally {
      unmount();
    }
  });
});
