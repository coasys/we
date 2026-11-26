/**
 * RDF-reading vector inputs: a template, read through the spec's JSON-LD context. The recorded
 * output is the triples it denotes, as canonical N-Quads; reading them back gives the template.
 *
 * Case ids are append-only.
 */
export interface RdfCase {
  id: string;
  note: string;
  template: Record<string, unknown>;
}

const meta = { name: 'Case', description: 'An RDF case', icon: 'graph' };

export const RDF_CASES: RdfCase[] = [
  {
    id: 'rdf.minimal',
    note: 'a node is a blank node typed by its `type` in the we: vocabulary; text children are an rdf:List of literals',
    template: { schemaVersion: 1, meta, type: 'Column', children: ['Hello', 'world'] },
  },
  {
    id: 'rdf.values-are-json',
    note: 'props, local state and queries are rdf:JSON literals, expressions and nulls inside them kept as written',
    template: {
      schemaVersion: 1,
      meta,
      type: 'Column',
      $localState: { open: { type: 'boolean', initial: false } },
      $queries: { posts: { entity: 'Post', limit: 5 } },
      props: { gap: '300', label: { $: 'local.open ? "Close" : "Open"' }, items: [1, null, 'a'] },
      children: [],
    },
  },
  {
    id: 'rdf.expression-child',
    note: 'an expression in children is a node holding its source as a literal of we:expression',
    template: { schemaVersion: 1, meta, type: 'we-text', children: ['n = ', { $: 'count(local.rows)' }] },
  },
  {
    id: 'rdf.every-position',
    note: 'children, routes, slots, $defs and a $ref each become triples; a slot or a shape keeps its name as we:slotName or we:defName',
    template: {
      schemaVersion: 1,
      meta: { ...meta, panels: [{ id: 'side', node: { type: 'we-text', children: ['panel'] } }] },
      type: 'Column',
      id: 'root',
      $defs: { d1: { type: 'Card', children: ['shared'] } },
      children: [
        { type: '$ref', props: { def: 'd1' } },
        { type: 'Card', key: 'k1', slots: { header: { type: 'Row', children: ['head'] } } },
        { type: 'we-tab', slot: 'nav', children: ['A'] },
        { type: 'FlipCard', props: { front: { type: 'Card', children: ['front'] } } },
        { type: '$routes' },
      ],
      routes: [
        { path: '/', type: 'Column', keepAlive: true, children: ['home'] },
        { path: '/old', redirect: '/' },
        { path: '/board', type: 'Column', children: [{ type: '$routes' }], routes: [{ path: '/', type: 'Row' }] },
      ],
    },
  },
  {
    id: 'rdf.styles-theme-fork',
    note: 'styles and theme are JSON literals; the editing bookkeeping is literals of its own',
    template: {
      schemaVersion: 1,
      meta,
      type: 'Column',
      forkedFrom: 'd1',
      styles: { filter: 'blur(2px)' },
      theme: { themeName: 'dark' },
      children: [],
    },
  },
];
