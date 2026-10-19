# @we/agent-tools

What a language model can do with WE: the tools, their handlers, and the rules they enforce.
Framework-free, so the editor's AI panel and any host that runs an agent use the same code.

- **`@we/ai-context`** is what the model _knows_ about WE: the reference and the catalogue.
- **`@we/agent-tools`** (this package) is what it can _do_: edit a template, today.
- **`@we/schema-shared`** holds the rules both use: validation, the catalogue, tree utilities.

## Two ways in

**The host holds the conversation** (an agent harness, an MCP server): `createTemplateToolset`.

```ts
const toolset = await createTemplateToolset({ template, request, models });
// toolset.system, toolset.prompt → the model; toolset.tools → what it may call
const answer = await toolset.call(name, args); // a string; failures start with "Error: "
const { template: edited, changed } = toolset.result(); // nothing is stored: the host decides
```

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

The catalogue inside is the one the bundle was built with, so the file describes one WE build. A
space's own models are passed in as `models`.
