/**
 * The RDF reading of operations (`docs/spec/operations/rdf.md`): the JSON-LD context in the spec,
 * applied with a standard JSON-LD processor, both ways, and the graph an effect summary denotes.
 *
 * `toNQuads` reads a manifest's operations as triples: the document with the context, expanded and
 * canonicalized (RDFC-1.0, so blank-node labels are the same wherever it runs). `fromNQuads` is the
 * way back: the graph read as JSON-LD and each property read back to its key by the same context. `summaryNQuads` is the effect
 * summary's graph, built from the summary as the spec words it.
 */
import { readFileSync } from 'node:fs';

import type { OperationDefinition } from '@we/backend-shared';
import type { OperationEffects } from '@we/entities';
import { CORE_OPERATIONS } from '@we/entities/manifest';
import jsonld from 'jsonld';

import { summaryOf } from './effects';

// The processor's calls as they behave, typed once: its declarations give them no promise type.
const canonize = jsonld.canonize as unknown as (doc: unknown, options: unknown) => Promise<string>;
const fromRDF = jsonld.fromRDF as unknown as (nquads: string, options: unknown) => Promise<unknown[]>;

/** The spec's context, read from where it is published. */
export const OPERATIONS_CONTEXT_PATH = new URL('../../../../../docs/spec/operations/context.jsonld', import.meta.url);

const OP = 'https://we.example/ns/operations#';
const MODEL = 'https://we.example/ns/model#';

function context(): Record<string, unknown> {
  return (JSON.parse(readFileSync(OPERATIONS_CONTEXT_PATH, 'utf8')) as { '@context': Record<string, unknown> })[
    '@context'
  ];
}

/** A manifest's operations, as the reading takes them: the manifest's version and its operations. */
export interface OperationsDocument {
  version: string;
  operations: Record<string, OperationDefinition>;
}

const lines = (nquads: string) => nquads.split('\n').filter((line) => line !== '');

const mapValues = <T, U>(record: Record<string, T>, fn: (value: T) => U): Record<string, U> =>
  Object.fromEntries(Object.entries(record).map(([key, value]) => [key, fn(value)]));

/**
 * The two rewrites the context cannot make, done before it applies (`rdf.md`, "Two keys rewritten"):
 * a param's `required` is SHACL's `minCount`, 1 or 0, and an error's message is the node of its code,
 * `{ "message": … }`, so the context can index it by code. Nothing else changes.
 */
function forReading(document: OperationsDocument): unknown {
  return {
    version: document.version,
    operations: mapValues(document.operations, (definition) => {
      const { params, errors, ...rest } = definition;
      return {
        ...rest,
        ...(params
          ? {
              params: mapValues(params, ({ required, ...param }) => ({
                ...param,
                ...(required === undefined ? {} : { minCount: required ? 1 : 0 }),
              })),
            }
          : {}),
        ...(errors ? { errors: mapValues(errors, (message) => ({ message })) } : {}),
      };
    }),
  };
}

/** The way back from {@link forReading}. */
function fromReading(document: OperationsDocument): OperationsDocument {
  type Read = { params?: Record<string, { minCount?: number }>; errors?: Record<string, { message: string }> };
  return {
    version: document.version,
    operations: mapValues(document.operations, (definition) => {
      const { params, errors, ...rest } = definition as unknown as Read & Record<string, unknown>;
      return {
        ...rest,
        ...(params
          ? {
              params: mapValues(params, ({ minCount, ...param }) => ({
                ...param,
                ...(minCount === undefined ? {} : { required: minCount > 0 }),
              })),
            }
          : {}),
        ...(errors ? { errors: mapValues(errors, ({ message }) => message) } : {}),
      } as unknown as OperationDefinition;
    }),
  };
}

/** The document's triples, canonical N-Quads, one statement a line, sorted. */
export async function toNQuads(document: OperationsDocument): Promise<string[]> {
  return lines(
    await canonize(
      { '@context': context(), ...(forReading(document) as object) },
      { algorithm: 'URDNA2015', format: 'application/n-quads', safe: true },
    ),
  );
}

type NodeObject = Record<string, unknown>;

/** A key of the context: the IRI it names, and how its values are read back. */
interface Term {
  term: string;
  iri: string;
  /** For an index container, the key the index is read from. */
  index?: string;
  /** Its string values are IRIs, read back to the terms or vocabulary-relative names they expand from. */
  vocab?: boolean;
  /** Its string values are IRIs relative to the base, read back to the reference they resolve from. */
  ref?: boolean;
  /** The context its values are read with, when it carries one of its own. */
  scoped?: Context;
}

/** A context as the way back reads it: its vocabulary, and its keys by the IRI each names. */
interface Context {
  vocab?: string;
  base?: string;
  byIri: Map<string, Term>;
}

/**
 * Read a context's terms, inheriting from the one it is scoped within. The prefixes are the outer
 * context's: every term written `prefix:name` expands through them, and anything else is relative to
 * the vocabulary in effect.
 */
function readContext(raw: Record<string, unknown>, prefixes: Record<string, string>, outer?: Context): Context {
  const expand = (iri: string, vocab?: string) => {
    const colon = iri.indexOf(':');
    if (colon > 0 && prefixes[iri.slice(0, colon)]) return prefixes[iri.slice(0, colon)] + iri.slice(colon + 1);
    return iri.includes(':') ? iri : `${vocab ?? ''}${iri}`;
  };
  const ctx: Context = {
    vocab: typeof raw['@vocab'] === 'string' ? expand(raw['@vocab']) : outer?.vocab,
    base: typeof raw['@base'] === 'string' ? raw['@base'] : outer?.base,
    byIri: new Map(outer?.byIri),
  };
  const scopes: [Term, Record<string, unknown>][] = [];
  for (const [term, definition] of Object.entries(raw)) {
    if (term.startsWith('@') || term in prefixes) continue;
    const d = (typeof definition === 'string' ? { '@id': definition } : definition) as Record<string, unknown>;
    const entry: Term = {
      term,
      iri: expand((d['@id'] as string | undefined) ?? term, ctx.vocab),
      ...(d['@container'] === '@index' ? { index: d['@index'] as string } : {}),
      ...(d['@type'] === '@vocab' ? { vocab: true } : {}),
      ...(d['@type'] === '@id' ? { ref: true } : {}),
    };
    // A key the outer context maps to the same IRI is replaced, not added beside.
    for (const [iri, known] of ctx.byIri) if (known.term === term) ctx.byIri.delete(iri);
    ctx.byIri.set(entry.iri, entry);
    if (d['@context']) scopes.push([entry, d['@context'] as Record<string, unknown>]);
  }
  for (const [entry, scoped] of scopes) entry.scoped = readContext(scoped, prefixes, ctx);
  return ctx;
}

/** An IRI read back to the key it expands from: a term of the context, else a vocabulary-relative name. */
function compactIri(iri: string, ctx: Context): string {
  const term = ctx.byIri.get(iri);
  if (term) return term.term;
  if (ctx.vocab && iri.startsWith(ctx.vocab)) return iri.slice(ctx.vocab.length);
  throw new Error(`The context reads no key back from ${iri}`);
}

/**
 * The document the triples denote, as JSON again.
 *
 * Read back by the context's own terms rather than by a processor's compaction: a JSON literal that
 * is a list of one is a value, and compaction would hand it back as the one entry, which is a
 * different value. Everything else is what compaction does: each property to its term, a list to an
 * array, an index container to an object keyed by the index, an IRI a key's values are coerced to
 * back to the name it expands from, each node read with the context its key scopes, and each blank
 * node put back in the one place it is referenced (operations are trees, so the node referenced by
 * none is the root). Then the two rewrites made before reading are undone.
 */
export async function fromNQuads(quads: string[]): Promise<OperationsDocument> {
  const flat = (await fromRDF(quads.join('\n') + '\n', {
    format: 'application/n-quads',
    useNativeTypes: true,
  })) as NodeObject[];
  const byId = new Map(flat.map((node) => [node['@id'] as string, node]));
  const referenced = new Set<string>();
  for (const node of flat)
    JSON.stringify(node, (key, value: unknown) => {
      if (key === '@id' && typeof value === 'string' && value !== node['@id']) referenced.add(value);
      return value;
    });
  const raw = context();
  const prefixes = Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, string] =>
        !entry[0].startsWith('@') && typeof entry[1] === 'string' && /[#/]$/.test(entry[1]),
    ),
  );
  const root = readContext(raw, prefixes);

  // A JSON literal's value is the JSON itself, a list of one included; a plain literal is its value.
  const value = (item: unknown, term: Term, ctx: Context): unknown => {
    const v = item as NodeObject;
    if ('@value' in v) return v['@value'];
    if ('@list' in v) return (v['@list'] as unknown[]).map((entry) => value(entry, term, ctx));
    const id = v['@id'] as string;
    const inner = term.scoped ?? ctx;
    if (byId.has(id) || id.startsWith('_:')) return node(byId.get(id) ?? v, inner);
    // A reference resolves against the base of the context it was written in, the node's own.
    if (term.ref && ctx.base && id.startsWith(ctx.base)) return decodeURIComponent(id.slice(ctx.base.length));
    return compactIri(id, inner);
  };
  const node = (n: NodeObject, ctx: Context): NodeObject => {
    const out: NodeObject = {};
    for (const [iri, values] of Object.entries(n)) {
      if (iri === '@id') continue;
      const term = ctx.byIri.get(iri) ?? { term: compactIri(iri, ctx), iri };
      const items = values as unknown[];
      if (term.index) {
        const indexed: NodeObject = {};
        for (const item of items) {
          const child = value(item, term, ctx) as NodeObject;
          const key = child[term.index] as string;
          delete child[term.index];
          indexed[key] = child;
        }
        out[term.term] = indexed;
      } else out[term.term] = value(items[0], term, ctx);
    }
    return out;
  };
  const top = flat.find((n) => !referenced.has(n['@id'] as string));
  if (!top) throw new Error('No node is the root');
  return fromReading(node(top, root) as unknown as OperationsDocument);
}

/**
 * The graph an operation's effect summary denotes, canonical N-Quads: the operation, named by its
 * qualified name, linked by `op:writes` to one node per entity and verb, and by `op:mayWrite` to one
 * per category and verb; each relation verb names the relation as a model term. `op:bulk` and
 * `op:destructive` say the rest.
 */
export async function summaryNQuads(qualifiedName: string, summary: OperationEffects): Promise<string[]> {
  const write = (verb: string, subject: Record<string, unknown>) => {
    const colon = verb.indexOf(':');
    if (colon === -1) return { ...subject, [`${OP}verb`]: { '@id': `${OP}${verb}` } };
    const relation = verb.slice(colon + 1);
    return {
      ...subject,
      [`${OP}verb`]: { '@id': `${OP}${verb.slice(0, colon)}` },
      [`${OP}relation`]: relation === '*' ? { '@id': `${OP}anyRelation` } : { '@id': `${MODEL}${relation}` },
    };
  };
  const entityRef = (entity: string) => ({ '@id': entity === '*' ? `${OP}anyEntity` : `${MODEL}${entity}` });
  const doc = {
    [`${OP}name`]: qualifiedName,
    [`${OP}writes`]: Object.entries(summary.entities).flatMap(([entity, verbs]) =>
      verbs.map((verb) => write(verb, { [`${OP}entity`]: entityRef(entity) })),
    ),
    [`${OP}mayWrite`]: Object.entries(summary.categories).flatMap(([category, verbs]) =>
      (verbs ?? []).map((verb) => write(verb, { [`${OP}category`]: { '@id': `${OP}${category}` } })),
    ),
    [`${OP}bulk`]: summary.bulk,
    [`${OP}destructive`]: summary.destructive,
  };
  return lines(await canonize(doc, { algorithm: 'URDNA2015', format: 'application/n-quads', safe: true }));
}

export interface RdfCase {
  id: string;
  note: string;
  document: OperationsDocument;
}

/** WE's core operations, as one manifest. */
export const CORE_DOCUMENT: OperationsDocument = { version: '1', operations: CORE_OPERATIONS };

export const RDF_CASES: RdfCase[] = [
  {
    id: 'rdf.make-board',
    note: 'an operation is a node named in its manifest; its params property shapes, its errors nodes; its steps an rdf:List, each a node under its verb; values rdf:JSON literals, expressions kept inside them',
    document: {
      version: '1',
      operations: {
        makeBoard: {
          description: 'A board and a column under it for each column given.',
          params: { title: { type: 'string', required: true }, columns: { type: 'list', required: true } },
          errors: { untitled: 'A board needs a title.' },
          steps: [
            { check: { condition: { $: "trim(title) != ''" }, error: 'untitled' } },
            {
              create: { as: 'board', entity: 'CollectionBlock', fields: { kind: 'board', title: { $: 'title' } } },
            },
            {
              forEach: {
                in: { $: 'columns' },
                as: 'col',
                steps: [
                  {
                    create: {
                      as: 'column',
                      entity: 'CollectionBlock',
                      fields: { kind: 'column', title: { $: 'col.title' } },
                    },
                  },
                  {
                    link: {
                      entity: 'CollectionBlock',
                      id: { $: 'board.id' },
                      relation: 'children',
                      target: { $: 'column.id' },
                    },
                  },
                ],
              },
            },
          ],
          returns: { $: 'board.id' },
        },
      } as unknown as Record<string, OperationDefinition>,
    },
  },
  {
    id: 'rdf.chosen-entity',
    note: 'an entity chosen by expression is a node holding the expression; a oneOf is an rdf:List of names and category nodes; the summary names the category, not its members',
    document: {
      version: '1',
      operations: {
        deleteAny: {
          description: 'Deletes a record of any type, or a post.',
          params: { kind: { type: 'string', required: true }, id: { type: 'string', required: true } },
          steps: [
            {
              delete: { entity: { $: 'kind' }, oneOf: ['CollectionBlock', { category: 'any' }], id: { $: 'id' } },
            },
          ],
        },
      } as unknown as Record<string, OperationDefinition>,
    },
  },
  {
    id: 'rdf.identity-scope-call',
    note: 'an identity is an rdf:List of field names; a scope is a node; a call names what it calls; serial and when are JSON literals',
    document: {
      version: '1',
      operations: {
        ensureState: {
          description: 'A task state for the slug, then the records under a board.',
          params: { slug: { type: 'string', required: true }, board: { type: 'string', required: true } },
          serial: { $: "'state ' + slug" },
          steps: [
            { create: { as: 'state', entity: 'TaskState', identity: ['slug'], fields: { slug: { $: 'slug' } } } },
            {
              find: {
                as: 'cards',
                entity: 'CollectionBlock',
                scope: { anchor: 'CollectionBlock', via: 'children', anchorId: { $: 'board' }, levels: [10, 5] },
                order: { createdAt: 'desc' },
                limit: 20,
              },
            },
            { call: { as: 'done', operation: 'core.thread', args: { node: { $: 'board' } } }, when: false },
          ],
        },
      } as unknown as Record<string, OperationDefinition>,
    },
  },
  {
    id: 'rdf.params-as-shapes',
    note: 'a param is a SHACL property shape: sh:path its name, resolved under the param base, sh:datatype its type, sh:minCount 1 or 0 for required, sh:description; an error a node of its code and message',
    document: {
      version: '1',
      operations: {
        describeEverything: {
          description: 'Takes one param of each type, and raises either of two errors.',
          params: {
            entity: { type: 'string', required: true, description: 'Named like a key of the format.' },
            count: { type: 'number' },
            done: { type: 'boolean', required: false },
            items: { type: 'list', required: true },
            fields: { type: 'object' },
            anything: { type: 'json', description: 'Any JSON value.' },
          },
          errors: { name: 'Named like a key of the format.', tooMany: 'Too many.' },
          steps: [{ check: { condition: { $: 'count(items) < 10' }, error: 'tooMany' } }],
          returns: { found: { $: 'count(items) > 0' } },
        },
      } as unknown as Record<string, OperationDefinition>,
    },
  },
];

/** `rdf.json`: per case the document, its triples, and the triples of each operation's summary. */
export async function recordRdf() {
  const cases = [];
  for (const c of RDF_CASES) {
    const summaries: Record<string, string[]> = {};
    for (const [name, definition] of Object.entries(c.document.operations))
      summaries[name] = await summaryNQuads(`conformance.${name}`, summaryOf({ operation: definition }));
    cases.push({ id: c.id, note: c.note, document: c.document, nquads: await toNQuads(c.document), summaries });
  }
  return { version: 1, context: 'docs/spec/operations/context.jsonld', cases };
}
