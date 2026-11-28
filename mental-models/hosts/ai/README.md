# AI

Three parts of WE work with a language model. `@we/ai-context` says what a model knows about WE: it generates the reference that coding agents and the in-app assistant read. `@we/agent-tools` says what a model can do with WE: tools that read, make and edit templates and themes by WE's rules. The app shell's editor and shape wizard run a model through the backend's ports.

**Why:** What makes a valid template is WE's decision: to the backend a template is a file, and only WE can say whether it renders. So one framework-free package holds the tools, and the editor's AI panel and a backend that runs agents use the same rules (`backend-shared/src/agents.ts`). AI runs on the executor's language model through `BackendPorts.languageModel`: AD4M owns the interface to the model, and WE keeps the tool definitions, the loop and what to do with the results (decision record `2026-04-15-ai-through-the-node.md`).

**Parent:** [Hosts](../README.md)

## Parts

- [AI context](ai-context.md): the generator of `AGENTS.md`, `CLAUDE.md` and the other reference files, and of `schemaContext`.
- [Agent tools](agent-tools.md): toolsets, the edit session and the single-file bundle.
- [In-app AI](in-app.md): editor chats, agent turns and shape generation.

<details><summary>How it works</summary>

```
package.json "context" fields ─► @we/ai-context generate ─► AGENTS.md, CLAUDE.md, … (coding agents)
                                                         └► schemaContext (the model's reference)
EditorStore.send ─► agents.run (backend runs the agent with WE's bundle)
               └─► else languageModel.converse + runEditSession (WE runs the loop)
ShapeStore ─► languageModel ─► define_model ─► ShapeDraft ─► the wizard
```

</details>

<details><summary>Where in the code</summary>

- [packages/ai-context/](../../../packages/ai-context/), [packages/agent-tools/](../../../packages/agent-tools/).
- [agents.ts](../../../packages/backend-system/shared/src/agents.ts): `AgentRunRequest`, `AgentUnavailableError`; the language model port: [Backend contract](../../data/backend/README.md).
- Depth: [docs/architecture/agents.md](../../../docs/architecture/agents.md), [2026-04-15-ai-through-the-node.md](../../../docs/architecture/decisions/2026-04-15-ai-through-the-node.md).

</details>
