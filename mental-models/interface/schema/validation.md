# Validation

**Validation** checks a template in two passes. The structural pass checks the structure of the tree with zod. The semantic pass checks each name against a **validation context**: the components and their props, the store members, the entities, the expression functions and the host sources that exist.

**Why:** A template is data, so it can be checked before it renders. A structural failure can stop the renderer, so the host refuses a template that fails the structural pass ([Template tiers](../templates/tiers.md)). The semantic pass costs more, and its failure is mild: an unknown component renders one marked box in place of its node. So the host does not run it when a template arrives; the editor runs it on the template that is being written (`templateAcceptance.ts`). `validateSchema` expands `$ref` first, so every rule sees the tree that will render and reports each error at a position on screen (`semanticValidation.ts`).

**Parent:** [Schema language](README.md)

<details><summary>How it works</summary>

1. `validateSchema(schema, context)` calls `expandDefinitions`, then `validateStructure`, then `validateSemantic`.
2. `validateStructure` uses `zTemplateSchema` when the value has `meta`, else `zSchemaNode`.
3. `buildValidationContext(data)` builds the context from a `ContextData` value. The `@we/ai-context` generator writes the same data to `context.json`, which the CLI reads.
4. `validateSemantic` checks components, props and their allowed values, store paths, expression syntax and names (`checkExpression`), `$query` entity names, the parts and panels of modules, and actions that need a gesture or an argument. `meta.stores` and `meta.components` add names for one template.
5. `withEntities`, `withOwnModule` and `asHostChrome` adjust the context for a space's record types, for a module's own chrome, and for host chrome.

Each error has a `path`, a `message` and a `severity` (`error` or `warning`). A result is valid when it has no `error`.

The editor (`EditorStore`) and the template tools of `@we/agent-tools` build a validation context that includes the space's entities. `pnpm validate:schemas` runs `we-validate-schemas` over the templates of the app shell, the template packages and the modules. Five more audits report patterns that validation does not refuse: `query-audit` (a `$query` with no `limit`), `role-audit` (a scale position where a colour role belongs), `size-audit` (template size and repeated subtrees), `surface-audit` (a `surface-sunken` box with no contrast against its ground) and `tooltip-audit` (a `title` attribute where `we-tooltip` belongs).

</details>

<details><summary>Where in the code</summary>

- [validators.ts](../../../packages/schema-system/shared/src/validators.ts): `validateStructure`, `ValidationError`, `ValidationResult`.
- [zodSchemas.ts](../../../packages/schema-system/shared/src/zodSchemas.ts): `zSchemaNode`, `zTemplateSchema`.
- [semanticValidation.ts](../../../packages/schema-system/shared/src/semanticValidation.ts): `validateSchema`, `validateSemantic`, `buildValidationContext`, `ValidationContext`, `withEntities`, `withOwnModule`, `asHostChrome`.
- [contextTypes.ts](../../../packages/schema-system/shared/src/contextTypes.ts): `ContextData`.
- [cli/](../../../packages/schema-system/shared/src/cli): `we-validate-schemas.ts` and the five audits.
- [packages/app-shell/src/frameworks/solid/stores/EditorStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/EditorStore.tsx): validation while a template is edited.

</details>
