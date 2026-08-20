/**
 * The core vocabulary, declared vs hand-written.
 *
 * `CORE_MANIFEST` is generated from the decorated classes and is meant to replace them. This holds
 * the two in agreement: every entity compiled from the manifest must produce the same schema the
 * hand-written class does — same predicates, same cardinalities, same storage and read behaviour,
 * same type marker. A wrong predicate here would not error anywhere; it would silently write data
 * where nothing looks for it, which is why the comparison is exhaustive rather than a spot check.
 */
import type { SHACLShape } from '@coasys/ad4m';
import * as Classes from '@we/models/classes';
import { CORE_MANIFEST } from '@we/models/generated/coreManifest';
import { describe, expect, it } from 'vitest';

import { compileManifest } from '../src/manifestCompiler';

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
  initial: p.initial ?? null,
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
      .sort((a, b) => `${a.path}`.localeCompare(`${b.path}`)),
  };
};

const entityNames = Object.keys(CORE_MANIFEST.entities);

/**
 * The manifest is generated, so any failure below means it is stale rather than wrong — say so,
 * because the fix is one command and the diff alone doesn't suggest it.
 */
const REGENERATE = 'The manifest is out of date: run `pnpm --filter @we/models generate:manifest`.';

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
});
