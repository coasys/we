/**
 * The operation suites that need no backend, held to the committed files twice over: each file
 * re-records to what is committed, and each case is run again from the file alone, as another
 * implementation would run it, through the reference's own functions.
 */
import { readFileSync } from 'node:fs';

import type { OperationDefinition } from '@we/backend-shared';
import { CORE_OPERATIONS } from '@we/entities/manifest';
import { describe, expect, it } from 'vitest';

import { OPERATION_VECTOR_SUITES, readOperationVectors } from '../src/operations';
import { type EffectCase, permissionOf, recordEffects, summaryOf } from '../src/suites/effects';
import { derivedId, type IdCase, recordIds, segmentsOf } from '../src/suites/ids';
import { fromNQuads, OPERATIONS_CONTEXT_PATH, recordRdf, summaryNQuads, toNQuads } from '../src/suites/rdf';
import { recordStaticChecks, staticIssues } from '../src/suites/staticChecks';

const load = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../vectors/operations/${name}`, import.meta.url), 'utf8')) as T;

/** JSON compared as values: an object's keys in any order. */
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
        )
      : value;

describe('static-checks.json', () => {
  const file = load<ReturnType<typeof recordStaticChecks>>('static-checks.json');

  it('re-records to the committed content', () => {
    expect(recordStaticChecks()).toEqual(file);
  });

  for (const c of file.cases)
    it(`${c.id}: ${c.refused ? 'refused at its paths' : 'accepted'}`, () => {
      const paths = staticIssues(c.operations);
      expect(paths.length > 0).toBe(c.refused);
      expect(paths).toEqual(c.paths);
    });

  it('has a refused case for every check the spec lists, and one that passes', () => {
    const refused = new Set(file.cases.filter((c) => c.refused).map((c) => c.check));
    expect([...Array(15).keys()].map((i) => i + 1).filter((n) => !refused.has(n))).toEqual([]);
    expect(file.cases.some((c) => !c.refused)).toBe(true);
  });
});

for (const [name, profile] of [
  ['effects.json', 'format'],
  ['we-core/effects.json', 'we-core'],
] as const)
  describe(name, () => {
    const file = load<ReturnType<typeof recordEffects>>(name);

    it('re-records to the committed content', () => {
      expect(recordEffects(profile)).toEqual(file);
    });

    for (const c of file.cases)
      it(`${c.id}: the summary and what invoking it needs`, () => {
        const summary = summaryOf(c as unknown as EffectCase);
        expect(summary).toEqual(c.summary);
        expect(permissionOf(summary, file.groups)).toEqual(c.permission);
      });
  });

describe('ids.json', () => {
  const file = load<{ cases: (IdCase & { framed: string; result: string })[] }>('ids.json');

  it('re-records to the committed content', async () => {
    expect(await recordIds()).toEqual(file);
  });

  for (const c of file.cases)
    it(`${c.id}: ${c.result}`, async () => {
      // The framing as the spec words it, written out here rather than taken from the reference.
      const framed = segmentsOf(c)
        .map((part) => `${new TextEncoder().encode(part).length}:${part}`)
        .join('');
      expect(framed).toBe(c.framed);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(framed)));
      const bytes = digest.slice(0, 16);
      bytes[6] = (bytes[6] & 0x0f) | 0x80;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      const uuid = `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      expect(uuid).toBe(c.result);
      expect(await derivedId(c)).toBe(c.result);
    });
});

describe('rdf.json', () => {
  const file = load<Awaited<ReturnType<typeof recordRdf>>>('rdf.json');

  it('re-records to the committed content', async () => {
    expect(await recordRdf()).toEqual(file);
  });

  for (const c of file.cases)
    it(`${c.id}: its triples, its summaries, and back to the document`, async () => {
      expect(await toNQuads(c.document)).toEqual(c.nquads);
      expect(canonical(await fromNQuads(c.nquads))).toEqual(canonical(c.document));
      for (const [name, definition] of Object.entries(c.document.operations))
        expect(await summaryNQuads(`conformance.${name}`, summaryOf({ operation: definition }))).toEqual(
          c.summaries[name],
        );
    });

  it('maps every key the format defines, so a processor drops none', () => {
    const context = (
      JSON.parse(readFileSync(OPERATIONS_CONTEXT_PATH, 'utf8')) as { '@context': Record<string, unknown> }
    )['@context'];
    // format.md: a manifest, a definition, a param's container, every verb and every step body's keys.
    const keys = [
      ...['version', 'entities', 'operations', 'description', 'params', 'errors', 'steps', 'returns', 'serial'],
      ...['find', 'create', 'update', 'delete', 'link', 'unlink', 'setRelation', 'forEach', 'check', 'call', 'when'],
      ...['as', 'entity', 'oneOf', 'fields', 'parent', 'identity', 'id', 'unset', 'own', 'relation', 'target'],
      ...['strict', 'targets', 'keep', 'in', 'key', 'condition', 'error', 'operation', 'args'],
      ...['where', 'order', 'limit', 'scope', 'one', 'expect', 'anchor', 'via', 'anchorId', 'levels', 'transitive'],
      '$',
    ];
    expect(keys.filter((key) => !(key in context))).toEqual([]);
    // A param's keys are read in the params' own scope; `required` is rewritten to `minCount` first.
    const params = (context.params as { '@context': Record<string, unknown> })['@context'];
    expect(['type', 'minCount', 'description'].filter((key) => !(key in params))).toEqual([]);
    // What a param, an error and a oneOf entry become: the index keys and the category.
    expect(['path', 'code', 'message', 'category'].filter((key) => !(key in context))).toEqual([]);
  });
});

describe('every operation reads back as itself', () => {
  const read = async (operations: Record<string, OperationDefinition>) => {
    const document = { version: '1', operations };
    expect(canonical(await fromNQuads(await toNQuads(document)))).toEqual(canonical(document));
  };

  for (const [name, definition] of Object.entries(CORE_OPERATIONS))
    it(`core.${name}`, () => read({ [name]: definition }), 30_000);

  for (const suite of OPERATION_VECTOR_SUITES)
    it(`every manifest the ${suite.profile} operations vectors carry, and its calls`, async () => {
      for (const vector of readOperationVectors(suite).cases) {
        await read(vector.manifest.operations);
        if (Object.keys(vector.calls).length) await read(vector.calls);
      }
    }, 120_000);
});
