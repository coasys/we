# @we/agent-tools

What a language model can do with WE: the tools, their handlers, and the rules they enforce.
Framework-free, so the editor's AI panel and any host that runs an agent use the same code.

- **`@we/ai-context`** is what the model _knows_ about WE: the reference and the catalogue.
- **`@we/agent-tools`** (this package) is what it can _do_: edit a template, today.
- **`@we/schema-shared`** holds the rules both use: validation, the catalogue, tree utilities.

## Two ways in

**A host runs the agent** (the AD4M executor, an MCP server): `toolsets`. A host offers a
toolset's tools to whichever agent it runs, beside its own, and serves its documentation beside
its own docs. Nothing here prompts a model or holds a session: every call is given the record as it
is stored now, and answers from that alone.

```ts
const toolset = toolsets.template; // appliesTo: ['Template']
toolset.tools; // template_read (writes: false), template_update (writes: true)
const { text, properties } = await toolset.call(name, { record, args, models, author: agentDid });
// text → the model; failures start with "Error: ". properties → write them, all in one transaction
const topics = await toolset.docs.list(); // `template` first, then template/core/*, components, stores…
const start = await toolset.docs.read('template');
```

`record` is `{ id, className, properties }`, with file properties already resolved (a `data:` URI,
the form the app reads them in). The host adds its own way of naming the record to each tool's
parameters, and passes the record it names. `author` is the DID the write goes out as; the app
applies its own agent's changes on every device and offers anybody else's. What `properties` holds
is exactly what the app's own save writes (`schema` and `version`), so an open screen picks it up
like a save from another device.

Two rules an agent is told and a host should know:

- **An edit is one `template_update` call.** Each call is saved, so its patches go together.
- **A save renumbers the node ids.** Ids are aliases numbered by walking the tree — the same on
  every read of the same stored template, which is what lets a read and the update after it agree,
  and different once anything changes it. So `template_update` takes the `version` the read gave
  and refuses a template that has moved on, whoever moved it.

**WE runs the agent** (the editor, the context eval): `prepareTemplateRequest` and
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
