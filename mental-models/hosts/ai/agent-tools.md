# Agent tools

`@we/agent-tools` gives a model tools that read, make and edit WE templates and themes by WE's rules. A **toolset** is a set of these tools for one kind of record, and it holds nothing between calls. A host that runs an agent offers the toolset's tools beside its own tools and writes what a call gives back. The package also holds the edit session that the template editor runs, and a single-file bundle for a backend that runs agents.

**Why:** Every call gets the record as it is stored at the time of the call and answers from that alone, so a host needs no session and two agents can use the same tools at the same time. What a call changes comes back as properties that the host writes, so the rules stay in WE and the storage stays with the host (`core/toolset.ts`). The editor's edit loop is in this package and not in `EditorStore`, so the editor and the context eval run the same code (`templates/editSession.ts`).

**Parent:** [AI](README.md)

<details><summary>How it works</summary>

1. `toolsets` holds `template` and `theme`. Each is a `RecordToolset` with `tools` (`AgentTool {name, description, parameters, writes, creates?}`), `call`, `docs` and `appliesTo` (the entities it works on).
2. A failed call answers with text that starts with `Error: `, never a throw, so the model reads the error and tries again.
3. A tool that makes a record answers with the new record and a `Place` (`library` or `space`). The host makes the record there.
4. `runEditSession` is one editor request: the turns, the patch tool, validation fed back to the model, and retries. `prepareTemplateRequest` builds its opening turns. `templateSession` decides what a patch may do to the template.
5. `bundle.ts` is the entry of `dist/agent-tools.bundle.js`: one ESM file with the catalogue and the reference inside. It needs no DOM, no Node and no network, and `test:deno` runs it under Deno. A backend that offers agents runs this bundle, at the WE release it was built with.
6. For a host that runs the conversation itself, the package also exports `runAgentConversation` and `createDataToolset` (a space's records through WE's write path). The loop offers a writing tool only with `mayWrite`, asks the person before a `confirm` call, and fences an `untrusted` answer as data.

</details>

<details><summary>Where in the code</summary>

- [src/core/toolset.ts](../../../packages/agent-tools/src/core/toolset.ts): `AgentTool`, `RecordToolset`, `ToolAnswer`, `Place`; [src/toolsets.ts](../../../packages/agent-tools/src/toolsets.ts): `toolsets`.
- [src/templates/](../../../packages/agent-tools/src/templates/): `templateToolset.ts`, `editSession.ts` (`runEditSession`), `templateRequest.ts` (`prepareTemplateRequest`), `templateSession.ts`, `schemaPatches.ts`, `aiInfra.ts`; [src/themes/themeToolset.ts](../../../packages/agent-tools/src/themes/themeToolset.ts).
- [src/core/conversation.ts](../../../packages/agent-tools/src/core/conversation.ts): `runAgentConversation`; [src/data/dataToolset.ts](../../../packages/agent-tools/src/data/dataToolset.ts): `createDataToolset`.
- [src/bundle.ts](../../../packages/agent-tools/src/bundle.ts) and [scripts/deno-smoke.ts](../../../packages/agent-tools/scripts/deno-smoke.ts).
- Depth: [README.md](../../../packages/agent-tools/README.md), [docs/architecture/agents.md](../../../docs/architecture/agents.md).

</details>
