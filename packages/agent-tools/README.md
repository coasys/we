# @we/agent-tools

What a language model can do with WE: the tools, their handlers, and the rules they enforce.
Framework-free, so the editor's AI panel and any host that runs an agent use the same code.

- **`@we/ai-context`** is what the model _knows_ about WE: the reference and the catalogue.
- **`@we/agent-tools`** (this package) is what it can _do_: edit a template, today.
- **`@we/schema-shared`** holds the rules both use: validation, the catalogue, tree utilities.

## Two ways in

**The host holds the conversation** (an agent harness, an MCP server): `toolsets`. A host holds
records, so a toolset takes one and gives back the properties to write. How a template is stored
stays here: what comes back is exactly what the app's own save writes, so an open screen picks it
up like a save from another device.

```ts
const entry = Object.values(toolsets).find((t) => t.appliesTo.includes(record.className));
const toolset = await entry.open({ record, request, models, author: agentDid });
// toolset.system, toolset.prompt → the model; toolset.tools → what it may call
const answer = await toolset.call(name, args); // a string; failures start with "Error: "
const { changed, properties } = toolset.result(); // nothing is stored: the host decides
```

`record` is `{ id, className, properties }`, with file properties already resolved (a `data:` URI,
the form the app reads them in). `author` is the DID the write goes out as; the app applies its own
agent's changes on every device and offers anybody else's. `createTemplateToolset` is the same edit
over a bare schema, for a host that stores templates its own way.

**WE holds the conversation** (the editor, the context eval): `prepareTemplateRequest` and
`runEditSession`.

Both run on `createTemplateSession`, which is the only place that decides what an edit may do:
patches apply to a working copy, the result is judged as the tree it will render, only problems the
edit introduced count against it, and an edit is kept whole or not at all.

## The bundle

`dist/agent-tools.bundle.js` (also `@we/agent-tools/bundle`) is one ESM file with everything
inlined: the catalogue, the reference and the validator. It is for a host that loads WE's tools as
a single file rather than installing packages. It needs no DOM, no Node and no network.
`pnpm --filter @we/agent-tools test:deno` runs it under Deno against real templates, and CI does
too.

### What a host provides

The language's own globals (ECMAScript and `Intl`), and on `globalThis` only:

- `structuredClone`
- `TextEncoder`, `TextDecoder`, `atob`, `btoa`: reading and writing the template file
- `crypto.getRandomValues`: ids for new nodes. No other part of `crypto`
- `console`, if the host wants the bundle's warnings

No timers, `fetch`, `URL`, `performance` or anything else. The smoke test removes every other
global before it loads the bundle, so a change that starts relying on one fails CI there rather
than in a host. The list is `HOST_GLOBALS` in `scripts/deno-smoke.deno.js`; widen it only together
with the hosts that run the bundle.

The catalogue inside is the one the bundle was built with, so the file describes one WE build. A
space's own models are passed in as `models`.
