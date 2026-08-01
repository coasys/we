# @we/module-shared

The feature-module contract, and the package a module author installs.

```ts
import { defineModule, type ModuleStoreDeps } from '@we/module-shared';

export const createNotesModule = () =>
  defineModule({
    id: 'notes',
    name: 'Notes',
    backends: ['ad4m'], // omit to mean backend-agnostic
    createStore: (deps: ModuleStoreDeps) => ({ ... }),
  });
```

## What belongs here

**Anything about declaring, gating or mounting a module** — `ModuleDefinition`, `SlotContribution`,
`ModuleLauncher`, `ModuleCapability`, `ModuleStoreDeps`, `checkModuleCompatibility`.

It also re-exports the module-facing slice of `@we/backend-shared` (`EphemeralPort`, `Peer`,
`Activity`, `planEphemeral`, …) so a module declares **one** dependency rather than three. That is a
deliberate subset, not a passthrough: a module reaching for something not re-exported here should say
why in its own dependency list.

## What doesn't

**Anything a single module needs but the others don't.** That belongs in the module.

## Dependency shape

Depends on both sibling contracts on purpose — slots are `SchemaNode`s so chrome stays inspectable
and themeable, and `ModuleStoreDeps` hands over ports. When it is genuinely unclear which contract
something belongs to, it belongs here: this is the package that already depends on the other two.

Note the one-way edge: `@we/schema-shared` re-exports `@we/backend-shared` but **not** this package,
because that would be circular.
