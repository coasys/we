# A template is stored whole, and addressed by node id — no section index

**Status:** Accepted — supersedes [Template storage: monolith + stored index](2026-04-02-template-storage.md)

**Decision.** A `Template` record's `schema` file holds `{ schema }`, plus `savedAt` on a save of an
existing record, and nothing derived from the schema. Anything that needs a part of a template finds
it by its nodes' permanent ids. The one encoder and decoder is `encodeTemplateFile` /
`decodeTemplateFile` in `packages/entities/src/utils/templateFile.ts`; it still reads the bare
schema and `{ schema, sections }` that older records hold.

**Why.** The stored section index existed to give regions of a template keys that every client
agrees on, because those regions were addressed by numeric tree paths, and a path computed by one
version of the indexer could mean something else to another. Permanent node ids answer that
directly: an id names the same node on every client, survives any edit that does not delete the
node, and needs no algorithm to agree on. Every edit path — the editor's patches, the AI's
`update_schema`, the visual editor — now works by id, and the AI's view of a large template is an
outline of ids with a lookup, not a list of sections. The section API the index served
(`listSections`, `getSection`, `updateSection`) was never called outside its tests, while every save
computed and stored the index and every read threw it away.

**Rejected.**

- _Keep storing the index._ It costs a full tree walk and a few kilobytes on every save for data
  no reader uses, and it keeps the template codec tied to the schema engine — which is what stopped
  the codec living with the entity whose storage it describes.
- _Compute sections at read time when something wants them._ Still possible, and nothing here
  prevents it: an outline of a template is a pure function of the tree. It is a feature of whatever
  wants it, not of storage.

**Revisit when.** Something has to refer to a region of a template that is not a node — a span of
siblings, say — in a way that must survive edits and agree across clients. Ids cover every case so
far.
