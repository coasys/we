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
