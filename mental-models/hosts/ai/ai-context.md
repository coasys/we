# AI context

`@we/ai-context` generates the reference that tells a model what WE is and how to write a template. It finds each package with a `"context"` field in its `package.json`, extracts that package's components, props, tokens, entities, modules or plugins, joins them with hand-written fragments, and writes the result for coding agents and for the in-app assistant.

**Why:** Discovery is spread over the packages and extraction stays in one place. A package joins with one `"context"` field. A command-line tool for each package would need a build in three phases and a reverse dependency on `@we/ai-context`, and a script for each package would be the same code many times (decision record `2026-04-10-ai-context-discovery.md`).

**Parent:** [AI](README.md)

<details><summary>How it works</summary>

1. `generate.ts` scans `packages/**/package.json` for a `"context"` field: the entities, the tokens, the primitives, the components, the widgets, the graph and globe modules, and the block and graph Solid packages.
2. The field's `type` picks the extractor: `primitives` (`cem.ts`, the Custom Elements Manifest), `components` and `widgets` (`typescript.ts`), `tokens`, `models` (`entities.ts`) and `plugins`. Three extractors read the repository directly: `appShell.ts` (the stores), `modules.ts` and `foreignElements.ts`.
3. `assembler.ts` builds the schema reference from the extracted data and the fragments in `src/fragments/` (stores, patterns, rules, routing, panels, theming and others).
4. The coding-agent reference puts the architecture and the contribution surfaces first, then the schema reference, theming and the developer patterns. It goes to `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md` and `.cursor/rules/we-schema.mdc`, with the same content in each.
5. The schema reference alone goes to `src/schemaContext.ts`, which the [agent tools](agent-tools.md) load as the model's reference. `context.json` holds the structured data.

Run it with `pnpm --filter @we/ai-context generate-context`.

</details>

<details><summary>Where in the code</summary>

- [src/generate.ts](../../../packages/ai-context/src/generate.ts): discovery and the written files; [src/assembler.ts](../../../packages/ai-context/src/assembler.ts): `assembleReference`; [src/aggregate.ts](../../../packages/ai-context/src/aggregate.ts).
- [src/extractors/](../../../packages/ai-context/src/extractors/) and [src/fragments/](../../../packages/ai-context/src/fragments/).
- [aiInfra.ts](../../../packages/agent-tools/src/templates/aiInfra.ts): loads `schemaContext`.
- Depth: [README.md](../../../packages/ai-context/README.md), [2026-04-10-ai-context-discovery.md](../../../docs/architecture/decisions/2026-04-10-ai-context-discovery.md).

</details>
