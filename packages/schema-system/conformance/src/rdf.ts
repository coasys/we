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

import { nodePropsOf } from '@we/schema-shared';
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

type NodeObject = Record<string, unknown>;

const isObject = (value: unknown): value is NodeObject =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** A JSON literal as JSON-LD writes one in a document: the value, whole, typed `@json`. */
const json = (value: unknown) => ({ '@value': value, '@type': '@json' });

/**
 * A prop's key, relative to the vocabulary: `label` is `we:prop/label`. Written so rather than as
 * the bare name, which would expand through any term the context has (`type`, `id`, `path`).
 */
const PROP = 'prop/';

/** The keys the context maps, which a token's own keys must not be for it to be read as a node. */
const TERMS = new Set(Object.keys(context()));

/**
 * One prop's value as the reading takes it (`rdf.md`, "Props are triples"): a string, number or
 * boolean is the literal it is; an expression is its node; a node in a node prop the node; a token
 * a node whose keys hold JSON literals; a list an `rdf:List` of values read the same way; anything
 * else (data, and `null`) one JSON literal.
 */
function propValue(value: unknown, nodeProp: boolean): unknown {
  if (value === null) return json(null);
  if (Array.isArray(value)) return { '@list': value.map((entry) => propValue(entry, false)) };
  if (!isObject(value)) return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === '$' && typeof value.$ === 'string') return value;
  if (nodeProp && typeof value.type === 'string') return forReading(value);
  if (keys.length && keys.every((key) => key.startsWith('$') && !TERMS.has(key)))
    return Object.fromEntries(keys.map((key) => [key, json(value[key])]));
  return json(value);
}

/**
 * A node as the context reads it: each prop by {@link propValue}, an empty `props` one JSON literal
 * (a node with no triples would not be there to read back), and every node under it the same way.
 * Nothing else changes; the context does the rest.
 */
function forReading(node: NodeObject): NodeObject {
  const out: NodeObject = { ...node };
  if (isObject(node.props)) {
    const declared = nodePropsOf(node.type);
    const names = Object.keys(node.props);
    out.props = names.length
      ? Object.fromEntries(
          names.map((name) => [`${PROP}${name}`, propValue((node.props as NodeObject)[name], declared.includes(name))]),
        )
      : json({});
  }
  const each = (value: unknown) => (isObject(value) && !('$' in value) ? forReading(value) : value);
  if (Array.isArray(node.children)) out.children = node.children.map(each);
  if (Array.isArray(node.routes)) out.routes = node.routes.map(each);
  for (const key of ['slots', '$defs'] as const)
    if (isObject(node[key]))
      out[key] = Object.fromEntries(Object.entries(node[key]).map(([name, v]) => [name, each(v)]));
  return out;
}

/** A JSON literal as compaction gives one back (its `@type` written `type`, the context's alias for it). */
const isJsonLiteral = (value: NodeObject) => '@value' in value && (value['@type'] ?? value.type) === '@json';

/** One prop's value back from {@link propValue}. */
function propBack(value: unknown): unknown {
  if (!isObject(value)) return value;
  if (isJsonLiteral(value)) return value['@value'];
  if ('@list' in value) return (value['@list'] as unknown[]).map(propBack);
  if (typeof value.type === 'string') return fromReading(value);
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, propBack(inner)]));
}

/**
 * The way back from {@link forReading}, node by node: each prop's key back to its name and its value
 * back to the JSON it was. The JSON-literal keys (`meta`, `styles`, …) are left as they read.
 */
function fromReading(node: NodeObject): NodeObject {
  const out: NodeObject = { ...node };
  if (isObject(node.props))
    out.props = isJsonLiteral(node.props)
      ? node.props['@value']
      : Object.fromEntries(Object.entries(node.props).map(([key, value]) => [key.slice(PROP.length), propBack(value)]));
  const each = (value: unknown) => (isObject(value) && !('$' in value) ? fromReading(value) : value);
  if (Array.isArray(node.children)) out.children = node.children.map(each);
  if (Array.isArray(node.routes)) out.routes = node.routes.map(each);
  for (const key of ['slots', '$defs'] as const)
    if (isObject(node[key]))
      out[key] = Object.fromEntries(Object.entries(node[key]).map(([name, v]) => [name, each(v)]));
  return out;
}

/** The template's triples, canonical N-Quads, one statement a line, sorted. */
export async function toNQuads(template: Record<string, unknown>): Promise<string[]> {
  const nquads = await canonize(
    { '@context': context(), ...forReading(template) },
    { algorithm: 'URDNA2015', format: 'application/n-quads', safe: true },
  );
  return nquads.split('\n').filter((line) => line !== '');
}

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
  return fromReading(compacted);
}

/** `rdf.json`: each case's template and the triples it denotes. */
export async function recordRdf() {
  const cases = [];
  for (const c of RDF_CASES)
    cases.push({ id: c.id, note: c.note, template: c.template, nquads: await toNQuads(c.template) });
  return { version: 1, context: 'docs/spec/template/context.jsonld', cases };
}
