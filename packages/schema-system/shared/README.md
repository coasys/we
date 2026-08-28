# @we/schema-shared

Schema semantics: everything the renderer needs to turn a template into DOM, parameterized by a
framework's reactivity primitive rather than importing one.

## What belongs here

**Anything the renderer needs to turn a template into DOM.**

- `SchemaNode` and the token types
- `propResolvers/` — `{ $ }` expressions, `$action`, `$setLocal`, the handler `$if`, `$query`, …
- validation — structural, semantic, field-level
- `indexer` / `sections` — addressing and patching a stored template
- `componentMeta`, `scope`, `conditionModel`, `themeStyles`

## What doesn't

**Anything about where data comes from.** That is `@we/backend-shared`. **Anything about declaring or
mounting a module.** That is `@we/module-shared`.

## The re-export

This package re-exports `@we/backend-shared`. Partly compatibility — the backend contract lived here
until the split, and consumers migrate an import at a time — and partly genuine: `types.ts` types a
node's `stores` bag as `RendererStores`, so the renderer's own surface names the data bindings.

New code should import from `@we/backend-shared` directly.

`@we/module-shared` is **not** re-exported: it depends on this package for `SchemaNode`, so
re-exporting it back would make the two circular.
