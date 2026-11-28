# Store surface

The **store surface** is the set of store members that a template can reach as `modules.<id>.<name>`. A member is private until the store marks it with `markState` or `markAction`, and each mark carries a required `doc`.

**Why:** Any template can reach a public member, so a public member is public API and a statement about safety. The `store.ts` header records the option that lost: an opt-out list (`chromeOnlyStoreMembers`), where a new member was public until somebody remembered to hide it. The required `doc` feeds the generated reference, so a template author sees what each member does.

**Parent:** [Module contract](README.md)

<details><summary>How it works</summary>

| Mark | Kind | What a template can do |
|---|---|---|
| `markState(value, doc)` | `state` | Read it in an expression. The host tags it reactive. A value that is not a function is wrapped in an accessor. |
| `markAction(fn, doc)` | `action` | Call it with `$invoke`. An expression that reads it gets nothing. |
| `markAction(fn, doc, { ambient: true })` | `action`, ambient | Call it with nobody asking. |
| (no mark) | — | Nothing. Only chrome sees it. |

- `deps.state` and `deps.action` are the same two markers, so a store can mark without an import.
- An action that is not ambient runs only while a person is doing something (a press, a key, typing). Otherwise the host's gesture gate (`gated` in `templateSurface.ts`) warns and, when it enforces, does not run the action. The `markAction` comment gives the rule for `ambient`: the action changes only what this agent looks at. It stores nothing, publishes nothing and touches no device.
- Chrome (the module's own panels and the host's) renders against the chrome bag and sees every member. A template renders against the public members only (`taggedModuleStores` with `publicOnly`).
- `storeSurface(store)` reads the marks back as a `ModuleStoreSurface` (`{ kind, doc, ambient? }` per member). `moduleRegistry.storeSurface(id)` and `storeSurfaces()` expose it. The `ai-context` modules extractor uses `storeSurface` to write the generated reference, and the schema validator flags an action that is not ambient on an event that has no gesture.

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/shared/src/store.ts](../../../packages/module-system/shared/src/store.ts): `markState`, `markAction`, `memberKind`, `memberDoc`, `memberAmbient`, `storeSurface`, `ModuleStoreSurface`.
- [packages/app-shell/src/shared/registries/templateSurface.ts](../../../packages/app-shell/src/shared/registries/templateSurface.ts): `taggedModuleStores`, `gated`.
- [packages/app-shell/src/shared/registries/moduleRegistry.ts](../../../packages/app-shell/src/shared/registries/moduleRegistry.ts): `storeSurface`, `storeSurfaces`.
- [packages/ai-context/src/extractors/modules.ts](../../../packages/ai-context/src/extractors/modules.ts): the generated module reference.
- [packages/schema-system/shared/src/semanticValidation.ts](../../../packages/schema-system/shared/src/semanticValidation.ts): the check for gated actions.

</details>
