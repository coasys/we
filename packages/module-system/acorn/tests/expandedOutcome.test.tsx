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

/**
 * How the host's writes behave. `lag`: a write is acknowledged at once but reaches the store only
 * on `flush()` — the subscription stays on the old record meanwhile, as a slow mount's does.
 * `hold`: a write neither lands nor settles until `release()`. `failConnections`: that many
 * AcornConnection creates are refused.
 */
interface HostOptions {
  lag?: boolean;
  hold?: boolean;
  failConnections?: number;
}

async function fixtureHost(options: HostOptions = {}) {
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
  // `record.create` likewise: the class's `.create(dataset, fields)`, resolving with the record.
  const creates: Array<{ entity: string; fields: Record<string, unknown> }> = [];
  const deferred: Array<() => Promise<unknown>> = [];
  const held: Array<() => void> = [];
  let refusals = options.failConnections ?? 0;
  const record = {
    update: (name: string, id: string, fields: Record<string, unknown>) => {
      writes.push({ entity: name, id, fields });
      const land = () => entity(name).update(handle, id, fields);
      if (options.lag) {
        deferred.push(land);
        return Promise.resolve();
      }
      if (options.hold) return new Promise((resolve) => held.push(() => resolve(land())));
      return land();
    },
    create: (name: string, fields: Record<string, unknown>) => {
      creates.push({ entity: name, fields });
      if (name === 'AcornConnection' && refusals > 0) {
        refusals--;
        return Promise.reject(new Error('connection refused'));
      }
      return entity(name).create(handle, fields);
    },
  };
  /** The lagging writes, landed in the order they were made. */
  const flush = async () => {
    while (deferred.length) await deferred.shift()!();
  };
  /** The held writes, settled in the order they were made. */
  const release = () => {
    while (held.length) held.shift()!();
  };
  const read = async (id: string) =>
    (await entity('AcornOutcome').findOne(handle, { where: { id } })) as Record<string, unknown> | null;
  const all = async (name: string) => (await entity(name).findAll(handle, {})) as Record<string, unknown>[];
  /** Somebody else's write — stock Acorn's, say — reaching the store without passing this view. */
  const remote = (name: string, id: string, fields: Record<string, unknown>) => entity(name).update(handle, id, fields);

  const errors: string[] = [];
  const stores = {
    ...bindings,
    record,
    $sources,
    $onError: (message: string) => errors.push(message),
    $modelsPending: () => false,
  };
  return { stores, errors, writes, creates, read, all, flush, release, remote };
}

const Passthrough = (props: { children?: JSX.Element }) => props.children;
const registry = { Column: Passthrough, Row: Passthrough };

const buttonNamed = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll('we-button')].find((b) => (b.textContent ?? '').trim() === label) as
    HTMLElement | undefined;

/** The dialog the list opens — the only `we-modal` it draws. */
const dialog = (root: HTMLElement) => root.querySelector('we-modal') as HTMLElement | null;

async function openList(options: HostOptions = {}) {
  const host = await fixtureHost(options);
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

/*
  S2-5: the expanded outcome's tree, task list and comments. The fixture's tree is
  acorn-outcome-1 (Big) → acorn-outcome-2 (Small, Achieved, one done task) and acorn-outcome-3
  (Uncertain), joined by two AcornConnection records; acorn-outcome-1 carries Bob's comment.
*/
const checkboxNamed = (root: HTMLElement, label: string) =>
  labelled(root, 'we-checkbox', label) as (HTMLElement & { checked?: boolean }) | undefined;
const iconButtonNamed = (root: HTMLElement, label: string) =>
  labelled(root, 'we-button', label) as HTMLElement | undefined;
const tasksOf = async (read: (id: string) => Promise<Record<string, unknown> | null>, id: string) =>
  JSON.parse(String((await read(id))?.taskList ?? '[]')) as Array<{ task: string; complete: boolean }>;

describe('the expanded outcome — children, tasks, comments', () => {
  it("lists an outcome's children in sibling order, with the roll-up Acorn computes from them", async () => {
    const { container, unmount, errors } = await openList();
    try {
      const modal = await open(container, BIG);
      await waitFor(() => expect(buttonNamed(modal, `Open child ${SMALL}`)).toBeTruthy());
      const text = modal.textContent ?? '';
      expect(text).toContain('Children 2');
      expect(text.indexOf(`Open child ${SMALL}`)).toBeLessThan(text.indexOf(`Open child ${UNCERTAIN}`));
      // One Small achieved, one Uncertain: Acorn's computed scope is Uncertain, its status not achieved.
      expect(text).toContain('From its children: Uncertain · Not achieved · 1/1 smalls · 1 uncertain');
      // A Big outcome has no task list of its own.
      expect(buttonNamed(modal, 'Add task')).toBeUndefined();
      expect(errors).toEqual([]);
    } finally {
      unmount();
    }
  });

  it('opens a child in the same dialog, and goes back', async () => {
    const { container, unmount } = await openList();
    try {
      const modal = await open(container, BIG);
      await waitFor(() => expect(buttonNamed(modal, `Open child ${SMALL}`)).toBeTruthy());
      fireEvent.click(buttonNamed(modal, `Open child ${SMALL}`)!);
      // The Small child, drawn in place: its task list, and a way back to the outcome opened.
      await waitFor(() => expect(checkboxNamed(dialog(container)!, 'boots')).toBeTruthy());
      expect(buttonNamed(dialog(container)!, `Back to ${BIG}`)).toBeTruthy();
      expect(dialog(container)!.textContent).not.toContain('Children 2');
      fireEvent.click(buttonNamed(dialog(container)!, `Back to ${BIG}`)!);
      await waitFor(() => expect(dialog(container)!.textContent).toContain('Children 2'));
      expect(buttonNamed(dialog(container)!, `Back to ${BIG}`)).toBeUndefined();
    } finally {
      unmount();
    }
  });

  it('a new child is an Uncertain outcome and the connection naming this one its parent', async () => {
    const { container, unmount, creates, all } = await openList();
    try {
      const modal = await open(container, BIG);
      await waitFor(() => expect(labelled(modal, 'we-input', 'New child outcome')).toBeTruthy());
      type(labelled(modal, 'we-input', 'New child outcome')!, 'Map lands read-only');
      fireEvent.click(buttonNamed(modal, 'Add child outcome')!);

      await waitFor(() => expect(creates).toHaveLength(2));
      expect(creates[0]).toEqual({
        entity: 'AcornOutcome',
        fields: { content: 'Map lands read-only', scopeType: 'Uncertain' },
      });
      const child = (await all('AcornOutcome')).find((o) => o.content === 'Map lands read-only');
      expect(child).toBeTruthy();
      expect(creates[1]).toEqual({
        entity: 'AcornConnection',
        fields: { parent: 'acorn-outcome-1', child: child!.id, siblingOrder: 2 },
      });
      // Drawn as the third child, and the roll-up counts it.
      await waitFor(() => expect(buttonNamed(dialog(container)!, 'Open child Map lands read-only')).toBeTruthy());
      expect(dialog(container)!.textContent).toContain('Children 3');
      expect(dialog(container)!.textContent).toContain('1/1 smalls · 2 uncertain');
    } finally {
      unmount();
    }
  });

  it('a child whose link is refused keeps its draft and is linked again — never made twice while the dialog is open', async () => {
    const { container, unmount, creates, all } = await openList({ failConnections: 1 });
    try {
      const modal = await open(container, BIG);
      await waitFor(() => expect(labelled(modal, 'we-input', 'New child outcome')).toBeTruthy());
      const before = (await all('AcornOutcome')).length;
      type(labelled(modal, 'we-input', 'New child outcome')!, 'Map lands read-only');
      fireEvent.click(buttonNamed(modal, 'Add child outcome')!);

      // The outcome is made, its connection refused: the dialog says so, and keeps what was typed.
      await waitFor(() => expect(dialog(container)!.textContent).toContain('Could not link the child'));
      expect(creates.map((c) => c.entity)).toEqual(['AcornOutcome', 'AcornConnection']);
      const child = (await all('AcornOutcome')).find((o) => o.content === 'Map lands read-only');
      expect(child).toBeTruthy();
      expect((labelled(dialog(container)!, 'we-input', 'New child outcome') as { value?: string }).value).toBe(
        'Map lands read-only',
      );
      // Adding again would make a second outcome; it waits while the first is unlinked.
      expect((buttonNamed(dialog(container)!, 'Add child outcome') as { disabled?: boolean }).disabled).toBe(true);

      // "Link again" makes the missing connection for the outcome already made.
      fireEvent.click(buttonNamed(dialog(container)!, 'Link again')!);
      await waitFor(() => expect(creates).toHaveLength(3));
      expect(creates[2]).toEqual({
        entity: 'AcornConnection',
        fields: { parent: 'acorn-outcome-1', child: child!.id, siblingOrder: 2 },
      });
      await waitFor(() => expect(buttonNamed(dialog(container)!, 'Open child Map lands read-only')).toBeTruthy());
      expect((await all('AcornOutcome')).length).toBe(before + 1);
      expect(buttonNamed(dialog(container)!, 'Link again')).toBeUndefined();
      expect((labelled(dialog(container)!, 'we-input', 'New child outcome') as { value?: string }).value).toBe('');
    } finally {
      unmount();
    }
  });

  it('a refused link says to link again before closing; closed, the child stays an outcome of its own', async () => {
    const { container, unmount, creates } = await openList({ failConnections: 1 });
    try {
      const modal = await open(container, BIG);
      await waitFor(() => expect(labelled(modal, 'we-input', 'New child outcome')).toBeTruthy());
      type(labelled(modal, 'we-input', 'New child outcome')!, 'Map lands read-only');
      fireEvent.click(buttonNamed(modal, 'Add child outcome')!);
      await waitFor(() => expect(dialog(container)!.textContent).toContain('Could not link the child'));
      expect(dialog(container)!.textContent).toContain('before closing');

      // The retry is the dialog's own state: closed and reopened, there is nothing to link again.
      (dialog(container) as unknown as { close: () => void }).close();
      await waitFor(() => expect(dialog(container)).toBeNull());
      await waitFor(() => expect(buttonNamed(container, 'Open Map lands read-only')).toBeTruthy());
      const reopened = await open(container, BIG);
      expect(buttonNamed(reopened, 'Link again')).toBeUndefined();
      expect(buttonNamed(reopened, 'Open child Map lands read-only')).toBeUndefined();
      expect(creates.map((c) => c.entity)).toEqual(['AcornOutcome', 'AcornConnection']);
    } finally {
      unmount();
    }
  });

  it("a Small outcome's tasks show their done state; add, tick and remove each write the whole list", async () => {
    const { container, unmount, writes, read } = await openList();
    try {
      const modal = await open(container, SMALL);
      await waitFor(() => expect(checkboxNamed(modal, 'boots')).toBeTruthy());
      expect(checkboxNamed(modal, 'boots')!.checked).toBe(true);
      expect(modal.textContent).toContain('Tasks 1/1');
      // A Small outcome has tasks, not children.
      expect(buttonNamed(modal, 'Add child outcome')).toBeUndefined();

      type(labelled(modal, 'we-input', 'New task')!, 'renders the fixture');
      fireEvent.click(buttonNamed(modal, 'Add task')!);
      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0]).toEqual({
        entity: 'AcornOutcome',
        id: 'acorn-outcome-2',
        fields: {
          taskList: JSON.stringify([
            { task: 'boots', complete: true },
            { task: 'renders the fixture', complete: false },
          ]),
        },
      });
      await waitFor(() => expect(checkboxNamed(dialog(container)!, 'renders the fixture')).toBeTruthy());
      expect(checkboxNamed(dialog(container)!, 'renders the fixture')!.checked).toBe(false);
      expect(dialog(container)!.textContent).toContain('Tasks 1/2');

      checkboxNamed(dialog(container)!, 'renders the fixture')!.dispatchEvent(
        new CustomEvent('change', { detail: true, bubbles: true, composed: true }),
      );
      await waitFor(async () =>
        expect(await tasksOf(read, 'acorn-outcome-2')).toEqual([
          { task: 'boots', complete: true },
          { task: 'renders the fixture', complete: true },
        ]),
      );

      await waitFor(() => expect(iconButtonNamed(dialog(container)!, 'Remove task boots')).toBeTruthy());
      fireEvent.click(iconButtonNamed(dialog(container)!, 'Remove task boots')!);
      await waitFor(async () =>
        expect(await tasksOf(read, 'acorn-outcome-2')).toEqual([{ task: 'renders the fixture', complete: true }]),
      );
      await waitFor(() => expect(checkboxNamed(dialog(container)!, 'boots')).toBeUndefined());
      expect(writes).toHaveLength(3);
    } finally {
      unmount();
    }
  });

  it('task edits made before the last one reads back each build on the one before', async () => {
    const { container, unmount, read, writes, flush } = await openList({ lag: true });
    const tick = (label: string) =>
      checkboxNamed(dialog(container)!, label)!.dispatchEvent(
        new CustomEvent('change', { detail: true, bubbles: true, composed: true }),
      );
    try {
      const modal = await open(container, SMALL);
      await waitFor(() => expect(checkboxNamed(modal, 'boots')).toBeTruthy());
      // Two adds, each acknowledged before the subscription has seen the one before it.
      type(labelled(modal, 'we-input', 'New task')!, 'a');
      fireEvent.click(buttonNamed(modal, 'Add task')!);
      await waitFor(() => expect(writes).toHaveLength(1));
      type(labelled(dialog(container)!, 'we-input', 'New task')!, 'b');
      await waitFor(() =>
        expect((buttonNamed(dialog(container)!, 'Add task') as { disabled?: boolean }).disabled).toBe(false),
      );
      fireEvent.click(buttonNamed(dialog(container)!, 'Add task')!);
      await waitFor(() => expect(writes).toHaveLength(2));
      await flush();
      await waitFor(async () =>
        expect(await tasksOf(read, 'acorn-outcome-2')).toEqual([
          { task: 'boots', complete: true },
          { task: 'a', complete: false },
          { task: 'b', complete: false },
        ]),
      );
      // Two ticks in different rows, the same way.
      await waitFor(() => expect(checkboxNamed(dialog(container)!, 'b')).toBeTruthy());
      tick('boots');
      await waitFor(() => expect(checkboxNamed(dialog(container)!, 'boots')!.checked).toBe(false));
      tick('a');
      await waitFor(() => expect(checkboxNamed(dialog(container)!, 'a')!.checked).toBe(true));
      await flush();
      await waitFor(async () =>
        expect(await tasksOf(read, 'acorn-outcome-2')).toEqual([
          { task: 'boots', complete: false },
          { task: 'a', complete: true },
          { task: 'b', complete: false },
        ]),
      );
      expect(dialog(container)!.textContent).toContain('Tasks 1/3');
    } finally {
      unmount();
    }
  });

  it("a task list reverted elsewhere after this view's write read back is drawn, and the next edit builds on it", async () => {
    const { container, unmount, read, writes, remote } = await openList();
    try {
      const modal = await open(container, SMALL);
      await waitFor(() => expect(checkboxNamed(modal, 'boots')).toBeTruthy());
      type(labelled(modal, 'we-input', 'New task')!, 'a');
      fireEvent.click(buttonNamed(modal, 'Add task')!);
      await waitFor(async () =>
        expect(await tasksOf(read, 'acorn-outcome-2')).toEqual([
          { task: 'boots', complete: true },
          { task: 'a', complete: false },
        ]),
      );
      await waitFor(() => expect(checkboxNamed(dialog(container)!, 'a')).toBeTruthy());
      // Read back. Then stock puts the list back as it was before this view's add.
      await remote('AcornOutcome', 'acorn-outcome-2', {
        taskList: JSON.stringify([{ task: 'boots', complete: true }]),
      });
      await waitFor(() => expect(checkboxNamed(dialog(container)!, 'a')).toBeUndefined());
      type(labelled(dialog(container)!, 'we-input', 'New task')!, 'c');
      await waitFor(() =>
        expect((buttonNamed(dialog(container)!, 'Add task') as { disabled?: boolean }).disabled).toBe(false),
      );
      fireEvent.click(buttonNamed(dialog(container)!, 'Add task')!);
      await waitFor(() => expect(writes).toHaveLength(2));
      await waitFor(async () =>
        expect(await tasksOf(read, 'acorn-outcome-2')).toEqual([
          { task: 'boots', complete: true },
          { task: 'c', complete: false },
        ]),
      );
    } finally {
      unmount();
    }
  });

  it('a task typed while the add before it is in flight is kept when that add lands', async () => {
    const { container, unmount, read, writes, release } = await openList({ hold: true });
    const field = () => labelled(dialog(container)!, 'we-input', 'New task') as { value?: string } & Element;
    try {
      const modal = await open(container, SMALL);
      await waitFor(() => expect(checkboxNamed(modal, 'boots')).toBeTruthy());
      type(field(), 'a');
      fireEvent.click(buttonNamed(modal, 'Add task')!);
      await waitFor(() => expect(writes).toHaveLength(1));
      // The next task, typed before the first add has landed.
      type(field(), 'b');
      await waitFor(() => expect(field().value).toBe('b'));
      release();
      await waitFor(async () =>
        expect(await tasksOf(read, 'acorn-outcome-2')).toEqual([
          { task: 'boots', complete: true },
          { task: 'a', complete: false },
        ]),
      );
      // Settled: the task controls are enabled again.
      await waitFor(() => expect(checkboxNamed(dialog(container)!, 'a')?.disabled).toBe(false));
      expect(field().value).toBe('b');
    } finally {
      unmount();
    }
  });

  it('a task edit waits while the one before it is unsettled; removing the last leaves an empty list', async () => {
    const { container, unmount, read, writes, release } = await openList({ hold: true });
    try {
      const modal = await open(container, SMALL);
      await waitFor(() => expect(iconButtonNamed(modal, 'Remove task boots')).toBeTruthy());
      fireEvent.click(iconButtonNamed(modal, 'Remove task boots')!);
      await waitFor(() => expect(writes).toHaveLength(1));
      // In flight: no control can start a second write from the list the first is replacing.
      type(labelled(dialog(container)!, 'we-input', 'New task')!, 'later');
      expect((buttonNamed(dialog(container)!, 'Add task') as { disabled?: boolean }).disabled).toBe(true);
      release();
      await waitFor(async () => expect((await read('acorn-outcome-2'))?.taskList).toBe('[]'));
      await waitFor(() =>
        expect((buttonNamed(dialog(container)!, 'Add task') as { disabled?: boolean }).disabled).toBe(false),
      );
      expect(checkboxNamed(dialog(container)!, 'boots')).toBeUndefined();
      expect(dialog(container)!.textContent).not.toContain('Tasks 0');
    } finally {
      unmount();
    }
  });

  it("shows an outcome's comments by their author's profile name, and adds one", async () => {
    const { container, unmount, creates, all } = await openList();
    try {
      const modal = await open(container, BIG);
      await waitFor(() => expect(modal.textContent).toContain('Looks good — the map can land next.'));
      expect(modal.textContent).toContain('Comments 1');
      // Bob's comment: `creator` is Bob's DID, and his AcornProfile's `agent` names it.
      expect(modal.textContent).toContain('Bob Bakker');

      type(labelled(modal, 'we-textarea', 'Comment')!, 'Children next.');
      fireEvent.click(buttonNamed(modal, 'Add comment')!);
      await waitFor(() => expect(creates).toHaveLength(1));
      expect(creates[0]).toEqual({
        entity: 'AcornOutcomeComment',
        fields: { outcome: 'acorn-outcome-1', content: 'Children next.' },
      });
      await waitFor(async () =>
        expect((await all('AcornOutcomeComment')).map((c) => c.content)).toContain('Children next.'),
      );
      await waitFor(() => expect(dialog(container)!.textContent).toContain('Comments 2'));
      expect(dialog(container)!.textContent).toContain('Children next.');
    } finally {
      unmount();
    }
  });

  it("an outcome without comments says none, and another outcome's comments stay off it", async () => {
    const { container, unmount } = await openList();
    try {
      const modal = await open(container, UNCERTAIN);
      await waitFor(() => expect(modal.textContent).toContain('Comments 0'));
      expect(modal.textContent).not.toContain('Looks good');
      expect(modal.textContent).toContain('Children 0');
    } finally {
      unmount();
    }
  });
});
