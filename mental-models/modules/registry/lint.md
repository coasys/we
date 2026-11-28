# Lint and compatibility

`lintModule(definition)` judges a definition before anything registers it and returns `problems` (the module does not register) and `warnings` (a declaration that has no effect or misleads). `checkModuleCompatibility(definition, host)` compares the manifest's `requires` with what this host is.

**Why:** A module author wants the same answers as the registry before there is a registry: in a test, in a scaffold check, in CI. So the part of the judgement that needs no host is in the contract package, and the registry calls it (`lint.ts` header). The registry treats an inert declaration as a warning, because removing a module from the app for an inert setting is the larger failure (`register` comment).

**Parent:** [Module registry](README.md)

<details><summary>How it works</summary>

| Check | Result |
|---|---|
| `manifest.id` is missing or does not match `^[a-z][a-z0-9-]*$`; `manifest.name` is missing | problem |
| A panel has no name, or two panels have one name | problem |
| `components` without `requires.frameworks` | problem |
| An entity predicate outside `we://module/<id>/`, or an entity manifest that `validateManifest` refuses (`WeNode` and the core entities are allowed as external) | problem |
| A block names an entity that is not declared, a card that is not a part, or an input that is not a component | problem |
| A view without an id, or without `meta.role: 'view'`; a launcher without an action | problem |
| A part, panel or slot reads `modules.<other>.<member>`, or places another module's part | problem |
| The same in a contributed view | warning (a view is a template; use `meta.requires.modules`) |
| A panel with `open` and no `close`, or `show`/`close` without `open` | warning |
| A `restrict` setting that defaults to `false`; an `enum` without options; a `secret` above the agent level or without the `secrets` kernel | warning |
| A block entity that is not `blockable` | warning |
| A part reads a name or a local that nothing inside it binds, or declares an input it never reads | warning |
| A panel or part pastes in a published part's node instead of placing it with `$part` | warning |

A bare `modules.<id>` (is the module installed?) is allowed. Two modules that import one package at build time are allowed.

`checkModuleCompatibility` refuses a module when `requires.backends` or `requires.frameworks` does not include the host's, or when a required kernel is not in `host.kernels` (`HOST_KERNELS` in the shell). `initializeIntegrations` makes the `ModuleHostProfile` from the connector's backend id, `solid` and `HOST_KERNELS`.

`moduleSurface(definition)` is derived, not declared: `app` (an embed), `chrome` (panels, slots or launchers), `content` (views or blocks), or `capability` (none of these). `isCommunityDecided` is true for chrome and content that is not agent-scoped. Settings → Modules shows a capability module without a switch, because turning it off would break the template that uses its component.

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/shared/src/lint.ts](../../../packages/module-system/shared/src/lint.ts): `lintModule`, `crossModuleReferences`, `partInputs`, `panelsPasteParts`, `HOST_BASE_ENTITIES`.
- [packages/module-system/shared/src/module.ts](../../../packages/module-system/shared/src/module.ts): `checkModuleCompatibility`, `ModuleHostProfile`, `moduleCapabilities`, `modulePredicatePrefix`.
- [packages/app-shell/src/shared/registries/moduleRegistry.ts](../../../packages/app-shell/src/shared/registries/moduleRegistry.ts): `moduleSurface`, `isCommunityDecided`.
- [docs/architecture/capabilities-and-surfaces.md](../../../docs/architecture/capabilities-and-surfaces.md): why a module does not reach into another module.

</details>
