# @we/module-shared

The feature-module contract, and the package a module author installs.

```ts
import { defineModule, type ModuleHost, type ModuleStoreDeps } from '@we/module-shared';

export const bookmarksModule = defineModule({
  manifest: { id: 'bookmarks', name: 'Bookmarks', icon: 'bookmark' },
  contributes: {
    entities: { manifest: BOOKMARKS_MANIFEST },
    parts: { toggleButton },
    panels: [{ name: 'main', title: 'Bookmarks', icon: 'bookmark', node: panel, bid: { edge: 'right', size: 'md' } }],
  },
});

export const createModule = (_host: ModuleHost) => bookmarksModule;
```

## What belongs here

**Anything about declaring, gating or mounting a module.**

- `module.ts` — `ModuleDefinition` (`manifest`, `contributes`, `createStore`), `PanelContribution`,
  `SlotContribution`, `ModuleSetting`, `ModuleStoreDeps`, `checkModuleCompatibility`,
  `moduleCapabilities`.
- `kernels.ts` — the host capabilities a store asks for by name: `records`, `agentData`, `presence`,
  `ephemeral`, `media`, `peerConnection`, `transcription`, `languageModel`, `interpretation`, `secrets`.
- `interpretation.ts` — the interpretation kernel's interface.
- `store.ts` — `markState` / `markAction` (handed to a store as `deps.state` / `deps.action`),
  `storeSurface`: how a store says which members are public.
- `lint.ts` — `lintModule`: the pure half of the registry's judgement, for a test.

It also re-exports the module-facing slice of `@we/backend-shared` (`EphemeralPort`, `Peer`,
`Activity`, `planEphemeral`, …) so a module declares **one** dependency rather than three. That is a
deliberate subset, not a passthrough.

## What doesn't

**Anything a single module needs but the others don't.** That belongs in the module. **Anything
that runs.** The registry and the kernels' implementations are the host's (`@we/app-shell`).

## Predicates — mint under your own subtree

A module that owns entities writes them under **`we://module/<your-id>/<property>`** — minted for
you from a declared manifest. **Reuse the core vocabulary freely.** If your entity really has a name,
`we://name` is the right predicate; what you may not do is _mint_ a new flat `we://<word>`, and
`lintModule` (and so the registry) refuses an override that does.

## Dependency shape

Depends on both sibling contracts on purpose — slots and parts are `SchemaNode`s so chrome stays
inspectable and themeable, and the kernels hand over ports. The one-way edge: `@we/schema-shared`
re-exports `@we/backend-shared` but **not** this package.
