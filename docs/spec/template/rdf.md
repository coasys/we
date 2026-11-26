# Template format: the RDF reading

A template is JSON, and JSON is what people, models and editors write and what a host reads. Every
template is also an RDF graph, with no change to the file: a JSON-LD context maps each key of the
format onto a term of the `we:` vocabulary, so a JSON-LD processor reads any template as triples and
reads those triples back as the same template. The JSON is canonical; the RDF reading is how a
graph-native reader (a SHACL validator, an index of a space's templates, a client that stores
everything as triples) reads it without a second format to keep in step.

## The vocabulary and the context

The context is [`context.jsonld`](context.jsonld), beside this file. A reader applies it as the
document's `@context`; a template does not carry it.

The vocabulary is `https://we.example/ns/template#`, written `we:` here. **The base is provisional**:
`we.example` is a placeholder until the shared namespace of the specs this format belongs with is
decided, and every IRI moves with it then. The operations spec's vocabulary takes the same base, as
`https://we.example/ns/operations#`.

| Key                                                                                               | Term                                                                          | Read as                                                                                    |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `type`                                                                                            | `rdf:type`                                                                    | The node's class: `we:` and the type as written (`we:Column`, `we:$each`, `we:we-button`). |
| `children`, `routes`                                                                              | `we:children`, `we:routes`                                                    | An `rdf:List`, in order. A text child is a string literal.                                 |
| `slots`                                                                                           | `we:slots`                                                                    | One value per slot, the slot node, carrying its name as `we:slotName`.                     |
| `$defs`                                                                                           | `we:defs`                                                                     | One value per shape, the shape's node, carrying its name as `we:defName`.                  |
| `{ "$": … }` (an expression in `children`)                                                        | `we:expression`                                                               | A node holding the expression's source as a string literal.                                |
| `props`, `$localState`, `$queries`, `styles`, `theme`, `meta`                                     | `we:props`, `we:localState`, `we:queries`, `we:styles`, `we:theme`, `we:meta` | One `rdf:JSON` literal holding the value as written.                                       |
| `id`, `key`, `slot`, `path`, `redirect`, `keepAlive`, `schemaVersion`, `forkedFrom`, `forkedPart` | `we:` and the key                                                             | A literal of the JSON type it holds (`xsd:boolean`, `xsd:integer` or a string).            |

A node is a blank node. Its `id` is a literal of `we:id`, not the node's IRI: an id is unique within a
document, not across the web, and naming nodes with IRIs is for when the shared namespace is decided.

## Which triples a template denotes

**The tree is the graph's shape; values are literals.** Everything a walk of the tree visits as a
position (children, routes, slots, shared shapes) is a resource with triples of its own, so a graph
query can find every `we:Card` in a template, or every route and its path. Everything that is a value
is one `rdf:JSON` literal holding exactly the JSON written:

- **Expressions are literals.** An expression is source text in a language of its own, kept as a
  string, as SPARQL and SHACL-SPARQL keep a query string: inside a `we:props` literal, or as the
  `we:expression` of an expression child. RDF does not parse it.
- **Props are one literal.** A prop's value is a literal, a token, data of any shape or (in a
  [node prop](nodes.md#node-props)) a node; read as triples one by one, a list would lose its order
  and a `null` its presence. Kept as one literal, nothing is lost. A node in a node prop, a panel's
  node in `meta` and the steps of a handler are therefore inside a literal in this version of the
  reading: a graph reader that wants them parses the literal, as a host does.

> **Planned.** Node props, panel nodes and prop names as terms of their own, when the core catalog
> has IRIs for its components and their props.

## Lossless both ways

**JSON to RDF:** expand the template with the context and convert it to RDF, as JSON-LD 1.1 defines.
For comparing two readings, canonicalize the result (RDF Dataset Canonicalization), so blank-node
labels agree.

**RDF to JSON:** convert the graph to JSON-LD, put each blank node back in the one place it is
referenced (a template is a tree, so each node is referenced once and the node referenced by none is
the root), and compact the result with the same context.

A reader MUST get back the template it started from: the same JSON values, with an object's keys in
any order. A template carrying a key the context does not map is not a valid template
([Nodes](nodes.md#a-nodes-keys)), so a conforming processor drops nothing.

> **Why a reading and not a format.** Writing templates as RDF would make every editor and every
> model write triples, and every host parse them. A context makes each template RDF as it already
> is: the meaning gets its IRIs, and nobody writes a second format.

---

Implemented by: [`context.jsonld`](context.jsonld) (the context),
[`rdf.ts`](../../../packages/schema-system/conformance/src/rdf.ts) (`toNQuads`, `fromNQuads`, both
ways through a standard JSON-LD processor).
Pinned by: rdf vectors `rdf.minimal`, `rdf.values-are-json`, `rdf.expression-child`,
`rdf.every-position`, `rdf.styles-theme-fork`;
[`rdf.test.ts`](../../../packages/schema-system/conformance/tests/rdf.test.ts) (every case and every
template a bundle ships read back as itself; every key a document may carry mapped).
