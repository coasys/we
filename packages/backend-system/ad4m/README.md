# @we/backend-ad4m

The AD4M implementation of `@we/backend-shared`.

## What belongs here

**Anything that knows what a `PerspectiveProxy` is.**

- `createAd4mQueryAdapter` / `ad4mCapabilities` — the query adapter and its honest capability
  inventory, including the two upstream bugs it degrades around
- `createAd4mEphemeralPort` — the ephemeral port over perspective signals
- `agentHelpers` — agent profiles, the identity surface
- `sdnaEntities` — SDNA install and idempotent registration
- `perspectiveHelpers` — foreign SHACL shapes → synthesised model classes
- `entityRegistry` — the AD4M model class registry
- `neutralManifest` — AD4M manifest entries → the neutral `EntityManifest`

## Dependency direction

**This package is imported by the shell and imports nothing from it.** Where that edge previously ran
backwards it has been inverted: `installSpaceSdna(p, moduleEntities)` takes the module-owned models as
an argument rather than reading the host's module registry. The caller already holds the registry, so
passing them costs nothing, and the alternative would have been the single edge pointing the wrong
way through the whole tree.

If you find yourself needing something from `@we/shell-*` here, that is the signal the thing belongs
on the other side of the call.

## Why it exists

These nine files were scattered through `app-framework/src/shared/`, where AD4M knowledge sat beside
host concerns. Gathered into one package, the AD4M surface is finally something you can read the
shape of — and `@coasys/ad4m` becomes a dependency of one package rather than an ambient fact.

## What the executor could own

Some of this package is logic held here until the executor does it. Each one moving upstream deletes
code on this side, which is the intended direction:

- SDNA staleness diffing and duplicate-install remediation (`sdnaEntities.ts`) — `refreshSpace`
  compares stored shapes against declared ones on every space switch because `add_sdna` is not
  idempotent about a shape that changed.
- Parenting extracted records and re-keying overlay values from predicates to property names
  (`interpretationAdapter.ts`) — `runInterpretation` writes instances and returns URIs; attaching
  them to a container and naming their fields for a reviewer happens here.
- The operators and bounds the planner refuses — `exists`, string range bounds, `startsWith` /
  `endsWith` — see the notes beside `ad4mCapabilities` in `ad4mAdapter.ts`, and
  `notes/we/September-2026/ad4m-follow-ups.md` (outside the repo) for the tracked items.
