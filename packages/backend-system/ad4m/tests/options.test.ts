/**
 * `options` → `sh:in`, in both compilers.
 *
 * A property's closed value set reaches the stored shape as one `sh://in` link whose target is the
 * JSON of the `{ value }` list — which the executor reads and, from AD4M task A1 on, enforces. The
 * one property it must never reach is a `vocabulary` one: its declared `options` are only the
 * floor and the real list is the space's own, so a fixed `sh:in` would reject a community's own
 * states (see options.ts — the rule lives in one place, shared by both compilers).
 */
import type { SHACLShape } from '@coasys/ad4m';
import type { EntityManifest } from '@we/backend-shared';
import { CORE_MANIFEST } from '@we/entities/manifest';
import { describe, expect, it } from 'vitest';

import * as Classes from '../src/entities';
import { compileManifest, manifestToEntries } from '../src/manifestCompiler';

type Shaped = { generateSHACL: () => { shape: SHACLShape | null } };
type Link = { source: string; predicate?: string; target: string };

const shapeOf = (cls: unknown) => (cls as Shaped).generateSHACL().shape!;
const inOf = (cls: unknown, prop: string) => shapeOf(cls).properties.find((p) => p.name === prop)?.in;
const asShIn = (values: (string | number)[]) => values.map((value) => ({ value: String(value) }));

// Every core property whose `options` should reach the shape — the manifest's eight less the one
// `vocabulary` suppresses. Values and order come from the manifest, not from the decorators.
const EXPECTED: [entity: string, prop: string, values: (string | number)[]][] = [
  ['CalloutBlock', 'variant', ['info', 'warning', 'error', 'success']],
  ['InvolvementType', 'semantic', ['responsible', 'reviewing', 'committed', 'interested', 'declined']],
  ['Space', 'threadMode', ['fractal', 'flat']],
  ['Space', 'taskWorkflowRule', ['', 'next', 'next-and-back']],
  ['TaskBlock', 'priority', ['low', 'medium', 'high']],
  ['TaskState', 'semantic', ['open', 'active', 'blocked', 'done', 'cancelled']],
  ['TextBlock', 'source', ['spoken', 'typed', 'corrected']],
];

describe('generated classes write sh:in for a closed value set', () => {
  it.each(EXPECTED)('%s.%s carries the manifest’s options, in the manifest’s order', (entity, prop, values) => {
    expect(inOf((Classes as Record<string, unknown>)[entity], prop)).toEqual(asShIn(values));
  });

  it('TaskBlock.status has none — its real value set is per space', () => {
    // `vocabulary` suppresses the emission: once `sh:in` is enforced, a fixed todo/doing/done
    // list would refuse the states a community named for itself.
    expect(inOf(Classes.TaskBlock, 'status')).toBeUndefined();
    // The link-level check is scoped to status's own property shape — priority carries one, as
    // it should.
    const links = shapeOf(Classes.TaskBlock).toLinks() as Link[];
    const statusShape = links.find((l) => l.predicate === 'sh://path' && l.target === 'we://status')?.source;
    expect(links.filter((l) => l.source === statusShape && l.predicate === 'sh://in')).toEqual([]);
  });

  it('writes exactly one sh://in link per property, as the JSON of the value list', () => {
    // The target format is what task A1 parses on the executor side: one link, whole list.
    const inLinks = shapeOf(Classes.CalloutBlock)
      .toLinks()
      .filter((l: Link) => l.predicate === 'sh://in');
    expect(inLinks).toHaveLength(1);
    expect(inLinks[0].target).toBe(`literal:string:${JSON.stringify(asShIn(['info', 'warning', 'error', 'success']))}`);
  });
});

describe('the runtime compiler does the same for a module manifest', () => {
  const manifest: EntityManifest = {
    version: '1',
    entities: {
      Note: {
        properties: {
          mood: { type: 'string', options: ['up', 'down'] },
          state: { type: 'string', options: ['a', 'b'], vocabulary: 'communityStates' },
          rating: { type: 'number', options: [1, 2, 3] },
        },
        relations: {},
      },
    },
  };
  const classes = compileManifest(manifest, { moduleId: 'notes' });
  const entries = manifestToEntries(manifest, { moduleId: 'notes' });
  const note = entries.find((e) => e.name === 'Note')!;

  it('emits sh:in for a fixed value set and nothing for a vocabulary property', () => {
    expect(inOf(classes.Note, 'mood')).toEqual([{ value: 'up' }, { value: 'down' }]);
    expect(inOf(classes.Note, 'state')).toBeUndefined();
  });

  it('carries a number option as its stored term — a string, not the JSON number', () => {
    expect(inOf(classes.Note, 'rating')).toEqual([{ value: '1' }, { value: '2' }, { value: '3' }]);
  });

  it('reports the same answer on the entries the port hands callers', () => {
    expect(note.properties.find((p) => p.name === 'mood')?.options).toEqual([{ value: 'up' }, { value: 'down' }]);
    expect(note.properties.find((p) => p.name === 'state')?.options).toBeUndefined();
    expect(note.properties.find((p) => p.name === 'rating')?.options).toEqual([
      { value: '1' },
      { value: '2' },
      { value: '3' },
    ]);
  });
});

describe('the two compilers agree', () => {
  const entries = manifestToEntries(CORE_MANIFEST, { moduleId: 'core' });

  it.each(EXPECTED)('%s.%s: what codegen wrote equals what the entries project', (entity, prop) => {
    const declared = entries.find((e) => e.name === entity)!.properties.find((p) => p.name === prop);
    expect(inOf((Classes as Record<string, unknown>)[entity], prop)).toEqual(declared?.options);
  });

  it('and nowhere else: every scalar property of every core entity holds the same options either way', () => {
    // The exhaustive half of the agreement — a compiler that emitted `options` it was not asked
    // for would pass the spot checks above and still write a shape the other compiler disputes.
    const byName = new Map(entries.map((e) => [e.name, e]));
    for (const [name, cls] of Object.entries(Classes)) {
      const entry = byName.get(name);
      if (entry === undefined || typeof cls !== 'function' || !(cls as unknown as Shaped).generateSHACL) continue;
      for (const prop of shapeOf(cls).properties) {
        if (prop.hasValue !== undefined) continue; // the type flag is minted, not declared
        const declared = entry.properties.find((p) => p.name === prop.name);
        expect(
          { entity: name, prop: prop.name, in: prop.in ?? null },
          `${name}.${prop.name}: the generated class and the entry projection disagree on sh:in`,
        ).toEqual({ entity: name, prop: prop.name, in: declared?.options ?? null });
      }
    }
  });
});
