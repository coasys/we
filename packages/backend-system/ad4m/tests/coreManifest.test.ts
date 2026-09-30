/**
 * The core vocabulary: authored manifest vs generated classes.
 *
 * `CORE_MANIFEST` is the source of truth and the decorated classes are generated from it. This
 * holds the two in agreement through a *different* compiler: every entity compiled from the
 * manifest at runtime must produce the same schema the generated class does — same predicates,
 * same cardinalities, same storage and read behaviour, same type marker. A codegen bug and a
 * compiler bug cannot both make the same mistake silently, and a wrong predicate would not error
 * anywhere — it would silently write data where nothing looks for it — which is why the comparison
 * is exhaustive rather than a spot check.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { SHACLShape } from '@coasys/ad4m';
import { resolvesPolymorphically } from '@we/backend-shared';
import { CORE_MANIFEST } from '@we/entities/manifest';
import { WE_NODE_RELATIONS } from '@we/entities/manifest';
import { describe, expect, it } from 'vitest';

import * as Classes from '../src/entities';
import { compileManifest } from '../src/manifestCompiler';
import { ROOT_MODELS, SPACE_MODELS } from '../src/sdnaEntities';

type Shaped = { generateSHACL: () => { shape: SHACLShape | null } };

const compiled = compileManifest(CORE_MANIFEST, { moduleId: 'core' });

/**
 * The parts of a property shape that describe how data is stored and read back — plus the
 * interpretation metadata the executor reads off the stored shape. Hints are compared here because
 * a manifest that drops one still compiles, still round-trips, and fails only as "the model
 * extracted nothing" weeks later.
 */
const describeProperty = (p: SHACLShape['properties'][number]) => ({
  name: p.name,
  path: p.path,
  required: (p.minCount ?? 0) >= 1,
  collection: p.maxCount === undefined || p.maxCount > 1,
  storage: p.resolveLanguage ?? null,
  // Written by the compiler and not declared on the published SHACL property type.
  initial: (p as { initial?: unknown }).initial ?? null,
  transformed: p.transform !== undefined,
  flagValue: p.hasValue ?? null,
  hint: p.interpretationHint ?? null,
  identity: p.identity ?? false,
});

const shapeSummary = (cls: unknown) => {
  const shape = (cls as Shaped).generateSHACL().shape;
  if (!shape) return null;
  return {
    classHint: shape.interpretationHint ?? null,
    properties: [...(shape.properties ?? [])]
      .map(describeProperty)
      // Sorted by path *and name*: a forward relation and its `reverseOf` inverse are one link read
      // from both ends, so they share a predicate and path alone stopped being a unique key. With a
      // tie the sort is stable, which means it preserves each side's declaration order — and the
      // comparison then comes down to which order the two happened to be written in rather than to
      // anything about the shapes.
      .sort((a, b) => `${a.path}`.localeCompare(`${b.path}`) || `${a.name}`.localeCompare(`${b.name}`)),
  };
};

const entityNames = Object.keys(CORE_MANIFEST.entities);

/**
 * The classes are generated, so any failure below usually means they are stale rather than wrong —
 * say so, because the fix is one command and the diff alone doesn't suggest it.
 */
const REGENERATE = 'The classes are out of date: run `pnpm --filter @we/backend-ad4m generate:classes`.';

describe('core manifest ↔ hand-written classes', () => {
  it('declares every entity the model layer ships', () => {
    const handWritten = Object.keys(Classes).filter(
      (k) => typeof (Classes as Record<string, unknown>)[k] === 'function' && (Classes as never)[k]['generateSHACL'],
    );
    expect(entityNames.sort(), REGENERATE).toEqual(handWritten.sort());
  });

  it.each(entityNames)('%s compiles to the same schema it was written as', (name) => {
    const original = shapeSummary((Classes as Record<string, unknown>)[name]);
    const fromManifest = shapeSummary(compiled[name]);

    expect(fromManifest, `${name} produced no shape`).not.toBeNull();
    expect(fromManifest, REGENERATE).toEqual(original);
  });

  it.each(entityNames)('%s starts new instances with the same field values', (name) => {
    const Original = (Classes as Record<string, unknown>)[name] as new () => Record<string, unknown>;
    const FromManifest = compiled[name] as unknown as new () => Record<string, unknown>;

    // Defaults are part of what an entity *is* (a signal type whose range starts at 1) and are the
    // one thing SHACL does not carry, so they are compared on instances instead.
    // `_`-prefixed fields are the base class's own bookkeeping — `_baseExpression` is a fresh
    // random id per instance, so it is never equal and says nothing about the declaration.
    const plain = (o: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(o).filter(([k, v]) => typeof v !== 'function' && !k.startsWith('_')));
    expect(plain(new FromManifest()), REGENERATE).toEqual(plain(new Original()));
  });

  /**
   * `WeNode` is the one class in this set that is hand-written rather than generated — it is the
   * behavioural base the others are generated as subclasses of — so its relation decorators are the
   * one place the manifest's answer is repeated by hand.
   *
   * The comparisons above cannot catch a mistake here: they compare SHACL, and `polymorphic` is a
   * read-time instruction that never reaches a shape. So a `WeNode` whose decorators disagreed with
   * `WE_NODE_RELATIONS` would compile, install, round-trip and pass every other test in this file,
   * and fail only as a relation that quietly hands back bare URIs where the manifest promised
   * records. Read from source for the same reason `generatedClasses` does: the decorator registry
   * projection drops `polymorphic`, so the declaration itself is the only honest witness.
   */
  it('WeNode declares polymorphic exactly where the manifest says it should', () => {
    // Line-based rather than one regex over the file: a typed relation's decorator carries an arrow
    // function (`@HasMany(() => Signal, …)`), so "up to the closing paren" stops in the wrong place.
    const lines = readFileSync(resolve(import.meta.dirname, '../src/entities/WeNode.ts'), 'utf8').split('\n');
    for (const [name, spec] of Object.entries(WE_NODE_RELATIONS)) {
      const field = lines.findIndex((l) => new RegExp(String.raw`^\s{2}${name}[?:]`).test(l));
      expect(field, `WeNode has no "${name}" field — did the relation get renamed?`).toBeGreaterThan(0);
      const decorator = lines[field - 1];
      // `@BelongsTo*` is the same check on the non-owning side of a relation: it hydrates its
      // targets exactly as the forward side does, so it carries `polymorphic` for the same reason
      // and a disagreement there is the same silent bug.
      expect(decorator, `WeNode.${name} is not decorated`).toMatch(/@(Has|BelongsTo)(Many|One)\(/);
      // A relation's direction has to match the manifest too. Declaring `reverseOf` and generating
      // a `@HasMany` would mint a *second* link on the same predicate instead of reading the one
      // that exists — and since both ends look alike once written, nothing downstream would say so.
      const isReverse = /@BelongsTo(Many|One)\(/.test(decorator);
      expect(isReverse, `WeNode.${name}: the manifest and this class disagree about which end owns the link`).toBe(
        Boolean(spec.reverseOf),
      );
      expect(
        decorator.includes('polymorphic: true'),
        `WeNode.${name}: the manifest and this class disagree about polymorphic hydration`,
      ).toBe(resolvesPolymorphically(spec));
    }
  });
});

/**
 * An entity nobody registers is an entity that does not exist.
 *
 * `Topic` was declared in the manifest, generated as a class, exported from `entities`, listed in
 * `CORE_MANIFEST` and rendered by a section of space settings — and absent from `SPACE_MODELS`. So
 * `getEntity('Topic')` threw, and every visit to Vocabulary raised a danger toast saying the model
 * was not available in this perspective. Five of the six places that have to agree did, which is
 * exactly the shape of thing review does not catch.
 *
 * Registration is what `$query` resolves a name through, so this is the step between "the entity is
 * written" and "the entity can be used". Nothing else asserts it.
 */
describe('every core entity is registered somewhere', () => {
  const registered = new Set(
    [...ROOT_MODELS, ...SPACE_MODELS].map((model) => (model as { className?: string }).className ?? model.name),
  );

  it.each(entityNames)('%s is in ROOT_MODELS or SPACE_MODELS', (name) => {
    expect(registered.has(name)).toBe(true);
  });

  it('registers nothing that the manifest does not declare', () => {
    // The other direction, and it fails differently: a class registered under a name the manifest
    // does not carry is one whose shape nothing checks, so it would drift from its own SDNA silently.
    for (const name of registered) expect(entityNames).toContain(name);
  });
});
