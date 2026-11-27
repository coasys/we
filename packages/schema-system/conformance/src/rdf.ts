/**
 * The RDF reading of a template: the JSON-LD context in the spec, applied with a standard JSON-LD
 * processor, both ways.
 *
 * `toNQuads` is the reading: the template with the context, expanded and canonicalized (RDFC-1.0, so
 * blank-node labels are the same wherever it runs). `fromNQuads` is the way back: the graph read as
 * JSON-LD, each blank node put back in the one place it is referenced (a template is a tree, so
 * every node is referenced once), and compacted with the same context. The spec's claim is that the
 * second gives back the first's input; `tests/rdf.test.ts` holds it to that for every case and for
 * every template a bundle ships.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import jsonld from 'jsonld';

import { RDF_CASES } from './cases/rdf';

const HERE = dirname(fileURLToPath(import.meta.url));

// The processor's calls as they behave, typed once: its declarations give them no promise type.
const canonize = jsonld.canonize as unknown as (doc: unknown, options: unknown) => Promise<string>;
const fromRDF = jsonld.fromRDF as unknown as (nquads: string, options: unknown) => Promise<unknown[]>;
const compact = jsonld.compact as unknown as (doc: unknown, context: unknown) => Promise<Record<string, unknown>>;

/** The spec's context, read from where it is published. */
export const TEMPLATE_CONTEXT_PATH = join(HERE, '..', '..', '..', '..', 'docs', 'spec', 'template', 'context.jsonld');

function context(): Record<string, unknown> {
  return (JSON.parse(readFileSync(TEMPLATE_CONTEXT_PATH, 'utf8')) as { '@context': Record<string, unknown> })[
    '@context'
  ];
}

/** The template's triples, canonical N-Quads, one statement a line, sorted. */
export async function toNQuads(template: Record<string, unknown>): Promise<string[]> {
  const nquads = await canonize(
    { '@context': context(), ...template },
    { algorithm: 'URDNA2015', format: 'application/n-quads', safe: true },
  );
  return nquads.split('\n').filter((line) => line !== '');
}

type NodeObject = Record<string, unknown>;

/** The template the triples denote, as JSON again. */
export async function fromNQuads(lines: string[]): Promise<Record<string, unknown>> {
  const flat = (await fromRDF(lines.join('\n') + '\n', {
    format: 'application/n-quads',
    useNativeTypes: true,
  })) as NodeObject[];
  const byId = new Map(flat.map((node) => [node['@id'] as string, node]));
  const referenced = new Set<string>();
  const embed = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(embed);
    if (!value || typeof value !== 'object' || '@value' in value) return value;
    const node = value as NodeObject;
    const id = node['@id'];
    if (Object.keys(node).length === 1 && typeof id === 'string' && byId.has(id)) {
      referenced.add(id);
      return embed(byId.get(id));
    }
    const out: NodeObject = {};
    for (const [key, inner] of Object.entries(node)) {
      // A blank node's label is the reading's, not the template's.
      if (key === '@id' && typeof inner === 'string' && inner.startsWith('_:')) continue;
      out[key] = embed(inner);
    }
    return out;
  };
  const embedded = flat.map(embed);
  const root = embedded[flat.findIndex((node) => !referenced.has(node['@id'] as string))];
  const compacted = await compact(root, context());
  delete compacted['@context'];
  return compacted;
}

/** `rdf.json`: each case's template and the triples it denotes. */
export async function recordRdf() {
  const cases = [];
  for (const c of RDF_CASES)
    cases.push({ id: c.id, note: c.note, template: c.template, nquads: await toNQuads(c.template) });
  return { version: 1, context: 'docs/spec/template/context.jsonld', cases };
}
