# Operations: the RDF reading

An operation is JSON, and JSON is what people, models and hosts write and read. Every manifest's
operations are also an RDF graph, with no change to the file: a JSON-LD context maps each key of the
format onto a term of the `op:` vocabulary, so a JSON-LD processor reads any operation as triples, and
those triples read back as the same operation. And every operation's [effect
summary](execution.md#the-effect-summary) is a graph over the model: the entities and relations it may
write, named by the model's IRIs. The JSON is canonical; the RDF reading is how a graph-native reader
(an index of a space's operations, a client that stores everything as triples, a reviewer asking which
operations can write a type) reads it without a second format to keep in step.

## The vocabulary and the context

The context is [`context.jsonld`](context.jsonld), beside this file. A reader applies it as the
document's `@context`; a manifest does not carry it. The document read is a manifest's `version` and
`operations` (its `entities`, the model, are carried as one literal and are the model spec's to read).

The vocabulary is `https://we.example/ns/operations#`, written `op:` here. **The base is provisional**,
as the template format's is ([Template RDF reading](../template/rdf.md)): `we.example` is a placeholder
until the shared namespace of the specs this format belongs with is decided, and every IRI moves with
it then. The model's terms are written `model:`, `https://we.example/ns/model#`, until the shared model
spec publishes the IRIs its classes and properties have; an entity `E` is `model:E` and a relation `r`
is `model:r`.

| Key                                                                                                                                                                                                              | Term                                                    | Read as                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `operations`                                                                                                                                                                                                     | `op:operation`                                          | One value per operation, the definition's node, carrying its bare name as `op:name`.                                           |
| `steps`, `identity`, `unset`                                                                                                                                                                                     | `op:steps`, `op:identity`, `op:unset`                   | An `rdf:List`, in order. A step is a node; an identity or unset entry a string literal.                                        |
| a verb (`find`, `create`, `update`, `delete`, `link`, `unlink`, `setRelation`, `forEach`, `check`, `call`)                                                                                                       | `op:` and the verb                                      | The step's body, a node. A `forEach` body's `steps` is a list in turn; a `find`'s `scope` and a `create`'s `parent` are nodes. |
| `description`, `version`, `as`, `error`, `entity`, `relation`, `anchor`, `via`, `operation` (a call's)                                                                                                           | `op:` and the key (`op:calls` for a call's `operation`) | A string literal, or for an `entity` or `relation` chosen by expression, a node holding it as `op:expression`.                 |
| every other key: `params`, `errors`, `returns`, `serial`, `when`, `fields`, `where`, `order`, `limit`, `oneOf`, `id`, `target`, `targets`, `in`, `key`, `condition`, `args`, `anchorId`, `levels`, and the flags | `op:` and the key                                       | One `rdf:JSON` literal holding the value as written.                                                                           |

An operation is a blank node, named within its manifest by `op:name`. Its qualified name
(`core.makeBoard`) is the host's to assign ([Namespaces](format.md#where-operations-are-declared)), so
it is not in the manifest's graph; the effect summary's graph, which a host builds for an operation it
registered, names it.

## Which triples an operation denotes

**The steps are the graph's shape; values are literals.** Every position the format gives structure
(an operation, its list of steps, each step and its body, a loop's body, a scope, a parent) is a
resource with triples of its own, so a graph query can find every operation with a `delete`, or every
step that writes `TaskState`. Everything that is a value is one `rdf:JSON` literal holding exactly the
JSON written:

- **Expressions are literals.** An expression is source text in a language of its own, kept as a
  string, as SPARQL and SHACL-SPARQL keep a query string: inside a `rdf:JSON` literal (a field's
  `{ "$": … }`), or as the `op:expression` of an `entity` or `relation` chosen when the step runs. RDF
  does not parse it.
- **Names in a step are literals.** A step's `entity`, its `relation` and the field names inside
  `fields`, `where` and `order` are the names as written. A step's `entity` is a name or an expression,
  and one term cannot read both as an IRI and as a node and give the JSON back, so the operation's own
  graph keeps the name; the summary's graph is where they are the model's IRIs.

## Which triples an effect summary denotes

The summary ([The effect summary](execution.md#the-effect-summary)) is a graph linking the operation
to what it may write:

```
_:op  op:name         "core.makeBoard" ;
      op:writes       [ op:entity model:CollectionBlock ; op:verb op:create ] ,
                      [ op:entity model:CollectionBlock ; op:verb op:add ; op:relation model:children ] ;
      op:bulk         true ;
      op:destructive  false .
```

- The operation is a node with `op:name`, its qualified name.
- Per entity and verb under `entities`, one `op:writes` node: `op:entity` the entity's model IRI
  (`op:anyEntity` for `*`, a parent whose entity the step does not name), and `op:verb` one of
  `op:create`, `op:edit`, `op:delete`, `op:deleteOwn`, `op:add`, `op:remove`. A relation verb
  (`add:r`, `remove:r`) is `op:add` or `op:remove` with `op:relation` the relation's model IRI
  (`op:anyRelation` for `*`, a relation chosen by expression).
- Per category and verb under `categories`, one `op:mayWrite` node with `op:category` (`op:blockable`,
  `op:any`) in place of `op:entity`: an entity chosen when the step runs, never expanded into what the
  category holds.
- `op:bulk` and `op:destructive` are the summary's booleans, as `xsd:boolean`.

The summary graph is derived from the operation, never written beside it, so a reader that has both
can check one against the other.

## Lossless both ways

**JSON to RDF:** expand the manifest's `version` and `operations` with the context and convert the
result to RDF, as JSON-LD 1.1 defines. For comparing two readings, canonicalize the result (RDF Dataset
Canonicalization), so blank-node labels agree.

**RDF to JSON:** convert the graph to JSON-LD, put each blank node back in the one place it is
referenced (operations are trees, so each node is referenced once and the node referenced by none is
the manifest), and read each property back to the key the context maps to it: a list to an array, the
`op:operation` values to an object keyed by their `op:name`, and an `rdf:JSON` literal to the JSON it
holds, whole. A processor's compaction does all of this but the last for a JSON value that is a list
of one, which it hands back as the one entry; a reader MUST keep such a list a list.

A reader MUST get back the operations it started from: the same JSON values, with an object's keys in
any order. A definition carrying a key the context does not map is not a valid definition ([Objects
are strict](format.md#an-operation-definition)), so a conforming processor drops nothing.

## Running one

Every operation is an RDF graph, and reading it as one runs nothing. Running one needs an operations
runner, as validating a graph against shapes needs a SHACL engine: the runner is what gives the steps
their meaning ([Execution](execution.md)). Most steps compile to SPARQL Update (a `create` to an
`INSERT DATA`, an `update` and a `setRelation` to a `DELETE`/`INSERT … WHERE`, a `delete` to a
`DELETE WHERE`, a guarded step to the same under a `FILTER`), so a backend that has a SPARQL Update
endpoint and nothing more can run those directly. What needs the runner itself is what SPARQL Update
does not say: the derived ids, `expect`, the write check, `call`, and the errors.

> **Why a reading and not a format.** Writing operations as RDF would make every host and every model
> write triples. A context makes each operation RDF as it already is: the meaning gets its IRIs, and
> nobody writes a second format. Interop needs lossless expansion, not RDF storage.

---

Implemented by: [`context.jsonld`](context.jsonld) (the context),
[`rdf.ts`](../../../packages/backend-system/conformance/src/suites/rdf.ts) (`toNQuads`, `fromNQuads`,
`summaryNQuads`).
Pinned by: rdf vectors `rdf.make-board`, `rdf.chosen-entity`, `rdf.identity-scope-call` in
[`rdf.json`](../../../packages/backend-system/conformance/vectors/operations/rdf.json);
[`operationSuites.test.ts`](../../../packages/backend-system/conformance/tests/operationSuites.test.ts)
(every case's triples and summaries, every core operation and every operations vector's manifest read
back as itself, every key the format defines mapped).
