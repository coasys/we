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

| Key                                                                                               | Term                                                              | Read as                                                                                    |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `type`                                                                                            | `rdf:type`                                                        | The node's class: `we:` and the type as written (`we:Column`, `we:$each`, `we:we-button`). |
| `children`, `routes`                                                                              | `we:children`, `we:routes`                                        | An `rdf:List`, in order. A text child is a string literal.                                 |
| `slots`                                                                                           | `we:slots`                                                        | One value per slot, the slot node, carrying its name as `we:slotName`.                     |
| `$defs`                                                                                           | `we:defs`                                                         | One value per shape, the shape's node, carrying its name as `we:defName`.                  |
| `{ "$": … }` (an expression in `children`)                                                        | `we:expression`                                                   | A node holding the expression's source as a string literal.                                |
| `props`                                                                                           | `we:props`                                                        | A node with one triple per prop ([below](#props-are-triples)).                             |
| `$localState`, `$queries`, `styles`, `theme`, `meta`                                              | `we:localState`, `we:queries`, `we:styles`, `we:theme`, `we:meta` | One `rdf:JSON` literal holding the value as written.                                       |
| `id`, `key`, `slot`, `path`, `redirect`, `keepAlive`, `schemaVersion`, `forkedFrom`, `forkedPart` | `we:` and the key                                                 | A literal of the JSON type it holds (`xsd:boolean`, `xsd:integer` or a string).            |

A node is a blank node. Its `id` is a literal of `we:id`, not the node's IRI: an id is unique within a
document, not across the web, and naming nodes with IRIs is for when the shared namespace is decided.

## Which triples a template denotes

**The tree is the graph's shape, and so is what each node says.** Everything a walk of the tree
visits as a position (children, routes, slots, shared shapes, a node in a node prop) is a resource
with triples of its own, so a graph query can find every `we:Card` in a template, or every route and
its path; and each prop is a triple, so it can find every button labelled "Go". Everything else that
is a value is one `rdf:JSON` literal holding exactly the JSON written:

- **Expressions are literals.** An expression is source text in a language of its own, kept as a
  string, as SPARQL and SHACL-SPARQL keep a query string: inside a `we:props` literal, or as the
  `we:expression` of an expression child. RDF does not parse it.
- **Data is a literal.** An object that is neither a token nor a node, and a `null`, is one JSON
  literal wherever it stands, as are a panel's node in `meta` and a handler's arguments: a graph
  reader that wants what is inside parses the literal, as a host does.

### Props are triples

A node's `props` is a node with one triple per prop. The prop's predicate is `we:prop/` and its name
(`we:prop/label`), whatever the name is: a prop named `type` or `id` is the prop's, never the node's
class or id. Its object depends on the value:

| The prop's value                                                                         | Its object                                                                                           |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| a string, a number, `true`, `false`                                                      | The literal (`xsd:string`, `xsd:integer`, `xsd:double`, `xsd:boolean`).                              |
| `{ "$": … }`                                                                             | A node holding the source as a string literal of `we:expression`, as an expression child is.         |
| another token (`{ "$query": … }`, a handler)                                             | A node with one triple per key (`we:$query`), each an `rdf:JSON` literal holding what the key holds. |
| a node, in a [node prop](nodes.md#node-props) (the catalog's, `$if`'s `then` and `else`) | The node, read as any node is: its type, its props, its children.                                    |
| a list                                                                                   | An `rdf:List` of its entries, each read as a prop's value is (a node there is data).                 |
| `null`, or any other object                                                              | One `rdf:JSON` literal.                                                                              |

```
_:button  rdf:type  we:we-button ;
          we:props  [ we:prop/label "Go" ; we:prop/onClick [ we:$navigate "{\"to\":\"/board\"}"^^rdf:JSON ] ] .
```

An empty `props` is one `rdf:JSON` literal, `{}`: a node with no triples would not be there to read
back. Which props are node props is the catalog's to say, so a reader takes the list from it
([`node-props.json`](../../../packages/schema-system/conformance/catalog/node-props.json)).

**Written for the context, and back.** JSON-LD maps keys and coerces strings; it cannot tell a node
from data by where it stands, nor keep a name from meaning a term. So the props are written for the
context before it applies: each prop's key as `prop/` and its name (relative to the vocabulary), each
value as the table says (a list as `{ "@list": … }`, a literal as `{ "@value": …, "@type": "@json" }`),
and an empty `props` as a literal. After the way back, each is read back to what it was. Nothing
outside `props` is rewritten.

> **Planned.** Panel nodes as nodes, and component and prop names as the core catalog's own IRIs
> once it has them.

## Lossless both ways

**JSON to RDF:** write the props [for the context](#props-are-triples), expand the template with the
context and convert it to RDF, as JSON-LD 1.1 defines.
For comparing two readings, canonicalize the result (RDF Dataset Canonicalization), so blank-node
labels agree.

**RDF to JSON:** convert the graph to JSON-LD, put each blank node back in the one place it is
referenced (a template is a tree, so each node is referenced once and the node referenced by none is
the root), compact the result with the same context, and read each node's props back.

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
`rdf.every-position`, `rdf.styles-theme-fork`, `rdf.props-as-triples`;
[`rdf.test.ts`](../../../packages/schema-system/conformance/tests/rdf.test.ts) (every case and every
template a bundle ships read back as itself; every key a document may carry mapped; each prop under
`we:prop/`).
