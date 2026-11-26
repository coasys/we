/**
 * The RDF reading: `rdf.json` re-records to the committed triples, and the reading is lossless —
 * the triples read back give the template, for every case and for every template a bundle ships.
 * A key the context does not map would be dropped by a JSON-LD processor without a word, and this
 * is where that shows.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { RDF_CASES } from '../src/cases/rdf';
import { fromNQuads, recordRdf, TEMPLATE_CONTEXT_PATH, toNQuads } from '../src/rdf';

const HERE = dirname(fileURLToPath(import.meta.url));
const VECTORS = join(HERE, '..', 'vectors');
const BUNDLES = join(HERE, '..', '..', '..', '..', 'bundles');

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

/** Every key a node, a route or the root may carry (nodes.md, routing.md, README.md). */
const DOCUMENT_KEYS = [
  'type',
  'props',
  'children',
  'slots',
  'slot',
  'routes',
  '$localState',
  '$queries',
  '$defs',
  'id',
  'key',
  'theme',
  'styles',
  'forkedFrom',
  'forkedPart',
  'path',
  'redirect',
  'keepAlive',
  'schemaVersion',
  'meta',
  '$',
];

describe('the context', () => {
  it('maps every key a document may carry, so a processor drops none', () => {
    const context = (
      JSON.parse(readFileSync(TEMPLATE_CONTEXT_PATH, 'utf8')) as { '@context': Record<string, unknown> }
    )['@context'];
    expect(DOCUMENT_KEYS.filter((key) => !(key in context))).toEqual([]);
  });
});

describe('rdf.json', () => {
  it('re-records to the committed content', async () => {
    const committed = JSON.parse(readFileSync(join(VECTORS, 'rdf.json'), 'utf8')) as unknown;
    expect(await recordRdf()).toEqual(committed);
  });

  for (const c of RDF_CASES)
    it(`${c.id} reads back as the template`, async () => {
      expect(canonical(await fromNQuads(await toNQuads(c.template)))).toEqual(canonical(c.template));
    });

  it('names every node position and its type in the we: vocabulary', async () => {
    const lines = await toNQuads(RDF_CASES.find((c) => c.id === 'rdf.every-position')!.template);
    const we = (term: string) => `<https://we.example/ns/template#${term}>`;
    for (const term of ['children', 'routes', 'slots', 'slotName', 'defs', 'defName', 'props', 'meta', 'path'])
      expect(
        lines.some((line) => line.includes(we(term))),
        term,
      ).toBe(true);
    for (const type of ['Column', 'Card', '$ref', '$routes', 'we-tab'])
      expect(
        lines.some((line) => line.endsWith(`${we(type)} .`)),
        type,
      ).toBe(true);
  });
});

describe('every template a bundle ships reads back as itself', () => {
  const files = readdirSync(BUNDLES).filter((name) => name.endsWith('.bundle.json'));
  for (const file of files) {
    const bundle = JSON.parse(readFileSync(join(BUNDLES, file), 'utf8')) as {
      templates?: Record<string, unknown>[];
      pages?: Record<string, unknown>[];
    };
    for (const template of [...(bundle.templates ?? []), ...(bundle.pages ?? [])])
      it(`${file}: ${(template.meta as { name?: string } | undefined)?.name ?? '?'}`, async () => {
        expect(canonical(await fromNQuads(await toNQuads(template)))).toEqual(canonical(template));
      }, 60_000);
  }
});
