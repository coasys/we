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

## Predicates — mint under your own subtree

A module that owns entities writes them under **`we://module/<your-id>/<property>`**.

**Reuse the core vocabulary freely.** If your entity really has a name, `we://name` is the right
predicate — shared vocabulary is the point, and generic UI that displays names then works on your
entity for free. What you may not do is _mint_ a new flat `we://<word>`: that namespace has one
adjudicator (WE core), and a shared namespace with no adjudicator becomes a squatting machine the
moment modules install from a marketplace. Under `we://module/<id>/` the adjudicator is module-id
uniqueness, which the registry already enforces.

`modulePredicateViolations` runs at registration and refuses a module that mints outside its subtree
or invents a scheme of its own. It is enforced rather than documented because predicates are how
existing data is found — a mistake here is not a bug you fix later, it silently orphans everything
already written.

## Dependency shape

Depends on both sibling contracts on purpose — slots are `SchemaNode`s so chrome stays inspectable
and themeable, and `ModuleStoreDeps` hands over ports. When it is genuinely unclear which contract
something belongs to, it belongs here: this is the package that already depends on the other two.

Note the one-way edge: `@we/schema-shared` re-exports `@we/backend-shared` but **not** this package,
because that would be circular.
