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

/** The document's triples, canonical N-Quads, one statement a line, sorted. */
export async function toNQuads(document: OperationsDocument): Promise<string[]> {
  return lines(
    await canonize(
      { '@context': context(), ...document },
      { algorithm: 'URDNA2015', format: 'application/n-quads', safe: true },
    ),
  );
}

type NodeObject = Record<string, unknown>;

interface Term {
  term: string;
  index?: string;
}

/** The context's terms by the IRI each names, so a node's properties are read back to their keys. */
function termsByIri(ctx: Record<string, unknown>): Map<string, Term> {
  const expand = (iri: string) => iri.replace(/^op:/, OP);
  const out = new Map<string, Term>();
  for (const [term, definition] of Object.entries(ctx)) {
    if (term.startsWith('@') || term === 'op') continue;
    const d = (typeof definition === 'string' ? { '@id': definition } : definition) as Record<string, string>;
    out.set(expand(d['@id']), { term, ...(d['@container'] === '@index' ? { index: d['@index'] } : {}) });
  }
  return out;
}

/**
 * The document the triples denote, as JSON again.
 *
 * Read back by the context's own terms rather than by a processor's compaction: a JSON literal that
 * is a list of one is a value, and compaction would hand it back as the one entry, which is a
 * different value. Everything else is what compaction does: each property to its term, a list to an
 * array, an index container to an object keyed by the index, and each blank node put back in the one
 * place it is referenced (operations are trees, so the node referenced by none is the root).
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
  const terms = termsByIri(context());

  // A JSON literal's value is the JSON itself, a list of one included; a plain literal is its value.
  const value = (item: unknown): unknown => {
    const v = item as NodeObject;
    if ('@value' in v) return v['@value'];
    if ('@list' in v) return (v['@list'] as unknown[]).map(value);
    return node(byId.get(v['@id'] as string) ?? v);
  };
  const node = (n: NodeObject): NodeObject => {
    const out: NodeObject = {};
    for (const [iri, values] of Object.entries(n)) {
      if (iri === '@id') continue;
      const term = terms.get(iri);
      if (!term) throw new Error(`The context maps no key to ${iri}`);
      const items = values as unknown[];
      if (term.index) {
        const indexed: NodeObject = {};
        for (const item of items) {
          const child = value(item) as NodeObject;
          const key = child[term.index] as string;
          delete child[term.index];
          indexed[key] = child;
        }
        out[term.term] = indexed;
      } else out[term.term] = value(items[0]);
    }
    return out;
  };
  const root = flat.find((n) => !referenced.has(n['@id'] as string));
  if (!root) throw new Error('No node is the root');
  return node(root) as unknown as OperationsDocument;
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
    note: 'an operation is a node named in its manifest; its steps an rdf:List, each a node under its verb; values rdf:JSON literals, expressions kept inside them',
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
    note: 'an entity chosen by expression is a node holding the expression; a oneOf is one JSON literal; the summary names the category, not its members',
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
