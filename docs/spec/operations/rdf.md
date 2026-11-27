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
is `model:r`. A param's name is an IRI under `param:`, `https://we.example/ns/operations/param/`, the
same base, provisional with it. SHACL's terms are `sh:`, XML Schema's `xsd:`.

| Key                                                                                                                                                                                 | Term                                                    | Read as                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operations`                                                                                                                                                                        | `op:operation`                                          | One value per operation, the definition's node, carrying its bare name as `op:name`.                                                                                                                             |
| `params`                                                                                                                                                                            | `op:param`                                              | One value per param, a node shaped as a SHACL property shape ([below](#params-are-property-shapes)).                                                                                                             |
| `errors`                                                                                                                                                                            | `op:errors`                                             | One value per error, a node carrying its code as `op:code` and its message as `op:message`.                                                                                                                      |
| `steps`, `identity`, `unset`, `oneOf`                                                                                                                                               | `op:steps`, `op:identity`, `op:unset`, `op:oneOf`       | An `rdf:List`, in order. A step is a node; an identity or unset entry a string literal; a `oneOf` entry an entity's name as a string literal, or a category as a node whose `op:category` is `op:` and its name. |
| a verb (`find`, `create`, `update`, `delete`, `link`, `unlink`, `setRelation`, `forEach`, `check`, `call`)                                                                          | `op:` and the verb                                      | The step's body, a node. A `forEach` body's `steps` is a list in turn; a `find`'s `scope` and a `create`'s `parent` are nodes.                                                                                   |
| `description`, `version`, `as`, `error`, `entity`, `relation`, `anchor`, `via`, `operation` (a call's)                                                                              | `op:` and the key (`op:calls` for a call's `operation`) | A string literal, or for an `entity` or `relation` chosen by expression, a node holding it as `op:expression`.                                                                                                   |
| every other key: `returns`, `serial`, `when`, `fields`, `where`, `order`, `limit`, `id`, `target`, `targets`, `in`, `key`, `condition`, `args`, `anchorId`, `levels`, and the flags | `op:` and the key                                       | One `rdf:JSON` literal holding the value as written.                                                                                                                                                             |

An operation is a blank node, named within its manifest by `op:name`. Its qualified name
(`core.makeBoard`) is the host's to assign ([Namespaces](format.md#where-operations-are-declared)), so
it is not in the manifest's graph; the effect summary's graph, which a host builds for an operation it
registered, names it.

## Which triples an operation denotes

**The declarations and the steps are the graph's shape; values are literals.** Every position the
format gives structure (an operation, each param and error it declares, its list of steps, each step
and its body, a loop's body, a scope, a parent, a `oneOf`) is a resource with triples of its own, so a
graph query can find every operation with a `delete`, every step that writes `TaskState`, or every
operation taking a required list. Everything that is a value is one `rdf:JSON` literal holding exactly
the JSON written:

- **Expressions are literals.** An expression is source text in a language of its own, kept as a
  string, as SPARQL and SHACL-SPARQL keep a query string: inside a `rdf:JSON` literal (a field's
  `{ "$": … }`), or as the `op:expression` of an `entity` or `relation` chosen when the step runs. RDF
  does not parse it.
- **What an operation returns is a value.** `returns` is an expression, a literal, or an object or
  list nesting either, as `fields` is, so it is one literal like them.
- **Names in a step are literals.** A step's `entity`, its `relation` and the field names inside
  `fields`, `where` and `order` are the names as written. A step's `entity` is a name or an expression,
  and one term cannot read both as an IRI and as a node and give the JSON back, so the operation's own
  graph keeps the name; the summary's graph is where they are the model's IRIs.

### Params are property shapes

A param says what the invocation's `args` may hold under one name, which is what a SHACL property shape
says of a node's values under one path. So each param is read as one:

| A param's key      | Term             | Read as                                                                                                                                                                        |
| ------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| its name (the key) | `sh:path`        | The IRI `param:` and the name (`param:title`), resolved against the base, so a name that is also a key of the format (`entity`) is still the param's.                          |
| `type`             | `sh:datatype`    | `xsd:string`, `xsd:double`, `xsd:boolean`, or `rdf:JSON` for `json`. A `list` or an `object` is `op:list` or `op:object`, WE's types: JSON values with no XML Schema datatype. |
| `required`         | `sh:minCount`    | `1` when the param is required, `0` when it says `required: false`; nothing when it says neither.                                                                              |
| `description`      | `sh:description` | A string literal.                                                                                                                                                              |

```
_:op  op:param  [ sh:path param:title ; sh:datatype xsd:string ; sh:minCount 1 ] ,
                [ sh:path param:columns ; sh:datatype op:list ; sh:minCount 1 ] ;
      op:errors [ op:code "untitled" ; op:message "A board needs a title." ] .
```

A param node is shaped like a property shape and is not declared one: the reading adds no `rdf:type`,
so a SHACL engine is not handed shapes nobody asked it to run. A reader that wants to validate an
invocation's `args` against the params reads them as the property shapes of a node shape it makes.

### Two keys rewritten

JSON-LD maps keys and coerces strings; it cannot turn `true` into `1`, nor a string into a node. So two
keys are rewritten before the context applies, and back after the way back:

- a param's `required: true` is `minCount: 1`, and `required: false` is `minCount: 0`;
- an error's message `"…"` is `{ "message": "…" }`, so the context indexes the error by its code.

Nothing else is rewritten, and the context does the rest.

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

**JSON to RDF:** make the [two rewrites](#two-keys-rewritten), expand the manifest's `version` and
`operations` with the context and convert the result to RDF, as JSON-LD 1.1 defines. For comparing two readings, canonicalize the result (RDF Dataset
Canonicalization), so blank-node labels agree.

**RDF to JSON:** convert the graph to JSON-LD, put each blank node back in the one place it is
referenced (operations are trees, so each node is referenced once and the node referenced by none is
the manifest), and read each property back to the key the context maps to it: a list to an array, the
`op:operation`, `op:param` and `op:errors` values to objects keyed by their `op:name`, `sh:path` and
`op:code`, an IRI a key's values are coerced to back to the name it expands from, and an `rdf:JSON`
literal to the JSON it holds, whole. Then undo the two rewrites. A processor's compaction does all of this but the last for a JSON value that is a list
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
Pinned by: rdf vectors `rdf.make-board`, `rdf.chosen-entity`, `rdf.identity-scope-call`,
`rdf.params-as-shapes` in
[`rdf.json`](../../../packages/backend-system/conformance/vectors/operations/rdf.json);
[`operationSuites.test.ts`](../../../packages/backend-system/conformance/tests/operationSuites.test.ts)
(every case's triples and summaries, every core operation and every manifest both operations vector
files carry read back as itself, every key the format defines mapped).
