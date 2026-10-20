/**
 * The watch TemplateStore opens on a dataset's templates, against a real backend.
 *
 * It reads only the cheap fields, so the questions worth pinning are whether an edit to a template
 * reaches it at all, and whether `templateChanges` makes the right sense of what arrives — the
 * in-memory backend pushes on every write in the dataset, including ones that touch no template.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { getEntity } from '@we/entities';
import { beforeEach, describe, expect, it } from 'vitest';

import { TEMPLATE_WATCH_FIELDS, templateChanges, type TemplateStamp } from '../src/shared/templateSync';

interface Stamped extends TemplateStamp {
  slug?: string;
}
interface TemplateClass {
  create(dataset: unknown, data: Record<string, unknown>): Promise<{ id: string }>;
  update(dataset: unknown, id: string, data: Record<string, unknown>): Promise<unknown>;
  query(
    dataset: unknown,
    query: Record<string, unknown>,
  ): { subscribe(cb: (rows: Stamped[]) => void): Promise<Stamped[]>; dispose(): void };
}
const Template = () => getEntity('Template') as unknown as TemplateClass;
const Signal = () => getEntity('SignalType') as unknown as TemplateClass;

let dataset: unknown;

beforeEach(async () => {
  const ports = createInMemoryBackendPorts(
    { selfId: () => 'did:test:me' },
    { agent: { id: 'did:test:me', unlocked: true }, datasets: [{ id: 'ds', name: 'Main' }] },
  );
  dataset = (await ports.lifecycle.get('ds'))!.handle;
});

describe('a watch on a dataset’s templates', () => {
  it('hears an edit to a template, and only that', async () => {
    const kept = await Template().create(dataset, { slug: 'board', version: 1 });
    const other = await Template().create(dataset, { slug: 'feed', version: 1 });

    const pushes: Stamped[][] = [];
    const watch = Template().query(dataset, { properties: [...TEMPLATE_WATCH_FIELDS] });
    const first = await watch.subscribe((rows) => pushes.push(rows));
    let { next } = templateChanges(undefined, first, new Map());

    // A write that touches no template: this backend pushes anyway, and nothing has changed.
    await Signal().create(dataset, { name: 'Like', slug: 'like' });
    const quiet = templateChanges(next, pushes.at(-1)!, new Map());
    expect(quiet.changed).toEqual([]);
    next = quiet.next;

    await Template().update(dataset, kept.id, { version: 2 });
    const edited = templateChanges(next, pushes.at(-1)!, new Map());
    expect(edited.changed).toEqual([kept.id]);
    expect(edited.changed).not.toContain(other.id);

    watch.dispose();
  });

  it('carries no template content, only what says whether it changed', async () => {
    await Template().create(dataset, { slug: 'board', version: 1, name: 'Board' });
    const watch = Template().query(dataset, { properties: [...TEMPLATE_WATCH_FIELDS] });
    const [row] = await watch.subscribe(() => {});
    expect(row).not.toHaveProperty('schema');
    expect(row).not.toHaveProperty('name');
    watch.dispose();
  });
});
